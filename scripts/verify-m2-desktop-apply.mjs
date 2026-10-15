// Actual compiled desktop UI -> owned UtilityProcess -> independently owned Codex.
// No alternate native factory, source injection, daily config writes or CSP bypass.
import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, readFile, realpath, lstat, readdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { CdpConnection } from './verify-live-host.mjs';
import { detectInstallations } from '../src/installations.mjs';
import { verifyCdpEndpointOwner } from '../src/cdp-owner.mjs';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { scanWallpaperProjects } from '../bridge-runtime/src/scanner.mjs';
import { projectPolicy } from '../bridge-runtime/src/library-policy.mjs';
import policy from './m2-test-policy.cjs';

const workspace = await realpath(fileURLToPath(new URL('..', import.meta.url)));
const kind = process.argv[2]; assert.ok(['store', 'local'].includes(kind));
const visibleHost = process.argv.includes('--visible');
const base = await realpath(path.join(workspace, 'out', 'live-acceptance'));
assert.equal((await lstat(base)).isSymbolicLink(), false);
const root = path.join(base, `m2-desktop-apply-${kind}-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomBytes(4).toString('hex')}`);
await mkdir(root); assert.ok((await realpath(root)).startsWith(base + path.sep));
const report = { startedAt: new Date().toISOString(), scope: 'actual-compiled-desktop-ui-to-real-codex-native', kind,
  dailyConfigurationTouched: false, officialCspModified: false, completeM0Gate: false, releaseExeGenerated: false,
  audioEnabled: false, visibleHostRequested: visibleHost, steps: [], evidence: root };
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
let target, installation, main, control, host, bridgeUrl, utilityIdentity, restored = false;
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
async function connect(t, port) { const c = new CdpConnection(t.webSocketDebuggerUrl, port); await c.connect(); connections.push(c); return c; }
function start(exe, args, env, label) { const child = spawn(exe, args, { cwd: workspace, env, windowsHide: !(label === 'codex' && visibleHost), stdio: ['ignore', 'pipe', 'pipe'] }); const owned = { child, label, exited: false, exitCode: null, stderrBytes: 0 }; processes.push(owned); child.stdout.on('data', () => {}); child.stderr.on('data', bytes => { owned.stderrBytes += bytes.length; }); child.once('error', () => { owned.exited = true; }); child.once('exit', code => { owned.exited = true; owned.exitCode = code; }); return owned; }
async function step(name, fn) { report.currentStep = name; await progress(); const started = Date.now(); try { await fn(); report.steps.push({ name, status: 'pass', elapsedMs: Date.now() - started }); } catch (error) { report.steps.push({ name, status: 'fail', category: category(error), elapsedMs: Date.now() - started }); throw error; } finally { await progress(); } }
async function click(selector) {
  const offset = await main.evaluate('(()=>{const r=document.querySelector("#controlFrame").getBoundingClientRect();return {x:r.x,y:r.y}})()');
  const p = await control.evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled)throw Error('control_not_actionable');e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);return {x,y,hit:hit===e||e.contains(hit)}})()`);
  if (!p.hit) throw Error('control_hit_test_failed');
  for (const type of ['mousePressed', 'mouseReleased']) await main.call('Input.dispatchMouseEvent', { type, x: p.x + offset.x, y: p.y + offset.y, button: 'left', clickCount: 1 });
}
const stateExpression = `(()=>{const node=document.getElementById('codex-wallpaper-bridge-media'),r=globalThis.__codexWallpaperBridgeRuntime;let id=null;try{id=JSON.parse(r?.status().switch.identity||'null')?.[0]}catch{}return {ready:r?.ready===true,native:!!node?.dataset.cwbNative,sequence:Number(node?.dataset.cwbSequence||0),slots:r?.status().switch.slots||0,identity:/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(id)?id:null,hidden:document.hidden,root:!!document.getElementById('codex-wallpaper-bridge-root')}})()`;
async function nativeState() { return host.evaluate(stateExpression); }
async function settle(id) { await until(async () => { const s = await nativeState(); return s.native && s.sequence > 0 && s.identity === id && s.slots === 1; }); }
async function canvasSample() { return host.evaluate(`(()=>{const c=document.getElementById('codex-wallpaper-bridge-media')?.querySelector('canvas');if(!c)return null;const b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;let h=2166136261;for(const n of b)h=Math.imul(h^n,16777619);return {hash:h>>>0,width:c.width,height:c.height}})()`); }
async function select(id) { policy.assertM2TestProject(id); await control.evaluate(`(()=>{const e=document.querySelector('#searchInput');e.value=${JSON.stringify(id)};e.dispatchEvent(new Event('input',{bubbles:true}));return true})()`); await until(() => control.evaluate(`Boolean(document.querySelector('.wallpaper-card[data-id="${id}"]'))`)); await click(`.wallpaper-card[data-id="${id}"]`); await settle(id); }
async function apply() { await guard(); await click('#desktopApplyButton'); const tone = await until(() => control.evaluate(`(()=>{const t=document.querySelector('#desktopApplyStatus')?.dataset.tone;return ['success','error'].includes(t)?t:null})()`)); report.lastApplyTone = tone; if (tone !== 'success') throw Error('desktop_apply_failed'); }
async function restore() { await guard(); await click('#desktopRestoreButton'); const tone = await until(() => control.evaluate(`(()=>{const t=document.querySelector('#desktopApplyStatus')?.dataset.tone;return ['success','error'].includes(t)?t:null})()`)); if (tone !== 'success') throw Error('desktop_restore_failed'); await until(async () => !(await nativeState()).root); restored = true; }
async function focusOwnedHost() {
  try { await exec(ps, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(workspace, 'scripts', 'restore-m2-owned-window.ps1'), '-TargetFile', path.join(root, 'target.json')], { windowsHide: true, timeout: 15000, maxBuffer: 16384 }); }
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

try {
  await step('fresh owned Codex and actual compiled desktop, identity-verified before access', async () => {
    installation = (await detectInstallations()).find(item => item.kind === kind); assert.ok(installation);
    report.dailyHashBefore = await hash(dailyFile); report.compiledHashesBefore = await hashes(); report.runtimeHashesBefore = await runtimeHashes();
    report.protectedBefore = await shell(`@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type='} | ForEach-Object {[pscustomobject]@{pid=$_.ProcessId;exe=$_.ExecutablePath;creation=$_.CreationDate.ToUniversalTime().ToString('o')}})|ConvertTo-Json -Compress`);
    await writeFile(path.join(root, 'protected-chat.json'), JSON.stringify(Array.isArray(report.protectedBefore) ? report.protectedBefore : report.protectedBefore ? [report.protectedBefore] : []), { flag: 'wx' });
    const store = new ConfigStore({ filePath: dailyFile }); await store.load(); const config = store.get();
    const inventory = await scanWallpaperProjects(); const initial = inventory.projects.find(p => p.id === config.selectedId && p.type === 'scene'); assert.ok(initial); policy.assertM2TestProject(initial); policy.assertM2TestRoot(initial.rootPath);
    const other = inventory.projects.find(p => p.id === '1778944028' && projectPolicy(p, config).eligible); assert.ok(other); policy.assertM2TestProject(other); policy.assertM2TestRoot(other.rootPath);
    const web = inventory.projects.find(p => p.type === 'web' && policy.isM2TestProjectAllowed(p) && projectPolicy(p, config).eligible); assert.ok(web); policy.assertM2TestRoot(web.rootPath);
    report.sampleIds = [initial.id, other.id, web.id]; report.manifestHashesBefore = await Promise.all([initial, other, web].map(p => hash(path.join(p.rootPath, 'project.json'))));
    const hostPort = await freePort(), desktopPort = await freePort(); assert.notEqual(hostPort, desktopPort); report.hostPort = hostPort; report.desktopPort = desktopPort;
    const profile = path.join(root, 'host-profile'); await mkdir(profile);
    const env = { ...process.env }; for (const key of ['ELECTRON_RUN_AS_NODE', 'CWB_ACCEPTANCE_ROOT', 'CWB_NATIVE_ENGINE_PROVIDER', 'CWB_BRIDGE_CLI', 'NODE_OPTIONS']) delete env[key];
    const codex = start(installation.path, ['--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${hostPort}`, `--user-data-dir=${profile}`], env, 'codex');
    codex.identity = await until(() => identity(codex.child.pid)); target = { ...codex.identity, port: hostPort, profile };
    report.target = target; await writeFile(path.join(root, 'target.json'), JSON.stringify(target), { flag: 'wx' });
    await until(async () => { try { await guard(); return true; } catch { return false; } }); await guard();
    const pages = (await json(hostPort, '/json/list')).filter(t => t.type === 'page' && !/avatar|overlay|devtools/.test(t.url)); if (!pages.length) throw Error('codex_page_unavailable'); host = await connect(pages[0], hostPort);
    report.initialCodexVisibility = await host.evaluate('({hidden:document.hidden,ready:document.readyState==="complete",width:innerWidth,height:innerHeight,hasRoot:!!document.getElementById("root")})');
    if (visibleHost) await focusOwnedHost();
    await mkdir(path.join(root, 'desktop-user-data')); await mkdir(path.join(root, 'bridge-state', 'CodexWallpaperBridge'), { recursive: true });
    await writeFile(path.join(root, 'desktop-user-data', 'settings.json'), JSON.stringify({ manualExecutables: [installation.path], selectedId: installation.id, port: hostPort, adaptive: true }), { flag: 'wx' });
    await writeFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'config.json'), JSON.stringify({ ...config, selectedId: initial.id,
      authorProperties: { [initial.id]: config.authorProperties[initial.id] ?? {} }, library: { ...config.library, hiddenIds: [...new Set([...(config.library?.hiddenIds ?? []), ...policy.EXCLUDED_M2_TEST_IDS])] },
      effects: { ...config.effects, audioEnabled: false, volume: 0, playing: true } }), { flag: 'wx' });
    const desktopExe = path.join(workspace, 'node_modules', 'electron', 'dist', 'electron.exe');
    const desktop = start(desktopExe, [workspace, '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${desktopPort}`], { ...env, CWB_ACCEPTANCE_ROOT: root }, 'desktop');
    desktop.identity = await until(() => identity(desktop.child.pid)); report.desktopIdentity = desktop.identity;
    const page = await until(async () => { try { return (await json(desktopPort, '/json/list')).find(t => t.type === 'page' && t.url === 'cwb-desktop://shell/index.html'); } catch { return null; } }); main = await connect(page, desktopPort);
    bridgeUrl = await until(() => main.evaluate('document.querySelector("#controlFrame")?.src||null')); const address = new URL(bridgeUrl); if (address.protocol !== 'http:' || address.hostname !== '127.0.0.1') throw Error('invalid_control_service'); report.controlPort = Number(address.port);
    const frame = await until(async () => (await json(desktopPort, '/json/list')).find(t => t.type === 'iframe' && t.url === bridgeUrl)); control = await connect(frame, desktopPort);
    await until(() => control.evaluate('document.documentElement.dataset.cwbDesktopEmbedded==="true" && !document.querySelector("#desktopApplyButton").disabled'));
    const runtime = JSON.parse((await readFile(path.join(root, 'bridge-state', 'CodexWallpaperBridge', 'runtime.json'), 'utf8')).replace(/^\uFEFF/, '')); utilityIdentity = await identity(runtime.pid); report.utilityIdentity = utilityIdentity;
    assert.equal(runtime.nativeEngineProviderConfigured, true); assert.equal(runtime.injectorActive, false);
  });
  await step('real Apply button initializes selected Scene in Codex through default bundled desktop provider', async () => { await apply(); await settle(report.sampleIds[0]); report.initialNativeState = await nativeState(); });
  await step('native decoder sequence advances and actual Codex canvas pixels change', async () => {
    await focusOwnedHost(); const a = await nativeState(), first = await canvasSample(); assert.ok(first); const end = Date.now() + 8000; let b, last;
    do { await pause(400); b = await nativeState(); last = await canvasSample(); } while ((b.sequence <= a.sequence || last?.hash === first.hash) && Date.now() < end);
    if (b.sequence <= a.sequence) throw Error('native_sequence_not_advancing'); if (!last || last.hash === first.hash) throw Error('native_pixels_not_changing');
    assert.equal(first.width, 800); assert.equal(first.height, 450); report.nativeMotion = { sequenceBefore: a.sequence, sequenceAfter: b.sequence, first, last };
  });
  await step('real library selections switch Scene to Web and back through the same production M1 slots', async () => { await select(report.sampleIds[1]); await select(report.sampleIds[2]); await select(report.sampleIds[0]); report.afterSwitch = await nativeState(); });
  await step('real Restore and Apply buttons release and recreate native delivery without stale failure cache', async () => { await restore(); await apply(); await settle(report.sampleIds[0]); report.afterReapply = await nativeState(); });
  await step('real Restore removes Codex runtime and wallpaper DOM', restore);
  report.outcome = 'pass';
} catch (error) { report.outcome = 'fail'; report.failure = category(error); }
finally {
  if (main && control && host && !restored) { try { await restore(); report.restoredDuringCleanup = true; } catch { report.cleanupRestoreFailed = true; } }
  try { await closeOwned(processes.find(p => p.label === 'desktop'), main); } catch { report.desktopCleanupFailed = true; }
  try { await closeOwned(processes.find(p => p.label === 'codex'), host); } catch { report.codexCleanupFailed = true; }
  for (const c of connections) c.close();
  report.processes = processes.map(p => ({ label: p.label, pid: p.child.pid, identity: p.identity, exited: p.exited, exitCode: p.exitCode, stderrBytes: p.stderrBytes }));
  if (utilityIdentity) { const after = await identity(utilityIdentity.pid).catch(() => undefined); report.utilityExited = after === null || Boolean(after && after.creation !== utilityIdentity.creation); }
  try { report.dailyHashAfter = await hash(dailyFile); report.dailyUnchanged = report.dailyHashBefore === report.dailyHashAfter; report.compiledHashesAfter = await hashes(); report.sameCompiledBuild = JSON.stringify(report.compiledHashesBefore) === JSON.stringify(report.compiledHashesAfter); report.runtimeHashesAfter = await runtimeHashes(); report.sameRuntimeSources = JSON.stringify(report.runtimeHashesBefore) === JSON.stringify(report.runtimeHashesAfter);
    const protectedList = Array.isArray(report.protectedBefore) ? report.protectedBefore : report.protectedBefore ? [report.protectedBefore] : []; report.protectedChatsPreserved = true;
    for (const item of protectedList) { const current = await identity(item.pid); if (!current || current.exe !== item.exe || current.creation !== item.creation) report.protectedChatsPreserved = false; }
    if (report.sampleIds) { const inventory = await scanWallpaperProjects(); report.manifestHashesAfter = await Promise.all(report.sampleIds.map(id => hash(path.join(inventory.projects.find(p => p.id === id).rootPath, 'project.json')))); report.manifestsUnchanged = JSON.stringify(report.manifestHashesBefore) === JSON.stringify(report.manifestHashesAfter); }
  } catch { report.independentVerificationFailed = true; }
  try { const log = await readFile(path.join(root, 'desktop-logs', `codex-wallpaper-${report.startedAt.slice(0, 10)}.log`), 'utf8'); report.nativeFrameErrors = [...log.matchAll(/native-frame-error[^\r\n]*?(\{[^\r\n]+\})/g)].slice(0, 8).map(m => { try { const f = JSON.parse(m[1]); return { stage: ['ready', 'health', 'state', 'control', 'capture', 'accept'].includes(f.stage) ? f.stage : 'unknown', reason: ['operation-failed', 'failed', 'decode', 'invalid-frame', 'receiver-failed'].includes(f.reason) ? f.reason : 'unknown' }; } catch { return { stage: 'unknown', reason: 'unknown' }; } }); } catch {}
  report.resourcesClosed = processes.every(p => p.exited) && report.utilityExited === true && !report.forcedOwnedStops?.length;
  report.finishedAt = new Date().toISOString(); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ evidence: root, outcome: report.outcome, failure: report.failure, steps: report.steps.length,
    resourcesClosed: report.resourcesClosed, dailyUnchanged: report.dailyUnchanged, protectedChatsPreserved: report.protectedChatsPreserved, nativeFrameErrors: report.nativeFrameErrors }));
  process.exitCode = report.outcome === 'pass' && report.resourcesClosed && report.sameCompiledBuild && report.sameRuntimeSources && report.dailyUnchanged && report.protectedChatsPreserved && report.manifestsUnchanged ? 0 : 1;
}
