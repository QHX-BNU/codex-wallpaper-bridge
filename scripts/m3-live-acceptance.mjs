/** Opt-in, real Windows M3 acceptance. No ffmpeg, daily profile, credentials or WE sources.
 * Run only after explicit authorization for separate Store/local hosts and system media.
 * Every run preserves evidence; only PID/creation-verified owned processes are cleaned up.
 */
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, writeFile, mkdir, cp, stat, readdir, access, rename } from 'node:fs/promises';
import { Script } from 'node:vm';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import { build } from 'esbuild';
import { compileWindowsMedia } from './compile-windows-media.mjs';
import { freezeCompiledBuild, verifyCompiledSnapshot } from './m2-compiled-snapshot.mjs';
import { parseM3AcceptanceOptions } from './m3-acceptance-options.mjs';
import { readOwnedGpuResources, gpuResourceDelta } from './m2-gpu-resource-sampler.mjs';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const exec = promisify(execFile);
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const nonce = randomUUID();
const options = parseM3AcceptanceOptions(process.argv.slice(2));
const runRoot = path.join(workspace, 'out', 'live-acceptance', `m3-${new Date().toISOString().replace(/[-:.]/g, '')}-${nonce.slice(0, 8)}`);
const crossRoot = `F:\\CWB-M3-Acceptance-${nonce}`;
const results = { schemaVersion: 1, runRoot, crossRoot, nonce, options, started: new Date().toISOString(), checks: [], hosts: [], gaps: [
  'ffmpeg/ffprobe and real transcoding deferred by user', 'physical battery unplug/replug not exercised',
  'audio endpoint switching and long-duration resource soak not exercised',
  'production Scene metadata/lyrics/control API not implemented; this run uses self-owned Web wallpaper',
  'release EXE/ASAR and full workbench/tray UI acceptance not exercised', 'online lyrics remain disabled',
] };
let runtime, proof, snapshot, protectedBefore, dailyBefore, media, provider, sharedServer, sharedStore;
const owned = [], hostObjects = [], players = [];
async function save() { await writeFile(path.join(runRoot, 'result.json'), JSON.stringify(results, null, 2)); }
async function check(name, ok, details = {}) {
  results.checks.push({ name, ok: Boolean(ok), ...details }); await save();
  process.stdout.write(JSON.stringify({ check: name, ok: Boolean(ok), ...details }) + '\n');
}
async function until(fn, ms = 12000, interval = 100) {
  const end = performance.now() + ms;
  do { const value = await fn(); if (value) return value; await sleep(interval); } while (performance.now() < end);
  throw Error('acceptance_wait_timeout');
}
async function ps(source, env = {}) {
  const { stdout } = await exec('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', source],
    { windowsHide: true, timeout: 20000, maxBuffer: 256 * 1024, env: { ...process.env, ...env } });
  return stdout.replace(/^\uFEFF/, '').trim();
}
async function proc(pid) {
  const data = await ps('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:CWB_TEST_PID) -ErrorAction Stop; if($p){[ordered]@{pid=[int]$p.ProcessId;creation=$p.CreationDate.ToUniversalTime().ToString("o");exe=$p.ExecutablePath}|ConvertTo-Json -Compress}', { CWB_TEST_PID: String(pid) });
  return data ? JSON.parse(data) : null;
}
async function protection() {
  return JSON.parse(await ps('$p=@(Get-CimInstance Win32_Process -Filter "Name=\'ChatGPT.exe\'" -ErrorAction Stop | Where-Object {$_.CommandLine -notmatch "--type=" -and $_.CommandLine -notmatch "--user-data-dir="}); ConvertTo-Json -InputObject @($p|ForEach-Object {[ordered]@{pid=[int]$_.ProcessId;creation=$_.CreationDate.ToUniversalTime().ToString("o");exe=$_.ExecutablePath}}) -Compress'));
}
async function fileHashes() {
  const files = [path.join(process.env.LOCALAPPDATA, 'CodexWallpaperBridge', 'config.json'), path.join(process.env.USERPROFILE, '.codex', 'config.toml')];
  return Promise.all(files.map(async file => { try { return { file, exists: true, sha256: hash(await readFile(file)) }; } catch (e) { if (e.code !== 'ENOENT') throw e; return { file, exists: false }; } }));
}
async function tree(pid) {
  return JSON.parse(await ps('$all=@(Get-CimInstance Win32_Process -ErrorAction Stop); $ids=[Collections.Generic.HashSet[int]]::new();$null=$ids.Add([int]$env:CWB_TEST_PID); for($i=0;$i -lt 20;$i++){ $before=$ids.Count; foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){$null=$ids.Add([int]$p.ProcessId)}};if($before -eq $ids.Count){break}};ConvertTo-Json -InputObject @($all|Where-Object {$ids.Contains([int]$_.ProcessId)}|ForEach-Object {[ordered]@{pid=[int]$_.ProcessId;creation=$_.CreationDate.ToUniversalTime().ToString("o");exe=$_.ExecutablePath}}) -Compress', { CWB_TEST_PID: String(pid) }));
}
async function preciseStop(identity) {
  if (!identity || protectedBefore.some(p => p.pid === identity.pid)) throw Error('protected_process');
  const output = await ps('$p=Get-CimInstance Win32_Process -Filter ("ProcessId="+$env:CWB_TEST_PID) -ErrorAction Stop; if(!$p){"absent";exit}; if($p.CreationDate.ToUniversalTime().ToString("o") -ne $env:CWB_TEST_CREATION -or $p.ExecutablePath -ne $env:CWB_TEST_EXE){throw "identity_changed"};Stop-Process -Id $p.ProcessId -ErrorAction Stop;"stopped"',
    { CWB_TEST_PID: String(identity.pid), CWB_TEST_CREATION: identity.creation, CWB_TEST_EXE: identity.exe });
  return output;
}
class Socket {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map(); this.contexts = new Map();
    ws.on('error', () => {});
    ws.on('message', raw => { const value = JSON.parse(raw); if (value.id) { const p = this.pending.get(value.id); if (!p) return; this.pending.delete(value.id); clearTimeout(p.timer); value.error ? p.reject(Object.assign(Error('cdp_command_failed'), { method: p.method, protocolCode: value.error.code })) : p.resolve(value.result || {}); }
      else if (value.method === 'Runtime.executionContextCreated') { const c = value.params.context; if (c.auxData?.isDefault) this.contexts.set(c.auxData.frameId, c.id); }
      else if (value.method === 'Runtime.executionContextDestroyed') { for (const [f, c] of this.contexts) if (c === value.params.executionContextId) this.contexts.delete(f); }
      else if (value.method === 'Runtime.executionContextsCleared') this.contexts.clear(); });
    ws.on('close', () => { for (const p of this.pending.values()) { clearTimeout(p.timer); p.reject(Error('cdp_closed')); } this.pending.clear(); });
  }
  static async connect(url) { const ws = new WebSocket(url, { handshakeTimeout: 5000 }); await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', () => reject(Error('cdp_connect_failed'))); }); return new Socket(ws); }
  call(method, params = {}, ms = 15000) { const id = ++this.id; return new Promise((resolve, reject) => { const timer = setTimeout(() => { this.pending.delete(id); reject(Error('cdp_timeout')); }, ms); this.pending.set(id, { resolve, reject, timer, method }); this.ws.send(JSON.stringify({ id, method, params })); }); }
  async eval(expression, contextId) { const r = await this.call('Runtime.evaluate', { expression, ...(contextId ? { contextId } : {}), awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw Error('probe_exception'); return r.result?.value; }
  close() { this.ws.close(); }
}
async function portFree(port) { const value = await ps('@(Get-NetTCPConnection -State Listen -LocalPort ([int]$env:CWB_TEST_PORT) -ErrorAction SilentlyContinue).Count', { CWB_TEST_PORT: String(port) }); if (value !== '0') throw Error('acceptance_port_busy'); }
function launch(exe, args, env, { visible = false } = {}) {
  const child = spawn(exe, args, { windowsHide: !visible, shell: false, stdio: ['pipe', 'pipe', 'pipe'], env });
  child.stderr.on('data', () => {}); child.stdout.on('error', () => {}); child.stdin.on('error', () => {});
  child.exited = new Promise(resolve => child.once('exit', (code, signal) => { child.exitInfo = { code, signal }; resolve(child.exitInfo); }));
  child.once('error', () => {}); owned.push(child); return child;
}
async function compile() {
  const directory = path.join(runRoot, 'build'); await mkdir(path.join(directory, 'runtime', 'src'), { recursive: true });
  const exports = { ConfigStore: 'bridge-runtime/src/config-store.mjs', MediaMiddleware: 'bridge-runtime/src/media-middleware.mjs',
    WindowsMediaProvider: 'bridge-runtime/src/windows-media-provider.mjs', LyricsStore: 'bridge-runtime/src/media-lyrics.mjs',
    ManagedCache: 'bridge-runtime/src/managed-cache.mjs', MediaServer: 'bridge-runtime/src/media-server.mjs',
    CdpWallpaperInjector: 'bridge-overrides/src/cdp-injector.mjs', buildCurrentInjection: 'bridge-overrides/src/injection-plan.mjs',
    verifyCdpEndpointOwner: 'src/cdp-owner.mjs' };
  const contents = Object.entries(exports).map(([name, file]) => `export { ${name} } from ${JSON.stringify(path.join(workspace, file))};`).join('\n');
  const output = await build({ stdin: { contents, resolveDir: workspace, sourcefile: 'm3-acceptance-entry.mjs' },
    bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node22', external: ['ws'],
    outfile: path.join(directory, 'runtime', 'src', 'm3.mjs'), metafile: true, logLevel: 'silent', legalComments: 'none' });
  await cp(path.join(workspace, 'bridge-runtime', 'public'), path.join(directory, 'runtime', 'public'), { recursive: true, errorOnExist: true });
  await cp(path.join(workspace, 'bridge-runtime', 'vendor', 'webwallgl'), path.join(directory, 'runtime', 'vendor', 'webwallgl'), { recursive: true, errorOnExist: true });
  await compileWindowsMedia({ nativeRoot: path.join(workspace, 'bridge-runtime', 'native'), outputRoot: path.join(directory, 'runtime', 'native') });
  const inputs = Object.keys(output.metafile.inputs).filter(file => !file.startsWith('<') && file !== 'm3-acceptance-entry.mjs');
  const sources = await Promise.all(inputs.map(async file => ({ file, sha256: hash(await readFile(path.resolve(workspace, file))) })));
  sources.push(...await Promise.all(['windows-media.cs', 'windows-media.ps1'].map(async file => ({ file: `bridge-runtime/native/${file}`, sha256: hash(await readFile(path.join(workspace, 'bridge-runtime', 'native', file))) }))));
  for (const file of ['scripts/m3-live-acceptance.mjs', 'scripts/m3-acceptance-options.mjs', 'scripts/m3-window-state.ps1', 'scripts/m3-acceptance-native-player.ps1']) sources.push({ file, sha256: hash(await readFile(path.join(workspace, file))) });
  proof = await freezeCompiledBuild({ workspace, root: runRoot, dist: directory });
  snapshot = path.join(runRoot, 'compiled-snapshot');
  await writeFile(path.join(runRoot, 'compiled-proof.json'), JSON.stringify({ ...proof, sources }, null, 2));
  results.compiledSha256 = proof.sha256; results.sources = sources;
  runtime = await import(pathToFileURL(path.join(snapshot, 'runtime', 'src', 'm3.mjs')));
  await check('independent_compiled_snapshot', true, { sha256: proof.sha256, files: proof.files, totalBytes: proof.totalBytes });
}
function wave(frequency) {
  const rate = 48000, samples = rate * 20, data = Buffer.alloc(44 + samples * 4);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16);
  data.writeUInt16LE(1, 20); data.writeUInt16LE(2, 22); data.writeUInt32LE(rate, 24); data.writeUInt32LE(rate * 4, 28); data.writeUInt16LE(4, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 4, 40);
  for (let i = 0; i < samples; i++) { const v = Math.round(Math.sin(2 * Math.PI * frequency * i / rate) * 4000); data.writeInt16LE(v, 44 + i * 4); data.writeInt16LE(v, 46 + i * 4); }
  return data;
}
async function assets() {
  for (const sub of ['assets/video', 'assets/web']) await mkdir(path.join(runRoot, sub), { recursive: true });
  await writeFile(path.join(runRoot, 'assets', 'tone-440.wav'), wave(440)); await writeFile(path.join(runRoot, 'assets', 'tone-880.wav'), wave(880));
  const player = `<!doctype html><meta charset="utf-8"><title>CWB M3 Own Player</title><body style="background:#122032;color:#eee;font:20px sans-serif"><h2>CWB M3 自建播放器</h2><p id="label"></p><audio id="audio"></audio><canvas id="canvas" width="640" height="360"></canvas><script>
  const params=new URLSearchParams(location.search),nonce=params.get('nonce'),label=params.get('label'),audio=document.querySelector('audio'); let index=0,remote={play:0,pause:0,next:0,previous:0}; audio.volume=.08;audio.loop=true;
  const snapshot=()=>({index,paused:audio.paused,position:audio.currentTime,remote:{...remote},title:'CWB-M3-'+nonce+'-'+label+'-'+index});
  const position=()=>{if(Number.isFinite(audio.duration)&&audio.duration>0)navigator.mediaSession.setPositionState({duration:audio.duration,position:Math.min(audio.currentTime,audio.duration),playbackRate:audio.playbackRate})};
  const announce=()=>{navigator.mediaSession.playbackState=audio.paused?'paused':'playing';position();document.querySelector('#label').textContent=snapshot().title+' / '+(audio.paused?'暂停':'播放');window.m3OwnedFixture.state({type:'state',...snapshot()})};
  const select=async(i)=>{index=(i+2)%2;audio.src=index?'tone-880.wav':'tone-440.wav';navigator.mediaSession.metadata=new MediaMetadata({title:snapshot().title,artist:'CWB Acceptance Fixture',album:'CWB M3 '+nonce,artwork:[{src:await window.m3OwnedFixture.artwork(),sizes:'128x128',type:'image/png'}]}); await audio.play();announce()};
  const command=async(op)=>{if(op==='snapshot')return snapshot();if(op==='play')await audio.play();else if(op==='pause')audio.pause();else if(op==='next')await select(index+1);else if(op==='previous')await select(index-1);else if(op==='makeVideo'){const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');let n=0;const timer=setInterval(()=>{ctx.fillStyle=n++%2?'#f2aa32':'#2866c0';ctx.fillRect(0,0,640,360);ctx.fillStyle='#fff';ctx.font='40px sans-serif';ctx.fillText('CWB M3 '+n,60,180)},50);const recorder=new MediaRecorder(canvas.captureStream(20),{mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:400000});const parts=[];recorder.ondataavailable=e=>{if(e.data.size)parts.push(e.data)};await new Promise(resolve=>{recorder.onstop=resolve;recorder.start();setTimeout(()=>recorder.stop(),4000)});clearInterval(timer);const bytes=await new Blob(parts).arrayBuffer();window.m3OwnedFixture.video(bytes)};announce();return snapshot()};
  for(const op of ['play','pause','next','previous'])navigator.mediaSession.setActionHandler(op==='next'?'nexttrack':op==='previous'?'previoustrack':op,async()=>{remote[op]++;await command(op)});
  audio.addEventListener('play',announce);audio.addEventListener('pause',announce);setInterval(announce,500);globalThis.m3Player={command};select(0);
  </script>`;
  new Script(player.slice(player.indexOf('<script>') + 8, player.indexOf('</script>')));
  await writeFile(path.join(runRoot, 'assets', 'player.html'), player);
  await writeFile(path.join(runRoot, 'assets', 'web', 'project.json'), JSON.stringify({ type: 'web', title: 'CWB M3 Owned Audio Wallpaper', file: 'index.html', general: { properties: {} } }));
  await writeFile(path.join(runRoot, 'assets', 'web', 'index.html'), `<!doctype html><meta charset="utf-8"><style>body{margin:0;background:#14293e;color:white;font:28px sans-serif}canvas{position:absolute;width:100%;height:100%}.panel{position:absolute;left:8%;top:18%}</style><canvas width="640" height="360"></canvas><div class="panel"><h2>CWB M3 真实音乐联动</h2><p id="song">等待自建播放器</p><p id="lyric"></p><img id="cover" width="128" height="128"></div><script>
    const p=globalThis.__m3OwnProbe={audio:0,max:0,media:0,own:false,thumbnail:0,lyrics:0,lyricOwn:false,capabilities:0,commands:[],paused:false,frames:0,nonce:${JSON.stringify(nonce)}};
    const ctx=document.querySelector('canvas').getContext('2d'); let spectrum=Array(128).fill(0);
    window.wallpaperRegisterAudioListener(values=>{p.audio++;p.max=Math.max(...values);spectrum=values});
    window.wallpaperRegisterMediaPropertiesListener(v=>{p.media++;p.own=v.title.startsWith('CWB-M3-'+p.nonce);document.querySelector('#song').textContent=p.own?v.title:'仅允许自建曲目'});
    window.wallpaperRegisterMediaThumbnailListener(v=>{p.thumbnail+=v.thumbnail?1:0;document.querySelector('#cover').src=v.thumbnail});
    window.wallpaperRegisterMediaPlaybackListener(v=>{p.paused=v.state===2});
    window.cwbMediaIntegration.registerLyricsListener(v=>{p.lyrics++;p.lyricOwn=v.text.startsWith('CWB lyric');document.querySelector('#lyric').textContent=v.text});
    function frame(){p.frames++;const caps=window.cwbMediaIntegration.capabilities();p.commands=caps.commands;p.capabilities+=caps.enabled?1:0;ctx.fillStyle='#14293e';ctx.fillRect(0,0,640,360);ctx.fillStyle='#d39b45';for(let i=0;i<64;i++)ctx.fillRect(i*10,350-spectrum[i]*240,8,Math.max(2,spectrum[i]*240));requestAnimationFrame(frame)}requestAnimationFrame(frame);
  </script>`);
}
async function startPlayer(label, port) {
  await portFree(port);
  const native = process.argv.includes('--native-player');
  const child = launch(native ? 'powershell.exe' : path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe'), native
    ? ['-NoProfile', '-NonInteractive', '-File', path.join(workspace, 'scripts', 'm3-acceptance-native-player.ps1'), '-Root', runRoot, '-Nonce', nonce, '-Label', label]
    : [path.join(workspace, 'scripts', 'm3-acceptance-player.cjs'), runRoot, nonce, String(port), label], { ...process.env, CODEX_HOME: path.join(runRoot, `player-${label}-codex-home`) });
  child.messages = []; let request = 0; child.stdout.on('data', () => {});
  child.readMessages = async () => { try { child.messages = JSON.parse(await readFile(path.join(runRoot, `player-${label}-state.json`), 'utf8')); } catch {} return child.messages; };
  child.command = async op => { const id = ++request, file = path.join(runRoot, `player-${label}-command.json`); await writeFile(file + '.tmp', JSON.stringify({ op, request: id })); await rename(file + '.tmp', file); return (await until(async () => (await child.readMessages()).find(m => m.type === 'reply' && m.request === id), op === 'makeVideo' ? 20000 : 5000)).result; };
  players.push(child); child.identity = await proc(child.pid);
  try { await until(async () => (await child.readMessages()).some(m => m.type === 'state' && !m.paused), 30000); }
  catch { await writeFile(path.join(runRoot, `player-${label}-failure.json`), JSON.stringify({ identity: child.identity, exit: child.exitInfo, messages: child.messages }, null, 2)); throw Error('own_player_start_timeout'); }
  await check(`player_${label}_real_${native ? 'WinRT' : 'Electron'}`, true, { pid: child.pid, creation: child.identity.creation }); return child;
}
async function ownedTrack() {
  const value = await media.snapshot();
  if (value.track?.title?.startsWith(`CWB-M3-${nonce}-`) && value.sessionId) return value;
  return false;
}
async function spectrum(ms = 1300) {
  const samples = []; const end = performance.now() + ms;
  while (performance.now() < end) { const s = await media.snapshot(), v = s.inputs.find(x => x.op === 'audio')?.values || [];
    samples.push({ max: Math.max(0, ...v), peak: v.slice(0, 64).indexOf(Math.max(0, ...v.slice(0, 64))) }); await sleep(100); }
  return { samples: samples.length, max: Math.max(...samples.map(v => v.max)), nonzero: samples.filter(v => v.max > 1e-6).length, peaks: [...new Set(samples.map(v => v.peak))] };
}
async function request(route, body) { const r = await fetch(new URL('api/' + route, sharedServer.baseUrl), { ...(body === undefined ? {} : { method: 'POST', headers: { Origin: sharedServer.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }) }); return { status: r.status, value: await r.json() }; }
async function setupMedia({ nativeSources = true } = {}) {
  sharedStore = new runtime.ConfigStore({ filePath: path.join(runRoot, 'bridge-state', 'config.json') }); await sharedStore.load();
  await sharedStore.set({ media: { captureAudio: nativeSources, nowPlaying: nativeSources, allowControl: false, onlineLyrics: false }, effects: { pauseOnBattery: true, pauseWhenHidden: true, playing: true }, selectedId: 'm3-owned-video' });
  provider = new runtime.WindowsMediaProvider({ spawnChild: (exe, args, opts) => { const child = spawn(exe, args, opts); child.identityPromise = proc(child.pid); owned.push(child); return child; }, stopTimeoutMs: 7000 });
  results.mediaEvents = [];
  provider.onEvent(event => {
    const item = { at: new Date().toISOString(), type: event.type };
    if (event.type === 'status') Object.assign(item, { source: event.source, state: event.state });
    if (event.type === 'session') Object.assign(item, { sessionPresent: !!event.id, commands: event.commands });
    if (event.type === 'input') { item.op = event.input.op; if (event.input.op === 'media') Object.assign(item, { ownTrack: event.input.value.title.startsWith(`CWB-M3-${nonce}-`), state: event.input.value.state }); if (event.input.op === 'mediaThumbnail') item.coverBytes = event.input.value.thumbnail.length; }
    if (event.type === 'power') item.onBattery = event.onBattery;
    if (event.type !== 'input' || event.input.op !== 'audio') { results.mediaEvents.push(item); if (results.mediaEvents.length > 500) results.mediaEvents.shift(); }
  });
  media = new runtime.MediaMiddleware({ getConfig: () => sharedStore.get(), createProvider: () => provider,
    lyrics: new runtime.LyricsStore({ root: path.join(runRoot, 'lyrics') }),
    dispatch: async (id, input) => { for (const h of hostObjects) if (h.injector?.running) await h.injector.sceneDelivery?.input(id, input); },
    onPower: async power => { for (const h of hostObjects) if (h.injector?.running) await h.injector.updatePower(power); } });
  const projects = [{ id: 'm3-owned-video', title: 'CWB M3 Real WebM', type: 'video', rootPath: path.join(runRoot, 'assets', 'video'), mediaPath: path.join(runRoot, 'assets', 'video', 'sample.webm'), previewPath: path.join(runRoot, 'assets', 'cover.png') },
    { id: 'm3-owned-web', title: 'CWB M3 Own Web Wallpaper', type: 'web', rootPath: path.join(runRoot, 'assets', 'web'), webEntry: 'index.html', previewPath: path.join(runRoot, 'assets', 'cover.png') }];
  sharedServer = new runtime.MediaServer({ projects, configStore: sharedStore, media, publicDir: path.join(snapshot, 'runtime', 'public'), cacheEnv: {}, onConfigChange: async () => { await media.configure(); } });
  await sharedServer.start(); await media.configure(); results.mediaPort = sharedServer.port; results.projects = projects;
  await check('native_sources_started', provider.status().running, { provider: provider.status() });
}
async function nativeMediaTests(player) {
  let s; try { s = await until(ownedTrack, 25000, 200); } catch { await check('GSMTC_self_track', false, { sources: (await media.snapshot()).sources, reason: 'own_session_not_observed_no_control_attempted' }); return false; }
  await check('GSMTC_self_track', true, { commands: s.commands, duration: s.track.duration, state: s.track.state });
  const audio = await spectrum(); await check('WASAPI_real_loopback_440', audio.nonzero > 0, audio);
  const p0 = s.track.position; await sleep(1600); s = await until(ownedTrack, 4000, 50).catch(() => null); await check('GSMTC_real_timeline', s?.track.position > p0, { before: p0, after: s?.track.position });
  if (!s) { await check('GSMTC_self_track_lost', false, { sources: (await media.snapshot()).sources }); return false; }
  s = await until(ownedTrack, 5000);
  let r = await request('media/control', { command: 'pause', sessionId: s.sessionId }); await check('control_default_off', r.status === 409 && !(await player.command('snapshot')).paused, { status: r.status });
  await sharedStore.set({ media: { allowControl: true } }); await media.configure();
  s = await until(ownedTrack, 5000);
  const lyric = await request('media/lyrics', { sessionId: s.sessionId, trackKey: s.trackKey, lrc: '[00:00.00]CWB lyric first\n[00:01.00]CWB lyric second\n[00:03.00]CWB lyric third' });
  await check('local_LRC_real_HTTP_persistence', lyric.status === 200 && (await media.snapshot()).lyric.text.startsWith('CWB lyric'), { status: lyric.status, lines: lyric.value.lines });
  for (const op of ['pause', 'play', 'next', 'previous']) {
    s = await until(ownedTrack, 5000).catch(() => null); if (!s) { await check(`GSMTC_control_${op}`, false, { reason: 'own_session_not_observed' }); await player.command('play').catch(() => {}); continue; }
    const before = await player.command('snapshot'); r = await request('media/control', { command: op, sessionId: s.sessionId });
    const after = await until(async () => { const v = await player.command('snapshot'); return v.remote[op] > before.remote[op] ? v : false; }, 5000, 200).catch(() => null);
    await check(`GSMTC_control_${op}`, r.status === 200 && Boolean(after), { status: r.status, nativeActionObserved: Boolean(after) });
    if (op === 'pause') { await sleep(500); const zero = await spectrum(1500); await check('WASAPI_pause_clears_spectrum', zero.nonzero === 0, { ...zero, caveat: 'system_loopback_may_include_other_apps_not_controlled' }); }
    if (op === 'next') { const shifted = await spectrum(); await check('WASAPI_real_loopback_880', shifted.nonzero > 0 && JSON.stringify(shifted.peaks) !== JSON.stringify(audio.peaks), shifted); }
    if (!after) await player.command('play').catch(() => {});
    await sleep(1200);
  }
  s = await until(ownedTrack); r = await request('media/control', { command: 'pause', sessionId: '0'.repeat(32) });
  await check('stale_session_rejected', r.status === 409 && !(await player.command('snapshot')).paused, { status: r.status });
  const thumb = await until(async () => (await media.snapshot()).inputs.find(x => x.op === 'mediaThumbnail')?.value.thumbnail || false, 11000, 250).catch(() => '');
  await check('GSMTC_real_cover', thumb.startsWith('data:image/'), { bytes: thumb.length, boundedWaitMs: 11000, independentOfControls: true });
  return true;
}
const videoProbe = `(()=>{const r=globalThis.__codexWallpaperBridgeRuntime;const m=document.getElementById('codex-wallpaper-bridge-media');const v=m?.tagName==='VIDEO'?m:m?.contentDocument?.querySelector('video');const s=r?.status?.();return {hidden:document.hidden,runtime:!!r,version:r?.version,status:{state:s?.state,playback:s?.playback},iframe:m?.tagName==='IFRAME',video:!!v,paused:v?.paused,time:v?.currentTime,ready:v?.readyState,width:v?.videoWidth,height:v?.videoHeight,frames:v?.getVideoPlaybackQuality?.().totalVideoFrames,root:!!document.getElementById('codex-wallpaper-bridge-root')}})()`;
async function ownedWindowCommand(h, state) {
  const command = state === 'minimized' ? 6 : state === 'normal' ? 9 : state === 'close' ? 0 : -1;
  if (command < 0) throw Error('window_state_invalid');
  const source = `
    $ErrorActionPreference='Stop'
    $root=Get-CimInstance Win32_Process -Filter ('ProcessId='+$env:CWB_TEST_PID) -ErrorAction Stop
    if(!$root -or $root.CreationDate.ToUniversalTime().ToString('o') -ne $env:CWB_TEST_CREATION -or $root.ExecutablePath -ne $env:CWB_TEST_EXE){throw 'root_identity_changed'}
    $all=@(Get-CimInstance Win32_Process -ErrorAction Stop);$ids=[Collections.Generic.HashSet[int]]::new();$null=$ids.Add([int]$root.ProcessId)
    for($i=0;$i -lt 20;$i++){$before=$ids.Count;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){$null=$ids.Add([int]$p.ProcessId)}};if($ids.Count -eq $before){break}}
    $windows=@($ids|ForEach-Object {Get-Process -Id $_ -ErrorAction SilentlyContinue}|Where-Object {$_.MainWindowHandle -ne 0}|ForEach-Object {[ordered]@{pid=[int]$_.Id;handle=[int64]$_.MainWindowHandle}})
    if($windows.Count -ne 1){throw 'owned_window_ambiguous'}
    Add-Type -TypeDefinition 'using System;using System.Runtime.InteropServices;public static class CwbM3Window{[DllImport("user32.dll")]public static extern bool ShowWindow(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool ShowWindowAsync(IntPtr h,int n);[DllImport("user32.dll")]public static extern bool SetWindowPos(IntPtr h,IntPtr a,int x,int y,int w,int z,uint f);[DllImport("user32.dll")]public static extern bool IsWindowVisible(IntPtr h);[DllImport("user32.dll")]public static extern bool IsIconic(IntPtr h);[DllImport("dwmapi.dll")]public static extern int DwmGetWindowAttribute(IntPtr h,int a,out int v,int s);[DllImport("user32.dll")]public static extern bool PostMessage(IntPtr h,uint m,IntPtr w,IntPtr l);}'
    $handle=[IntPtr]$windows[0].handle
    $command=[int]$env:CWB_TEST_WINDOW_COMMAND
    if($command -eq 0){$ok=[CwbM3Window]::PostMessage($handle,0x0010,[IntPtr]::Zero,[IntPtr]::Zero)}elseif($command -eq 9){$null=[CwbM3Window]::ShowWindow($handle,5);$null=[CwbM3Window]::ShowWindowAsync($handle,9);$ok=[CwbM3Window]::SetWindowPos($handle,[IntPtr]::Zero,0,0,0,0,0x0043)}else{$ok=[CwbM3Window]::ShowWindowAsync($handle,$command)}
    Start-Sleep -Milliseconds 250;$cloaked=0;$null=[CwbM3Window]::DwmGetWindowAttribute($handle,14,[ref]$cloaked,4)
    [ordered]@{ok=[bool]$ok;pid=$windows[0].pid;windowCount=$windows.Count;visible=[CwbM3Window]::IsWindowVisible($handle);iconic=[CwbM3Window]::IsIconic($handle);cloaked=[int]$cloaked}|ConvertTo-Json -Compress
  `;
  return JSON.parse(await ps(source, { CWB_TEST_PID: String(h.identity.pid), CWB_TEST_CREATION: h.identity.creation,
    CWB_TEST_EXE: h.identity.exe, CWB_TEST_WINDOW_COMMAND: String(command) }));
}
async function hostWindow(h, state) {
  if (!options.foregroundAllowed && state !== 'minimized') throw Error('m3_foreground_requires_opt_in');
  if (h.windowControl === false) return false;
  try {
    const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(workspace, 'scripts', 'restore-m2-owned-window.ps1'), '-TargetFile', h.targetFile, '-WindowAction', state === 'minimized' ? 'minimize' : 'restore'],
    { windowsHide: true, timeout: 15000, maxBuffer: 16384, encoding: 'utf8' });
    const value = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); await sleep(650);
    h.windowControl = value.identityVerified === true && (state === 'minimized' ? value.minimized === true : value.restored === true);
    return h.windowControl ? value : false;
  }
  catch { h.windowControl = false; results.gaps.push(`${h.kind}: exact owned window control could not be verified`); await check(`${h.kind}_window_control_unavailable`, false, { method: 'verified Win32 owned window' }); return false; }
}
async function activateHost(h, phase) {
  const peers = hostObjects.filter(candidate => candidate !== h && candidate.socket);
  const peerStates = [];
  for (const peer of peers) {
    const minimized = await hostWindow(peer, 'minimized');
    const hidden = minimized ? await until(() => peer.socket.eval('document.hidden===true'), 8000, 100).catch(() => false) : false;
    peerStates.push({ kind: peer.kind, minimized: Boolean(minimized), rendererHidden: Boolean(hidden) });
  }
  const restored = await hostWindow(h, 'normal');
  if (restored) await h.socket.call('Page.bringToFront');
  const visible = restored ? await until(() => h.socket.eval('document.hidden===false'), 8000, 100).catch(() => false) : false;
  const isolated = Boolean(restored && visible && peerStates.every(peer => peer.minimized && peer.rendererHidden));
  await check(`${h.kind}_${phase}_isolated_renderer_visible`, isolated, { rendererVisible: Boolean(visible), peerStates });
  if (!isolated) throw Error('isolated_host_visibility_failed');
}
async function launchHost(kind, exe, port) {
  if (!options.foregroundAllowed) throw Error('m3_foreground_requires_opt_in');
  await portFree(port); const directory = path.join(runRoot, kind), profile = path.join(directory, 'host-profile');
  const isolated = { home: path.join(directory, 'environment', 'home'), local: path.join(directory, 'environment', 'local'),
    roaming: path.join(directory, 'environment', 'roaming'), codex: path.join(directory, 'environment', 'codex') };
  await Promise.all([profile, ...Object.values(isolated)].map(value => mkdir(value, { recursive: true })));
  const hostEnv = { ...process.env, CODEX_HOME: isolated.codex, HOME: isolated.home, USERPROFILE: isolated.home,
    LOCALAPPDATA: isolated.local, APPDATA: isolated.roaming, XDG_CONFIG_HOME: isolated.local };
  const child = launch(exe, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`],
    hostEnv, { visible: true }); child.stdout.on('data', () => {});
  const h = { kind, exe, port, profile, child, targetFile: path.join(directory, 'target.json') }; hostObjects.push(h);
  h.identity = await proc(child.pid); if (!h.identity || h.identity.exe.toLowerCase() !== exe.toLowerCase()) throw Error('host_spawn_identity');
  await writeFile(h.targetFile, JSON.stringify({ ...h.identity, port, profile }, null, 2));
  await writeFile(path.join(directory, 'protected-chat.json'), JSON.stringify(protectedBefore, null, 2));
  await until(async () => { try { const r = await fetch(`http://127.0.0.1:${port}/json/version`, { signal: AbortSignal.timeout(1000) }); return r.ok; } catch { return false; } }, 40000, 300);
  const verify = async () => ({ ...await runtime.verifyCdpEndpointOwner({ installation: { path: exe }, port, expectedProcess: { pid: child.pid, creation: h.identity.creation, profile } }), verified: true });
  h.owner = await verify(); h.verify = verify;
  await check(`${kind}_CDP_identity`, true, { ...h.owner, creation: h.identity.creation, isolatedProfile: true });
  h.browser = await Socket.connect((await (await fetch(`http://127.0.0.1:${port}/json/version`)).json()).webSocketDebuggerUrl);
  const launchPeers = hostObjects.filter(candidate => candidate !== h && candidate.socket);
  if (launchPeers.length) {
    const peerStates = [];
    for (const peer of launchPeers) {
      const minimized = await hostWindow(peer, 'minimized');
      const hidden = minimized ? await until(() => peer.socket.eval('document.hidden===true'), 8000, 100).catch(() => false) : false;
      peerStates.push({ kind: peer.kind, minimized: Boolean(minimized), rendererHidden: Boolean(hidden) });
    }
    const isolated = peerStates.every(peer => peer.minimized && peer.rendererHidden);
    await check(`${kind}_launch_peer_isolation`, isolated, { peerStates });
    if (!isolated) throw Error('launch_peer_isolation_failed');
  }
  const shown = await hostWindow(h, 'normal');
  await check(`${kind}_owned_window_visible`, Boolean(shown), shown || { verifiedOwnedWindow: false });
  const candidates = await until(async () => { const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json(); const matching = list.filter(t => t.type === 'page' && t.url.startsWith('app://') && !/initialRoute=.*(?:avatar|pet|overlay)/i.test(t.url)); return matching.length ? matching : false; }, 30000);
  const connections = [];
  for (const target of candidates) { const socket = await Socket.connect(target.webSocketDebuggerUrl); await socket.call('Runtime.enable'); connections.push({ target, socket }); }
  let visibilityStates = [];
  const visible = await until(async () => {
    visibilityStates = await Promise.all(connections.map(async candidate => ({
      id: candidate.target.id,
      visible: await candidate.socket.eval('document.hidden===false').catch(() => false),
    })));
    const current = connections.filter(candidate => visibilityStates.find(state => state.id === candidate.target.id)?.visible);
    return current.length === 1 ? current : false;
  }, 15000, 200).catch(() => null);
  if (!visible && !(options.scope === 'window' && connections.length === 1)) {
    await writeFile(path.join(directory, 'renderer-targets.json'), JSON.stringify({ candidates: visibilityStates }, null, 2));
    for (const candidate of connections) candidate.socket.close();
    throw Error('visible_renderer_target_missing_or_ambiguous');
  }
  const selected = visible?.[0] || connections[0];
  h.targetId = selected.target.id; h.socket = selected.socket;
  for (const candidate of connections) if (candidate !== selected) candidate.socket.close();
  await h.socket.call('Page.enable'); await h.socket.call('Page.bringToFront');
  if (options.scope !== 'window') {
  h.injector = new runtime.CdpWallpaperInjector({ port, pollIntervalMs: 2000, verifyEndpoint: verify, sceneProvider: {
    getConfig: () => sharedStore.get(), getProject: async id => results.projects.find(p => p.id === id), authorFiles: sharedServer.authorFiles,
    diagnosticProbe: true, onMediaControl: (id, v) => media.control({ ...v, projectId: id }),
  }, onStatus: s => { h.events ||= []; const item = { type: s.type, at: s.at };
    if (s.type === 'injection-failed') { try { const v = JSON.parse(s.message); for (const key of ['targetIndex', 'category', 'cdpCode', 'mediaState', 'switchFailure']) item[key] = v[key]; } catch {} }
    if (s.type === 'attach-error') item.reason = ['Native CDP endpoint is not identity-verified', 'Renderer runtime readiness verification failed', 'Renderer DOM application verification failed'].includes(s.message) ? s.message : 'attach_failed';
    h.events.push(item); if (h.events.length > 400) h.events.shift(); } });
  }
  results.hosts.push({ kind, pid: child.pid, creation: h.identity.creation, exe, port, profile, compiledSha256: proof.sha256 }); await save(); return h;
}
async function windowSnapshot(h, phase) {
  await h.verify();
  const document = await h.socket.eval(`({hidden:document.hidden,visibility:document.visibilityState,focused:document.hasFocus(),width:innerWidth,height:innerHeight})`);
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(workspace, 'scripts/m3-window-state.ps1'), '-TargetFile', h.targetFile], { windowsHide: true, timeout: 15000, maxBuffer: 32768 }).catch(async error => {
    await writeFile(path.join(runRoot, h.kind, 'window-inspection-error.txt'), String(error.stderr || error.code).slice(0, 8192));
    throw Error('window_native_inspection_failed');
  });
  const native = JSON.parse(stdout.replace(/^\uFEFF/, '').trim());
  h.windowTimeline ||= []; h.windowTimeline.push({ phase, document, native });
  await writeFile(path.join(runRoot, h.kind, 'window-timeline.json'), JSON.stringify(h.windowTimeline, null, 2));
  return { document, native };
}
async function diagnoseWindow(h) {
  for (const phase of ['initial', 'native-restored', 'cdp-front', 'minimized', 'restored-again']) {
    if (phase === 'native-restored' || phase === 'restored-again') await hostWindow(h, 'normal');
    if (phase === 'cdp-front') await h.socket.call('Page.bringToFront');
    if (phase === 'minimized') await hostWindow(h, 'minimized');
    for (let n = 0; n < 3; n++) { await windowSnapshot(h, `${phase}-${n}`); await sleep(400); }
  }
  const restored = h.windowTimeline.filter(row => row.phase.startsWith('restored-again'));
  await check(`${h.kind}_window_renderer_stably_visible`, restored.every(row => !row.document.hidden && row.native.windows.some(w => w.visible && !w.iconic && w.cloaked === 0)), { samples: h.windowTimeline.length });
  const image = await h.socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  await writeFile(path.join(runRoot, h.kind, 'window-diagnostic.png'), Buffer.from(image.data, 'base64'));
}
async function resourceSoak(h) {
  await activateHost(h, 'soak');
  const deadline = performance.now() + options.soakSeconds * 1000, samples = [];
  let previous = await readOwnedGpuResources([h.identity]);
  while (performance.now() < deadline) {
    await sleep(5000); const current = await readOwnedGpuResources([h.identity]);
    samples.push({ at: current.at, ...gpuResourceDelta(previous, current), playback: await h.socket.eval(videoProbe) }); previous = current;
    await writeFile(path.join(runRoot, h.kind, 'resource-soak.json'), JSON.stringify({ requestedSeconds: options.soakSeconds, samples }, null, 2));
  }
  const frames = samples.map(row => row.playback.frames || 0);
  await check(`${h.kind}_focused_resource_soak_video_advances`, samples.length > 1 && samples.every(row => !row.playback.hidden && !row.playback.paused && row.playback.ready >= 2) && frames.at(-1) > frames[0], { samples: samples.length, requestedSeconds: options.soakSeconds, elapsedMs: samples.reduce((sum, row) => sum + row.elapsedMs, 0), measurementOnly: true, performanceThresholdVerified: false });
}
async function updateHosts(hosts, selectedId, effects = {}) {
  await sharedStore.set({ selectedId, effects }); const plan = await runtime.buildCurrentInjection(sharedServer, sharedStore, { directSceneEnabled: true });
  for (const h of hosts) {
    await h.verify(); const result = h.injector.running ? await h.injector.update(plan) : await h.injector.start(plan);
    await check(`${h.kind}_apply_${selectedId}_${results.checks.length}`, result.sessions > 0 && (result.failed || 0) === 0, { sessions: result.sessions, failed: result.failed || 0 });
  }
}
async function playbackTests(h) {
  await activateHost(h, 'video');
  const initial = await until(async () => { const p = await h.socket.eval(videoProbe); return p.video && p.ready >= 2 && p.width === 640 ? p : false; }, 12000).catch(async () => {
    await writeFile(path.join(runRoot, h.kind, 'video-failure-probe.json'), JSON.stringify(await h.socket.eval(videoProbe), null, 2));
    throw Error('real_video_probe_not_ready');
  });
  await sleep(600); const moving = await h.socket.eval(videoProbe);
  await check(`${h.kind}_real_video_decoded_playing`, !moving.paused && moving.frames > initial.frames, { width: moving.width, height: moving.height, framesBefore: initial.frames, framesAfter: moving.frames });
  const image = await h.socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(runRoot, h.kind, 'video.png'), Buffer.from(image.data, 'base64'));
  const windowControlled = await hostWindow(h, 'minimized'); const hidden = windowControlled ? await until(async () => { const p = await h.socket.eval(videoProbe); return p.hidden && p.paused ? p : false; }, 6000).catch(() => null) : null;
  await check(`${h.kind}_actual_hide_pauses_video`, Boolean(hidden), { hidden: hidden?.hidden, paused: hidden?.paused });
  await hostWindow(h, 'normal'); await h.socket.call('Page.bringToFront'); const resumed = await until(async () => { const p = await h.socket.eval(videoProbe); return !p.hidden && !p.paused ? p : false; }, 6000).catch(() => null);
  await check(`${h.kind}_actual_show_resumes_video`, Boolean(windowControlled && resumed), { hidden: resumed?.hidden, paused: resumed?.paused, actualHideExercised: Boolean(windowControlled) });
  await h.injector.updatePower({ onBattery: true }); const battery = await h.socket.eval(videoProbe);
  await check(`${h.kind}_simulated_battery_policy_pauses`, battery.paused && battery.status?.playback?.reasons?.includes('battery'), { evidence: 'injected_boolean_not_physical_unplug' });
  await h.injector.updatePower({ onBattery: false }); const powerResume = await until(async () => { const p = await h.socket.eval(videoProbe); return !p.paused ? p : false; }, 5000).catch(() => null);
  await check(`${h.kind}_simulated_AC_policy_resumes`, Boolean(powerResume), { evidence: 'injected_boolean_not_physical_replug' });
}
async function manualPauseTests(h) {
  await activateHost(h, 'manual_pause'); await h.injector.updatePower({ onBattery: true }); await hostWindow(h, 'minimized');
  await h.injector.updatePower({ onBattery: false }); await hostWindow(h, 'normal'); await h.socket.call('Page.bringToFront');
  const p = await h.socket.eval(videoProbe); await check(`${h.kind}_manual_pause_survives_simulated_power_restore`, p.paused === true && p.status.playback?.reasons?.includes('user') && sharedStore.get().effects.playing === false, { userIntent: sharedStore.get().effects.playing, paused: p.paused, actualHideExercised: h.windowControl === true });
}
async function webContext(h) {
  const tree = await h.socket.call('Page.getFrameTree'); const frames = [];
  function walk(n) { frames.push(n.frame); for (const child of n.childFrames || []) walk(child); } walk(tree.frameTree);
  for (const frame of frames) {
    if (!frame.url.startsWith('http://127.0.0.1:') || !/\/project\/index\.html/.test(frame.url)) continue;
    const id = h.socket.contexts.get(frame.id); if (id) { const p = await h.socket.eval('globalThis.__m3OwnProbe ? {...globalThis.__m3OwnProbe} : null', id).catch(() => null); if (p?.nonce === nonce) return { id, probe: p }; }
  }
  return false;
}
async function webTests(h, player) {
  await activateHost(h, 'web'); await media.pump();
  const web = await until(async () => { await media.pump(); const w = await webContext(h); return w?.probe.own && w.probe.audio > 0 ? w : false; }, 15000, 250).catch(() => null);
  await check(`${h.kind}_real_Web_music_metadata_spectrum`, Boolean(web), { ...(web ? { audioEvents: web.probe.audio, max: web.probe.max, mediaEvents: web.probe.media, frames: web.probe.frames } : { reason: 'own_web_callbacks_not_observed' }) });
  if (!web) return;
  await sleep(1200); const probe = (await webContext(h)).probe;
  await check(`${h.kind}_real_Web_cover`, probe.thumbnail > 0, { thumbnailEvents: probe.thumbnail });
  await check(`${h.kind}_real_Web_LRC_capabilities`, probe.lyricOwn && probe.commands.includes('pause'), { lyricEvents: probe.lyrics, lyricOwn: probe.lyricOwn, commands: probe.commands });
  const before = await player.command('snapshot');
  const control = await h.socket.eval('window.cwbMediaIntegration.control("pause")', web.id).catch(() => false);
  const after = await until(async () => { const p = await player.command('snapshot'); return p.paused && p.remote.pause > before.remote.pause ? p : false; }, 5000).catch(() => null);
  await check(`${h.kind}_Web_private_control_real_player`, control === true && Boolean(after), { ack: control === true, nativeActionObserved: Boolean(after) });
  await player.command('play');
  const image = await h.socket.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false }); await writeFile(path.join(runRoot, h.kind, 'music-web.png'), Buffer.from(image.data, 'base64'));
  const actualHidden = await hostWindow(h, 'minimized'); await sleep(1000); await h.injector.sceneDelivery.sweep();
  const pausedFrame = await webContext(h); const f0 = pausedFrame?.probe.frames; await sleep(700); const f1 = (await webContext(h))?.probe.frames;
  const p = await h.socket.eval(`({hidden:document.hidden,playing:globalThis.__codexWallpaperBridgeRuntime?.status?.().playback?.playing})`);
  await check(`${h.kind}_actual_hide_pauses_Web`, p.hidden && p.playing === false && (f1 === f0 || f1 - f0 <= 2), { hidden: p.hidden, effectivePlaying: p.playing, framesBefore: f0, framesAfter: f1 });
  await hostWindow(h, 'normal'); await h.socket.call('Page.bringToFront'); await sleep(1000); await media.pump();
  const shown = await until(async () => { const w = await webContext(h); return w && w.probe.frames > f1 && w.probe.audio > probe.audio ? w : false; }, 5000).catch(() => null);
  await check(`${h.kind}_actual_show_resumes_Web_music`, Boolean(actualHidden && shown), { actualHideExercised: Boolean(actualHidden) });
}
async function caches() {
  const directory = path.join(runRoot, 'cache-state'); await mkdir(directory, { recursive: true }); await mkdir(crossRoot);
  const store = new runtime.ConfigStore({ filePath: path.join(directory, 'config.json') }); await store.load();
  let cache = new runtime.ManagedCache({ configStore: store, env: {} }); await cache.init();
  const src = cache.status().actualDirectory, videoDir = await cache.directory('video');
  const file = path.join(videoDir, `${'a'.repeat(64)}.mp4`), bytes = Buffer.alloc(32 * 1024 * 1024, 0x35);
  await writeFile(file, bytes); const digest = hash(bytes); await writeFile(path.join(src, 'unknown-user.txt'), 'M3 unknown source retain');
  const destParent = path.join(crossRoot, 'locked'); await mkdir(destParent);
  const lockScript = path.join(runRoot, 'lock.ps1'); await writeFile(lockScript, `param([string]$File)\n$ErrorActionPreference='Stop'\n$f=[IO.File]::Open($File,[IO.FileMode]::Open,[IO.FileAccess]::Read,[IO.FileShare]::None)\ntry { [Console]::WriteLine('locked');$null=[Console]::ReadLine() } finally {$f.Dispose()}\n`);
  const lock = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', lockScript, '-File', file], process.env);
  let locked = false; lock.stdout.on('data', b => { if (b.toString().includes('locked')) locked = true; }); await until(() => locked, 8000);
  let job = await cache.beginMigration(destParent); await cache.wait(); job = cache.job(job.id);
  await check('Windows_FileShare_None_migration_fails_safe', job.status === 'failed' && store.get().cache.directory === null, { status: job.status, error: job.error, configuredUnchanged: store.get().cache.directory === null });
  lock.stdin.end('\n'); await lock.exited;
  job = await cache.retry(job.id); await cache.wait(); job = cache.job(job.id);
  const dst = store.get().cache.directory;
  await check('D_to_F_physical_disk_migration_after_unlock', job.status === 'completed' && hash(await readFile(path.join(dst, 'video', path.basename(file)))) === digest && hash(await readFile(file)) === digest, { status: job.status, copied: job.result?.copied, bytes: job.bytes, sourceRetained: true });
  await check('migration_unknown_source_not_copied', await readFile(path.join(src, 'unknown-user.txt'), 'utf8') === 'M3 unknown source retain' && await access(path.join(dst, 'unknown-user.txt')).then(() => false, () => true));
  await cache.close();
  const override = new runtime.ManagedCache({ configStore: store, env: { CWB_CACHE_ROOT: path.join(directory, 'override-cache') } }); await override.init();
  let rejected = false; try { await override.beginMigration(destParent); } catch (e) { rejected = e.message === 'cache_environment_override'; }
  await check('actual_configured_cache_path_and_env_migration_guard', rejected && override.status().environmentOverride && override.status().actualDirectory !== override.status().configuredDirectory); await override.close();
  // Fresh state for a real worker interruption; no beforeCopy mock or fabricated journal.
  const interrupted = path.join(runRoot, 'interrupted-cache-state'); await mkdir(interrupted);
  const interruptedStore = new runtime.ConfigStore({ filePath: path.join(interrupted, 'config.json') }); await interruptedStore.load();
  cache = new runtime.ManagedCache({ configStore: interruptedStore, env: {} }); await cache.init();
  const bigFile = path.join(await cache.directory('video'), `${'b'.repeat(64)}.mp4`), big = Buffer.alloc(128 * 1024 * 1024, 0x71); await writeFile(bigFile, big); const bigHash = hash(big); await cache.close();
  const freshParent = path.join(crossRoot, 'interrupted-fresh'); await mkdir(freshParent);
  const workerFile = path.join(runRoot, 'cache-worker.mjs');
  await writeFile(workerFile, `import {ConfigStore,ManagedCache} from ${JSON.stringify(pathToFileURL(path.join(snapshot, 'runtime/src/m3.mjs')).href)};import readline from 'node:readline';const s=new ConfigStore({filePath:process.argv[2]});await s.load();const c=new ManagedCache({configStore:s,env:{}});await c.init();const input=readline.createInterface({input:process.stdin});await new Promise(r=>input.once('line',r));input.close();const j=await c.beginMigration(process.argv[3]);await c.wait();process.stdout.write(JSON.stringify(c.job(j.id)));await c.close();`);
  const worker = launch(process.execPath, [workerFile, interruptedStore.filePath, freshParent], process.env); worker.stdout.on('data', () => {}); worker.identity = await proc(worker.pid);
  worker.stdin.end('go\n');
  const actualDest = path.join(freshParent, 'CodexWallpaperBridge-cache', 'video');
  let partial = null;
  try { partial = await until(async () => { try { const files = await readdir(actualDest); const part = files.find(n => n.endsWith('.part')); if (!part) return false; const st = await stat(path.join(actualDest, part)); return st.size > 0 && st.size < big.length ? { file: part, bytes: st.size } : false; } catch { return false; } }, 8000, 2); } catch {}
  if (partial) { worker.kill(); await worker.exited; } else await worker.exited;
  await writeFile(path.join(runRoot, 'interruption.json'), JSON.stringify({ partialObserved: partial, exit: worker.exitInfo, intentionallyKilledOwnedChild: Boolean(partial) }, null, 2));
  await interruptedStore.load(); cache = new runtime.ManagedCache({ configStore: interruptedStore, env: {} }); await cache.init();
  const recovery = cache.status().recovery;
  await check('actual_mid_copy_child_termination_journal_retained', Boolean(partial && recovery?.resumable) && interruptedStore.get().cache.directory === null, { partialBytes: partial?.bytes, recoveryPhase: recovery?.phase, configuredUnchanged: interruptedStore.get().cache.directory === null });
  if (recovery?.resumable) { job = await cache.resume(); await cache.wait(); job = cache.job(job.id); const target = path.join(interruptedStore.get().cache.directory || '', 'video', path.basename(bigFile));
    await check('actual_interruption_restart_resume_hash_verified', job.status === 'completed' && hash(await readFile(target)) === bigHash && hash(await readFile(bigFile)) === bigHash, { status: job.status, sourceRetained: true, copied: job.result?.copied }); }
  await cache.close();
}
async function cleanup() {
  if (media) { await media.close().catch(() => {}); await check('native_helper_close', provider.status().running === false && provider.status().forcedStops === 0, provider.status()); }
  for (const h of [...hostObjects].reverse()) {
    let descendants = [];
    try { if (h.verify) await h.verify(); const live = await proc(h.child.pid); if (live?.creation !== h.identity?.creation) throw Error('host_identity_changed'); descendants = await tree(h.child.pid);
      if (h.injector) { await h.injector.restore(); await check(`${h.kind}_restore`, true); await h.injector.close(); }
      if (h.socket) { const clean = await h.socket.eval(`({root:!!document.getElementById('codex-wallpaper-bridge-root'),active:document.documentElement.dataset.codexWallpaperBridge==='active'})`).catch(() => null); await check(`${h.kind}_wallpaper_removed`, clean?.root === false && clean?.active === false, clean || {}); }
      let closeMethod = 'WM_CLOSE'; await ownedWindowCommand(h, 'close').catch(() => { closeMethod = 'cdp-close-fallback'; });
      let exited = await Promise.race([h.child.exited.then(() => true), sleep(6000).then(() => false)]);
      if (!exited && h.browser) { closeMethod = 'cdp-close-fallback'; if (h.targetId) await h.browser.call('Target.closeTarget', { targetId: h.targetId }, 3000).catch(() => {}); await h.browser.call('Browser.close', {}, 3000).catch(() => {}); exited = await Promise.race([h.child.exited.then(() => true), sleep(4000).then(() => false)]); }
      await check(`${h.kind}_natural_host_exit`, exited && h.child.exitInfo?.code === 0, { ...h.child.exitInfo, forced: !exited, closeMethod });
      if (!exited) await preciseStop(h.identity);
    } catch { await check(`${h.kind}_cleanup_identity_or_restore_failure`, false); }
    h.socket?.close(); h.browser?.close();
    for (const p of descendants.reverse()) { const live = await proc(p.pid).catch(() => null); if (live && live.creation === p.creation) { const stopped = await preciseStop(p).catch(() => 'failed'); await check(`${h.kind}_owned_descendant_cleanup_${p.pid}`, stopped !== 'failed', { forced: true, pid: p.pid }); } }
    await writeFile(path.join(runRoot, h.kind, 'events.json'), JSON.stringify(h.events || [], null, 2));
  }
  if (sharedServer) await sharedServer.close().catch(() => {});
  for (const player of players) { if (player.exitInfo) continue; await player.command('quit').catch(() => {}); const exited = await Promise.race([player.exited.then(() => true), sleep(5000).then(() => false)]); await check(`player_${player.pid}_natural_exit`, exited && player.exitInfo?.code === 0, { ...player.exitInfo, forced: !exited }); if (!exited) await preciseStop(player.identity).catch(() => {}); }
  const after = await protection(); const dailyAfter = await fileHashes();
  await check('current_chat_identity_preserved', JSON.stringify(after) === JSON.stringify(protectedBefore));
  await check('daily_configuration_hashes_preserved', JSON.stringify(dailyAfter) === JSON.stringify(dailyBefore));
  await writeFile(path.join(runRoot, 'protection-after.json'), JSON.stringify({ protected: after, daily: dailyAfter }, null, 2));
  if (proof) await check('compiled_snapshot_unchanged_after_hosts', await verifyCompiledSnapshot(snapshot, proof));
  if (results.sources) { const current = await Promise.all(results.sources.map(async s => ({ ...s, sha256: hash(await readFile(path.resolve(workspace, s.file))) }))); await check('source_bytes_unchanged_during_acceptance', JSON.stringify(current) === JSON.stringify(results.sources)); }
}
await mkdir(runRoot, { recursive: true });
process.stdout.write(JSON.stringify({ runRoot, crossRoot }) + '\n');
try {
  if (!process.argv.includes('--approved-isolated-hosts')) throw Error('explicit_isolated_host_authorization_required');
  if (process.platform !== 'win32') throw Error('windows_required');
  protectedBefore = await protection(); dailyBefore = await fileHashes();
  await writeFile(path.join(runRoot, 'protection-before.json'), JSON.stringify({ protected: protectedBefore, daily: dailyBefore }, null, 2));
  if (options.scope === 'all') {
    const physical = JSON.parse(await ps('$v=@("D","F")|ForEach-Object {$p=Get-Partition -DriveLetter $_ -ErrorAction Stop;[ordered]@{drive=$_;disk=[int]$p.DiskNumber;partition=[int]$p.PartitionNumber}};ConvertTo-Json -InputObject @($v) -Compress'));
    results.disks = physical; if (physical[0].disk === physical[1].disk) throw Error('distinct_physical_disks_required');
    await check('real_distinct_physical_disks', true, { disks: physical });
  }
  const storeExe = protectedBefore.find(p => /WindowsApps/i.test(p.exe))?.exe; const localExe = 'D:\\codex\\ChatGPT.exe';
  if (!storeExe) throw Error('store_installation_not_found'); await access(localExe); results.installations = { store: storeExe, local: localExe };
  await compile();
  if (options.scope === 'window') {
    const h = await launchHost(options.host, options.host === 'store' ? storeExe : localExe, options.host === 'store' ? 19381 : 19382);
    await diagnoseWindow(h);
  } else {
  await assets();
  const reuseVideo = options.scope !== 'all' || process.argv.includes('--native-player') || process.argv.includes('--reuse-video');
  if (reuseVideo) {
    const prior = path.join(workspace, 'out/live-acceptance/m3-20261014T083511981Z-f0f98b39/assets/video/sample.webm');
    await cp(prior, path.join(runRoot, 'assets/video/sample.webm'));
    await cp(path.join(path.dirname(path.dirname(prior)), 'cover.png'), path.join(runRoot, 'assets/cover.png'));
    await check('prior_self_recorded_real_WebM_reused', true, { encoder: 'Chromium MediaRecorder VP8, not ffmpeg', sha256: hash(await readFile(prior)) });
  }
  if (options.scope !== 'all' || process.argv.includes('--skip-cache')) results.reusedCacheEvidence = 'out/live-acceptance/m3-20261015T003140561Z-6d3837c3/result.json';
  else await caches();
  let player;
  if (['all', 'media', 'web'].includes(options.scope)) {
    try { player = await startPlayer('A', 19383); if (!reuseVideo) await player.command('makeVideo'); }
    catch { await check('own_player_not_available', false, { remainingHostPlaybackChecksContinue: true }); }
  }
  await check('self_generated_real_decodable_WebM_created', (await stat(path.join(runRoot, 'assets/video/sample.webm'))).size > 1024, { encoder: 'Chromium MediaRecorder VP8, not ffmpeg' });
  await setupMedia({ nativeSources: ['all', 'media', 'web'].includes(options.scope) }); let usable = false;
  if (player && ['all', 'media'].includes(options.scope)) { try { usable = await nativeMediaTests(player); } catch { await check('native_media_test_incomplete', false, { remainingHostPlaybackChecksContinue: true }); } }
  if (player && options.scope === 'web') { usable = Boolean(await until(ownedTrack, 25000)); await sharedStore.set({ media: { allowControl: true } }); await media.configure(); }
  const hosts = [];
  if (options.scope !== 'media') {
    if (!options.host || options.host === 'store') hosts.push(await launchHost('store', storeExe, 19381));
    if (!options.host || options.host === 'local') hosts.push(await launchHost('local', localExe, 19382));
  }
  for (const h of hosts) {
    if (options.scope !== 'web') {
    await activateHost(h, 'video_apply');
    await updateHosts([h], 'm3-owned-video', { playing: true });
    await playbackTests(h);
    await updateHosts([h], 'm3-owned-video', { playing: false });
    await manualPauseTests(h);
    if (options.scope === 'soak') { await updateHosts([h], 'm3-owned-video', { playing: true }); await resourceSoak(h); }
    }
    if (usable) {
      const s = await until(ownedTrack);
      await request('media/lyrics', { sessionId: s.sessionId, trackKey: s.trackKey, lrc: '[00:00.00]CWB lyric first\n[00:01.00]CWB lyric second\n[00:03.00]CWB lyric third' });
      await activateHost(h, 'web_apply');
      await updateHosts([h], 'm3-owned-web', { playing: true });
      await webTests(h, player);
    }
  }
  if (usable && ['all', 'media'].includes(options.scope)) {
    const old = (await until(ownedTrack)).sessionId; await player.command('quit'); await player.exited;
    const nextPlayer = await startPlayer('B', 19384); const next = await until(async () => { const s = await ownedTrack(); return s && s.sessionId !== old && s.track.title.includes('-B-') ? s : false; }, 20000);
    const r = await request('media/control', { command: 'pause', sessionId: old }); await check('real_new_GSMTC_session_rejects_previous_id', r.status === 409 && !(await nextPlayer.command('snapshot')).paused, { status: r.status, distinctSession: next.sessionId !== old });
    await nextPlayer.command('quit'); await nextPlayer.exited;
    const cleared = await until(async () => { const s = await media.snapshot(); return !s.track && !s.sessionId ? s : false; }, 12000).catch(() => null);
    await check('no_player_real_session_clears_track', Boolean(cleared), { reason: cleared ? 'no_session' : 'another_system_session_or_not_cleared_no_control_attempted' });
  }
  }
} catch (e) { results.failure = /^[a-zA-Z0-9_ -]{1,160}$/.test(e.message) ? e.message : 'acceptance_stage_failed'; await check('run_stage_failure', false, { reason: results.failure, method: e.method, protocolCode: e.protocolCode }); }
finally { try { await cleanup(); } catch { results.cleanupError = true; } results.finished = new Date().toISOString(); results.passed = results.checks.filter(c => c.ok).length; results.failed = results.checks.filter(c => !c.ok).length; await save(); process.stdout.write(JSON.stringify({ finished: true, runRoot, passed: results.passed, failed: results.failed, failure: results.failure, cleanupError: results.cleanupError }) + '\n'); process.exitCode = results.failed || results.cleanupError ? 1 : 0; }
