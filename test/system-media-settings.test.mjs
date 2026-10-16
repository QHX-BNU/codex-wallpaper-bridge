import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';

const keys = ['captureAudio', 'nowPlaying', 'allowControl', 'onlineLyrics'];
const enabled = Object.fromEntries(keys.map(key => [key, true]));
const source = await readFile(new URL('../bridge-runtime/public/app.js', import.meta.url), 'utf8');
const syncStart = source.indexOf('async function syncServerPlayback(payload)');
const syncEnd = source.indexOf('function systemLyricsStatusText', syncStart);
const renderStart = source.indexOf('function renderEffects() {') + 'function renderEffects() {'.length;
const renderEnd = source.indexOf('const effects = state.effects;', renderStart);
const pollStart = source.indexOf('async function pollPlayback()');
const pollEnd = source.indexOf('async function libraryOperation', pollStart);
assert.ok(syncStart >= 0 && syncEnd > syncStart && renderEnd > renderStart && pollEnd > pollStart);
const plain = value => JSON.parse(JSON.stringify(value));

function fixture(media = enabled, api = async () => {}) {
  const controls = keys.map(key => ({ dataset: { media: key }, checked: media[key] }));
  const state = { connected: true, config: { media: { ...media } }, effects: {}, effectsDirty: false,
    selectedId: null, mediaRevision: 1, saveRevision: 1, previewLoadingRevision: null };
  const context = vm.createContext({ state, api, systemMediaSnapshot: null,
    normalizeEffects: value => value, renderPlaylistStatus() {}, updateNowPlaying() {}, preloadWorkbenchScene() {},
    $$: () => controls });
  context.renderEffects = vm.runInContext(`(()=>{${source.slice(renderStart, renderEnd)}})`, context);
  const synchronize = vm.runInContext(source.slice(syncStart, syncEnd) + '\nsyncServerPlayback', context);
  const poll = vm.runInContext(source.slice(pollStart, pollEnd) + '\npollPlayback', context);
  return { state, controls, synchronize, poll };
}

const payload = media => ({ config: { selectedId: null, effects: {}, ...(media === undefined ? {} : { media }) }, status: {} });

test('full and lightweight playlist responses carry the four media preferences without library data', async t => {
  const media = { captureAudio: true, nowPlaying: false, allowControl: true, onlineLyrics: false };
  const server = createMediaServer({ initialConfig: { media } });
  await server.start(); t.after(() => server.close());
  for (const route of ['api/playlists', 'api/playlists?state=1']) {
    const response = await fetch(new URL(route, server.baseUrl));
    assert.equal(response.status, 200);
    const result = await response.json();
    assert.deepEqual(result.config.media, media, route);
    assert.equal(Object.hasOwn(result.config, 'library'), false);
    assert.equal(Object.hasOwn(result.config, 'authorProperties'), false);
    assert.equal(Object.hasOwn(result.config, 'playlists'), !route.includes('state=1'));
    if (route.includes('state=1')) assert.deepEqual(Object.keys(result.config).sort(), ['effects', 'media', 'selectedId']);
  }
});

test('each media switch stays on after saving and repeated real HTTP polling, and can be switched off', async t => {
  const server = createMediaServer(); await server.start(); t.after(() => server.close());
  const expected = Object.fromEntries(keys.map(key => [key, false]));
  const f = fixture(expected);
  for (const key of keys) {
    for (const value of [true, false, true]) {
      expected[key] = value;
      const response = await fetch(new URL('api/config', server.baseUrl), { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ media: { [key]: value } }) });
      assert.equal(response.status, 200);
      const saved = await response.json(); f.state.config.media = { ...saved.config.media };
      for (let pass = 0; pass < 3; pass++) {
        const state = await (await fetch(new URL('api/playlists?state=1', server.baseUrl))).json();
        await f.synchronize(state);
        assert.deepEqual(plain(f.state.config.media), expected);
        assert.deepEqual(f.controls.map(control => control.checked), keys.map(name => expected[name]));
      }
    }
  }
});

test('a legacy polling response without media never clears any combination of switch preferences', async () => {
  for (let bits = 0; bits < 16; bits++) {
    const media = Object.fromEntries(keys.map((key, index) => [key, Boolean(bits & (1 << index))]));
    const f = fixture(media);
    await f.synchronize(payload()); await f.synchronize(payload());
    assert.deepEqual(plain(f.state.config.media), media);
    assert.deepEqual(f.controls.map(control => control.checked), keys.map(key => media[key]));
  }
});

test('partial media snapshots merge only explicit booleans and preserve unrelated switches', async () => {
  const f = fixture();
  await f.synchronize(payload({ allowControl: false }));
  assert.deepEqual(plain(f.state.config.media), { ...enabled, allowControl: false });
  assert.deepEqual(f.controls.map(control => control.checked), [true, true, false, true]);
  await f.synchronize(payload({ captureAudio: false, nowPlaying: false, onlineLyrics: false }));
  assert.equal(f.controls.every(control => !control.checked), true, 'explicit disable must still apply');
});

test('malformed media fields do not become false values or pollute saved settings', async () => {
  for (const media of [null, false, [], 'invalid', 42,
    { captureAudio: null, nowPlaying: 'false', allowControl: 0, onlineLyrics: {}, unrelated: true }]) {
    const f = fixture(); await f.synchronize(payload(media));
    assert.deepEqual(plain(f.state.config.media), enabled);
    assert.equal(f.controls.every(control => control.checked === true), true);
  }
});

test('polling cannot replace pending local edits before the save finishes', async () => {
  const f = fixture(); f.state.effectsDirty = true;
  await f.synchronize(payload(Object.fromEntries(keys.map(key => [key, false]))));
  assert.deepEqual(plain(f.state.config.media), enabled);
  assert.equal(f.controls.every(control => control.checked), true);
});

test('an old in-flight playback response cannot overwrite a newer committed media save', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const f = fixture(enabled, async () => gate);
  const polling = f.poll();
  f.state.saveRevision++;
  f.state.config.media = { ...enabled, onlineLyrics: false };
  release(payload(Object.fromEntries(keys.map(key => [key, false])))); await polling;
  assert.deepEqual(plain(f.state.config.media), { ...enabled, onlineLyrics: false });
});
