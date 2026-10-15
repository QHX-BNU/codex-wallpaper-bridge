// Focused actual desktop -> UtilityProcess -> GPU Scene acceptance. Never VP8.
// Run from a hash-pinned isolated workspace, not a concurrently rebuilt checkout.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { freezeCompiledBuild, verifyCompiledSnapshot } from './m2-compiled-snapshot.mjs';
import { CdpConnection } from './verify-live-host.mjs';
import { readOwnedGpuDocuments } from './m2-gpu-diagnostics.mjs';
import { readOwnedGpuResources } from './m2-gpu-resource-sampler.mjs';
import { runGpuRemainingSamples, GPU_REMAINING_SAMPLES } from './m2-gpu-remaining-checks.mjs';
import { detectInstallations } from '../src/installations.mjs';
import { verifyCdpEndpointOwner } from '../src/cdp-owner.mjs';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { scanWallpaperProjects } from '../bridge-runtime/src/scanner.mjs';
import { projectPolicy } from '../bridge-runtime/src/library-policy.mjs';
import policy from './m2-test-policy.cjs';

const workspace = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const require = createRequire(import.meta.url);
const isolatedMarker = JSON.parse(await readFile(path.join(workspace, 'isolated-workspace.json'), 'utf8'));
assert.equal(isolatedMarker.purpose, 'm2-gpu-production');
const productFiles = isolatedMarker.files.filter(entry => /^(?:src\/|bridge-runtime\/|bridge-overrides\/|package(?:-lock)?\.json$)/.test(entry.path));
const productSha256 = createHash('sha256').update(JSON.stringify(productFiles)).digest('hex');
async function verifyIsolatedProduct() {
  assert.ok(productFiles.length > 0 && productFiles.length <= 1024);
  for (const entry of productFiles) {
    const file = path.resolve(workspace, entry.path);
    assert.ok(file.startsWith(workspace + path.sep));
    assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), entry.sha256);
  }
  return true;
}
const kind = process.argv[2]; assert.ok(['store', 'local'].includes(kind));
const visibleHost = process.argv.includes('--visible');
const controlsOnly = process.argv.includes('--controls-only');
const skipPointer = process.argv.includes('--skip-pointer');
const pointerOnly = process.argv.includes('--pointer-only');
const afterControls = process.argv.includes('--after-controls');
const applyOnly = process.argv.includes('--apply-only');
const minimizePeer = process.argv.includes('--minimize-peer');
const remaining = process.argv.includes('--remaining');
const authorOnly = process.argv.includes('--author-only');
const webOnly = process.argv.includes('--web-only');
const restartOnly = process.argv.includes('--restart-only');
assert.ok(!restartOnly || (kind === 'store' && remaining && controlsOnly && !authorOnly && !webOnly && !pointerOnly && !applyOnly && !minimizePeer));
assert.ok(!webOnly || (remaining && controlsOnly && !authorOnly));
assert.ok(!authorOnly || (remaining && controlsOnly));
assert.ok(process.argv.slice(3).every(arg => ['--visible', '--controls-only', '--skip-pointer', '--pointer-only', '--after-controls', '--apply-only', '--minimize-peer', '--remaining', '--author-only', '--web-only', '--restart-only'].includes(arg)));
assert.ok(!remaining || (visibleHost && !applyOnly && !pointerOnly));
assert.ok(!pointerOnly || (controlsOnly && !skipPointer));
assert.ok(!afterControls || pointerOnly);
assert.ok(!applyOnly || (controlsOnly && !pointerOnly && !afterControls));
assert.ok(!minimizePeer || ((applyOnly || pointerOnly) && controlsOnly && visibleHost));
const base = await realpath(path.join(workspace, 'out', 'live-acceptance'));
assert.equal((await lstat(base)).isSymbolicLink(), false);
const root = path.join(base, `m2-gpu-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`);
await mkdir(root); assert.ok((await realpath(root)).startsWith(base + path.sep));
const report = { startedAt: new Date().toISOString(), scope: 'frozen-desktop-isolated-runtime-gpu-production', kind,
  sceneRenderer: 'direct-gpu', vp8Tested: false, productSourceSha256: productSha256,
  dailyConfigurationTouched: false, officialPackageModified: false, gpuCspBypassExpected: true, completeM0Gate: false, releaseExeGenerated: false,
  audioEnabled: false, visibleHostRequested: visibleHost, controlsOnly, applyOnly, minimizePeer, remaining, authorOnly, webOnly, restartOnly,
  notRun: [...(controlsOnly ? ['motion screenshots and FPS sampling', 'four-switch stress loop'] : []),
    ...(skipPointer ? ['pointer forwarding (known gap, no repeated live attempt)'] : []),
    ...(pointerOnly ? [afterControls ? 'author UI and reapply (pointer sequence diagnostic only)' : 'author UI, switching and pause regressions (pointer diagnostic only)'] : []),
    ...(applyOnly ? ['pointer, author UI, switching, pause and reapply (Apply diagnostic only)'] : [])], steps: [], evidence: root };
if (authorOnly) report.notRun.push('sample matrix, soak, pointer, switching and pause (author restart diagnostic only)');
if (webOnly) report.notRun.push('author restart, pointer, Scene switch and pause regressions (Web-only GPU acceptance)');
if (restartOnly) report.notRun.push('author controls, pointer, sample matrix, soak, switching and pause (Store restart-only diagnostic)');
console.log(JSON.stringify({ evidence: root }));
const exec = promisify(execFile), ps = path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const hash = async file => createHash('sha256').update(await readFile(file)).digest('hex');
const dailyFile = 'C:/Users/11640/AppData/Local/CodexWallpaperBridge/config.json';
const artifacts = ['main.mjs', 'preload.cjs', 'bridge-utility-entry.mjs', 'renderer/renderer-desktop.mjs',
  'bridge-runtime/src/desktop-engine-host.mjs', 'bridge-runtime/src/engine-renderer-owner.mjs', 'bridge-runtime/src/cli.mjs',
  'bridge-runtime/src/engine-vp8-preload.cjs', 'bridge-runtime/public/cwb-scene-bridge.js', 'bridge-runtime/public/cwb-web-bridge.js'];
