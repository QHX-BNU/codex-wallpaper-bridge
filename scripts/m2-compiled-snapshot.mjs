import { createHash } from 'node:crypto';
import { lstat, mkdir, open, opendir, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';

const limits = Object.freeze({ maxFiles: 512, maxFileBytes: 32 * 1024 * 1024,
  maxTotalBytes: 128 * 1024 * 1024, maxEntries: 1024, maxDepth: 16 });
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const inside = (base, file) => {
  const relative = path.relative(base, file);
  return relative !== '' && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative);
};
const samePath = (a, b) => path.relative(a, b) === '';

function bounded(options) {
  const result = {};
  for (const [key, maximum] of Object.entries(limits)) {
    const value = options[key] ?? maximum;
    if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw Error('compiled_snapshot_limit');
    result[key] = value;
  }
  return result;
}

// Check every existing component, not just realpath containment: an in-tree
// junction also makes a snapshot depend on mutable files outside its tree.
async function ordinaryDirectory(directory) {
  const absolute = path.resolve(directory), volume = path.parse(absolute).root;
  let current = volume;
  for (const part of absolute.slice(volume.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    const stat = await lstat(current);
    if (stat.isSymbolicLink()) throw Error('compiled_snapshot_link');
    if (!stat.isDirectory()) throw Error('compiled_snapshot_root');
  }
  if (!samePath(absolute, await realpath(absolute))) throw Error('compiled_snapshot_link');
  return absolute;
}

const sameStat = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode'].every((key) => a[key] === b[key]);
async function readStable(file, maxBytes) {
  const before = await lstat(file, { bigint: true });
  if (before.isSymbolicLink()) throw Error('compiled_snapshot_link');
  if (!before.isFile()) throw Error('compiled_snapshot_type');
  if (before.size > BigInt(maxBytes)) throw Error('compiled_snapshot_limit');
  const handle = await open(file, 'r');
  try {
    if (!sameStat(before, await handle.stat({ bigint: true }))) throw Error('compiled_source_changed');
    // Read at most the bound plus a sentinel byte even if a writer grows it.
    const buffer = Buffer.alloc(Number(before.size) + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (BigInt(length) !== before.size || !sameStat(before, await handle.stat({ bigint: true }))
        || !sameStat(before, await lstat(file, { bigint: true }))) throw Error('compiled_source_changed');
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

async function inventory(directory, bounds, destination = null) {
  await ordinaryDirectory(directory);
  const entries = [], directories = [];
  let totalBytes = 0, visited = 0;
  async function walk(base, relative, depth) {
    if (depth > bounds.maxDepth) throw Error('compiled_snapshot_limit');
    const stream = await opendir(base);
    for await (const item of stream) {
      if (++visited > bounds.maxEntries) throw Error('compiled_snapshot_limit');
      if (/[\\/:]/.test(item.name)) throw Error('compiled_snapshot_type');
      const name = relative ? relative + '/' + item.name : item.name;
      const file = path.join(base, item.name), stat = await lstat(file);
      if (stat.isSymbolicLink()) throw Error('compiled_snapshot_link');
      if (stat.isDirectory()) {
        await ordinaryDirectory(file);
        directories.push(name);
        if (destination) await mkdir(path.join(destination, ...name.split('/')));
        await walk(file, name, depth + 1);
      } else if (stat.isFile()) {
        if (entries.length >= bounds.maxFiles || stat.size > bounds.maxFileBytes
            || totalBytes + stat.size > bounds.maxTotalBytes) throw Error('compiled_snapshot_limit');
        const bytes = await readStable(file, Math.min(bounds.maxFileBytes, bounds.maxTotalBytes - totalBytes));
        totalBytes += bytes.length;
        entries.push({ path: name, bytes: bytes.length, sha256: hash(bytes) });
        if (destination) await writeFile(path.join(destination, ...name.split('/')), bytes, { flag: 'wx' });
      } else throw Error('compiled_snapshot_type');
    }
  }
  await walk(directory, '', 0);
  if (!entries.length) throw Error('compiled_snapshot_empty');
  entries.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
  directories.sort();
  return { files: entries.length, totalBytes, entries, directories };
}

const fingerprint = (value) => hash(JSON.stringify({ entries: value.entries, directories: value.directories }));

/** Independent, fresh evidence tree. Failures leave their bytes for diagnosis. */
export async function freezeCompiledBuild({ workspace, root, dist = path.join(workspace, 'dist'),
  snapshot = path.join(root, 'compiled-snapshot'), afterCopy, ...options }) {
  const bounds = bounded(options);
  workspace = await ordinaryDirectory(workspace);
  root = path.resolve(root); dist = path.resolve(dist); snapshot = path.resolve(snapshot);
  const allowed = path.join(workspace, 'out', 'live-acceptance');
  if (!inside(allowed, root) || !inside(workspace, dist) || !samePath(path.dirname(snapshot), root)
      || inside(dist, snapshot) || samePath(dist, snapshot)) throw Error('compiled_snapshot_root');
  await ordinaryDirectory(root); await ordinaryDirectory(dist);
  try { await mkdir(snapshot); }
  catch (error) { if (error.code === 'EEXIST') throw Error('compiled_snapshot_exists'); throw error; }
  const copied = await inventory(dist, bounds, snapshot);
  if (afterCopy) await afterCopy();
  let current;
  try { current = await inventory(dist, bounds); }
  catch { throw Error('compiled_source_changed'); }
  if (fingerprint(copied) !== fingerprint(current)) throw Error('compiled_source_changed');
  const proof = { schemaVersion: 1, ...copied, bounds, sha256: fingerprint(copied) };
  await verifyCompiledSnapshot(snapshot, proof);
  for (const entry of proof.entries) Object.freeze(entry);
  Object.freeze(proof.entries); Object.freeze(proof.directories); Object.freeze(proof.bounds);
  return Object.freeze(proof);
}

/** Compare against the caller's pinned proof, never a mutable in-tree manifest. */
export async function verifyCompiledSnapshot(snapshot, proof) {
  try {
    if (proof?.schemaVersion !== 1 || !Array.isArray(proof.entries) || !Array.isArray(proof.directories)
        || proof.entries.length > limits.maxFiles || proof.directories.length > limits.maxEntries
        || !/^[a-f0-9]{64}$/.test(proof.sha256) || fingerprint(proof) !== proof.sha256) throw Error();
    const current = await inventory(path.resolve(snapshot), bounded(proof.bounds || {}));
    if (current.files !== proof.files || current.totalBytes !== proof.totalBytes
        || fingerprint(current) !== proof.sha256) throw Error();
    return true;
  } catch { throw Error('compiled_snapshot_changed'); }
}
