import assert from 'node:assert/strict';
import test from 'node:test';
import { createAuthorPropertiesPanel } from '../bridge-runtime/src/author-properties-panel.mjs';

class Element {
  children = []; dataset = {}; handlers = {}; disabled = false;
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = [...children]; }
  setAttribute() {}
  addEventListener(name, fn) { this.handlers[name] = fn; }
  querySelectorAll(selector) { return this.children.flatMap((child) => [
    ...(selector.split(',').map((s) => s.trim().toUpperCase()).includes(child.tagName) ? [child] : []), ...child.querySelectorAll(selector)]); }
}
const state = () => ({ id: 'a', revision: 1, values: { enabled: true, speed: 3, text: 'plain' }, defaults: { enabled: true },
  schema: { enabled: { type: 'bool', label: '<img onerror=1>' }, speed: { type: 'slider', label: 'speed', min: 0, max: 10, integer: true },
    text: { type: 'textinput', label: 'text' } }, live: { phase: 'unavailable', method: 'none', values: {} } });
function fixture({ fetchState = async () => state(), saveState = async () => state(), uploadFile = null, uploadDirectory = null } = {}) {
  const doc = { createElement: (tag) => new Element(tag, doc) }, root = new Element('details', doc), errors = [];
  const panel = createAuthorPropertiesPanel({ root, fetchState, saveState, uploadFile, uploadDirectory, onError: (e) => errors.push(e) });
  return { root, panel, errors };
}
test('typed inputs and author labels are text nodes; unavailable engine never claims actual readback', async () => {
  const { root, panel } = fixture(); await panel.select({ id: 'a', type: 'scene' });
  assert.equal(root.querySelectorAll('input').length, 3);
  assert.equal(root.querySelectorAll('label')[0].textContent, '<img onerror=1>');
  assert.ok(root.querySelectorAll('p')[0].textContent.includes('不将保存值视为实际读回'));
  assert.equal(root.querySelectorAll('output')[0].textContent, '实际读回：未取得');
  await panel.select({ id: 'video', type: 'video' }); assert.equal(root.hidden, true);
});

const fileState = () => ({ id: 'a', revision: 2, values: { picture: '' }, defaults: { picture: '' },
  schema: { picture: { type: 'file', label: 'Picture', extensions: ['.png', '.jpg'] } },
  live: { phase: 'unavailable', method: 'none', values: {} } });
