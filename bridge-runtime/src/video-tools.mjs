import { spawn as spawnProcess } from 'node:child_process';
import path from 'node:path';

export const VIDEO_TOOL_LIMITS = Object.freeze({ probeMs: 8000, transcodeMs: 60 * 60 * 1000,
  stdoutBytes: 2 * 1024 * 1024, stderrBytes: 64 * 1024, lineBytes: 4096, killMs: 1500, exitMs: 5000 });
const encoders = ['libx264', 'h264_nvenc', 'h264_qsv', 'h264_amf'];
const fail = message => Object.assign(Error(message), { statusCode: 409 });
function toolPath(value, fallback) {
  if (!value) return fallback;
  if (typeof value !== 'string' || value.length > 4096 || value.includes('\0') || !path.isAbsolute(value)) throw fail('video_tool_path_invalid');
  return path.resolve(value);
}
function inputOptions(file) {
  // Force a container rather than letting a renamed playlist/concat input open
  // other local files. MOV data references and absolute references stay off.
  const extension = path.extname(file).toLowerCase();
  if (['.mp4', '.m4v', '.mov', '.part'].includes(extension) || !extension) return ['-f', 'mov', '-enable_drefs', '0', '-use_absolute_path', '0'];
  if (['.webm', '.mkv'].includes(extension)) return ['-f', 'matroska'];
  if (extension === '.avi') return ['-f', 'avi'];
  throw fail('video_format_unsupported');
}
export function parseVideoProbe(value) {
  const video = value?.streams?.find(s => s.codec_type === 'video');
  const duration = Number(value?.format?.duration ?? video?.duration), [numerator, denominator = 1] = String(video?.avg_frame_rate || '0/1').split('/').map(Number);
  const fps = numerator / denominator, width = video?.width, height = video?.height;
  if (!video || !Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2 || width > 8192 || height > 8192
    || !Number.isFinite(duration) || duration <= 0 || duration > 24 * 60 * 60 || !Number.isFinite(fps) || fps <= 0 || fps > 240) throw fail('video_probe_invalid');
  return { duration, width, height, fps, codec: typeof video.codec_name === 'string' ? video.codec_name.slice(0, 40) : '',
    hasAudio: value.streams.some(s => s.codec_type === 'audio') };
}
export function buildTranscodeArgs(source, output, video, { fpsCap = 30 } = {}, encoder = 'libx264') {
  if (!encoders.includes(encoder) || !Number.isInteger(fpsCap) || fpsCap < 1 || fpsCap > 120) throw fail('video_options_invalid');
  const fps = Math.min(video.fps, fpsCap);
  return ['-hide_banner', '-nostdin', '-loglevel', 'error', '-threads', '4', '-filter_threads', '2', '-protocol_whitelist', 'file', ...inputOptions(source), '-i', source,
    '-map', '0:v:0', '-map', '0:a:0?', '-map_metadata', '-1', '-sn', '-dn',
    '-vf', `scale=trunc(iw/2)*2:trunc(ih/2)*2,fps=${fps}`, '-c:v', encoder, '-threads', '4', '-pix_fmt', 'yuv420p',
    ...(encoder === 'libx264' ? ['-preset', 'veryfast', '-crf', '23'] : ['-b:v', '8M']),
    '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-progress', 'pipe:1', '-nostats', '-y', '-fs', String(16 * 1024 ** 3), '-f', 'mp4', output];
}

