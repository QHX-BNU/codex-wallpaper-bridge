import { createHash, randomUUID } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';

export const VIDEO_STREAM_LIMITS = Object.freeze({ moovBytes: 8 * 1024 * 1024, boxes: 8192,
  sessions: 2048, readers: 32, layoutBytes: 64 * 1024 * 1024, idleMs: 2 * 60 * 60 * 1000, chunkBytes: 64 * 1024 });
const fail = (message, statusCode = 409) => Object.assign(Error(message), { statusCode });
export function videoIdentity(info) {
  return [info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs].join(':');
}
const original = (size, reason) => ({ kind: 'original', size, reason, memoryBytes: 0,
  segments: [{ start: 0, length: size, offset: 0 }] });

function atom(buffer, start, end) {
  if (end - start < 8) throw Error('invalid_atom');
  let size = buffer.readUInt32BE(start), header = 8;
  const type = buffer.toString('latin1', start + 4, start + 8);
  if (size === 1) {
    if (end - start < 16) throw Error('invalid_atom');
    size = Number(buffer.readBigUInt64BE(start + 8)); header = 16;
  } else if (size === 0) size = end - start;
  if (!Number.isSafeInteger(size) || size < header || start + size > end) throw Error('invalid_atom');
  return { start, end: start + size, size, header, type };
}
async function readExact(handle, size, position) {
  const buffer = Buffer.alloc(size); let read = 0;
  while (read < size) {
    const { bytesRead } = await handle.read(buffer, read, size - read, position + read);
    if (!bytesRead) throw Error('truncated_atom'); read += bytesRead;
  }
  return buffer;
}

