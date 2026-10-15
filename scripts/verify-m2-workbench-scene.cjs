/* Real compiled CLI + workbench GPU preview; no Codex discovery or injection.
 * Only this process's windows/utility are closed. WE inputs remain readonly.
 */
const { app, BrowserWindow, utilityProcess, session, nativeImage } = require('electron');
const assert = require('node:assert/strict'), fs = require('node:fs/promises'), sync = require('node:fs');
const path = require('node:path'), { randomBytes } = require('node:crypto');
const policy = require('./m2-test-policy.cjs');
const workspace = path.resolve(__dirname, '..'), library = path.resolve(process.argv[2] || '');
const steamRoot = path.resolve(library, '..', '..', '..', '..');
assert.equal(path.join(steamRoot, 'steamapps', 'workshop', 'content', '431960').toLowerCase(), library.toLowerCase());
const parent = sync.realpathSync(path.join(workspace, 'out', 'm2-20261012-preview-hd-01'));
assert.ok(parent.toLowerCase().startsWith(sync.realpathSync(workspace).toLowerCase() + path.sep));
assert.ok(!sync.lstatSync(parent).isSymbolicLink());
const root = path.join(parent, 'workbench-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex'));
sync.mkdirSync(root); sync.mkdirSync(path.join(root, 'profile'));
app.setPath('userData', path.join(root, 'profile')); app.on('window-all-closed', () => {});
const report = { scope: 'compiled-daily-cli-workbench-gpu-preview-only', startedAt: new Date().toISOString(),
  productionCodexHostsVerified: false, physicalScreenFpsVerified: false, completeM0Gate: false,
  dailyConfigurationTouched: false, forbiddenSampleSelected: false, excludedTestSampleIds: [...policy.EXCLUDED_M2_TEST_IDS], steps: [] };