const directoryState = () => ({ ...fileState(), schema: { photos: { type: 'directory', mode: 'fetchall', label: 'Photos', extensions: ['.png'] } }, values: { photos: '' } });
test('directory UI selects bounded media Files only, displays progress, guards commit and clears by typed save', async () => {
  let complete, cancel, signal;
  const writes = [], calls = [], { root, panel } = fixture({ fetchState: async () => directoryState(),
    saveState: async (_id, body) => { writes.push(body); return directoryState(); },
    uploadDirectory: async (id, key, files, revision, options) => {
      calls.push({ id, key, files, revision }); signal = options.signal;
      options.onProgress({ completed: 1, total: 2 });
      cancel = root.querySelectorAll('button').find(button => Object.hasOwn(button.dataset, 'authorDirectoryCancel'));
      assert.equal(cancel.disabled, false); assert.match(root.querySelectorAll('p')[0].textContent, /1\/2/);
      options.onCommit(); assert.equal(cancel.disabled, true);
      return new Promise(resolve => { complete = resolve; });
    } });
  await panel.select({ id: 'a', type: 'web' });
  const picker = root.querySelectorAll('input')[0]; assert.equal(picker.webkitdirectory, true); assert.equal(picker.multiple, true);
  const files = [{ name: 'a.png', size: 64, path: 'C:/ignored/a.png' }, { name: 'b.png', size: 64 }, { name: 'ignore.txt', size: 10 }];
  const saving = panel.saveDirectory('photos', files); assert.equal(panel.status().busy, true); assert.equal(picker.disabled, true);
  assert.equal((await panel.saveDirectory('photos', files)).ok, false);
  assert.deepEqual(calls[0], { id: 'a', key: 'photos', files: files.slice(0, 2), revision: 2 });
  cancel.handlers.click(); assert.equal(signal.aborted, false, 'final CAS is already in progress; not advertised as cancellable');
  complete({ ...directoryState(), revision: 3, values: { photos: 'managed' } }); assert.equal((await saving).ok, true);
  assert.equal(panel.status().busy, false); assert.equal(cancel.hidden, true);
  await panel.save({ photos: '' }); assert.deepEqual(writes[0], { revision: 3, values: { photos: '' } });
});
test('directory cancel/selection change aborts transfer and stale reply cannot replace the active wallpaper', async () => {
  let complete, aborted;
  const { root, panel, errors } = fixture({ fetchState: async () => directoryState(),
    uploadDirectory: async (_id, _key, _files, _revision, { signal }) => {
      aborted = signal;
      return new Promise((resolve, reject) => { complete = resolve; signal.addEventListener('abort', () => reject(Error('aborted')), { once: true }); });
    } });
  await panel.select({ id: 'a', type: 'web' });
  const saving = panel.saveDirectory('photos', [{ name: 'a.png', size: 64 }]);
  const cancel = root.querySelectorAll('button').find(button => Object.hasOwn(button.dataset, 'authorDirectoryCancel'));
  cancel.handlers.click(); assert.equal((await saving).ok, false); assert.equal(aborted.aborted, true);
  assert.equal(panel.status().values.photos, ''); assert.match(root.querySelectorAll('p')[0].textContent, /已取消.*原设置已保留/); assert.equal(errors.length, 0);
  const stale = panel.saveDirectory('photos', [{ name: 'a.png', size: 64 }]);
  await panel.select({ id: 'b', type: 'web' }); assert.equal(aborted.aborted, true);
  complete({ ...directoryState(), values: { photos: 'stale' } }); await stale;
  assert.equal(panel.status().id, 'b'); assert.equal(panel.status().values.photos, ''); assert.equal(panel.status().busy, false);
});
test('file picker sends the File object and guarded revision, never its fake/local path; clear is a typed save', async () => {
  const calls = [], writes = [], id = 'cwb-author-files/' + 'a'.repeat(32) + '-' + 'b'.repeat(32) + '-' + 'c'.repeat(64) + '.png';
  const { root, panel } = fixture({ fetchState: async () => fileState(),
    uploadFile: async (...args) => { calls.push(args); return { ...fileState(), revision: 3, values: { picture: id } }; },
    saveState: async (identity, patch) => { writes.push({ identity, patch }); return fileState(); } });
  await panel.select({ id: 'a', type: 'web' });
  const input = root.querySelectorAll('input')[0], file = { name: 'chosen.png', size: 123 };
  assert.equal(input.type, 'file'); assert.equal(input.accept, '.png,.jpg');
  input.files = [file]; input.value = 'C:\\fakepath\\chosen.png'; input.handlers.change();
  for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.deepEqual(calls[0], ['a', 'picture', file, 2]); assert.equal(panel.status().values.picture, id);
  assert.ok(root.querySelectorAll('span')[0].textContent.includes('已选受管文件'));
  const clear = root.querySelectorAll('button').find(node => node.dataset.authorFileClear === 'picture');
  clear.handlers.click(); for (let i = 0; i < 12; i++) await Promise.resolve();
  assert.deepEqual(writes[0], { identity: 'a', patch: { revision: 3, values: { picture: '' } } });
});
test('failed file upload restores confirmed state, releases busy controls and reports failure', async () => {
  const { root, panel, errors } = fixture({ fetchState: async () => fileState(), uploadFile: async () => { throw Error('upload failed'); } });
  await panel.select({ id: 'a', type: 'scene' });
  assert.deepEqual(await panel.saveFile('picture', { name: 'chosen.png', size: 123 }), { ok: false });
  assert.equal(panel.status().values.picture, ''); assert.equal(panel.status().busy, false);
  assert.equal(root.querySelectorAll('input')[0].disabled, false); assert.equal(errors.length, 1);
});
test('a pending file upload disables clear/reset and cannot overwrite a newly selected wallpaper', async () => {
  let finish; const { root, panel } = fixture({ fetchState: async id => ({ ...fileState(), id }),
    uploadFile: () => new Promise(resolve => { finish = resolve; }) });
  await panel.select({ id: 'a', type: 'scene' }); const uploading = panel.saveFile('picture', { name: 'chosen.png', size: 123 });
  assert.ok(root.querySelectorAll('button').every(node => node.disabled));
  assert.equal((await panel.save({ picture: '' })).ok, false);
  await panel.select({ id: 'b', type: 'web' });
  finish({ ...fileState(), values: { picture: 'old reply' } }); await uploading;
  assert.equal(panel.status().id, 'b'); assert.equal(panel.status().values.picture, ''); assert.equal(panel.status().busy, false);
});
test('failed save restores confirmed UI values and reports error without inventing persistence', async () => {
  const { root, panel, errors } = fixture({ saveState: async () => { throw Error('disk failed'); } });
  await panel.select({ id: 'a', type: 'scene' });
  root.querySelectorAll('input')[0].checked = false;
  const result = await panel.save({ enabled: false });
  assert.equal(result.ok, false); assert.equal(root.querySelectorAll('input')[0].checked, true);
  assert.equal(panel.status().values.enabled, true); assert.equal(errors.length, 1); assert.equal(panel.status().busy, false);
});
test('saved patch uses guarded revision and default reset; actual readback displayed separately', async () => {
  const calls = [], { root, panel } = fixture({ saveState: async (id, patch) => {
    calls.push({ id, patch }); return { ...state(), values: { enabled: false, speed: 9, text: 'saved' }, revision: 2,
      live: { phase: 'ready', method: 'engine-readback', values: { speed: 2 } } };
  } });
  await panel.select({ id: 'a', type: 'scene' }); await panel.save({ speed: 9 });
  assert.deepEqual(calls[0], { id: 'a', patch: { revision: 1, values: { speed: 9 } } });
  assert.equal(root.querySelectorAll('output')[1].textContent, '实际：2');
  await panel.save(null, true); assert.deepEqual(calls[1].patch, { revision: 2, reset: true });
});
test('old load/save completion cannot overwrite another wallpaper or clear its busy state', async () => {
  let completeA; const { panel } = fixture({ fetchState: (id) => id === 'a'
    ? new Promise((resolve) => { completeA = resolve; }) : Promise.resolve({ ...state(), id: 'b', values: { enabled: false } }) });
  const loading = panel.select({ id: 'a', type: 'scene' });
  await panel.select({ id: 'b', type: 'scene' }); completeA(state()); await loading;
  assert.equal(panel.status().id, 'b'); assert.equal(panel.status().values.enabled, false);
});
test('busy panel prevents duplicate writes and stale save reply cannot change a newer selection', async () => {
  let complete; const calls = [], { panel } = fixture({ saveState: (id) => {
    calls.push(id); return new Promise((resolve) => { complete = resolve; });
  } });
  await panel.select({ id: 'a', type: 'scene' }); const saving = panel.save({ enabled: false });
  assert.equal((await panel.save({ enabled: true })).ok, false);
  await panel.select({ id: 'b', type: 'scene' }); complete({ ...state(), values: { enabled: false } }); await saving;
  assert.deepEqual(calls, ['a']); assert.equal(panel.status().id, 'b'); assert.equal(panel.status().values.enabled, true);
});

