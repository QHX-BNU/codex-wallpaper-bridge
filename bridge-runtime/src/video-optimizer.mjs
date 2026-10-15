import { createHash, randomUUID } from 'node:crypto';
import { link, lstat, realpath, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { digestFile, readCacheJson } from './managed-cache.mjs';
import { videoIdentity } from './video-stream.mjs';
import { VideoTools } from './video-tools.mjs';

const fail = (message, statusCode = 409) => Object.assign(Error(message), { statusCode });
const allowedEncoders = ['auto', 'software', 'h264_nvenc', 'h264_qsv', 'h264_amf'];
export function videoOptions(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !['fpsCap', 'encoder'].includes(k))) throw fail('video_options_invalid', 400);
  const fpsCap = value.fpsCap ?? 30, encoder = value.encoder ?? 'auto';
  if (!Number.isInteger(fpsCap) || fpsCap < 1 || fpsCap > 120 || !allowedEncoders.includes(encoder)) throw fail('video_options_invalid', 400);
  return { fpsCap, encoder };
}
async function sourceKey(file, options) {
  const resolved = await realpath(file), info = await stat(resolved);
  if (!info.isFile()) throw fail('video_unavailable', 404);
  const identity = videoIdentity(info), key = createHash('sha256').update(JSON.stringify([resolved, identity, options])).digest('hex');
  return { file: resolved, identity, key, info };
}