const startup = (name) => { report.currentStep = name; sync.writeFileSync(path.join(root, 'progress.json'), JSON.stringify(report, null, 2)); };
let win, child, ended = false, bridgeUrl, frameContext, contexts = [], childExit;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, ms = 15000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('workbench_operation_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
const evaluate = (expression) => bounded(win.webContents.executeJavaScript(expression));
async function until(fn, ms = 90000) {
  const end = Date.now() + ms; do { const result = await fn(); if (result) return result; await delay(60); } while (Date.now() < end);
  throw Error('workbench_wait_timeout');
}
async function api(route, body) {
  const response = await bounded(fetch(new URL('api/' + route, bridgeUrl), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}));
  assert.equal(response.status, 200); return bounded(response.json());
}
async function inScene(expression) {
  const result = await bounded(win.webContents.debugger.sendCommand('Runtime.evaluate', { contextId: frameContext, expression, returnByValue: true, awaitPromise: true }));
  if (result.exceptionDetails) throw Error('workbench_source_evaluate_failed'); return result.result.value;
}
async function getFrameContext() {
  const url = await evaluate('document.querySelector("#backgroundScene").src');
  const tree = await win.webContents.debugger.sendCommand('Page.getFrameTree');
  const frames = []; const visit = (node) => { frames.push(node.frame); for (const child of node.childFrames ?? []) visit(child); }; visit(tree.frameTree);
  const frame = frames.find((frame) => frame.url === url); assert.ok(frame, 'workbench_source_frame_missing');
  const context = contexts.findLast((context) => context.auxData?.isDefault && context.auxData.frameId === frame.id);
  assert.ok(context, 'workbench_source_context_missing'); frameContext = context.id;
}
async function ready(id) {
  await until(async () => await evaluate(`(()=>{const card=document.querySelector('.wallpaper-card.is-selected');const scene=document.querySelector('#backgroundScene');return card?.dataset.id===${JSON.stringify(id)}&&scene?.classList.contains('is-visible')&&scene.dataset.cwbScenePhase==='ready'&&document.querySelectorAll('#wallpaper .wallpaper__media.is-visible').length===1})()`));
  await getFrameContext();
}
async function click(selector) {
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.hidden)throw Error('workbench_not_actionable');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
}
async function beginSelect(id) {
  policy.assertM2TestProject(id); policy.assertM2TestRoot(path.join(library, id));
  await click('#searchInput'); await evaluate('document.querySelector("#searchInput").select()'); await win.webContents.insertText(id);
  await until(async () => await evaluate(`Boolean(document.querySelector('.wallpaper-card[data-id="${id}"]'))`));
  await click(`.wallpaper-card[data-id="${id}"]`);
}
async function select(id, hideDuringTransition = false) {
  await beginSelect(id);
  if (hideDuringTransition) {
    // Target the WAAPI phase after real draw telemetry, not an unrendered
    // candidate whose rAF may legitimately wait for the window to be shown.
    await until(async () => await evaluate(`(()=>{const scene=document.querySelector('#backgroundScene');return document.querySelector('.wallpaper-card.is-selected')?.dataset.id===${JSON.stringify(id)}&&scene?.dataset.cwbScenePhase==='ready'&&document.querySelectorAll('#wallpaper iframe[id*=backgroundScene]').length===2})()`));
    win.hide();
  }
  await ready(id);
  if (hideDuringTransition) {
    report.hiddenSwitch = await evaluate('({hidden:document.hidden,sceneNodes:document.querySelectorAll("#wallpaper iframe[id*=backgroundScene]").length})');
    assert.equal(report.hiddenSwitch.hidden, true); assert.equal(report.hiddenSwitch.sceneNodes, 1); win.show();
  }
  report.selectedIds ??= []; report.selectedIds.push(id);
}
async function capture(name, full = false) {
  const image = await win.webContents.capturePage(full ? undefined : { x: 495, y: 195, width: 245, height: 280 });
  const png = image.toPNG(); await fs.writeFile(path.join(root, name + '.png'), png, { flag: 'wx' });
  return nativeImage.createFromBuffer(png).toBitmap();
}
function changed(a, b) {
  assert.equal(a.length, b.length); let different = 0, total = a.length / 4;
  for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) > 8 || Math.abs(a[i + 1] - b[i + 1]) > 8 || Math.abs(a[i + 2] - b[i + 2]) > 8) different++;
  return different / total;
}
async function step(name, fn) {
  report.currentStep = name; await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
  const started = Date.now();
  try { await fn(); report.steps.push({ name, outcome: 'pass', elapsedMs: Date.now() - started }); }
  catch (error) { report.steps.push({ name, outcome: 'fail', reason: /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'assertion_failed' }); throw error; }
}
async function main() {
  for (const id of ['3025975631', '1778944028', '3444535389']) policy.assertM2TestRoot(path.join(library, id));
  const state = path.join(root, 'bridge-state'), stateRoot = path.join(state, 'CodexWallpaperBridge'); await fs.mkdir(stateRoot, { recursive: true });
  await fs.writeFile(path.join(stateRoot, 'config.json'), JSON.stringify({ schemaVersion: 4, selectedId: '3025975631',
    library: { hiddenIds: [...policy.EXCLUDED_M2_TEST_IDS] }, effects: { brightness: 100, saturation: 100, contrast: 100, darkness: 0,
      blur: 0, audioEnabled: false, playing: true, pauseWhenHidden: true, fit: 'cover', transition: 'fade', transitionDurationMs: 600 } }), { flag: 'wx' });
  startup('await_app_ready');
  await app.whenReady(); report.electron = process.versions.electron; report.chromium = process.versions.chrome;
  startup('fork_compiled_cli');
  const env = { ...process.env, LOCALAPPDATA: state, CWB_BRIDGE_CLI: path.join(workspace, 'dist', 'bridge-runtime', 'src', 'cli.mjs') };
  delete env.CWB_NATIVE_ENGINE_PROVIDER; delete env.CWB_ACCEPTANCE_ROOT;
  child = utilityProcess.fork(path.join(workspace, 'dist', 'bridge-utility-entry.mjs'), ['preview', '--no-open', '--cdp-port', '19565', '--steam-root', steamRoot],
    { cwd: workspace, env, stdio: 'pipe', serviceName: 'CWB isolated Scene preview verification' });
  child.once('exit', (code) => { ended = true; childExit = code; }); child.stdout?.on('data', () => {}); child.stderr?.on('data', () => {});
  startup('wait_compiled_cli_runtime');
  await until(async () => { try { bridgeUrl = JSON.parse(await fs.readFile(path.join(stateRoot, 'runtime.json'), 'utf8')).bridgeUrl; return Boolean(bridgeUrl); } catch { return false; } });
  report.controlPort = Number(new URL(bridgeUrl).port);
  startup('read_compiled_inventory');
  const inventory = await api('inventory');
  if (!['3025975631', '1778944028', '3444535389'].every((id) => inventory.projects.some((p) => p.id === id))) throw Error('workbench_sample_scan_unavailable');
  startup('create_isolated_session');
  const isolated = session.fromPartition('cwb-preview-test-' + randomBytes(16).toString('hex'));
  isolated.setPermissionRequestHandler((_, __, callback) => callback(false));
  isolated.webRequest.onBeforeRequest((details, callback) => {
    const url = new URL(details.url); callback({ cancel: !['data:', 'blob:', 'about:'].includes(url.protocol) && !(url.protocol === 'http:' && url.hostname === '127.0.0.1') });
  });
  startup('construct_owned_window');
  win = new BrowserWindow({ width: 1280, height: 720, useContentSize: true, show: false, title: 'M2 Scene 独立工作台测试',
    webPreferences: { session: isolated, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: true } });
  win.webContents.setAudioMuted(true); win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // Initialise the owned main document before enabling Runtime on Windows.
  // An empty hidden about:blank target can stall the native CDP handshake.
  startup('load_compiled_workbench');
  await bounded(win.loadURL(bridgeUrl), 20000); win.show();
  startup('attach_owned_debugger'); win.webContents.debugger.attach('1.3');
  win.webContents.debugger.on('message', (_, method, params) => {
    if (method === 'Runtime.executionContextCreated') contexts.push(params.context);
    if (method === 'Runtime.executionContextDestroyed') contexts = contexts.filter((context) => context.id !== params.executionContextId);
    if (method === 'Runtime.executionContextsCleared') contexts = [];
  });
  startup('enable_owned_runtime'); await bounded(win.webContents.debugger.sendCommand('Runtime.enable'));
  startup('enable_owned_page'); await bounded(win.webContents.debugger.sendCommand('Page.enable'));
  await step('compiled workbench selects allowed Scene and commits real WebGL instead of the 254px preview', async () => {
    await ready('3025975631');
    report.initial = await inScene('({canvasWidth:document.querySelector("canvas").width,canvasHeight:document.querySelector("canvas").height,dpr:devicePixelRatio,viewportWidth:innerWidth,viewportHeight:innerHeight,nodeAvailable:typeof require!=="undefined"||typeof process!=="undefined",layers:window.__sceneLayers.length,draws:window.__cwbScene.draws,configuredFps:Number(new URLSearchParams(location.search).get("sceneFps"))})');
    assert.equal(report.initial.nodeAvailable, false); assert.equal(report.initial.configuredFps, 60);
    assert.ok(report.initial.canvasWidth >= 1280 && report.initial.canvasHeight >= 720);
    assert.ok(report.initial.layers > 0 && report.initial.draws > 0);
    const runtime = JSON.parse(await fs.readFile(path.join(stateRoot, 'runtime.json'), 'utf8'));
    assert.equal(runtime.injectorActive, false); assert.equal(runtime.nativeEngineProviderConfigured, false);
    await capture('scene-workbench-first-submit', true);
  });
  await step('actual compositor pixels change and continuous render completion FPS is measured without deleting slow samples', async () => {
    const start = await inScene('({time:performance.now(),frames:window.__cwbScene.renderCompletions})');
    const a = await capture('scene-a'); await delay(1200); const b = await capture('scene-b'); await delay(1200); const c = await capture('scene-c');
    report.changedRatios = [changed(a, b), changed(b, c)]; assert.ok(report.changedRatios.every((ratio) => ratio > .0001));
    await delay(6000);
    const end = await inScene('({time:performance.now(),frames:window.__cwbScene.renderCompletions,fps:window.__cwbScene.fps,draws:window.__cwbScene.draws})');
    report.performance = { elapsedMs: end.time - start.time, completedFrames: end.frames - start.frames,
      rendererCompletedFps: (end.frames - start.frames) * 1000 / (end.time - start.time), reportedEngineFps: end.fps,
      includesNativeScreenshots: true, physicalScreenFps: null, targetFps: 60 };
    assert.ok(report.performance.rendererCompletedFps >= 50, 'workbench_60fps_target_not_met');
    // The first GL submit can precede texture loading. Keep both observations
    // rather than presenting a loading frame as the final high-resolution view.
    await capture('scene-workbench-after-sampling', true);
  });
  await step('native workbench pause/resume freezes compositor pixels and resumes the same allowed Scene', async () => {
    await click('#playButton'); await until(async () => await inScene('window.__cwbScene.paused===true'));
    await delay(600); const a = await capture('paused-a'); await delay(700); const b = await capture('paused-b');
    report.pausedChangedRatio = changed(a, b); assert.ok(report.pausedChangedRatio < .0001);
    await click('#playButton'); await until(async () => await inScene('window.__cwbScene.paused===false'));
    await delay(700); assert.ok(changed(b, await capture('resumed')) > .0001);
  });
  await step('allowed bright/dark Scene switches retire old iframe and hidden WAAPI settles with no duplicate media', async () => {
    for (let cycle = 0; cycle < 2; cycle++) for (const id of ['1778944028', '3444535389', '3025975631']) await select(id);
    await select('1778944028', true); await delay(600);
    await until(async () => await evaluate('document.querySelectorAll("#wallpaper iframe[id*=backgroundScene]").length===1'));
    assert.equal(await evaluate('document.querySelectorAll("#wallpaper .wallpaper__media.is-visible").length'), 1);
    assert.ok(!report.selectedIds.includes('3790869794'));
  });
  await step('hiding before candidate readiness retains the previous Scene and reveal still requires a real draw', async () => {
    const before = await evaluate('document.querySelector("#backgroundScene").src');
    await beginSelect('3025975631'); win.hide(); await delay(1000);
    const observed = await evaluate('(()=>{const scene=document.querySelector("#backgroundScene");return {hidden:document.hidden,sceneNodes:document.querySelectorAll("#wallpaper iframe[id*=backgroundScene]").length,phase:scene?.dataset.cwbScenePhase,src:scene?.src}})()');
    report.hiddenBeforeReady = { hidden: observed.hidden, sceneNodes: observed.sceneNodes, activePhase: observed.phase,
      previousSceneRetained: observed.src === before };
    assert.equal(observed.hidden, true); assert.ok(observed.sceneNodes >= 1 && observed.sceneNodes <= 2);
    assert.equal(observed.phase, 'ready');
    // A throttled candidate may already have submitted its first frame. Either
    // way, never fabricate ready: validate new telemetry after native reveal.
    win.show(); await ready('3025975631');
    assert.ok(await inScene('window.__cwbScene.draws>0'));
    report.selectedIds.push('3025975631');
  });
  report.outcome = 'pass';
}
async function cleanup() {
  if (win && !win.isDestroyed()) win.destroy();
  if (child && !ended) { child.postMessage({ channel: 'cwb-utility', action: 'shutdown' }); await until(() => ended, 25000).catch(() => {}); }
  report.utilityNaturallyExited = ended; report.utilityExitCode = childExit;
  if (child && !ended) { child.kill(); report.utilityForcedStop = true; }
  report.remainingOwnedWindows = BrowserWindow.getAllWindows().length;
  report.resourcesClosed = ended && childExit === 0 && report.remainingOwnedWindows === 0;
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ evidence: path.relative(workspace, root), outcome: report.outcome, steps: report.steps.length,
    performance: report.performance, resourcesClosed: report.resourcesClosed }));
}
main().catch(async (error) => {
  report.outcome = 'fail'; report.failure = /^[a-z_]{1,64}$/.test(error.message) ? error.message : 'assertion_failed';
  if (win && !win.isDestroyed()) {
    try { report.failureObservation = await evaluate('({hidden:document.hidden,selectedId:document.querySelector(".wallpaper-card.is-selected")?.dataset.id,sceneNodes:document.querySelectorAll("#wallpaper iframe[id*=backgroundScene]").length,phases:[...document.querySelectorAll("#wallpaper iframe[id*=backgroundScene]")].map(n=>n.dataset.cwbScenePhase)})'); } catch {}
  }
})
  .then(cleanup).then(() => app.exit(report.outcome === 'pass' && report.resourcesClosed ? 0 : 1), () => app.exit(1));
