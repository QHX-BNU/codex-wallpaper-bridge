import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

// Execute only the production verifier's resource predicate, not its launch code.
const source = await readFile(new URL('../scripts/verify-m2-gpu-production.mjs', import.meta.url), 'utf8');
const predicate = source.slice(source.indexOf('async function gpuStatus('), source.indexOf('const stateExpression ='));
async function verify(status) {
  const context = { api: async () => status, report: {}, until: async fn => {
    const value = await fn(); if (!value) throw Error('not_settled'); return value;
  } };
  vm.runInNewContext(predicate + '\nglobalThis.check = gpuStatus;', context);
  return context.check('scene');
}
const active = () => ({ active: true, preloaded: false, width: 1920, height: 1080, renderCompletions: 4 });
const status = (targets = [active()]) => ({ sceneRenderer: 'direct-gpu', engine: [{ id: 'scene', renderer: 'direct-gpu', targets }] });
test('GPU acceptance counts shared sources separately from per-window targets', async () => {
  await verify(status());
  await verify(status([active(), active(), active()]));
  const preload = status(); preload.engine.push({ id: 'next', renderer: 'direct-gpu', targets: [{ active: false, preloaded: true }] });
  await verify(preload);
});
test('empty or legacy diagnostics never satisfy actual GPU resource evidence', async () => {
  for (const value of [{ engine: [{ id: 'scene' }] }, status([]), { ...status(), sceneRenderer: 'vp8' },
    { sceneRenderer: 'direct-gpu', engine: [] }, status([{ ...active(), width: 0 }]), status([{ ...active(), renderCompletions: 0 }])]) {
    await assert.rejects(verify(value), /not_settled/);
  }
});

test('Web GPU status uses authenticated paint opportunity metrics, never a fabricated Scene completion count', async () => {
  const web = status([{ ...active(), renderCompletions: 0, paintFrames: 2 }]); web.engine[0].type = 'web';
  await verify(web);
  web.engine[0].targets[0].paintFrames = 0; await assert.rejects(verify(web), /not_settled/);
});
test('stale retired resources and a different active Scene fail the steady-state check', async () => {
  const wrong = status(); wrong.engine[0].id = 'old';
  const capacity = status(); capacity.engine.push({ id: 'a', targets: [] }, { id: 'b', targets: [] });
  for (const value of [wrong, capacity, status([active(), { active: false, preloaded: false }])]) {
    await assert.rejects(verify(value), /not_settled/);
  }
});

const connectionSource = source.slice(source.indexOf('async function sceneConnection()'), source.indexOf('async function select(id)'));
async function resolveScene(targets, frameId = 'owned-frame') {
  const url = 'http://127.0.0.1:44000/wallpaper-engine/scene-live/index.html?type=scene&src=project';
  const context = { assert, URL, guard: async () => {}, target: { port: 9335 },
    host: { evaluate: async () => url, call: async method => method === 'DOM.getDocument' ? { root: { nodeId: 1 } }
      : method === 'DOM.querySelector' ? { nodeId: 2 } : { node: { frameId } } },
    json: async () => targets.map(id => ({ id, type: 'iframe', url })), connect: async frame => frame.id,
    until: async fn => { const value = await fn(); if (!value) throw Error('owned_frame_missing'); return value; } };
  vm.runInNewContext(connectionSource + '\nglobalThis.check = sceneConnection;', context);
  return context.check();
}
test('GPU scene inspection binds the selected host DOM frame, not another window sharing the same URL', async () => {
  assert.equal(await resolveScene(['hidden-frame', 'owned-frame', 'other-frame']), 'owned-frame');
});
test('GPU scene inspection fails closed if the selected host frame is absent', async () => {
  await assert.rejects(resolveScene(['hidden-frame']), /owned_frame_missing/);
});

