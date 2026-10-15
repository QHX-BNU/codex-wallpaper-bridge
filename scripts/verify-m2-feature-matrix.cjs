/* Real readonly WE samples in isolated Chromium. Not Codex/native/audible acceptance. */
const { app, BrowserWindow, nativeImage, session } = require('electron');
const { randomBytes } = require('node:crypto');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createServer } = require('node:http');
const { pathToFileURL } = require('node:url');
const { prepareFeatureEvidenceRoot } = require('./m2-feature-boundary.cjs');
const [workspaceArg, libraryArg, outputArg, selectionArg] = process.argv.slice(2);
if (![workspaceArg, libraryArg, outputArg].every(Boolean)) throw Error('workspace, readonly library and fresh evidence directory required');
const workspace = path.resolve(workspaceArg), library = path.resolve(libraryArg), root = prepareFeatureEvidenceRoot(workspace, outputArg);
app.setPath('userData', path.join(root, 'profile'));
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.on('window-all-closed', () => {});
const report = { at: new Date().toISOString(), scope: 'isolated-real-feature-matrix', artifact: 'compiled-dist',
  electron: process.versions.electron, chromium: process.versions.chrome, codexHostsVerified: false,
  productionSwitchIntegrated: false, audibleOutputVerified: false, completeM0Gate: false, samples: [] };
