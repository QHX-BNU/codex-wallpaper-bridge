import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, mkdir, open, opendir, realpath, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { videoIdentity } from './video-stream.mjs';

export const CACHE_LIMITS = Object.freeze({ files: 4096, scannedFiles: 16384, journalBytes: 1024 * 1024, chunkBytes: 256 * 1024, jobs: 24 });
const marker = '.cwb-cache.json';
const known = { video: /^[a-f0-9]{64}\.(mp4|json)$/, thumbnails: /^[a-f0-9]{64}\.(jpg|png)$/ };
const fail = (message, statusCode = 409) => Object.assign(Error(message), { statusCode });
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const inside = (a, b) => { const rel = path.relative(a, b); return !rel || (!path.isAbsolute(rel) && rel !== '..' && !rel.startsWith(`..${path.sep}`)); };
const validPath = p => typeof p === 'string' && p.length <= 4096 && !p.includes('\0') && path.isAbsolute(p);
function knownFile(relative) {
  const parts = relative.split('/'); return parts.length === 2 && known[parts[0]]?.test(parts[1]);
}
export async function readCacheJson(file, limit) {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink() || info.size > limit) throw fail('cache_invalid_metadata');
  const handle = await open(file, 'r');
  try {
    if ((await handle.stat()).size > limit) throw fail('cache_invalid_metadata');
    const buffer = Buffer.alloc(limit + 1); let size = 0;
    while (size <= limit) { const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size); if (!bytesRead) break; size += bytesRead; }
    if (size > limit) throw fail('cache_invalid_metadata');
    return JSON.parse(buffer.subarray(0, size).toString('utf8'));
  } finally { await handle.close(); }
}
export async function digestFile(file, signal) {
  const handle = await open(file, 'r');
  try {
    const hash = createHash('sha256'), buffer = Buffer.alloc(CACHE_LIMITS.chunkBytes);
    for (let position = 0;;) {
      signal?.throwIfAborted(); const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break; hash.update(buffer.subarray(0, bytesRead)); position += bytesRead;
    }
    return hash.digest('hex');
  } finally { await handle.close(); }
}

