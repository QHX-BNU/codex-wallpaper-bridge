import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { performance } from 'node:perf_hooks';
import { createHash } from 'node:crypto';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { VideoTools } from '../bridge-runtime/src/video-tools.mjs';
import { digestFile } from '../bridge-runtime/src/managed-cache.mjs';
import { faststartLayout } from '../bridge-runtime/src/video-stream.mjs';

// No Codex, capture, GUI, WE media or downloads. Metrics describe this fixture,
// not click-to-visible-frame performance. Native phase needs installed tools.
const run = process.argv[2] || 'baseline-01';
if (!/^[a-z][a-z0-9-]{0,79}$/.test(run)) throw Error('baseline_run_invalid');
const root = path.resolve('out/m3-b-20261014', run); await mkdir(root, { recursive: false });
const sourceFiles = ['config-store', 'media-server', 'managed-cache', 'video-tools', 'video-optimizer', 'video-stream'].map(file => `bridge-runtime/src/${file}.mjs`);
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const tools = new VideoTools(), capabilities = await tools.probeCapabilities();
const report = { scope: 'isolated owned synthetic source', realCodexOperated: false, systemAudioCaptured: false,
  visibleFirstFrameMeasured: false, thresholdsDefined: false, sourceHashes, capabilities, native: { measured: false }, structural: null, toolClose: null };
const atom = (type, payload = Buffer.alloc(0)) => { const b = Buffer.alloc(8); b.writeUInt32BE(8 + payload.length); b.write(type, 4); return Buffer.concat([b, payload]); };
const ftyp = atom('ftyp', Buffer.from('isom0000')), dataBytes = 16 * 1024 * 1024;
const table = Buffer.alloc(12); table.writeUInt32BE(1, 4); table.writeUInt32BE(ftyp.length + 8, 8);
const moov = atom('moov', atom('trak', atom('mdia', atom('minf', atom('stbl', atom('stco', table))))));
const file = path.join(root, 'structural.mp4'), handle = await open(file, 'wx');
try {
  await handle.truncate(ftyp.length + 8 + dataBytes + moov.length);
  await handle.write(ftyp, 0, ftyp.length, 0); const mdatHeader = atom('mdat'); mdatHeader.writeUInt32BE(dataBytes + 8);
  await handle.write(mdatHeader, 0, 8, ftyp.length); await handle.write(moov, 0, moov.length, ftyp.length + 8 + dataBytes);
} finally { await handle.close(); }
const info = await stat(file), originalHash = await digestFile(file);
const reader = await open(file, 'r'); let readBytes = 0; const started = performance.now();
try {
  const layout = await faststartLayout({ read: (...args) => { readBytes += args[2]; return reader.read(...args); } }, info.size);
  if (layout.kind !== 'faststart' || readBytes > moov.length + 3 * 16) throw Error('structural_read_bound_failed');
  report.structural = { validDecoderVideo: false, fixtureBytes: info.size, moovBytes: moov.length, preparationReadBytes: readBytes,
    preparationWallMs: performance.now() - started, retainedLayoutBytes: layout.memoryBytes, copiedFullVideo: false, rangeResponseWallMs: [] };
} finally { await reader.close(); }
const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load();
const projects = [{ id: 'structural', type: 'video', rootPath: root, mediaPath: file, playable: true }];
let server;
try {
  if (capabilities.available && capabilities.encoders.includes('libx264')) {
    const source = path.join(root, 'synthetic-720p60.mp4'), generated = performance.now();
    await tools.run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-f', 'lavfi', '-i', 'testsrc2=size=1280x720:rate=60',
      '-t', '5', '-c:v', 'libx264', '-threads', '2', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p', '-an', '-y', source], { timeoutMs: 60000 });
    report.native = { measured: true, generationWallMs: performance.now() - generated, source: await tools.probe(source), sourceHash: await digestFile(source) };
    projects.push({ id: 'native', type: 'video', rootPath: root, mediaPath: source, playable: true });
  } else { report.native.reason = capabilities.error || 'libx264_unavailable'; process.exitCode = 2; }
  server = createMediaServer({ projects, configStore: store, videoTools: tools, cacheEnv: {} }); await server.start();
  const api = async (route, body) => {
    const response = await fetch(new URL(`api/${route}`, server.baseUrl), { method: body ? 'POST' : 'GET',
      headers: { 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const value = await response.json(); if (!response.ok) throw Error(value.error || 'benchmark_http_failed'); return value;
  };
  const inventory = await api('inventory'), structural = inventory.projects.find(p => p.id === 'structural');
  for (const start of [0, ftyp.length + moov.length - 4, Math.floor(info.size / 2), info.size - 4096]) {
    const then = performance.now(), response = await fetch(new URL(structural.mediaUrl, server.origin), { headers: { Range: `bytes=${start}-${start + 4095}` } });
    const bytes = Buffer.from(await response.arrayBuffer()); if (response.status !== 206 || bytes.length !== 4096) throw Error('benchmark_range_failed');
    report.structural.rangeResponseWallMs.push(performance.now() - then);
  }
  if (report.native.measured) {
    const start = performance.now(), { job } = await api('video-jobs', { id: 'native', options: { encoder: 'software', fpsCap: 30 } }); let done;
    const deadline = Date.now() + 120000;
    do { await new Promise(resolve => setTimeout(resolve, 100)); done = (await api(`video-jobs/${job.id}`)).job; }
    while (!['completed', 'failed', 'cancelled'].includes(done.status) && Date.now() < deadline);
    if (done.status !== 'completed') throw Error(done.error || 'native_job_incomplete');
    report.native.optimizationWallMs = performance.now() - start; report.native.job = done;
    const optimized = path.join(path.dirname(store.filePath), 'cache/video', `${done.result.cacheKey}.mp4`);
    report.native.output = await tools.probe(optimized);
    report.native.decodeOneFrameProcessWallMs = {};
    for (const [name, input] of [['original', projects.find(p => p.id === 'native').mediaPath], ['optimized', optimized]]) {
      const start = performance.now(); await tools.run(tools.ffmpeg, ['-hide_banner', '-nostdin', '-loglevel', 'error', '-protocol_whitelist', 'file', '-i', input,
        '-frames:v', '1', '-an', '-f', 'null', '-'], { timeoutMs: 30000 });
      report.native.decodeOneFrameProcessWallMs[name] = performance.now() - start;
    }
    if (await digestFile(projects.find(p => p.id === 'native').mediaPath) !== report.native.sourceHash) throw Error('native_original_changed');
  }
  if (await digestFile(file) !== originalHash) throw Error('structural_original_changed');
  report.structural.originalUnchanged = true;
} catch (error) { report.error = error.message; process.exitCode = 1; }
finally { if (server) await server.close(); report.toolClose = await tools.close(); }
await writeFile(path.join(root, 'baseline.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
