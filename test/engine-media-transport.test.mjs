import assert from 'node:assert/strict';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { createEngineMediaTransport } from '../bridge-runtime/src/engine-media-transport.mjs';
import { build } from 'esbuild';

function harness({ holdCopy = false, holdFlush = false, holdOutput = false, outputTimestamp = null, outputWidth = 800,
  decoderFailure = null, transportFunction = createEngineMediaTransport } = {}) {
  const listeners = new Map(), decoders = [], draws = [], nodes = [];
  let releaseCopy, releaseOutput, copyFailure;
  const document = { hidden: false, createElement(tag) {
    const node = { tag, dataset: {}, style: { cssText: '', removeProperty() {} }, isConnected: true,
      children: [], append(...items) { this.children.push(...items); }, remove() { this.isConnected = false; },
      getContext: () => ({ putImageData(data) { draws.push(data); } }),
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 450 }) };
    nodes.push(node); return node;
  } };
  class VideoDecoder {
    static async isConfigSupported() { return { supported: true }; }
    constructor(options) { this.options = options; this.state = 'unconfigured'; this.decodeQueueSize = 0; decoders.push(this); }
    configure() { this.state = 'configured'; }
    decode(chunk) { if (decoderFailure) return this.options.error(decoderFailure);
      const output = () => this.options.output({ timestamp: outputTimestamp ?? chunk.timestamp, displayWidth: outputWidth, displayHeight: 450,
      copyTo: async () => { if (copyFailure) throw copyFailure; if (holdCopy) await new Promise((r) => { releaseCopy = r; }); }, close() {} });
      if (holdOutput) releaseOutput = output; else output(); }
    async flush() { if (holdFlush) await new Promise(() => {}); } close() { this.state = 'closed'; }
  }
  const transport = runInNewContext(`(${transportFunction.toString()})()`, {
    document, VideoDecoder, EncodedVideoChunk: class { constructor(value) { Object.assign(this, value); } },
    ImageData: class { constructor(data) { this.data = data; } }, Uint8ClampedArray, Uint8Array, atob,
    setTimeout, clearTimeout, performance,
    addEventListener: (event, fn) => listeners.set(event, fn), removeEventListener: (event) => listeners.delete(event),
  });
  return { transport, decoders, draws, nodes, listeners, copy: () => releaseCopy?.(), output: () => releaseOutput?.(), failCopy: (error) => { copyFailure = error; } };
}
const packet = (sequence = 1) => ({ sequence, timestamp: sequence * 100000,
  vp8: Buffer.from([48, 0, 0, 157, 1, 42, 32, 3, 194, 1, 0]).toString('base64') });
const effects = { playing: true, pauseWhenHidden: true, zoom: 100, position: '50% 50%', fit: 'cover' };

test('M3 automatic battery pause preserves the manual intent in the isolated self-contained transport', async t => {
  const h = harness(), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects }); t.after(() => h.transport.close());
  assert.equal((await h.transport.accept('scene', packet())).ok, true); await slot.ready; slot.activate();
  slot.update({ effects: { ...effects, pauseOnBattery: true, onBattery: true } });
  assert.equal(h.transport.state('scene').playing, false); assert.equal((await h.transport.accept('scene', packet(2))).reason, 'paused');
  slot.update({ effects: { ...effects, playing: false, pauseOnBattery: true, onBattery: false } }); assert.equal(h.transport.state('scene').playing, false);
  slot.update({ effects: { ...effects, pauseOnBattery: true, onBattery: false } }); assert.equal(h.transport.state('scene').playing, true);
});

test('real matching decoder output is sufficient readiness even when flush never resolves', async (t) => {
  const h = harness({ holdFlush: true }), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  t.after(() => { slot.release(); h.transport.close(); });
  const ack = await h.transport.accept('scene', packet());
  assert.equal(ack.ok, true); await slot.ready; assert.equal(h.draws.length, 1);
});

