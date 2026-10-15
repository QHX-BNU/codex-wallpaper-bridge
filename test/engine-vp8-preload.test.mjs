import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = await readFile(new URL('../src/engine-vp8-preload.cjs', import.meta.url), 'utf8');
function fixture({ mainFrame = true, supportGate, flushGate, unsupported = false, invalidChunk = false, encodeError = false } = {}) {
  const listeners = new Map(), sent = [], frames = [], encoders = [];
  const ipcRenderer = { on: (name, callback) => listeners.set(name, callback),
    removeListener: (name) => listeners.delete(name), send: (name, packet) => sent.push({ name, packet }) };
  class VideoFrame {
    constructor(bytes, options) { frames.push(this); this.options = options; this.length = bytes.length; }
    close() { this.closed = true; }
  }
  class VideoEncoder {
    static async isConfigSupported(config) { if (supportGate) await supportGate; return { supported: !unsupported, config }; }
    state = 'unconfigured'; encodeQueueSize = 0;
    constructor(callbacks) { this.callbacks = callbacks; encoders.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, options) { this.frame = frame; this.options = options; }
    async flush() {
      if (flushGate) await flushGate;
      if (encodeError) throw Error('codec/path must not be disclosed');
      this.callbacks.output({ type: invalidChunk ? 'delta' : 'key', timestamp: this.frame.options.timestamp, byteLength: 24,
        copyTo: (bytes) => bytes.fill(1) });
    }
    close() { this.state = 'closed'; }
  }
  const globals = { require: (name) => { assert.equal(name, 'electron'); return { ipcRenderer }; },
    process: { isMainFrame: mainFrame }, VideoFrame, VideoEncoder, Uint8Array, performance };
  vm.runInNewContext(script, globals);
  const receive = listeners.get('cwb-engine-vp8-frame-v1'), stop = listeners.get('cwb-engine-vp8-stop-v1');
  const packet = (sequence = 1) => ({ sequence, timestamp: sequence * 100000, bgra: new Uint8Array(1440000) });
  return { listeners, sent, frames, encoders, receive: (data) => receive?.({}, data), stop, packet, globals };
}
test('native codec preload is inert in subframes and exports no main-world bridge', () => {
  const f = fixture({ mainFrame: false }); assert.equal(f.listeners.size, 0); assert.equal(f.encoders.length, 0);
  assert.equal('contextBridge' in f.globals, false); assert.equal('cwbVp8Encoder' in f.globals, false);
});
test('codec only encodes fixed BGRA all-keyframes with current timestamps and closes every VideoFrame', async () => {
  const f = fixture(); await f.receive(f.packet()); await f.receive(f.packet(2));
  assert.equal(f.encoders.length, 1); assert.equal(f.encoders[0].config.codec, 'vp8');
  assert.equal(f.encoders[0].config.hardwareAcceleration, 'prefer-software'); assert.equal(f.encoders[0].options.keyFrame, true);
  assert.ok(f.frames.every((frame) => frame.closed && frame.options.format === 'BGRA'));
  assert.equal(f.sent.length, 2); assert.ok(f.sent.every((item) => item.packet.ok)); assert.equal(f.sent[1].packet.timestamp, 200000);
});
test('invalid size, timestamp, stale sequence and arbitrary byte sources never enter the codec', async () => {
  const f = fixture();
  for (const packet of [null, [], f.packet(0), { ...f.packet(), timestamp: 2 }, { ...f.packet(), bgra: new Uint8Array(1) }, { ...f.packet(), bgra: 'url' }]) await f.receive(packet);
  assert.equal(f.encoders.length, 0); await f.receive(f.packet()); await f.receive(f.packet());
  assert.equal(f.frames.length, 1); assert.equal(f.sent.at(-1).packet.reason, 'invalid-frame');
});
test('codec is single-flight with no queued raw frames', async () => {
  let resume; const flushGate = new Promise((resolve) => { resume = resolve; }), f = fixture({ flushGate });
  const pending = f.receive(f.packet()); await f.receive(f.packet(2)); assert.equal(f.sent[0].packet.reason, 'busy');
  resume(); await pending; assert.equal(f.frames.length, 1); assert.equal(f.sent.at(-1).packet.ok, true);
});
test('stop during asynchronous support lookup never allocates a late encoder', async () => {
  let resume; const supportGate = new Promise((resolve) => { resume = resolve; }), f = fixture({ supportGate });
  const pending = f.receive(f.packet()); f.stop(); resume(); await pending;
  assert.equal(f.encoders.length, 0); assert.equal(f.frames.length, 0); assert.equal(f.listeners.size, 0);
  assert.ok(f.sent.every((item) => item.packet.ok === false));
});
test('stop during flush closes codec/references, removes listeners and rejects late completion', async () => {
  let resume; const flushGate = new Promise((resolve) => { resume = resolve; }), f = fixture({ flushGate });
  const pending = f.receive(f.packet()); await new Promise((resolve) => setImmediate(resolve)); f.stop(); resume(); await pending;
  assert.equal(f.encoders[0].state, 'closed'); assert.equal(f.listeners.size, 0); assert.ok(f.frames.every((frame) => frame.closed));
  assert.ok(f.sent.every((item) => item.packet.ok === false));
});
test('unsupported codec, delta output and codec errors fail closed with fixed categories', async () => {
  for (const options of [{ unsupported: true }, { invalidChunk: true }, { encodeError: true }]) {
    const f = fixture(options); await f.receive(f.packet());
    assert.equal(f.sent[0].packet.ok, false); assert.equal(f.sent[0].packet.reason, 'encode');
    assert.ok(f.encoders.every((encoder) => encoder.state === 'closed')); assert.ok(f.frames.every((frame) => frame.closed));
    assert.equal(JSON.stringify(f.sent).includes('codec/path'), false);
  }
});
