import assert from 'node:assert/strict';
import vm from 'node:vm';
import test from 'node:test';
import { installVp8Receiver, validateSceneVp8Keyframe } from '../scripts/m2-vp8-transfer.mjs';

const nonce = 'b'.repeat(32);
function keyframe(width = 800, height = 450) {
  const bytes = Buffer.alloc(20); bytes[0] = 48;
  bytes.set([157, 1, 42], 3); bytes.writeUInt16LE(width, 6); bytes.writeUInt16LE(height, 8);
  return bytes;
}
async function fixture({ gate, copyGate, decodeError = false, wrongSize = false, black = false, detached = false, timeoutMs = 100 } = {}) {
  const drawn = [], closedFrames = [], decoders = [], nodes = [];
  const document = { body: { append: (node) => { nodes.push(node); node.isConnected = !detached; } },
    getElementById: () => null, createElement: () => ({ style: {}, append() {}, isConnected: true,
      getContext: () => ({ drawImage: () => { throw Error('must not enter GPU VideoFrame drawing path'); }, putImageData: (...args) => drawn.push(args),
        getImageData: () => ({ data: new Uint8ClampedArray(800 * 450 * 4).fill(black ? 0 : 100) }) }),
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 450 }),
      remove() { this.isConnected = false; } }) };
  class VideoDecoder {
    static async isConfigSupported(config) { return { supported: true, config }; }
    state = 'unconfigured'; decodeQueueSize = 0;
    constructor(callbacks) { this.callbacks = callbacks; decoders.push(this); }
    configure() { this.state = 'configured'; }
    decode(chunk) { this.chunk = chunk; }
    async flush() {
      if (gate) await gate;
      if (decodeError) throw Error('invalid compressed data');
      this.callbacks.output({ timestamp: this.chunk.timestamp, displayWidth: wrongSize ? 801 : 800,
        displayHeight: 450, codedWidth: 800, codedHeight: 450,
        copyTo: async (bytes, options) => { assert.equal(options.format, 'RGBA'); if (copyGate) await copyGate; bytes.fill(black ? 0 : 100); },
        close: () => closedFrames.push(true) });
    }
    close() { this.state = 'closed'; }
  }
  const receiver = await vm.runInNewContext(`(${installVp8Receiver.toString()})({nonce:'${nonce}',timeoutMs:${timeoutMs}},${validateSceneVp8Keyframe.toString()})`, {
    document, VideoDecoder, EncodedVideoChunk: class { constructor(args) { Object.assign(this, args); } },
    Uint8Array, Uint8ClampedArray, ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    atob, performance, setTimeout, clearTimeout,
  });
  const packet = (sequence = 1) => ({ sequence, timestamp: sequence * 100000, vp8: keyframe().toString('base64') });
  return { receiver, packet, drawn, closedFrames, decoders, nodes };
}

test('VP8 keyframe validates fixed codec, compressed bounds, dimensions and scaling bits', () => {
  assert.deepEqual(validateSceneVp8Keyframe(keyframe()), { width: 800, height: 450, bytes: 20 });
  for (const bytes of [Buffer.alloc(0), Buffer.from('<script>'), keyframe(801), keyframe(800, 451),
    keyframe(800 | 0x4000), Buffer.alloc(2097153)]) assert.throws(() => validateSceneVp8Keyframe(bytes));
  for (const offset of [0, 3, 4, 5]) { const bad = keyframe(); bad[offset] = 255; assert.throws(() => validateSceneVp8Keyframe(bad)); }
  const partition = keyframe(); partition[2] = 255; assert.throws(() => validateSceneVp8Keyframe(partition));
});

test('receiver draws only validated decoded real-size video frames and closes each frame', async () => {
  const env = await fixture(); const ack = await env.receiver.accept(env.packet());
  assert.equal(ack.ok, true); assert.equal(ack.sequence, 1);
  assert.equal(env.drawn.length, 1); assert.equal(env.closedFrames.length, 1);
  assert.equal(env.receiver.stats().phase, 'ready'); env.receiver.release();
  assert.equal(env.decoders[0].state, 'closed');
});

test('receiver rejects URL, script, malformed/oversize keyframes and invalid sequence/timestamp before decode', async () => {
  const env = await fixture();
  for (const packet of [null, [], { ...env.packet(), vp8: 'https://example.com/' },
    { ...env.packet(), vp8: Buffer.from('<script>').toString('base64') },
    { ...env.packet(), vp8: keyframe(802).toString('base64') },
    { ...env.packet(), vp8: 'A'.repeat(2796208) }, env.packet(0), env.packet(1.5),
    { ...env.packet(), timestamp: 0 }, { ...env.packet(), timestamp: Infinity }]) {
    assert.equal((await env.receiver.accept(packet)).ok, false);
  }
  assert.equal(env.drawn.length, 0); env.receiver.release();
});