test('output wait never fabricates readiness and release cancels it without waiting for timeout', async (t) => {
  const h = harness({ holdOutput: true }), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  t.after(() => h.transport.close());
  let ready = false; slot.ready.then(() => { ready = true; }).catch(() => {});
  let settled = false;
  const pending = h.transport.accept('scene', packet());
  pending.then(() => { settled = true; });
  for (let i = 0; i < 16; i++) await Promise.resolve();
  assert.equal(ready, false); assert.equal(settled, false); assert.equal(h.draws.length, 0); const started = performance.now(); slot.release();
  const result = await pending;
  assert.equal(result.ok, false); assert.equal(result.reason, 'closed');
  assert.equal(result.failureStage, undefined); assert.equal(result.diagnostic, undefined);
  assert.ok(performance.now() - started < 1000);
  h.output(); assert.equal(h.draws.length, 0);
});

test('transport close cancels in-flight output without labelling it a decoder failure', async () => {
  const h = harness({ holdOutput: true }), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  const pending = h.transport.accept('scene', packet());
  for (let i = 0; i < 16; i++) await Promise.resolve();
  h.transport.close();
  const result = await pending;
  assert.equal(result.reason, 'closed'); assert.equal(slot.failed, false);
  assert.equal(slot.node.dataset.cwbFailureStage, undefined);
  h.output(); assert.equal(h.draws.length, 0); assert.equal(h.listeners.size, 0);
});

test('explicit source failure while waiting for output is not silently treated as slot retirement', async () => {
  const h = harness({ holdOutput: true }), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  const pending = h.transport.accept('scene', packet());
  for (let i = 0; i < 16; i++) await Promise.resolve();
  h.transport.fail('scene');
  const result = await pending;
  assert.equal(result.reason, 'decode'); assert.equal(result.diagnostic.signal, 'cancelled');
  assert.equal(slot.failed, true); assert.equal(h.transport.state('scene').fallback, 'empty');
  slot.release(); h.transport.close();
});

test('bundled and minified transport serializes into a separate realm with fresh ACK control state', async () => {
  const result = await build({ entryPoints: ['bridge-runtime/src/engine-media-transport.mjs'],
    bundle: true, write: false, minify: true, format: 'esm', platform: 'node', target: 'node22' });
  const code = result.outputFiles[0].text;
  const built = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'));
  const h = harness({ transportFunction: built.createEngineMediaTransport });
  const slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  const ack = await h.transport.accept('scene', packet());
  assert.equal(ack.ok, true); assert.equal(ack.state.present, true); assert.equal(ack.state.playing, true);
  await slot.ready; slot.release(); h.transport.close();
});
test('native M1 slot is ready only after CPU decode; legitimate dark frames are accepted', async () => {
  const h = harness(), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  let ready = false; slot.ready.then(() => { ready = true; });
  await Promise.resolve(); assert.equal(ready, false);
  assert.equal((await h.transport.accept('scene', packet())).ok, true); await slot.ready;
  assert.equal(h.draws.length, 1); assert.equal(ready, true);
  assert.equal((await h.transport.accept('scene', packet())).reason, 'stale');
  slot.release(); assert.equal(h.decoders[0].state, 'closed'); assert.equal(h.transport.state('scene').present, false);
  h.transport.close(); assert.equal(h.listeners.size, 0);
});
test('invalid keyframes and URLs cannot create decoders or erase genuine pixels', async () => {
  const h = harness(), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  await h.transport.accept('scene', packet()); await slot.ready;
  for (const invalid of [{ ...packet(2), vp8: 'https://author/' }, { ...packet(2), timestamp: 0 },
    { ...packet(2), url: 'file:///private' }, { ...packet(2), vp8: Buffer.from([0, 1]).toString('base64') }]) {
    assert.equal((await h.transport.accept('scene', invalid)).ok, false);
  }
  assert.equal(h.draws.length, 1); h.transport.fail('scene');
  assert.equal(h.transport.state('scene').fallback, 'last-real-frame');
  assert.equal(h.draws.length, 1); slot.release(); h.transport.close();
});
test('cancel during async copy prevents a late canvas commit', async () => {
  const h = harness({ holdCopy: true }), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  slot.ready.catch(() => {}); const accepting = h.transport.accept('scene', packet());
  while (!h.decoders.length) await Promise.resolve();
  for (let i = 0; i < 5; i++) await Promise.resolve(); slot.release(); h.copy(); await accepting;
  assert.equal(h.draws.length, 0); h.transport.close();
});
test('pause during async copy rejects late draw and returns fresh intent in the private acknowledgement', async () => {
  const h = harness({ holdCopy: true }), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  const first = h.transport.accept('scene', packet());
  while (!h.decoders.length) await Promise.resolve(); for (let i = 0; i < 8; i++) await Promise.resolve(); h.copy(); await first;
  const pending = h.transport.accept('scene', packet(2)); for (let i = 0; i < 8; i++) await Promise.resolve();
  slot.update({ effects: { ...effects, playing: false } }); h.copy(); const result = await pending;
  assert.equal(result.reason, 'paused'); assert.equal(result.state.playing, false); assert.equal(h.draws.length, 1);
  slot.release(); h.transport.close();
});

