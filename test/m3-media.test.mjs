import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WindowsMediaProvider } from '../bridge-runtime/src/windows-media-provider.mjs';
import { MediaMiddleware } from '../bridge-runtime/src/media-middleware.mjs';
import { parseLrc, lyricAt, LyricsStore } from '../bridge-runtime/src/media-lyrics.mjs';
import { mkdtemp, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

test('LRC offsets, duplicate timestamps, current line and bounded malformed input', () => {
  const rows = parseLrc('[offset:-100]\n[00:01.00][00:02.00]第一行\n[00:03.00]第二行');
  assert.deepEqual(rows.map(row => row.time), [0.9, 1.9, 2.9]);
  assert.equal(lyricAt(rows, 2.1).text, '第一行');
  assert.equal(lyricAt(rows, 0).text, '');
  assert.throws(() => parseLrc('x'.repeat(131073)), /lyrics_limit/);
});

function fakeChild() {
  const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.pid = 123; child.kill = () => { child.emit('exit', 0, null); }; return child;
}
test('provider is opt-in, validates input, bounds requests and owns one hidden child', async () => {
  let child, args, options, calls = 0;
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: (_file, a, o) => { calls++; args = a; options = o; return child = fakeChild(); }, startupTimeoutMs: 50, stopTimeoutMs: 20 });
  const events = []; provider.onEvent(event => events.push(event));
  await provider.configure({ audio: false, media: false, power: false }); assert.equal(calls, 0);
  const pending = provider.configure({ audio: true, media: true, power: false });
  await new Promise(resolve => setImmediate(resolve));
  child.stdout.write(JSON.stringify({ seq: 1, type: 'ready' }) + '\n'); await pending;
  assert.equal(options.windowsHide, true); assert.equal(options.shell, false); assert.ok(args.includes('-NoProfile'));
  child.stdout.write(JSON.stringify({ seq: 2, type: 'input', input: { op: 'audio', values: Array(128).fill(0.5) } }) + '\n');
  child.stdout.write(JSON.stringify({ seq: 2, type: 'power', onBattery: true }) + '\n'); // replay rejected
  assert.equal(events.some(event => event.type === 'input'), true);
  assert.equal(events.some(event => event.type === 'power'), false);
  const closing = provider.close(); setTimeout(() => child.emit('exit', 0, null), 5); await closing;
  assert.equal(provider.status().running, false);
});

test('middleware starts only requested sources and gates controls by opt-in/session/capability', async () => {
  let handler, config = { selectedId: 'web', effects: { playing: true }, media: { nowPlaying: true, allowControl: false } };
  const commands = [], configurations = [];
  const service = new MediaMiddleware({ getConfig: () => config, createProvider: () => ({
    onEvent: cb => { handler = cb; }, configure: async flags => { configurations.push(flags); }, close: async () => {},
    status: () => ({ running: true }), control: async value => { commands.push(value); return true; }
  }), dispatch: async () => {}, lyrics: { get: async () => [], close() {} } });
  await service.configure(); assert.equal(configurations[0].audio, false);
  handler({ type: 'session', id: 'a'.repeat(32), commands: ['play'] });
  await assert.rejects(service.control({ command: 'play', sessionId: 'a'.repeat(32) }), /media_control_unavailable/);
  config.media.allowControl = true; await service.configure();
  await service.control({ command: 'play', sessionId: 'a'.repeat(32) }); assert.equal(commands.length, 1);
  await assert.rejects(service.control({ command: 'pause', sessionId: 'a'.repeat(32) }), /media_control_unavailable/);
  await assert.rejects(service.control({ command: 'play', sessionId: 'b'.repeat(32) }), /media_control_unavailable/);
  await service.close(); await assert.rejects(service.control({ command: 'play', sessionId: 'a'.repeat(32) }));
});

