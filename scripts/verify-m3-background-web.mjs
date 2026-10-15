/** Opt-in real Windows media -> offscreen Chromium -> readonly Web callbacks.
 * This is NOT Store/local visible-host, battery hardware or screen-FPS evidence.
 */
import { createServer } from 'node:http';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { createReadonlyWallpaperServer } from '../bridge-runtime/src/scene-server.mjs';
import { MediaMiddleware } from '../bridge-runtime/src/media-middleware.mjs';
import { WindowsMediaProvider } from '../bridge-runtime/src/windows-media-provider.mjs';
import { LyricsStore } from '../bridge-runtime/src/media-lyrics.mjs';
import { compileWindowsMedia } from './compile-windows-media.mjs';
import { readOwnedGpuResources, gpuResourceDelta } from './m2-gpu-resource-sampler.mjs';
import { createTestScratch, cleanupTestScratch } from './m3-test-artifacts.mjs';

if (!process.argv.includes('--approved-background-media') || process.platform !== 'win32') throw Error('background_media_opt_in_required');
const sampleText = process.argv.find(value => value.startsWith('--sample-seconds='))?.split('=')[1] ?? '0';
if (!/^\d+$/.test(sampleText) || Number(sampleText) > 1800) throw Error('background_sample_duration_invalid');
const sampleSeconds = Number(sampleText), exec = promisify(execFile);
const webOnly = process.argv.includes('--web-only');
if (webOnly && !sampleSeconds) throw Error('web_resource_duration_required');
const workspace = path.resolve(import.meta.dirname, '..'), nonce = randomUUID(), token = nonce.replaceAll('-', '');
const evidenceRoot = path.join(workspace, 'out/live-acceptance', `m3-background-${Date.now()}-${token.slice(0, 8)}`);
await mkdir(evidenceRoot);
const scratch = await createTestScratch(evidenceRoot), root = scratch.directory;
await mkdir(path.join(root, 'assets', 'web'), { recursive: true });
const report = { root: evidenceRoot, testScratch: root, nonce, scope: 'real-native-media-to-offscreen-Web', foregroundRequested: false,
  realCodexOperated: false, visibleHostAcceptance: false, physicalScreenFps: null, checks: [] };