const only = selectionArg ? (/^--only=\d{1,16}(?:,\d{1,16}){0,7}$/.test(selectionArg) ? selectionArg.slice(7).split(',') : null) : null;
if (selectionArg && !only) throw Error('invalid explicit sample subset');
const sceneSamples = [
  ['1778944028', ['particles']], ['3000932165', ['particles', 'puppets', 'parallax', 'audio']],
  ['3444535389', ['puppets', 'scripts', 'cursorScripts', 'audio']],
  ['3233141951', ['particles', 'puppets', 'scripts', 'cursorScripts', 'parallax', 'audio']],
  ['3553574985', ['particles', 'scripts', 'cursorScripts']],
].filter(([id]) => !only || only.includes(id));
const webSamples = ['3785016842', '895116177'].filter((id) => !only || only.includes(id));
report.sampleSubset = only ?? 'full-allowed-sample-matrix';
report.configuredSceneCount = sceneSamples.length;
report.configuredWebCount = webSamples.length;
report.configuredSampleIds = [...sceneSamples.map(([id]) => id), ...webSamples];
report.configuredSampleCount = report.configuredSampleIds.length;
report.diagnosticTracingEnabled = true;
let win, server, scene, moduleApi, inspection, protectEngineRenderer, boundary, createEngineFrameClock, frameClock;
function startup(stage) {
  fsSync.mkdirSync(root, { recursive: true });
  fsSync.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ stage, pid: process.pid, at: new Date().toISOString() }));
}
startup('loaded');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function bounded(promise, label, ms = 15000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(label + ' timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
const parentEval = (expression) => bounded(win.webContents.executeJavaScript(expression), 'parent evaluate');
let contextId;
async function sceneEval(expression) {
  const r = await bounded(win.webContents.debugger.sendCommand('Runtime.evaluate', { expression, contextId,
    awaitPromise: true, returnByValue: true }), 'scene evaluate');
  if (r.exceptionDetails) throw Error('scene evaluation exception');
  return r.result.value;
}
async function wait(expression, ms = 45000) {
  const end = Date.now() + ms;
  do { if (await parentEval(expression)) return; await sleep(100); } while (Date.now() < end);
  throw Error('feature condition timeout');
}
async function capture(sample, name) {
  await parentEval('new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))');
  const image = await bounded(win.webContents.capturePage(), 'capture');
  const png = image.toPNG();
  await fs.writeFile(path.join(root, sample + '-' + name + '.png'), png, { flag: 'wx' });
  return nativeImage.createFromBuffer(png).toBitmap();
}
function pixels(a, b) {
  assert.equal(a.length, b.length);
  let change = 0, nonblack = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 9) change++;
    if (a[i] + a[i + 1] + a[i + 2] > 30) nonblack++;
  }
  return { changedRatio: change / (a.length / 4), nonblackRatio: nonblack / (a.length / 4) };
}
async function control(op, extra = {}) {
  const before = op === 'pointer' ? await parentEval('window.state?.draws??null') : null;
  await parentEval(`window.control(${JSON.stringify(op)},${JSON.stringify(extra)})`);
  if (op === 'pointer' && before !== null) await wait(`window.state.draws>${before}`, 5000);
  else await sleep(100);
}
const featureExpression = `(()=>{const layers=window.__sceneLayers??[];return {
  layers:layers.length, particles:window.__particleStats?.()??null,
  puppets:layers.filter(l=>l.puppet).map(l=>({bones:l.puppet.bones?.length??0,animations:l.animationLayers?.length??0})),
  scripts:(window.__objScripts??[]).length, disabledScripts:(window.__objScripts??[]).filter(s=>s.sandbox?.disabled||s.disabled).length,
  scriptedLayers:layers.filter(l=>l.originProp?.script||l.originScript||l.visibleProp?.script).length,
  pointer:window.__pointerStats?.()??null, properties:window.__cwbScene?.properties??{},audio:window.__cwbScene?.audio??{}
}})()`;
async function checkpoint() { await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2)); }
async function sampleStep(sample, name, fn) {
  try { await fn(); sample.steps.push({ name, status: 'pass' }); }
  catch (error) { sample.steps.push({ name, status: 'fail', error: String(error.message).slice(0, 240) }); sample.outcome = 'fail'; }
  await checkpoint();
}
async function installProbe() {
  // A normal blocking script on the readonly origin reaches the OOP iframe too.
  // The failed CDP Page.addScript attempt is retained, not represented as real tracing.
  await parentEval('window.begin()');
}
async function closeSample() {
  frameClock?.release(); frameClock = null;
  boundary?.release(); boundary = null;
  if (win && !win.isDestroyed()) win.destroy(); win = null;
  if (scene) { await scene.close(); scene = null; }
  if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); server = null; }
}
async function runSample(id, required) {
  require('./m2-test-policy.cjs').assertM2TestRoot(path.join(library, id));
  const result = { id, required, steps: [], outcome: 'pass' }; report.samples.push(result);
  try {
    startup('inspect-' + id);
    result.declared = await bounded(inspection.inspectSceneProject(path.join(library, id)), 'readonly inspection', 15000);
    assert.equal(result.declared.status, 'inspected');
    server = createServer((req, res) => {
      if (req.url !== '/') { res.writeHead(403); res.end(); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><style>html,body{margin:0;background:#000;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><iframe id="scene" sandbox="allow-scripts allow-same-origin"></iframe><script>
        const frame=document.querySelector('iframe'),origin=${JSON.stringify(scene.origin)},channel=${JSON.stringify(scene.channel)};
        addEventListener('message',e=>{if(e.origin===origin&&e.source===frame.contentWindow&&e.data?.channel===channel&&e.data?.source==='cwb-scene')window.state=e.data;});
        window.control=(op,extra)=>frame.contentWindow.postMessage({source:'cwb-scene-control',channel,op,...extra},origin);window.begin=()=>{frame.src=${JSON.stringify(scene.rendererUrl)}};</script>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    scene = moduleApi.createSceneServer({ project: { id, type: 'scene', rootPath: path.join(library, id) }, parentOrigin: origin, diagnosticProbe: true });
    startup('server-' + id);
    await bounded(scene.start(), 'scene start');
    startup('window-' + id);
    const isolatedSession = session.fromPartition('cwb-m2-features-' + randomBytes(16).toString('hex'));
    win = new BrowserWindow({ width: 800, height: 450, useContentSize: true, show: false,
      webPreferences: { session: isolatedSession, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false, offscreen: true } });
    boundary = protectEngineRenderer({ webContents: win.webContents, session: isolatedSession,
      wrapperUrl: origin + '/', rendererOrigin: scene.origin });
    frameClock = createEngineFrameClock(win.webContents);
    startup('load-' + id);
    await bounded(win.loadURL(origin + '/'), 'wrapper load', 30000);
    startup('debugger-' + id);
    const contexts = [];
    win.webContents.debugger.attach('1.3');
    win.webContents.debugger.on('message', (_, method, params) => { if (method === 'Runtime.executionContextCreated') contexts.push(params.context); });
    await bounded(win.webContents.debugger.sendCommand('Runtime.enable'), 'runtime enable');
    await installProbe();
    await sampleStep(result, 'actual package first frame and feature state', async () => {
      await wait(`window.state?.phase==='ready'`);
      contextId = contexts.find((c) => c.origin === scene.origin && c.auxData?.isDefault)?.id;
      assert.ok(contextId); result.runtime = await sceneEval(featureExpression);
      assert.ok(scene.diagnostics().requests.includes('scene.pkg')); assert.ok(result.runtime.layers > 0);
      if (required.includes('particles')) assert.ok(result.runtime.particles?.systems.length > 0);
      if (required.includes('puppets')) assert.ok(result.runtime.puppets.some((p) => p.bones > 0));
      if (required.includes('scripts')) assert.ok(result.runtime.scripts > 0);
    });
    if (!contextId || result.steps.at(-1).status === 'fail') return;
    await sampleStep(result, 'three saved real scene frames, changing pixels', async () => {
      const a = await capture(id, 'a'); await sleep(700); const b = await capture(id, 'b');
      await sleep(700); const c = await capture(id, 'c'); result.dynamic = [pixels(a, b), pixels(b, c)];
      assert.ok(result.dynamic.every((p) => p.nonblackRatio > .05 && p.changedRatio > .001));
    });
    if (required.includes('scripts')) await sampleStep(result, 'real SceneScript update/cursor functions are invoked by the scene engine', async () => {
      await sleep(500);
      for (const u of [.2, .5, .8]) for (const v of [.25, .5, .75]) {
        await control('pointer', { u, v, buttons: 0 }); await control('pointer', { u, v, buttons: 1 });
        await control('pointer', { u, v, buttons: 0 });
      }
      result.scriptCalls = await sceneEval('window.__m2Probe'); assert.ok(result.scriptCalls.updates > 0);
      if (required.includes('cursorScripts')) assert.ok(result.scriptCalls.cursors > 0);
    });
    await sampleStep(result, 'trusted pointer move/down/up reaches real scene engine', async () => {
      const before = await sceneEval('window.__pointerStats?.()');
      await control('pointer', { u: .3, v: .4, buttons: 0 }); await control('pointer', { u: .3, v: .4, buttons: 1 });
      await control('pointer', { u: .7, v: .6, buttons: 0 });
      result.pointer = await sceneEval('window.__pointerStats?.()');
      assert.ok(result.pointer.counts.move > before.counts.move); assert.ok(result.pointer.counts.down > before.counts.down);
      assert.ok(result.pointer.counts.up > before.counts.up);
      assert.equal(result.pointer.leftDown, false);
    });
    if (required.includes('cursorScripts')) await sampleStep(result, 'rapid down/up is ordered by production pointer queue across real render ticks', async () => {
      const before = await sceneEval('({pointer:window.__pointerStats(),cursors:window.__m2Probe.cursors})');
      const initial = await parentEval('({accepted:window.state.pointerAccepted,completed:window.state.renderCompletions})');
      const accepted = initial.accepted, burstStarted = Date.now();
      // No verifier sleep/draw barrier between these 54 messages.
      await parentEval(`(()=>{for(const u of [.2,.5,.8])for(const v of [.25,.5,.75])for(let i=0;i<3;i++){window.control('pointer',{u,v,buttons:1});window.control('pointer',{u,v,buttons:0})}})()`);
      let after;
      try { await wait(`window.state.pointerAccepted===${accepted + 54}&&window.state.pendingPointers===0`, 10000); await sleep(500); }
      finally {
        after = await sceneEval('({pointer:window.__pointerStats(),cursors:window.__m2Probe.cursors})');
        result.rapidPointerDiagnostics = { before, after,
          state: await parentEval('({accepted:window.state.pointerAccepted,delivered:window.state.pointerDelivered,acknowledged:window.state.pointerAcknowledged,pending:window.state.pendingPointers,draws:window.state.draws,renderCompletions:window.state.renderCompletions,phase:window.state.phase})'),
          hooks: await sceneEval('({definitions:window.__m2Probe.cursorDefinitions,calls:window.__m2Probe.cursorKinds})'),
          elapsedMs: Date.now() - burstStarted, initialCompletions: initial.completed, nativeFrameClock: frameClock.status() };
      }
      assert.equal(after.pointer.counts.down - before.pointer.counts.down, 27);
      assert.equal(after.pointer.counts.up - before.pointer.counts.up, 27);
      assert.equal(after.pointer.leftDown, false); assert.ok(after.cursors > before.cursors);
      result.rapidPointer = { down: 27, up: 27, cursorDelta: after.cursors - before.cursors, verifierBarriers: false,
        hooks: await sceneEval('({definitions:window.__m2Probe.cursorDefinitions,calls:window.__m2Probe.cursorKinds})') };
    });
    if (required.includes('audio')) await sampleStep(result, 'package audio decoded and its native media clock advances', async () => {
      await control('volume', { value: .15 });
      await wait('window.state?.audio.ready>0&&window.state.audio.playing>0', 15000);
      const before = await parentEval('window.state.audio'); await sleep(700);
      const after = await parentEval('window.state.audio'); assert.ok(after.time > before.time);
      result.audio = { before, after, audibleOutputVerified: false }; await control('volume', { value: 0 });
    });
    await sampleStep(result, 'author property validation, live readback and reset', async () => {
      const initial = await parentEval('window.state.properties');
      assert.ok(Object.keys(initial).length > 0, 'at least one author property must have real engine readback');
      const key = Object.keys(initial).find((k) => typeof initial[k] === 'boolean');
      if (!key) { result.authorProperties = { booleanControlPresent: false, readback: Object.keys(initial).length }; return; }
      await control('properties', { values: { [key]: !initial[key] } });
      await wait(`window.state.properties[${JSON.stringify(key)}]===${!initial[key]}`);
      const revision = await parentEval('window.state.propertyRevision');
      await control('properties', { values: { [key]: 'false', file: 'file:///denied' } });
      assert.equal(await parentEval('window.state.propertyRevision'), revision);
      await control('resetProperties'); await wait(`window.state.properties[${JSON.stringify(key)}]===${initial[key]}`);
      result.authorProperties = { booleanControlPresent: true, liveReadback: true, invalidRejected: true, defaultsRestored: true };
    });
    await sampleStep(result, 'pause freezes saved pixels and resume restarts', async () => {
      await control('pause'); await sleep(350); const a = await capture(id, 'paused-a');
      await sleep(450); const b = await capture(id, 'paused-b'); result.pausePixels = pixels(a, b); assert.equal(result.pausePixels.changedRatio, 0);
      await control('resume'); await sleep(600); const c = await capture(id, 'resumed'); assert.ok(pixels(b, c).changedRatio > .001);
    });
    await sampleStep(result, 'release removes canvas/layers/audio; no resurrection', async () => {
      await control('release'); await wait(`window.state?.phase==='released'`);
      const state = await parentEval('window.state'); assert.equal(state.width, 0); assert.equal(state.layers, 0); assert.equal(state.audio.elements, 0);
      await control('resume'); assert.equal(await parentEval('window.state.phase'), 'released');
    });
    await sampleStep(result, 'native owner blocks author self-navigation outside readonly origin', async () => {
      const before = boundary.status().navigationsRejected;
      await sceneEval(`(()=>{location.href=${JSON.stringify(origin + '/')};return true})()`);
      await sleep(250);
      assert.ok(boundary.status().navigationsRejected > before);
      assert.equal(await sceneEval('location.origin'), scene.origin);
      result.nativeBoundary = boundary.status();
    });
    result.sourceRequests = scene.diagnostics().requests.length;
  } catch (error) { result.outcome = 'fail'; result.error = String(error.message).slice(0, 240); }
  finally { await closeSample(); contextId = null; result.resourcesClosed = true; await checkpoint(); }
}
async function runWebSample(id) {
  require('./m2-test-policy.cjs').assertM2TestRoot(path.join(library, id));
  const result = { id, type: 'web', outcome: 'pass', steps: [] }; report.samples.push(result);
  try {
    server = createServer((req, res) => {
      if (req.url !== '/') { res.writeHead(403); res.end(); return; }
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><style>html,body{margin:0;background:#000;width:100%;height:100%;overflow:hidden}iframe{width:100%;height:100%;border:0}</style><iframe id="scene" sandbox="allow-scripts allow-same-origin"></iframe><script>
        const frame=document.querySelector('iframe'),origin=${JSON.stringify(scene.origin)},channel=${JSON.stringify(scene.channel)};
        addEventListener('message',e=>{if(e.origin===origin&&e.source===frame.contentWindow&&e.data?.channel===channel&&e.data?.source==='cwb-web')window.state=e.data;});
        window.control=(op,extra)=>frame.contentWindow.postMessage({source:'cwb-web-control',channel,op,...extra},origin);window.begin=()=>{frame.src=${JSON.stringify(scene.rendererUrl)}};</script>`);
    });
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
    const origin = `http://127.0.0.1:${server.address().port}`;
    scene = moduleApi.createReadonlyWallpaperServer({ project: { id, type: 'web', rootPath: path.join(library, id) }, parentOrigin: origin, diagnosticProbe: true });
    await bounded(scene.start(), 'web server start'); startup('web-window-' + id);
    const isolatedSession = session.fromPartition('cwb-m2-features-' + randomBytes(16).toString('hex'));
    win = new BrowserWindow({ width: 800, height: 450, useContentSize: true, show: false,
      webPreferences: { session: isolatedSession, sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
    boundary = protectEngineRenderer({ webContents: win.webContents, session: isolatedSession,
      wrapperUrl: origin + '/', rendererOrigin: scene.origin });
    await bounded(win.loadURL(origin + '/'), 'web wrapper load', 30000);
    const contexts = []; win.webContents.debugger.attach('1.3');
    win.webContents.debugger.on('message', (_, method, params) => { if (method === 'Runtime.executionContextCreated') contexts.push(params.context); });
    await bounded(win.webContents.debugger.sendCommand('Runtime.enable'), 'web runtime enable');
    await installProbe();
    await sampleStep(result, 'real local Web renderer and saved native first/dynamic frames', async () => {
      await wait(`window.state?.phase==='renderable'`);
      contextId = contexts.find((c) => c.origin === scene.origin && c.auxData?.isDefault)?.id; assert.ok(contextId);
      if (id === '3785016842') {
        const end = Date.now() + 20000;
        while (!(await sceneEval('window.__m2Probe.draws>0')) && Date.now() < end) await sleep(100);
        assert.ok(await sceneEval('window.__m2Probe.draws>0'), 'real Live2D GPU submission required, not its CSS background');
      }
      const a = await capture(id, 'web-a'); await sleep(700); const b = await capture(id, 'web-b');
      result.dynamic = pixels(a, b); assert.ok(result.dynamic.nonblackRatio > .05); assert.ok(result.dynamic.changedRatio > .001);
      result.firstFrameProof = 'decoded-saved-native-png-not-shim-telemetry';
    });
    if (!contextId) return;
    await sampleStep(result, 'author constructor escape remains isolated from parent/Node/control API', async () => {
      const security = await sceneEval(`(async()=>{let g=window,evalDenied=false;try{g=({}).constructor.constructor('return globalThis')()}catch{evalDenied=true}let blocked=false;try{void parent.document.body}catch{blocked=true}
        return {parentBlocked:blocked,evalDenied,node:typeof g.process,require:typeof g.require,control:(await fetch('/api/config')).status,
        networkBlocked:await fetch(${JSON.stringify(origin + '/forbidden')}).then(()=>false,()=>true)};})()`);
      // Both the ordinary realm and any constructor escape stay on the readonly origin.
      assert.equal(security.parentBlocked, true); assert.equal(security.node, 'undefined'); assert.equal(security.require, 'undefined');
      assert.equal(security.control, 404); assert.equal(security.networkBlocked, true); result.security = security;
    });
    await sampleStep(result, 'typed property delivery reaches real author listener; invalid patch rejected and reset', async () => {
      const wired = await sceneEval(`(()=>{const listener=window.wallpaperPropertyListener;if(typeof listener?.applyUserProperties!=='function')return false;
        const original=listener.applyUserProperties;window.__authorPropertyCalls=0;listener.applyUserProperties=function(p){window.__authorPropertyCalls++;return original.call(this,p)};return true;})()`);
      assert.equal(wired, true, 'sample author property callback must exist');
      const initial = await parentEval('window.state.properties'), schema = scene.authorProperties.schema;
      const key = Object.keys(initial).find((k) => typeof initial[k] === 'boolean') ?? Object.keys(initial).find((k) => schema[k]?.type === 'slider');
      assert.ok(key); const changed = typeof initial[key] === 'boolean' ? !initial[key] : schema[key].min === initial[key] ? schema[key].max : schema[key].min;
      await control('properties', { values: { [key]: changed } }); assert.ok(await sceneEval('window.__authorPropertyCalls') > 0);
      assert.equal(await parentEval(`window.state.properties[${JSON.stringify(key)}]`), changed);
      const revision = await parentEval('window.state.propertyRevision'); await control('properties', { values: { file: 'file:///denied' } });
      assert.equal(await parentEval('window.state.propertyRevision'), revision);
      await control('resetProperties'); assert.equal(await parentEval(`window.state.properties[${JSON.stringify(key)}]`), initial[key]);
      result.propertyDelivery = { verified: true, authorEffectPixelVerified: false };
    });
    await sampleStep(result, 'release is terminal and owner destroys renderer plus readonly listeners', async () => {
      await control('release'); await wait(`window.state.phase==='released'`); await control('resume');
      assert.equal(await parentEval('window.state.phase'), 'released');
    });
    await sampleStep(result, 'native owner blocks Web author self-navigation outside readonly origin', async () => {
      const before = boundary.status().navigationsRejected;
      await sceneEval(`(()=>{location.href=${JSON.stringify(origin + '/')};return true})()`);
      await sleep(250); assert.ok(boundary.status().navigationsRejected > before);
      assert.equal(await sceneEval('location.origin'), scene.origin); result.nativeBoundary = boundary.status();
    });
    result.assetRequests = scene.diagnostics().requests.length;
  } catch (error) { result.outcome = 'fail'; result.error = String(error.message).slice(0, 240); }
  finally { await closeSample(); contextId = null; result.resourcesClosed = true; await checkpoint(); }
}
async function main() {
  await fs.mkdir(root, { recursive: true }); await bounded(app.whenReady(), 'app ready', 20000);
  startup('app-ready');
  moduleApi = await bounded(import(pathToFileURL(path.join(workspace, 'dist/bridge-runtime/src/scene-server.mjs')).href), 'scene module');
  inspection = await bounded(import(pathToFileURL(path.join(workspace, 'bridge-runtime/src/scene-inspector.mjs')).href), 'inspection module');
  ({ protectEngineRenderer } = await import(pathToFileURL(path.join(workspace, 'src/engine-boundary.mjs')).href));
  ({ createEngineFrameClock } = await import(pathToFileURL(path.join(workspace, 'dist/bridge-runtime/src/engine-renderer-owner.mjs')).href));
  for (const [id, features] of sceneSamples) await runSample(id, features);
  for (const id of webSamples) await runWebSample(id);
  assert.ok(report.samples.length > 0, 'explicit subset must include registered real samples');
  report.outcome = report.samples.every((s) => s.outcome === 'pass') ? 'pass' : 'fail';
}
main().catch((error) => { report.outcome = 'fail'; report.error = String(error.message).slice(0, 240); }).finally(async () => {
  await closeSample(); report.finishedAt = new Date().toISOString();
  await fs.mkdir(root, { recursive: true }); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  app.exit(report.outcome === 'pass' ? 0 : 1);
});
