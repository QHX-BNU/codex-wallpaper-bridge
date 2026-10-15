import { randomBytes } from 'node:crypto';
import { createReadonlyWallpaperServer } from './scene-server.mjs';
import { effectiveAuthorFileProperties } from './author-property-state.mjs';

const invalid = (reason, statusCode = 400) => Object.assign(Error(reason), { statusCode });
const capability = (value) => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);
const keysOnly = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).every((key) => keys.includes(key));

/** Browser preview only, independent of native/CDP delivery. No filesystem or
 * renderer-config inputs are accepted from a client; lookup supplies the root.
 * Closing reservations count against capacity until their real server closes.
 */
export class ScenePreviewLeases {
  #getProject; #getConfig; #parentOrigin; #createServer; #now; #authorFiles;
  #records = new Map(); #closed = false; #timer;
  constructor({ getProject, getConfig, parentOrigin, createServer = createReadonlyWallpaperServer, now = Date.now, watch = true, authorFiles = null }) {
    if ([getProject, getConfig, parentOrigin, createServer, now].some((fn) => typeof fn !== 'function')) throw TypeError('preview_invalid');
    this.#getProject = getProject; this.#getConfig = getConfig; this.#parentOrigin = parentOrigin;
    this.#createServer = createServer; this.#now = now;
    this.#authorFiles = authorFiles;
    if (watch) { this.#timer = setInterval(() => { void this.reap().catch(() => {}); }, 10000); this.#timer.unref?.(); }
  }
  async open(args) {
    if (!keysOnly(args, ['client', 'id', 'fps']) || !capability(args.client)
      || typeof args.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(args.id)
      || ![15, 30, 60].includes(args.fps ?? 60)) throw invalid('preview_invalid');
    if (this.#closed) throw invalid('preview_closed', 503);
    if (this.#records.size >= 2) throw invalid('preview_capacity', 409);
    const record = { handle: randomBytes(16).toString('hex'), client: args.client, id: args.id,
      fps: args.fps ?? 60, expires: this.#now() + 90000, released: false, server: null, closing: null };
    this.#records.set(record.handle, record);
    record.starting = this.#start(record);
    try { return await record.starting; }
    catch (error) { await this.#release(record); throw error; }
  }
  async #start(record) {
    const project = await this.#getProject(record.id), config = await this.#getConfig();
    if (this.#closed || record.released) throw invalid('preview_cancelled', 409);
    if (!project || !['scene', 'web'].includes(project.type) || project.eligible === false || project.hidden) throw invalid('preview_unavailable', 404);
    record.rootPath = project.rootPath;
    record.type = project.type;
    record.server = this.#createServer({ project, config, parentOrigin: this.#parentOrigin(), frameRate: record.fps,
      nativeQuality: true, desktopAncestor: true, authorFiles: this.#authorFiles });
    try { await record.server.start(); }
    catch { throw invalid('preview_unavailable', 404); }
    if (this.#closed || record.released) throw invalid('preview_cancelled', 409);
    const { values: properties } = await effectiveAuthorFileProperties(record.server.authorProperties, config.authorProperties?.[project.id], { projectId: project.id, authorFiles: this.#authorFiles });
    return { handle: record.handle, type: record.type, origin: record.server.origin, url: record.server.rendererUrl,
      resourceBase: record.server.resourceBase, channel: record.server.channel,
      fps: record.fps, properties, firstFrameTimeoutMs: record.server.firstFrameTimeoutMs ?? 90000 };
  }
  #owned(args) {
    if (!keysOnly(args, ['client', 'handle']) || !capability(args.client) || !capability(args.handle)) throw invalid('preview_invalid');
    const record = this.#records.get(args.handle);
    if (!record || record.released || record.client !== args.client) throw invalid('preview_unavailable', 404);
    return record;
  }
  async renew(args) {
    const record = this.#owned(args);
    if (record.expires <= this.#now()) { await this.#release(record); throw invalid('preview_unavailable', 404); }
    record.expires = this.#now() + 90000; return { ok: true };
  }
  async validate(args) {
    const record = this.#owned(args);
    if (record.expires <= this.#now()) { await this.#release(record); throw invalid('preview_unavailable', 404); }
    await record.starting;
    const [project, config] = await Promise.all([this.#getProject(record.id), this.#getConfig()]);
    if (this.#closed || record.released || record.expires <= this.#now()
      || !project || project.type !== record.type || project.eligible === false || project.hidden
      || project.rootPath !== record.rootPath || !await record.server.isCurrent()) return { current: false };
    if (this.#closed || record.released || record.expires <= this.#now()) return { current: false };
    const { values: properties } = await effectiveAuthorFileProperties(record.server.authorProperties, config.authorProperties?.[record.id], { projectId: record.id, authorFiles: this.#authorFiles });
    return { current: true, properties };
  }
  async release(args) { await this.#release(this.#owned(args)); return { ok: true }; }
  #release(record) {
    if (record.closing) return record.closing;
    record.released = true;
    record.closing = (async () => {
      await record.starting?.catch(() => {});
      await record.server?.close();
      this.#records.delete(record.handle);
    })().catch((error) => { record.closing = null; throw error; });
    return record.closing;
  }
  async reap() {
    await Promise.all([...this.#records.values()].filter((record) => record.expires <= this.#now()).map((record) => this.#release(record)));
  }
  async close() { this.#closed = true; clearInterval(this.#timer); await Promise.all([...this.#records.values()].map((record) => this.#release(record))); }
  status() { return { closed: this.#closed, slots: this.#records.size }; }
}
