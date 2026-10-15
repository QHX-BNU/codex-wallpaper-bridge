import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, open, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { faststartLayout, layoutChunks, VideoVersions } from '../bridge-runtime/src/video-stream.mjs';

const box = (type, data = Buffer.alloc(0)) => {
  const header = Buffer.alloc(8); header.writeUInt32BE(8 + data.length); header.write(type, 4);
  return Buffer.concat([header, data]);
};
export function mp4Fixture({ wide = false, leading = false, fragment = false, invalid = false } = {}) {
  const ftyp = box('ftyp', Buffer.from('isom0000isom'));
  const mdat = box('mdat', Buffer.from('0123456789abcdefghijklmnop'));
  const offset = ftyp.length + 8;
  const table = Buffer.alloc(wide ? 16 : 12); table.writeUInt32BE(1, 4);
  if (wide) table.writeBigUInt64BE(BigInt(invalid ? 3 : offset), 8); else table.writeUInt32BE(invalid ? 3 : offset, 8);
  const moov = box('moov', fragment ? box('mvex') : box('trak', box('mdia', box('minf', box('stbl', box(wide ? 'co64' : 'stco', table))))));
  return { bytes: Buffer.concat(leading ? [ftyp, moov, mdat] : [ftyp, mdat, moov]), ftyp, mdat, moov, offset };
}
async function fixture(t, data) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-faststart-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, 'video.mp4'); await writeFile(file, data);
  const handle = await open(file, 'r'); t.after(() => handle.close());
  return { file, handle, info: await handle.stat() };
}
const bytes = async (handle, layout, start = 0, end = layout.size - 1) => {
  const chunks = []; for await (const chunk of layoutChunks(handle, layout, start, end)) chunks.push(chunk);
  return Buffer.concat(chunks);
};
for (const wide of [false, true]) test(`virtual moov first fixes ${wide ? 'co64' : 'stco'} and every split Range, no original write`, async t => {
  const source = mp4Fixture({ wide }); const { handle, info, file } = await fixture(t, source.bytes);
  const layout = await faststartLayout(handle, info.size);
  assert.equal(layout.kind, 'faststart'); assert.equal(layout.size, info.size);
  const expectedMoov = Buffer.from(source.moov), pos = expectedMoov.length - (wide ? 8 : 4);
  if (wide) expectedMoov.writeBigUInt64BE(BigInt(source.offset + source.moov.length), pos);
  else expectedMoov.writeUInt32BE(source.offset + source.moov.length, pos);
  const expected = Buffer.concat([source.ftyp, expectedMoov, source.mdat]);
  assert.deepEqual(await bytes(handle, layout), expected);
  for (let start = 0; start < expected.length; start++) for (const length of [1, 9, 30]) {
    const end = Math.min(expected.length - 1, start + length - 1);
    assert.deepEqual(await bytes(handle, layout, start, end), expected.subarray(start, end + 1));
  }
  assert.equal(layout.memoryBytes, source.moov.length);
  assert.deepEqual(await readFile(file), source.bytes);
});
for (const options of [{ leading: true }, { fragment: true }, { invalid: true }]) test(`unsupported/already-front layout stays byte-identical ${JSON.stringify(options)}`, async t => {
  const source = mp4Fixture(options); const { handle, info } = await fixture(t, source.bytes);
  const layout = await faststartLayout(handle, info.size);
  assert.equal(layout.kind, 'original'); assert.deepEqual(await bytes(handle, layout), source.bytes);
});
test('malformed/huge boxes and truncated headers fail closed to original with bounded reads', async t => {
  const source = mp4Fixture(); source.bytes.writeUInt32BE(0xffffffff, source.ftyp.length + source.mdat.length);
  const { handle, info } = await fixture(t, source.bytes);
  assert.equal((await faststartLayout(handle, info.size)).kind, 'original');
  assert.equal((await faststartLayout(handle, info.size, { maxMoovBytes: 1 })).kind, 'original');
});
test('zero-size tail moov is not moved as an extend-to-EOF box; extended headers and unsafe chunk values stay safe', async t => {
  const source = mp4Fixture(); source.bytes.writeUInt32BE(0, source.ftyp.length + source.mdat.length);
  const { handle, info } = await fixture(t, source.bytes);
  assert.equal((await faststartLayout(handle, info.size)).kind, 'original');
  const big = mp4Fixture({ wide: true }); big.bytes.writeBigUInt64BE(2n ** 63n, big.bytes.length - 8);
  const other = await fixture(t, big.bytes); assert.equal((await faststartLayout(other.handle, other.info.size)).kind, 'original');
});
test('layout preparation reads headers/moov only for a large source, and concurrent reader capacity recovers on close', async t => {
  const source = mp4Fixture(), { handle, file } = await fixture(t, source.bytes);
  const dataSize = 16 * 1024 * 1024, writer = await open(file, 'r+');
  try {
    await writer.truncate(source.ftyp.length + 8 + dataSize + source.moov.length);
    const header = Buffer.alloc(8); header.writeUInt32BE(dataSize + 8); header.write('mdat', 4);
    await writer.write(header, 0, 8, source.ftyp.length); await writer.write(source.moov, 0, source.moov.length, source.ftyp.length + 8 + dataSize);
  } finally { await writer.close(); }
  let requested = 0; const size = (await handle.stat()).size;
  const layout = await faststartLayout({ read: (...args) => { requested += args[2]; return handle.read(...args); } }, size);
  assert.equal(layout.kind, 'faststart'); assert.ok(requested <= source.moov.length + 48); assert.equal(layout.memoryBytes, source.moov.length);
  const versions = new VideoVersions(); t.after(() => versions.close()); const key = await versions.pin('large', file);
  const readers = await Promise.all(Array.from({ length: 32 }, () => versions.open('large', key)));
  await assert.rejects(versions.open('large', key), /video_reader_capacity/);
  await Promise.all(readers.map(r => r.handle.close())); const again = await versions.open('large', key); await again.handle.close();
});
test('version pins byte layout across flag changes, rejects changed file, expired token never rebinds', async t => {
  const { file } = await fixture(t, mp4Fixture().bytes);
  const versions = new VideoVersions({ maxSessions: 2 });
  t.after(() => versions.close());
  const a = await versions.pin('a', file, { faststart: true });
  const b = await versions.pin('a', file, { faststart: false });
  assert.notEqual(a, b); assert.equal(a, await versions.pin('a', file, { faststart: true }));
  const original = await versions.open('a', b); assert.equal(original.layout.kind, 'original'); await original.handle.close();
  const front = await versions.open('a', a); assert.equal(front.layout.kind, 'faststart'); await front.handle.close();
  await assert.rejects(versions.open('other', a), /video_version_unavailable/);
  await writeFile(file, Buffer.from('changed'));
  await assert.rejects(versions.open('a', a), /video_source_changed/);
  await assert.rejects(versions.pin('b', file), /video_version_capacity/);
});
test('expired version is never reissued for the same file/flags after capacity eviction', async t => {
  const { file } = await fixture(t, mp4Fixture().bytes); let now = 0;
  const versions = new VideoVersions({ maxSessions: 1, now: () => now }); t.after(() => versions.close());
  const old = await versions.pin('a', file);
  now += 2 * 60 * 60 * 1000 + 1; await versions.pin('b', file);
  await assert.rejects(versions.open('a', old), /video_version_unavailable/);
  now += 2 * 60 * 60 * 1000 + 1; const fresh = await versions.pin('a', file);
  assert.notEqual(fresh, old); await assert.rejects(versions.open('a', old), /video_version_unavailable/);
});
