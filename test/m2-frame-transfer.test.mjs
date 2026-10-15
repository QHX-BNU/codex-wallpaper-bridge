import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { carrierPerformanceGate, installFrameReceiver, normalizeSceneCapture, validateScenePng } from '../scripts/m2-frame-transfer.mjs';

const nonce = 'a'.repeat(32);
function png(width = 800, height = 450) {
  const bytes = Buffer.alloc(40);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes);
  bytes.writeUInt32BE(13, 8); bytes.write('IHDR', 12);
  bytes.writeUInt32BE(width, 16); bytes.writeUInt32BE(height, 20);
  return bytes;
}
function fixture({ decodeError = false, decodeGate, detached = false, carrier = 'blob' } = {}) {
  const drawn = [], live = new Set(), revoked = [], nodes = [];
  const body = { append: (node) => { nodes.push(node); node.isConnected = !detached; } };
  const document = { body, getElementById: () => null, createElement: (tag) => ({
    tag, style: {}, append() {}, isConnected: true,
    getContext: () => ({ drawImage: (...args) => drawn.push(args) }),
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 450 }),
    remove() { this.isConnected = false; },
  }) };
  let count = 0;
  const URL = { createObjectURL: () => { const value = 'blob:' + (++count); live.add(value); return value; },
    revokeObjectURL: (value) => { revoked.push(value); live.delete(value); } };
  class Image {
    naturalWidth = 800; naturalHeight = 450;
    async decode() { if (decodeGate) await decodeGate; if (decodeError) throw Error('fixture decoder failed'); }
  }
  const receiver = vm.runInNewContext(`(${installFrameReceiver.toString()})(${JSON.stringify({ nonce, carrier })})`, {
    document, URL, Image, Blob, Uint8Array, atob, performance,
  });
  const packet = (sequence = 1) => ({ sequence, png: png().toString('base64') });
  return { receiver, packet, drawn, live, revoked, nodes };
}

test('pixel carrier validates exact PNG / IHDR / dimensions and maximum size', () => {
  assert.deepEqual(validateScenePng(png()), { width: 800, height: 450, bytes: 40 });
  for (const bytes of [Buffer.alloc(0), Buffer.from('<script>'), png(799), png(800, 451), Buffer.alloc(2097153)]) {
    assert.throws(() => validateScenePng(bytes), /PNG/);
  }
  const bad = png(); bad[12] = 0; assert.throws(() => validateScenePng(bad), /PNG/);
});

test('high-DPI trusted captures are resized before protocol validation, never using lazy GPU bitmaps', () => {
  let resized = false;
  const bytes = normalizeSceneCapture({
    toPNG: () => png(1200, 675),
    toBitmap: () => { throw Error('must not use a lazy GPU bitmap'); },
    resize: (options) => { assert.deepEqual(options, { width: 800, height: 450, quality: 'best' }); resized = true; return { toPNG: () => png() }; },
  });
  assert.equal(resized, true); assert.equal(bytes.readUInt32BE(16), 800);
});

test('performance misses remain failures while the lifecycle verifier may continue collecting evidence', () => {
  const stream = { deliveredFps: 4, durationMs: 6000, captureToAckMs: { p95: 749 } };
  assert.equal(carrierPerformanceGate(stream).passed, true);
  for (const sample of [null, { ...stream, deliveredFps: 3.99 }, { ...stream, durationMs: 5999 },
    { ...stream, captureToAckMs: { p95: 750 } }, { ...stream, deliveredFps: NaN }]) {
    assert.equal(carrierPerformanceGate(sample).passed, false);
  }
});

test('a black trusted capture fails before acceptance and retains an explicit failure artifact, without selecting another frame', async () => {
  const helper = await readFile(new URL('../scripts/verify-m2-frame-transfer.cjs', import.meta.url), 'utf8');
  const source = helper.slice(helper.indexOf('  const sendFrame = async'), helper.indexOf('  const processMetrics = async'));
  const calls = [], saved = []; let captures = 0;
  const pending = vm.runInNewContext('let sequence=0,lastSourcePng;\n' + source + '\nsendFrame("black-fixture")', {
    performance, Buffer, path, root: path.resolve('out'), transfer: {},
    source: { webContents: { capturePage: async () => { captures++; return {}; } } },
    bounded: async (value) => value, normalizeSceneCapture: () => png(), decode: () => Buffer.alloc(4),
    difference: () => ({ nonblackRatio: 0 }),
    fs: { writeFile: async (name) => saved.push(name) },
    callReceiver: async (method) => { calls.push(method); },
  });
  await assert.rejects(pending, /capture was black/);
  assert.deepEqual(calls, ['fail']); assert.equal(captures, 1);
  assert.ok(saved[0].endsWith('rejected-black-capture-1.png'));
});

