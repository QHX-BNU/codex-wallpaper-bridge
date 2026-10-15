import { createHash } from 'node:crypto';
import { open, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_PACKAGE = 512 * 1024 ** 2;
const MAX_TABLE = 8 * 1024 ** 2;
const MAX_JSON = 8 * 1024 ** 2;
const MAX_METADATA = 32 * 1024 ** 2;
const MAX_ENTRIES = 20000;
const utf8 = new TextDecoder('utf-8', { fatal: true });
const inside = (root, file) => {
  const relative = path.relative(root, file);
  return relative && !path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`);
};
const fail = (reason) => { throw Object.assign(new Error(reason), { reason }); };
async function asset(root, name, limit) {
  try {
    const file = await realpath(path.join(root, name));
    if (!inside(root, file)) fail('scene_path');
    const info = await stat(file);
    if (!info.isFile() || info.size > limit) fail('scene_size');
    return { file, info };
  } catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
async function bytes(handle, offset, length) {
  const result = Buffer.alloc(length);
  let cursor = 0;
  while (cursor < length) {
    const read = await handle.read(result, cursor, length - cursor, offset + cursor);
    if (!read.bytesRead) fail('scene_truncated');
    cursor += read.bytesRead;
  }
  return result;
}
async function jsonFile(entry, limit = MAX_JSON) {
  if (!entry || entry.info.size > limit) fail('scene_manifest');
  const handle = await open(entry.file, 'r');
  try { return json(await bytes(handle, 0, entry.info.size)); } finally { await handle.close(); }
}
function json(data) {
  try { return JSON.parse(utf8.decode(data).replace(/^\uFEFF/, '')); }
  catch { fail('scene_json'); }
}
function parseTable(table, size) {
  if (table.length < 16) fail('scene_package');
  const length = table.readUInt32LE(0);
  if (length < 4 || length > 16 || 8 + length > table.length) fail('scene_package');
  if (!/^PKGV\d{1,12}$/.test(utf8.decode(table.subarray(4, 4 + length)))) fail('scene_package');
  const count = table.readUInt32LE(4 + length);
  if (!count || count > MAX_ENTRIES) fail('scene_count');
  const entries = [], names = new Set();
  let cursor = 8 + length;
  for (let i = 0; i < count; i++) {
    if (cursor + 4 > table.length) fail('scene_table');
    const n = table.readUInt32LE(cursor); cursor += 4;
    if (!n || n > 2048 || cursor + n + 8 > table.length) fail('scene_table');
    const name = utf8.decode(table.subarray(cursor, cursor + n)); cursor += n;
    if (/[\\\0:\x00-\x1f]/.test(name) || name.startsWith('/')
      || name.split('/').some((part) => !part || part === '.' || part === '..') || names.has(name.toLowerCase())) fail('scene_path');
    names.add(name.toLowerCase());
    entries.push({ name, offset: table.readUInt32LE(cursor), size: table.readUInt32LE(cursor + 4) }); cursor += 8;
  }
  for (const entry of entries) if (cursor + entry.offset + entry.size > size) fail('scene_extent');
  const extents = entries.filter((e) => e.size).toSorted((a, b) => a.offset - b.offset);
  for (let i = 1; i < extents.length; i++) if (extents[i].offset < extents[i - 1].offset + extents[i - 1].size) fail('scene_extent');
  return { entries, dataStart: cursor };
}

/** Opens just the first validated MP4/WebM member for streaming. No extraction,
 * whole-package allocation, author execution or caller-controlled member name.
 * Caller owns the handle and must close it, including HEAD/cancel/error paths.
 */
export async function openScenePackageVideo(rootPath) {
  const root = await realpath(rootPath), pkg = await asset(root, 'scene.pkg', MAX_PACKAGE);
  if (!pkg) return null;
  const handle = await open(pkg.file, 'r');
  try {
    const before = await handle.stat();
    if (before.size !== pkg.info.size || before.mtimeMs !== pkg.info.mtimeMs || before.ino !== pkg.info.ino) fail('scene_changed');
    const { entries, dataStart } = parseTable(await bytes(handle, 0, Math.min(MAX_TABLE, before.size)), before.size);
    if (!entries.some(entry => entry.name === 'scene.json')) fail('scene_missing');
    const video = entries.find(entry => /\.(mp4|webm)$/i.test(entry.name) && entry.size > 0);
    const after = await handle.stat();
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail('scene_changed');
    if (!video) { await handle.close(); return null; }
    return { handle, name: video.name, start: dataStart + video.offset, size: video.size, mtime: before.mtime };
  } catch (error) { await handle.close(); throw error; }
}
function inspectJson(value, features, { scene = false } = {}) {
  const stack = [[value, 0]];
  let visited = 0;
  while (stack.length) {
    const [node, depth] = stack.pop();
    if (++visited > 200000 || depth > 64) fail('scene_complexity');
    if (!node || typeof node !== 'object') continue;
    for (const [key, child] of Object.entries(node)) {
      if (key === 'script' && typeof child === 'string' && child.trim()) {
        features.scripts++;
        if (/\bcursor(?:Click|Move|Down|Up|Enter|Leave)\s*\(/.test(child)) features.cursorScripts++;
      }
      if (key === 'puppet' && child) features.puppets++;
      if (scene && key === 'particle' && typeof child === 'string') features.particles++;
      if (scene && key === 'sound' && (typeof child === 'string' || Array.isArray(child))) features.soundLayers++;
      if (scene && key === 'cameraparallax' && child === true) features.parallax = true;
      if (child && typeof child === 'object') stack.push([child, depth + 1]);
    }
  }
}

/** Declared-feature inventory only. No archive extraction, author evaluation or render claim. */
export async function inspectSceneProject(directory) {
  let handle;
  try {
    const root = await realpath(directory);
    const manifest = await jsonFile(await asset(root, 'project.json', 1024 ** 2), 1024 ** 2);
    if (String(manifest.type).toLowerCase() !== 'scene') fail('scene_manifest');
    const features = { particles: 0, puppets: 0, scripts: 0, cursorScripts: 0,
      soundLayers: 0, audioFiles: 0, videos: 0, parallax: false };
    const pkg = await asset(root, 'scene.pkg', MAX_PACKAGE);
    let packageInfo = null, scene;
    if (pkg) {
      handle = await open(pkg.file, 'r');
      const { entries, dataStart } = parseTable(await bytes(handle, 0, Math.min(MAX_TABLE, pkg.info.size)), pkg.info.size);
      const sceneEntry = entries.find((entry) => entry.name === 'scene.json');
      if (!sceneEntry) fail('scene_missing');
      let metadataBytes = 0;
      for (const entry of entries) {
        if (/\.(mp3|ogg|wav|m4a|flac)$/i.test(entry.name)) features.audioFiles++;
        if (/\.(mp4|webm)$/i.test(entry.name)) features.videos++;
        if (!entry.name.endsWith('.json')) continue;
        metadataBytes += entry.size;
        if (entry.size > MAX_JSON || metadataBytes > MAX_METADATA) fail('scene_metadata_size');
        const value = json(await bytes(handle, dataStart + entry.offset, entry.size));
        inspectJson(value, features, { scene: entry === sceneEntry });
        if (entry === sceneEntry) scene = value;
      }
      const hash = createHash('sha256');
      for await (const chunk of handle.createReadStream({ start: 0, autoClose: false })) hash.update(chunk);
      const after = await handle.stat();
      if (after.size !== pkg.info.size || after.mtimeMs !== pkg.info.mtimeMs) fail('scene_changed');
      packageInfo = { bytes: pkg.info.size, sha256: hash.digest('hex'), entries: entries.length };
    } else {
      scene = await jsonFile(await asset(root, 'scene.json', MAX_JSON));
      inspectJson(scene, features, { scene: true });
    }
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) fail('scene_json');
    return { status: 'inspected', renderVerified: false, package: packageInfo, features,
      objects: Array.isArray(scene.objects) ? scene.objects.length : 0,
      properties: Object.keys(manifest.general?.properties ?? {}).length };
  } catch (error) {
    return { status: 'failed', renderVerified: false, reason: /^scene_[a-z_]+$/.test(error.reason ?? '') ? error.reason : 'scene_resource' };
  } finally { await handle?.close(); }
}
