/** The same validator is serialized into the isolated browser; no Node references. */
export function validateAuthorPropertyPatch(schema, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return null;
  const entries = Object.entries(patch);
  if (entries.length > 256) return null;
  const result = {};
  for (const [key, value] of entries) {
    if (['__proto__', 'prototype', 'constructor'].includes(key) || !Object.hasOwn(schema, key)) return null;
    const spec = schema[key];
    if (spec.type === 'bool') { if (typeof value !== 'boolean') return null; }
    else if (spec.type === 'slider') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value < spec.min || value > spec.max
        || (spec.integer && !Number.isInteger(value))) return null;
    } else if (spec.type === 'color') {
      if (typeof value !== 'string' || value.length > 96) return null;
      const components = value.trim().split(/\s+/);
      if (components.length !== 3 || components.some((n) => !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(n)
        || !Number.isFinite(Number(n)) || Number(n) < 0 || Number(n) > 1)) return null;
    } else if (spec.type === 'combo') {
      if (!spec.options.some((option) => option.value === value)) return null;
    } else if (spec.type === 'textinput') {
      if (typeof value !== 'string' || value.length > 1024 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) return null;
    } else if (spec.type === 'file' || spec.type === 'directory') {
      // A browser-serialized validator: only empty/default or managed IDs, not
      // arbitrary author paths, transient URLs, local paths or capabilities.
      if (typeof value !== 'string' || value.length > 512) return null;
      if (value !== '' && value !== spec.default) {
        if (spec.type === 'directory') {
          if (!/^cwb-author-directories\/[a-f0-9]{32}-[a-f0-9]{32}-[a-f0-9]{64}\.json$/.test(value)) return null;
        } else {
          const match = /^cwb-author-files\/[a-f0-9]{32}-[a-f0-9]{32}-[a-f0-9]{64}(\.[a-z0-9]+)$/.exec(value);
          if (!match || !spec.extensions?.includes(match[1])) return null;
        }
      }
    } else return null;
    result[key] = value;
  }
  return result;
}

export function normalizeAuthorProperties(properties) {
  const schema = {}, values = {};
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return { schema, values };
  const label = (text) => String(text ?? '').replace(/<[^>]*>/g, '').slice(0, 200);
  for (const [key, raw] of Object.entries(properties).slice(0, 256)) {
    if (!key || key.length > 128 || ['__proto__', 'prototype', 'constructor'].includes(key)
      || !raw || typeof raw !== 'object') continue;
    const spec = { type: raw.type, label: label(raw.text ?? key), default: raw.value };
    let value = raw.value;
    if (spec.type === 'slider') {
      if (![raw.min, raw.max].every((value) => typeof value === 'number' && Number.isFinite(value))
        || raw.min > raw.max || Math.abs(raw.min) > 1e9 || Math.abs(raw.max) > 1e9) continue;
      Object.assign(spec, { min: raw.min, max: raw.max, integer: raw.fraction !== true });
    } else if (spec.type === 'combo') {
      if (!Array.isArray(raw.options) || !raw.options.length || raw.options.length > 64) continue;
      spec.options = raw.options.filter((entry) => entry && ((typeof entry.value === 'string' && entry.value.length <= 128)
        || (typeof entry.value === 'number' && Number.isFinite(entry.value))))
        .map((entry) => ({ value: entry.value, label: label(entry.label) }));
    } else if (spec.type === 'file' || spec.type === 'directory') {
      const formats = { image: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'],
        video: ['.mp4', '.webm'], audio: ['.mp3', '.wav', '.ogg', '.flac'] };
      const filetype = raw.filetype ?? 'image';
      if (!Object.hasOwn(formats, filetype) && filetype !== 'any') continue;
      spec.filetype = filetype;
      spec.extensions = filetype === 'any' ? Object.values(formats).flat() : formats[filetype];
      if (spec.type === 'directory') {
        spec.mode = raw.mode ?? 'ondemand';
        if (!['ondemand', 'fetchall'].includes(spec.mode)) continue;
      }
      // Author defaults may be package-relative resources. Invalid author
      // paths are replaced with the empty default, never sent to a renderer.
      if (typeof value !== 'string' || value.length > 512 || /[\\\x00-\x1f:%?#]/.test(value)
        || value.startsWith('/') || value.startsWith('cwb-author-files/') || value.startsWith('cwb-author-directories/')
        || (value !== '' && (value.split('/').some(part => !part || part === '.' || part === '..')
          || (spec.type === 'file' && !spec.extensions.some(ext => value.toLowerCase().endsWith(ext)))))) value = '';
      spec.default = value;
    }
    const valid = validateAuthorPropertyPatch({ [key]: spec }, { [key]: value });
    if (!valid) continue;
    schema[key] = spec; values[key] = value;
  }
  return { schema, values };
}

/** Web authors need a URL; config and telemetry keep a stable relative ID.
 * The resource base is supplied by the private readonly server, never by an
 * author property. This function is also serialized into that browser. */
export function mapAuthorFileProperties(schema, values, resourceBase) {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key,
    ['file', 'directory'].includes(schema[key]?.type) && typeof value === 'string'
      && (value.startsWith('cwb-author-files/') || value.startsWith('cwb-author-directories/'))
      ? resourceBase + '/' + value : value]));
}

/** Readback is per field: one unsupported engine representation cannot erase all other controls. */
export function readAuthorProperties(schema, actual, validate) {
  const values = {};
  let rejected = 0;
  for (const [key, spec] of Object.entries(schema)) {
    if (!actual || !Object.hasOwn(actual, key)) { rejected++; continue; }
    let value = actual[key];
    if (spec.type === 'color' && value && typeof value === 'object' && !Array.isArray(value)
      && ['x', 'y', 'z'].every((axis) => typeof value[axis] === 'number' && Number.isFinite(value[axis]))) {
      value = [value.x, value.y, value.z];
    }
    if (spec.type === 'color' && Array.isArray(value) && value.length === 3
      && value.every((n) => typeof n === 'number' && Number.isFinite(n))) value = value.join(' ');
    const valid = validate({ [key]: spec }, { [key]: value });
    if (valid) values[key] = valid[key]; else rejected++;
  }
  return { values, rejected };
}