test('decode failure exposes only a fixed stage and error class, preserving the last real frame', async () => {
  const h = harness(), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  await h.transport.accept('scene', packet()); await slot.ready;
  const error = new TypeError('private author path and script'); h.failCopy(error);
  const ack = await h.transport.accept('scene', packet(2));
  assert.equal(ack.ok, false); assert.equal(ack.reason, 'decode');
  assert.equal(ack.failureStage, 'copy'); assert.equal(ack.failureKind, 'TypeError');
  assert.equal(slot.node.dataset.cwbFailureStage, 'copy'); assert.equal(slot.node.dataset.cwbFailureKind, 'TypeError');
  assert.doesNotMatch(JSON.stringify(ack) + JSON.stringify(slot.node.dataset), /private|author|script/);
  assert.equal(h.draws.length, 1); assert.equal(h.transport.state('scene').fallback, 'last-real-frame');
  slot.release(); h.transport.close();
});
test('decoder failure diagnostics distinguish output mismatches without exporting pixels or author errors', async () => {
  for (const [options, signal, timestampMatched, dimensionsMatched] of [
    [{ outputTimestamp: 9 }, 'timestamp-mismatch', false, true],
    [{ outputWidth: 801 }, 'dimension-mismatch', true, false],
    [{ decoderFailure: Object.assign(Error('private-author-secret'), { name: 'DataError' }) }, 'decoder-error', null, null],
  ]) {
    const h = harness(options), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects });
    const ack = await h.transport.accept('scene', packet());
    assert.equal(ack.ok, false); assert.equal(ack.failureStage, 'output');
    assert.equal(ack.diagnostic.signal, signal); assert.equal(ack.diagnostic.timestampMatched, timestampMatched);
    assert.equal(ack.diagnostic.dimensionsMatched, dimensionsMatched); assert.equal(ack.diagnostic.queueSize, 0);
    assert.equal(ack.diagnostic.documentHidden, false); assert.equal(ack.diagnostic.decoderState, 'configured');
    if (signal === 'decoder-error') assert.equal(ack.failureKind, 'DataError');
    assert.equal(h.draws.length, 0); assert.doesNotMatch(JSON.stringify(ack), /private|author|secret/);
    slot.release(); h.transport.close();
  }
});
test('retired candidates never request sound and pointer input never consumes host events', async () => {
  const h = harness(), slot = h.transport.create({ wallpaper: { id: 'scene' }, effects: { ...effects, audioEnabled: true, volume: 60 } });
  assert.equal(h.transport.state('scene').volume, 0);
  await h.transport.accept('scene', packet()); slot.activate();
  assert.equal(h.transport.state('scene').volume, .6); slot.retire();
  assert.equal(h.transport.state('scene').volume, 0); slot.release(); h.transport.close();
});
test('failed active slot can be prepared again without dropping its last real frame or exceeding two slots', async () => {
  const h = harness(), old = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  await h.transport.accept('scene', packet()); old.activate(); h.transport.fail('scene');
  assert.throws(() => h.transport.create({ wallpaper: { id: 'scene' }, effects }), /capacity/);
  assert.equal(h.transport.retry('scene'), true);
  const next = h.transport.create({ wallpaper: { id: 'scene' }, effects });
  assert.equal(old.node.isConnected, true); assert.equal(old.failed, true);
  assert.throws(() => h.transport.create({ wallpaper: { id: 'other' }, effects }), /capacity/);
  await h.transport.accept('scene', packet(2)); await next.ready; next.activate(); old.release();
  assert.equal(h.transport.state('scene').present, true); assert.equal(next.node.isConnected, true);
  next.release(); h.transport.close();
});
