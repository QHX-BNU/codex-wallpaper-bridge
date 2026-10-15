// The actual electron . / compiled main entry, not a replacement BrowserWindow.
// Only the spawned desktop and its private preview service are inspected/closed.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { CdpConnection } from './verify-live-host.mjs';
import policy from './m2-test-policy.cjs';

const exec = promisify(execFile), workspace = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const steamRoot = await realpath(process.argv[2] || '');
const library = path.join(steamRoot, 'steamapps', 'workshop', 'content', '431960');
const ids = ['1778944028', '3444535389'];
for (const id of ids) policy.assertM2TestRoot(path.join(library, id));
const allowed = await realpath(path.join(workspace, 'out', 'live-acceptance'));
const root = path.join(allowed, 'm2-desktop-shell-' + new Date().toISOString().replace(/[:.]/g, '-') + '-' + randomBytes(4).toString('hex'));
await mkdir(root); assert.ok((await realpath(root)).startsWith(allowed + path.sep));
const report = { startedAt: new Date().toISOString(), scope: 'actual-compiled-desktop-entry-scene-preview-only',
  productionCodexHostsVerified: false, completeM0Gate: false, releaseExeGenerated: false,
  dailyConfigurationTouched: false, officialCspModified: false, audioEnabled: false,
  excludedTestSampleIds: [...policy.EXCLUDED_M2_TEST_IDS], steps: [], blockedByResponseCount: 0 };
console.log(JSON.stringify({ evidence: root }));
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
let child, main, control, bridgeUrl, runtime, childExited = false, childExitCode, desktopIdentity, utilityIdentity;
const connections = [];
const hashFiles = ['main.mjs', 'preload.cjs', 'renderer/index.html', 'renderer/renderer-desktop.mjs',
  'bridge-utility-entry.mjs', 'bridge-runtime/src/cli.mjs', 'bridge-runtime/public/workbench-scene-preview.js',
  'bridge-runtime/public/app.js', 'bridge-runtime/public/cwb-scene-bridge.js', 'bridge-runtime/public/author-properties-panel.js'];
async function hashes() {
  return Object.fromEntries(await Promise.all(hashFiles.map(async name => [name,
    createHash('sha256').update(await readFile(path.join(workspace, 'dist', name))).digest('hex')])));
}
async function lookupProcess(pid) {
  assert.ok(Number.isSafeInteger(pid) && pid > 0);
  const ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
  const script = `try {$p=Get-Process -Id ${pid} -ErrorAction Stop} catch {if ($_.CategoryInfo.Category -eq 'ObjectNotFound') {'null';exit 0};throw}; [pscustomobject]@{pid=$p.Id;exe=$p.Path;creation=$p.StartTime.ToUniversalTime().ToString('o')} | ConvertTo-Json -Compress`;
  const result = await exec(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000 });
  return JSON.parse(result.stdout.trim());
}
async function processIdentity(pid) {
  const identity = await lookupProcess(pid);
  assert.equal(identity.pid, pid); assert.ok(identity.exe && identity.creation); return identity;
}
async function freePort() {
  const server = createServer(); await new Promise((resolve, reject) => {
    server.once('error', reject); server.listen({ host: '127.0.0.1', port: 0 }, resolve);
  });
  const port = server.address().port; await new Promise(resolve => server.close(resolve)); return port;
}
async function until(fn, ms = 90000) {
  const end = Date.now() + ms;
  do { const value = await fn(); if (value) return value;
    if (childExited) throw Error('owned_desktop_exited_early'); await pause(80);
  } while (Date.now() < end);
  throw Error('desktop_shell_wait_timeout');
}
async function json(port, route) {
  const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(5000), redirect: 'error' });
  assert.equal(response.status, 200); return response.json();
}
async function connect(target, port) {
  const connection = new CdpConnection(target.webSocketDebuggerUrl, port);
  await connection.connect(); connections.push(connection);
  connection.contexts = new Map();
  connection.socket.on('message', raw => {
    let message; try { message = JSON.parse(raw.toString()); } catch { return; }
    if (message.method === 'Runtime.executionContextCreated') {
      const context = message.params.context;
      if (context.auxData?.isDefault) connection.contexts.set(context.id, context.auxData.frameId);
    } else if (message.method === 'Runtime.executionContextDestroyed') connection.contexts.delete(message.params.executionContextId);
    else if (message.method === 'Runtime.executionContextsCleared') connection.contexts.clear();
  });
  await connection.call('Runtime.enable'); return connection;
}
async function step(name, fn) {
  report.currentStep = name; await writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
  const started = Date.now();
  try { await fn(); report.steps.push({ name, status: 'pass', elapsedMs: Date.now() - started }); }
  catch (error) { report.steps.push({ name, status: 'fail', reason: safeReason(error) }); throw error; }
  console.log(JSON.stringify({ step: name, status: 'pass' }));
}
const cdpReasons = new Map([
  ['CDP command failed', 'cdp_command_failed'], ['CDP command timed out', 'cdp_command_timeout'],
  ['CDP socket closed', 'cdp_socket_closed'], ['CDP socket is not open', 'cdp_socket_not_open'],
  ['CDP socket connection failed', 'cdp_socket_connect_failed'],
  ['renderer metadata evaluation failed', 'renderer_evaluation_failed'],
]);
const safeReason = error => cdpReasons.get(error?.message) ?? (/^[a-z_]{1,80}$/.test(error?.message) ? error.message :
  error?.code === 'ERR_ASSERTION' ? 'assertion_failed' : 'operation_or_environment_failure');

