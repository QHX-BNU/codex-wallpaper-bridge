import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../scripts/verify-m2-production.cjs', import.meta.url), 'utf8');
const begin = source.indexOf('async function api('), end = source.indexOf('const stateExpression =', begin);
assert.ok(begin >= 0 && end > begin);
function fixture(response) {
  const report = {}, requests = [];
  const context = { report, bridgeUrl: 'http://127.0.0.1:18001/test-token/', URL, AbortSignal,
    fetch: async (...args) => { requests.push(args); return response; } };
  vm.runInNewContext(source.slice(begin, end) + '\nglobalThis.callApi = api;', context);
  return { api: context.callApi, report, requests };
}
test('production verifier classifies a real plain-text HTTP failure without parsing or collecting its body', async () => {
  let reads = 0;
  const f = fixture({ ok: false, status: 500, async json() { reads++; throw new SyntaxError('private body'); } });
  await assert.rejects(f.api('config', { selectedId: 'allowed-scene' }), /production_api_failed/);
  assert.equal(reads, 0); assert.equal(f.report.failedApi.status, 500); assert.equal(f.report.failedApi.ok, false);
  assert.equal(JSON.stringify(f.report).includes('private body'), false);
});
test('production verifier still rejects JSON ok=false and reports only bounded control-plane metadata', async () => {
  const f = fixture({ ok: true, status: 200, async json() { return { ok: false, error: 'private native error' }; } });
  await assert.rejects(f.api('action', { action: 'inject' }), /production_api_failed/);
  assert.equal(f.report.failedApi.route, 'action'); assert.equal(f.report.failedApi.action, 'inject');
  assert.equal(JSON.stringify(f.report).includes('private native error'), false);
});
test('production verifier forwards successful control responses and sends the same-origin write header', async () => {
  const f = fixture({ ok: true, status: 200, async json() { return { ok: true, cleared: true }; } });
  assert.equal((await f.api('action', { action: 'retry-engine' })).cleared, true);
  assert.equal(f.requests[0][1].headers.Origin, 'http://127.0.0.1:18001');
});

test('production settlement waits for both the retired DOM slot and native ownership to close', async () => {
  const start = source.indexOf('async function settle(') >= 0 ? source.indexOf('async function settle(') : source.indexOf('async function select(');
  const finish = source.indexOf('async function canvasDigest(', start);
  let nativeSlots = 2, reads = 0, observed;
  const context = { testPolicy: createRequire(import.meta.url)('../scripts/m2-test-policy.cjs'),
    api: async () => {}, state: async () => ({ native: true, sequence: 2, identity: 'scene', slots: 1 }),
    host: { status() { if (++reads >= 2) nativeSlots = 1; return { slots: nativeSlots }; } },
    until: async (fn) => { for (let i = 0; i < 8; i++) if (await fn()) return; throw Error('fixture_wait_timeout'); },
    showcase: async () => { observed = nativeSlots; } };
  vm.runInNewContext(source.slice(start, finish) + '\nglobalThis.selectScene = select;', context);
  await context.selectScene('scene');
  assert.equal(observed, 1, 'showcase cannot race still-closing native ownership');
});

test('focused switch regression runs only inject, M1 switches and restore, reporting every omitted step', async () => {
  const begin = source.indexOf('async function step('), end = source.indexOf('async function api(', begin);
  const report = { steps: [], notRun: [] }, ran = [];
  const context = { report, switchOnly: true, substage: '', progress: async () => {}, guard: async () => {}, focusOwned: async () => {},
    connection: { evaluate: async () => true }, until: async fn => fn(), errorCategory: () => 'error' };
  vm.runInNewContext(source.slice(begin, end) + '\nglobalThis.step = step;', context);
  const names = [...source.matchAll(/await step\('([^']+)'/g)].map(match => match[1]);
  for (const name of names) await context.step(name, async () => { ran.push(name); });
  assert.equal(ran.length, 3); assert.equal(report.steps.length, 3);
  assert.equal(report.notRun.length, names.length - 3);
  assert.ok(ran.some(name => name.startsWith('restore')));
  assert.ok(!ran.some(name => /audio|soak|property/.test(name)));
  assert.match(source, /CWB_SCENE_RENDERER: 'vp8'/);
  assert.match(source, /defaultGpuPathVerified: false/);
  assert.match(source, /switchOnly && report\.nativeFailureEvents\?\.length/);
});
