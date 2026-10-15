import { randomUUID } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat, realpath, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

const outputRoot = path.resolve(import.meta.dirname, '../out');
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
async function verifyPath(target) {
  const absolute = path.resolve(target), relative = path.relative(outputRoot, absolute);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('test_scratch_outside_output');
  for (let cursor = absolute; !same(cursor, outputRoot); cursor = path.dirname(cursor)) {
    if ((await lstat(cursor)).isSymbolicLink()) throw Error('test_scratch_redirected');
  }
  if (!same(await realpath(absolute), absolute)) throw Error('test_scratch_redirected');
  return absolute;
}

export async function createTestScratch(evidenceRoot) {
  const parent = await verifyPath(evidenceRoot), directory = path.join(parent, 'scratch');
  await mkdir(directory);
  const owner = randomUUID();
  await writeFile(path.join(directory, '.cwb-test-scratch.json'), JSON.stringify({ schemaVersion: 1, kind: 'cwb-m3-test-scratch', owner, directory }), { flag: 'wx' });
  return Object.freeze({ directory, parent, owner });
}

/** Call only after all owned fixture processes and servers have exited. */
export async function cleanupTestScratch(scratch) {
  if (!scratch || path.basename(scratch.directory) !== 'scratch' || !same(path.dirname(scratch.directory), scratch.parent)) throw Error('test_scratch_identity_invalid');
  const directory = await verifyPath(scratch.directory), markerPath = path.join(directory, '.cwb-test-scratch.json');
  const info = await lstat(markerPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > 4096) throw Error('test_scratch_marker_invalid');
  const marker = JSON.parse(await readFile(markerPath, 'utf8'));
  if (marker.schemaVersion !== 1 || marker.kind !== 'cwb-m3-test-scratch' || marker.owner !== scratch.owner || !same(marker.directory, directory)) throw Error('test_scratch_owner_mismatch');
  let files = 0, directories = 0, bytes = 0;
  async function inspect(current, depth = 0) {
    if (depth > 32 || files + directories > 16384) throw Error('test_scratch_capacity');
    for (const entry of await readdir(current, { withFileTypes: true })) {
      const target = path.join(current, entry.name), stat = await lstat(target);
      if (stat.isSymbolicLink()) throw Error('test_scratch_redirected');
      if (stat.isDirectory()) { directories++; await inspect(target, depth + 1); }
      else if (stat.isFile()) { files++; bytes += stat.size; }
      else throw Error('test_scratch_unknown_entry');
    }
  }
  await inspect(directory);
  const result = { directory, files, directories, bytes, verifiedOwner: true, removed: false };
  await writeFile(path.join(scratch.parent, 'scratch-cleanup.json'), JSON.stringify(result, null, 2));
  await rm(directory, { recursive: true, maxRetries: 3, retryDelay: 200 });
  result.removed = true;
  await writeFile(path.join(scratch.parent, 'scratch-cleanup.json'), JSON.stringify(result, null, 2));
  return result;
}