const hashes = async () => Object.fromEntries(await Promise.all(artifacts.map(async file => [file, await hash(path.join(workspace, 'dist', file))])));
async function runtimeHashes() {
  const files = ['src/engine-provider-rpc.mjs'];
  for (const dir of ['bridge-runtime/src', 'bridge-runtime/public']) {
    const entries = await readdir(path.join(workspace, dir), { withFileTypes: true });
    for (const entry of entries) if (entry.isFile() && /\.(?:mjs|js|html|css)$/.test(entry.name)) files.push(`${dir}/${entry.name}`);
  }
  assert.ok(files.length <= 128);
  return Object.fromEntries(await Promise.all(files.sort().map(async file => {
    const resolved = await realpath(path.join(workspace, file)); assert.ok(resolved.startsWith(workspace + path.sep));
    return [file, await hash(resolved)];
  })));
}
const progress = () => writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
const connections = [], processes = [];
let target, installation, main, control, host, hostTargetId, bridgeUrl, utilityIdentity, restored = false, compiledProof, compiledRoot, minimizedWindowHandle;
let desktopEnv, desktopBootstrap, currentDesktop;
const fixedReasons = new Set(['owned_wait_timeout', 'owned_window_restore_failed', 'desktop_apply_failed', 'desktop_restore_failed', 'host_launch_failed', 'desktop_launch_failed', 'native_sequence_not_advancing', 'native_pixels_not_changing', 'control_not_actionable', 'control_hit_test_failed', 'codex_page_unavailable', 'invalid_control_service', 'process_identity_changed', 'process_not_exited']);
const category = error => fixedReasons.has(error?.message) ? error.message : error?.code === 'ERR_ASSERTION' ? 'assertion_failed'
  : error?.message?.includes('所有者') ? 'identity_verification_failed' : 'operation_failed';
async function shell(script) { const result = await exec(ps, ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 15000, maxBuffer: 65536 }); return JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim()); }
async function identity(pid) { assert.ok(Number.isSafeInteger(pid) && pid > 0); return shell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}';if(-not $p){'null';exit};[pscustomobject]@{pid=$p.ProcessId;exe=$p.ExecutablePath;creation=$p.CreationDate.ToUniversalTime().ToString('o')}|ConvertTo-Json -Compress`); }
async function freePort() { const s = createServer(); await new Promise((resolve, reject) => { s.once('error', reject); s.listen(0, '127.0.0.1', resolve); }); const port = s.address().port; await new Promise(resolve => s.close(resolve)); return port; }
async function until(fn, ms = 60000) { const end = Date.now() + ms; do { const value = await fn(); if (value) return value; await pause(80); } while (Date.now() < end); throw Error('owned_wait_timeout'); }
async function guard() { await verifyCdpEndpointOwner({ installation, port: target.port,
  expectedProcess: { pid: target.pid, creation: target.creation, profile: target.profile } }); }
async function json(port, route) { const response = await fetch(`http://127.0.0.1:${port}${route}`, { signal: AbortSignal.timeout(5000), redirect: 'error' }); assert.equal(response.status, 200); return response.json(); }
async function connect(t, port) {
  const c = new CdpConnection(t.webSocketDebuggerUrl, port);
  try { await c.connect(); connections.push(c); return c; }
  catch (error) { c.close(); throw error; }
}
function start(exe, args, env, label) { const child = spawn(exe, args, { cwd: workspace, env, windowsHide: !(label === 'codex' && visibleHost), stdio: ['ignore', 'pipe', 'pipe'] }); const owned = { child, label, exited: false, exitCode: null, stderrBytes: 0 }; processes.push(owned); child.stdout.on('data', () => {}); child.stderr.on('data', bytes => { owned.stderrBytes += bytes.length; }); child.once('error', () => { owned.exited = true; }); child.once('exit', code => { owned.exited = true; owned.exitCode = code; }); return owned; }
async function step(name, fn) { report.currentStep = name; console.log(JSON.stringify({ step: name, at: new Date().toISOString() })); await progress(); const started = Date.now(); try { await fn(); report.steps.push({ name, status: 'pass', elapsedMs: Date.now() - started }); } catch (error) { report.steps.push({ name, status: 'fail', category: category(error), substage: report.substage || null,
  errorKind: ['Error', 'AssertionError', 'TypeError', 'TimeoutError'].includes(error?.name) ? error.name : 'Unknown',
  code: typeof error?.code === 'string' && /^[A-Z_]{1,40}$/.test(error.code) ? error.code : null, elapsedMs: Date.now() - started }); throw error; } finally { await progress(); } }
