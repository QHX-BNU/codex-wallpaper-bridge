import { createReadStream, createWriteStream } from 'node:fs';
import { lstat, mkdir, open, readFile, readdir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { CONTENT_RATINGS, MAX_LIBRARY_ITEMS } from './library-policy.mjs';

export const MAX_IMPORT_BYTES = 20 * 1024 ** 3;
const MARKER = '.cwb-library.json';
const TERMINAL = new Set(['completed', 'failed', 'cancelled']);
const EXTENSIONS = new Map([['.png', 'image'], ['.jpg', 'image'], ['.jpeg', 'image'], ['.mp4', 'video']]);

function fail(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function samePath(a, b) {
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

/** File signatures and container boundaries, not a promise of codec support. */
async function validateMedia(file, extension, size) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(32);
    const tail = Buffer.alloc(12);
    await handle.read(head, 0, Math.min(head.length, size), 0);
    await handle.read(tail, 0, Math.min(tail.length, size), Math.max(0, size - 12));
    if (extension === '.png') {
      if (size < 45 || head.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a'
        || head.readUInt32BE(8) !== 13 || head.toString('ascii', 12, 16) !== 'IHDR'
        || tail.toString('hex') !== '0000000049454e44ae426082'
        || head.readUInt32BE(16) === 0 || head.readUInt32BE(20) === 0
        || head.readUInt32BE(16) * head.readUInt32BE(20) > 64 * 1024 ** 2) {
        throw fail('PNG 文件签名、尺寸或结尾无效');
      }
    } else if (extension === '.jpg') {
      if (size < 4 || head.subarray(0, 3).toString('hex') !== 'ffd8ff'
        || tail.subarray(10).toString('hex') !== 'ffd9') throw fail('JPG 文件签名或结尾无效');
    } else {
      if (size < 32 || head.toString('ascii', 4, 8) !== 'ftyp') throw fail('MP4 文件签名无效');
      let offset = 0;
      let boxes = 0;
      const found = new Set();
      while (offset < size && boxes++ < 10_000) {
        const header = Buffer.alloc(16);
        const { bytesRead } = await handle.read(header, 0, Math.min(16, size - offset), offset);
        if (bytesRead < 8) throw fail('MP4 容器被截断');
        const type = header.toString('ascii', 4, 8);
        let length = header.readUInt32BE(0);
        if (length === 1) {
          if (bytesRead < 16) throw fail('MP4 大文件块被截断');
          const wide = header.readBigUInt64BE(8);
          if (wide > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('MP4 文件块过大');
          length = Number(wide);
          if (length < 16) throw fail('MP4 大文件块无效');
        } else if (length === 0) length = size - offset;
        if (length < 8 || length > size - offset) throw fail('MP4 文件块长度无效');
        found.add(type);
        offset += length;
      }
      if (offset !== size || !found.has('moov') || !found.has('mdat')) throw fail('MP4 缺少完整媒体或索引块');
    }
  } finally {
    await handle.close();
  }
}

async function digestFile(file, signal) {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
  return hash.digest('hex');
}

/** One writer per library. Only indexed, hash-named files in a marked root are mutable. */
export class AssetLibrary {
  #store;
  #owner;
  #defaultDirectory;
  #jobs = new Map();
  #active = null;
  #queue = Promise.resolve();
  #closed = false;

  constructor({ configStore }) {
    if (!configStore?.filePath) throw new TypeError('资源库需要持久化配置');
    this.#store = configStore;
    this.#defaultDirectory = path.join(path.dirname(configStore.filePath), 'assets');
    this.#owner = createHash('sha256').update(path.resolve(configStore.filePath).toLowerCase()).digest('hex');
  }

  get directory() { return this.#store.get().library.directory || this.#defaultDirectory; }
  get busy() { return this.#active !== null; }

  async projects() {
    const config = this.#store.get();
    return config.library.assets.map((asset) => ({
      ...asset, source: 'imported', rootPath: this.directory,
      mediaPath: path.join(this.directory, asset.fileName),
      previewPath: asset.type === 'image' ? path.join(this.directory, asset.fileName) : null,
      playable: true, contentRating: asset.rating,
    }));
  }

  #idle() {
    if (this.#closed) throw fail('资源库正在退出', 409);
    if (this.busy) throw fail('资源任务正在进行，请等待或取消后重试', 409);
  }

  #newJob(kind, total) {
    this.#idle();
    for (const [id, job] of this.#jobs) {
      if (job.status === 'queued' && Date.now() - job.createdAt > 60_000) job.status = 'cancelled';
      if (TERMINAL.has(job.status) && this.#jobs.size >= 64) this.#jobs.delete(id);
    }
    if (this.#jobs.size >= 64) throw fail('待处理任务过多，请先取消旧任务', 429);
    const job = { id: randomUUID(), kind, status: 'queued', bytes: 0, total,
      createdAt: Date.now(), controller: new AbortController(), work: null, result: null, error: null };
    this.#jobs.set(job.id, job);
    return job;
  }

  #job(id) {
    const job = this.#jobs.get(id);
    if (!job) throw fail('资源任务不存在', 404);
    return job;
  }

  getJob(id) {
    const job = this.#job(id);
    if (job.status === 'queued' && Date.now() - job.createdAt > 60_000) {
      job.controller.abort();
      job.status = 'cancelled';
    }
    return { id: job.id, kind: job.kind, status: job.status, bytes: job.bytes, total: job.total,
      result: job.result, error: job.error, cancellable: !TERMINAL.has(job.status) && job.status !== 'committing' };
  }

  async resolve(id) {
    const asset = this.#store.get().library.assets.find((item) => item.id === id);
    if (!asset) throw fail('导入资源不存在', 404);
    return this.#file(this.directory, asset);
  }

  beginImport({ filename, size, rating = 'unrated' } = {}) {
    if (typeof filename !== 'string' || !filename || filename.length > 255
      || /[\\/\x00-\x1f]/.test(filename)) throw fail('文件名无效');
    let extension = path.extname(filename).toLowerCase();
    if (!EXTENSIONS.has(extension)) throw fail('只允许导入 JPG、PNG 或 MP4');
    if (extension === '.jpeg') extension = '.jpg';
    if (!Number.isSafeInteger(size) || size <= 0 || size > MAX_IMPORT_BYTES) throw fail('文件为空或超过 20 GiB 上限', 413);
    if (!CONTENT_RATINGS.includes(rating)) throw fail('内容分级无效');
    const job = this.#newJob('import', size);
    job.metadata = { extension, rating, title: path.basename(filename, path.extname(filename)).slice(0, 200) };
    return this.getJob(job.id);
  }

  #enqueue(operation) {
    const next = this.#queue.catch(() => {}).then(operation);
    this.#queue = next;
    return next;
  }

  mutate(operation) {
    this.#idle();
    return this.#enqueue(() => {
      this.#idle();
      return operation();
    });
  }

  #run(job, operation) {
    this.#active = job;
    job.status = 'running';
    job.work = this.#enqueue(async () => {
      try {
        job.controller.signal.throwIfAborted();
        job.result = await operation();
        job.status = 'completed';
      } catch (error) {
        job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
        job.error = error.statusCode ? error.message : '文件操作或配置保存失败，原配置已保留';
      } finally {
        this.#active = null;
      }
      return this.getJob(job.id);
    });
    return job.work;
  }

  async #root(directory, create = false) {
    const resolved = path.resolve(directory);
    if (create) {
      if (samePath(resolved, this.#defaultDirectory)) await mkdir(path.dirname(resolved), { recursive: true });
      await mkdir(resolved).catch((error) => { if (error.code !== 'EEXIST') throw error; });
    }
    const info = await lstat(resolved);
    if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(resolved), resolved)) {
      throw fail('资源目录不能是链接或重解析目录');
    }
    const marker = path.join(resolved, MARKER);
    try {
      const entry = await lstat(marker);
      if (!entry.isFile() || entry.isSymbolicLink() || entry.size > 4096) throw fail('资源目录归属标记无效');
      const value = JSON.parse(await readFile(marker, 'utf8'));
      if (value.app !== 'CodexWallpaperBridge' || value.owner !== this.#owner) throw fail('不能使用其他配置管理的资源目录');
    } catch (error) {
      if (error.code !== 'ENOENT' || !create || (await readdir(resolved)).length !== 0) {
        throw fail('目录不是本程序管理的空目录或资源库');
      }
      await writeFile(marker, JSON.stringify({ app: 'CodexWallpaperBridge', owner: this.#owner, version: 1 }),
        { flag: 'wx', mode: 0o600 });
    }
    return resolved;
  }

  async #file(directory, asset) {
    const root = await this.#root(directory);
    const file = path.join(root, asset.fileName);
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink() || info.size !== asset.size
      || !samePath(await realpath(file), file)) throw fail('资源文件已变化或不是受管普通文件');
    return file;
  }

  async #stream(source, destination, job, maximum) {
    const hash = createHash('sha256');
    let size = 0;
    const meter = new Transform({ transform(chunk, encoding, callback) {
      size += chunk.length;
      if (size > maximum) { callback(fail('实际文件长度超过声明大小', 413)); return; }
      hash.update(chunk);
      job.bytes += chunk.length;
      callback(null, chunk);
    } });
    await pipeline(source, meter, createWriteStream(destination, { flags: 'wx', mode: 0o600 }),
      { signal: job.controller.signal });
    if (size !== maximum) throw fail('文件未完整传输');
    return hash.digest('hex');
  }

  async upload(id, source) {
    this.#idle();
    const job = this.#job(id);
    if (job.kind !== 'import' || job.status !== 'queued' || Date.now() - job.createdAt > 60_000) {
      throw fail('任务已结束、过期或已经开始传输', 409);
    }
    return this.#run(job, async () => {
      const root = await this.#root(this.directory, true);
      const temporary = path.join(root, `${job.id}.part`);
      let created = null;
      try {
        const hash = await this.#stream(source, temporary, job, job.total);
        await validateMedia(temporary, job.metadata.extension, job.total);
        job.controller.signal.throwIfAborted();
        const config = this.#store.get();
        const existing = config.library.assets.find((asset) => asset.hash === hash);
        if (existing) {
          const file = await this.#file(root, existing);
          if (await digestFile(file, job.controller.signal) !== hash) throw fail('已存在的资源内容已变化');
          return { assetId: existing.id, deduplicated: true };
        }
        if (config.library.assets.length >= MAX_LIBRARY_ITEMS) throw fail('资源库已达到数量上限', 413);
        const asset = { id: `upload:${hash}`, hash, fileName: `${hash}${job.metadata.extension}`,
          size: job.total, title: job.metadata.title, type: EXTENSIONS.get(job.metadata.extension), rating: job.metadata.rating };
        const target = path.join(root, asset.fileName);
        // A hash-name collision without an index entry is not ours to overwrite.
        const writer = await open(target, 'wx', 0o600);
        await writer.close();
        created = target;
        await rename(temporary, target);
        job.controller.signal.throwIfAborted();
        job.status = 'committing';
        await this.#store.set({ library: { assets: [...config.library.assets, asset] } });
        created = null;
        return { assetId: asset.id, deduplicated: false };
      } finally {
        await rm(temporary, { force: true });
        if (created) await rm(created, { force: true });
      }
    });
  }

  cancel(id) {
    const job = this.#job(id);
    if (job.status !== 'committing' && !TERMINAL.has(job.status)) {
      job.controller.abort();
      if (job.status === 'queued') job.status = 'cancelled';
    }
    return this.getJob(id);
  }

  async wait(id) {
    await this.#job(id).work;
    return this.getJob(id);
  }

  async remove(id, selectedId = null) {
    return this.mutate(async () => {
      const config = this.#store.get();
      const asset = config.library.assets.find((item) => item.id === id);
      if (!asset) throw fail('只能移除本程序导入的资源');
      let file;
      let trash;
      try {
        file = await this.#file(this.directory, asset);
        if (await digestFile(file) !== asset.hash) throw fail('资源内容已变化，未执行删除');
        trash = path.join(this.directory, `${randomUUID()}.trash`);
        await rename(file, trash);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      try {
        const ratings = { ...config.library.ratings };
        delete ratings[id];
        await this.#store.set({
          selectedId: config.selectedId === id ? selectedId : config.selectedId,
          library: { assets: config.library.assets.filter((item) => item.id !== id),
            hiddenIds: config.library.hiddenIds.filter((item) => item !== id), ratings },
        });
      } catch (error) {
        if (trash) await rename(trash, file);
        throw error;
      }
      let cleanupPending = false;
      if (trash) await rm(trash).catch(() => { cleanupPending = true; });
      return { removed: true, cleanupPending };
    });
  }

  async beginMigration(parent) {
    if (typeof parent !== 'string' || !path.isAbsolute(parent) || parent.includes('\0') || parent.length > 4096) {
      throw fail('请选择已存在的绝对目录');
    }
    this.#idle();
    const destination = path.join(await realpath(parent), 'CodexWallpaperBridge-library');
    const config = this.#store.get();
    const source = this.directory;
    const job = this.#newJob('migrate', config.library.assets.reduce((sum, asset) => sum + asset.size, 0));
    void this.#run(job, async () => {
      if (samePath(source, destination)) return { sourceRetained: true, unchanged: true };
      const root = await this.#root(destination, true);
      const created = [];
      const partials = [];
      let committed = false;
      try {
        for (const asset of config.library.assets) {
          job.controller.signal.throwIfAborted();
          const file = await this.#file(source, asset);
          const target = path.join(root, asset.fileName);
          let exists = false;
          try { await lstat(target); exists = true; }
          catch (error) { if (error.code !== 'ENOENT') throw error; }
          if (exists) {
            const valid = await this.#file(root, asset);
            if (await digestFile(valid, job.controller.signal) !== asset.hash) throw fail('目标目录存在同名不同内容的文件');
            job.bytes += asset.size;
            continue;
          }
          const temporary = path.join(root, `${job.id}-${partials.length}.part`);
          partials.push(temporary);
          const hash = await this.#stream(createReadStream(file), temporary, job, asset.size);
          if (hash !== asset.hash) throw fail('源资源内容已变化，迁移未提交');
          job.controller.signal.throwIfAborted();
          const reservation = await open(target, 'wx', 0o600);
          await reservation.close();
          created.push(target);
          await rename(temporary, target);
        }
        job.controller.signal.throwIfAborted();
        job.status = 'committing';
        await this.#store.set({ library: { directory: root } });
        committed = true;
        // Keep old bytes: in-flight Range readers and rollback must remain valid.
        return { sourceRetained: true, copied: config.library.assets.length };
      } finally {
        for (const file of partials) await rm(file, { force: true });
        if (!committed) for (const file of created) await rm(file, { force: true });
      }
    });
    return this.getJob(job.id);
  }

  async close() {
    this.#closed = true;
    for (const job of this.#jobs.values()) this.cancel(job.id);
    await this.#queue.catch(() => {});
  }
}
