import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { WindowsMediaProvider } from '../bridge-runtime/src/windows-media-provider.mjs';
import { MediaMiddleware } from '../bridge-runtime/src/media-middleware.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
function childFixture() {
  const child = new EventEmitter();
  child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough(); child.stdin = new PassThrough();
  child.kill = () => child.emit('exit', 0, null);
  child.stdin.on('finish', () => queueMicrotask(() => child.emit('exit', 0, null)));
  child.send = value => child.stdout.write(JSON.stringify(value) + '\n');
  return child;
}
const noLyrics = () => ({ get: async () => [], cancel() {}, close() {} });

test('provider can explicitly reconfigure the same flags after its helper exits; stale stdout stays fenced', async t => {
  const children = [], events = [];
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { const child = childFixture(); children.push(child); return child; } });
  t.after(() => provider.close()); provider.onEvent(event => events.push(event));
  const first = provider.configure({ audio: true }); await tick(); children[0].send({ seq: 1, type: 'ready' }); await first;
  children[0].emit('exit', 1, null); await tick(); assert.equal(children.length, 1, 'exit never automatically respawns');
  assert.equal(provider.status().running, false);
  const retry = provider.configure({ audio: true }); await tick(); assert.equal(children.length, 2);
  const count = events.length;
  children[0].send({ seq: 99, type: 'input', input: { op: 'audio', values: Array(128).fill(1) } });
  assert.equal(events.length, count);
  children[1].send({ seq: 1, type: 'ready' }); await retry;
  children[1].send({ seq: 2, type: 'input', input: { op: 'audio', values: Array(128).fill(0.5) } });
  assert.equal(events.at(-1).input.values[0], 0.5);
  await provider.configure({ audio: true }); assert.equal(children.length, 2, 'healthy same settings remain idempotent');
});

test('synchronous spawn failure does not poison the next explicit configure or leave startup rejection behind', async t => {
  let starts = 0, child;
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => {
    if (++starts === 1) throw Error('fixture_start_failure'); return child = childFixture();
  } });
  t.after(() => provider.close());
  await assert.rejects(provider.configure({ power: true }), /fixture_start_failure|media_provider_start_failed/);
  assert.equal(provider.status().reason, 'unavailable');
  const retry = provider.configure({ power: true }); await tick(); assert.equal(starts, 2);
  child.send({ seq: 1, type: 'ready' }); await retry;
  assert.equal(provider.status().reason, 'ready');
});

test('asynchronous spawn failure without a pid permits an explicit retry and no control command is replayed', async t => {
  const children = [];
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { const child = childFixture(); children.push(child); return child; } });
  t.after(() => provider.close());
  const first = assert.rejects(provider.configure({ media: true }), /media_provider_start_failed/);
  await tick(); children[0].pid = undefined; children[0].emit('error', Error('fixture_missing_executable')); await first;
  const retry = provider.configure({ media: true }); await tick(); assert.equal(children.length, 2);
  children[1].send({ seq: 1, type: 'ready' }); await retry;
  assert.equal(children[1].stdin.readableLength, 0);
});

test('middleware retries failed initialization on the next same-settings save, not on a status read or pump', async t => {
  let starts = 0;
  const service = new MediaMiddleware({ getConfig: () => ({ effects: {}, media: { nowPlaying: true } }), lyrics: noLyrics(),
    createProvider: () => ({ onEvent() {}, status: () => ({ running: starts > 1, reason: starts > 1 ? 'ready' : 'unavailable' }), close: async () => {},
      configure: async () => { if (++starts === 1) throw Error('fixture_start_failed'); } }) });
  t.after(() => service.close());
  await service.configure(); assert.equal((await service.snapshot()).sources.media, 'unavailable');
  await service.snapshot(); await service.pump(); assert.equal(starts, 1);
  await service.configure(); assert.equal(starts, 2);
  await service.configure(); assert.equal(starts, 2);
});

