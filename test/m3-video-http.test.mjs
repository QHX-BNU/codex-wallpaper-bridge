import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, open, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { request as httpRequest } from 'node:http';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { faststartLayout, layoutChunks } from '../bridge-runtime/src/video-stream.mjs';
import { buildInjectionPlan } from '../bridge-overrides/src/injection-plan.mjs';
const atom = (type, data = Buffer.alloc(0)) => { const header = Buffer.alloc(8); header.writeUInt32BE(data.length + 8); header.write(type, 4); return Buffer.concat([header, data]); };
const ftyp = atom('ftyp', Buffer.from('isom0000')), mdat = atom('mdat', Buffer.from('test video bytes'));
const stco = Buffer.alloc(12); stco.writeUInt32BE(1, 4); stco.writeUInt32BE(ftyp.length + 8, 8);
const sourceBytes = Buffer.concat([ftyp, mdat, atom('moov', atom('trak', atom('mdia', atom('minf', atom('stbl', atom('stco', stco))))))]);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-video-http-')); t.after(() => rm(root, { force: true, recursive: true }));
  const file = path.join(root, 'original.mp4'); await writeFile(file, sourceBytes);
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load(); let probes = 0;
  const tools = { status: () => ({ available: null, encoders: [], hardwareVerified: false }),
    probeCapabilities: async () => { probes++; return { available: true, encoders: ['libx264'] }; },
    probe: async () => ({ duration: 1, width: 2, height: 2, fps: 30, codec: 'h264', hasAudio: false }),
    transcode: async (from, to, input, options, encoder, { onProgress }) => {
      const changed = Buffer.from(sourceBytes); changed[ftyp.length + 9] = 88; await writeFile(to, changed); onProgress(.8);
    }, close: async () => ({ remaining: 0, clean: true }) };
  const server = createMediaServer({ configStore: store, videoTools: tools, cacheEnv: {}, projects: [
    { id: 'video', type: 'video', playable: true, rootPath: root, mediaPath: file, source: 'workshop' },
    { id: 'escape', type: 'video', playable: true, rootPath: path.join(root, 'other'), mediaPath: file },
  ] }); await server.start(); t.after(() => server.close());
  const api = async (route, body, method = body === undefined ? 'GET' : 'POST', headers = {}) => {
    const response = await fetch(new URL(`api/${route}`, server.baseUrl), { method,
      headers: { 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await response.text(); let payload;
    try { payload = JSON.parse(text); } catch { payload = { error: text }; }
    return { status: response.status, ...payload };
  };
  const url = async () => new URL((await api('inventory')).projects.find(p => p.id === 'video').mediaUrl, server.origin);
  const finish = async id => { for (let n = 0; n < 200; n++) {
    const result = (await api(`video-jobs/${id}`)).job;
    if (['failed', 'cancelled', 'completed'].includes(result.status)) return result;
    await new Promise(resolve => setTimeout(resolve, 5));
  } throw Error('job_wait_timeout'); };
  return { root, store, file, api, url, server, finish, probes: () => probes };
}
test('inventory pins layouts; every old Range URL stays stable when Faststart setting changes', async t => {
  const { api, url, file, store, server } = await fixture(t), first = await url(); assert.match(first.search, /^\?v=[a-f0-9]{64}$/);
  const plan = buildInjectionPlan({ inventory: await api('inventory'), config: store.get(), server });
  assert.match(plan.applyScript, /\?v=[a-f0-9]{64}/); assert.ok(plan.metrics.applyBytes < 10 * 1024);
  assert.doesNotMatch(plan.applyScript, /original\.mp4|cwb-video-http|cache\/video|directory/);
  const front = Buffer.from(await (await fetch(first)).arrayBuffer()); assert.notDeepEqual(front, sourceBytes);
  const handle = await open(file, 'r'); const chunks = [];
  try { for await (const b of layoutChunks(handle, await faststartLayout(handle, sourceBytes.length))) chunks.push(b); } finally { await handle.close(); }
  assert.deepEqual(front, Buffer.concat(chunks));
  await api('config', { video: { faststart: false } }); const second = await url(); assert.notEqual(first.href, second.href);
  assert.deepEqual(Buffer.from(await (await fetch(second)).arrayBuffer()), sourceBytes);
  assert.deepEqual(Buffer.from(await (await fetch(first)).arrayBuffer()), front); assert.deepEqual(await readFile(file), sourceBytes);
});
test('versioned GET/HEAD/suffix/If-Range/416 and stale version are byte-correct; unversioned original never changes layout', async t => {
  const { url, server } = await fixture(t), pinned = await url();
  const whole = await fetch(pinned), etag = whole.headers.get('ETag'), data = Buffer.from(await whole.arrayBuffer());
  assert.equal(whole.headers.get('X-CWB-Video-Layout'), 'faststart');
  for (const range of ['bytes=1-19', 'bytes=-9', 'bytes=10-']) {
    const response = await fetch(pinned, { headers: { Range: range } }); assert.equal(response.status, 206);
    const match = /bytes (\d+)-(\d+)\/(\d+)/.exec(response.headers.get('Content-Range'));
    assert.deepEqual(Buffer.from(await response.arrayBuffer()), data.subarray(Number(match[1]), Number(match[2]) + 1));
  }
  const head = await fetch(pinned, { method: 'HEAD', headers: { Range: 'bytes=1-19' } }); assert.equal(head.status, 206); assert.equal(head.headers.get('Content-Length'), '19');
  for (const range of ['bytes=0-1,2-3', 'bytes=999999-', 'bytes=-0', 'items=0-3']) assert.equal((await fetch(pinned, { headers: { Range: range } })).status, 416);
  assert.equal((await fetch(pinned, { headers: { Range: 'bytes=0-3', 'If-Range': etag } })).status, 206);
  assert.equal((await fetch(pinned, { headers: { Range: 'bytes=0-3', 'If-Range': 'other' } })).status, 200);
  assert.equal((await fetch(new URL(`api/video/video?v=${'a'.repeat(64)}`, server.baseUrl))).status, 410);
  assert.equal((await fetch(new URL('api/video/escape', server.baseUrl))).status, 404);
  assert.equal((await fetch(new URL(pinned.pathname.replace(server.basePath, '/wrong'), server.origin))).status, 404);
  pinned.search = ''; assert.deepEqual(Buffer.from(await (await fetch(pinned)).arrayBuffer()), sourceBytes);
});
test('optimize init/poll then explicit apply creates new URL, old original stays playable through cache migration', async t => {
  const { api, url, file, finish, root, store } = await fixture(t), original = await url();
  const old = Buffer.from(await (await fetch(original)).arrayBuffer());
  const created = await api('video-jobs', { id: 'video', options: { fpsCap: 30, encoder: 'software' } }); assert.equal(created.status, 202);
  assert.equal((await finish(created.job.id)).status, 'completed'); assert.equal((await url()).href, original.href);
  await api('config', { video: { encoder: 'software', useOptimized: true } }); const optimized = await url();
  assert.notEqual(optimized.href, original.href); const data = Buffer.from(await (await fetch(optimized)).arrayBuffer()); assert.notDeepEqual(data, old);
  const parent = path.join(root, 'cache-destination'); await mkdir(parent);
  const migration = await api('cache/jobs', { directory: parent }); assert.equal(migration.status, 202);
  for (let n = 0; n < 200; n++) { const job = (await api(`cache/jobs/${migration.job.id}`)).job; if (job.status === 'completed') break;
    assert.notEqual(job.status, 'failed', job.error); await new Promise(resolve => setTimeout(resolve, 5)); }
  assert.equal(store.get().cache.directory, path.join(parent, 'CodexWallpaperBridge-cache'));
  assert.deepEqual(Buffer.from(await (await fetch(optimized)).arrayBuffer()), data);
  assert.deepEqual(Buffer.from(await (await fetch(original)).arrayBuffer()), old); assert.deepEqual(await readFile(file), sourceBytes);
  assert.equal((await api('cache')).actualDirectory, store.get().cache.directory);
});
test('token/origin/Host/method/policy and dedicated path settings gate ffmpeg/cache operations', async t => {
  const { api, store, probes, root, server } = await fixture(t);
  const before = store.get();
  for (const body of [{ cache: { directory: root } }, { video: { fpsCap: 999 } }, { video: { faststart: 'true' } }, { video: { tool: 'command' } }]) {
    assert.equal((await api('config', body)).status, 400); assert.deepEqual(store.get(), before);
  }
  assert.equal((await api('video-jobs', { id: 'missing' })).status, 404);
  assert.equal((await api('video-jobs', { id: 'escape' })).status, 404);
  assert.equal((await api('video-jobs', { id: 'video', path: root })).status, 400);
  assert.equal((await api('video-tools/probe', {}, 'POST', { Origin: 'https://evil.invalid' })).status, 403);
  // Node fetch overwrites Host. Send a raw HTTP request to exercise the actual gate.
  const hostStatus = await new Promise((resolve, reject) => {
    const req = httpRequest(new URL('api/cache/jobs', server.baseUrl), { method: 'POST',
      headers: { Host: 'other.invalid', 'Content-Type': 'application/json' } }, res => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify({ directory: root }));
  });
  assert.equal(hostStatus, 403);
  assert.equal(probes(), 0); assert.equal((await api('video-tools/probe', undefined, 'GET')).status, 405);
  assert.equal((await api('video-tools/probe', {})).status, 200); assert.equal(probes(), 1);
  assert.equal((await api('cache/jobs', { directory: root, unknown: true })).status, 400);
});
