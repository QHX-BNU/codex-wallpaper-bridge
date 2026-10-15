import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { StringDecoder } from 'node:string_decoder';
import { validateWebWallpaperInput } from './web-wallpaper-input.mjs';

export const MEDIA_COMMANDS = Object.freeze(['play', 'pause', 'previous', 'next']);
const helper = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../native/windows-media.ps1');
const sessionId = value => typeof value === 'string' && /^[a-f0-9]{32}$/.test(value);

/** A private, owned stdio producer. No author-provided executable or arguments. */
export class WindowsMediaProvider {
  #spawn; #platform; #env; #child = null; #listeners = new Set(); #queue = Promise.resolve();
  #flags = ''; #closed = false; #pending = new Map(); #request = 0; #seq = 0;
  #buffer = ''; #reason = 'off'; #startupTimeout; #stopTimeout; #exit = null; #rejectStartup = null; #forcedStops = 0;
  constructor({ spawnChild = spawn, platform = process.platform, env = process.env, startupTimeoutMs = 15000, stopTimeoutMs = 4000 } = {}) {
    this.#spawn = spawnChild; this.#platform = platform; this.#env = env;
    this.#startupTimeout = startupTimeoutMs; this.#stopTimeout = stopTimeoutMs;
  }
  onEvent(callback) { this.#listeners.add(callback); return () => this.#listeners.delete(callback); }
  #emit(event) { for (const callback of this.#listeners) { try { callback(event); } catch {} } }
  status() { return { running: Boolean(this.#child), reason: this.#reason, supported: this.#platform === 'win32', forcedStops: this.#forcedStops }; }
  configure(flags) {
    const operation = this.#queue.then(() => this.#configure(flags)); this.#queue = operation.catch(() => {}); return operation;
  }
  async #configure(flags) {
    if (this.#closed) throw Error('media_provider_closed');
    const selected = { audio: flags.audio === true, media: flags.media === true, power: flags.power === true };
    const key = JSON.stringify(selected);
    if (key === this.#flags) return;
    await this.#stop();
    if (this.#closed) throw Error('media_provider_closed');
    this.#flags = key;
    if (!Object.values(selected).some(Boolean)) { this.#reason = 'off'; return; }
    if (this.#platform !== 'win32') { this.#reason = 'unsupported'; return; }
    this.#seq = 0; this.#buffer = ''; this.#reason = 'starting';
    const executable = path.join(this.#env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    let child;
    try {
      child = this.#spawn(executable, ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', helper,
        '-Audio', String(Number(selected.audio)), '-Media', String(Number(selected.media)), '-Power', String(Number(selected.power))],
      { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env: this.#env });
    } catch {
      this.#flags = ''; this.#reason = 'unavailable'; this.#emit({ type: 'unavailable' });
      throw Error('media_provider_start_failed');
    }
    let readyResolve, readyReject;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    this.#rejectStartup = readyReject;
    this.#child = child;
    this.#exit = new Promise(resolve => child.once('exit', () => {
      if (this.#child === child) { this.#child = null; this.#flags = ''; this.#reason = this.#closed ? 'off' : 'unavailable'; this.#emit({ type: 'unavailable' }); }
      for (const pending of this.#pending.values()) { clearTimeout(pending.timer); pending.reject(Error('media_provider_exited')); }
      this.#pending.clear(); readyReject(Error('media_provider_exited')); resolve();
    }));
    child.once('error', () => { this.#reason = 'unavailable'; if (!child.pid && this.#child === child) this.#child = null; readyReject(Error('media_provider_start_failed')); });
    child.stdin.on('error', () => {}); child.stderr.on('data', () => {}); // never log OS media or raw native errors
    const decoder = new StringDecoder('utf8');
    child.stdout.on('data', chunk => {
      if (this.#child !== child || this.#closed) return;
      this.#buffer += decoder.write(chunk);
      if (Buffer.byteLength(this.#buffer) > 131072) { this.#reason = 'protocol_limit'; child.kill(); return; }
      let index;
      while ((index = this.#buffer.indexOf('\n')) >= 0) {
        const line = this.#buffer.slice(0, index); this.#buffer = this.#buffer.slice(index + 1);
        if (Buffer.byteLength(line) > 65536) continue;
        try {
          const message = JSON.parse(line);
          if (!Number.isSafeInteger(message.seq) || message.seq <= this.#seq) continue;
          const only = keys => Object.keys(message).every(key => ['seq', 'type', ...keys].includes(key));
          if (message.type === 'ready' && only([])) { this.#seq = message.seq; this.#reason = 'ready'; readyResolve(); }
          else if (message.type === 'input' && only(['input'])) {
            const input = validateWebWallpaperInput(message.input);
            if (!['audio', 'media', 'mediaStatus', 'mediaThumbnail'].includes(input.op) || (input.op === 'audio' ? !selected.audio : !selected.media)) continue;
            this.#seq = message.seq; this.#emit({ type: 'input', input });
          } else if (message.type === 'power' && only(['onBattery']) && typeof message.onBattery === 'boolean' && selected.power) {
            this.#seq = message.seq; this.#emit({ type: 'power', onBattery: message.onBattery });
          } else if (message.type === 'session' && only(['id', 'commands']) && selected.media && (message.id === '' || sessionId(message.id))
            && Array.isArray(message.commands) && message.commands.length <= 4 && message.commands.every(command => MEDIA_COMMANDS.includes(command))) {
            this.#seq = message.seq; this.#emit({ type: 'session', id: message.id, commands: [...new Set(message.commands)] });
          } else if (message.type === 'reply' && only(['request', 'ok']) && Number.isSafeInteger(message.request) && typeof message.ok === 'boolean') {
            this.#seq = message.seq; const pending = this.#pending.get(message.request);
            if (pending) { this.#pending.delete(message.request); clearTimeout(pending.timer); pending.resolve(message.ok); }
          } else if (message.type === 'status' && only(['source', 'state']) && ['audio', 'media'].includes(message.source)
            && ['ready', 'unavailable', 'off'].includes(message.state)) {
            this.#seq = message.seq; this.#emit({ type: 'status', source: message.source, state: message.state });
          }
        } catch { /* Invalid native data has no delivery capability. */ }
      }
    });
    const timer = setTimeout(() => readyReject(Error('media_provider_timeout')), this.#startupTimeout);
    try { await ready; } catch (error) { this.#flags = ''; await this.#stop(); throw error; }
    finally { clearTimeout(timer); this.#rejectStartup = null; }
  }
  control(value) {
    if (this.#closed || !this.#child || this.#reason !== 'ready' || !MEDIA_COMMANDS.includes(value?.command) || !sessionId(value?.sessionId)
      || this.#pending.size >= 4 || this.#request >= Number.MAX_SAFE_INTEGER) return Promise.reject(Error('media_control_unavailable'));
    const request = ++this.#request;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#pending.delete(request); reject(Error('media_control_timeout')); }, 2500);
      this.#pending.set(request, { resolve, reject, timer });
      this.#child.stdin.write(JSON.stringify({ op: 'control', request, command: value.command, sessionId: value.sessionId, expiresAt: Date.now() + 2000 }) + '\n', error => {
        if (error) { clearTimeout(timer); this.#pending.delete(request); reject(Error('media_control_failed')); }
      });
    });
  }
  async #stop() {
    const child = this.#child; if (!child) return;
    child.stdin.end('{"op":"stop"}\n');
    let timer;
    const exited = await Promise.race([this.#exit.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), this.#stopTimeout); })]);
    clearTimeout(timer);
    if (!exited) {
      this.#forcedStops++;
      child.kill();
      const killed = await Promise.race([this.#exit.then(() => true), new Promise(resolve => { timer = setTimeout(() => resolve(false), this.#stopTimeout); })]);
      clearTimeout(timer); if (!killed) throw Error('media_provider_stop_incomplete');
    }
  }
  close() { this.#closed = true; this.#rejectStartup?.(Error('media_provider_closed')); const operation = this.#queue.then(() => this.#stop()); this.#queue = operation.catch(() => {}); return operation; }
}