test('workbench Scene readback is explicitly scoped and failed apply does not invent save failure', async () => {
  const { panel, root } = fixture({ fetchState: async () => ({ ...state(), live: {
    phase: 'ready', method: 'engine-readback', source: 'workbench-preview', values: { enabled: false } } }),
    saveState: async () => ({ ...state(), revision: 2, values: { enabled: false }, live: { phase: 'failed', method: 'none', values: {} } }) });
  await panel.select({ id: 'a', type: 'scene' });
  assert.match(root.querySelectorAll('p')[0].textContent, /工作台.*不代表 Codex/);
  assert.equal(root.querySelectorAll('output')[0].textContent, '实际：false');
  assert.equal((await panel.save({ enabled: false })).ok, true);
  assert.equal(panel.status().values.enabled, false); assert.match(root.querySelectorAll('p')[0].textContent, /设置已保存.*应用失败/);
});

test('late Scene readiness coalesces a single refresh after an in-flight initial panel read', async () => {
  let finish, reads = 0;
  const { panel, root } = fixture({ fetchState: async () => {
    if (++reads === 1) return new Promise((resolve) => { finish = resolve; });
    return { ...state(), live: { phase: 'ready', method: 'engine-readback', source: 'workbench-preview', values: { enabled: true } } };
  } });
  const loading = panel.select({ id: 'a', type: 'scene' });
  await panel.refreshWhenIdle(); await panel.refreshWhenIdle(); assert.equal(reads, 1);
  finish(state()); await loading; for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.equal(reads, 2); assert.equal(panel.status().busy, false);
  assert.equal(root.querySelectorAll('output')[0].textContent, '实际：true');
});

test('queued late-readiness refresh cannot cross a new selection or duplicate a pending save', async () => {
  let finish; const reads = [], saves = [];
  const { panel } = fixture({ fetchState: async (id) => { reads.push(id); return { ...state(), id }; },
    saveState: (id) => { saves.push(id); return new Promise((resolve) => { finish = resolve; }); } });
  await panel.select({ id: 'a', type: 'scene' }); const saving = panel.save({ enabled: false });
  await panel.refreshWhenIdle(); await panel.select({ id: 'b', type: 'scene' });
  finish(state()); await saving; for (let i = 0; i < 10; i++) await Promise.resolve();
  assert.deepEqual(reads, ['a', 'b']); assert.deepEqual(saves, ['a']); assert.equal(panel.status().id, 'b');
});
