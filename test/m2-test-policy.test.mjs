import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import policy from '../scripts/m2-test-policy.cjs';

test('M2 test policy rejects excluded IDs and whitespace-normalized titles without hiding other samples', () => {
  for (const project of ['3790869794', { id: '3790869794', title: 'renamed' },
    { id: 'alias', title: '泰拉 身高\n体检' }, null]) {
    assert.equal(policy.isM2TestProjectAllowed(project), false);
    assert.throws(() => policy.assertM2TestProject(project), /m2_test_sample_excluded/);
  }
  for (const project of ['3025975631', { id: '1778944028', title: 'Kakashi and Naruto' },
    { id: '895116177', title: 'GENSHIN Yelan' }]) assert.equal(policy.isM2TestProjectAllowed(project), true);
});
test('M2 root preflight reads only the manifest and rejects renamed copies of the excluded sample', async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-m2-policy-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const file = path.join(root, 'project.json'), bytes = '{"title":"泰拉身高体检"}';
  await writeFile(file, bytes);
  assert.throws(() => policy.assertM2TestRoot(root), /m2_test_sample_excluded/);
  await writeFile(file, '{"title":"allowed"}');
  assert.ok(policy.assertM2TestRoot(root));
});
