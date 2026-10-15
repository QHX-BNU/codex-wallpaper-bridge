import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { MediaMiddleware } from '../bridge-runtime/src/media-middleware.mjs';
import { LyricsStore } from '../bridge-runtime/src/media-lyrics.mjs';
import { validateWebWallpaperInput } from '../bridge-runtime/src/web-wallpaper-input.mjs';
const track = { title: '测试歌曲', artist: 'Test Artist', album: '', state: 'playing', position: 1.5, duration: 100 };
const sessionId = 'a'.repeat(32);
const flush = async () => { for (let i = 0; i < 10; i++) await new Promise(resolve => setImmediate(resolve)); };

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-m3-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load(); await store.set({ media: { nowPlaying: true } });
  let receive; const commands = [];
  const media = new MediaMiddleware({ getConfig: () => store.get(), lyrics: new LyricsStore({ root: path.join(root, 'lyrics') }),
    createProvider: () => ({ onEvent: callback => { receive = callback; }, configure: async () => {}, close: async () => {},
      status: () => ({ running: true }), control: async value => { commands.push(value); return true; } }) });
  await media.configure(); t.after(() => media.close());
  receive({ type: 'session', id: sessionId, commands: ['play', 'pause', 'next'] });
  receive({ type: 'input', input: { op: 'mediaStatus', value: { enabled: true } } });
  receive({ type: 'input', input: { op: 'media', value: track } }); await flush();
  const server = createMediaServer({ configStore: store, projects: [], media, onConfigChange: () => media.configure() });
  await server.start(); t.after(() => server.close());
  const request = (route, body, headers = {}) => fetch(new URL('api/' + route, server.baseUrl), {
    ...(body !== undefined ? { method: 'POST', body: JSON.stringify(body), headers: { 'Content-Type': 'application/json', Origin: server.origin, ...headers } } : { headers }) });
  return { root, store, media, receive, server, request, commands };
}

test('private HTTP snapshot, local LRC persistence, stale import and explicit session control', async t => {
  const f = await fixture(t); let snapshot = await (await f.request('media')).json();
  assert.equal(snapshot.track.title, track.title); assert.deepEqual(snapshot.commands, []);
  assert.equal((await f.request('media/control', { command: 'next', sessionId })).status, 409);
  assert.equal((await f.request('media/control', { command: 'play', sessionId }, { Origin: 'https://evil.test' })).status, 403);
  assert.equal((await f.request('media/lyrics', { sessionId, trackKey: snapshot.trackKey, lrc: '[00:01.00]歌词一\n[00:03.00]歌词二' })).status, 200);
  snapshot = await (await f.request('media')).json(); assert.equal(snapshot.lyric.text, '歌词一');
  const rebuilt = new LyricsStore({ root: path.join(f.root, 'lyrics') });
  assert.equal((await rebuilt.get(track))[0].text, '歌词一'); rebuilt.close();
  assert.equal((await f.request('media/lyrics', { sessionId, trackKey: 'b'.repeat(64), lrc: '[00:01]bad' })).status, 409);
  assert.equal((await f.request('config', { media: { allowControl: true } })).status, 200);
  assert.equal((await f.request('media/control', { command: 'next', sessionId })).status, 200);
  assert.equal(f.commands.length, 1);
  for (const body of [{ command: 'execute', sessionId }, { command: 'play', sessionId, path: 'C:/secret' }, { command: 'play', sessionId: 'b'.repeat(32) }]) {
    assert.equal((await f.request('media/control', body)).status, 409);
  }
  await f.request('config', { effects: { pauseOnBattery: true, playing: false } });
  f.receive({ type: 'power', onBattery: true }); f.receive({ type: 'power', onBattery: false });
  assert.equal(f.store.get().effects.playing, false); assert.equal(f.store.get().effects.onBattery, undefined);
});

test('actual Web shim receives lyrics/capabilities and returns a private control ACK, no Node/control URL', async t => {
  const f = await fixture(t); await f.request('config', { media: { allowControl: true } });
  const events = new Map(), posts = []; let window;
  const parent = { postMessage(message, origin) { posts.push({ message, origin }); } };
  window = { parent, innerWidth: 800, innerHeight: 450, __cwbValidateWebInput: validateWebWallpaperInput,
    __cwbValidateProperties: (_schema, values) => ({ values }), __cwbMapFileProperties: (_schema, values) => values,
    addEventListener: (name, callback) => events.set(name, callback), removeEventListener: name => events.delete(name),
    setTimeout, clearTimeout, setInterval: () => 1, clearInterval() {} };
  const source = await readFile(new URL('../bridge-runtime/public/cwb-web-bridge.js', import.meta.url), 'utf8');
  vm.runInNewContext(source, { window, document: { querySelector: () => ({ content: 'c'.repeat(32) }), querySelectorAll: () => [] },
    URL, AbortController, performance: { now: () => 0 }, requestAnimationFrame: callback => callback(), setInterval: () => 1, clearInterval() {},
    fetch: async () => ({ ok: true, json: async () => ({ parentOrigin: 'app://-', channel: 'private-channel', authorProperties: { schema: {}, values: {} } }) }) });
  await flush(); events.get('load')(); await flush();
  const send = (op, value) => events.get('message')({ source: parent, origin: 'app://-', data: { source: 'cwb-web-control', channel: 'private-channel', op, ...value } });
  const snapshot = await (await f.request('media')).json();
  send('mediaCapabilities', { value: { sessionId, commands: snapshot.commands } });
  send('lyrics', { value: { text: '当前歌词', next: '下一行' } });
  const lyrics = []; window.cwbMediaIntegration.registerLyricsListener(value => lyrics.push(value.text)); await flush(); assert.equal(lyrics[0], '当前歌词');
  const control = window.cwbMediaIntegration.control('next');
  const message = posts.at(-1).message; assert.equal(message.source, 'cwb-web-media-control'); assert.equal(posts.at(-1).origin, 'app://-');
  assert.equal(JSON.stringify(message).includes(f.server.baseUrl), false); assert.equal(window.require, undefined);
  const result = await (await f.request('media/control', { command: message.command, sessionId: message.sessionId })).json();
  send('mediaControlResult', { requestId: message.requestId, ok: result.ok }); assert.equal(await control, true);
  send('pause'); await assert.rejects(window.cwbMediaIntegration.control('play'), /unavailable/);
  send('resume'); const stale = window.cwbMediaIntegration.control('play'); send('release'); await assert.rejects(stale, /unavailable/);
});