// Own only children created here. Cancellation resolves after close, not after
// kill() returns; no global taskkill, shell strings or unbounded stderr logs.
export class VideoTools {
  #spawn; #owned = new Set(); #closed = false; #cap = null; #probing = null; #forced = 0; #pathError = null;
  constructor({ env = process.env, spawn = spawnProcess } = {}) {
    this.#spawn = spawn;
    try { this.ffmpeg = toolPath(env.CWB_FFMPEG_PATH, 'ffmpeg'); this.ffprobe = toolPath(env.CWB_FFPROBE_PATH, 'ffprobe'); }
    catch { this.#pathError = 'video_tool_path_invalid'; }
  }
  status() { return this.#cap ?? { available: null, encoders: [], hardwareVerified: false, error: null }; }
  get running() { return this.#owned.size; }
  waitForIdle() { return Promise.all([...this.#owned].map(child => child.done)); }
  async run(executable, args, { signal, timeoutMs = VIDEO_TOOL_LIMITS.probeMs,
    maxOutputBytes = VIDEO_TOOL_LIMITS.stdoutBytes, onLine = null } = {}) {
    if (this.#closed) throw fail('video_tools_closed');
    if (signal?.aborted) throw fail('video_tool_cancelled');
    return new Promise((resolve, reject) => {
      let child;
      try { child = this.#spawn(executable, args, { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
      catch (error) { reject(fail(error.code === 'ENOENT' ? 'video_tool_missing' : 'video_tool_failed')); return; }
      let error = null, completed = false, stdout = '', tail = '', outputBytes = 0, stderrBytes = 0;
      let killTimer, deadline;
      const stop = reason => {
        error ??= fail(reason); if (completed || killTimer) return;
        try { child.kill('SIGTERM'); } catch { /* ownership retained until real close */ }
        killTimer = setTimeout(() => { if (!completed) { this.#forced++; try { child.kill('SIGKILL'); } catch {} } }, VIDEO_TOOL_LIMITS.killMs);
        deadline = setTimeout(() => { if (!completed) reject(fail('video_tool_exit_timeout')); }, VIDEO_TOOL_LIMITS.exitMs);
      };
      const abort = () => stop('video_tool_cancelled'), timer = setTimeout(() => stop('video_tool_timeout'), timeoutMs);
      const owned = { stop, done: new Promise(resolve => { child.once('close', resolve); }) };
      this.#owned.add(owned); signal?.addEventListener('abort', abort, { once: true });
      child.once('error', e => {
        error ??= fail(e.code === 'ENOENT' ? 'video_tool_missing' : 'video_tool_failed');
        // Failed spawn has no PID or running process; Node emits close next.
        if (child.pid) stop(error.message);
      });
      child.stdout.on('data', chunk => {
        outputBytes += chunk.length;
        if (outputBytes > maxOutputBytes) { stop('video_tool_output_limit'); return; }
        const value = chunk.toString('utf8'); stdout += value;
        if (onLine) {
          tail += value; const lines = tail.split(/\r?\n/); tail = lines.pop();
          if (tail.length > VIDEO_TOOL_LIMITS.lineBytes || lines.some(line => line.length > VIDEO_TOOL_LIMITS.lineBytes)) { stop('video_tool_output_limit'); return; }
          for (const line of lines) { try { onLine(line); } catch { stop('video_tool_progress_invalid'); } }
        }
      });
      child.stderr.on('data', chunk => {
        stderrBytes += chunk.length; if (stderrBytes > VIDEO_TOOL_LIMITS.stderrBytes) stop('video_tool_output_limit');
      });
      child.once('close', (code, exitSignal) => {
        completed = true; clearTimeout(timer); clearTimeout(killTimer); clearTimeout(deadline);
        signal?.removeEventListener('abort', abort); this.#owned.delete(owned);
        if (error) reject(error); else if (code !== 0 || exitSignal) reject(fail('video_tool_failed')); else resolve(stdout);
      });
      if (signal?.aborted) abort();
    });
  }
  async probeCapabilities({ refresh = false, signal } = {}) {
    if (this.#closed) throw fail('video_tools_closed');
    if (this.#probing) return this.#probing;
    if (this.#cap?.available && !refresh) return this.#cap;
    this.#probing = (async () => {
      try {
        if (this.#pathError) throw fail(this.#pathError);
        const [ffmpeg, ffprobe, listing] = await Promise.all([
          this.run(this.ffmpeg, ['-version'], { signal }), this.run(this.ffprobe, ['-version'], { signal }), this.run(this.ffmpeg, ['-hide_banner', '-encoders'], { signal })]);
        if (!/^ffmpeg version /m.test(ffmpeg) || !/^ffprobe version /m.test(ffprobe)) throw fail('video_tool_invalid');
        const found = [...listing.matchAll(/^\s*[VAS][A-Z.]{5}\s+(\S+)\s/gm)].map(m => m[1]);
        const available = encoders.filter(e => found.includes(e));
        this.#cap = { available: available.length > 0, encoders: available, hardwareVerified: false,
          ffmpegVersion: ffmpeg.split(/\r?\n/)[0].slice(0, 200), ffprobeVersion: ffprobe.split(/\r?\n/)[0].slice(0, 200),
          error: available.length ? null : 'video_encoder_unavailable' };
      } catch (error) {
        this.#cap = { available: false, encoders: [], hardwareVerified: false,
          error: /^video_[a-z_]+$/.test(error.message) ? error.message : 'video_tool_unavailable' };
      }
      return this.#cap;
    })().finally(() => { this.#probing = null; }); return this.#probing;
  }
  async probe(file, signal) {
    const result = await this.run(this.ffprobe, ['-v', 'error', '-protocol_whitelist', 'file', ...inputOptions(file), '-show_entries',
      'stream=codec_type,codec_name,width,height,avg_frame_rate,duration:format=duration', '-of', 'json', file],
    { signal, maxOutputBytes: 256 * 1024 });
    try { return parseVideoProbe(JSON.parse(result)); } catch { throw fail('video_probe_invalid'); }
  }
  transcode(source, output, video, options, encoder, { signal, onProgress } = {}) {
    return this.run(this.ffmpeg, buildTranscodeArgs(source, output, video, options, encoder), {
      signal, timeoutMs: VIDEO_TOOL_LIMITS.transcodeMs,
      onLine: line => {
        const match = /^out_time_us=(\d{1,16})$/.exec(line);
        if (match) onProgress?.(Math.min(.99, Number(match[1]) / 1000000 / video.duration));
      },
    });
  }
  async close() {
    this.#closed = true; const owned = [...this.#owned];
    for (const child of owned) child.stop('video_tool_cancelled');
    let timeout;
    await Promise.race([Promise.all(owned.map(c => c.done)), new Promise(resolve => { timeout = setTimeout(resolve, VIDEO_TOOL_LIMITS.exitMs + 50); })]);
    clearTimeout(timeout); return { remaining: this.#owned.size, forcedStops: this.#forced, clean: this.#owned.size === 0 };
  }
}