// Only relocatable, self-contained, non-fragmented MP4 is rewritten. No mdat
// is loaded or copied. Unknown offset-bearing formats keep their original bytes.
export async function faststartLayout(handle, size, { maxMoovBytes = VIDEO_STREAM_LIMITS.moovBytes } = {}) {
  if (!Number.isSafeInteger(size) || size < 8) return original(size, 'not_mp4');
  try {
    const top = []; let cursor = 0;
    while (cursor < size) {
      if (top.length >= VIDEO_STREAM_LIMITS.boxes || size - cursor < 8) throw Error('atom_limit');
      const head = await readExact(handle, Math.min(16, size - cursor), cursor);
      let length = head.readUInt32BE(0), header = 8;
      if (length === 1) { if (head.length < 16) throw Error('truncated_atom'); length = Number(head.readBigUInt64BE(8)); header = 16; }
      else if (length === 0) length = size - cursor;
      if (!Number.isSafeInteger(length) || length < header || length > size - cursor) throw Error('invalid_atom');
      top.push({ start: cursor, end: cursor + length, size: length, header, toEnd: head.readUInt32BE(0) === 0, type: head.toString('latin1', 4, 8) }); cursor += length;
    }
    if (top[0]?.type !== 'ftyp' || top.some(b => !['ftyp', 'moov', 'mdat', 'free', 'skip', 'wide'].includes(b.type))
      || top.filter(b => b.type === 'ftyp').length !== 1 || top.filter(b => b.type === 'moov').length !== 1) throw Error('unsupported_topology');
    const moov = top.find(b => b.type === 'moov'), mdats = top.filter(b => b.type === 'mdat');
    if (moov.toEnd) throw Error('zero_size_moov');
    if (!mdats.length || moov.start < mdats[0].start) return original(size, 'already_front');
    if (moov.size > Math.min(VIDEO_STREAM_LIMITS.moovBytes, maxMoovBytes)) throw Error('moov_limit');
    const insertion = top[0].end, buffer = await readExact(handle, moov.size, moov.start);
    let count = 0, tables = 0;
    const containers = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'dinf', 'udta', 'meta']);
    const leaves = new Set(['mvhd', 'tkhd', 'mdhd', 'hdlr', 'vmhd', 'smhd', 'nmhd', 'stts', 'ctts', 'stsc', 'stsz',
      'stz2', 'stss', 'stsh', 'sdtp', 'stdp', 'sgpd', 'sbgp', 'edts', 'elst', 'ilst', 'free', 'skip', 'iods']);
    const relocate = value => {
      if (!mdats.some(b => value >= b.start + b.header && value < b.end)) throw Error('external_chunk');
      return value >= insertion && value < moov.start ? value + moov.size : value;
    };
    const walk = (start, end, depth = 0) => {
      if (depth > 12) throw Error('atom_depth');
      while (start < end) {
        if (++count > VIDEO_STREAM_LIMITS.boxes) throw Error('atom_limit');
        const b = atom(buffer, start, end), payload = b.start + b.header;
        if (containers.has(b.type)) walk(payload + (b.type === 'meta' ? 4 : 0), b.end, depth + 1);
        else if (b.type === 'stco' || b.type === 'co64') {
          if (b.end - payload < 8 || buffer.readUInt32BE(payload) !== 0) throw Error('chunk_table');
          const entries = buffer.readUInt32BE(payload + 4), width = b.type === 'stco' ? 4 : 8;
          if (entries * width !== b.end - payload - 8) throw Error('chunk_table');
          tables++;
          for (let p = payload + 8; p < b.end; p += width) {
            const value = width === 4 ? buffer.readUInt32BE(p) : Number(buffer.readBigUInt64BE(p));
            if (!Number.isSafeInteger(value)) throw Error('chunk_overflow');
            const moved = relocate(value);
            if (width === 4) { if (moved > 0xffffffff) throw Error('stco_overflow'); buffer.writeUInt32BE(moved, p); }
            else buffer.writeBigUInt64BE(BigInt(moved), p);
          }
        } else if (b.type === 'dref') {
          if (b.end - payload < 8 || buffer.readUInt32BE(payload) !== 0) throw Error('external_reference');
          let p = payload + 8, refs = 0;
          while (p < b.end) {
            const ref = atom(buffer, p, b.end);
            if (ref.type !== 'url ' || ref.size !== ref.header + 4 || buffer.readUInt32BE(p + ref.header) !== 1) throw Error('external_reference');
            refs++; p = ref.end;
          }
          if (refs !== buffer.readUInt32BE(payload + 4)) throw Error('external_reference');
        } else if (b.type === 'stsd') {
          if (b.end - payload < 8 || buffer.readUInt32BE(payload) !== 0) throw Error('sample_format');
          let p = payload + 8, entries = 0;
          while (p < b.end) {
            const sample = atom(buffer, p, b.end);
            if (!['avc1', 'avc3', 'hvc1', 'hev1', 'vp09', 'av01', 'mp4a', 'Opus', 'ac-3', 'ec-3'].includes(sample.type)
              || sample.size < sample.header + 8 || buffer.readUInt16BE(p + sample.header + 6) !== 1) throw Error('sample_format');
            entries++; p = sample.end;
          }
          if (entries !== buffer.readUInt32BE(payload + 4)) throw Error('sample_format');
        } else if (!leaves.has(b.type)) throw Error('unsupported_moov');
        start = b.end;
      }
    };
    walk(0, buffer.length);
    if (!tables) throw Error('no_chunk_table');
    const segments = [{ start: 0, length: insertion, offset: 0 }, { start: insertion, length: moov.size, buffer },
      { start: insertion + moov.size, length: moov.start - insertion, offset: insertion },
      { start: moov.end, length: size - moov.end, offset: moov.end }].filter(s => s.length);
    return { kind: 'faststart', size, memoryBytes: buffer.length, segments };
  } catch { return original(size, 'unsupported_or_invalid'); }
}

