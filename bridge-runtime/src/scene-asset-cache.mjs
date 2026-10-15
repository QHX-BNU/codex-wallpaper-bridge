import { open, stat } from 'node:fs/promises';

export const SCENE_CACHE_LIMITS = Object.freeze({ bytes: 128 * 1024 ** 2, fileBytes: 32 * 1024 ** 2, entries: 128 });

export function sceneAssetStamp(entry) {
  const info = entry.info;
  return JSON.stringify([entry.path, info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs]);
}

/** Raw bytes only, after the caller's realpath/containment check. Reservations
 * count while reading; concurrent targets share one read. Large files stream.
 * Dynamic HTML, descriptors, tokens and author execution are never cached. */
export function createSceneAssetCache(limits = SCENE_CACHE_LIMITS) {
  const entries = new Map();
  let bytes = 0;
  const remove = (key, entry) => {
    if (entries.get(key) === entry) { entries.delete(key); bytes -= entry.size; }
  };
  async function read(entry) {
    const size = entry.info.size;
    if (!Number.isSafeInteger(size) || size < 0 || size > limits.fileBytes || size > limits.bytes) return null;
    const key = entry.path, stamp = sceneAssetStamp(entry);
    const existing = entries.get(key);
    if (existing?.stamp === stamp && !existing.discard) {
      entries.delete(key); entries.set(key, existing);
      return existing.loading;
    }
    if (existing && !existing.ready) return null;
    if (existing) remove(key, existing);
    for (const [oldKey, old] of entries) {
      if (bytes + size <= limits.bytes && entries.size < limits.entries) break;
      // An in-flight read cannot be reclaimed yet. Do not exceed the budget.
      if (old.ready) remove(oldKey, old);
    }
    if (bytes + size > limits.bytes || entries.size >= limits.entries) return null;
    const record = { stamp, size, ready: false, discard: false, loading: null };
    bytes += size; entries.set(key, record);
    record.loading = (async () => {
      const file = await open(entry.path, 'r');
      try {
        const initial = await file.stat();
        if (!initial.isFile() || sceneAssetStamp({ path: entry.path, info: initial }) !== stamp) throw Error('Scene asset changed while reading');
        // Allocate only the reserved size. readFile() can grow without bound if
        // an author replaces/extends the file after the caller's initial stat.
        const value = Buffer.allocUnsafe(size);
        let offset = 0;
        while (offset < size) {
          const result = await file.read(value, offset, size - offset, offset);
          if (!result.bytesRead) throw Error('Scene asset changed while reading');
          offset += result.bytesRead;
        }
        const extra = await file.read(Buffer.alloc(1), 0, 1, size);
        const current = await file.stat(), named = await stat(entry.path);
        if (extra.bytesRead || !named.isFile() || sceneAssetStamp({ path: entry.path, info: current }) !== stamp
          || sceneAssetStamp({ path: entry.path, info: named }) !== stamp) throw Error('Scene asset changed while reading');
        record.ready = true;
        if (record.discard) remove(key, record);
        return value;
      } finally {
        await file.close();
      }
    })().catch((error) => { remove(key, record); throw error; });
    return record.loading;
  }
  return { read, clear() {
    for (const [key, entry] of entries) {
      if (entry.ready) remove(key, entry); else entry.discard = true;
    }
  }, stats: () => ({ bytes, entries: entries.size }) };
}

export const sceneAssetCache = createSceneAssetCache();