async function click(selector) {
  await until(() => control.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return !!e&&!e.disabled})()`), 30000);
  report.substage = 'control-frame-offset';
  const offset = await main.evaluate('(()=>{const r=document.querySelector("#controlFrame")?.getBoundingClientRect();return r?{x:r.x,y:r.y}:null})()');
  if (!offset) throw Error('control_not_actionable');
  report.substage = 'control-hit-test';
  const p = await control.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)return {available:!!e,disabled:e?.disabled===true};e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {available:true,disabled:false,x,y,hit:hit===e||e.contains(hit)}})()`);
  report.lastControlState = p;
  if (!p?.available || p.disabled) throw Error('control_not_actionable');
  if (!p.hit) throw Error('control_hit_test_failed');
  report.substage = 'native-ui-click';
  for (const type of ['mousePressed', 'mouseReleased']) await main.call('Input.dispatchMouseEvent', { type, x: p.x + offset.x, y: p.y + offset.y, button: 'left', clickCount: 1 });
}
function authorUiReadExpression(selector, spec) {
  return `(()=>{const r=document.querySelector(${JSON.stringify(selector)}),input=r?.querySelector('input,select');
    if(!input||input.disabled)return null;const type=${JSON.stringify(spec.type)},options=${JSON.stringify(spec.options || [])};
    if(type==='combo'){const raw=input.value;if(!/^(?:0|[1-9]\\d*)$/.test(raw))return null;const i=Number(raw);
      return Number.isSafeInteger(i)&&i<options.length?{value:options[i].value}:null}
    const value=type==='bool'?input.checked:type==='color'?[...r.querySelectorAll('input')].map(e=>Number(e.value)).join(' ')
      :type==='slider'?Number(input.value):input.value;return {value}})()`;
}
async function inputText(selector, value) {
  await click(selector);
  for (const type of ['rawKeyDown', 'keyUp']) await main.call('Input.dispatchKeyEvent', {
    type, key: 'a', code: 'KeyA', windowsVirtualKeyCode: 65, modifiers: 2 });
  await main.call('Input.insertText', { text: String(value) });
  for (const type of ['rawKeyDown', 'keyUp']) await main.call('Input.dispatchKeyEvent', {
    type, key: 'Tab', code: 'Tab', windowsVirtualKeyCode: 9 });
}
async function gpuStatus(id) {
  return until(async () => {
    const status = await api('action', { action: 'engine-status' });
    report.engineAfterSwitch = status.engine;
    if (status.sceneRenderer !== 'direct-gpu' || !Array.isArray(status.engine) || status.engine.length > 2) return false;
    const targets = status.engine.flatMap(source => (source.targets || []).map(target => ({ ...target, id: source.id, type: source.type })));
    const active = targets.filter(target => target.active);
    // Resource services are bounded at two across windows. A fresh Codex
    // process may create several top-level documents; each owns its own slot.
    return targets.length > 0 && active.length > 0 && active.every(target => target.id === id
      && target.width > 0 && target.height > 0 && (target.type === 'web' ? target.paintFrames >= 2 : target.renderCompletions > 0))
      && targets.every(target => target.active || target.preloaded) ? status : false;
  }, 15000);
}
const stateExpression = `(()=>{const node=document.getElementById('codex-wallpaper-bridge-media'),r=globalThis.__codexWallpaperBridgeRuntime,frame=node?.querySelector('iframe');let id=null;try{id=JSON.parse(r?.status().switch.identity||'null')?.[0]}catch{}return {appOrigin:location.origin==='app://-',documentReady:!!document.body&&['interactive','complete'].includes(document.readyState),ready:r?.ready===true,gpu:node?.dataset.cwbRenderer==='direct-gpu',phase:node?.dataset.cwbScenePhase||null,slots:r?.status().switch.slots||0,identity:/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)?id:null,hidden:document.hidden,root:!!document.getElementById('codex-wallpaper-bridge-root'),width:Number(frame?.dataset.cwbSceneWidth||0),height:Number(frame?.dataset.cwbSceneHeight||0),fps:Number(frame?.dataset.cwbSceneFps||0),nativeSlots:document.querySelectorAll('[data-cwb-native]').length}})()`;
async function nativeState() { return host.evaluate(stateExpression); }
function isStoreGpuPage(t) {
  if (t?.type !== 'page' || typeof t.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(t.id) || !t.webSocketDebuggerUrl) return false;
  try {
    const url = new URL(t.url);
    return url.protocol === 'app:' && url.hostname === '-' && !url.username && !url.password
      && !/initialRoute=.*(?:avatar|pet|overlay)/i.test(t.url);
  } catch { return false; }
}
function isStoreGpuState(s, id) {
  return s?.appOrigin === true && s.documentReady === true && s.ready === true && s.root === true && s.hidden === false
    && s.gpu === true && s.phase === 'ready' && s.identity === id && s.slots === 1 && s.nativeSlots === 0;
}
async function selectStoreGpuHost(id) {
  await guard();
  const pages = (await json(target.port, '/json/list')).filter(isStoreGpuPage);
  assert.ok(pages.length <= 8);
  const opened = [], candidates = [], observations = [];
  let chosen;
  try {
    for (const [targetIndex, page] of pages.entries()) {
      const socket = new URL(page.webSocketDebuggerUrl);
      assert.ok(socket.protocol === 'ws:' && socket.hostname === '127.0.0.1' && Number(socket.port) === target.port
        && !socket.username && !socket.password && !socket.hash);
      let connection, state;
      try {
        connection = page.id === hostTargetId ? host : await connect(page, target.port);
        if (connection !== host) opened.push(connection);
        state = await connection.evaluate(stateExpression);
      } catch { observations.push({ targetIndex, available: false }); continue; }
      observations.push({ targetIndex, available: true, visible: state?.hidden === false, ready: isStoreGpuState(state, id) });
      if (isStoreGpuState(state, id)) candidates.push({ page, connection, targetIndex });
    }
    report.lastStoreHostStates = observations;
    const candidate = candidates.find(c => c.connection === host) || candidates[0];
    if (!candidate) return false;
    await guard();
    const current = (await json(target.port, '/json/list')).find(t => t.id === candidate.page.id
      && t.url === candidate.page.url && t.webSocketDebuggerUrl === candidate.page.webSocketDebuggerUrl && isStoreGpuPage(t));
    if (!current) return false;
    const state = await candidate.connection.evaluate(stateExpression);
    if (!isStoreGpuState(state, id)) return false;
    chosen = candidate.connection;
    const rebound = chosen !== host;
    if (rebound) host?.close();
    host = chosen; hostTargetId = candidate.page.id;
    if ((report.storeHostSelections?.length || 0) < 32) (report.storeHostSelections ??= []).push({ targetIndex: candidate.targetIndex, rebound, visibleCommittedGpu: true });
    return state;
  } finally { for (const connection of opened) if (connection !== chosen) connection.close(); }
}
async function settle(id) {
  report.substage = 'gpu-host-settle';
  await until(async () => {
    const s = kind === 'store' ? await selectStoreGpuHost(id) : await nativeState();
    return s && s.gpu && s.phase === 'ready' && s.identity === id && s.slots === 1 && s.nativeSlots === 0;
  }, 150000);
}
async function captureGpu(name) {
  await guard(); await focusOwnedHost();
  // Put only our opaque wallpaper above the isolated app while taking the
  // crop. Never save surrounding UI, login fields or conversation contents.
  const previous = await host.evaluate(`(()=>{const root=document.getElementById('codex-wallpaper-bridge-root'),scrim=document.getElementById('codex-wallpaper-bridge-scrim');if(!root)return null;const before={root:root.style.cssText,scrim:scrim?.style.cssText};root.style.setProperty('z-index','2147483647','important');root.style.setProperty('background','#111','important');root.style.setProperty('opacity','1','important');if(scrim)scrim.style.display='none';return before})()`);
  assert.ok(previous);
  try {
  const clip = await host.evaluate(`(()=>{const r=document.querySelector('#codex-wallpaper-bridge-media iframe')?.getBoundingClientRect();if(!r||document.hidden)return null;return {x:Math.max(0,r.x),y:Math.max(0,r.y),width:Math.min(innerWidth,r.right)-Math.max(0,r.x),height:Math.min(innerHeight,r.bottom)-Math.max(0,r.y),scale:1}})()`);
  assert.ok(clip?.width > 0 && clip.height > 0);
  const result = await host.call('Page.captureScreenshot', { format: 'png', clip, fromSurface: true, captureBeyondViewport: false });
  const png = Buffer.from(result.data, 'base64'); await writeFile(path.join(root, name + '.png'), png, { flag: 'wx' });
  return { sha256: createHash('sha256').update(png).digest('hex'), width: clip.width, height: clip.height };
  } finally {
    await host.evaluate(`(()=>{const before=${JSON.stringify(previous)},root=document.getElementById('codex-wallpaper-bridge-root'),scrim=document.getElementById('codex-wallpaper-bridge-scrim');if(root)root.style.cssText=before.root;if(scrim&&before.scrim!==undefined)scrim.style.cssText=before.scrim;return true})()`);
  }
}
async function api(route, body) {
  const response = await fetch(new URL('api/' + route, bridgeUrl), { method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json', Origin: new URL(bridgeUrl).origin },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(150000) });
  if (!response.ok) throw Error('gpu_control_failed'); const data = await response.json();
  if (data.ok === false) throw Error('gpu_control_failed'); return data;
}
async function sceneConnection() {
  await guard();
  const url = await host.evaluate(`document.querySelector('#codex-wallpaper-bridge-media iframe')?.src||null`);
  assert.ok(url && new URL(url).hostname === '127.0.0.1');
  // Different Codex windows intentionally share a source URL. URL equality is
  // not frame ownership: inspect the exact iframe in the selected host DOM.
  const { root } = await host.call('DOM.getDocument', { depth: 0 });
  const { nodeId } = await host.call('DOM.querySelector', { nodeId: root.nodeId, selector: '#codex-wallpaper-bridge-media iframe' });
  assert.ok(nodeId > 0);
  const { node } = await host.call('DOM.describeNode', { nodeId });
  assert.ok(typeof node.frameId === 'string' && node.frameId.length > 0);
  const frame = await until(async () => (await json(target.port, '/json/list')).find(t => t.type === 'iframe' && t.id === node.frameId && t.url === url));
  return connect(frame, target.port);
}
async function select(id) { policy.assertM2TestProject(id); await control.evaluate(`(()=>{const e=document.querySelector('#searchInput');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await until(() => control.evaluate(`Boolean(document.querySelector('.wallpaper-card[data-id="${id}"]'))`)); await click(`.wallpaper-card[data-id="${id}"]`); await settle(id); }
async function targetCensus() {
  const targets = await json(target.port, '/json/list');
  assert.ok(Array.isArray(targets) && targets.length <= 64);
  return targets.map(t => {
    assert.ok(typeof t.id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(t.id));
    let urlClass = 'other';
    try {
      const u = new URL(t.url);
      if (u.protocol === 'app:' && u.hostname === '-') urlClass = /initialRoute=.*(?:avatar|pet|overlay)/i.test(t.url) ? 'auxiliary' : 'codex';
      else if (u.protocol === 'http:' && u.hostname === '127.0.0.1') urlClass = 'loopback';
    } catch {}
    return { idSha256: createHash('sha256').update(t.id).digest('hex'), type: ['page', 'iframe'].includes(t.type) ? t.type : 'other', urlClass };
  });
}
async function apply() {
  restored = false; report.substage = 'apply-identity-guard'; await guard(); await click('#desktopApplyButton');
  report.substage = 'apply-status';
  let observing = applyOnly || remaining;
  const started = Date.now();
  const applyIndex = report.applyAttempts = (report.applyAttempts || 0) + 1;
  const sampling = (async () => {
    let samples = 0;
    while (observing && Date.now() - started < 180000 && samples++ < (restartOnly ? 256 : 32)) {
      try {
        if (restartOnly) {
          (report.applyDiagnostics ??= []).push({ applyIndex, elapsedMs: Date.now() - started, targetCensus: await targetCensus() });
        } else {
          const documents = await readOwnedGpuDocuments({ verifyOwner: guard,
            listTargets: () => json(target.port, '/json/list'), connect: t => connect(t, target.port) });
          (report.applyDiagnostics ??= []).push({ applyIndex, elapsedMs: Date.now() - started, documents });
        }
        await progress();
      } catch { report.applyDiagnosticUnavailable = true; break; }
      if (observing) await pause(restartOnly ? 250 : 1000);
    }
  })();
  try {
    const tone = await until(() => control.evaluate(`(()=>{const t=document.querySelector('#desktopApplyStatus')?.dataset.tone;return ['success','error'].includes(t)?t:null})()`), 160000);
    report.lastApplyTone = tone; if (tone !== 'success') throw Error('desktop_apply_failed');
  } finally { observing = false; await sampling; if (restartOnly) await guard(); }
}
async function minimizeOwnedPeer() {
  await guard();
  const pages = (await json(target.port, '/json/list')).filter(t => t.type === 'page'
    && String(t.url).startsWith('app://-') && !/avatar|pet|overlay/i.test(t.url)).slice(0, 8);
  assert.ok(pages.length >= 2);
  const candidates = await Promise.all(pages.map(async t => ({ connection: await connect(t, target.port), targetId: t.id, wasVisible: false })));
  try {
    for (const candidate of candidates) candidate.wasVisible = await candidate.connection.evaluate('document.hidden===false');
    const result = await exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(workspace, 'scripts', 'restore-m2-owned-window.ps1'), '-TargetFile', path.join(root, 'target.json'), '-WindowAction', 'minimize'],
      { windowsHide: true, timeout: 15000, maxBuffer: 16384 });
    const metadata = JSON.parse(result.stdout); assert.equal(metadata.identityVerified, true); assert.equal(metadata.minimized, true);
    assert.ok(Number.isSafeInteger(metadata.windowHandle) && metadata.windowHandle > 0);
    minimizedWindowHandle = metadata.windowHandle;
    await until(async () => {
      for (const candidate of candidates) candidate.hidden = await candidate.connection.evaluate('document.hidden===true');
      return candidates.some(c => c.wasVisible && c.hidden) && candidates.some(c => !c.hidden);
    }, 5000);
    const selected = candidates.find(c => !c.hidden);
    host = selected.connection; hostTargetId = selected.targetId;
    report.hiddenPeer = { nativeWindowMinimized: true, documentHiddenVerified: true, selectedRemainsVisible: true };
  } finally { for (const candidate of candidates) if (candidate.connection !== host) candidate.connection.close(); }
}
async function waitForRestoreDocument(sceneUrl) {
  return until(async () => {
    let state;
    try { state = await host.evaluate(`({root:!!document.getElementById('codex-wallpaper-bridge-root'),
      fresh:globalThis.__cwbOwnedRestoreGeneration!==true,
      ready:location.origin==='app://-'&&!!document.body&&['interactive','complete'].includes(document.readyState)})`); }
    catch { report.restoreReadinessErrors = Math.min(1000, (report.restoreReadinessErrors || 0) + 1); return false; }
    return state?.ready === true && state.root === false && (!sceneUrl || state.fresh === true) ? state : false;
  }, 30000);
}
async function restore() {
  await guard();
  const sceneUrl = await host.evaluate(`document.querySelector('#codex-wallpaper-bridge-media iframe')?.src||null`);
  await host.evaluate('globalThis.__cwbOwnedRestoreGeneration=true');
  await click('#desktopRestoreButton');
  const tone = await until(() => control.evaluate(`(()=>{const t=document.querySelector('#desktopApplyStatus')?.dataset.tone;return !document.querySelector('#desktopRestoreButton')?.disabled&&['success','error'].includes(t)?t:null})()`));
  if (tone !== 'success') throw Error('desktop_restore_failed');
  report.substage = 'restore-document-readiness';
  const documentState = await waitForRestoreDocument(sceneUrl); restored = true;
  if (sceneUrl) {
    assert.equal(new URL(sceneUrl).hostname, '127.0.0.1');
    report.substage = 'restore-effective-csp';
    const freshDocument = documentState.fresh;
    const frameBlocked = await host.evaluate(`new Promise(resolve=>{const frame=document.createElement('iframe');frame.sandbox='allow-scripts allow-same-origin';frame.style.cssText='position:fixed;width:1px;height:1px;left:0;top:0;border:0';let done=false;const finish=value=>{if(done)return;done=true;clearTimeout(timer);removeEventListener('securitypolicyviolation',onPolicy);frame.remove();resolve(value)};const onPolicy=event=>{if(event.effectiveDirective==='frame-src'&&event.blockedURI.startsWith(${JSON.stringify(new URL(sceneUrl).origin)}))finish(true)};addEventListener('securitypolicyviolation',onPolicy);const timer=setTimeout(()=>finish(false),3000);document.body.append(frame);frame.src=${JSON.stringify(sceneUrl)}})`);
    (report.cspRestoreChecks ??= []).push({ freshDocument, frameBlocked });
    assert.equal(freshDocument, true); assert.equal(frameBlocked, true);
  }
}
async function focusOwnedHost() {
  try { await exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(workspace, 'scripts', 'restore-m2-owned-window.ps1'), '-TargetFile', path.join(root, 'target.json'),
    ...(minimizedWindowHandle ? ['-OwnedWindowHandle', String(minimizedWindowHandle)] : [])], { windowsHide: true, timeout: 15000, maxBuffer: 16384 }); }
  catch (error) {
    try { const data = JSON.parse(error.stdout); const stages = ['path-check', 'target-identity', 'process-identity', 'listener-identity', 'native-process-handle', 'native-api-load', 'native-window-handle', 'native-window-restore']; report.windowRestoreFailure = { stage: stages.includes(data.stage) ? data.stage : 'unknown' }; } catch {}
    throw Error('owned_window_restore_failed');
  }
}
async function closeOwned(owned, connection) {
  if (!owned || owned.exited) return;
  try { await connection?.call('Browser.close'); } catch {}
  try { await until(() => owned.exited, 20000); } catch {}
  if (!owned.exited && owned.identity) {
    const current = await identity(owned.child.pid); if (!current || JSON.stringify(current) !== JSON.stringify(owned.identity)) throw Error('process_identity_changed');
    const expected = owned.identity; const expectedExe = expected.exe.replaceAll("'", "''"); const expectedTime = expected.creation.replaceAll("'", "''");
    await shell(`$p=Get-CimInstance Win32_Process -Filter 'ProcessId=${expected.pid}';if(-not $p){'true';exit};if($p.ExecutablePath -ne '${expectedExe}' -or $p.CreationDate.ToUniversalTime().ToString('o') -ne '${expectedTime}'){throw 'identity'};$n=Get-Process -Id ${expected.pid};$t=$n.StartTime.ToUniversalTime().Ticks;if(($t-($t%10)) -ne $p.CreationDate.ToUniversalTime().Ticks){throw 'native identity'};Stop-Process -InputObject $n -Force;'true'`);
    report.forcedOwnedStops ??= []; report.forcedOwnedStops.push(owned.label);
    await until(() => owned.exited, 5000);
  }
}

async function launchDesktop(label = 'desktop') {
  const desktop = start(require('electron'), [desktopBootstrap, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${report.desktopPort}`], desktopEnv, label);
  desktop.identity = await until(() => identity(desktop.child.pid)); currentDesktop = desktop; report.desktopIdentity = desktop.identity;
  const page = await until(async () => { try { return (await json(report.desktopPort, '/json/list')).find(t => t.type === 'page' && t.url === 'cwb-desktop://shell/index.html'); } catch { return null; } });
  main = await connect(page, report.desktopPort);
  bridgeUrl = await until(() => main.evaluate('document.querySelector("#controlFrame")?.src||null'));
  const address = new URL(bridgeUrl); if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1') throw Error('invalid_control_service');
  report.controlPort = Number(address.port);
  const frame = await until(async () => (await json(report.desktopPort, '/json/list')).find(t => t.type === 'iframe' && t.url === bridgeUrl)); control = await connect(frame, report.desktopPort);
  await until(() => control.evaluate('document.documentElement.dataset.cwbDesktopEmbedded==="true" && !document.querySelector("#desktopApplyButton").disabled'));
  const runtime = JSON.parse((await readFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'runtime.json'), 'utf8')).replace(/^\uFEFF/, ''));
  utilityIdentity = await identity(runtime.pid); assert.ok(utilityIdentity); report.utilityIdentity = utilityIdentity;
  (report.utilityIdentities ??= []).push(utilityIdentity);
  assert.equal(runtime.nativeEngineProviderConfigured, true); assert.equal(runtime.injectorActive, false);
  return desktop;
}