async function attachReloadedControl(marker) {
  return until(async () => {
    const target = (await json(report.desktopPort, '/json/list')).find(t => t.type === 'iframe' && t.url === bridgeUrl);
    if (!target) return null;
    let candidate;
    try {
      candidate = await connect(target, report.desktopPort);
      const isNewReadyDocument = await candidate.evaluate(`document.readyState === 'complete'
        && document.documentElement.dataset.cwbDesktopEmbedded === 'true'
        && window.__cwbShellReloadMarker !== ${JSON.stringify(marker)}`);
      if (isNewReadyDocument) return candidate;
      candidate.close(); return null;
    } catch (error) {
      candidate?.close();
      const reason = safeReason(error);
      if (![...cdpReasons.values()].includes(reason)) throw error;
      report.reloadTransientReasons ??= []; report.reloadTransientReasons.push(reason);
      if (report.reloadTransientReasons.length > 20) throw Error('reload_control_attach_limit');
      return null;
    }
  });
}
async function api(route) {
  const response = await fetch(new URL('api/' + route, bridgeUrl), { signal: AbortSignal.timeout(5000), redirect: 'error' });
  assert.equal(response.status, 200); return response.json();
}
async function ready(id) {
  await until(async () => {
    if (report.blockedByResponseCount) throw Error('desktop_scene_blocked_by_response');
    const state = await control.evaluate(`(()=>{const n=document.querySelector('#backgroundScene');return {phase:n?.dataset.cwbScenePhase,visible:n?.classList.contains('is-visible'),count:document.querySelectorAll('#wallpaper iframe[id*=backgroundScene]').length}})()`);
    // The initial selection need not be in the first paginated card batch.
    // Check persisted identity plus actual committed frame, not card presence.
    state.selected = (await api('config')).config.selectedId;
    report.lastPreviewState = state;
    return state.selected === id && state.phase === 'ready' && state.visible && state.count === 1;
  });
  const source = await control.evaluate('document.querySelector("#backgroundScene").src');
  // Loopback origins with different ports can be same-site frames, not OOPIF
  // targets. Use only the default context of the exact owned Scene frame.
  const scene = await until(async () => {
    const tree = await control.call('Page.getFrameTree');
    const frames = [];
    const visit = node => { frames.push(node.frame); for (const child of node.childFrames ?? []) visit(child); };
    visit(tree.frameTree);
    const frame = frames.find(frame => frame.url === source);
    const context = frame && [...control.contexts].find(([, frameId]) => frameId === frame.id);
    if (context) return { evaluate: async expression => {
      const result = await control.call('Runtime.evaluate', { contextId: context[0], expression, returnByValue: true, awaitPromise: true });
      assert.ok(!result.exceptionDetails); return result.result?.value;
    } };
    const target = (await json(report.desktopPort, '/json/list')).find(t => t.type === 'iframe' && t.url === source);
    return target ? connect(target, report.desktopPort) : null;
  });
  const state = await scene.evaluate('({width:document.querySelector("canvas")?.width,height:document.querySelector("canvas")?.height,draws:window.__cwbScene?.draws,renderCompletions:window.__cwbScene?.renderCompletions,nodeAvailable:typeof require!=="undefined"||typeof process!=="undefined"})');
  assert.ok(state.width > 0 && state.height > 0 && state.draws > 0); assert.equal(state.nodeAvailable, false);
  report.realSceneFrames ??= []; report.realSceneFrames.push({ id, ...state });
  return scene;
}
async function click(selector) {
  const offset = await main.evaluate('(()=>{const r=document.querySelector("#controlFrame").getBoundingClientRect();return {x:r.x,y:r.y}})()');
  const point = await control.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('control_not_actionable');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2}})()`);
  for (const type of ['mousePressed', 'mouseReleased']) await main.call('Input.dispatchMouseEvent', {
    type, x: point.x + offset.x, y: point.y + offset.y, button: 'left', clickCount: 1,
  });
}
async function select(id) {
  policy.assertM2TestProject(id);
  await control.evaluate(`(()=>{const e=document.querySelector('#searchInput');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
  await until(() => control.evaluate(`Boolean(document.querySelector('.wallpaper-card[data-id="${id}"]'))`));
  await click(`.wallpaper-card[data-id="${id}"]`); await ready(id);
  report.selectedIds ??= []; report.selectedIds.push(id);
}
async function inputText(selector, value) {
  await click(selector);
  for (const type of ['rawKeyDown', 'keyUp']) await main.call('Input.dispatchKeyEvent', {
    type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2,
  });
  await main.call('Input.insertText', { text: String(value) });
  for (const type of ['rawKeyDown', 'keyUp']) await main.call('Input.dispatchKeyEvent', {
    type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9,
  });
}
async function capture(name) {
  const image = await main.call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
  const bytes = Buffer.from(image.data, 'base64'); await writeFile(path.join(root, name + '.png'), bytes, { flag: 'wx' });
  return createHash('sha256').update(bytes).digest('hex');
}
async function run() {
  await step('launch actual compiled desktop with isolated data and no Codex activation', async () => {
    const sentinel = await processIdentity(process.pid);
    const hostPort = await freePort(), desktopPort = await freePort(); assert.notEqual(hostPort, desktopPort);
    report.desktopPort = desktopPort; report.unusedHostPort = hostPort;
    await mkdir(path.join(root, 'sentinel-profile'));
    // This is the verifier's real Node process, not a Codex host; it cannot pass
    // the app's selected Codex owner gate. No apply/restore action is performed.
    await writeFile(path.join(root, 'target.json'), JSON.stringify({ ...sentinel, port: hostPort,
      profile: path.join(root, 'sentinel-profile') }), { flag: 'wx' });
    await mkdir(path.join(root, 'desktop-user-data')); await mkdir(path.join(root, 'bridge-state', 'CodexWallpaperBridge'), { recursive: true });
    await writeFile(path.join(root, 'desktop-user-data', 'settings.json'), JSON.stringify({ manualExecutables: [], selectedId: null, port: hostPort, adaptive: true }), { flag: 'wx' });
    await writeFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'config.json'), JSON.stringify({ schemaVersion: 4,
      selectedId: ids[0], library: { hiddenIds: [...policy.EXCLUDED_M2_TEST_IDS] }, effects: { brightness: 100, saturation: 100,
        contrast: 100, darkness: 0, blur: 0, audioEnabled: false, playing: true, fit: 'cover', transition: 'fade', transitionDurationMs: 300 } }), { flag: 'wx' });
    report.compiledHashesBefore = await hashes();
    const exe = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
    const env = { ...process.env, CWB_ACCEPTANCE_ROOT: root };
    delete env.ELECTRON_RUN_AS_NODE; delete env.CWB_NATIVE_ENGINE_PROVIDER; delete env.NODE_OPTIONS;
    child = spawn(exe, [workspace, `--remote-debugging-port=${desktopPort}`, '--remote-debugging-address=127.0.0.1'],
      { cwd: workspace, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    child.once('exit', code => { childExited = true; childExitCode = code; }); child.once('error', () => { childExited = true; });
    child.stdout.on('data', () => {});
    child.stderr.on('data', chunk => { report.blockedByResponseCount += (String(chunk).match(/ERR_BLOCKED_BY_RESPONSE/g) || []).length; });
    desktopIdentity = await processIdentity(child.pid); assert.equal(desktopIdentity.exe.toLowerCase(), exe.toLowerCase());
    report.desktopIdentity = desktopIdentity;
    const legacy = pathToFileURL(path.join(workspace, 'dist', 'renderer', 'index.html')).href;
    const target = await until(async () => {
      try { return (await json(desktopPort, '/json/list')).find(t => t.type === 'page' && [legacy, 'cwb-desktop://shell/index.html'].includes(t.url)); }
      catch { return null; }
    });
    main = await connect(target, desktopPort);
    report.outerScheme = target.url === legacy ? 'file:' : 'cwb-desktop:';
    bridgeUrl = await until(() => main.evaluate('document.querySelector("#controlFrame")?.src || null'));
    const address = new URL(bridgeUrl); assert.equal(address.hostname, '127.0.0.1'); assert.equal(address.protocol, 'http:');
    report.controlPort = Number(address.port);
    const frame = await until(async () => (await json(desktopPort, '/json/list')).find(t => t.type === 'iframe' && t.url === bridgeUrl));
    control = await connect(frame, desktopPort);
    await until(() => control.evaluate('document.documentElement.dataset.cwbDesktopEmbedded === "true"'));
    runtime = JSON.parse(await readFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'runtime.json'), 'utf8'));
    assert.equal(runtime.injectorActive, false); report.utilityPid = runtime.pid;
    utilityIdentity = await processIdentity(runtime.pid); report.utilityIdentity = utilityIdentity;
  });
  await step('three-level desktop/workbench/Scene ancestry permits a real WebGL first frame', async () => {
    const source = await until(async () => {
      if (report.blockedByResponseCount) throw Error('desktop_scene_blocked_by_response');
      return control.evaluate('document.querySelector("#wallpaper iframe[id*=backgroundScene]")?.src || null');
    });
    const response = await fetch(source, { method: 'HEAD', signal: AbortSignal.timeout(5000) });
    report.frameAncestors = response.headers.get('content-security-policy')?.split(';').map(s => s.trim()).find(s => s.startsWith('frame-ancestors'));
    await ready(ids[0]); assert.equal(report.outerScheme, 'cwb-desktop:');
    assert.equal(report.blockedByResponseCount, 0); await capture('desktop-scene-first-frame');
  });
  await step('real Scene draw completions advance and actual desktop screenshots change', async () => {
    const scene = await ready(ids[0]);
    const before = await scene.evaluate('window.__cwbScene.renderCompletions');
    const a = await capture('desktop-scene-a'); await pause(1400); const b = await capture('desktop-scene-b');
    const after = await scene.evaluate('window.__cwbScene.renderCompletions');
    assert.ok(after > before); assert.notEqual(a, b); report.renderCompletionsAdvanced = after - before;
  });
  await step('six Scene switches use the actual desktop UI and release the old preview', async () => {
    for (let cycle = 0; cycle < 3; cycle++) for (const id of [ids[1], ids[0]]) await select(id);
    assert.equal(report.blockedByResponseCount, 0); assert.ok(!report.selectedIds.includes('3790869794'));
    await capture('desktop-scene-after-switches');
  });
  let author;
  await step('actual author panel saves after ordinary effects writes and shows only actual workbench engine readback', async () => {
    await select(ids[1]);
    const state = await api('author-properties/' + ids[1]);
    const boolKey = 'bee', sliderKey = 'beerandommovementspeed';
    assert.equal(state.schema[boolKey]?.type, 'bool'); assert.equal(state.schema[sliderKey]?.type, 'slider');
    const boolSelector = `.author-property-row[data-author-property="${boolKey}"] input`;
    const sliderSelector = `.author-property-row[data-author-property="${sliderKey}"] input`;
    await until(() => control.evaluate(`document.querySelector(${JSON.stringify(boolSelector)})?.disabled === false
      && document.querySelector('#authorPropertiesPanel .effect-hint')?.textContent.includes('工作台 Scene') === true`));
    // Native mouse/key input on the real controls, not a hidden config POST.
    await click('#brightnessRange');
    const brightnessBefore = (await api('config')).config.effects.brightness;
    for (const type of ['rawKeyDown', 'keyUp']) await main.call('Input.dispatchKeyEvent', {
      type, key: 'ArrowLeft', code: 'ArrowLeft', windowsVirtualKeyCode: 37,
    });
    await until(async () => (await api('config')).config.effects.brightness !== brightnessBefore);
    assert.equal((await api('author-properties/' + ids[1])).revision, state.revision);
    const boolValue = !state.values[boolKey];
    await click(boolSelector);
    await until(async () => (await api('author-properties/' + ids[1])).values[boolKey] === boolValue);
    await until(() => control.evaluate(`document.querySelector(${JSON.stringify(boolSelector)})?.disabled === false
      && document.querySelector('.author-property-row[data-author-property="${boolKey}"] output')?.textContent === ${JSON.stringify('实际：' + boolValue)}`));
    const sliderValue = state.values[sliderKey] === .5 ? .6 : .5;
    await inputText(sliderSelector, sliderValue);
    await until(async () => (await api('author-properties/' + ids[1])).values[sliderKey] === sliderValue);
    await until(() => control.evaluate(`document.querySelector(${JSON.stringify(sliderSelector)})?.disabled === false
      && document.querySelector('.author-property-row[data-author-property="${sliderKey}"] output')?.textContent === ${JSON.stringify('实际：' + sliderValue)}`));
    const scene = await ready(ids[1]);
    const engine = await scene.evaluate(`({flag:window.__cwbScene.properties[${JSON.stringify(boolKey)}],speed:window.__cwbScene.properties[${JSON.stringify(sliderKey)}]})`);
    assert.equal(engine.flag, boolValue); assert.equal(engine.speed, sliderValue);
    const disk = JSON.parse(await readFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'config.json'), 'utf8'));
    assert.equal(disk.authorProperties[ids[1]][boolKey], boolValue); assert.equal(disk.authorProperties[ids[1]][sliderKey], sliderValue);
    report.authorPanel = { id: ids[1], boolKey, boolValue, sliderKey, sliderValue, ordinaryConfigDidNotExpireAuthorRevision: true,
      actualUiSaved: true, diskConfirmed: true, engineReadbackConfirmed: true, source: 'workbench-preview', codexHostReadbackVerified: false };
    await capture('desktop-author-properties');
    author = { boolKey, boolValue, boolSelector, sliderKey, sliderSelector, state };
  });
  await step('actual author default reset preserves ordinary effects and a following edit persists for reload', async () => {
    const brightness = (await api('config')).config.effects.brightness;
    await click('[data-author-reset]');
    await until(async () => !(await api('config')).config.authorProperties[ids[1]]);
    await until(() => control.evaluate(`document.querySelector(${JSON.stringify(author.boolSelector)})?.disabled === false
      && document.querySelector('.author-property-row[data-author-property="${author.boolKey}"] output')?.textContent === ${JSON.stringify('实际：' + author.state.defaults[author.boolKey])}`));
    assert.equal((await api('config')).config.effects.brightness, brightness);
    await click(author.boolSelector);
    await until(async () => (await api('author-properties/' + ids[1])).values[author.boolKey] === author.boolValue);
    await until(() => control.evaluate(`document.querySelector(${JSON.stringify(author.boolSelector)})?.disabled === false`));
    report.authorPanel.defaultResetPassed = true;
  });
  await step('desktop reload preserves strict IPC handshake and releases/recreates real Scene preview', async () => {
    report.reloadStage = 'request_outer_reload';
    const marker = randomBytes(16).toString('hex');
    await main.evaluate(`window.__cwbShellReloadMarker = ${JSON.stringify(marker)}; true`);
    await control.evaluate(`window.__cwbShellReloadMarker = ${JSON.stringify(marker)}; true`);
    control.close(); await main.call('Page.reload');
    report.reloadStage = 'wait_new_outer_document';
    await until(async () => {
      try { return await main.evaluate(`document.readyState === 'complete' && window.__cwbShellReloadMarker !== ${JSON.stringify(marker)}
        && Boolean(document.querySelector('#controlFrame')?.src)`); }
      catch (error) { if (![...cdpReasons.values()].includes(safeReason(error))) throw error; return false; }
    });
    report.reloadStage = 'attach_new_control_document';
    control = await attachReloadedControl(marker);
    report.reloadStage = 'wait_real_scene_after_reload';
    await ready(ids[1]); assert.equal(report.blockedByResponseCount, 0);
    report.reloadStage = 'wait_author_panel_after_scene_ready';
    await until(async () => {
      const observation = await control.evaluate(`(()=>{const input=document.querySelector(${JSON.stringify(author.boolSelector)});
        return {present:Boolean(input),idle:input?.disabled===false,savedValueMatches:input?.checked===${author.boolValue},
          actualReadbackMatches:document.querySelector('.author-property-row[data-author-property="${author.boolKey}"] output')?.textContent===${JSON.stringify('实际：' + author.boolValue)}}})()`);
      report.authorPanel.reloadObservation = observation;
      return observation.present && observation.idle && observation.savedValueMatches && observation.actualReadbackMatches;
    });
    report.reloadStage = 'complete';
    report.authorPanel.reloadRestoredActualReadback = true; await capture('desktop-after-reload');
  });
  report.compiledHashesAfter = await hashes(); assert.deepEqual(report.compiledHashesAfter, report.compiledHashesBefore);
  report.outcome = 'pass';
}
try { await run(); }
catch (error) {
  report.outcome = 'fail'; report.failure = safeReason(error);
  if (main) { try { await capture('desktop-failure'); } catch {} }
} finally {
  if (main && !childExited) {
    try { await main.call('Browser.close'); } catch {}
    const end = Date.now() + 30000; while (!childExited && Date.now() < end) await pause(100);
  }
  // A failed graceful close stops only the exact process created above, after
  // rechecking PID, executable and 7-digit creation time. Never stop by name.
  if (child && !childExited && desktopIdentity) {
    try { const current = await processIdentity(child.pid);
      assert.deepEqual(current, desktopIdentity); child.kill(); report.ownedDesktopForcedStop = true;
      const end = Date.now() + 5000; while (!childExited && Date.now() < end) await pause(100);
    } catch { report.cleanupIdentityUnverified = true; }
  }
  for (const connection of connections) connection.close();
  let utilityGone = !runtime?.pid;
  if (runtime?.pid) {
    try { const current = await lookupProcess(runtime.pid);
      utilityGone = current === null || (utilityIdentity && current.creation !== utilityIdentity.creation);
    } catch { utilityGone = null; }
  }
  report.desktopExited = childExited; report.desktopExitCode = childExitCode; report.utilityExited = utilityGone;
  report.resourcesClosed = childExited && utilityGone && !report.ownedDesktopForcedStop && childExitCode === 0;
  report.finishedAt = new Date().toISOString();
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ evidence: root, outcome: report.outcome, failure: report.failure, steps: report.steps.length,
    blockedByResponseCount: report.blockedByResponseCount, resourcesClosed: report.resourcesClosed }));
  process.exitCode = report.outcome === 'pass' && report.resourcesClosed ? 0 : 1;
}
