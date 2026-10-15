import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
const { prepareFeatureEvidenceRoot } = createRequire(import.meta.url)('../scripts/m2-feature-boundary.cjs');
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm2-feature-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true })); return root;
}
test('feature helper accepts only a fresh contained evidence directory before profile setup', async (t) => {
  const workspace = await fixture(t), output = path.join(workspace, 'out', 'm2-20261010-compatibility', 'new');
  assert.equal(prepareFeatureEvidenceRoot(workspace, output), output);
  assert.throws(() => prepareFeatureEvidenceRoot(workspace, output), /fresh/);
  assert.throws(() => prepareFeatureEvidenceRoot(workspace, path.join(workspace, 'outside')), /child/);
});
test('feature helper refuses junction/symlink ancestors without creating outside profile files', async (t) => {
  const workspace = await fixture(t), outside = path.join(workspace, 'outside'); await mkdir(outside);
  await symlink(outside, path.join(workspace, 'out'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => prepareFeatureEvidenceRoot(workspace, path.join(workspace, 'out', 'm2-20261010-compatibility', 'new')), /plain/);
});
