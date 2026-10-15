/* Independent real hosts, exact compiled daily CLI/provider/M1 code. No chat
 * text, author code, authentication URLs or normal configuration is collected.
 */
const { app, BrowserWindow, session, nativeImage, ipcMain, utilityProcess } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), sync = require('node:fs');
const path = require('node:path'), { pathToFileURL } = require('node:url');
const execFile = require('node:util').promisify(require('node:child_process').execFile);
const workspace = path.resolve(__dirname, '..'), root = path.resolve(process.argv[2] || ''), library = path.resolve(process.argv[3] || '');
const switchOnly = process.argv.slice(4).includes('--switch-only');
const testPolicy = require('./m2-test-policy.cjs');
const inside = (base, file) => { const relative = path.relative(base, file); return relative && relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative); };
const allowed = sync.realpathSync(path.join(workspace, 'out', 'live-acceptance'));
assert.ok(inside(sync.realpathSync(workspace), allowed) && inside(allowed, sync.realpathSync(root)));
for (const directory of [root, path.join(root, 'probe-profile')]) {
  if (sync.existsSync(directory)) assert.ok(sync.lstatSync(directory).isDirectory() && !sync.lstatSync(directory).isSymbolicLink());
}
app.setPath('userData', path.join(root, 'probe-profile')); app.on('window-all-closed', () => {});
const report = { startedAt: new Date().toISOString(), artifact: 'compiled-daily-cli-native-provider-M1-production-path',
  scope: switchOnly ? 'frozen-vp8-switch-regression-only' : 'frozen-vp8-bounded-production-regression',
  sceneRenderer: 'vp8', defaultGpuPathVerified: false, switchOnly, notRun: [],
  productionSwitchIntegrated: true, completeM0Gate: false, nativeTrayExitVerified: false,
  dailyConfigurationTouched: false, officialCspModified: false, audibleOutputVerified: false, steps: [], samples: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let connection, child, ended = false, host, guard, bridgeUrl, configPath;
let compiledRoot, compiledProof, verifyCompiledSnapshot;
let substage = 'startup';
function errorCategory(error) {
  if (/^[a-z_]{1,64}$/.test(error?.message)) return error.message;
  if (error?.message === '无法核验 CDP 端口所有者：查询超时或被终止') return 'identity_query_timeout';
  if (error?.message?.startsWith('无法核验 CDP 端口所有者')) return 'identity_query_failed';
  if (error?.code === 'ERR_ASSERTION') return 'assertion_failed';
  return 'transport_failed';
}
const owners = [], raw = new Map(), encodedTimings = new Map();
const ownedWindows = new Map();
const nativeSources = () => [...ownedWindows.values()].flatMap((tracked) => tracked.sources());
let failNextCandidate = null;
const importFile = (file) => import(pathToFileURL(path.join(workspace, file)).href);
const importCompiled = (file) => import(pathToFileURL(path.join(compiledRoot, file)).href);
const progress = () => fs.writeFile(path.join(root, 'scene-progress.json'), JSON.stringify(report, null, 2));
async function until(fn, timeout = 45000) {
  const end = Date.now() + timeout; do { const result = await fn(); if (result) return result; await delay(50); } while (Date.now() < end);
  throw Error('production_wait_timeout');
}
async function focusOwned() {
  let stdout;
  try { ({ stdout } = await execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(workspace, 'scripts', 'restore-m2-owned-window.ps1'), '-TargetFile', path.join(root, 'target.json')],
      { windowsHide: true, timeout: 15000, maxBuffer: 16384, encoding: 'utf8' })); }
  catch (error) {
    try { const fixed = JSON.parse(error.stdout); report.windowRestoreFailure = { stage: /^[a-z-]{1,40}$/.test(fixed.stage) ? fixed.stage : 'unknown', exitCode: Number.isInteger(error.code) ? error.code : null }; } catch {}
    throw Error('owned_window_restore_failed');
  }
  const evidence = JSON.parse(stdout.replace(/^\uFEFF/, ''));
  assert.equal(evidence.identityVerified, true); assert.equal(evidence.restored, true);
  report.ownedWindowRefreshes = (report.ownedWindowRefreshes || 0) + 1;
}
async function step(name, task) {
  if (switchOnly && !['compiled daily CLI inject / identity / first native decoded frame / official CSP',
    'Scene / dark Scene / Web share actual production M1 prepare-commit-transition-release',
    'restore removes native DOM / decoder transport / source and codec; utility natural exit'].includes(name)) {
    report.notRun.push(name); return;
  }
  report.currentStep = name; await progress(); const started = Date.now();
  try { substage = 'identity_guard'; await guard();
    substage = 'owned_window_restore'; await focusOwned();
    await until(async () => await connection.evaluate('document.hidden===false'), 5000);
    substage = 'task'; await task(); report.steps.push({ name, status: 'pass', elapsedMs: Date.now() - started }); }
  catch (error) {
    report.steps.push({ name, status: 'fail', elapsedMs: Date.now() - started, substage, category: errorCategory(error) });
    report.failureKind = ['Error', 'AssertionError', 'TimeoutError', 'AbortError', 'SyntaxError', 'TypeError', 'InvalidStateError'].includes(error?.name) ? error.name : 'Unknown';
    try { report.failureHostState = await state(); } catch { report.failureHostStateUnavailable = true; }
    try { report.decodeFailures = await connection.evaluate('globalThis.__cwbM2DecodeProbe?.failures||[]'); } catch {}
    report.failedNativeOwners = owners.map((owner) => { const s = owner.status(); return { closed: s.closed, paused: s.paused,
      phase: s.phase, reason: /^[a-z_]{1,64}$/.test(s.reason) ? s.reason : null, resourcesClosed: s.resourcesClosed, capturedFrames: s.capturedFrames }; });
    throw error;
  }
  finally { await progress(); }
}
async function api(route, body = null) {
  const response = await fetch(new URL('api/' + route, bridgeUrl), { method: body === null ? 'GET' : 'POST',
    headers: body === null ? {} : { 'Content-Type': 'application/json', Origin: new URL(bridgeUrl).origin },
    ...(body === null ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  // MediaServer deliberately returns fixed plain text for unhandled failures.
  // Classify HTTP status before JSON parsing; never collect the error body.
  if (!response.ok) {
    report.failedApi = { route: route.split('/')[0], action: body?.action || null, status: response.status, ok: false };
    throw Error('production_api_failed');
  }
  const value = await response.json();
  if (value.ok === false) {
    report.failedApi = { route: route.split('/')[0], action: body?.action || null, status: response.status, ok: value.ok === true };
    throw Error('production_api_failed');
  }
  return value;
}
const stateExpression = `(()=>{const node=document.getElementById('codex-wallpaper-bridge-media'),runtime=globalThis.__codexWallpaperBridgeRuntime;
  const candidates=[...document.querySelectorAll('#codex-wallpaper-bridge-root [data-cwb-native]')];
  let identity=null;try{const id=JSON.parse(runtime?.status().switch.identity||'null')?.[0];if(/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id))identity=id}catch{}
  return {ready:runtime?.ready===true,native:!!node?.dataset.cwbNative,sequence:Number(node?.dataset.cwbSequence||0),
  nativeDomCount:candidates.length,nativeDomSequences:candidates.map(n=>Number(n.dataset.cwbSequence||0)),switchState:runtime?.status().switch.state||null,
  slots:runtime?.status().switch.slots||0,hidden:document.hidden,tag:node?.tagName||null,videoTime:node?.tagName==='VIDEO'?node.currentTime:null,
  identity}})()`;
async function state() { return connection.evaluate(stateExpression); }
async function showcase() {
  assert.equal(await connection.evaluate(`(()=>{const root=document.getElementById('codex-wallpaper-bridge-root');if(!root)return false;
    for(const [key,value]of Object.entries({left:'0px',top:'0px',right:'auto',bottom:'auto',width:'800px',height:'450px',zIndex:'2147483647'}))root.style[key]=value;
    const scrim=document.getElementById('codex-wallpaper-bridge-scrim');if(scrim)scrim.style.display='none';return true})()`), true);
}
function pixels(png) { const image = nativeImage.createFromBuffer(png); assert.ok(!image.isEmpty()); return image.resize({ width: 800, height: 450, quality: 'good' }).toBitmap(); }
function difference(a, b) {
  assert.equal(a.length, 1440000); assert.equal(b.length, a.length); let changed = 0, error = 0;
  for (let i = 0; i < a.length; i += 4) { const n = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]); if (n > 12) changed++; error += n; }
  return { changedRatio: changed / 360000, meanRgbError: error / 1080000 };
}
async function capture(name) {
  substage = 'capture_owned_window_restore'; await focusOwned();
  substage = 'capture_visibility';
  assert.equal(await connection.evaluate('document.hidden'), false, 'production_host_became_hidden');
  substage = 'capture_clip';
  const clip = await connection.evaluate(`(()=>{const r=document.getElementById('codex-wallpaper-bridge-root')?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,scale:1}:null})()`);
  report.lastCapture = { name, clip }; await progress();
  assert.ok(clip && clip.x === 0 && clip.y === 0 && clip.width === 800 && clip.height === 450, 'capture_clip_mismatch');
  substage = 'capture_screenshot';
  const screenshot = await connection.call('Page.captureScreenshot', { format: 'png', clip, fromSurface: true, captureBeyondViewport: false });
  substage = 'capture_save';
  const bytes = Buffer.from(screenshot.data, 'base64'); await fs.writeFile(path.join(root, name + '.png'), bytes, { flag: 'wx' }); return pixels(bytes);
}
async function settle(id) {
  await until(async () => { const s = await state(); return s.native && s.sequence > 0 && s.identity === id && s.slots === 1; });
  await until(() => host.status().slots === 1);
  await showcase();
}
async function select(id) {
  testPolicy.assertM2TestProject(id);
  await api('config', { selectedId: id }); await settle(id);
}
async function canvasDigest() {
  return connection.evaluate(`(()=>{const canvas=document.getElementById('codex-wallpaper-bridge-media')?.querySelector('canvas');if(!canvas)return null;
    const bytes=canvas.getContext('2d').getImageData(0,0,800,450).data;let hash=2166136261;for(const byte of bytes)hash=Math.imul(hash^byte,16777619);return hash>>>0})()`);
}
async function cleanup() {
  if (bridgeUrl && !ended) { try { await api('action', { action: 'restore' }); } catch {} }
  if (child && !ended) {
    child.postMessage({ channel: 'cwb-utility', action: 'shutdown' });
    await until(() => ended, 25000).catch(() => {});
  }
  if (host) await host.close(); connection?.close();
  report.resourcesClosed = owners.every((owner) => owner.status().resourcesClosed === true);
  report.remainingWindows = BrowserWindow.getAllWindows().length;
  report.utilityNaturallyExited = ended;
  report.host = host?.status();
}
async function main() {
  await app.whenReady();
  substage = 'freeze_compiled_build';
  const snapshotApi = await importFile('scripts/m2-compiled-snapshot.mjs');
  verifyCompiledSnapshot = snapshotApi.verifyCompiledSnapshot;
  compiledRoot = path.join(root, 'compiled-snapshot');
  compiledProof = await snapshotApi.freezeCompiledBuild({ workspace, root, snapshot: compiledRoot,
    dist: process.env.CWB_COMPILED_BUILD_SOURCE || path.join(workspace, 'dist') });
  report.compiledSnapshot = { sha256: compiledProof.sha256, files: compiledProof.files, totalBytes: compiledProof.totalBytes };
  await fs.writeFile(path.join(root, 'compiled-proof.json'), JSON.stringify(compiledProof, null, 2), { flag: 'wx' });
  const target = JSON.parse((await fs.readFile(path.join(root, 'target.json'), 'utf8')).replace(/^\uFEFF/, ''));
  assert.ok(inside(sync.realpathSync(root), sync.realpathSync(target.profile)));
  const { verifyCdpEndpointOwner } = await importFile('src/cdp-owner.mjs');
  guard = async () => { await verifyCdpEndpointOwner({ installation: { path: target.exe }, port: target.port,
    expectedProcess: { pid: target.pid, creation: target.creation, profile: target.profile } }); return { verified: true }; };
  substage = 'startup_identity_guard';
  await guard();
  const { CdpConnection, isVerifierRendererTarget } = await importFile('scripts/verify-live-host.mjs');
  substage = 'startup_target_list';
  const targets = (await (await fetch(`http://127.0.0.1:${target.port}/json/list`)).json()).filter(isVerifierRendererTarget);
  substage = 'startup_connect_visible_target';
  report.initialTargetStates = [];
  for (const item of targets) {
    const candidate = new CdpConnection(item.webSocketDebuggerUrl, target.port); await candidate.connect();
    const initial = await candidate.evaluate('({visible:!document.hidden,ready:document.readyState==="complete"})');
    report.initialTargetStates.push({ index: report.initialTargetStates.length, visible: initial.visible === true, ready: initial.ready === true });
    if (!connection && initial.visible) connection = candidate; else candidate.close();
  }
  assert.ok(connection); await connection.call('Page.enable');
  report.initialTargetCount = targets.length;
  report.documentEvents = { navigated: 0, contextsCleared: 0, loaded: 0 };
  connection.socket.on('message', (bytes) => {
    let event; try { event = JSON.parse(bytes.toString()); } catch { return; }
    const key = { 'Page.frameNavigated': 'navigated', 'Runtime.executionContextsCleared': 'contextsCleared', 'Page.loadEventFired': 'loaded' }[event.method];
    if (key) report.documentEvents[key]++;
  });
  await connection.call('Runtime.enable');
  substage = 'startup_owned_window_evidence';
  const windowEvidence = JSON.parse((await fs.readFile(path.join(root, 'window-control.json'), 'utf8')).replace(/^\uFEFF/, ''));
  assert.equal(windowEvidence.pid, target.pid); assert.equal(windowEvidence.identityVerified, true); assert.equal(windowEvidence.restored, true);
  report.ownedWindow = { identityVerified: true, restored: true, topmostRequested: windowEvidence.topmostRequested === true, foregroundRequested: windowEvidence.foregroundRequested === true };
  substage = 'startup_window_foreground';
  report.isolatedHostForegroundRequested = windowEvidence.foregroundRequested === true;
  const version = await connection.call('Browser.getVersion'); report.chromium = version.product; report.electron = process.versions.electron;
  substage = 'startup_readonly_scan';
  const { scanWallpaperProjects } = await importFile('bridge-runtime/src/scanner.mjs');
  const inventory = await scanWallpaperProjects({ explicitRoots: [library], steamRoots: [library] });
  inventory.projects = inventory.projects.filter(testPolicy.isM2TestProjectAllowed);
  report.excludedTestSampleIds = [...testPolicy.EXCLUDED_M2_TEST_IDS];
  const sampleIds = ['1778944028', '3444535389', '3553574985'];
  const scene = sampleIds.map((id) => inventory.projects.find((p) => p.id === id && p.type === 'scene')).filter(Boolean);
  assert.ok(scene.length >= 2);
  // The user excluded the previously dynamic Web. An allowed real sample is
  // used instead; keep the original dynamic assertions and disclose any gap.
  const web = inventory.projects.find((p) => p.id === '895116177' && p.type === 'web' && p.playable);
  assert.ok(web, 'production_dynamic_web_unavailable');
  const audio = inventory.projects.find((p) => p.id === '3233141951' && p.type === 'scene');
  assert.ok(audio, 'production_audio_sample_unavailable');
  const env = { ...process.env, LOCALAPPDATA: path.join(root, 'bridge-state'), CWB_NATIVE_ENGINE_PROVIDER: 'owned-parent-v1',
    // This verifier measures the explicit VP8 compatibility route, not the
    // newer default GPU route. Never let inherited environment change the claim.
    CWB_SCENE_RENDERER: 'vp8',
    CWB_BRIDGE_CLI: path.join(compiledRoot, 'bridge-runtime', 'src', 'cli.mjs') };
  const stateRoot = path.join(env.LOCALAPPDATA, 'CodexWallpaperBridge'); configPath = path.join(stateRoot, 'config.json');
  await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(configPath, JSON.stringify({ schemaVersion: 4, selectedId: scene[0].id,
    effects: { brightness: 100, saturation: 100, contrast: 100, dim: 0, blur: 0, fit: 'fill', opacity: 100,
      audioEnabled: false, pauseWhenHidden: true, transition: 'fade', transitionDurationMs: 200, playing: true } }), { flag: 'wx' });
  const { createDesktopEngineHost } = await importCompiled('bridge-runtime/src/desktop-engine-host.mjs');
  const { EngineRendererOwner } = await importCompiled('bridge-runtime/src/engine-renderer-owner.mjs');
  const { trackNativeOwnerWindows } = await importFile('scripts/m2-owned-source-windows.mjs');
  substage = 'startup_native_host';
  host = createDesktopEngineHost({ electron: { BrowserWindow, session, nativeImage, ipcMain }, env,
    scan: async () => inventory, verifyEndpoint: async (port) => { assert.equal(port, target.port); return guard(); },
    createOwner(snapshot, { failures }) {
      const tracked = trackNativeOwnerWindows(BrowserWindow);
      const owner = new EngineRendererOwner({ electron: { BrowserWindow: tracked.BrowserWindow, session, nativeImage, ipcMain }, ...snapshot, failures });
      owners.push(owner); ownedWindows.set(owner, tracked);
      if (failNextCandidate === snapshot.project.id) {
        failNextCandidate = null;
        void owner.ready.then(() => {
          const source = tracked.sources()[0];
          if (source) source.destroy();
        }).catch(() => {});
      }
      const captureRaw = owner.captureRaw.bind(owner), captureEncoded = owner.captureEncoded.bind(owner);
      owner.captureRaw = async () => { const frame = await captureRaw(); raw.set(snapshot.project.id + ':' + frame.sequence, frame.nativeImage); if (raw.size > 16) raw.delete(raw.keys().next().value); return frame; };
      owner.captureEncoded = async () => {
        const started = performance.now(); report.lastNativeCapture = { id: snapshot.project.id, pending: true };
        try {
          const frame = await captureEncoded(); encodedTimings.set(snapshot.project.id + ':' + frame.sequence, started);
          report.lastNativeCapture = { id: snapshot.project.id, pending: false, elapsedMs: performance.now() - started, sequence: frame.sequence };
          if (encodedTimings.size > 128) encodedTimings.delete(encodedTimings.keys().next().value); return frame;
        } catch (error) { report.lastNativeCapture = { id: snapshot.project.id, pending: false, failed: true, elapsedMs: performance.now() - started }; throw error; }
      };
      return owner;
    },
  });
  child = utilityProcess.fork(path.join(compiledRoot, 'bridge-utility-entry.mjs'), ['preview', '--no-open', '--cdp-port', String(target.port), '--steam-root', library],
    { cwd: workspace, env, stdio: 'pipe', serviceName: 'CWB M2 production acceptance' });
  child.once('exit', () => { ended = true; }); host.attach(child);
  const log = sync.createWriteStream(path.join(root, 'utility.stdout.log'), { flags: 'wx' }); child.stdout?.pipe(log); child.stderr?.pipe(log);
  substage = 'startup_wait_compiled_cli';
  await until(async () => { try { const runtime = JSON.parse(await fs.readFile(path.join(stateRoot, 'runtime.json'), 'utf8')); bridgeUrl = runtime.bridgeUrl; return bridgeUrl; } catch { return false; } });
  report.sampleIds = [...scene.map((p) => p.id), web.id];
  await connection.evaluate(`(()=>{
    const failures=[];const save=node=>{const d=node?.dataset;if(!['configure','decode','flush','output','copy','draw'].includes(d?.cwbFailureStage))return;
      const kind=['TypeError','ReferenceError','NotSupportedError','InvalidStateError','DataError','SecurityError','AbortError','Timeout','Unknown'].includes(d.cwbFailureKind)?d.cwbFailureKind:'Unknown';
      if(failures.length<8&&!failures.some(x=>x.stage===d.cwbFailureStage&&x.kind===kind))failures.push({stage:d.cwbFailureStage,kind});};
    const observer=new MutationObserver(records=>{for(const r of records){save(r.target);for(const n of r.removedNodes||[]){save(n);for(const c of n.querySelectorAll?.('[data-cwb-native]')||[])save(c);}}});
    observer.observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['data-cwb-failure-stage','data-cwb-failure-kind'],childList:true});
    globalThis.__cwbM2DecodeProbe={failures,observer};return true})()`);
  await step('compiled daily CLI inject / identity / first native decoded frame / official CSP', async () => {
    substage = 'inject_action'; let injectEnded = false; const startedInject = Date.now();
    const injecting = api('action', { action: 'inject' }).finally(() => { injectEnded = true; }); injecting.catch(() => {});
    report.injectObservations = [];
    while (!injectEnded && report.injectObservations.length < 24) {
      const observed = await state();
      report.injectObservations.push({ elapsedMs: Date.now() - startedInject, host: observed, capture: report.lastNativeCapture ? { ...report.lastNativeCapture } : null });
      if (observed.hidden) {
        substage = 'inject_owned_visibility_restore'; await focusOwned(); substage = 'inject_action';
        report.injectVisibilityRestores = (report.injectVisibilityRestores || 0) + 1;
      }
      await delay(500);
    }
    await injecting; substage = 'inject_decoded_state';
    const s = await until(async () => { const v = await state(); return v.native && v.sequence > 0 ? v : false; });
    assert.ok(s.ready && !s.hidden); assert.equal(s.slots, 1); await showcase();
    const nativeApis = await connection.evaluate(`(()=>{const r=globalThis.__codexWallpaperBridgeRuntime;return ['accept','capture','transport','nativeController'].some(k=>k in r)})()`);
    assert.equal(nativeApis, false); assert.ok(owners.length >= 1);
  });
  await step('continuous actual host compositor / native-source provenance / fixed performance gate', async () => {
    const timings = [], first = await state(), firstKey = scene[0].id + ':' + first.sequence;
    assert.ok(encodedTimings.has(firstKey)); timings.push(performance.now() - encodedTimings.get(firstKey));
    const start = performance.now(); let sequence = first.sequence, frames = 1, a, b;
    do {
      const s = await state();
      if (s.sequence !== sequence) { sequence = s.sequence; frames++; const since = encodedTimings.get(scene[0].id + ':' + sequence); if (since) timings.push(performance.now() - since); }
      if (!a) a = await capture('production-frame-a');
      if (!b && performance.now() - start > 2400) b = await capture('production-frame-b');
      await delay(20);
    } while (performance.now() - start < 6500);
    const c = await capture('production-frame-c'), elapsed = performance.now() - start;
    const ratios = [difference(a, b).changedRatio, difference(b, c).changedRatio]; assert.ok(ratios.every((value) => value > .01));
    const diagnostics = await api('action', { action: 'engine-status' }), samples = diagnostics.engine.find((entry) => entry.id === scene[0].id)?.samples;
    assert.ok(samples?.length >= 6); const totalMs = samples.map((sample) => sample.totalMs).sort((a, b) => a - b);
    const nativeElapsed = samples.at(-1).endedAt - samples[0].startedAt;
    const acknowledgedFrames = samples.filter((sample) => sample.acknowledged > 0).length;
    const fps = acknowledgedFrames * 1000 / nativeElapsed, p95 = totalMs[Math.floor((totalMs.length - 1) * .95)];
    report.stream = { frames, elapsedMs: elapsed, observedCompositorFps: (frames - 1) * 1000 / elapsed,
      fps, p95Ms: p95, nativeElapsedMs: nativeElapsed, samples: samples.length, acknowledgedFrames, dataPlaneSamples: samples,
      compositorChangedRatios: ratios, firstIncluded: true, savedScreenshotsIncluded: true };
    await api('config', { effects: { playing: false } }); await until(() => owners.filter((o) => !o.status().closed).every((o) => o.status().paused));
    const paused = await state(), sourceImage = raw.get(scene[0].id + ':' + paused.sequence); assert.ok(sourceImage); const source = sourceImage.toPNG();
    await fs.writeFile(path.join(root, 'production-source.png'), source, { flag: 'wx' });
    const hostPixels = await capture('production-paused'); report.stream.sourceRgb = difference(pixels(source), hostPixels); assert.ok(report.stream.sourceRgb.meanRgbError < 8);
    substage = 'native_performance_gate'; assert.ok(fps >= 4 && p95 < 750 && elapsed >= 6000, 'native_performance_gate_failed');
  });
  await step('native user pause / host frozen pixels / resume', async () => {
    const a = await capture('pause-before'); await delay(800); const b = await capture('pause-after'); substage = 'pause_pixels'; assert.equal(difference(a, b).changedRatio, 0, 'pause_pixels_changed');
    substage = 'resume_config'; await api('config', { effects: { playing: true } }); await delay(800); const c = await capture('resume'); substage = 'resume_pixels'; assert.ok(difference(b, c).changedRatio > .01, 'resume_pixels_unchanged');
  });
  await step('authorized short native audio output through production effects; no system audio capture', async () => {
    await select(audio.id);
    const sources = nativeSources;
    report.audioWindowIdentity = { constructorOwnedSources: sources().length,
      runtimePreferenceSources: BrowserWindow.getAllWindows().filter((win) => !win.webContents.getLastWebPreferences().preload).length,
      mutedSources: sources().filter((win) => win.webContents.isAudioMuted()).length };
    substage = 'audio_source_identity';
    assert.equal(sources().length, 1); assert.equal(sources()[0].webContents.isAudioMuted(), true);
    const started = Date.now(); report.audio = { sampleId: audio.id, volumePercent: 15, mutedBefore: true,
      outputActivity: false, humanConfirmed: false, systemVolumeTouched: false, systemAudioCaptured: false };
    try {
      await api('config', { effects: { audioEnabled: true, volume: 15, playing: true } });
      substage = 'audio_output_activity';
      await until(() => sources().some((win) => !win.webContents.isAudioMuted() && win.webContents.isCurrentlyAudible()), 15000);
      report.audio.outputActivity = true; report.audio.outputStartedAt = new Date().toISOString();
      await delay(5000);
    } finally { await api('config', { effects: { audioEnabled: false, volume: 0 } }); }
    await until(() => sources().every((win) => win.webContents.isAudioMuted()), 5000);
    report.audio.mutedAfter = true; report.audio.elapsedMs = Date.now() - started;
    await select(scene[0].id);
  });
  await step('typed bool and slider changes persist and match actual native property readback; reset restores defaults', async () => {
    await select(audio.id); const route = 'author-properties/' + encodeURIComponent(audio.id);
    let property = await api(route); const types = [];
    for (const type of ['bool', 'slider']) {
      const entry = Object.entries(property.schema).find(([, spec]) => spec.type === type && (type !== 'slider' || spec.min < spec.max));
      assert.ok(entry, 'production_typed_property_sample_missing');
      const [key, spec] = entry, value = type === 'bool' ? !property.values[key] : property.values[key] === spec.min ? spec.max : spec.min;
      const next = await api(route, { values: { [key]: value }, revision: property.revision });
      assert.equal(next.live.phase, 'ready'); assert.equal(next.live.method, 'engine-readback'); assert.equal(next.live.values[key], value);
      const disk = JSON.parse(await fs.readFile(configPath, 'utf8')); assert.equal(disk.authorProperties[audio.id][key], value);
      const read = await api(route); assert.equal(read.values[key], value); assert.equal(read.live.values[key], value);
      property = await api(route, { reset: true, revision: read.revision });
      assert.deepEqual(property.values, property.defaults); assert.equal(property.live.values[key], property.defaults[key]);
      assert.equal(Object.hasOwn(JSON.parse(await fs.readFile(configPath, 'utf8')).authorProperties, audio.id), false);
      types.push({ type, saved: true, nativeReadbackMatches: true, reset: true });
    }
    report.authorProperties = { sampleId: audio.id, types, fields: Object.keys(property.schema).length, method: property.live.method };
    await select(scene[0].id);
  });
  await step('Scene / dark Scene / Web share actual production M1 prepare-commit-transition-release', async () => {
    for (let round = 0; round < 2; round++) for (const project of [...scene.slice(0, 2), web]) {
      await select(project.id); const s = await state(); assert.equal(s.slots, 1); assert.equal(host.status().slots, 1);
      report.samples.push({ id: project.id, type: project.type, sequence: s.sequence, round });
    }
    assert.ok(owners.slice(0, -1).every((o) => o.status().resourcesClosed));
  });
  await step('production Web native inspector pause / resume', async () => {
    await api('config', { effects: { playing: false } }); await until(() => owners.filter((o) => !o.status().closed).every((o) => o.status().paused));
    const a = await capture('web-paused-a'); await delay(800); const b = await capture('web-paused-b'); substage = 'web_pause_pixels';
    report.webPlayback = { paused: difference(a, b) }; assert.equal(report.webPlayback.paused.changedRatio, 0, 'web_pause_pixels_changed');
    substage = 'web_resume_config'; await api('config', { effects: { playing: true } }); await delay(800); const c = await capture('web-resumed'); substage = 'web_resume_pixels';
    report.webPlayback.resumed = difference(b, c); assert.ok(report.webPlayback.resumed.changedRatio > .01, 'web_resume_pixels_unchanged');
  });
  await step('production reload reclaims private CDP receiver and native ownership', async () => {
    await connection.call('Page.reload', { ignoreCache: false }); await until(async () => { const s = await state(); return s.ready && s.native && s.sequence > 0 && s.slots === 1; });
    await showcase(); assert.equal(host.status().slots, 1); const image = await capture('reloaded'); assert.ok(image.some((n, i) => i % 4 !== 3 && n > 30));
  });
  await step('actual failed native candidate preserves old compositor and requires explicit retry', async () => {
    await select(scene[0].id); await api('config', { effects: { playing: false } });
    await until(() => owners.filter((o) => !o.status().closed).every((o) => o.status().paused));
    const before = await capture('candidate-before'), digest = await canvasDigest(), count = owners.length;
    assert.ok(scene[2]); failNextCandidate = scene[2].id;
    await assert.rejects(api('config', { selectedId: scene[2].id }), /production_api_failed/);
    const failed = await capture('candidate-failed'); assert.equal(difference(before, failed).changedRatio, 0, 'candidate_replaced_old_pixels');
    assert.equal(await canvasDigest(), digest); assert.equal((await state()).slots, 1);
    await assert.rejects(api('action', { action: 'inject' }), /production_api_failed/);
    assert.equal(owners.length, count + 1, 'candidate_auto_retried');
    substage = 'candidate_explicit_retry';
    await api('action', { action: 'retry-engine', projectId: scene[2].id }); await settle(scene[2].id);
    assert.equal(owners.length, count + 2); assert.equal((await state()).slots, 1);
    assert.equal(host.status().slots, 1); await api('config', { effects: { playing: true } });
    report.failedCandidate = { oldCompositorUnchanged: true, noAutomaticRetry: true, explicitRetryCommitted: true };
  });
  await step('paused native source destruction keeps last real pixels and explicit same-identity retry', async () => {
    await select(scene[0].id); await api('config', { effects: { playing: false } });
    await until(() => owners.filter((o) => !o.status().closed).every((o) => o.status().paused));
    const digest = await canvasDigest(), count = owners.length;
    const sources = nativeSources();
    assert.equal(sources.length, 1); sources[0].destroy();
    await until(async () => (await api('action', { action: 'engine-status' })).engine.some((entry) => entry.id === scene[0].id && entry.failed));
    assert.equal(await canvasDigest(), digest, 'source_failure_changed_last_real_pixels');
    const label = await connection.evaluate(`(()=>{const label=document.getElementById('codex-wallpaper-bridge-media')?.lastElementChild;return label?.hidden===false})()`);
    assert.equal(label, true); const before = await capture('source-failed-label'); await delay(800); const after = await capture('source-failed-frozen');
    assert.equal(difference(before, after).changedRatio, 0);
    await api('config', { effects: { playing: true } }); assert.equal(owners.length, count, 'active_source_auto_retried');
    substage = 'source_explicit_retry';
    await api('action', { action: 'retry-engine', projectId: scene[0].id }); await settle(scene[0].id);
    assert.equal(owners.length, count + 1); assert.equal((await state()).slots, 1); assert.equal(host.status().slots, 1);
    await delay(800); const resumed = await capture('source-explicit-retry'); assert.ok(difference(after, resumed).changedRatio > .01);
    report.sourceFailure = { lastRealCanvasUnchanged: true, visibleOwnedLabel: true, frozenCompositor: true, explicitSameIdentityRetry: true };
  });
  await step('short soak includes live encoded stream and repeated M1 switches; resource count bounded', async () => {
    const start = Date.now(); report.soak = { durationMs: 0, metrics: [] };
    for (let round = 0; round < 4; round++) {
      await delay(15000); await select(round % 2 ? web.id : scene[1].id);
      report.soak.metrics.push({ elapsedMs: Date.now() - start, owners: host.status().slots,
        nativeWindows: BrowserWindow.getAllWindows().length,
        processMetrics: app.getAppMetrics().map((m) => ({ pid: m.pid, type: m.type, memory: m.memory, cpu: m.cpu.percentCPUUsage })) });
      assert.ok(host.status().slots <= 2 && BrowserWindow.getAllWindows().length <= 4);
    }
    report.soak.durationMs = Date.now() - start;
  });
  await step('restore removes native DOM / decoder transport / source and codec; utility natural exit', async () => {
    await api('action', { action: 'restore' }); assert.equal((await state()).ready, false);
    await until(() => host.status().slots === 0); assert.ok(owners.every((o) => o.status().resourcesClosed));
    child.postMessage({ channel: 'cwb-utility', action: 'shutdown' }); await until(() => ended, 25000);
    await host.close(); assert.deepEqual(host.status(), { closed: true, slots: 0, peers: 0 });
  });
  report.outcome = 'pass';
}
main().catch((error) => { report.outcome = 'fail'; report.failureCategory = errorCategory(error); report.failureSubstage = substage; }).finally(async () => {
  try { await cleanup(); } catch { report.cleanupFailed = true; report.outcome = 'fail'; }
  if (compiledProof) {
    try { report.compiledSnapshotVerifiedAfter = await verifyCompiledSnapshot(compiledRoot, compiledProof); }
    catch { report.compiledSnapshotVerifiedAfter = false; report.outcome = 'fail'; report.failureCategory = 'compiled_snapshot_changed'; }
  }
  try {
    const lines = (await fs.readFile(path.join(root, 'utility.stdout.log'), 'utf8')).split(/\r?\n/);
    report.nativeFailureEvents = lines.filter((line) => line.startsWith('[CDP] native-frame-error：')).slice(-8)
      .map((line) => JSON.parse(line.slice('[CDP] native-frame-error：'.length)));
    report.injectionFailureEvents = lines.filter((line) => line.startsWith('[CDP] injection-failed：')).slice(-8)
      .map((line) => JSON.parse(line.slice('[CDP] injection-failed：'.length)));
  } catch {}
  if (switchOnly && report.nativeFailureEvents?.length) {
    report.outcome = 'fail'; report.failureCategory = 'switch_native_failure';
  }
  if (!report.resourcesClosed || report.remainingWindows || !report.utilityNaturallyExited) report.outcome = 'fail';
  report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'scene-report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  app.exit(report.outcome === 'pass' ? 0 : 1);
});
