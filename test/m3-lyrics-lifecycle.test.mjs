import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { MediaMiddleware } from '../bridge-runtime/src/media-middleware.mjs';
import { LyricsStore } from '../bridge-runtime/src/media-lyrics.mjs';

const flush = () => new Promise(resolve => setImmediate(resolve));
const track = { title: 'owned fixture', artist: 'test', album: '', state: 'playing', position: 2, duration: 10 };
async function fixture(t, lyrics, get = value => value) {
  const config = { selectedId: 'web', effects: {}, media: { nowPlaying: true, onlineLyrics: true } };
  let receive;
  const media = new MediaMiddleware({ getConfig: () => get(config), lyrics, createProvider: () => ({ onEvent: callback => { receive = callback; }, configure: async () => {}, close: async () => {}, status: () => ({}) }) });
  t.after(() => media.close()); await media.configure();
  return { media, config, start() { receive({ type: 'session', id: 'a'.repeat(32), commands: [] }); receive({ type: 'input', input: { op: 'media', value: track } }); } };
}

test('a late online result cannot replace a successfully imported local LRC', async t => {
  let finish;
  const f = await fixture(t, { get: () => new Promise(resolve => { finish = resolve; }), set: async () => [{ time: 0, text: 'local' }], cancel() {}, close() {} });
  f.start(); await flush(); const s = await f.media.snapshot();
  await f.media.importLyrics({ sessionId: s.sessionId, trackKey: s.trackKey, lrc: '[00:00]local' });
  finish([{ time: 0, text: 'old online' }]); await flush();
  assert.equal((await f.media.snapshot()).lyric.text, 'local');
  assert.equal((await f.media.snapshot()).lyric.source, 'local');
});

test('disable while waiting for config prevents a late online request from starting', async t => {
  let hold = false, release; const reads = [];
  const f = await fixture(t, { get: async (_track, options) => { reads.push(options.online); return []; }, cancel() {}, close() {} }, config => {
    if (!hold) return config; hold = false;
    const old = structuredClone(config); return new Promise(resolve => { release = () => resolve(old); });
  });
  hold = true; f.start(); await flush(); f.config.media.onlineLyrics = false;
  await f.media.configure(); release(); await flush();
  assert.equal(reads.includes(true), false);
});

test('close while waiting for config prevents lyrics IO after shutdown', async t => {
  let hold = false, release, reads = 0;
  const f = await fixture(t, { get: async () => { reads++; return []; }, cancel() {}, close() {} }, config => {
    if (!hold) return config; hold = false; return new Promise(resolve => { release = () => resolve(config); });
  });
  hold = true; f.start(); await flush(); await f.media.close(); release(); await flush(); assert.equal(reads, 0);
});

test('LyricsStore close during local filesystem checks cannot start an online request', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-m3-lyrics-close-')); t.after(() => rm(root, { recursive: true, force: true }));
  let queries = 0; const lyrics = new LyricsStore({ root, fetchLyrics: async () => { queries++; return new Response('{}'); } });
  const pending = lyrics.get(track, { online: true }); lyrics.close(); await pending; assert.equal(queries, 0);
});

test('same-track local import cancels the pending online lookup, even if fetch ignores AbortSignal', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-m3-lyrics-import-')); t.after(() => rm(root, { recursive: true, force: true }));
  let finish, signal; const lyrics = new LyricsStore({ root, fetchLyrics: async (_url, options) => { signal = options.signal; return new Promise(resolve => { finish = resolve; }); } }); t.after(() => lyrics.close());
  const pending = lyrics.get(track, { online: true });
  while (!finish) await flush();
  await lyrics.set(track, '[00:00]local');
  finish(new Response(JSON.stringify({ syncedLyrics: '[00:00]old online' })));
  assert.equal(signal.aborted, true); assert.deepEqual(await pending, []);
  assert.equal((await lyrics.get(track, { online: true }))[0].text, 'local');
});

test('lookup reports off, loading result source, not-found and service failure without fake success', async t => {
  for (const [status, state] of [[404, 'not_found'], [429, 'unavailable'], [500, 'unavailable']]) {
    const lyrics = new LyricsStore({ fetchLyrics: async () => new Response('{}', { status }) }); t.after(() => lyrics.close());
    const result = await lyrics.lookup(track, { online: true }); assert.equal(result.state, state); assert.equal(result.rows.length, 0);
  }
  let queries = 0; const lyrics = new LyricsStore({ fetchLyrics: async url => { queries++; assert.equal(url.hostname, 'lrclib.net'); assert.equal(url.searchParams.has('duration'), false); return new Response(JSON.stringify({ syncedLyrics: '[00:00]online' })); } }); t.after(() => lyrics.close());
  assert.equal((await lyrics.lookup(track)).state, 'off'); assert.equal(queries, 0);
  const result = await lyrics.lookup({ ...track, duration: 0 }, { online: true }); assert.equal(result.state, 'ready'); assert.equal(result.source, 'online');
});

test('workbench lyrics state text distinguishes opt-out, local, online, no result and failure', async () => {
  const source = await readFile(new URL('../bridge-runtime/public/app.js', import.meta.url), 'utf8');
  const fn = source.match(/  function systemLyricsStatusText\([\s\S]*?\n  \}/)?.[0]; assert.ok(fn);
  const text = vm.runInNewContext(fn + '\nsystemLyricsStatusText');
  assert.match(text({ state: 'ready', source: 'local' }, true), /本地/);
  assert.match(text({ state: 'ready', source: 'online' }, true), /在线/);
  assert.match(text({ state: 'not_found' }, true), /未找到/);
  assert.match(text({ state: 'unavailable' }, true), /失败/);
  assert.match(text({ state: 'off' }, true), /未启用/);
});

test('concurrent local imports publish in invocation order and leave no temporary lyric files', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-m3-lyrics-order-')); t.after(() => rm(root, { recursive: true, force: true }));
  const lyrics = new LyricsStore({ root }); t.after(() => lyrics.close());
  await Promise.all([lyrics.set(track, '[00:00]first'), lyrics.set(track, '[00:00]latest')]);
  const result = await lyrics.lookup(track); assert.equal(result.source, 'local'); assert.equal(result.rows[0].text, 'latest');
});

test('a config refresh during local save cannot revive the previous online result', async t => {
  let saved; const pending = [];
  const f = await fixture(t, { get: () => new Promise(resolve => pending.push(resolve)), set: () => new Promise(resolve => { saved = resolve; }), cancel() {}, close() {} });
  f.start(); await flush(); const s = await f.media.snapshot();
  const importing = f.media.importLyrics({ sessionId: s.sessionId, trackKey: s.trackKey, lrc: '[00:00]local' });
  f.config.media.allowControl = true; await f.media.configure();
  saved([{ time: 0, text: 'local' }]); await importing;
  for (const finish of pending) finish([{ time: 0, text: 'old online' }]); await flush();
  assert.equal((await f.media.snapshot()).lyric.text, 'local');
});

test('rejected online bodies are cancelled, not retained as unread connections', async t => {
  let cancelled = 0;
  const lyrics = new LyricsStore({ fetchLyrics: async () => new Response(new ReadableStream({ cancel() { cancelled++; } }), { status: 429 }) }); t.after(() => lyrics.close());
  assert.equal((await lyrics.lookup(track, { online: true })).state, 'unavailable'); assert.equal(cancelled, 1);
});
