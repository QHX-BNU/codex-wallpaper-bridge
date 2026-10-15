import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { validateSceneVp8Keyframe } from '../scripts/m2-vp8-transfer.mjs';

const helper = await readFile(new URL('../scripts/verify-m2-vp8-transfer.cjs', import.meta.url), 'utf8');
const ipcCode = helper.slice(helper.indexOf('  const approvedSender ='), helper.indexOf("  ipcMain.on('cwb-m2-vp8-encoded'"));

function fixture() {
  const frame = { url: 'http://127.0.0.1:1234/' + 'c'.repeat(32) };
  const webContents = { mainFrame: frame }, transfer = { ipcRejected: 0 }, accepted = [], rejected = [];
  const pendingEncode = { sequence: 2, timer: null, resolve: (value) => accepted.push(value), reject: (error) => rejected.push(error) };
  const context = { source: { isDestroyed: () => false, webContents }, transfer,
    wrapperOrigin: 'http://127.0.0.1:1234', nonce: 'c'.repeat(32), pendingEncode, pendingStop: null,
    assert, Buffer, Uint8Array, validateSceneVp8Keyframe, clearTimeout };
  const fn = vm.runInNewContext(ipcCode + '\n({encoded,approvedSender})', context);
  const bytes = Buffer.alloc(20); bytes[0] = 48; bytes.set([157, 1, 42], 3); bytes.writeUInt16LE(800, 6); bytes.writeUInt16LE(450, 8);
  const event = { sender: webContents, senderFrame: frame };
  const packet = { ok: true, sequence: 2, timestamp: 200000, vp8: bytes, encodeMs: 2 };
  return { fn, context, event, packet, transfer, accepted, rejected };
}

test('native IPC accepts only the owned primary frame, exact wrapper URL and current sequence', () => {
  const env = fixture();
  for (const event of [{ sender: {}, senderFrame: env.event.senderFrame },
    { sender: env.event.sender, senderFrame: { url: env.event.senderFrame.url } },
    { sender: env.event.sender, senderFrame: null }]) env.fn.encoded(event, env.packet);
  env.fn.encoded(env.event, { ...env.packet, sequence: 1 });
  assert.equal(env.transfer.ipcRejected, 4); assert.equal(env.accepted.length, 0);
  env.fn.encoded(env.event, env.packet); assert.equal(env.accepted.length, 1); assert.equal(env.rejected.length, 0);
  env.fn.encoded(env.event, env.packet); assert.equal(env.transfer.ipcRejected, 5);
});

test('changed main-frame URL and destroyed source cannot submit encoded bytes', () => {
  const env = fixture(); env.event.senderFrame.url += '/author';
  assert.equal(env.fn.approvedSender(env.event), false);
  env.event.senderFrame.url = env.context.wrapperOrigin + '/' + env.context.nonce;
  env.context.source.isDestroyed = () => true; assert.equal(env.fn.approvedSender(env.event), false);
});

test('owned IPC validates timestamp, byte bounds and VP8 header before forwarding', () => {
  for (const change of [{ timestamp: 0 }, { vp8: Buffer.from('<script>') }, { vp8: new Uint8Array(2097153) }, { encodeMs: NaN }]) {
    const env = fixture(); env.fn.encoded(env.event, { ...env.packet, ...change });
    assert.equal(env.accepted.length, 0); assert.equal(env.rejected.length, 1);
  }
});

test('black native capture fails once before encoding or committing and preserves evidence', async () => {
  const source = helper.slice(helper.indexOf('  const sendFrame = async'), helper.indexOf('  const processMetrics = async'));
  let captures = 0; const calls = [], saved = [];
  const context = { performance, Buffer, path, assert, root: path.resolve('out'), transfer: {},
    source: { webContents: { capturePage: async () => { captures++; return {
      resize: () => ({ toBitmap: () => Buffer.alloc(1440000), toPNG: () => Buffer.from('native PNG evidence') }) }; } } },
    bounded: async (value) => value, difference: () => ({ nonblackRatio: 0 }),
    fs: { writeFile: async (name) => saved.push(name) }, callReceiver: async (method) => { calls.push(method); },
    encode: () => { throw Error('must not encode a black capture'); } };
  await assert.rejects(vm.runInNewContext('let sequence=0,lastEncoded;\n' + source + '\nsendFrame("black")', context), /capture was black/);
  assert.equal(captures, 1); assert.deepEqual(calls, ['fail']); assert.ok(saved[0].endsWith('rejected-black-capture-1.png'));
});

test('only byte-identical native captures may reuse a genuine keyframe; any changed byte is re-encoded', async () => {
  const source = helper.slice(helper.indexOf('  const sendFrame = async'), helper.indexOf('  const processMetrics = async'));
  const a = Buffer.alloc(1440000, 100), b = Buffer.from(a), c = Buffer.from(a); c[0]++;
  const captures = [a, b, c], transfer = { exactRawDuplicates: 0 }; let encoded = 0;
  const context = { performance, Buffer, assert, transfer, bounded: async (value) => value,
    source: { webContents: { capturePage: async () => ({ resize: () => ({ toBitmap: () => captures.shift() }) }) } },
    difference: () => ({ nonblackRatio: 1 }), encode: async () => { encoded++; return { bytes: Buffer.alloc(20), encodeMs: 1 }; },
    callReceiver: async (_method, [packet]) => ({ ok: true, sequence: packet.sequence, decodeMs: 1, submitMs: 0, flushMs: 0, copyMs: 0, drawMs: 0 }) };
  const frames = await vm.runInNewContext('let sequence=0,lastEncoded,lastRaw;\n' + source + '\n(async()=>[await sendFrame(),await sendFrame(),await sendFrame()])()', context);
  assert.equal(encoded, 2); assert.equal(transfer.exactRawDuplicates, 1);
  assert.deepEqual(Array.from(frames, (frame) => frame.duplicate), [false, true, false]);
});