async function restartDesktop() {
  const before = { desktop: currentDesktop.identity, utility: utilityIdentity };
  if (restartOnly) report.restartTargetsBefore = await targetCensus();
  await restore(); await closeOwned(currentDesktop, main);
  assert.ok(!report.forcedOwnedStops?.includes(currentDesktop.label), 'desktop_restart_was_forced');
  await until(async () => { const current = await identity(before.utility.pid); return !current || current.creation !== before.utility.creation; }, 15000);
  main.close(); control.close(); main = null; control = null;
  report.desktopPort = await freePort(); await launchDesktop('desktop-restart');
  assert.notEqual(currentDesktop.identity.creation, before.desktop.creation);
  assert.notEqual(utilityIdentity.creation, before.utility.creation);
  const restart = { desktopChanged: true, utilityChanged: true, samePrivateProfile: true, naturalDesktopExit: true };
  if (report.authorProperties) report.authorProperties.restart = restart;
  else report.workbenchRestart = restart;
  if (restartOnly) report.restartTargetsAfter = await targetCensus();
}

try {
  report.productSourcesVerifiedBefore = await verifyIsolatedProduct();
  report.verifierSha256 = await hash(fileURLToPath(import.meta.url));
  await writeFile(path.join(root, 'verifier-source.mjs'), await readFile(fileURLToPath(import.meta.url)), { flag: 'wx' });
  report.diagnosticsSha256 = await hash(fileURLToPath(new URL('./m2-gpu-diagnostics.mjs', import.meta.url)));
  await writeFile(path.join(root, 'gpu-diagnostics-source.mjs'), await readFile(new URL('./m2-gpu-diagnostics.mjs', import.meta.url)), { flag: 'wx' });
  if (remaining) for (const name of ['m2-gpu-remaining-checks.mjs', 'm2-gpu-resource-sampler.mjs']) {
    (report.additionalVerifierSources ??= {})[name] = await hash(fileURLToPath(new URL(name, import.meta.url)));
    await writeFile(path.join(root, name), await readFile(new URL(name, import.meta.url)), { flag: 'wx' });
  }
  compiledRoot = path.join(root, 'compiled-snapshot');
  compiledProof = await freezeCompiledBuild({ workspace, root, snapshot: compiledRoot });
  report.compiledSnapshot = { sha256: compiledProof.sha256, files: compiledProof.files };
  await writeFile(path.join(root, 'compiled-proof.json'), JSON.stringify(compiledProof, null, 2), { flag: 'wx' });
  await step('fresh owned Codex and actual compiled desktop, identity-verified before access', async () => {
    installation = (await detectInstallations()).find(item => item.kind === kind); assert.ok(installation);
    report.dailyHashBefore = await hash(dailyFile); report.compiledHashesBefore = await hashes(); report.runtimeHashesBefore = await runtimeHashes();
    report.protectedBefore = await shell(`@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type='} | ForEach-Object {[pscustomobject]@{pid=$_.ProcessId;exe=$_.ExecutablePath;creation=$_.CreationDate.ToUniversalTime().ToString('o')}})|ConvertTo-Json -Compress`);
    await writeFile(path.join(root, 'protected-chat.json'), JSON.stringify(Array.isArray(report.protectedBefore) ? report.protectedBefore : report.protectedBefore ? [report.protectedBefore] : []), { flag: 'wx' });
    const store = new ConfigStore({ filePath: dailyFile }); await store.load(); const config = store.get();
    const inventory = await scanWallpaperProjects(); const initial = inventory.projects.find(p => p.id === '1778944028' && p.type === 'scene'); assert.ok(initial); policy.assertM2TestProject(initial); policy.assertM2TestRoot(initial.rootPath);
    const other = inventory.projects.find(p => p.id === '3444535389' && p.type === 'scene' && projectPolicy(p, config).eligible); assert.ok(other); policy.assertM2TestProject(other); policy.assertM2TestRoot(other.rootPath);
    report.sampleIds = [initial.id, other.id];
    report.protectedSampleIds = remaining ? GPU_REMAINING_SAMPLES.map(sample => sample.id) : report.sampleIds;
    report.manifestHashesBefore = await Promise.all(report.protectedSampleIds.map(id => {
      const project = inventory.projects.find(p => p.id === id && projectPolicy(p, config).eligible); assert.ok(project);
      policy.assertM2TestProject(project); policy.assertM2TestRoot(project.rootPath);
      return hash(path.join(project.rootPath, 'project.json'));
    }));
    const hostPort = await freePort(), desktopPort = await freePort(); assert.notEqual(hostPort, desktopPort); report.hostPort = hostPort; report.desktopPort = desktopPort;
    const profile = path.join(root, 'host-profile'); await mkdir(profile);
    const env = { ...process.env }; for (const key of ['ELECTRON_RUN_AS_NODE', 'CWB_ACCEPTANCE_ROOT', 'CWB_NATIVE_ENGINE_PROVIDER', 'CWB_BRIDGE_CLI', 'NODE_OPTIONS']) delete env[key];
    env.CWB_SCENE_RENDERER = 'gpu';
    const codex = start(installation.path, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${hostPort}`, `--user-data-dir=${profile}`], env, 'codex');
    codex.identity = await until(() => identity(codex.child.pid)); target = { ...codex.identity, port: hostPort, profile };
    report.target = target; await writeFile(path.join(root, 'target.json'), JSON.stringify(target), { flag: 'wx' });
    await until(async () => { try { await guard(); return true; } catch { return false; } }); await guard();
    const pages = (await json(hostPort, '/json/list')).filter(t => t.type === 'page' && !/avatar|overlay|devtools/.test(t.url)); if (!pages.length) throw Error('codex_page_unavailable'); host = await connect(pages[0], hostPort); hostTargetId = pages[0].id;
    report.initialCodexVisibility = await host.evaluate('({hidden:document.hidden,ready:document.readyState==="complete",width:innerWidth,height:innerHeight,hasRoot:!!document.getElementById("root")})');
    if (visibleHost) await focusOwnedHost();
    await mkdir(path.join(root, 'desktop-user-data')); await mkdir(path.join(root, 'bridge-state', 'CodexWallpaperBridge'), { recursive: true });
    await writeFile(path.join(root, 'desktop-user-data', 'settings.json'), JSON.stringify({ manualExecutables: [installation.path], selectedId: installation.id, port: hostPort, adaptive: true }), { flag: 'wx' });
    await writeFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'config.json'), JSON.stringify({ ...config, selectedId: initial.id,
      authorProperties: { [initial.id]: config.authorProperties[initial.id] ?? {} }, library: { ...config.library, hiddenIds: [...new Set([...(config.library?.hiddenIds ?? []), ...policy.EXCLUDED_M2_TEST_IDS])] },
      effects: { ...config.effects, audioEnabled: false, volume: 0, playing: true } }), { flag: 'wx' });
    const bootstrap = path.join(root, 'frozen-desktop.cjs');
    await writeFile(bootstrap, `require('electron').app.setAppPath(${JSON.stringify(workspace)}); void import(${JSON.stringify(pathToFileURL(path.join(compiledRoot, 'main.mjs')).href)});`, { flag: 'wx' });
    desktopBootstrap = bootstrap; desktopEnv = { ...env, CWB_ACCEPTANCE_ROOT: root, ...(remaining ? { CWB_M2_GPU_DIAGNOSTICS: '1' } : {}) };
    await launchDesktop();
  });
  if (minimizePeer) await step('minimize only an owned window and retain a visible peer for GPU initialization', minimizeOwnedPeer);
  await step('real Apply initializes default GPU Scene without VP8 slots', async () => { await apply(); await settle(report.sampleIds[0]); report.initialGpuState = await nativeState(); });
  if (restartOnly) await step('real workbench and utility restart after complete GPU Restore', restartDesktop);
  if (restartOnly) await step('real post-restart Apply renders the same GPU Scene', async () => {
    await apply(); await settle(report.sampleIds[0]); await gpuStatus(report.sampleIds[0]);
    report.postRestartGpuState = await nativeState();
    const frame = await sceneConnection();
    try {
      const before = await frame.evaluate('window.__cwbScene?.renderCompletions');
      await until(async () => await frame.evaluate('window.__cwbScene?.renderCompletions') > before, 10000);
      report.workbenchRestart.actualGpuRendering = true;
    } finally { frame.close(); }
  });
  if (minimizePeer) await step('hidden GPU peer stays untouched then initializes real frames after exact native restore', async () => {
    const read = () => readOwnedGpuDocuments({ verifyOwner: guard, listTargets: () => json(target.port, '/json/list'), connect: t => connect(t, target.port) });
    report.hiddenBeforeReveal = await read();
    assert.ok(report.hiddenBeforeReveal.some(o => o.document?.hidden && !o.document.runtimeReady && !o.document.root && o.document.frameCount === 0));
    await focusOwnedHost();
    await until(async () => {
      const documents = await read(); report.afterReveal = documents;
      return documents.length >= 2 && documents.every(o => o.available && o.document?.runtimeReady && !o.document.hidden
        && o.document.mediaState === 'ready' && o.scenes.length === 1 && o.scenes.every(s => s.phase === 'ready' && s.draws > 0 && s.renderCompletions > 0));
    }, 60000);
  });
  if (!controlsOnly) await step('actual Scene render completions and cropped host pixels advance', async () => {
    await focusOwnedHost(); const scene = await sceneConnection();
    const read = () => scene.evaluate('({time:performance.now(),completions:window.__cwbScene?.renderCompletions,draws:window.__cwbScene?.draws,width:document.querySelector("canvas")?.width,height:document.querySelector("canvas")?.height,hidden:document.hidden,paused:window.__cwbScene?.paused})');
    const before = await read(); assert.equal(before.hidden, false); assert.equal(before.paused, false);
    const first = await captureGpu('gpu-first'); await pause(3000); const last = await captureGpu('gpu-after'); const after = await read();
    assert.ok(after.completions > before.completions && after.draws > before.draws); assert.notEqual(first.sha256, last.sha256);
    report.gpuMotion = { before, after, first, last, rendererCompletedFps: (after.completions - before.completions) * 1000 / (after.time - before.time), physicalScreenFps: null, includesScreenshotTime: true };
  });
  if (!applyOnly && !restartOnly && !authorOnly && !webOnly && (!pointerOnly || afterControls)) await step('real Scene selections leave one M1 slot in the selected document and bounded shared GPU sources', async () => {
    for (let i = 0; i < (controlsOnly ? 1 : 2); i++) { await select(report.sampleIds[1]); await select(report.sampleIds[0]); }
    report.afterSwitch = await nativeState(); await gpuStatus(report.sampleIds[0]);
  });
  if (!applyOnly && !restartOnly && !authorOnly && !webOnly && (!pointerOnly || afterControls)) await step('GPU pause freezes actual scene draws and resume preserves user intent', async () => {
    const scene = await sceneConnection(); await api('config', { effects: { playing: false } });
    await until(() => scene.evaluate('window.__cwbScene?.paused===true'));
    const first = await scene.evaluate('window.__cwbScene.renderCompletions'); await pause(700);
    assert.equal(await scene.evaluate('window.__cwbScene.renderCompletions'), first);
    await api('config', { effects: { playing: true } });
    await until(async () => await scene.evaluate('window.__cwbScene.renderCompletions') > first);
    report.pauseResume = { frozenCompletions: first, resumed: true };
  });
  if (!applyOnly && !restartOnly && !authorOnly && !webOnly && !skipPointer) await step('real host mouse move down up reaches the GPU Scene without capturing app controls', async () => {
    await guard(); await focusOwnedHost(); const scene = await sceneConnection();
    report.substage = 'pointer-before';
    const read = () => scene.evaluate(`(()=>{const p=window.__pointerStats?.(),s=window.__cwbScene;return {counts:p?.counts,leftDown:p?.leftDown,phase:s?.phase,paused:s?.paused,pointerAccepted:s?.pointerAccepted,pointerDelivered:s?.pointerDelivered,pointerAcknowledged:s?.pointerAcknowledged,pendingPointers:s?.pendingPointers}})()`);
    const before = await read(); assert.ok(before?.counts);
    report.pointer = { before, nativeInput: true };
    report.pointer.hostBefore = await nativeState();
    report.pointer.gpuBefore = (await api('action', { action: 'engine-status' })).engine;
    await host.evaluate(`(()=>{const counts={capture:{},bubble:{}};const handlers=[];for(const phase of ['capture','bubble'])for(const type of ['pointermove','pointerdown','pointerup']){const fn=()=>counts[phase][type]=(counts[phase][type]||0)+1;window.addEventListener(type,fn,{capture:phase==='capture',passive:true});handlers.push({type,fn,capture:phase==='capture'})}window.__cwbOwnedPointerProbe={counts,close(){for(const h of handlers)window.removeEventListener(h.type,h.fn,h.capture);delete window.__cwbOwnedPointerProbe}};return true})()`);
    try {
    const point = await host.evaluate(`(()=>{for(const u of [.15,.45,.75])for(const v of [.25,.5,.75]){const x=innerWidth*u,y=innerHeight*v,e=document.elementFromPoint(x,y);if(e&&!e.closest('button,input,select,textarea,a,summary,[role="button"],[contenteditable]'))return{x,y}}return null})()`);
    assert.ok(point);
    report.substage = 'pointer-dispatch';
    await host.call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...point, buttons: 0 });
    await host.call('Input.dispatchMouseEvent', { type: 'mousePressed', ...point, button: 'left', buttons: 1, clickCount: 1 });
    await host.call('Input.dispatchMouseEvent', { type: 'mouseReleased', ...point, button: 'left', buttons: 0, clickCount: 1 });
    report.substage = 'pointer-consumption';
    const after = await until(async () => { const value = await read(); report.pointer.after = value; return value?.counts.down > before.counts.down && value.counts.up > before.counts.up ? value : false; }, 10000);
    assert.equal(after.leftDown, false);
    } finally {
      await pause(1100); report.pointer.gpuAfter = (await api('action', { action: 'engine-status' })).engine;
      report.pointer.after = await read().catch(() => null);
      report.pointer.hostEvents = await host.evaluate('window.__cwbOwnedPointerProbe?.counts').catch(() => null);
      await host.evaluate('window.__cwbOwnedPointerProbe?.close()').catch(() => {});
    }
  }).catch(() => {}); // Keep failed evidence, but still exercise independent author/restore gaps.
  if (!applyOnly && !restartOnly && !webOnly && !pointerOnly) await step('GPU author five typed UI controls persist and read back from the actual Codex Scene', async () => {
    await select(report.sampleIds[1]);
    const route = 'author-properties/' + report.sampleIds[1]; let state = await api(route);
    const expectedValues = new Map();
    report.authorProperties = { types: [], input: 'native-ui', uiVerified: false, nativeReadback: false };
    await control.evaluate(`(()=>{document.querySelector('#authorPropertiesPanel').open=true;return true})()`);
    for (const type of ['bool', 'slider', 'combo', 'color', 'textinput']) {
      const entry = Object.entries(state.schema).find(([, spec]) => spec.type === type && (type !== 'slider' || spec.min < spec.max));
      assert.ok(entry, 'gpu_author_sample_has_no_supported_controls');
      const [key, spec] = entry;
      const row = `.author-property-row[data-author-property="${key}"]`, selector = row + (type === 'combo' ? ' select' : ' input');
      report.substage = 'author-' + type;
      await until(() => control.evaluate(`document.querySelector(${JSON.stringify(selector)})?.disabled===false`));
      let value;
      if (type === 'bool') { value = !state.values[key]; await click(selector); }
      else if (type === 'combo') {
        const index = spec.options.findIndex(option => option.value === state.values[key]);
        const next = index === 0 ? 1 : 0; assert.ok(spec.options[next]); value = spec.options[next].value;
        await click(selector);
        for (const key of ['Home', ...(next ? ['ArrowDown'] : []), 'Enter', 'Tab']) {
          for (const event of ['rawKeyDown', 'keyUp']) await main.call('Input.dispatchKeyEvent', { type: event, key, code: key,
            windowsVirtualKeyCode: { Home: 36, ArrowDown: 40, Enter: 13, Tab: 9 }[key] });
        }
      } else {
        value = type === 'slider' ? state.values[key] === spec.min ? spec.max : spec.min : type === 'textinput' ? 'GPU M2 UI check' : null;
        if (type === 'color') {
          const channels = String(state.values[key]).split(/\s+/).map(Number); channels[0] = channels[0] === .25 ? .75 : .25;
          value = channels.join(' '); await inputText(selector, channels[0]);
        } else await inputText(selector, value);
      }
      state = await until(async () => { const actual = await api(route); return actual.values[key] === value && actual.live?.values?.[key] === value ? actual : false; }, 20000);
      assert.equal(state.live.phase, 'ready'); assert.equal(state.live.method, 'engine-readback'); assert.equal(state.live.values[key], value);
      report.authorProperties.lastReadback = { phase: state.live.phase, method: state.live.method, source: state.live.source || null };
      assert.equal(state.live.source, 'codex-gpu');
      const disk = JSON.parse(await readFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'config.json'), 'utf8'));
      assert.equal(disk.authorProperties[report.sampleIds[1]][key], value);
      report.authorProperties.types.push(type);
      expectedValues.set(key, { type, value, ...(type === 'combo' ? { options: spec.options } : {}) });
    }
    report.authorProperties.uiVerified = true; report.authorProperties.nativeReadback = true;
    if (remaining) {
      report.substage = 'author-restart-real-workbench-utility'; await restartDesktop();
      const loaded = await api(route);
      for (const [key, spec] of expectedValues) assert.equal(loaded.values[key], spec.value);
      await apply(); await settle(report.sampleIds[1]); await gpuStatus(report.sampleIds[1]);
      state = await until(async () => { const actual = await api(route); return actual.live?.phase === 'ready'
        && actual.live.source === 'codex-gpu' && [...expectedValues].every(([key, spec]) => actual.live.values[key] === spec.value) ? actual : false; }, 20000);
      report.authorProperties.restart.actualGpuValues = true;
      report.authorProperties.restart.uiTypesVerified = [];
      await control.evaluate('document.querySelector("#authorPropertiesPanel").open=true');
      for (const [key, spec] of expectedValues) {
        report.substage = 'author-restart-ui-' + spec.type;
        const row = `.author-property-row[data-author-property="${key}"]`;
        const actual = await until(() => control.evaluate(authorUiReadExpression(row, spec)));
        assert.equal(actual.value, spec.value);
        report.authorProperties.restart.uiTypesVerified.push(spec.type);
      }
      report.authorProperties.restart.uiRestored = true;
    }
    await until(() => control.evaluate(`document.querySelector('[data-author-reset]')?.disabled===false`));
    await click('[data-author-reset]');
    state = await until(async () => { const actual = await api(route); return JSON.stringify(actual.values) === JSON.stringify(actual.defaults) ? actual : false; });
    assert.deepEqual(state.live.values, state.defaults); report.authorProperties.resetVerified = true;
    await select(report.sampleIds[0]); await gpuStatus(report.sampleIds[0]);
  }).catch(() => {});
  let resourceOrdinal = 0;
  if (remaining && !authorOnly && !restartOnly) await runGpuRemainingSamples({ report, webOnly, step, select, api, sceneConnection, host: () => host,
    nativeState, gpuStatus, captureGpu, pause, until, guard, focusOwnedHost, progress,
    async sampleResources() {
      const snapshot = await readOwnedGpuResources([target, currentDesktop.identity]);
      const name = `gpu-resource-${String(resourceOrdinal++).padStart(3, '0')}.json`;
      await writeFile(path.join(root, name), JSON.stringify(snapshot, null, 2), { flag: 'wx' });
      report.resourceSoak.rawFiles.push(name); return snapshot;
    } });
  if (!applyOnly && !restartOnly && !authorOnly && !webOnly && !pointerOnly) await step('real Restore and Apply release and recreate GPU document and sources', async () => { await select(report.sampleIds[0]); await restore(); await apply(); await settle(report.sampleIds[0]); report.afterReapply = await nativeState(); });
  await step('real Restore removes Codex runtime and wallpaper DOM', restore);
  report.outcome = report.steps.every(item => item.status === 'pass') ? 'pass' : 'fail';
} catch (error) { report.outcome = 'fail'; report.failure = category(error); }
finally {
  if (main && control && host && !restored) { try { await restore(); report.restoredDuringCleanup = true; } catch { report.cleanupRestoreFailed = true; } }
  for (const desktop of processes.filter(p => p.label.startsWith('desktop')).reverse()) {
    try { await closeOwned(desktop, main); } catch { report.desktopCleanupFailed = true; }
  }
  try { await closeOwned(processes.find(p => p.label === 'codex'), host); } catch { report.codexCleanupFailed = true; }
  for (const c of connections) c.close();
  if (compiledProof) { try { report.compiledSnapshotVerifiedAfter = await verifyCompiledSnapshot(compiledRoot, compiledProof); } catch { report.compiledSnapshotVerifiedAfter = false; report.outcome = 'fail'; } }
  try { report.productSourcesVerifiedAfter = await verifyIsolatedProduct(); } catch { report.productSourcesVerifiedAfter = false; report.outcome = 'fail'; }
  report.processes = processes.map(p => ({ label: p.label, pid: p.child.pid, identity: p.identity, exited: p.exited, exitCode: p.exitCode, stderrBytes: p.stderrBytes }));
  if (utilityIdentity) { const after = await identity(utilityIdentity.pid).catch(() => undefined); report.utilityExited = after === null || Boolean(after && after.creation !== utilityIdentity.creation); }
  try { report.dailyHashAfter = await hash(dailyFile); report.dailyUnchanged = report.dailyHashBefore === report.dailyHashAfter; report.compiledHashesAfter = await hashes(); report.sameCompiledBuild = JSON.stringify(report.compiledHashesBefore) === JSON.stringify(report.compiledHashesAfter); report.runtimeHashesAfter = await runtimeHashes(); report.sameRuntimeSources = JSON.stringify(report.runtimeHashesBefore) === JSON.stringify(report.runtimeHashesAfter);
    const protectedList = Array.isArray(report.protectedBefore) ? report.protectedBefore : report.protectedBefore ? [report.protectedBefore] : []; report.protectedChatsPreserved = true;
    for (const item of protectedList) { const current = await identity(item.pid); if (!current || current.exe !== item.exe || current.creation !== item.creation) report.protectedChatsPreserved = false; }
    if (report.sampleIds) { const inventory = await scanWallpaperProjects(); report.manifestHashesAfter = await Promise.all(report.protectedSampleIds.map(id => hash(path.join(inventory.projects.find(p => p.id === id).rootPath, 'project.json')))); report.manifestsUnchanged = JSON.stringify(report.manifestHashesBefore) === JSON.stringify(report.manifestHashesAfter); }
  } catch { report.independentVerificationFailed = true; }
  try { const log = await readFile(path.join(root, 'desktop-logs', `codex-wallpaper-${report.startedAt.slice(0, 10)}.log`), 'utf8'); report.nativeFrameErrors = [...log.matchAll(/native-frame-error[^\r\n]*?(\{[^\r\n]+\})/g)].slice(0, 8).map(m => { try { const f = JSON.parse(m[1]); return { stage: ['ready', 'health', 'state', 'control', 'capture', 'accept'].includes(f.stage) ? f.stage : 'unknown', reason: ['operation-failed', 'failed', 'decode', 'invalid-frame', 'receiver-failed'].includes(f.reason) ? f.reason : 'unknown' }; } catch { return { stage: 'unknown', reason: 'unknown' }; } }); } catch {}
  report.resourcesClosed = processes.every(p => p.exited) && report.utilityExited === true && !report.forcedOwnedStops?.length;
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ evidence: root, outcome: report.outcome, failure: report.failure, steps: report.steps.length,
    resourcesClosed: report.resourcesClosed, dailyUnchanged: report.dailyUnchanged, protectedChatsPreserved: report.protectedChatsPreserved, nativeFrameErrors: report.nativeFrameErrors }));
  process.exitCode = report.outcome === 'pass' && report.resourcesClosed && report.sameCompiledBuild && report.sameRuntimeSources && report.dailyUnchanged && report.protectedChatsPreserved && report.manifestsUnchanged ? 0 : 1;
}