test('Apply-only acceptance never repeats pointer, property, switching or pause steps', () => {
  assert.match(source, /const applyOnly = process\.argv\.includes\('--apply-only'\)/);
  for (const name of ['real Scene selections', 'GPU pause freezes', 'real host mouse move', 'GPU author five', 'real Restore and Apply']) {
    const line = source.split('\n').find(line => line.includes(`await step('${name}`));
    assert.match(line, /if \(!applyOnly &&/);
  }
});

const minimizeSource = source.slice(source.indexOf('async function minimizeOwnedPeer()'), source.indexOf('async function restore()'));
async function minimizeFixture({ mismatch = false, nativeFails = false } = {}) {
  const calls = [], report = {};
  let minimized = false;
  const context = { assert, JSON, report, target: { port: 9335 }, ps: 'powershell', workspace: 'workspace', root: 'root',
    path: { join: (...parts) => parts.join('/') },
    guard: async () => { calls.push('guard'); if (mismatch) throw Error('identity_changed'); },
    host: {}, exec: async (_exe, args) => { calls.push(args.at(-1)); minimized = !nativeFails;
      return { stdout: JSON.stringify({ identityVerified: true, minimized, windowHandle: 12345 }) }; },
    json: async () => [{ id: 'selected', type: 'page', url: 'app://-/' }, { id: 'peer', type: 'page', url: 'app://-/' }],
    connect: async t => ({ evaluate: async expression => expression.endsWith('false') ? true : minimized && t.id === 'peer', close() {} }),
    until: async fn => { if (!await fn()) throw Error('hidden_not_confirmed'); } };
  const fn = vm.runInNewContext(minimizeSource + '\nminimizeOwnedPeer', context);
  return { fn, calls, report };
}
test('hidden-peer diagnostic minimizes only a verified owned native window and confirms hidden state', async () => {
  const f = await minimizeFixture(); await f.fn();
  assert.deepEqual(f.calls, ['guard', 'minimize']);
  assert.equal(f.report.hiddenPeer.documentHiddenVerified, true);
});
test('hidden-peer diagnostic refuses an identity mismatch or unconfirmed native minimize', async () => {
  for (const options of [{ mismatch: true }, { nativeFails: true }]) {
    const f = await minimizeFixture(options); await assert.rejects(f.fn());
    assert.equal(f.report.hiddenPeer, undefined);
  }
});

test('native minimize uses the existing profile, listener, protected-chat and HWND owner checks without foregrounding', async () => {
  const helper = await readFile(new URL('../scripts/restore-m2-owned-window.ps1', import.meta.url), 'utf8');
  const branch = helper.slice(helper.indexOf("if($WindowAction -eq 'minimize')"), helper.indexOf("$restoreStage='native-window-restore'"));
  assert.match(helper, /ValidateSet\('restore','minimize'\)/);
  assert.ok(helper.indexOf("if($windowPid -ne") < helper.indexOf("if($WindowAction -eq 'minimize')"));
  assert.match(branch, /ShowWindowAsync\(\$windowHandle,6\)/);
  assert.match(branch, /IsIconic/);
  assert.doesNotMatch(branch, /SetForegroundWindow|SetWindowPos|EnumWindows/);
});

const restoreWaitSource = source.slice(source.indexOf('async function waitForRestoreDocument('), source.indexOf('async function restore()'));
async function restoredDocumentFixture(states, sceneUrl = 'http://127.0.0.1:41000/scene') {
  let probes = 0;
  const report = {};
  const context = { report, host: { evaluate: async () => {
    const state = states[Math.min(probes++, states.length - 1)]; if (state instanceof Error) throw state; return state;
  } }, until: async fn => {
    for (let i = 0; i < 4; i++) { const value = await fn(); if (value) return value; }
    throw Error('owned_wait_timeout');
  } };
  const fn = vm.runInNewContext(restoreWaitSource + '\nwaitForRestoreDocument', context);
  return { fn: () => fn(sceneUrl), report, probes: () => probes };
}
test('GPU Restore waits across disposed contexts and old empty DOM for a real fresh document', async () => {
  const f = await restoredDocumentFixture([Error('context disposed'), { ready: true, root: false, fresh: false },
    { ready: true, root: false, fresh: true }]);
  const result = await f.fn();
  assert.equal(result.fresh, true); assert.equal(f.probes(), 3); assert.equal(f.report.restoreReadinessErrors, 1);
});
test('GPU Restore never treats an unreadable or stale empty document as completion', async () => {
  for (const states of [[Error('context disposed')], [{ ready: true, root: false, fresh: false }],
    [{ ready: false, root: false, fresh: true }], [{ ready: true, root: true, fresh: true }]]) {
    const f = await restoredDocumentFixture(states); await assert.rejects(f.fn(), /owned_wait_timeout/);
  }
});

test('Store restart-only diagnostic excludes unrelated author, pointer, matrix and soak work', () => {
  assert.match(source, /const restartOnly = process\.argv\.includes\('--restart-only'\)/);
  for (const name of ['real Scene selections', 'GPU pause freezes', 'real host mouse move', 'GPU author five', 'real Restore and Apply']) {
    const line = source.split('\n').find(line => line.includes(`await step('${name}`));
    assert.match(line, /!restartOnly/);
  }
  assert.match(source, /remaining && !authorOnly && !restartOnly/);
  assert.match(source, /if \(restartOnly\) await step\('real workbench and utility restart/);
  assert.match(source, /if \(restartOnly\) await step\('real post-restart Apply/);
});

const censusSource = source.slice(source.indexOf('async function targetCensus()'), source.indexOf('async function apply()'));
async function census(targets) {
  const context = { assert, URL, createHash, target: { port: 9335 }, json: async () => targets };
  return vm.runInNewContext(censusSource + '\ntargetCensus()', context);
}
test('restart census contains only hashed IDs and fixed classes, never URL or app text', async () => {
  const output = await census([
    { id: 'first', type: 'page', url: 'app://-/?secret=do-not-record', title: 'private chat' },
    { id: 'second', type: 'page', url: 'app://-/?initialRoute=avatar-overlay' },
    { id: 'third', type: 'iframe', url: 'http://127.0.0.1:44000/?token=do-not-record' },
    { id: 'fourth', type: 'page', url: 'app://-evil/' },
  ]);
  assert.equal(output[0].idSha256, createHash('sha256').update('first').digest('hex'));
  assert.equal(output[0].urlClass, 'codex'); assert.equal(output[1].urlClass, 'auxiliary');
  assert.equal(output[2].urlClass, 'loopback'); assert.equal(output[3].urlClass, 'other');
  assert.doesNotMatch(JSON.stringify(output), /do-not-record|private chat|app:\/\/|token=/);
});
test('restart census rejects excessive target lists and unbounded identities', async () => {
  for (const targets of [Array(65).fill({ id: 'valid' }), [{ id: 'x'.repeat(129) }], [{ id: 'invalid?token=secret' }]]) {
    await assert.rejects(census(targets));
  }
});

const storeHostSource = source.slice(source.indexOf('function isStoreGpuPage('), source.indexOf('async function captureGpu('));
const page = (id, url = 'app://-/') => ({ id, type: 'page', url, webSocketDebuggerUrl: `ws://127.0.0.1:9335/devtools/page/${id}` });
const gpuHost = (overrides = {}) => ({ appOrigin: true, documentReady: true, ready: true, root: true, hidden: false,
  gpu: true, phase: 'ready', identity: 'scene', slots: 1, nativeSlots: 0, ...overrides });
function storeHostFixture(pages, states, { fresh = pages, ownerMismatch = false } = {}) {
  let lists = 0;
  const opened = [], sockets = new Map();
  const socket = id => {
    const c = { id, closed: false, evaluate: async () => states[id], close() { c.closed = true; } };
    sockets.set(id, c); return c;
  };
  const original = socket('initial');
  const context = { assert, URL, report: {}, stateExpression: 'safe metadata', target: { port: 9335 }, host: original, hostTargetId: 'initial',
    guard: async () => { if (ownerMismatch) throw Error('owner_mismatch'); },
    json: async () => ++lists === 1 ? pages : fresh,
    connect: async t => { opened.push(t.id); return socket(t.id); } };
  vm.runInNewContext(storeHostSource + '\nglobalThis.check = selectStoreGpuHost;', context);
  return { context, opened, sockets, original, check: () => context.check('scene') };
}
test('Store rebinds a retired hidden startup page to a visible committed GPU document', async () => {
  const f = storeHostFixture([page('initial'), page('main'), page('peer')], {
    initial: gpuHost({ hidden: true, root: false }), main: gpuHost(), peer: gpuHost(),
  });
  assert.equal((await f.check()).identity, 'scene'); assert.equal(f.context.host.id, 'main');
  assert.equal(f.original.closed, true); assert.equal(f.sockets.get('peer').closed, true);
  assert.equal(f.context.report.storeHostSelections[0].rebound, true);
});
test('Store target selection never accepts hidden, unreadable, stale, native or uncommitted state', async () => {
  for (const bad of [null, gpuHost({ hidden: true }), gpuHost({ hidden: null }), gpuHost({ appOrigin: false }),
    gpuHost({ documentReady: false }), gpuHost({ identity: 'other' }), gpuHost({ slots: 2 }),
    gpuHost({ nativeSlots: 1 }), gpuHost({ ready: false }), gpuHost({ root: false }), gpuHost({ phase: 'loading' })]) {
    const f = storeHostFixture([page('initial')], { initial: bad });
    assert.equal(await f.check(), false); assert.equal(f.context.host, f.original); assert.equal(f.original.closed, false);
  }
});
test('Store target selection rejects other origins and auxiliary pages despite forged ready metadata', async () => {
  const f = storeHostFixture([page('outside', 'https://example.invalid/'), page('prefix', 'app://-evil/'),
    page('avatar', 'app://-/?initialRoute=avatar-overlay')], { outside: gpuHost(), prefix: gpuHost(), avatar: gpuHost() });
  assert.equal(await f.check(), false); assert.equal(f.opened.length, 0);
});
test('Store adoption rechecks exact target ID, URL and debugger socket after owner verification', async () => {
  for (const fresh of [[], [page('other')], [page('main', 'app://-/?changed=1')],
    [{ ...page('main'), webSocketDebuggerUrl: 'ws://127.0.0.1:9336/devtools/page/main' }]]) {
    const f = storeHostFixture([page('main')], { main: gpuHost() }, { fresh });
    assert.equal(await f.check(), false); assert.equal(f.context.host, f.original); assert.equal(f.sockets.get('main').closed, true);
  }
});
test('Store selection fails before connecting on endpoint identity mismatch or excessive scope', async () => {
  const mismatch = storeHostFixture([page('main')], { main: gpuHost() }, { ownerMismatch: true });
  await assert.rejects(mismatch.check(), /owner_mismatch/); assert.equal(mismatch.opened.length, 0);
  const excessive = storeHostFixture(Array.from({ length: 9 }, (_, i) => page('p' + i)), {});
  await assert.rejects(excessive.check()); assert.equal(excessive.opened.length, 0);
});
test('Store-only host rebinding does not change Local acceptance selection or exact iframe binding', () => {
  assert.match(source, /kind === 'store' \? await selectStoreGpuHost\(id\) : await nativeState\(\)/);
  assert.match(connectionSource, /t\.id === node\.frameId && t\.url === url/);
});

test('failed readonly GPU probes close their partially opened socket and never join accepted connections', async () => {
  let closed = 0;
  const context = { connections: [], CdpConnection: class { async connect() { throw Error('Page_enable_timeout'); } close() { closed++; } } };
  const connectSource = source.slice(source.indexOf('async function connect('), source.indexOf('function start('));
  const fn = vm.runInNewContext(connectSource + '\nconnect', context);
  await assert.rejects(fn({ webSocketDebuggerUrl: 'ws://127.0.0.1:9335/owned' }, 9335), /Page_enable_timeout/);
  assert.equal(closed, 1); assert.equal(context.connections.length, 0);
});

function readAuthorUiFixture(spec, input) {
  const helperSource = source.slice(source.indexOf('function authorUiReadExpression('), source.indexOf('async function inputText('));
  const build = vm.runInNewContext(helperSource + '\nauthorUiReadExpression', { JSON });
  const row = { querySelector: () => input, querySelectorAll: () => input.channels || [] };
  return vm.runInNewContext(build('[data-author-property="test"]', spec), { document: { querySelector: () => row } });
}
test('author restart UI reader maps combo DOM indexes to typed schema values instead of comparing an index string', () => {
  for (const value of [40, 'rain-mode', false, 0]) {
    const actual = readAuthorUiFixture({ type: 'combo', options: [{ value }] }, { disabled: false, value: '0' });
    assert.equal(actual.value, value);
  }
});
test('author restart UI reader rejects an empty or invalid combo selection instead of treating it as option zero', () => {
  for (const value of ['', '-1', '1', '0.5', 'NaN']) {
    assert.equal(readAuthorUiFixture({ type: 'combo', options: [{ value: 'first' }] }, { disabled: false, value }), null);
  }
});
test('author restart UI reader preserves false, zero, text and canonical color without bypassing disabled controls', () => {
  for (const [spec, input, expected] of [
    [{ type: 'bool' }, { checked: false }, false], [{ type: 'slider' }, { value: '0' }, 0],
    [{ type: 'textinput' }, { value: 'GPU M2 UI check' }, 'GPU M2 UI check'],
    [{ type: 'color' }, { channels: [{ value: '.25' }, { value: '0' }, { value: '1' }] }, '0.25 0 1'],
  ]) {
    assert.equal(readAuthorUiFixture(spec, { ...input, disabled: false }).value, expected);
    assert.equal(readAuthorUiFixture(spec, { ...input, disabled: true }), null);
  }
});
