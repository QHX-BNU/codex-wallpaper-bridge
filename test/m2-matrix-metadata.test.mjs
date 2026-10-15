import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
async function metadata(file, marker, selection = null) {
  const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
  const context = {
    require(name) {
      if (name === 'electron') return { app: { setPath() {}, on() {}, commandLine: { appendSwitch() {} } } };
      if (name === './m2-feature-boundary.cjs') return { prepareFeatureEvidenceRoot: () => 'D:/evidence' };
      if (name === 'node:fs') return { writeFileSync() {} };
      return require(name);
    },
    process: { argv: ['electron', 'script', 'D:/workspace', 'D:/readonly', 'D:/evidence', ...(selection ? [selection] : [])],
      pid: 123, versions: { electron: 'test', chrome: 'test' } },
  };
  vm.runInNewContext(source.slice(0, source.indexOf(marker)) + '\nglobalThis.metadata = report;', context);
  return JSON.parse(JSON.stringify(context.metadata));
}

test('native matrix metadata derives allowed sample and switch counts rather than obsolete eight/24', async () => {
  const r = await metadata('verify-m2-native-matrix.cjs', 'const owners =');
  assert.equal(r.configuredSampleCount, 7);
  assert.equal(r.configuredSceneCount, 5); assert.equal(r.configuredWebCount, 2);
  assert.equal(r.configuredSwitches, r.configuredCycles * r.configuredSampleCount);
  assert.equal(r.configuredSwitches, 21);
  assert.ok(!r.scope.includes('eight'));
});

test('feature matrix metadata records the actual permitted full matrix or selected subset', async () => {
  const full = await metadata('verify-m2-feature-matrix.cjs', 'let win,');
  assert.equal(full.sampleSubset, 'full-allowed-sample-matrix');
  assert.equal(full.configuredSampleCount, 7);
  assert.equal(full.configuredSceneCount, 5); assert.equal(full.configuredWebCount, 2);
  assert.ok(!full.configuredSampleIds.includes('3790869794'));
  const subset = await metadata('verify-m2-feature-matrix.cjs', 'let win,', '--only=3233141951,895116177');
  assert.equal(subset.configuredSampleCount, 2);
  assert.equal(subset.configuredSceneCount, 1); assert.equal(subset.configuredWebCount, 1);
  assert.deepEqual(subset.configuredSampleIds, ['3233141951', '895116177']);
});