if (webOnly) report.scope = 'offscreen-Web-empty-media-resource-diagnostic';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const files = ['bridge-runtime/native/windows-media.cs', 'bridge-runtime/native/windows-media.ps1', 'bridge-runtime/public/cwb-web-bridge.js',
  'bridge-runtime/src/media-middleware.mjs', 'bridge-runtime/src/windows-media-provider.mjs', 'bridge-runtime/src/media-lyrics.mjs',
  'scripts/m3-background-web.cjs', 'scripts/verify-m3-background-web.mjs', 'scripts/m3-acceptance-native-player.ps1', 'scripts/m2-gpu-resource-sampler.mjs', 'scripts/m3-test-artifacts.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, sha(await readFile(path.join(workspace, file)))])));
const before = await hashes(); report.sourceSha256 = before;
let wallpaper, provider, media, player, fixture, helper, parent, sequence = 0, probe = {}, lastProbe = 0, commandId = 0;
const commands = [];
let mediaStage = 'startup', importedSessionId = '', importedTrackKey = '', lastMediaShape = '';
report.mediaTransitions = [];
function observeMedia(event) {
  // Correlation only: never retain daily titles, source application IDs or URLs.
  let value;
  if (event.type === 'session') value = { kind: 'session', present: Boolean(event.id), sameAsImported: Boolean(importedSessionId && event.id === importedSessionId) };
  else if (event.type === 'status') value = { kind: 'status', source: event.source, state: event.state };
  else if (event.type === 'input' && event.input.op === 'media') {
    const m = event.input.value;
    value = { kind: 'track', titlePresent: Boolean(m.title), ownTitle: m.title.startsWith(`CWB-M3-${nonce}-A-`),
      ownArtist: m.artist === 'CWB Acceptance Fixture', ownAlbum: m.album === `CWB M3 ${nonce}`, state: m.state };
  } else if (event.type === 'input' && event.input.op === 'mediaStatus') value = { kind: 'mediaStatus', enabled: event.input.value.enabled };
  else return;
  const shape = JSON.stringify({ stage: mediaStage, ...value });
  if (shape === lastMediaShape) return;
  lastMediaShape = shape;
  if (report.mediaTransitions.length < 160) report.mediaTransitions.push({ at: Date.now(), stage: mediaStage, ...value });
}
const config = { selectedId: 'm3-background', effects: { playing: true }, media: { captureAudio: true, nowPlaying: true, allowControl: false, onlineLyrics: false } };
if (webOnly) Object.assign(config.media, { captureAudio: false, nowPlaying: false });
async function save() { await writeFile(path.join(evidenceRoot, 'report.json'), JSON.stringify(report, null, 2)); }
async function check(name, ok, detail = {}) { report.checks.push({ name, ok: Boolean(ok), ...detail }); await save(); process.stdout.write(JSON.stringify(report.checks.at(-1)) + '\n'); }
async function until(fn, ms = 10000) { const end = performance.now() + ms; do { const value = await fn(); if (value) return value; await sleep(100); } while (performance.now() < end); throw Error('background_wait_timeout'); }
function launch(exe, args) {
  const child = spawn(exe, args, { windowsHide: true, shell: false, stdio: 'ignore' });
  child.done = new Promise((resolve, reject) => { child.once('exit', (code, signal) => { child.exitInfo = { code, signal }; resolve(child.exitInfo); }); child.once('error', reject); });
  child.done.catch(() => {}); return child;
}
async function messages() { try { return JSON.parse(await readFile(path.join(root, 'player-A-state.json'), 'utf8')); } catch { return []; } }
async function playerCommand(op) {
  const request = ++commandId, file = path.join(root, 'player-A-command.json');
  await writeFile(file + '.tmp', JSON.stringify({ request, op })); await rename(file + '.tmp', file);
  return (await until(async () => (await messages()).find(row => row.type === 'reply' && row.request === request))).result;
}
async function send(op) { const id = ++sequence; commands.push({ id, ...op }); if (commands.length > 16) commands.shift(); await until(() => op.command === 'control' ? probe.controlRequestId === id : probe.commandSeen >= id); }
const ownTrack = async () => { const s = await media.snapshot(); return s.track?.title.startsWith(`CWB-M3-${nonce}-A-`) && s.sessionId ? s : false; };
function wave(frequency) {
  const samples = 48000 * 20, bytes = Buffer.alloc(44 + samples * 4); bytes.write('RIFF'); bytes.writeUInt32LE(bytes.length - 8, 4); bytes.write('WAVEfmt ', 8); bytes.writeUInt32LE(16, 16);
  bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(2, 22); bytes.writeUInt32LE(48000, 24); bytes.writeUInt32LE(192000, 28); bytes.writeUInt16LE(4, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36); bytes.writeUInt32LE(samples * 4, 40);
  for (let n = 0; n < samples; n++) { const value = Math.round(Math.sin(n * 2 * Math.PI * frequency / 48000) * 4000); bytes.writeInt16LE(value, 44 + n * 4); bytes.writeInt16LE(value, 46 + n * 4); } return bytes;
}
function coverPng() {
  const chunk = (type, data) => {
    const body = Buffer.concat([Buffer.from(type), data]); let crc = 0xffffffff;
    for (const byte of body) { crc ^= byte; for (let n = 0; n < 8; n++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
    const header = Buffer.alloc(4), tail = Buffer.alloc(4); header.writeUInt32BE(data.length); tail.writeUInt32BE((crc ^ 0xffffffff) >>> 0); return Buffer.concat([header, body, tail]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(128); header.writeUInt32BE(128, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(128 * (1 + 128 * 3), 100); for (let n = 0; n < 128; n++) pixels[n * 385] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
async function sampleResources() {
  // Long sampling runs after the owned player and system capture have stopped.
  // Do not leave tones playing or collect daily system audio for a soak.
  const pids = webOnly || sampleSeconds > 120 ? [fixture.pid] : [fixture.pid, player.pid, helper.pid];
  const source = `$ErrorActionPreference='Stop';ConvertTo-Json -InputObject @(@(${pids.join(',')})|ForEach-Object {$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+$_);if(!$p){throw 'owned_process_absent'};[ordered]@{pid=[int]$p.ProcessId;exe=$p.ExecutablePath;creation=$p.CreationDate.ToUniversalTime().ToString('o')}}) -Compress`;
  const { stdout } = await exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', source], { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
  const roots = JSON.parse(stdout.replace(/^\uFEFF/, '').trim()); report.ownedResourceRoots = roots;
  const resource = { requestedSeconds: sampleSeconds, measurementOnly: true, physicalScreenFps: null,
    scope: webOnly || sampleSeconds > 120 ? 'offscreen Web author loop; no player/system capture' : 'offscreen Web plus owned player/helper', samples: [] };
  async function memoryCheckpoint(label) {
    await writeFile(path.join(root, 'background-memory-request'), label);
    const target = path.join(root, `background-memory-${label}.json`);
    const value = await until(async () => { try { return JSON.parse(await readFile(target, 'utf8')); } catch { return false; } }, 15000);
    await copyFile(target, path.join(evidenceRoot, `background-memory-${label}.json`));
    if (value.failed) throw Error('background_memory_probe_failed');
    resource[label + 'Memory'] = value;
  }
  await memoryCheckpoint('start');
  let previous = await readOwnedGpuResources(roots); const deadline = performance.now() + sampleSeconds * 1000;
  resource.initialProcesses = previous.processes;
  while (performance.now() < deadline) {
    await sleep(5000); const current = await readOwnedGpuResources(roots);
    resource.samples.push({ at: current.at, ...gpuResourceDelta(previous, current), authorFrames: probe.frames, authorTimers: probe.ticks,
      processes: current.processes }); previous = current;
    await writeFile(path.join(evidenceRoot, 'resources.json'), JSON.stringify(resource, null, 2));
  }
  await memoryCheckpoint('end');
  await writeFile(path.join(evidenceRoot, 'resources.json'), JSON.stringify(resource, null, 2));
  report.ownedResourceIdentities = previous.processes.map(({ pid, exe, creation }) => ({ pid, exe, creation }));
  await check('background_resource_measurement_recorded', resource.samples.length > 1 && resource.samples.at(-1).authorFrames > resource.samples[0].authorFrames, { samples: resource.samples.length, requestedSeconds: sampleSeconds, scope: resource.scope, performanceThresholdVerified: false });
}
try {
  if (!webOnly) {
  for (const hz of [440, 880]) await writeFile(path.join(root, `assets/tone-${hz}.wav`), wave(hz));
  await writeFile(path.join(root, 'assets/cover.png'), coverPng());
  await compileWindowsMedia({ nativeRoot: path.join(workspace, 'bridge-runtime/native'), outputRoot: path.join(root, 'native') });
  player = launch('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(workspace, 'scripts/m3-acceptance-native-player.ps1'), '-Root', root, '-Nonce', nonce]);
  await until(async () => (await messages()).some(row => row.type === 'state' && !row.paused), 20000);
  provider = new WindowsMediaProvider({ spawnChild: (exe, args, opts) => {
    const mapped = [...args]; mapped[mapped.indexOf('-File') + 1] = path.join(root, 'native/windows-media.ps1'); helper = spawn(exe, mapped, opts); return helper;
  } });
  provider.onEvent(observeMedia);
  media = new MediaMiddleware({ getConfig: () => config, createProvider: () => provider, lyrics: new LyricsStore({ root: path.join(root, 'lyrics') }) });
  await media.configure(); const track = await until(ownTrack, 20000);
  importedSessionId = track.sessionId; importedTrackKey = track.trackKey;
  await media.importLyrics({ sessionId: track.sessionId, trackKey: track.trackKey, lrc: '[00:00.00]CWB background lyric\n[00:01.00]CWB background lyric 2' });
  await check('real_native_track_and_local_lyrics', true);
  } else {
    provider = new WindowsMediaProvider();
    media = new MediaMiddleware({ getConfig: () => config, createProvider: () => provider, lyrics: new LyricsStore({ root: path.join(root, 'lyrics') }) });
    await media.configure();
  }
  const html = `<!doctype html><meta charset="utf-8"><canvas width="640" height="360"></canvas><img id="cover"><script>
  const own=${JSON.stringify(`CWB-M3-${nonce}-A-`)};const p={audio:0,nonzero:0,media:0,own:false,thumbnail:0,coverDecoded:false,lyrics:0,lyricOwn:false,frames:0,ticks:0,state:0,position:0,duration:0,empty:false};
  wallpaperRegisterAudioListener(v=>{p.audio++;if(v.some(n=>n>0))p.nonzero++});
  wallpaperRegisterMediaPropertiesListener(v=>{p.media++;p.own=v.title.startsWith(own);p.empty=v.title===''});
  wallpaperRegisterMediaThumbnailListener(v=>{p.thumbnail+=v.thumbnail?1:0;document.querySelector('img').src=v.thumbnail});
  document.querySelector('img').onload=()=>{p.coverDecoded=document.querySelector('img').naturalWidth>0};
  wallpaperRegisterMediaPlaybackListener(v=>{p.state=v.state});wallpaperRegisterMediaTimelineListener(v=>{p.position=v.position;p.duration=v.duration});
  cwbMediaIntegration.registerLyricsListener(v=>{p.lyrics++;p.lyricOwn=v.text.startsWith('CWB background lyric')});
  const frame=()=>{p.frames++;requestAnimationFrame(frame)};requestAnimationFrame(frame);setInterval(()=>p.ticks++,50);
  addEventListener('message',async e=>{if(e.source!==parent||e.data?.source!=='m3-background-probe')return;const q=e.data;let control=null;
    if(q.command==='control'){try{control=await cwbMediaIntegration.control(q.value)}catch{control=false}}
    parent.postMessage({source:'m3-background-report',id:q.id,probe:{...p,control,capabilities:cwbMediaIntegration.capabilities(),phase:window.__cwbWeb?.phase}},e.origin)});
  </script>`;
  await writeFile(path.join(root, 'assets/web/index.html'), html); await writeFile(path.join(root, 'assets/web/project.json'), JSON.stringify({ type: 'web', file: 'index.html', general: { properties: {} } }));
  let origin;
  parent = createServer(async (req, res) => {
    try {
      if (req.headers.host !== new URL(origin).host || !req.url.startsWith('/' + token + '/')) { res.writeHead(404); res.end(); return; }
      res.setHeader('Cache-Control', 'no-store');
      if (req.method === 'GET' && req.url === `/${token}/feed`) {
        const s = await media.snapshot();
        const own = s.track?.title.startsWith(`CWB-M3-${nonce}-A-`);
        const inputs = own ? s.inputs : [{ op: 'audio', values: Array(128).fill(0) }, { op: 'mediaStatus', value: { enabled: false } }];
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ inputs: [...inputs,
          { op: 'mediaCapabilities', value: { sessionId: own ? s.sessionId : '', commands: own ? s.commands : [] } },
          { op: 'lyrics', value: { text: own ? s.lyric.text : '', next: own ? s.lyric.next : '' } }], commands })); return;
      }
      if (req.method === 'POST' && [`/${token}/report`, `/${token}/control`].includes(req.url) && req.headers.origin === origin) {
        let bytes = ''; for await (const part of req) { bytes += part; if (bytes.length > 8192) throw Error('body_limit'); } const value = JSON.parse(bytes);
        if (req.url.endsWith('/report')) { probe = value; lastProbe = Date.now(); res.end('{}'); return; }
        let ok = false; try { if (await ownTrack()) { await media.control({ command: value.command, sessionId: value.sessionId, projectId: config.selectedId }); ok = true; } } catch {}
        res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ ok })); return;
      }
      if (req.method !== 'GET' || req.url !== `/${token}/`) { res.writeHead(404); res.end(); return; }
      res.setHeader('Content-Type', 'text/html'); res.end(`<!doctype html><iframe sandbox="allow-scripts allow-same-origin" src=${JSON.stringify(wallpaper.rendererUrl)}></iframe><script>
      const frame=document.querySelector('iframe'),childOrigin=${JSON.stringify(wallpaper.origin)},channel=${JSON.stringify(wallpaper.channel)};let busy=false,last=0,lastControl={id:0,result:null};
      const send=v=>frame.contentWindow.postMessage({source:'cwb-web-control',channel,...v},childOrigin);
      addEventListener('message',async e=>{if(e.source!==frame.contentWindow||e.origin!==childOrigin)return;const v=e.data;
        if(v?.source==='cwb-web-media-control'&&v.channel===channel){let ok=false;try{ok=(await(await fetch('control',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({command:v.command,sessionId:v.sessionId})})).json()).ok}catch{}send({op:'mediaControlResult',requestId:v.requestId,ok})}
        if(v?.source==='m3-background-report'){if(v.probe.control!==null)lastControl={id:v.id,result:v.probe.control};await fetch('report',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...v.probe,commandSeen:v.id,controlRequestId:lastControl.id,control:lastControl.result})});}});
      setInterval(async()=>{if(busy)return;busy=true;try{const feed=await(await fetch('feed')).json();for(const input of feed.inputs)send(input);for(const q of feed.commands){if(q.id<=last)continue;last=q.id;if(q.op)send({op:q.op});frame.contentWindow.postMessage({source:'m3-background-probe',id:q.id,command:q.command,value:q.value},childOrigin)}frame.contentWindow.postMessage({source:'m3-background-probe',id:last},childOrigin)}catch{}finally{busy=false}},100);
      </script>`);
    } catch { res.writeHead(400); res.end('{}'); }
  });
  await new Promise(resolve => parent.listen(0, '127.0.0.1', resolve)); origin = `http://127.0.0.1:${parent.address().port}`;
  wallpaper = createReadonlyWallpaperServer({ project: { id: config.selectedId, type: 'web', rootPath: path.join(root, 'assets/web') }, parentOrigin: origin }); await wallpaper.start();
  fixture = launch(path.join(workspace, 'node_modules/electron/dist/electron.exe'), [path.join(workspace, 'scripts/m3-background-web.cjs'), root, `${origin}/${token}/`, ...(sampleSeconds ? ['--resource-probe'] : [])]);
  await until(() => probe.phase === 'renderable' && (webOnly ? probe.frames > 0 : probe.own && probe.nonzero > 0 && probe.coverDecoded && probe.lyricOwn), 20000);
  await check(webOnly ? 'offscreen_Web_author_with_empty_media' : 'real_offscreen_Web_spectrum_metadata_cover_LRC', true, { audioEvents: probe.audio, nonzero: probe.nonzero, thumbnailEvents: probe.thumbnail, coverDecoded: probe.coverDecoded, duration: probe.duration });
  const windowState = JSON.parse(await readFile(path.join(root, 'background-state.json'), 'utf8'));
  await copyFile(path.join(root, 'background-state.json'), path.join(evidenceRoot, 'background-state.json'));
  await check('offscreen_window_never_shown', windowState.visible === false && windowState.offscreen === true);
  if (sampleSeconds && (sampleSeconds <= 120 || webOnly)) await sampleResources();
  if (!webOnly) {
  // Test author suspension while the original system session is still current.
  // A remote player pause may legitimately cause Windows to select another app.
  mediaStage = 'Web-pause';
  await send({ op: 'pause' }); await sleep(300); const paused = { ...probe }; await sleep(700);
  await check('Web_pause_stops_author_frames_timers_and_audio', probe.frames === paused.frames && probe.ticks === paused.ticks && probe.audio === paused.audio, { frameDelta: probe.frames - paused.frames, timerDelta: probe.ticks - paused.ticks, audioDelta: probe.audio - paused.audio });
  mediaStage = 'Web-resume'; await send({ op: 'resume' }); report.resumeObservations = [];
  const resumed = await until(async () => {
    const s = await media.snapshot(), own = s.track?.title.startsWith(`CWB-M3-${nonce}-A-`) === true;
    const observation = { ownCallback: probe.own, sourceOwn: own, trackPresent: Boolean(s.track), sessionPresent: Boolean(s.sessionId),
      sameSessionAsImport: s.sessionId === importedSessionId, sourceState: s.sources.media, providerState: s.provider.reason,
      coverDecoded: probe.coverDecoded, lyricOwn: probe.lyricOwn,
      sameTrackKeyAsImport: own && s.trackKey === importedTrackKey,
      lyricSource: s.lyric.source, lyricState: s.lyric.state,
      framesAdvanced: probe.frames > paused.frames, audioAdvanced: probe.audio > paused.audio, timersAdvanced: probe.ticks > paused.ticks };
    if (report.resumeObservations.length < 80) report.resumeObservations.push(observation);
    return Object.values({ own: observation.ownCallback, sourceOwn: own, cover: observation.coverDecoded, lyric: observation.lyricOwn,
      frames: observation.framesAdvanced, audio: observation.audioAdvanced, timers: observation.timersAdvanced }).every(Boolean);
  }, 8000).catch(() => false);
  await check('Web_resume_replays_media_and_resumes_author_work', resumed, report.resumeObservations.at(-1) || {});
  mediaStage = 'default-control-off';
  await send({ command: 'control', value: 'pause' }); await check('Web_control_default_off_real_player_keeps_playing', probe.control === false && !(await playerCommand('snapshot')).paused);
  mediaStage = 'explicit-control-on';
  config.media.allowControl = true; await media.configure(); await until(() => probe.capabilities?.commands.includes('pause'));
  const beforePause = await playerCommand('snapshot'); await send({ command: 'control', value: 'pause' });
  const observed = await until(async () => { const value = await playerCommand('snapshot'); return value.paused && value.remote.pause > beforePause.remote.pause; });
  await check('Web_opt_in_control_reaches_real_GSMTC_player', observed);
  mediaStage = 'fixture-play'; await playerCommand('play');
  mediaStage = 'fixture-quit'; await playerCommand('quit'); await player.done; await check('native_player_natural_exit', player.exitInfo.code === 0);
  // A daily player or an OS-retained session may remain after our fixture exits.
  // Never stop another player merely to manufacture a global no-player state.
  await sleep(1200); const remaining = await media.snapshot();
  report.noPlayerObservation = { sessionPresent: Boolean(remaining.track), stillOwnFixture: remaining.track?.title.startsWith(`CWB-M3-${nonce}-A-`) === true };
  Object.assign(config.media, { captureAudio: false, nowPlaying: false, allowControl: false, onlineLyrics: false });
  await media.configure(); await until(() => probe.empty && probe.state === 0 && probe.duration === 0);
  await check('media_opt_out_clears_Web_metadata_timeline_controls', !probe.capabilities.enabled, { dailyPlayersUntouched: true, globalNoPlayerAcceptance: false });
  }
  if (sampleSeconds > 120 && !webOnly) {
    await media.close();
    await check('system_capture_stopped_before_background_soak', !provider.status().running && provider.status().forcedStops === 0);
    await sampleResources();
  }
  await send({ op: 'release' }); await until(() => probe.phase === 'released'); await check('Web_release_observed', true);
  report.lastProbeAgeMs = Date.now() - lastProbe;
} catch (error) { report.failure = /^[a-zA-Z0-9_ -]{1,100}$/.test(error.message) ? error.message : 'background_stage_failed'; await check('background_stage', false, { reason: report.failure }); }
finally {
  if (fixture) { await writeFile(path.join(root, 'background-stop'), 'stop'); const done = await Promise.race([fixture.done, sleep(5000).then(() => null)]); await check('offscreen_fixture_natural_exit', done?.code === 0, { forced: !done }); if (!done) { fixture.kill(); await fixture.done; } }
  if (player && !player.exitInfo) { await playerCommand('quit').catch(() => {}); const done = await Promise.race([player.done, sleep(5000).then(() => null)]); await check('native_player_natural_exit', done?.code === 0, { forced: !done }); if (!done) { player.kill(); await player.done; } }
  if (media) { await media.close(); await check(webOnly ? 'native_capture_not_started' : 'native_helper_natural_exit', provider.status().running === false && provider.status().forcedStops === 0, provider.status()); }
  if (wallpaper) await wallpaper.close(); if (parent) { parent.closeAllConnections(); await new Promise(resolve => parent.close(resolve)); }
  const after = await hashes(); await check('source_bytes_preserved', JSON.stringify(before) === JSON.stringify(after));
  try { report.scratchCleanup = await cleanupTestScratch(scratch); await check('generated_test_artifacts_removed', report.scratchCleanup.removed, { bytes: report.scratchCleanup.bytes }); }
  catch { await check('generated_test_artifacts_removed', false, { reason: 'scratch_cleanup_failed_kept_for_identity_check' }); }
  report.passed = report.checks.filter(row => row.ok).length; report.failed = report.checks.filter(row => !row.ok).length;
  await save(); console.log(JSON.stringify({ root: evidenceRoot, passed: report.passed, failed: report.failed, foregroundRequested: false, scratchRemoved: report.scratchCleanup?.removed === true })); process.exitCode = report.failed ? 1 : 0;
}
