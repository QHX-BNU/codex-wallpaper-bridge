import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { normalizeAuthorProperties, readAuthorProperties, validateAuthorPropertyPatch } from './author-properties.mjs';
import { effectiveAuthorFileProperties } from './author-property-state.mjs';

/** Only called after registered-project eligibility lookup; clients never supply the root or schema. */
async function manifestFor(project) {
  try {
    const root = await realpath(project.rootPath), file = await realpath(path.join(root, 'project.json'));
    const relative = path.relative(root, file);
    if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error();
    const info = await stat(file);
    if (!info.isFile() || info.size > 1024 ** 2) throw Error();
    const manifest = JSON.parse((await readFile(file, 'utf8')).replace(/^\uFEFF/, ''));
    return normalizeAuthorProperties(manifest.general?.properties);
  } catch { throw Object.assign(new Error('作者属性元数据不可用'), { statusCode: 404 }); }
}

export class AuthorPropertyController {
  #store;
  #live;
  #files;
  #closed = false;
  #queue = Promise.resolve();
  constructor({ configStore, onAuthorProperties = null, authorFiles = null }) {
    this.#store = configStore; this.#live = onAuthorProperties; this.#files = authorFiles;
  }
  state(project, patch = null) {
    const action = this.#queue.catch(() => {}).then(() => this.#state(project, patch));
    this.#queue = action; return action;
  }
  upload(project, key, source, metadata, directory = false) {
    const action = this.#queue.catch(() => {}).then(async () => {
      if (this.#closed) throw Object.assign(Error('作者属性服务已关闭'), { statusCode: 503 });
      if (!this.#files) throw Object.assign(Error('作者文件需要持久化配置'), { statusCode: 501 });
      const manifest = await manifestFor(project);
      if (!Object.hasOwn(manifest.schema, key) || manifest.schema[key].type !== (directory ? 'directory' : 'file')) {
        throw Object.assign(Error('作者文件属性无效'), { statusCode: 400 });
      }
      if (!Number.isSafeInteger(metadata.revision) || metadata.revision < 0) throw Object.assign(Error('作者属性请求无效'), { statusCode: 400 });
      if (metadata.revision !== this.#store.authorPropertiesRevision(project.id)) throw Object.assign(Error('配置已更新，请重新读取作者属性'), { statusCode: 409 });
      const value = await this.#files.import(project.id, key, manifest.schema[key], source, metadata);
      if (directory) {
        if (this.#closed) throw Object.assign(Error('作者属性服务已关闭'), { statusCode: 503 });
        if (metadata.revision !== this.#store.authorPropertiesRevision(project.id)) throw Object.assign(Error('配置已更新，请重新读取作者属性'), { statusCode: 409 });
        return { value }; // stage only; one final CAS selects the whole directory
      }
      // Re-read the manifest and retain CAS after streaming: another writer or
      // an author schema change cannot commit a stale upload to new state.
      return this.#state(project, { revision: metadata.revision, values: { [key]: value } });
    });
    this.#queue = action; return action;
  }
  directory(project, key, patch) {
    const action = this.#queue.catch(() => {}).then(async () => {
      if (this.#closed) throw Object.assign(Error('作者属性服务已关闭'), { statusCode: 503 });
      if (!this.#files) throw Object.assign(Error('作者文件需要持久化配置'), { statusCode: 501 });
      const manifest = await manifestFor(project);
      if (!patch || typeof patch !== 'object' || Array.isArray(patch) || Object.keys(patch).length !== 2
        || !Object.hasOwn(patch, 'files') || !Number.isSafeInteger(patch.revision) || patch.revision < 0
        || !Object.hasOwn(manifest.schema, key) || manifest.schema[key].type !== 'directory') throw Object.assign(Error('作者目录请求无效'), { statusCode: 400 });
      if (patch.revision !== this.#store.authorPropertiesRevision(project.id)) throw Object.assign(Error('配置已更新，请重新读取作者属性'), { statusCode: 409 });
      const value = await this.#files.createDirectory(project.id, key, manifest.schema[key], patch.files);
      return this.#state(project, { revision: patch.revision, values: { [key]: value } });
    });
    this.#queue = action; return action;
  }
  async #state(project, patch) {
    if (this.#closed) throw Object.assign(Error('作者属性服务已关闭'), { statusCode: 503 });
    const manifest = await manifestFor(project);
    if (patch !== null) {
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)
        || Object.keys(patch).some((key) => !['values', 'reset', 'revision'].includes(key))
        || !Number.isSafeInteger(patch.revision) || patch.revision < 0
        || (patch.reset === true ? Object.hasOwn(patch, 'values') : Object.hasOwn(patch, 'reset') || !Object.hasOwn(patch, 'values'))) {
        throw Object.assign(new Error('作者属性请求无效'), { statusCode: 400 });
      }
      const valid = patch.reset === true ? null : validateAuthorPropertyPatch(manifest.schema, patch.values);
      if (patch.reset !== true && !valid) throw Object.assign(new Error('作者属性类型或范围无效'), { statusCode: 400 });
      for (const [key, value] of Object.entries(valid || {})) {
        const spec = manifest.schema[key];
        if (!['file', 'directory'].includes(spec.type) || !value.startsWith(spec.type === 'file' ? 'cwb-author-files/' : 'cwb-author-directories/')) continue;
        try {
          if (!this.#files) throw Error();
          if (spec.type === 'directory') await this.#files.directory(project.id, key, value, spec);
          else await this.#files.resolve(project.id, key, value);
        }
        catch { throw Object.assign(Error('作者文件引用无效或资源已变化'), { statusCode: 400 }); }
      }
      const config = this.#store.get();
      const { values } = await effectiveAuthorFileProperties(manifest, config.authorProperties[project.id], { projectId: project.id, authorFiles: this.#files });
      if (this.#closed) throw Object.assign(Error('作者属性服务已关闭'), { statusCode: 503 });
      await this.#store.setAuthorProperties(project.id, valid === null ? null : { ...values, ...valid }, { ifRevision: patch.revision });
    }
    const revision = this.#store.authorPropertiesRevision(project.id), config = this.#store.get();
    const effective = await effectiveAuthorFileProperties(manifest, config.authorProperties[project.id], { projectId: project.id, authorFiles: this.#files });
    let live = { phase: 'unavailable', method: 'none', values: {} };
    if (this.#live) {
      try {
        let timer;
        let result;
        try {
          result = await Promise.race([this.#live({ operation: patch === null ? 'read' : 'apply', project, values: effective.values }),
            new Promise((_, reject) => { timer = setTimeout(() => reject(Error('author_live_timeout')), 5000); })]);
        } finally { clearTimeout(timer); }
        if (result && ['ready', 'unsupported', 'unavailable', 'failed'].includes(result.phase)
          && ['none', 'engine-readback', 'author-delivery'].includes(result.method)) {
          live = { phase: result.phase, method: result.method,
            ...(result.source === 'codex-gpu' && ['engine-readback', 'author-delivery'].includes(result.method) ? { source: 'codex-gpu' } : {}),
            ...readAuthorProperties(manifest.schema, result.values, validateAuthorPropertyPatch) };
        }
      } catch { live = { phase: 'failed', method: 'none', values: {} }; }
    }
    return { id: project.id, schema: manifest.schema, defaults: manifest.values, ...effective, revision, live,
      fileSelectionAvailable: Boolean(this.#files) };
  }
  async close() { this.#closed = true; await this.#queue.catch(() => {}); }
}