test('stale and repeated encoded frames never overwrite a committed surface', async () => {
  const env = await fixture(); await env.receiver.accept(env.packet(3));
  assert.equal((await env.receiver.accept(env.packet(2))).reason, 'stale');
  assert.equal((await env.receiver.accept(env.packet(3))).reason, 'stale');
  assert.equal(env.drawn.length, 1); env.receiver.release();
});

test('VP8 receiver has one in-flight operation and no queued frames', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; });
  const env = await fixture({ gate }); const pending = env.receiver.accept(env.packet());
  assert.equal((await env.receiver.accept(env.packet(2))).reason, 'busy');
  assert.equal(env.receiver.stats().pending, 1); resume(); assert.equal((await pending).ok, true);
  assert.equal(env.receiver.stats().pending, 0); env.receiver.release();
});

test('decode errors and dimension mismatch retain old pixels and close the decoder', async () => {
  for (const options of [{ decodeError: true }, { wrongSize: true }]) {
    const env = await fixture(options); assert.equal((await env.receiver.accept(env.packet())).ok, false);
    assert.equal(env.drawn.length, 0); assert.equal(env.decoders[0].state, 'closed'); env.receiver.release();
  }
});

test('decode timeout fails closed, closes late frames and cannot replace the previous canvas', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; });
  const env = await fixture({ gate, timeoutMs: 10 });
  assert.equal((await env.receiver.accept(env.packet())).reason, 'decode');
  assert.equal(env.decoders[0].state, 'closed'); resume(); await new Promise((resolve) => setTimeout(resolve, 1));
  assert.equal(env.drawn.length, 0); assert.equal(env.closedFrames.length, 1); env.receiver.release();
});

test('fail and idempotent release during asynchronous decode never commit a late frame', async () => {
  for (const operation of ['fail', 'release']) {
    let resume; const gate = new Promise((resolve) => { resume = resolve; });
    const env = await fixture({ gate }); const pending = env.receiver.accept(env.packet());
    env.receiver[operation]('source-ended'); env.receiver[operation]('source-ended'); resume();
    assert.equal((await pending).ok, false); assert.equal(env.drawn.length, 0);
    assert.equal(env.closedFrames.length, 1); assert.equal(env.decoders[0].state, 'closed'); env.receiver.release();
  }
});

test('source failure preserves actual committed pixels and rejects further frames', async () => {
  const env = await fixture(); await env.receiver.accept(env.packet()); env.receiver.fail('source-ended');
  const state = env.receiver.stats(); assert.equal(state.fallbackKind, 'last-real-frame');
  assert.equal(state.failureLabelVisible, true); assert.equal((await env.receiver.accept(env.packet(2))).reason, 'closed');
  assert.equal(env.drawn.length, 1); env.receiver.release(); assert.equal(env.receiver.stats().removed, true);
});

test('first-frame failure reports empty instead of inventing last-real-frame', async () => {
  const env = await fixture(); env.receiver.fail('scene-failed');
  assert.equal(env.receiver.stats().fallbackKind, 'empty'); env.receiver.release();
});

test('detached encoded surface rejects frames without decoding', async () => {
  const env = await fixture({ detached: true }); assert.equal((await env.receiver.accept(env.packet())).reason, 'detached');
  assert.equal(env.drawn.length, 0); env.receiver.release();
});

test('CPU pixel copy completion after failure or release cannot replace the last surface', async () => {
  for (const operation of ['fail', 'release']) {
    let resume; const copyGate = new Promise((resolve) => { resume = resolve; });
    const env = await fixture({ copyGate }); const pending = env.receiver.accept(env.packet());
    await new Promise((resolve) => setTimeout(resolve, 1)); env.receiver[operation]('source-ended'); resume();
    assert.equal((await pending).ok, false); assert.equal(env.drawn.length, 0);
    assert.equal(env.closedFrames.length, 1); env.receiver.release();
  }
});

test('decoded black pixels fail before canvas commit and cannot erase old frames', async () => {
  const env = await fixture({ black: true }); assert.equal((await env.receiver.accept(env.packet())).ok, false);
  assert.equal(env.drawn.length, 0); assert.equal(env.receiver.stats().fallbackKind, 'empty'); env.receiver.release();
});
