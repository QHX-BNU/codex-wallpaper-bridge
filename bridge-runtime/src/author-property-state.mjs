import { validateAuthorPropertyPatch } from './author-properties.mjs';

export const AUTHOR_STATE_LIMITS = Object.freeze({ wallpapers: 128, properties: 256, bytes: 128 * 1024 });
const safeKey = (key, length) => typeof key === 'string' && key.length > 0 && key.length <= length
  && !['__proto__', 'prototype', 'constructor'].includes(key);
const primitive = (value) => typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1e9)
  || (typeof value === 'string' && value.length <= 1024 && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value));
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

/** Disk input is untrusted. Schemas/defaults/local paths are never persisted;
 * file selections are the same bounded primitive strings, using scoped IDs. */
export function normalizeSavedAuthorProperties(input) {
  const result = {};
  if (!record(input)) return result;
  let size = 2;
  for (const [id, raw] of Object.entries(input)) {
    if (Object.keys(result).length >= AUTHOR_STATE_LIMITS.wallpapers) break;
    if (!safeKey(id, 512) || !record(raw)) continue;
    const values = {};
    for (const [key, value] of Object.entries(raw).slice(0, AUTHOR_STATE_LIMITS.properties)) {
      if (safeKey(key, 128) && primitive(value)) values[key] = value;
    }
    if (!Object.keys(values).length) continue;
    const bytes = Buffer.byteLength(JSON.stringify({ [id]: values }), 'utf8');
    if (size + bytes > AUTHOR_STATE_LIMITS.bytes) continue;
    result[id] = values; size += bytes;
  }
  return result;
}

/** Updates fail on capacity/type errors instead of evicting another wallpaper. */
export function updateSavedAuthorProperties(current, id, values) {
  if (!safeKey(id, 512) || (values !== null && (!record(values)
    || Object.keys(values).length > AUTHOR_STATE_LIMITS.properties
    || Object.entries(values).some(([key, value]) => !safeKey(key, 128) || !primitive(value))))) {
    throw Object.assign(new Error('作者属性存储值无效'), { statusCode: 400 });
  }
  const next = normalizeSavedAuthorProperties(current);
  if (values === null || !Object.keys(values).length) delete next[id];
  else next[id] = { ...values };
  if (Object.keys(next).length > AUTHOR_STATE_LIMITS.wallpapers || Buffer.byteLength(JSON.stringify(next), 'utf8') > AUTHOR_STATE_LIMITS.bytes) {
    throw Object.assign(new Error('作者属性存储容量已满'), { statusCode: 413 });
  }
  return next;
}

/** Changed author manifests cannot replay removed keys or out-of-range old values. */
export function effectiveAuthorProperties(manifest, saved = {}) {
  const values = { ...manifest.values };
  let discarded = 0;
  for (const [key, value] of Object.entries(saved)) {
    const valid = validateAuthorPropertyPatch(manifest.schema, { [key]: value });
    if (valid) Object.assign(values, valid); else discarded++;
  }
  return { values, discarded };
}

/** Recheck persisted file IDs against the private owner, including on restart.
 * No filesystem dependency enters the browser-serialized schema validator. */
export async function effectiveAuthorFileProperties(manifest, saved, { projectId, authorFiles }) {
  const result = effectiveAuthorProperties(manifest, saved);
  for (const [key, value] of Object.entries(result.values)) {
    const spec = manifest.schema[key];
    if (!['file', 'directory'].includes(spec?.type) || !value.startsWith(spec.type === 'file' ? 'cwb-author-files/' : 'cwb-author-directories/')) continue;
    try {
      if (!authorFiles) throw Error();
      if (spec.type === 'directory') await authorFiles.directory(projectId, key, value, spec);
      else await authorFiles.resolve(projectId, key, value);
    }
    catch { result.values[key] = manifest.values[key]; result.discarded++; }
  }
  return result;
}