test('online lyrics default off, local import wins over online and disabled mode sends no query', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'm3-lyrics-')); t.after(() => rm(root, { recursive: true, force: true }));
  let fetches = 0;
  const lyrics = new LyricsStore({ root, fetchLyrics: async url => { fetches++; assert.equal(url.origin, 'https://lrclib.net'); return new Response(JSON.stringify({ syncedLyrics: '[00:01]online' })); } });
  const track = { title: 't', artist: 'a', album: '', duration: 10 };
  assert.deepEqual(await lyrics.get(track), []); assert.equal(fetches, 0);
  assert.equal((await lyrics.get(track, { online: true }))[0].text, 'online');
  assert.deepEqual(await lyrics.get(track), []); assert.equal(fetches, 1);
  await lyrics.set(track, '[00:01]local'); assert.equal((await lyrics.get(track, { online: true }))[0].text, 'local'); assert.equal(fetches, 1); lyrics.close();
});

test('provider shutdown/timeout protocol never restarts before its exact child exits', async () => {
  let child; let starts = 0;
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { starts++; return child = fakeChild(); }, startupTimeoutMs: 10, stopTimeoutMs: 10 });
  const a = provider.configure({ audio: true });
  await assert.rejects(a, /timeout/); assert.equal(starts, 1); assert.equal(provider.status().running, false);
  await provider.close(); await assert.rejects(provider.configure({ audio: true }), /closed/);
});

test('provider decodes split UTF8, drops arbitrary packets and control replies are request-bound', async () => {
  let child;
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => child = fakeChild(), stopTimeoutMs: 10 });
  const events = []; provider.onEvent(event => events.push(event)); const pending = provider.configure({ media: true });
  await new Promise(resolve => setImmediate(resolve)); child.stdout.write('{"seq":1,"type":"ready"}\n'); await pending;
  const packet = Buffer.from(JSON.stringify({ seq: 2, type: 'input', input: { op: 'media', value: { title: '歌曲', artist: '', album: '', state: 'paused', duration: 2, position: 1 } } }) + '\n');
  const split = packet.indexOf(Buffer.from('歌曲')) + 1; child.stdout.write(packet.subarray(0, split)); child.stdout.write(packet.subarray(split));
  assert.equal(events[0].input.value.title, '歌曲');
  child.stdout.write('{"seq":3,"type":"input","input":{"op":"execute","path":"C:/secret"}}\n'); assert.equal(events.length, 1);
  let sent = ''; child.stdin.on('data', data => { sent += data; });
  const control = provider.control({ command: 'next', sessionId: 'a'.repeat(32) }); const request = JSON.parse(sent.trim()).request;
  child.stdout.write(JSON.stringify({ seq: 4, type: 'reply', request: request + 1, ok: true }) + '\n');
  child.stdout.write(JSON.stringify({ seq: 5, type: 'reply', request, ok: true }) + '\n'); assert.equal(await control, true);
  const closing = provider.close(); setTimeout(() => child.emit('exit', 0, null), 1); await closing;
});

test('middleware stale lyric completions cannot revive a previous track and a single pump has no backlog', async () => {
  let handler, resolveLyrics, releaseDispatch;
  const config = { selectedId: 'web', effects: {}, media: { nowPlaying: true, onlineLyrics: true } };
  const media = new MediaMiddleware({ getConfig: () => config, createProvider: () => ({ onEvent: callback => { handler = callback; }, configure: async () => {}, close: async () => {}, status: () => ({}) }),
    lyrics: { cancel() {}, close() {}, get: () => new Promise(resolve => { resolveLyrics = resolve; }) }, dispatch: async () => {} });
  await media.configure();
  const input = title => ({ type: 'input', input: { op: 'media', value: { title, artist: '', album: '', state: 'playing', position: 2, duration: 10 } } });
  handler(input('old')); await new Promise(resolve => setImmediate(resolve)); const old = resolveLyrics;
  handler(input('new')); await new Promise(resolve => setImmediate(resolve)); old([{ time: 1, text: 'stale' }]); await new Promise(resolve => setImmediate(resolve));
  assert.equal((await media.snapshot()).lyric.text, ''); resolveLyrics([{ time: 1, text: 'new' }]); await new Promise(resolve => setImmediate(resolve)); assert.equal((await media.snapshot()).lyric.text, 'new');
  await media.close();
  const middleware = new MediaMiddleware({ getConfig: () => config, dispatch: () => new Promise(resolve => { releaseDispatch = resolve; }) });
  const pumping = middleware.pump(); await new Promise(resolve => setImmediate(resolve)); assert.equal(middleware.pump(), pumping);
  const closing = middleware.close(); releaseDispatch(); await closing;
});