export class VideoOptimizer {
  #cache; #getSource; #jobs = new Map(); #active = null; #task = Promise.resolve(); #draining = Promise.resolve(); #closed = false; #verified = new Map();
  constructor({ cache, getSource, tools = new VideoTools() } = {}) {
    this.#cache = cache; this.#getSource = getSource; this.tools = tools;
  }
  get busy() { return Boolean(this.#active); }
  status() { return { busy: this.busy, capabilities: this.tools.status(),
    job: this.#active ? this.job(this.#active.id) : [...this.#jobs.keys()].at(-1) ? this.job([...this.#jobs.keys()].at(-1)) : null }; }
  begin(id, options = {}) {
    const normalized = videoOptions(options);
    if (typeof id !== 'string' || !id || id.length > 512) throw fail('video_invalid_id', 400);
    if (this.#closed || this.busy) throw fail('video_job_busy');
    const release = this.#cache.acquireWriter();
    while (this.#jobs.size >= 24) this.#jobs.delete(this.#jobs.keys().next().value);
    const job = { id: randomUUID(), projectId: id, options: normalized, status: 'queued', progress: 0,
      error: null, result: null, encoder: null, fallback: false, controller: new AbortController() };
    this.#jobs.set(job.id, job); this.#active = job; this.#task = this.#run(job, release); return this.job(job.id);
  }
  job(id) {
    const job = this.#jobs.get(id); if (!job) throw fail('video_job_missing', 404);
    return { id: job.id, kind: 'optimize', projectId: job.projectId, options: { ...job.options }, status: job.status,
      progress: job.progress, error: job.error, result: job.result, encoder: job.encoder, fallback: job.fallback };
  }
  cancel(id) {
    const job = this.#jobs.get(id); if (!job) throw fail('video_job_missing', 404);
    if (['queued', 'probing', 'running', 'verifying'].includes(job.status)) { job.status = 'cancelling'; job.controller.abort(); }
    return this.job(id);
  }
  retry(id) {
    const job = this.#jobs.get(id); if (!job || !['failed', 'cancelled'].includes(job.status)) throw fail('video_retry_unavailable');
    return this.begin(job.projectId, job.options);
  }
  async optimizedFile(id, file, options = {}) {
    const normalized = videoOptions(options), source = await sourceKey(file, normalized);
    try {
      const manifest = await this.#cache.resolve(`video/${source.key}.json`);
      const data = await readCacheJson(manifest, 16 * 1024);
      if (data.schemaVersion !== 1 || data.sourceIdentity !== source.identity || data.key !== source.key
        || !/^[a-f0-9]{64}$/.test(data.hash) || !Number.isSafeInteger(data.size) || data.size <= 0) return null;
      const output = await this.#cache.resolve(`video/${source.key}.mp4`), outputInfo = await lstat(output);
      if (outputInfo.size !== data.size) return null;
      const identity = videoIdentity(outputInfo), verifiedKey = `${output}:${identity}:${data.hash}`;
      if (!this.#verified.has(verifiedKey)) {
        if (await digestFile(output) !== data.hash || identity !== videoIdentity(await lstat(output))) return null;
        if (this.#verified.size >= 128) this.#verified.delete(this.#verified.keys().next().value);
        this.#verified.set(verifiedKey, true);
      }
      return output;
    } catch (error) {
      if (error.code === 'ENOENT' || error instanceof SyntaxError || /^cache_/.test(error.message)) return null;
      throw error;
    }
  }
  async #run(job, release) {
    let temporary = null, metadataTemp = null, published = null;
    const cleanup = async () => {
      for (const file of [temporary, metadataTemp, published]) if (file) await rm(file, { force: true }).catch(() => {});
      release(); if (this.#active === job) this.#active = null;
    };
    try {
      const signal = job.controller.signal; signal.throwIfAborted();
      const file = await this.#getSource(job.projectId); if (!file) throw fail('video_unavailable', 404);
      const source = await sourceKey(file, job.options); signal.throwIfAborted();
      if (await this.optimizedFile(job.projectId, source.file, job.options)) {
        signal.throwIfAborted(); job.result = { reused: true, originalRetained: true, cacheKey: source.key };
        job.progress = 1; job.status = 'completed'; return;
      }
      job.status = 'probing'; const capabilities = await this.tools.probeCapabilities({ signal }); signal.throwIfAborted();
      if (!capabilities.available) throw fail(capabilities.error || 'video_tool_unavailable');
      const input = await this.tools.probe(source.file, signal), directory = await this.#cache.directory('video');
      temporary = path.join(directory, `${source.key}.${job.id}.part`);
      const hardware = job.options.encoder === 'auto' ? ['h264_nvenc', 'h264_qsv', 'h264_amf'].find(e => capabilities.encoders.includes(e))
        : job.options.encoder === 'software' ? null : job.options.encoder;
      let encoder = hardware && capabilities.encoders.includes(hardware) ? hardware : 'libx264';
      if (!capabilities.encoders.includes(encoder)) throw fail('video_encoder_unavailable');
      job.status = 'running'; job.encoder = encoder;
      const transcode = () => this.tools.transcode(source.file, temporary, input, job.options, encoder,
        { signal, onProgress: p => { if (!signal.aborted && Number.isFinite(p)) job.progress = Math.max(job.progress, Math.min(.99, Math.max(0, p))); } });
      try { await transcode(); }
      catch (error) {
        if (signal.aborted || encoder === 'libx264' || !capabilities.encoders.includes('libx264') || error.message === 'video_tool_exit_timeout') throw error;
        await rm(temporary, { force: true }); encoder = 'libx264'; job.encoder = encoder; job.fallback = true; await transcode();
      }
      signal.throwIfAborted(); job.status = 'verifying';
      const info = await lstat(temporary); if (!info.isFile() || info.isSymbolicLink() || info.size <= 0) throw fail('video_output_invalid');
      const output = await this.tools.probe(temporary, signal);
      if (output.codec !== 'h264' || !Number.isFinite(output.fps) || output.fps <= 0 || output.fps > Math.min(job.options.fpsCap, input.fps) + .5
        || output.width !== Math.floor(input.width / 2) * 2 || output.height !== Math.floor(input.height / 2) * 2
        || output.hasAudio !== input.hasAudio
        || Math.abs(output.duration - input.duration) > Math.max(.5, input.duration * .02)) throw fail('video_output_invalid');
      const hash = await digestFile(temporary, signal);
      if (source.identity !== videoIdentity(await stat(source.file))) throw fail('video_source_changed');
      const target = path.join(directory, `${source.key}.mp4`), manifest = path.join(directory, `${source.key}.json`);
      metadataTemp = path.join(directory, `${source.key}.${job.id}.json.part`);
      await writeFile(metadataTemp, JSON.stringify({ schemaVersion: 1, key: source.key, sourceIdentity: source.identity,
        size: info.size, hash, options: job.options, encoder, video: output }), { flag: 'wx', mode: 0o600 });
      signal.throwIfAborted(); job.status = 'committing';
      try { await link(temporary, target); published = target; await link(metadataTemp, manifest); }
      catch (error) { throw fail(error.code === 'EEXIST' ? 'video_cache_conflict' : 'video_cache_publish_failed'); }
      published = null; job.status = 'completed'; job.progress = 1;
      job.result = { originalRetained: true, cacheKey: source.key, reused: false, size: info.size, fps: output.fps };
    } catch (error) {
      job.status = job.controller.signal.aborted ? 'cancelled' : 'failed';
      job.error = job.status === 'cancelled' ? null : /^video_[a-z_]+$/.test(error.message) ? error.message : 'video_optimization_failed';
    } finally {
      if (this.tools.running) {
        // Do not remove a still-owned child's output or allow cache migration.
        job.status = 'stopping'; this.#draining = this.tools.waitForIdle().then(async () => { job.status = job.controller.signal.aborted ? 'cancelled' : 'failed'; await cleanup(); });
      } else await cleanup();
    }
  }
  wait() { return this.#task; }
  async close() {
    this.#closed = true; if (this.#active) this.cancel(this.#active.id);
    const status = await this.tools.close(); await this.#task; if (status.clean) await this.#draining; return status;
  }
}
