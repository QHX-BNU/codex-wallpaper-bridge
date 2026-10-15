import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { access, cp, mkdir, readFile, readdir, realpath, lstat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPackageWithOptions, extractFile, listPackage } from '@electron/asar';
import { COMPILED_BRIDGE_UNPACKED_FILES, assertChildPath, assertProtectedPackageEntries, assertProtectedUnpackedEntries } from '../src/package-layout.mjs';

const workspace = await realpath(path.join(path.dirname(fileURLToPath(import.meta.url)), '..'));
const requested = process.argv[2]; if (!requested) throw Error('fresh workspace evidence directory required');
const root = assertChildPath(path.join(workspace, 'out'), path.resolve(requested));
let cursor = workspace;
for (const segment of path.relative(workspace, path.dirname(root)).split(path.sep)) {
  cursor = path.join(cursor, segment); const info = await lstat(cursor); assert.ok(info.isDirectory() && !info.isSymbolicLink());
  assert.ok((await realpath(cursor)).toLowerCase() === cursor.toLowerCase());
}
await mkdir(root); const stage = path.join(root, 'stage'); await mkdir(stage);
await access(path.join(workspace, 'dist', 'engine-vp8-preload.cjs'));
await cp(path.join(workspace, 'dist'), path.join(stage, 'dist'), { recursive: true });
await writeFile(path.join(stage, 'package.json'), JSON.stringify({ name: 'cwb-native-asar-validation-only', private: true, type: 'module', main: 'dist/main.mjs' }));
const archive = path.join(root, 'app.asar');
await createPackageWithOptions(stage, archive, { unpack: 'bridge-utility-entry.mjs', unpackDir: path.join('dist', 'bridge-runtime') });
async function files(base, directory = base) {
  const entries = [];
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const current = path.join(directory, item.name);
    if (item.isDirectory()) entries.push(...await files(base, current));
    else if (item.isFile()) entries.push(path.relative(base, current));
    else throw Error('unexpected_asar_symlink');
  }
  return entries;
}
const entries = assertProtectedPackageEntries(listPackage(archive));
const unpacked = assertProtectedUnpackedEntries(await files(archive + '.unpacked'));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const hashes = {};
for (const file of ['dist/engine-vp8-preload.cjs', ...COMPILED_BRIDGE_UNPACKED_FILES]) {
  const bytes = extractFile(archive, path.join(...file.split('/'))); assert.equal(sha(bytes), sha(await readFile(path.join(workspace, file)))); hashes[file] = sha(bytes);
}
const report = { outcome: 'pass', scope: 'actual-ASAR-layout-and-unpacked-files-only', archive,
  entries: entries.length, unpackedFiles: unpacked.length, preservedHashes: hashes, releaseExeGenerated: false,
  packagedExecutableRuntimeVerified: false };
await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify(report));