test('disabling sources rejects their late events, clears the preview spectrum and preserves off diagnostics', async () => {
  let receive, finishing;
  const config = { effects: {}, media: { captureAudio: true, nowPlaying: true } };
  const service = new MediaMiddleware({ getConfig: () => config, createProvider: () => ({ onEvent: callback => { receive = callback; },
    status: () => ({ running: true }), close: async () => {}, configure: flags => flags.audio || flags.media ? Promise.resolve() : new Promise(resolve => { finishing = resolve; }) }),
    lyrics: { get: async () => [], cancel() {}, close() {} } });
  await service.configure(); config.media = {};
  const disabled = service.configure(); await new Promise(resolve => setImmediate(resolve));
  receive({ type: 'session', id: 'a'.repeat(32), commands: ['play'] });
  receive({ type: 'input', input: { op: 'media', value: { title: 'late', artist: '', album: '', state: 'playing', position: 1, duration: 2 } } });
  receive({ type: 'input', input: { op: 'audio', values: Array(128).fill(1) } }); receive({ type: 'unavailable' }); finishing(); await disabled;
  const snapshot = await service.snapshot(); assert.equal(snapshot.track, null); assert.equal(snapshot.trackKey, '');
  assert.equal(snapshot.inputs.find(input => input.op === 'audio').values.every(value => value === 0), true);
  assert.deepEqual(snapshot.sources, { audio: 'off', media: 'off' }); await service.close();
});

test('close seals a pending configure before it can create a producer', async () => {
  let release; const config = new Promise(resolve => { release = resolve; }); let starts = 0;
  const service = new MediaMiddleware({ getConfig: () => config, createProvider: () => { starts++; throw Error('unexpected'); } });
  const configuring = service.configure(); await new Promise(resolve => setImmediate(resolve)); const closing = service.close();
  release({ effects: {}, media: { captureAudio: true } }); await assert.rejects(configuring, /media_closed/); await closing; assert.equal(starts, 0);
});

test('provider close during restart prevents a new child after the old child exits', async () => {
  let child, starts = 0;
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { starts++; return child = fakeChild(); }, stopTimeoutMs: 50 });
  const first = provider.configure({ audio: true }); await new Promise(resolve => setImmediate(resolve));
  child.stdout.write('{"seq":1,"type":"ready"}\n'); await first;
  const changing = provider.configure({ media: true }); await new Promise(resolve => setImmediate(resolve));
  const old = child, closing = provider.close(); old.emit('exit', 0, null);
  await assert.rejects(changing, /media_provider_closed/); await closing; assert.equal(starts, 1);
});

test('provider close rejects startup immediately instead of ignoring ready until its timeout', async () => {
  let child;
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => child = fakeChild(), startupTimeoutMs: 2000, stopTimeoutMs: 20 });
  const starting = provider.configure({ media: true }); await new Promise(resolve => setImmediate(resolve));
  const began = performance.now(), closing = provider.close(); setTimeout(() => child.emit('exit', 0, null), 1);
  await assert.rejects(starting, /media_provider_closed/); await closing; assert.ok(performance.now() - began < 500);
});

test('middleware close during power propagation cannot start capture afterward', async () => {
  let release, starts = 0;
  const service = new MediaMiddleware({ getConfig: () => ({ effects: {}, media: { captureAudio: true } }),
    onPower: () => new Promise(resolve => { release = resolve; }), createProvider: () => { starts++; throw Error('unexpected'); } });
  const configuring = service.configure(); await new Promise(resolve => setImmediate(resolve)); const closing = service.close(); release();
  await assert.rejects(configuring, /media_closed/); await closing; assert.equal(starts, 0);
});