test('receiver decodes only image bytes, commits pixels and revokes the blob', async () => {
  const env = fixture();
  const result = await env.receiver.accept(env.packet());
  assert.equal(result.ok, true); assert.equal(result.sequence, 1);
  assert.equal(env.drawn.length, 1); assert.equal(env.live.size, 0);
  assert.equal(env.receiver.stats().phase, 'ready');
});

test('data carrier accepts only header-bounded PNG and creates no blob URLs', async () => {
  const env = fixture({ carrier: 'data' });
  assert.equal((await env.receiver.accept(env.packet())).ok, true);
  assert.equal(env.drawn.length, 1); assert.equal(env.revoked.length, 0);
  assert.equal((await env.receiver.accept({ sequence: 2, png: png(801).toString('base64') })).ok, false);
  env.receiver.release(); assert.equal(env.live.size, 0);
});

test('receiver rejects URLs, script text, malformed PNG, oversize and invalid sequence without decode', async () => {
  const env = fixture();
  for (const packet of [null, [], { sequence: 1, png: 'https://example.com/' },
    { sequence: 1, png: Buffer.from('<script>').toString('base64') },
    { sequence: 1, png: png(801).toString('base64') },
    { sequence: 1, png: 'A'.repeat(2796208) }, env.packet(0), env.packet(-1), env.packet(1.5), env.packet(Infinity)]) {
    assert.equal((await env.receiver.accept(packet)).ok, false);
  }
  assert.equal(env.drawn.length, 0); assert.equal(env.live.size, 0);
});

test('stale / duplicate frames cannot replace the last committed frame', async () => {
  const env = fixture(); await env.receiver.accept(env.packet(4));
  assert.equal((await env.receiver.accept(env.packet(4))).reason, 'stale');
  assert.equal((await env.receiver.accept(env.packet(3))).reason, 'stale');
  assert.equal(env.drawn.length, 1); assert.equal(env.receiver.stats().sequence, 4);
});

test('slow decoder has at most one frame in flight and no backlog', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; });
  const env = fixture({ decodeGate: gate }); const pending = env.receiver.accept(env.packet());
  assert.equal((await env.receiver.accept(env.packet(2))).reason, 'busy');
  assert.equal(env.live.size, 1); resume(); await pending;
  assert.equal(env.live.size, 0); assert.equal(env.drawn.length, 1);
});

test('decode failure preserves the last surface and releases the temporary blob', async () => {
  const env = fixture({ decodeError: true });
  assert.equal((await env.receiver.accept(env.packet())).reason, 'decode');
  assert.equal(env.drawn.length, 0); assert.equal(env.live.size, 0);
});

test('failed source keeps the actual committed pixels and rejects subsequent frames', async () => {
  const env = fixture(); await env.receiver.accept(env.packet());
  env.receiver.fail('source-ended');
  assert.equal(env.receiver.stats().fallbackKind, 'last-real-frame');
  assert.equal(env.receiver.stats().phase, 'failed');
  assert.equal((await env.receiver.accept(env.packet(2))).reason, 'closed');
  assert.equal(env.drawn.length, 1);
});

test('a first-frame failure cannot claim to have a last real frame', () => {
  const env = fixture(); env.receiver.fail('scene-failed');
  assert.equal(env.receiver.stats().fallbackKind, 'empty');
});

test('release is idempotent and late decode cannot commit or retain blob references', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; });
  const env = fixture({ decodeGate: gate }); const pending = env.receiver.accept(env.packet());
  env.receiver.release(); env.receiver.release(); resume();
  assert.equal((await pending).reason, 'closed');
  assert.equal(env.drawn.length, 0); assert.equal(env.live.size, 0);
  assert.equal(env.receiver.stats().removed, true);
  assert.equal((await env.receiver.accept(env.packet(2))).reason, 'closed');
});

test('a failure during decode cannot replace previously committed pixels', async () => {
  let resume; const gate = new Promise((resolve) => { resume = resolve; });
  const env = fixture({ decodeGate: gate }); const pending = env.receiver.accept(env.packet());
  env.receiver.fail('source-ended'); resume(); await pending;
  assert.equal(env.drawn.length, 0); assert.equal(env.live.size, 0);
});

test('a detached owned surface cannot commit even a valid image', async () => {
  const env = fixture({ detached: true });
  assert.equal((await env.receiver.accept(env.packet())).reason, 'detached');
  assert.equal(env.drawn.length, 0);
});
