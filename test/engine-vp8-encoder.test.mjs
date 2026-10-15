import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { bindEngineVp8Encoder } from '../src/engine-vp8-encoder.mjs';
import { validateEngineVp8Frame } from '../bridge-runtime/src/engine-vp8-frame.mjs';

const tick = () => new Promise((resolve) => setImmediate(resolve));
function vp8() {
  const bytes = Buffer.alloc(24); bytes[0] = 48; bytes.set([157, 1, 42], 3);
  bytes.writeUInt16LE(800, 6); bytes.writeUInt16LE(450, 8); return bytes;
}
function png() {
  const bytes = Buffer.alloc(40); Buffer.from('89504e470d0a1a0a', 'hex').copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12); bytes.writeUInt32BE(800, 16); bytes.writeUInt32BE(450, 20); return bytes;
}
function fixture(t, { timeoutMs = 1000 } = {}) {
  const ipcMain = new EventEmitter(), webContents = new EventEmitter(), sends = [];
  const wrapperUrl = 'http://127.0.0.1:43123/0123456789abcdef0123456789abcdef';
  let raw = Buffer.alloc(1440000), empty = false;
  webContents.mainFrame = { url: wrapperUrl }; webContents.getURL = () => webContents.mainFrame.url;
  webContents.isDestroyed = () => false; webContents.send = (channel, data) => { sends.push({ channel, data }); };
  const nativeImage = { createFromBuffer: () => ({ isEmpty: () => empty, getSize: () => ({ width: 800, height: 450 }), toBitmap: () => raw }) };
  const encoder = bindEngineVp8Encoder({ ipcMain, webContents, nativeImage, wrapperUrl, timeoutMs });
  t.after(() => encoder.close());
  const event = () => ({ sender: webContents, senderFrame: webContents.mainFrame });
  const reply = (packet = {}, source = event()) => {
    const request = sends.filter((item) => item.channel === 'cwb-engine-vp8-frame-v1').at(-1)?.data;
    ipcMain.emit('cwb-engine-vp8-encoded-v1', source, { ok: true, sequence: request?.sequence, timestamp: request?.timestamp, vp8: vp8(), encodeMs: 1, ...packet });
  };
  const frame = (sequence = 1) => ({ png: png(), sequence, width: 800, height: 450 });
  return { ipcMain, webContents, encoder, sends, reply, frame, event, setRaw: (bytes) => { raw = bytes; }, setEmpty: () => { empty = true; } };
}

test('fixed VP8 envelope checks signature, partition, dimensions, sequence and size', () => {
  const packet = { vp8: vp8(), width: 800, height: 450, sequence: 1, timestamp: 100000 };
  assert.deepEqual(validateEngineVp8Frame(packet), packet);
  for (const extra of [{ sequence: 0 }, { sequence: 2147483648 }, { timestamp: 1 }, { width: 1 }, { height: 1 },
    { vp8: 'https://invalid/' }, { vp8: Buffer.alloc(2097153) }, { vp8: Buffer.alloc(10) }]) assert.throws(() => validateEngineVp8Frame({ ...packet, ...extra }));
  for (const index of [0, 3, 6, 8]) { const bytes = vp8(); bytes[index] ^= 1; assert.throws(() => validateEngineVp8Frame({ ...packet, vp8: bytes })); }
});

test('parent sends only actual native BGRA; legitimate dark pixels encode without a brightness rule', async (t) => {
  const f = fixture(t), pending = f.encoder.encode(f.frame()); f.reply();
  const encoded = await pending;
  assert.ok(encoded.vp8.equals(vp8())); assert.equal(encoded.timestamp, 100000);
  assert.equal(f.sends[0].data.bgra.length, 1440000); assert.equal(f.sends[0].data.bgra.every((value) => value === 0), true);
  assert.equal(f.encoder.status().cachedBytes, 1440000 + 24);
});

test('foreign sender, author subframe, wrong wrapper URL, replay and unrelated replies cannot settle a flight', async (t) => {
  const f = fixture(t); let settled = false;
  const pending = f.encoder.encode(f.frame()).then((value) => { settled = true; return value; });
  f.reply({}, { sender: {}, senderFrame: f.webContents.mainFrame });
  f.reply({}, { sender: f.webContents, senderFrame: { url: f.webContents.getURL() } });
  f.reply({ sequence: 0 }); f.webContents.mainFrame.url += '?untrusted'; f.reply();
  await tick(); assert.equal(settled, false);
  f.webContents.mainFrame.url = f.webContents.mainFrame.url.split('?')[0]; f.reply();
  assert.equal((await pending).sequence, 1);
});

