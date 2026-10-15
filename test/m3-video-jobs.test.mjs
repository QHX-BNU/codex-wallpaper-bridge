import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { ManagedCache } from '../bridge-runtime/src/managed-cache.mjs';
import { VideoOptimizer } from '../bridge-runtime/src/video-optimizer.mjs';

const metadata = { width: 1920, height: 1080, duration: 10, fps: 60, codec: 'h264', hasAudio: false };
async function fixture(t, hooks = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-video-jobs-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load();
  const cache = new ManagedCache({ configStore: store, env: {} }); await cache.init(); t.after(() => cache.close());
  const source = path.join(root, 'source.mp4'); await writeFile(source, 'original source'); const attempts = [];
  const tools = { status: () => ({ available: true }),
    probeCapabilities: async () => ({ available: true, encoders: ['libx264', 'h264_nvenc'] }),
    probe: async file => file === source ? metadata : { ...metadata, fps: 30 },
    transcode: async (from, to, input, options, encoder, callbacks) => {
      attempts.push(encoder); await writeFile(to, 'verified cache'); callbacks.onProgress(.5);
      if (encoder === 'h264_nvenc') throw Error('video_tool_failed');
    }, close: async () => ({ remaining: 0, clean: true }), ...hooks };
  const optimizer = new VideoOptimizer({ cache, tools, getSource: async id => id === 'video' ? source : null });
  t.after(() => optimizer.close()); return { root, store, source, cache, optimizer, attempts, tools };
}
test('hardware failure falls back once to software, verifies and atomically publishes, original continues unchanged', async t => {
  const { optimizer, source, cache, attempts } = await fixture(t);
  const job = optimizer.begin('video', { fpsCap: 30, encoder: 'auto' }); await optimizer.wait();
  const done = optimizer.job(job.id); assert.equal(done.status, 'completed', done.error);
  assert.deepEqual(attempts, ['h264_nvenc', 'libx264']); assert.equal(done.fallback, true); assert.equal(done.progress, 1);
  const output = await optimizer.optimizedFile('video', source, { fpsCap: 30, encoder: 'auto' });
  assert.equal(await readFile(output, 'utf8'), 'verified cache'); assert.equal(await readFile(source, 'utf8'), 'original source');
  assert.doesNotMatch(JSON.stringify(done), /source\.mp4|cwb-video-jobs/);
  assert.ok((await readdir(await cache.directory('video'))).every(name => !name.includes('.part')));
  const repeated = optimizer.begin('video', { fpsCap: 30, encoder: 'auto' }); await optimizer.wait();
  assert.equal(optimizer.job(repeated.id).result.reused, true); assert.equal(attempts.length, 2);
});
test('cancel is immutable, stops before publish, releases cache lease only after worker finishes; retry is a new job', async t => {
  let running, release; const reached = new Promise(resolve => { running = resolve; });
  const { optimizer, cache, source } = await fixture(t, { transcode: async (from, to, input, options, encoder, { signal }) => {
    await writeFile(to, 'partial'); running(); await new Promise(resolve => { release = resolve; }); signal.throwIfAborted();
  } });
  const job = optimizer.begin('video', { encoder: 'software', fpsCap: 30 }); await reached;
  assert.throws(() => optimizer.begin('video'), /video_job_busy/);
  optimizer.cancel(job.id); assert.equal(cache.busy, true); release(); await optimizer.wait();
  assert.equal(optimizer.job(job.id).status, 'cancelled'); assert.equal(cache.busy, false);
  assert.equal(await optimizer.optimizedFile('video', source, { encoder: 'software', fpsCap: 30 }), null);
  assert.equal(optimizer.cancel(job.id).status, 'cancelled');
  const next = optimizer.retry(job.id); assert.notEqual(next.id, job.id); await reached; optimizer.cancel(next.id); release(); await optimizer.wait();
});
test('invalid/truncated output and source replacement cannot publish or overwrite original', async t => {
  const { optimizer, cache, source, tools } = await fixture(t);
  tools.probe = async file => file === source ? metadata : { ...metadata, duration: 1, fps: 30 };
  const job = optimizer.begin('video'); await optimizer.wait(); assert.equal(optimizer.job(job.id).error, 'video_output_invalid');
  assert.deepEqual(await readdir(await cache.directory('video')), []);
  tools.probe = async file => file === source ? metadata : { ...metadata, fps: 30 };
  tools.transcode = async (from, to) => { await writeFile(to, 'cache'); await writeFile(source, 'external replacement'); };
  const next = optimizer.retry(job.id); await optimizer.wait(); assert.equal(optimizer.job(next.id).error, 'video_source_changed');
  assert.equal(await readFile(source, 'utf8'), 'external replacement');
});
test('missing tools leave the original usable, unsafe options rejected synchronously and shutdown seals jobs', async t => {
  const { optimizer, source } = await fixture(t, { probeCapabilities: async () => ({ available: false, encoders: [], error: 'video_tool_missing' }) });
  const job = optimizer.begin('video'); await optimizer.wait(); assert.equal(optimizer.job(job.id).error, 'video_tool_missing');
  assert.equal(await readFile(source, 'utf8'), 'original source');
  assert.throws(() => optimizer.begin('video', { fpsCap: 121 }), /video_options_invalid/);
  assert.throws(() => optimizer.begin('video', { encoder: 'custom -i remote' }), /video_options_invalid/);
  assert.equal((await optimizer.close()).clean, true); assert.throws(() => optimizer.begin('video'), /video_job_busy/);
});
test('unconfirmed child exit keeps output and writer ownership until actual idle; shutdown is not falsely clean', async t => {
  let running = 1, idle; const stopped = new Promise(resolve => { idle = resolve; });
  const { optimizer, cache } = await fixture(t, {
    get running() { return running; }, waitForIdle: () => stopped,
    transcode: async (from, to) => { await writeFile(to, 'still owned partial'); throw Error('video_tool_exit_timeout'); },
    close: async () => ({ clean: running === 0, remaining: running }),
  });
  // Object spread copies accessors; install the live getter on the test backend.
  Object.defineProperty(optimizer.tools, 'running', { get: () => running });
  const job = optimizer.begin('video', { encoder: 'software' }); await optimizer.wait();
  assert.equal(optimizer.job(job.id).status, 'stopping'); assert.equal(cache.busy, true);
  assert.ok((await readdir(await cache.directory('video'))).some(file => file.endsWith('.part')));
  assert.equal((await optimizer.close()).clean, false);
  running = 0; idle(); assert.equal((await optimizer.close()).clean, true); assert.equal(cache.busy, false);
  assert.deepEqual(await readdir(await cache.directory('video')), []);
});