test('middleware plus real provider recovers after exit, clears old media and preserves manual pause intent', async t => {
  const children = [], config = { selectedId: 'fixture', effects: { playing: false }, media: { captureAudio: true, nowPlaying: true } };
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { const child = childFixture(); children.push(child); return child; } });
  const service = new MediaMiddleware({ getConfig: () => config, createProvider: () => provider, lyrics: noLyrics() });
  t.after(() => service.close());
  const first = service.configure(); await tick(); children[0].send({ seq: 1, type: 'ready' }); await first;
  children[0].send({ seq: 2, type: 'session', id: 'a'.repeat(32), commands: ['play'] });
  children[0].send({ seq: 3, type: 'input', input: { op: 'mediaStatus', value: { enabled: true } } });
  children[0].send({ seq: 4, type: 'input', input: { op: 'media', value: { title: 'fixture', artist: '', album: '', duration: 2, position: 1, state: 'playing' } } });
  children[0].emit('exit', 1, null); const empty = await service.snapshot();
  assert.equal(empty.track, null); assert.equal(empty.sessionId, ''); assert.equal(empty.sources.media, 'unavailable');
  assert.ok(empty.inputs.find(input => input.op === 'audio').values.every(value => value === 0));
  const retry = service.configure(); await tick(); assert.equal(children.length, 2);
  children[1].send({ seq: 1, type: 'ready' }); await retry;
  children[1].send({ seq: 2, type: 'input', input: { op: 'mediaStatus', value: { enabled: true } } });
  assert.equal((await service.snapshot()).sources.media, 'ready'); assert.equal(config.effects.playing, false);
  await service.close(); await assert.rejects(service.configure(), /media_closed/); assert.equal(children.length, 2);
});

test('disabled or unsupported providers never respawn from repeated configuration', async t => {
  let starts = 0;
  const disabled = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { starts++; throw Error('unexpected'); } });
  const unsupported = new WindowsMediaProvider({ platform: 'linux', spawnChild: () => { starts++; throw Error('unexpected'); } });
  t.after(() => Promise.all([disabled.close(), unsupported.close()]));
  for (let i = 0; i < 3; i++) { await disabled.configure({}); await unsupported.configure({ audio: true }); }
  assert.equal(disabled.status().reason, 'off'); assert.equal(unsupported.status().reason, 'unsupported'); assert.equal(starts, 0);
});

test('concurrent explicit recovery saves start only one replacement and never replay pending controls', async t => {
  const children = [];
  const provider = new WindowsMediaProvider({ platform: 'win32', spawnChild: () => { const child = childFixture(); children.push(child); return child; } });
  const service = new MediaMiddleware({ getConfig: () => ({ effects: {}, media: { nowPlaying: true } }), createProvider: () => provider, lyrics: noLyrics() });
  t.after(() => service.close());
  const starting = service.configure(); await tick(); children[0].send({ seq: 1, type: 'ready' }); await starting;
  const rejected = assert.rejects(provider.control({ command: 'next', sessionId: 'a'.repeat(32) }), /media_provider_exited/);
  children[0].emit('exit', 1, null); await rejected;
  const first = service.configure(), second = service.configure(); await tick();
  assert.equal(children.length, 2); children[1].send({ seq: 1, type: 'ready' }); await Promise.all([first, second]);
  assert.equal(children.length, 2); assert.equal(children[1].stdin.readableLength, 0);
});

test('a failed stop cannot open a second helper even when another explicit configure is queued', async () => {
  const children = [];
  const provider = new WindowsMediaProvider({ platform: 'win32', stopTimeoutMs: 10, spawnChild: () => {
    const child = childFixture(); child.stdin.removeAllListeners('finish'); child.kill = () => false; children.push(child); return child;
  } });
  try {
    const starting = provider.configure({ audio: true }); await tick(); children[0].send({ seq: 1, type: 'ready' }); await starting;
    const first = assert.rejects(provider.configure({ media: true }), /media_provider_stop_incomplete/);
    const second = assert.rejects(provider.configure({ media: true }), /media_provider_stop_incomplete/);
    await Promise.all([first, second]); assert.equal(children.length, 1);
  } finally { children[0]?.emit('exit', 0, null); await provider.close(); }
});
