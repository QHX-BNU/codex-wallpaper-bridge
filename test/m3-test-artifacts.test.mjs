import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile, rm, access, symlink, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createTestScratch, cleanupTestScratch } from '../scripts/m3-test-artifacts.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.resolve('out/m3-scratch-unit-'));
  // This exact, newly-created output directory is the only test teardown target.
  t.after(() => rm(root, { recursive: true, force: true }));
  return { root, scratch: await createTestScratch(root) };
}
test('scratch cleanup removes only marked generated data and keeps the report', async t => {
  const { root, scratch } = await fixture(t); await writeFile(path.join(root, 'report.json'), '{}');
  await writeFile(path.join(scratch.directory, 'fixture.bin'), Buffer.alloc(1024));
  const result = await cleanupTestScratch(scratch); assert.equal(result.removed, true); assert.ok(result.bytes >= 1024);
  await assert.rejects(access(scratch.directory), /ENOENT/); assert.equal(await readFile(path.join(root, 'report.json'), 'utf8'), '{}');
});
test('wrong owner or path cannot delete a scratch directory', async t => {
  const { root, scratch } = await fixture(t);
  await assert.rejects(cleanupTestScratch({ ...scratch, owner: 'wrong' }), /owner_mismatch/);
  await assert.rejects(cleanupTestScratch({ ...scratch, directory: root }), /identity_invalid/);
  await access(scratch.directory);
});
test('a redirected child is rejected without touching its target', async t => {
  const { root, scratch } = await fixture(t), outside = path.join(root, 'retained'); await mkdir(outside);
  await writeFile(path.join(outside, 'user.txt'), 'keep');
  await symlink(outside, path.join(scratch.directory, 'redirect'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(cleanupTestScratch(scratch), /redirected/);
  assert.equal(await readFile(path.join(outside, 'user.txt'), 'utf8'), 'keep');
});
