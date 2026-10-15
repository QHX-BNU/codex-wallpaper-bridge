import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
const source = await readFile(new URL('../bridge-runtime/public/app.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../bridge-runtime/public/index.html', import.meta.url), 'utf8');
const code = source.slice(source.indexOf('  const videoTasks ='), source.indexOf('  async function loadLibraryDirectory'));
function fixture(handler) {
  const nodes = new Map(), controls = ['faststart', 'useOptimized', 'fpsCap', 'encoder'].map(name =>
    ({ dataset: { video: name }, type: ['faststart', 'useOptimized'].includes(name) ? 'checkbox' : 'number' }));
  const calls = [], state = { selectedId: 'video', config: { video: { faststart: true, useOptimized: false, fpsCap: 30, encoder: 'auto' } } };
  const get = key => { if (!nodes.has(key)) nodes.set(key, { textContent: '', disabled: false, value: '', open: true }); return nodes.get(key); };
  const context = vm.createContext({ state, document: { hidden: false, activeElement: null }, $: get, $$: () => controls,
    currentProject: () => ({ id: state.selectedId, type: 'video', eligible: true }),
    api: async (route, options) => { calls.push([route, options]); return handler ? handler(route, options) : route === 'cache'
      ? { actualDirectory: 'D:\\actual', configuredDirectory: 'E:\\saved', environmentOverride: true, busy: false, job: null }
      : { capabilities: { available: false, error: '<script>not run</script>' }, job: { id: 'a', projectId: 'video', status: 'completed', progress: 1, options: { fpsCap: 30, encoder: 'software' } } }; },
    persistConfig: async patch => { calls.push(['save', patch]); state.config.video = patch.video; },
    loadInventory: async () => calls.push(['inventory']), showProjectMedia: async () => calls.push(['preview']),
    toast: value => calls.push(['toast', value]),
    setSaveState: (status, message) => calls.push(['saveState', status, message]),
  });
  vm.runInContext(code, context); return { context, nodes, calls, state, controls, get };
}
test('panel IDs/events are wired, compiler accepts app; no unsafe HTML or shell paths in UI tasks', () => {
  new vm.Script(source);
  for (const id of ['videoOptimizationPanel', 'videoToolsStatus', 'probeVideoToolsButton', 'optimizeVideoButton',
    'cancelVideoJobButton', 'retryVideoJobButton', 'applyOptimizedVideoButton', 'cacheDirectoryStatus', 'migrateCacheButton', 'resumeCacheJobButton']) {
    assert.match(html, new RegExp(`id="${id}"`)); assert.ok(source.includes(`$("#${id}")`));
  }
  assert.doesNotMatch(code, /innerHTML|exec\(|shell|invokeAction/);
});
test('completed job polling never refreshes media or changes selected wallpaper; paths reflect actual environment override', async () => {
  const { context, nodes, calls, state, controls } = fixture(); await vm.runInContext('pollVideoTasks(true)', context);
  assert.deepEqual(calls.map(c => c[0]), ['video-jobs', 'cache']); assert.equal(state.selectedId, 'video');
  assert.match(nodes.get('#cacheDirectoryStatus').textContent, /D:\\actual.*E:\\saved.*CWB_CACHE_ROOT/);
  assert.equal(nodes.get('#migrateCacheButton').disabled, true); assert.equal(nodes.get('#applyOptimizedVideoButton').disabled, false);
  assert.match(nodes.get('#videoToolsStatus').textContent, /<script>not run<\/script>/); assert.equal(controls[0].checked, true);
});
test('single-flight poll and hidden guard bound requests; explicit preference application refreshes through media prepare', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture(async route => { await waiting; return route === 'cache' ? { busy: false } : { capabilities: { available: null }, job: null }; });
  const first = vm.runInContext('pollVideoTasks(true)', f.context), second = vm.runInContext('pollVideoTasks(true)', f.context);
  assert.equal(f.calls.length, 2); release(); await Promise.all([first, second]);
  vm.runInContext('document.hidden=true', f.context); await vm.runInContext('pollVideoTasks(true)', f.context); assert.equal(f.calls.length, 2);
  await vm.runInContext('saveVideoSettings({useOptimized:true})', f.context);
  assert.deepEqual(f.calls.slice(-3).map(c => c[0]), ['save', 'inventory', 'preview']); assert.equal(f.state.config.video.useOptimized, true);
});
test('rapid frame-cap/encoder changes compose patches and only the latest save refreshes a media version', async () => {
  const f = fixture(), resolvers = [], snapshots = [];
  f.context.persistConfig = patch => { snapshots.push(JSON.parse(JSON.stringify(patch))); return new Promise(resolve => resolvers.push(resolve)); };
  const first = vm.runInContext('saveVideoSettings({fpsCap:60})', f.context);
  const second = vm.runInContext('saveVideoSettings({encoder:"software"})', f.context);
  assert.equal(snapshots[1].video.fpsCap, 60); assert.equal(snapshots[1].video.encoder, 'software');
  resolvers[0](); await first; assert.equal(f.calls.length, 0);
  resolvers[1](); await second; assert.deepEqual(f.calls.map(c => c[0]), ['inventory', 'preview']);
});
test('host sync failure reads persisted video settings, never pretends that an already-saved preference rolled back', async () => {
  const f = fixture(async () => ({ config: { video: { faststart: true, useOptimized: true, fpsCap: 30, encoder: 'auto' } } }));
  f.context.persistConfig = async () => { throw Error('host not confirmed'); };
  await vm.runInContext('saveVideoSettings({useOptimized:true})', f.context);
  assert.equal(f.state.config.video.useOptimized, true);
  assert.ok(!f.calls.some(c => ['inventory', 'preview'].includes(c[0])));
  assert.equal(f.calls.find(c => c[0] === 'saveState')[2], '设置已落盘，应用未确认');
});
