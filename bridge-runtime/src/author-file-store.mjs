import { createWriteStream } from 'node:fs';
import { lstat, mkdir, open, opendir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { AUTHOR_DIRECTORY_LIMITS } from './author-directory.mjs';

export const AUTHOR_FILE_LIMITS = Object.freeze({ fileBytes: 64 * 1024 ** 2, totalBytes: 512 * 1024 ** 2, files: 512, timeoutMs: 30000 });
const MARKER = '.cwb-author-files.json';
const PREFIX = 'cwb-author-files/';
const NAME = /^[a-f0-9]{32}-[a-f0-9]{32}-([a-f0-9]{64})\.(png|jpg|gif|webp|bmp|mp4|webm|mp3|wav|ogg|flac)$/;
const DIRECTORY_PREFIX = 'cwb-author-directories/';
const DIRECTORY_NAME = /^[a-f0-9]{32}-[a-f0-9]{32}-([a-f0-9]{64})\.json$/;
const sha = value => createHash('sha256').update(value).digest('hex');
const scope = (id, key) => sha(String(id)).slice(0, 32) + '-' + sha(String(key)).slice(0, 32) + '-';
const fail = (message, statusCode = 400) => Object.assign(Error(message), { statusCode });
const samePath = (a, b) => path.relative(a, b) === '';
const sameStat = (a, b) => ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs'].every(key => a[key] === b[key]);

/** File signatures/container bounds only, not a claim of codec support. */
async function validateContent(file, ext, size) {
  const handle = await open(file, 'r');
  try {
    const head = Buffer.alloc(64), tail = Buffer.alloc(12);
    await handle.read(head, 0, Math.min(size, head.length), 0);
    await handle.read(tail, 0, Math.min(size, tail.length), Math.max(0, size - tail.length));
    let valid = false;
    if (ext === '.png') valid = size >= 45 && head.subarray(0, 8).toString('hex') === '89504e470d0a1a0a'
      && head.readUInt32BE(8) === 13 && head.toString('ascii', 12, 16) === 'IHDR'
      && head.readUInt32BE(16) > 0 && head.readUInt32BE(20) > 0
      && head.readUInt32BE(16) * head.readUInt32BE(20) <= 64 * 1024 ** 2 && tail.toString('hex') === '0000000049454e44ae426082';
    else if (ext === '.jpg') valid = size >= 4 && head.subarray(0, 3).toString('hex') === 'ffd8ff' && tail.subarray(10).toString('hex') === 'ffd9';
    else if (ext === '.gif') valid = size >= 14 && ['GIF87a', 'GIF89a'].includes(head.toString('ascii', 0, 6))
      && head.readUInt16LE(6) > 0 && head.readUInt16LE(8) > 0 && tail[11] === 0x3b;
    else if (ext === '.webp') valid = size >= 20 && head.toString('ascii', 0, 4) === 'RIFF'
      && head.readUInt32LE(4) + 8 === size && head.toString('ascii', 8, 12) === 'WEBP'
      && ['VP8 ', 'VP8L', 'VP8X'].includes(head.toString('ascii', 12, 16));
    else if (ext === '.bmp') valid = size >= 54 && head.toString('ascii', 0, 2) === 'BM' && head.readUInt32LE(2) === size
      && head.readUInt32LE(10) >= 54 && head.readUInt32LE(10) < size;
    else if (ext === '.wav') valid = size >= 44 && head.toString('ascii', 0, 4) === 'RIFF'
      && head.readUInt32LE(4) + 8 === size && head.toString('ascii', 8, 12) === 'WAVE';
    else if (ext === '.ogg') valid = size >= 28 && head.toString('ascii', 0, 4) === 'OggS' && head[4] === 0;
    else if (ext === '.flac') valid = size >= 42 && head.toString('ascii', 0, 4) === 'fLaC';
    else if (ext === '.mp3') valid = size >= 16 && (head.toString('ascii', 0, 3) === 'ID3'
      || (head[0] === 0xff && (head[1] & 0xe0) === 0xe0 && (head[1] & 0x06) !== 0));
    else if (ext === '.webm') valid = size >= 32 && head.subarray(0, 4).toString('hex') === '1a45dfa3' && head.includes(Buffer.from('webm'));
    else if (ext === '.mp4' && size >= 32 && head.toString('ascii', 4, 8) === 'ftyp') {
      let offset = 0, boxes = 0; const found = new Set();
      while (offset < size && boxes++ < 10000) {
        const header = Buffer.alloc(16), { bytesRead } = await handle.read(header, 0, Math.min(16, size - offset), offset);
        if (bytesRead < 8) break;
        let length = header.readUInt32BE(0);
        if (length === 1) {
          if (bytesRead < 16 || header.readBigUInt64BE(8) > BigInt(size)) break;
          length = Number(header.readBigUInt64BE(8)); if (length < 16) break;
        } else if (length === 0) length = size - offset;
        if (length < 8 || length > size - offset) break;
        found.add(header.toString('ascii', 4, 8)); offset += length;
      }
      valid = offset === size && found.has('moov') && found.has('mdat');
    }
    if (!valid) throw fail('文件格式或内容签名无效');
  } finally { await handle.close(); }
}

/** A flat, marked, config-owned library. IDs bind project, property and bytes;
 * authors never receive a path, upload API or mutable directory capability. */
export class AuthorFileStore {
  #directory; #owner; #queue = Promise.resolve(); #closed = false; #abort = new AbortController();
  constructor({ configStore }) {
    if (!configStore?.filePath) throw TypeError('作者文件需要持久化配置');
    const config = path.resolve(configStore.filePath);
    this.#directory = path.join(path.dirname(config), 'author-files');
    this.#owner = sha(process.platform === 'win32' ? config.toLowerCase() : config);
  }
  owns(projectId, key, value) {
    return typeof value === 'string' && value.startsWith(PREFIX) && NAME.test(value.slice(PREFIX.length))
      && value.slice(PREFIX.length).startsWith(scope(projectId, key));
  }
  ownsDirectory(projectId, key, value) {
    return typeof value === 'string' && value.startsWith(DIRECTORY_PREFIX) && DIRECTORY_NAME.test(value.slice(DIRECTORY_PREFIX.length))
      && value.slice(DIRECTORY_PREFIX.length).startsWith(scope(projectId, key));
  }
  async #root(create = false) {
    // Check parents before creating a leaf: recursive mkdir through an
    // ancestor junction could otherwise write outside the intended config.
    let current = path.parse(this.#directory).root;
    for (const part of this.#directory.slice(current.length).split(path.sep).filter(Boolean)) {
      current = path.join(current, part);
      let info;
      try { info = await lstat(current); }
      catch (error) {
        if (!create || error.code !== 'ENOENT') throw error;
        await mkdir(current); info = await lstat(current);
      }
      if (!info.isDirectory() || info.isSymbolicLink() || !samePath(await realpath(current), current)) throw fail('作者文件目录归属无效');
    }
    const marker = path.join(this.#directory, MARKER);
    try {
      const info = await lstat(marker);
      if (!info.isFile() || info.isSymbolicLink() || info.size > 4096 || !samePath(await realpath(marker), marker)) throw Error();
      const value = JSON.parse(await readFile(marker, 'utf8'));
      if (value.version !== 1 || value.owner !== this.#owner || value.app !== 'CodexWallpaperBridge') throw Error();
    } catch (error) {
      if (!create || error.code !== 'ENOENT') throw fail('作者文件目录归属无效');
      const stream = await opendir(this.#directory); let empty = true;
      for await (const _entry of stream) { empty = false; break; }
      if (!empty) throw fail('作者文件目录不是受管空目录');
      await writeFile(marker, JSON.stringify({ app: 'CodexWallpaperBridge', owner: this.#owner, version: 1 }), { flag: 'wx', mode: 0o600 });
    }
    return this.#directory;
  }
  async #inventory(root) {
    let total = 0, count = 0;
    for await (const entry of await opendir(root)) {
      if (entry.name === MARKER) continue;
      const index = entry.name.startsWith('d-') && DIRECTORY_NAME.test(entry.name.slice(2));
      const staging = /^[a-f0-9-]{36}\.part$/.test(entry.name);
      if (++count > AUTHOR_FILE_LIMITS.files || (!NAME.test(entry.name) && !index && !staging)) throw fail('作者文件库已满或存在非受管文件', 413);
      const file = path.join(root, entry.name), info = await lstat(file);
      if (!info.isFile() || info.isSymbolicLink() || info.size > (index ? AUTHOR_DIRECTORY_LIMITS.indexBytes : AUTHOR_FILE_LIMITS.fileBytes)
        || !samePath(await realpath(file), file)) throw fail('作者文件库存在非受管文件');
      total += info.size; if (total > AUTHOR_FILE_LIMITS.totalBytes) throw fail('作者文件库已满', 413);
    }
    return { total, count };
  }
  async resolve(projectId, key, value) {
    const name = typeof value === 'string' && value.startsWith(PREFIX) ? value.slice(PREFIX.length) : '';
    const match = NAME.exec(name);
    if (this.#closed || !match || !name.startsWith(scope(projectId, key))) throw fail('作者文件引用无效');
    const root = await this.#root(), file = path.join(root, name), before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > AUTHOR_FILE_LIMITS.fileBytes
      || !samePath(await realpath(file), file)) throw fail('作者文件已变化或不可用');
    const handle = await open(file, 'r');
    try {
      if (!sameStat(before, await handle.stat())) throw fail('作者文件已变化或不可用');
      const digest = createHash('sha256'); let size = 0;
      for await (const chunk of handle.createReadStream({ autoClose: false })) {
        size += chunk.length; if (size > AUTHOR_FILE_LIMITS.fileBytes) throw fail('作者文件已变化或不可用'); digest.update(chunk);
      }
      if (size !== before.size || digest.digest('hex') !== match[1] || !sameStat(before, await handle.stat())
        || !sameStat(before, await lstat(file))) throw fail('作者文件已变化或不可用');
      await validateContent(file, path.extname(name), before.size);
    } finally { await handle.close(); }
    return { path: file, info: before };
  }
  async directory(projectId, key, value, spec) {
    if (this.#closed || spec?.type !== 'directory' || !this.ownsDirectory(projectId, key, value)) throw fail('作者目录引用无效');
    const name = value.slice(DIRECTORY_PREFIX.length), root = await this.#root(), file = path.join(root, 'd-' + name);
    const before = await lstat(file);
    if (!before.isFile() || before.isSymbolicLink() || before.size <= 0 || before.size > AUTHOR_DIRECTORY_LIMITS.indexBytes
      || !samePath(await realpath(file), file)) throw fail('作者目录已变化或不可用');
    const handle = await open(file, 'r'); let list;
    try {
      if (!sameStat(before, await handle.stat())) throw fail('作者目录已变化或不可用');
      const bytes = Buffer.alloc(before.size + 1), { bytesRead } = await handle.read(bytes, 0, bytes.length, 0);
      if (bytesRead !== before.size || sha(bytes.subarray(0, bytesRead)) !== DIRECTORY_NAME.exec(name)[1]
        || !sameStat(before, await handle.stat()) || !sameStat(before, await lstat(file))) throw fail('作者目录已变化或不可用');
      list = JSON.parse(bytes.subarray(0, bytesRead).toString('utf8'));
    } finally { await handle.close(); }
    if (!list || list.version !== 1 || Object.keys(list).length !== 2 || !Array.isArray(list.files)
      || list.files.length > AUTHOR_DIRECTORY_LIMITS.files || new Set(list.files).size !== list.files.length) throw fail('作者目录索引无效');
    let total = 0;
    for (const id of list.files) {
      if (!this.owns(projectId, key, id) || !spec.extensions.includes(path.extname(id))) throw fail('作者目录文件引用无效');
      total += (await this.resolve(projectId, key, id)).info.size;
      if (total > AUTHOR_DIRECTORY_LIMITS.bytes) throw fail('作者目录超过容量上限', 413);
    }
    if (this.#closed) throw fail('作者文件服务已关闭', 503);
    return list.files.slice();
  }
  createDirectory(projectId, key, spec, files) {
    const pending = this.#queue.catch(() => {}).then(async () => {
      if (this.#closed) throw fail('作者文件服务已关闭', 503);
      if (spec?.type !== 'directory' || !Array.isArray(files)) throw fail('作者目录请求无效');
      if (files.length > AUTHOR_DIRECTORY_LIMITS.files) throw fail('作者目录超过容量上限', 413);
      let total = 0; const ids = [...new Set(files)].sort();
      for (const id of ids) {
        if (!this.owns(projectId, key, id) || !spec.extensions.includes(path.extname(id))) throw fail('作者目录文件引用无效');
        total += (await this.resolve(projectId, key, id)).info.size;
        if (total > AUTHOR_DIRECTORY_LIMITS.bytes) throw fail('作者目录超过容量上限', 413);
      }
      const bytes = Buffer.from(JSON.stringify({ version: 1, files: ids }));
      if (bytes.length > AUTHOR_DIRECTORY_LIMITS.indexBytes) throw fail('作者目录超过容量上限', 413);
      const name = scope(projectId, key) + sha(bytes) + '.json', value = DIRECTORY_PREFIX + name;
      const root = await this.#root(true);
      try { await this.directory(projectId, key, value, spec); return value; }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      const inventory = await this.#inventory(root);
      if (inventory.count >= AUTHOR_FILE_LIMITS.files || inventory.total + bytes.length > AUTHOR_FILE_LIMITS.totalBytes) throw fail('作者文件库已满', 413);
      const temporary = path.join(root, randomUUID() + '.part'), target = path.join(root, 'd-' + name); let reserved = false;
      try {
        this.#abort.signal.throwIfAborted();
        await writeFile(temporary, bytes, { flag: 'wx', mode: 0o600 });
        this.#abort.signal.throwIfAborted();
        const writer = await open(target, 'wx', 0o600); await writer.close(); reserved = true;
        await rename(temporary, target); this.#abort.signal.throwIfAborted(); reserved = false;
        return value;
      } finally { await rm(temporary, { force: true }); if (reserved) await rm(target, { force: true }); }
    });
    this.#queue = pending; return pending;
  }
  import(projectId, key, spec, source, { filename, size }) {
    const pending = this.#queue.catch(() => {}).then(() => this.#import(projectId, key, spec, source, { filename, size }));
    this.#queue = pending; return pending;
  }
  async #import(projectId, key, spec, source, { filename, size }) {
    if (this.#closed) throw fail('作者文件服务已关闭', 503);
    if (!['file', 'directory'].includes(spec?.type) || typeof filename !== 'string' || !filename || filename.length > 255
      || /[\\/:\x00-\x1f]/.test(filename) || !spec.extensions.includes(path.extname(filename).toLowerCase())) throw fail('作者文件类型或文件名无效');
    if (!Number.isSafeInteger(size) || size <= 0 || size > AUTHOR_FILE_LIMITS.fileBytes) throw fail('作者文件为空或超过 64 MiB 上限', 413);
    const root = await this.#root(true);
    // Count crash-left .part files without deleting another process's work.
    const { total, count } = await this.#inventory(root);
    let extension = path.extname(filename).toLowerCase(); if (extension === '.jpeg') extension = '.jpg';
    const temporary = path.join(root, randomUUID() + '.part'), hash = createHash('sha256'); let received = 0;
    const meter = new Transform({ transform(chunk, _encoding, done) {
      received += chunk.length;
      if (received > size) { done(fail('文件传输长度超过声明大小', 413)); return; }
      hash.update(chunk); done(null, chunk);
    } });
    const signal = AbortSignal.any([this.#abort.signal, AbortSignal.timeout(AUTHOR_FILE_LIMITS.timeoutMs)]);
    let reserved = null;
    try {
      await pipeline(source, meter, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal });
      if (received !== size) throw fail('文件未完整传输');
      await validateContent(temporary, extension, size); signal.throwIfAborted();
      const name = scope(projectId, key) + hash.digest('hex') + extension, value = PREFIX + name;
      try {
        await this.resolve(projectId, key, value);
        return value;
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (count >= AUTHOR_FILE_LIMITS.files || total + size > AUTHOR_FILE_LIMITS.totalBytes) throw fail('作者文件库已满', 413);
      const target = path.join(root, name), writer = await open(target, 'wx', 0o600);
      await writer.close(); reserved = target;
      await rename(temporary, target); signal.throwIfAborted(); reserved = null;
      return value;
    } finally {
      await rm(temporary, { force: true });
      if (reserved) await rm(reserved, { force: true });
    }
  }
  async close() { this.#closed = true; this.#abort.abort(); await this.#queue.catch(() => {}); }
}
