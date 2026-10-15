// Legacy verifier is sealed while its required sample is excluded by the user.
import m2TestPolicy from './m2-test-policy.cjs';
m2TestPolicy.assertM2TestProject('3790869794');
/* Dedicated real utility test driver; never loaded by the daily CLI. */
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
const [workspace] = process.argv.slice(2);
const { openNativeEngineProvider } = await import(pathToFileURL(path.join(workspace, 'dist/bridge-runtime/src/native-engine-provider.mjs')).href);
const client = openNativeEngineProvider(); assert.ok(client);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let request = 0, waiter;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const post = (event, data = {}) => process.parentPort.postMessage({ channel: 'cwb-encoded-probe', event, ...data });
const receive = ({ data }) => {
  if (data?.channel !== 'cwb-encoded-probe' || data.event !== 'frame-ack' || !waiter || data.request !== waiter.request) return;
  clearTimeout(waiter.timer); const current = waiter; waiter = null;
  if (data.ok) current.resolve(data.result); else current.reject(Error('native_decoder_probe_failed'));
};
process.parentPort.on('message', receive);
const step = (name, result = {}) => post('step', { name, ...result });
async function frame(proxy, projectId, sample = null) {
  assert.ok(!waiter); const started = performance.now(), packet = await proxy.captureEncoded(), key = ++request;
  assert.equal(packet.width, 800); assert.equal(packet.height, 450); assert.ok(packet.vp8.length <= 2097152);
  const captureRoundTripMs = performance.now() - started;
  const result = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { waiter = null; reject(Error('native_decoder_ack_timeout')); }, 10000);
    waiter = { request: key, timer, resolve, reject }; post('frame', { request: key, projectId, sample, packet });
  });
  return { ...result, elapsedMs: performance.now() - started, captureRoundTripMs, encodedHash: digest(packet.vp8) };
}
try {
  const scene = client.create('3233141951'); await scene.ready;
  const started = performance.now(), samples = [], times = [], stages = {}; let frames = 0, bytes = 0;
  while (performance.now() - started < 6000 || samples.length < 3) {
    assert.ok(performance.now() - started < 30000); const sample = samples.length < 3 && performance.now() - started >= samples.length * 2000;
    const result = await frame(scene, '3233141951', sample ? `bright-${samples.length}` : null);
    frames++; bytes += result.bytes; times.push(result.elapsedMs); if (sample) samples.push(result);
    for (const name of ['nativeCaptureMs', 'parentEncodeTotalMs', 'decodeAckMs', 'sourceHashMs', 'captureRoundTripMs']) (stages[name] ??= []).push(result[name]);
    await delay(80);
  }
  const durationMs = performance.now() - started, sorted = [...times].sort((a, b) => a - b), p95 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))];
  assert.ok(samples.every((sample) => sample.meanRgbError < 8)); assert.ok(samples.slice(1).every((sample) => sample.previousSampleChangedRatio > .001));
  const measured = { frames, durationMs, fps: frames * 1000 / durationMs, p95, max: sorted.at(-1), firstFrameMs: times[0], bytes,
    scope: 'native BGRA capture (checked against the exact saved PNG) + dedicated VP8 preload + owned utility IPC + isolated CPU decoder ack; includes first frame and saved samples, not Codex/CDP or physical display latency',
    stages: Object.fromEntries(Object.entries(stages).map(([name, values]) => { const sorted = [...values].sort((a, b) => a - b); return [name, { p50: sorted[Math.floor(sorted.length * .5)], p95: sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * .95))] }]; })) };
  step('bright real Scene encoded IPC stream and three native decoded compositor samples', { measured, samples });
  const dark = client.create('3444535389'); await dark.ready;
  const a = await frame(dark, '3444535389', 'dark-0'); await delay(600); const b = await frame(dark, '3444535389', 'dark-1');
  assert.ok(a.sourceNonblackRatio < .05); assert.ok(a.meanRgbError < 8 && b.meanRgbError < 8); assert.ok(b.previousSampleChangedRatio > .0001);
  step('legitimate dark Scene passes native VP8/CPU decoded provenance without a brightness threshold', { samples: [a, b] });
  const third = client.create('1778944028'); await assert.rejects(third.ready, /provider_capacity/);
  step('third owner denied while two source and two codec contexts are live');
  await scene.release(); await dark.release();
  const web = client.create('3790869794'); await web.ready; await frame(web, '3790869794', 'web-live'); await web.pause();
  const frozen = await frame(web, '3790869794', 'web-paused-0'); await delay(400); const still = await frame(web, '3790869794', 'web-paused-1');
  assert.equal(frozen.sourceHash, still.sourceHash); assert.equal(frozen.encodedHash, still.encodedHash); assert.equal(still.previousSampleChangedRatio, 0);
  step('native Web pause leaves the separate codec responsive and preserves exact frozen pixels/keyframe', { frozen, still });
  await web.resume(); await delay(500); const resumed = await frame(web, '3790869794', 'web-resumed'); assert.ok(resumed.previousSampleChangedRatio > .001);
  step('native Web resume restores changing real encoded compositor frames', { resumed }); await web.release();
  const cancelled = client.create('1778944028'); await cancelled.ready;
  await assert.rejects(cancelled.captureEncoded(), /engine_unavailable/); await cancelled.release();
  step('actual source destruction during codec startup cancels encoding; no late keyframe crosses IPC');
  const abandoned = client.create('3790869794'); await abandoned.ready; await frame(abandoned, '3790869794', 'exit-live');
  step('utility exits naturally with live source/codec for parent-owned cleanup');
  step('original bounded data-plane performance gate: at least 4 FPS and p95 below 750 ms', { passed: measured.fps >= 4 && p95 < 750 });
  assert.ok(measured.fps >= 4 && p95 < 750);
  post('done', { outcome: 'pass' }); process.parentPort.removeListener('message', receive);
  setTimeout(() => process.exit(0), 50);
} catch (error) {
  if (waiter) { clearTimeout(waiter.timer); waiter = null; }
  process.parentPort.removeListener('message', receive); client.close(); post('done', { outcome: 'fail', error: String(error.message).slice(0, 200) });
  setTimeout(() => process.exit(1), 50);
}
