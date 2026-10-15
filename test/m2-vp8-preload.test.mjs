import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = await readFile(new URL('../scripts/m2-vp8-encoder-preload.cjs', import.meta.url), 'utf8');
function fixture({ mainFrame = true, gate, unsupported = false, encodeError = false } = {}) {
  const listeners = new Map(), sent = [], frames = [], encoders = [];
  const ipcRenderer = { on: (name, callback) => listeners.set(name, callback),
    removeListener: (name) => listeners.delete(name), send: (name, packet) => sent.push({ name, packet }) };
  class VideoFrame {
    constructor(bytes, options) { frames.push(this); this.options = options; this.length = bytes.length; }
    close() { this.closed = true; }
  }
  class VideoEncoder {
    static async isConfigSupported(config) { return { supported: !unsupported, config }; }
    state = 'unconfigured'; encodeQueueSize = 0;
    constructor(callbacks) { this.callbacks = callbacks; encoders.push(this); }
    configure(config) { this.config = config; this.state = 'configured'; }
    encode(frame, options) { this.frame = frame; this.options = options; }
    async flush() {
      if (gate) await gate;
      if (encodeError) throw Error('encoder failed');
      this.callbacks.output({ type: 'key', timestamp: this.frame.options.timestamp, byteLength: 20,
        copyTo: (bytes) => { bytes.fill(1); } });
    }
    close() { this.state = 'closed'; }
  }
  vm.runInNewContext(script, { require: (name) => { assert.equal(name, 'electron'); return { ipcRenderer }; },
    process: { isMainFrame: mainFrame }, VideoFrame, VideoEncoder, Uint8Array, performance });
  const packet = (sequence = 1) => ({ sequence, timestamp: sequence * 100000, bgra: new Uint8Array(1440000).fill(100) });
  const receive = (packet) => listeners.get('cwb-m2-vp8-frame')?.({}, packet);
  return { listeners, sent, frames, encoders, receive, packet };
}

test('isolated preload is inert in an author subframe', () => {
  const env = fixture({ mainFrame: false }); assert.equal(env.listeners.size, 0); assert.equal(env.encoders.length, 0);
});

test('preload encodes only fixed native BGRA buffers and closes VideoFrame references', async () => {
  const env = fixture(); await env.receive(env.packet());
  assert.equal(env.sent[0].packet.ok, true); assert.equal(env.sent[0].packet.sequence, 1);
  assert.equal(env.frames[0].closed, true); assert.equal(env.frames[0].options.format, 'BGRA');
  assert.equal(env.encoders[0].config.codec, 'vp8'); assert.equal(env.encoders[0].config.hardwareAcceleration, 'prefer-software');
  assert.equal(env.encoders[0].options.keyFrame, true);
});

test('persistent encoder uses the current operation timestamp across sequential frames', async () => {
  const env = fixture(); await env.receive(env.packet(1)); await env.receive(env.packet(2));
  assert.equal(env.encoders.length, 1); assert.equal(env.sent.length, 2);
  assert.ok(env.sent.every((item) => item.packet.ok)); assert.equal(env.sent[1].packet.timestamp, 200000);
});

test('preload rejects invalid native byte counts and timestamps before allocating encoder', async () => {
  const env = fixture();
  for (const packet of [null, [], { ...env.packet(), bgra: new Uint8Array(4) }, env.packet(0),
    { ...env.packet(), timestamp: 1 }, { ...env.packet(), bgra: '<script>' }]) await env.receive(packet);
  assert.equal(env.encoders.length, 0); assert.equal(env.sent.length, 6);
  assert.ok(env.sent.every((item) => item.packet.ok === false));
});

test('preload has one encoding flight, reports busy and never queues input', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; }); const env = fixture({ gate });
  const pending = env.receive(env.packet()); await env.receive(env.packet(2));
  assert.equal(env.sent[0].packet.reason, 'busy'); resume(); await pending;
  assert.equal(env.frames.length, 1); assert.equal(env.sent[1].packet.ok, true);
});

test('unsupported and failed encoder paths report bounded categories without leaking frames', async () => {
  for (const options of [{ unsupported: true }, { encodeError: true }]) {
    const env = fixture(options); await env.receive(env.packet());
    assert.equal(env.sent[0].packet.ok, false); assert.equal(env.sent[0].packet.reason, 'encode');
    assert.ok(env.frames.every((frame) => frame.closed)); assert.ok(env.encoders.every((encoder) => encoder.state === 'closed'));
  }
});

test('stop closes encoder, removes IPC listeners and a late operation never reports a valid packet', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; }); const env = fixture({ gate });
  const pending = env.receive(env.packet()); await new Promise((resolve) => setTimeout(resolve, 1));
  env.listeners.get('cwb-m2-vp8-stop')(); resume(); await pending;
  assert.equal(env.encoders[0].state, 'closed'); assert.equal(env.listeners.size, 0);
  assert.ok(!env.sent.some((item) => item.packet.ok)); assert.ok(env.frames.every((frame) => frame.closed));
});
