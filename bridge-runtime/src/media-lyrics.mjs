import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, rm, lstat } from 'node:fs/promises';
import path from 'node:path';

export function parseLrc(text) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 131072) throw Error('lyrics_limit');
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  if (lines.length > 4000) throw Error('lyrics_limit');
  const offset = Number(/\[offset:([+-]?\d{1,6})\]/i.exec(text)?.[1] || 0) / 1000;
  const rows = [];
  for (const line of lines) {
    const matches = [...line.matchAll(/\[(\d{1,3}):([0-5]\d)(?:[.:](\d{1,3}))?\]/g)];
    const words = line.replace(/\[[^\]]*\]/g, '').trim().slice(0, 512);
    for (const match of matches) {
      const time = Number(match[1]) * 60 + Number(match[2]) + Number('0.' + (match[3] || '0')) + offset;
      if (time >= 0 && time <= 86400) rows.push({ time, text: words });
      if (rows.length > 2000) throw Error('lyrics_limit');
    }
  }
  return rows.sort((a, b) => a.time - b.time);
}
export function lyricAt(rows, position) {
  let lo = 0, hi = rows.length;
  while (lo < hi) { const mid = (lo + hi) >>> 1; if (rows[mid].time <= position) lo = mid + 1; else hi = mid; }
  return { text: rows[lo - 1]?.text || '', next: rows[lo]?.text || '', index: lo - 1 };
}
export function lyricKey(track) {
  return createHash('sha256').update(JSON.stringify([track.title, track.artist, track.album, Math.round(track.duration)])).digest('hex');
}
/** Local filenames are content-independent SHA keys, never titles/author paths. */
export class LyricsStore {
  #root; #fetch; #cache = new Map(); #abort = null; #closed = false;
  #generation = 0; #lookupKey = ''; #writes = Promise.resolve();
  constructor({ root = null, fetchLyrics = globalThis.fetch } = {}) { this.#root = root && path.resolve(root); this.#fetch = fetchLyrics; }
  cancel() { this.#generation++; this.#abort?.abort(); this.#abort = null; }
  async #safeRoot() {
    if (!this.#root) return;
    await mkdir(this.#root, { recursive: true });
    if ((await lstat(this.#root)).isSymbolicLink()) throw Error('lyrics_directory_invalid');
  }
  #remember(key, rows) { this.#cache.delete(key); this.#cache.set(key, rows); if (this.#cache.size > 32) this.#cache.delete(this.#cache.keys().next().value); }
  async set(track, lrc) {
    if (this.#closed || !this.#root) throw Error('lyrics_unavailable');
    const rows = parseLrc(lrc), key = lyricKey(track);
    if (key === this.#lookupKey) this.cancel();
    // Preserve invocation order on disk, not just in the current preview.
    const saving = this.#writes.then(async () => {
      if (this.#closed) throw Error('lyrics_unavailable');
      await this.#safeRoot();
      if (this.#closed) throw Error('lyrics_unavailable');
      const file = path.join(this.#root, key + '.lrc'), temporary = file + '.' + randomUUID() + '.tmp';
      try { await writeFile(temporary, lrc, { encoding: 'utf8', flag: 'wx' }); await rename(temporary, file); }
      finally { await rm(temporary, { force: true }).catch(() => {}); }
      this.#cache.delete(key); return rows;
    });
    this.#writes = saving.catch(() => {}); return saving;
  }
  async get(track, { online = false } = {}) {
    return (await this.lookup(track, { online })).rows;
  }
  async lookup(track, { online = false } = {}) {
    const result = (state, rows = [], source = 'none') => ({ state, rows, source });
    if (this.#closed) return result('cancelled');
    this.cancel(); const generation = this.#generation;
    const stale = () => this.#closed || generation !== this.#generation;
    if (!track?.title) return result(online ? 'not_found' : 'off');
    const key = lyricKey(track); this.#lookupKey = key;
    // Always inspect local data before online/cache, including a later import.
    if (this.#root) {
      await this.#safeRoot(); const file = path.join(this.#root, key + '.lrc');
      try {
        const info = await lstat(file);
        if (!info.isFile() || info.isSymbolicLink() || info.size > 131072) throw Error('lyrics_limit');
        const rows = parseLrc(await readFile(file, 'utf8'));
        return stale() ? result('cancelled') : result('ready', rows, 'local');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (stale()) return result('cancelled');
    if (!online) return result('off'); // never serve an online-only cache after opt-out
    if (this.#cache.has(key)) return result('ready', this.#cache.get(key), 'online');
    const controller = new AbortController(); this.#abort = controller;
    const timer = setTimeout(() => controller.abort(), 4000);
    try {
      const url = new URL('https://lrclib.net/api/get');
      url.searchParams.set('track_name', track.title); url.searchParams.set('artist_name', track.artist || '');
      if (track.album) url.searchParams.set('album_name', track.album);
      if (Number.isFinite(track.duration) && track.duration > 0) url.searchParams.set('duration', String(Math.round(track.duration)));
      const response = await this.#fetch(url, { signal: controller.signal, redirect: 'error' });
      if (stale() || !response.ok) {
        // Rejected metadata/error responses must not retain an unread socket.
        try { await response.body?.cancel(); } catch {}
        return result(stale() ? 'cancelled' : response.status === 404 ? 'not_found' : 'unavailable');
      }
      const reader = response.body.getReader(); let bytes = 0, parts = [];
      try { while (true) { const { done, value } = await reader.read(); if (done) break; bytes += value.length; if (bytes > 262144) throw Error('lyrics_limit'); parts.push(Buffer.from(value)); } }
      finally { await reader.cancel().catch(() => {}); }
      if (stale()) return result('cancelled');
      if (controller.signal.aborted || this.#abort !== controller) return result('unavailable');
      const body = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const rows = parseLrc(body.syncedLyrics || '');
      if (!rows.length) return result('not_found');
      this.#remember(key, rows); return result('ready', rows, 'online');
    } catch { return result(stale() ? 'cancelled' : 'unavailable'); }
    finally { clearTimeout(timer); if (this.#abort === controller) this.#abort = null; }
  }
  close() { this.#closed = true; this.cancel(); this.#cache.clear(); }
}