export class ManagedCache {
  #store; #env; #owner; #default; #journalPath; #initialized = null;
  #active = null; #writers = 0; #jobs = new Map(); #task = Promise.resolve(); #recovery = null; #closed = false;
  constructor({ configStore, env = process.env, beforeCopy = null } = {}) {
    if (!configStore?.filePath) throw TypeError('cache_requires_config');
    this.#store = configStore; this.#env = { CWB_CACHE_ROOT: env.CWB_CACHE_ROOT };
    this.#default = path.join(path.dirname(configStore.filePath), 'cache');
    this.#journalPath = path.join(path.dirname(configStore.filePath), 'cache-migration.json');
    this.#owner = createHash('sha256').update(path.resolve(configStore.filePath).toLowerCase()).digest('hex');
    this.beforeCopy = beforeCopy;
  }
  get busy() { return Boolean(this.#active || this.#writers); }
  #actual() {
    const override = this.#env.CWB_CACHE_ROOT;
    if (override && !validPath(override)) throw fail('cache_environment_invalid');
    return path.resolve(override || this.#store.get().cache.directory || this.#default);
  }
  status() {
    return { actualDirectory: this.#actual(), configuredDirectory: this.#store.get().cache.directory,
      environmentOverride: Boolean(this.#env.CWB_CACHE_ROOT), busy: this.busy,
      job: this.#active ? this.job(this.#active.id) : [...this.#jobs.values()].at(-1) ? this.job([...this.#jobs.keys()].at(-1)) : null,
      recovery: this.#recovery ? { id: this.#recovery.id, phase: this.#recovery.phase, resumable: this.#recovery.phase !== 'completed' } : null,
      sourceRetained: true, knownDirectories: Object.keys(known) };
  }
  init() {
    if (!this.#initialized) this.#initialized = (async () => {
      await this.#root(this.#actual(), true);
      try {
        const value = await readCacheJson(this.#journalPath, CACHE_LIMITS.journalBytes);
        if (value.schemaVersion !== 1 || value.owner !== this.#owner || !/^[a-f0-9-]{36}$/.test(value.id) || !validPath(value.source) || !validPath(value.destination)
          || inside(value.source, value.destination) || inside(value.destination, value.source)
          || path.basename(value.destination) !== 'CodexWallpaperBridge-cache'
          || !['copying', 'committing', 'completed', 'cancelled', 'failed'].includes(value.phase)
          || !Array.isArray(value.entries) || value.entries.length > CACHE_LIMITS.files
          || value.entries.some(e => !knownFile(e.relative) || !/^[a-f0-9]{64}$/.test(e.hash)
            || !Number.isSafeInteger(e.size) || e.size < 0) || new Set(value.entries.map(e => e.relative)).size !== value.entries.length) throw fail('cache_invalid_journal');
        if (!['completed', 'cancelled'].includes(value.phase)) this.#recovery = value;
      } catch (error) { if (error.code !== 'ENOENT') throw fail('cache_invalid_journal'); }
    })();
    return this.#initialized;
  }
  async #root(directory, create = false) {
    if (!validPath(directory)) throw fail('cache_invalid_directory');
    const resolved = path.resolve(directory);
    if (create) await mkdir(resolved, { recursive: true });
    const info = await lstat(resolved), actual = await realpath(resolved);
    if (!info.isDirectory() || info.isSymbolicLink() || !same(resolved, actual)) throw fail('cache_unsafe_directory');
    const file = path.join(actual, marker);
    let data;
    try { data = await readCacheJson(file, 4096); }
    catch (error) {
      if (error.code !== 'ENOENT' || !create) throw fail('cache_unowned_directory');
      const listing = await opendir(actual);
      try { if (await listing.read()) throw fail('cache_unowned_directory'); } finally { await listing.close(); }
      await writeFile(file, JSON.stringify({ schemaVersion: 1, owner: this.#owner }), { flag: 'wx', mode: 0o600 });
      data = { schemaVersion: 1, owner: this.#owner };
    }
    if (data.schemaVersion !== 1 || data.owner !== this.#owner) throw fail('cache_unowned_directory');
    return actual;
  }
  async directory(name) {
    if (!Object.hasOwn(known, name)) throw fail('cache_unknown_directory', 400);
    await this.init(); const root = await this.#root(this.#actual());
    const target = path.join(root, name); await mkdir(target, { recursive: true });
    const info = await lstat(target);
    if (info.isSymbolicLink() || !info.isDirectory() || !same(target, await realpath(target))) throw fail('cache_unsafe_directory');
    return target;
  }
  async resolve(relative) {
    if (!knownFile(relative)) throw fail('cache_unknown_file', 400);
    const [name, file] = relative.split('/'), dir = await this.directory(name), target = path.join(dir, file);
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink() || !same(target, await realpath(target))) throw fail('cache_unsafe_file');
    return target;
  }
  acquireWriter() {
    if (this.#closed || this.#active) throw fail('cache_busy');
    this.#writers++; let released = false;
    return () => { if (!released) { released = true; this.#writers--; } };
  }
  job(id) {
    const job = this.#jobs.get(id); if (!job) throw fail('cache_job_missing', 404);
    return { id: job.id, kind: 'migrate', status: job.status, bytes: job.bytes, totalBytes: job.totalBytes,
      progress: job.status === 'completed' ? 1 : Math.min(.99, job.totalBytes ? job.bytes / job.totalBytes : 0), error: job.error, result: job.result };
  }
  #new(parent, id = randomUUID()) {
    if (this.#closed || this.busy) throw fail('cache_busy');
    if (this.#env.CWB_CACHE_ROOT) throw fail('cache_environment_override');
    while (this.#jobs.size >= CACHE_LIMITS.jobs) this.#jobs.delete(this.#jobs.keys().next().value);
    const job = { id, parent, status: 'queued', bytes: 0, totalBytes: 0, error: null, result: null, controller: new AbortController() };
    this.#jobs.set(id, job); this.#active = job; return job;
  }
  async beginMigration(parent) {
    if (!validPath(parent)) throw fail('cache_invalid_directory', 400);
    const job = this.#new(parent);
    this.#task = this.#run(job, null); return this.job(job.id);
  }
  cancel(id) {
    const job = this.#jobs.get(id); if (!job) throw fail('cache_job_missing', 404);
    if (['queued', 'running'].includes(job.status)) { job.status = 'cancelling'; job.controller.abort(); }
    return this.job(id);
  }
  retry(id) {
    const old = this.#jobs.get(id);
    if (!old || !['failed', 'cancelled'].includes(old.status)) throw fail('cache_retry_unavailable');
    return this.beginMigration(old.parent);
  }
  async resume() {
    await this.init(); if (!this.#recovery) throw fail('cache_recovery_unavailable');
    if (!same(this.#actual(), this.#recovery.source) && !same(this.#actual(), this.#recovery.destination)) throw fail('cache_recovery_state_changed');
    const journal = this.#recovery, job = this.#new(path.dirname(journal.destination), journal.id);
    this.#task = this.#run(job, journal); return this.job(job.id);
  }
  async #writeJournal(value) {
    const temp = `${this.#journalPath}.${value.id}.tmp`;
    try { await writeFile(temp, JSON.stringify(value), { mode: 0o600, flag: 'wx' }); await rename(temp, this.#journalPath); }
    finally { await rm(temp, { force: true }); }
  }
  async #snapshot(root, signal) {
    const entries = []; let scanned = 0;
    for (const [name, pattern] of Object.entries(known)) {
      const dir = path.join(root, name); let info;
      try { info = await lstat(dir); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      if (info.isSymbolicLink() || !info.isDirectory() || !same(dir, await realpath(dir))) throw fail('cache_unsafe_directory');
      for await (const child of await opendir(dir)) {
        if (++scanned > CACHE_LIMITS.scannedFiles) throw fail('cache_scan_limit');
        const file = child.name;
        signal.throwIfAborted(); if (!pattern.test(file)) continue;
        if (entries.length >= CACHE_LIMITS.files) throw fail('cache_file_limit');
        const target = path.join(dir, file), info = await lstat(target);
        if (info.isSymbolicLink() || !info.isFile()) throw fail('cache_unsafe_file');
        const hash = await digestFile(target, signal);
        if (videoIdentity(info) !== videoIdentity(await lstat(target))) throw fail('cache_source_changed');
        entries.push({ relative: `${name}/${file}`, size: info.size, hash });
      }
    }
    return entries;
  }
  async #copy(source, target, job, entry) {
    const signal = job.controller.signal, from = await open(source, 'r'); let to;
    try {
      to = await open(target, 'wx', 0o600);
      const hash = createHash('sha256'), buffer = Buffer.alloc(CACHE_LIMITS.chunkBytes);
      let position = 0;
      for (;;) {
        signal.throwIfAborted(); const { bytesRead } = await from.read(buffer, 0, buffer.length, position);
        if (!bytesRead) break;
        let written = 0; while (written < bytesRead) {
          const result = await to.write(buffer, written, bytesRead - written, position + written);
          if (!result.bytesWritten) throw fail('cache_copy_failed'); written += result.bytesWritten;
        }
        hash.update(buffer.subarray(0, bytesRead)); position += bytesRead; job.bytes += bytesRead;
        if (position > entry.size) throw fail('cache_source_changed');
      }
      if (position !== entry.size || hash.digest('hex') !== entry.hash) throw fail('cache_source_changed');
      await to.sync();
    } finally { await Promise.all([from.close(), to?.close()]); }
  }
  async #run(job, resume) {
    let journal = null, temporary = null;
    try {
      await this.init(); const signal = job.controller.signal; signal.throwIfAborted(); job.status = 'running';
      const source = await this.#root(resume?.source ?? this.#actual());
      const parent = await realpath(job.parent), destination = path.join(parent, 'CodexWallpaperBridge-cache');
      if (same(source, destination)) { job.result = { unchanged: true, sourceRetained: true, copied: 0 }; job.status = 'completed'; return; }
      if (inside(source, destination) || inside(destination, source)) throw fail('cache_nested_directory');
      await this.#root(destination, true);
      const entries = resume?.entries ?? await this.#snapshot(source, signal);
      journal = { schemaVersion: 1, owner: this.#owner, id: job.id, source, destination, entries, phase: 'copying' };
      job.totalBytes = entries.reduce((n, entry) => n + entry.size, 0);
      if (!Number.isSafeInteger(job.totalBytes)) throw fail('cache_size_limit');
      await this.#writeJournal(journal); this.#recovery = journal;
      for (const entry of entries) {
        await this.beforeCopy?.(entry); signal.throwIfAborted();
        const [name, file] = entry.relative.split('/'), dir = path.join(destination, name);
        await mkdir(dir, { recursive: true });
        if ((await lstat(dir)).isSymbolicLink() || !same(dir, await realpath(dir))) throw fail('cache_unsafe_directory');
        const original = path.join(source, name, file), originalInfo = await lstat(original);
        if (!originalInfo.isFile() || originalInfo.isSymbolicLink() || !same(original, await realpath(original))) throw fail('cache_unsafe_file');
        const target = path.join(dir, file);
        try {
          const info = await lstat(target);
          if (!info.isFile() || info.isSymbolicLink() || info.size !== entry.size || await digestFile(target, signal) !== entry.hash) throw fail('cache_destination_conflict');
          if (await digestFile(original, signal) !== entry.hash) throw fail('cache_source_changed');
          job.bytes += entry.size; continue;
        } catch (error) { if (error.code !== 'ENOENT') throw error; }
        temporary = `${target}.${job.id}.part`;
        try { const info = await lstat(temporary); if (!info.isFile() || info.isSymbolicLink()) throw fail('cache_unsafe_file'); await rm(temporary); }
        catch (error) { if (error.code !== 'ENOENT') throw error; }
        await this.#copy(original, temporary, job, entry); signal.throwIfAborted();
        if (videoIdentity(originalInfo) !== videoIdentity(await lstat(original))) throw fail('cache_source_changed');
        if (await digestFile(temporary, signal) !== entry.hash) throw fail('cache_copy_failed');
        await link(temporary, target); // same destination volume; atomic, never overwrite existing bytes
        await rm(temporary); temporary = null;
      }
      signal.throwIfAborted(); job.status = 'committing'; journal.phase = 'committing'; await this.#writeJournal(journal);
      await this.#store.set({ cache: { directory: destination } });
      job.result = { sourceRetained: true, copied: entries.length }; job.status = 'completed'; this.#recovery = null;
      journal.phase = 'completed'; await this.#writeJournal(journal).catch(() => { job.result.journalCleanupPending = true; });
    } catch (error) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = job.status === 'cancelled' ? null : /^cache_[a-z_]+$/.test(error.message) ? error.message : 'cache_migration_failed';
      if (journal) { journal.phase = job.status; await this.#writeJournal(journal).catch(() => {}); this.#recovery = job.status === 'failed' ? journal : null; }
    } finally {
      if (temporary) await rm(temporary, { force: true }).catch(() => {});
      if (this.#active === job) this.#active = null;
    }
  }
  wait() { return this.#task; }
  async close() { this.#closed = true; if (this.#active) this.cancel(this.#active.id); await this.#task; }
}