export async function* layoutChunks(handle, layout, start = 0, end = layout.size - 1) {
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end >= layout.size || start > end) throw fail('video_range_invalid', 416);
  for (const segment of layout.segments) {
    const lo = Math.max(start, segment.start), hi = Math.min(end, segment.start + segment.length - 1);
    for (let position = lo; position <= hi;) {
      const length = Math.min(VIDEO_STREAM_LIMITS.chunkBytes, hi - position + 1);
      if (segment.buffer) yield segment.buffer.subarray(position - segment.start, position - segment.start + length);
      else yield await readExact(handle, length, segment.offset + position - segment.start);
      position += length;
    }
  }
}

export class VideoVersions {
  #sessions = new Map(); #signatures = new Map(); #layoutBytes = 0; #closed = false; #prepares = Promise.resolve(); #readers = 0;
  constructor({ maxSessions = VIDEO_STREAM_LIMITS.sessions, now = Date.now } = {}) { this.maxSessions = maxSessions; this.now = now; }
  async pin(id, file, { faststart = true } = {}) {
    if (this.#closed) throw fail('video_closed');
    const resolved = await realpath(file), info = await stat(resolved);
    if (!info.isFile()) throw fail('video_unavailable', 404);
    const identity = videoIdentity(info), signature = createHash('sha256').update(JSON.stringify([id, resolved, identity, faststart])).digest('hex');
    const current = this.#signatures.get(signature);
    if (current) { this.#sessions.get(current).used = this.now(); return current; }
    for (const [token, value] of this.#sessions) if (this.now() - value.used > VIDEO_STREAM_LIMITS.idleMs && !value.preparing) {
      this.#layoutBytes -= value.layout?.memoryBytes ?? 0; this.#sessions.delete(token); this.#signatures.delete(value.signature);
    }
    if (this.#sessions.size >= this.maxSessions) throw fail('video_version_capacity', 503);
    // Never reuse an expired URL, even for identical stat/flags. A fresh lazy
    // layout might choose a different bounded-memory fallback after eviction.
    const key = createHash('sha256').update(`${signature}:${randomUUID()}`).digest('hex');
    this.#signatures.set(signature, key);
    this.#sessions.set(key, { id, signature, file: resolved, identity, size: info.size, faststart, used: this.now(), layout: null, preparing: null });
    return key;
  }
  async open(id, version) {
    const value = this.#sessions.get(version);
    if (this.#closed || !value || value.id !== id) throw fail('video_version_unavailable', 410);
    if (this.#readers >= VIDEO_STREAM_LIMITS.readers) throw fail('video_reader_capacity', 503);
    value.used = this.now();
    this.#readers++;
    let handle;
    try { handle = await open(value.file, 'r'); } catch (error) { this.#readers--; throw error; }
    handle.once('close', () => { this.#readers--; });
    try {
      if (videoIdentity(await handle.stat()) !== value.identity) throw fail('video_source_changed');
      if (!value.layout) {
        if (!value.preparing) {
          // Serialize parsing across files: transient moov memory is <= 8 MiB,
          // not 8 MiB multiplied by concurrent HTTP clients.
          value.preparing = this.#prepares.then(async () => {
            if (this.#closed) throw fail('video_closed');
            const layout = value.faststart ? await faststartLayout(handle, value.size) : original(value.size, 'disabled');
            if (this.#closed) throw fail('video_closed');
            if (this.#layoutBytes + layout.memoryBytes > VIDEO_STREAM_LIMITS.layoutBytes) value.layout = original(value.size, 'memory_limit');
            else { value.layout = layout; this.#layoutBytes += layout.memoryBytes; }
          }).finally(() => { value.preparing = null; });
          this.#prepares = value.preparing.catch(() => {});
        }
        await value.preparing;
      }
      if (this.#closed) throw fail('video_closed');
      if (videoIdentity(await handle.stat()) !== value.identity) throw fail('video_source_changed');
      return { handle, layout: value.layout, path: value.file, version };
    } catch (error) { await handle.close(); throw error; }
  }
  close() { this.#closed = true; this.#sessions.clear(); this.#signatures.clear(); this.#layoutBytes = 0; }
}
