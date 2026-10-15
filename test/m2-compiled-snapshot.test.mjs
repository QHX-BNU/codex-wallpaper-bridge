import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

async function fixture(t) {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'cwb-compiled-freeze-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const dist = path.join(workspace, 'dist'), root = path.join(workspace, 'out', 'live-acceptance', 'test');
  await mkdir(path.join(dist, 'bridge-runtime', 'src'), { recursive: true });
  await mkdir(root, { recursive: true });
  await writeFile(path.join(dist, 'bridge-utility-entry.mjs'), 'export const utility=1;');
  await writeFile(path.join(dist, 'bridge-runtime', 'src', 'cli.mjs'), 'export const cli=1;');
  const snapshot = path.join(root, 'compiled-snapshot');
  return { workspace, dist, root, snapshot };
}

const api = () => import('../scripts/m2-compiled-snapshot.mjs');
test('compiled snapshot is frozen by bounded hashes and remains independent of later shared builds', async (t) => {
  const f = await fixture(t), { freezeCompiledBuild, verifyCompiledSnapshot } = await api();
  const proof = await freezeCompiledBuild(f);
  assert.equal(proof.files, 2);
  assert.equal(await verifyCompiledSnapshot(f.snapshot, proof), true);
  await writeFile(path.join(f.dist, 'bridge-runtime', 'src', 'cli.mjs'), 'export const cli=2;');
  assert.equal(await verifyCompiledSnapshot(f.snapshot, proof), true);
  assert.equal(await readFile(path.join(f.snapshot, 'bridge-runtime', 'src', 'cli.mjs'), 'utf8'), 'export const cli=1;');
  await writeFile(path.join(f.snapshot, 'bridge-runtime', 'src', 'cli.mjs'), 'export const cli=3;');
  await assert.rejects(verifyCompiledSnapshot(f.snapshot, proof), /compiled_snapshot_changed/);
});

test('compiled snapshot rejects source drift during copying rather than accepting a mixed build', async (t) => {
  const f = await fixture(t), { freezeCompiledBuild } = await api();
  await assert.rejects(freezeCompiledBuild({ ...f, afterCopy: async () => {
    await writeFile(path.join(f.dist, 'bridge-runtime', 'src', 'cli.mjs'), 'export const cli=2;');
  } }), /compiled_source_changed/);
  assert.equal(await readFile(path.join(f.snapshot, 'bridge-runtime', 'src', 'cli.mjs'), 'utf8'), 'export const cli=1;');
});

test('compiled snapshot rejects existing destinations and non-acceptance roots', async (t) => {
  const f = await fixture(t), { freezeCompiledBuild } = await api();
  await mkdir(f.snapshot);
  await assert.rejects(freezeCompiledBuild(f), /compiled_snapshot_exists/);
  await assert.rejects(freezeCompiledBuild({ ...f, root: f.workspace }), /compiled_snapshot_root/);
});

test('compiled snapshot rejects links and bounds file count and byte sizes', async (t) => {
  const { freezeCompiledBuild } = await api();
  const large = await fixture(t);
  await assert.rejects(freezeCompiledBuild({ ...large, maxFileBytes: 8 }), /compiled_snapshot_limit/);
  const count = await fixture(t);
  await assert.rejects(freezeCompiledBuild({ ...count, maxFiles: 1 }), /compiled_snapshot_limit/);
  const total = await fixture(t);
  await assert.rejects(freezeCompiledBuild({ ...total, maxTotalBytes: 25 }), /compiled_snapshot_limit/);
  const linked = await fixture(t), outside = await fixture(t);
  await symlink(outside.dist, path.join(linked.dist, 'escape'), 'junction');
  await assert.rejects(freezeCompiledBuild(linked), /compiled_snapshot_link/);
});

test('compiled verifier loads every production component from its frozen snapshot, never shared dist', async () => {
  const source = await readFile(new URL('../scripts/verify-m2-production.cjs', import.meta.url), 'utf8');
  assert.match(source, /freezeCompiledBuild/);
  assert.match(source, /verifyCompiledSnapshot/);
  assert.ok(!source.includes("importFile('dist/"));
  assert.ok(!source.includes("path.join(workspace, 'dist', 'bridge-utility-entry.mjs')"));
  assert.ok(!source.includes("CWB_BRIDGE_CLI: path.join(workspace, 'dist'"));
  assert.match(source, /compiledSnapshotVerifiedAfter = await verifyCompiledSnapshot/);
});

test('snapshot proof rejects added, removed and linked files or a modified manifest', async (t) => {
  const { freezeCompiledBuild, verifyCompiledSnapshot } = await api();
  for (const change of ['add', 'remove', 'link', 'proof']) {
    const f = await fixture(t), proof = await freezeCompiledBuild(f);
    const cli = path.join(f.snapshot, 'bridge-runtime', 'src', 'cli.mjs');
    if (change === 'add') await writeFile(path.join(f.snapshot, 'injected.mjs'), 'export default 0');
    if (change === 'remove') await rm(cli);
    if (change === 'link') await symlink(f.dist, path.join(f.snapshot, 'redirect'), 'junction');
    const expected = change === 'proof' ? { ...proof, files: 99 } : proof;
    await assert.rejects(verifyCompiledSnapshot(f.snapshot, expected), /compiled_snapshot_changed/);
  }
});

test('snapshot bounds directory depth and entry count, including empty directories', async (t) => {
  const { freezeCompiledBuild } = await api();
  const deep = await fixture(t);
  await assert.rejects(freezeCompiledBuild({ ...deep, maxDepth: 1 }), /compiled_snapshot_limit/);
  const wide = await fixture(t);
  await mkdir(path.join(wide.dist, 'empty'));
  await assert.rejects(freezeCompiledBuild({ ...wide, maxEntries: 2 }), /compiled_snapshot_limit/);
  const invalid = await fixture(t);
  await assert.rejects(freezeCompiledBuild({ ...invalid, maxFiles: Infinity }), /compiled_snapshot_limit/);
});

test('snapshot rejects a linked source ancestor and a destination outside the fresh root', async (t) => {
  const f = await fixture(t), outside = await fixture(t), { freezeCompiledBuild } = await api();
  await symlink(outside.workspace, path.join(f.workspace, 'linked'), 'junction');
  await assert.rejects(freezeCompiledBuild({ ...f, dist: path.join(f.workspace, 'linked', 'dist') }), /compiled_snapshot_link/);
  await assert.rejects(freezeCompiledBuild({ ...f, snapshot: path.join(f.workspace, 'escape') }), /compiled_snapshot_root/);
});

test('freeze detects source file additions and removals during copy and pins proof in memory', async (t) => {
  const { freezeCompiledBuild } = await api();
  for (const operation of ['add', 'remove']) {
    const f = await fixture(t);
    await assert.rejects(freezeCompiledBuild({ ...f, afterCopy: () => operation === 'add'
      ? writeFile(path.join(f.dist, 'late.mjs'), 'export default 1')
      : rm(path.join(f.dist, 'bridge-runtime', 'src', 'cli.mjs')) }), /compiled_source_changed/);
  }
  const proof = await freezeCompiledBuild(await fixture(t));
  assert.throws(() => { proof.entries[0].sha256 = '0'.repeat(64); }, TypeError);
});