test('one encoding flight has no queue; exact duplicates reuse bytes only at a fresh sequence', async (t) => {
  const f = fixture(t), first = f.encoder.encode(f.frame());
  await assert.rejects(f.encoder.encode(f.frame(2)), /engine_encoder_busy/); f.reply(); await first;
  const second = await f.encoder.encode(f.frame(2)); assert.equal(second.duplicate, true); assert.equal(second.timestamp, 200000);
  assert.equal(f.sends.length, 1); await assert.rejects(f.encoder.encode(f.frame(2)), /invalid_native_frame/);
  f.setRaw(Buffer.alloc(1440000, 1)); const third = f.encoder.encode(f.frame(3)); f.reply();
  assert.equal((await third).duplicate, false); assert.equal(f.sends.length, 2);
});

test('invalid native PNG/decoded data never sends an encode request', async (t) => {
  for (const shape of ['header', 'size', 'decoded', 'empty']) {
    const f = fixture(t), frame = f.frame();
    if (shape === 'header') frame.png[0] ^= 1;
    if (shape === 'size') frame.png = Buffer.alloc(2097153);
    if (shape === 'decoded') f.setRaw(Buffer.alloc(4));
    if (shape === 'empty') f.setEmpty();
    await assert.rejects(f.encoder.encode(frame), /invalid_native_frame/);
    assert.equal(f.sends.filter((item) => item.channel === 'cwb-engine-vp8-frame-v1').length, 0);
  }
});
test('fixed parent-native BGRA path avoids PNG serialization; mixed/invalid buffers are rejected', async (t) => {
  const f = fixture(t), native = { bgra: Buffer.alloc(1440000), width: 800, height: 450, sequence: 1 };
  const pending = f.encoder.encode(native); f.reply(); assert.ok((await pending).vp8.equals(vp8()));
  for (const extra of [{ sequence: 2, bgra: Buffer.alloc(4) }, { sequence: 2, png: png() }]) await assert.rejects(f.encoder.encode({ ...native, ...extra }), /invalid_native_frame/);
});

test('invalid current keyframe/timestamp and reported codec failure seal the encoder', async (t) => {
  for (const packet of [{ vp8: Buffer.alloc(24) }, { timestamp: 1 }, { ok: false, reason: 'arbitrary author/path' }]) {
    const f = fixture(t), pending = f.encoder.encode(f.frame()); f.reply(packet);
    await assert.rejects(pending, /engine_encode_failed/);
    assert.equal(f.encoder.status().closed, true); assert.equal(f.encoder.status().cachedBytes, 0);
    assert.equal(f.ipcMain.listenerCount('cwb-engine-vp8-encoded-v1'), 0);
  }
});

test('deadline, explicit release and native renderer crash reject pending work and clear listeners/cache', async (t) => {
  for (const kind of ['deadline', 'release', 'crash']) {
    const f = fixture(t, { timeoutMs: 20 }), pending = f.encoder.encode(f.frame());
    if (kind === 'release') { f.encoder.close(); f.encoder.close(); f.reply(); }
    if (kind === 'crash') f.webContents.emit('render-process-gone');
    await assert.rejects(pending, /engine_encode_timeout|engine_encoder_closed/);
    assert.equal(f.encoder.status().cachedBytes, 0); assert.equal(f.encoder.status().pending, 0);
    assert.equal(f.webContents.listenerCount('render-process-gone'), 0);
    assert.equal(f.ipcMain.listenerCount('cwb-engine-vp8-encoded-v1'), 0);
    await assert.rejects(f.encoder.encode(f.frame(2)), /engine_encoder_closed/);
  }
});

test('returned byte mutation cannot corrupt the cached genuine keyframe', async (t) => {
  const f = fixture(t), pending = f.encoder.encode(f.frame()); f.reply(); const first = await pending;
  first.vp8.fill(0); const second = await f.encoder.encode(f.frame(2)); assert.ok(second.vp8.equals(vp8()));
  f.encoder.close(); assert.equal(f.encoder.status().cachedBytes, 0);
});
