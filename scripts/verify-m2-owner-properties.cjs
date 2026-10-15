// Legacy verifier is sealed while its required sample is excluded by the user.
require('./m2-test-policy.cjs').assertM2TestProject('3790869794');
/* Isolated native owner + real workbench properties. Never a Store/EXE acceptance substitute. */
const electron = require('electron');
const { app, BrowserWindow } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { prepareFeatureEvidenceRoot } = require('./m2-feature-boundary.cjs');
const [workspaceArg, libraryArg, outputArg] = process.argv.slice(2);
const audibleRequested = process.argv.includes('--audible');
if (![workspaceArg, libraryArg, outputArg].every(Boolean)) throw Error('workspace, readonly library and fresh evidence directory required');
const workspace = path.resolve(workspaceArg), library = path.resolve(libraryArg), root = prepareFeatureEvidenceRoot(workspace, outputArg);
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
fsSync.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
const report = { at: new Date().toISOString(), scope: 'isolated-native-owner-and-real-workbench-properties',
  electron: process.versions.electron, chromium: process.versions.chrome, rendererArtifact: 'compiled-dist-owner-and-public-ui',
  controlPlane: 'source-config-and-media-server', codexHostsVerified: false, productionSwitchIntegrated: false,
  sharedM1SwitcherUsed: true, audibleOutputVerified: false, longDurationVerified: false, steps: [], owners: [] };
report.audibleRequested = audibleRequested;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mod = (relative) => import(pathToFileURL(path.join(workspace, relative)).href);
let Owner, ConfigStore, createMediaServer, createMediaSwitcher, EngineFailureMemory, effectiveAuthorProperties;
let store, server, ui, switcher, active, propertiesState, savedKey, savedValue;
const owners = [], closes = [], failureEvents = [], failures = {};
let failureMemory;
async function bounded(promise, ms = 45000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('bounded_owner_step_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function step(name, fn) {
  report.currentStep = name; await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
  await bounded(fn(), 120000); report.steps.push({ name, status: 'pass' });
  await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
}
async function wait(fn, ms = 15000) { const end = Date.now() + ms; do { if (await fn()) return; await delay(75); } while (Date.now() < end); throw Error('owner_condition_timeout'); }
const evaluate = (code) => bounded(ui.webContents.executeJavaScript(code), 15000);
async function click(selector) {
  await wait(() => evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});return Boolean(e&&!e.disabled&&!e.hidden)})()`));
  const point = await evaluate(`(()=>{const e=document.querySelector(${JSON.stringify(selector)});if(!e||e.disabled||e.hidden)throw Error('not actionable');
    e.scrollIntoView({block:'center'});const r=e.getBoundingClientRect(),x=r.x+r.width/2,y=r.y+r.height/2,hit=document.elementFromPoint(x,y);
    if(hit!==e&&!e.contains(hit))return{ok:false,reason:'hit-test',tag:hit?.tagName??null};return{ok:true,x,y}})()`);
  assert.equal(point.ok, true, JSON.stringify(point)); delete point.ok;
  for (const type of ['mousePressed', 'mouseReleased']) await ui.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, ...point, button: 'left', clickCount: 1 });
}
async function snapshot(name) { await fs.writeFile(path.join(root, name + '.png'), (await bounded(ui.webContents.capturePage())).toPNG(), { flag: 'wx' }); }
function difference(a, b) {
  const pixelsA = electron.nativeImage.createFromBuffer(a.png).toBitmap(), pixelsB = electron.nativeImage.createFromBuffer(b.png).toBitmap();
  assert.equal(pixelsA.length, pixelsB.length); let changed = 0;
  for (let i = 0; i < pixelsA.length; i += 4) if (Math.abs(pixelsA[i] - pixelsB[i]) + Math.abs(pixelsA[i + 1] - pixelsB[i + 1]) + Math.abs(pixelsA[i + 2] - pixelsB[i + 2]) > 9) changed++;
  return changed / (pixelsA.length / 4);
}
const getProperties = async (id = '3233141951') => (await fetch(new URL('api/author-properties/' + id, server.baseUrl))).json();
async function project(id, type = 'scene') {
  const rootPath = path.join(library, id), manifest = JSON.parse(await fs.readFile(path.join(rootPath, 'project.json'), 'utf8'));
  return { id, type, rootPath, title: 'M2 readonly ' + id, previewPath: path.join(rootPath, manifest.preview || 'preview.jpg') };
}
async function startControl() {
  server = createMediaServer({ configStore: store, publicDir: path.join(workspace, 'dist/bridge-runtime/public'),
    projects: [await project('3233141951'), await project('3790869794', 'web')],
    onAuthorProperties: async ({ operation, project, values }) => active?.projectId === project.id
      ? active.properties(operation === 'apply' ? values : null) : { phase: 'unavailable', method: 'none', values: {} } });
  await server.start();
  ui = new BrowserWindow({ width: 1360, height: 960, show: audibleRequested, webPreferences: { sandbox: true, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false } });
  await ui.loadURL(server.baseUrl); ui.webContents.debugger.attach('1.3');
  await wait(() => evaluate(`document.querySelector('#connectionStatus')?.dataset.state==='connected'`));
}
function makeSwitcher() {
  return createMediaSwitcher({ timeoutMs: 45000, create: ({ project, properties = {}, firstFrameTimeoutMs }) => {
    const owner = new Owner({ electron, project, config: store.get(), properties, firstFrameTimeoutMs,
      failures: failureMemory, onFailure: (event) => failureEvents.push(event) });
    owner.projectId = project.id; owners.push(owner); return owner;
  }, commit: (owner) => { active = owner; }, dispose: (owner) => { closes.push(owner.release()); } });
}
async function switchProject(id, type = 'scene') {
  const p = await project(id, type), state = id === '3233141951' ? await getProperties(id) : null;
  const result = await switcher.switchTo({ project: p, properties: state?.values ?? {} }, id);
  assert.equal(result.ok, true); await Promise.all(closes); return active;
}
async function main() {
  await app.whenReady();
  ({ EngineRendererOwner: Owner } = await mod('dist/bridge-runtime/src/engine-renderer-owner.mjs'));
  ({ ConfigStore } = await mod('bridge-runtime/src/config-store.mjs'));
  ({ createMediaServer } = await mod('bridge-runtime/src/media-server.mjs'));
  ({ createMediaSwitcher } = await mod('bridge-runtime/src/media-switch.mjs'));
  ({ EngineFailureMemory } = await mod('bridge-runtime/src/engine-health.mjs'));
  failureMemory = new EngineFailureMemory();
  store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load(); await store.set({ selectedId: '3233141951' });
  switcher = makeSwitcher(); await startControl();
  await step('native decoded first frame gates M1 prepare/commit and source remains isolated', async () => {
    await switchProject('3233141951'); assert.equal(active.status().actualFrame, true);
    const a = await active.capture(); await fs.writeFile(path.join(root, 'owner-first.png'), a.png, { flag: 'wx' });
    await delay(700); const b = await active.capture(); await fs.writeFile(path.join(root, 'owner-second.png'), b.png, { flag: 'wx' });
    report.sceneDynamicRatio = difference(a, b); assert.ok(report.sceneDynamicRatio > .001);
    await click('#authorPropertiesPanel [data-author-refresh]');
    await wait(async () => (await getProperties()).live.method === 'engine-readback');
    await wait(() => evaluate(`document.querySelector('#authorPropertiesPanel p').textContent.includes('实际属性读回')`));
    await snapshot('author-panel-ready');
    assert.equal(active.status().boundary.navigationsRejected, 0);
  });
  if (audibleRequested) await step('authorized 5-second isolated native audio output, then verified instance mute', async () => {
    const source = BrowserWindow.getAllWindows().find((win) => win !== ui); assert.ok(source);
    report.audio = { scope: 'isolated-compiled-native-owner', sampleId: '3233141951', volumePercent: 15,
      outputActivity: false, humanConfirmed: false, systemVolumeTouched: false, systemAudioCaptured: false };
    assert.equal(source.webContents.isAudioMuted(), true);
    try {
      await active.volume(.15);
      await wait(() => !source.webContents.isAudioMuted() && source.webContents.isCurrentlyAudible(), 15000);
      report.audio.outputActivity = true; report.audio.outputStartedAt = new Date().toISOString();
      await delay(5000);
    } finally { await active.volume(0); }
    assert.equal(source.webContents.isAudioMuted(), true); report.audio.mutedAfter = true;
  });
  await step('real checkbox click saves per-wallpaper disk state and actual scene engine readback', async () => {
    propertiesState = await getProperties(); savedKey = Object.keys(propertiesState.schema).find((key) => propertiesState.schema[key].type === 'bool'); assert.ok(savedKey);
    savedValue = !propertiesState.values[savedKey];
    await click('#authorPropertiesPanel input[type="checkbox"]');
    await wait(async () => store.get().authorProperties['3233141951']?.[savedKey] === savedValue && (await getProperties()).live.values[savedKey] === savedValue);
    const disk = JSON.parse(await fs.readFile(store.filePath, 'utf8')); assert.equal(disk.authorProperties['3233141951'][savedKey], savedValue);
    assert.equal(await evaluate(`document.querySelector('#authorPropertiesPanel input[type="checkbox"]').checked`), savedValue);
    await snapshot('author-panel-saved');
  });
  await step('real save failure restores confirmed UI/memory/engine values and preserves original config', async () => {
    const file = store.filePath, backup = file + '.failure-original.bak', before = await fs.readFile(file, 'utf8');
    await fs.rename(file, backup); await fs.mkdir(file);
    try {
      await click('#authorPropertiesPanel input[type="checkbox"]');
      await wait(() => evaluate(`document.querySelector('#authorPropertiesPanel p').textContent.includes('已恢复上次确认值')`));
      assert.equal(await evaluate(`document.querySelector('#authorPropertiesPanel input[type="checkbox"]').checked`), savedValue);
      assert.equal(store.get().authorProperties['3233141951'][savedKey], savedValue);
      assert.equal((await active.properties()).values[savedKey], savedValue); assert.equal(await fs.readFile(backup, 'utf8'), before);
      await snapshot('author-panel-save-failed');
    } finally { await fs.rmdir(file); await fs.rename(backup, file); }
  });
  await step('new ConfigStore/native renderer/workbench restart restores disk-backed author values', async () => {
    ui.destroy(); ui = null; await server.close(); server = null;
    switcher.close(); await Promise.all(closes);
    store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load(); assert.equal(store.get().authorProperties['3233141951'][savedKey], savedValue);
    switcher = makeSwitcher(); active = null; await startControl(); await switchProject('3233141951');
    await click('#authorPropertiesPanel [data-author-refresh]');
    await wait(async () => (await getProperties()).live.values[savedKey] === savedValue);
    assert.equal(await evaluate(`document.querySelector('#authorPropertiesPanel input[type="checkbox"]').checked`), savedValue);
    await snapshot('author-panel-restarted');
  });
  await step('real restore-defaults click clears only this wallpaper and engine reads back defaults', async () => {
    await store.setAuthorProperties('3790869794', { bar: true });
    await click('#authorPropertiesPanel [data-author-refresh]');
    await wait(() => evaluate(`!document.querySelector('#authorPropertiesPanel [data-author-reset]').disabled`));
    await click('#authorPropertiesPanel [data-author-reset]');
    await wait(async () => !store.get().authorProperties['3233141951'] && (await getProperties()).live.values[savedKey] === propertiesState.defaults[savedKey]);
    assert.equal(store.get().authorProperties['3790869794'].bar, true);
  });
  await step('scene pause freezes decoded native pixels, resume changes them, same owner is retained', async () => {
    const before = active; await active.pause(); await delay(350); const a = await active.capture(); await delay(500); const b = await active.capture();
    assert.equal(difference(a, b), 0); await active.resume(); await delay(600); const c = await active.capture();
    assert.ok(difference(b, c) > .001); assert.equal(active, before);
  });
  await step('six real scene/Web M1 switches close retired renderers and readonly listeners', async () => {
    report.switchMemory = [];
    for (let i = 0; i < 6; i++) {
      await switchProject(i % 2 ? '3233141951' : '3790869794', i % 2 ? 'scene' : 'web');
      const frame = await active.capture(); await fs.writeFile(path.join(root, `switch-${i}.png`), frame.png, { flag: 'wx' });
      assert.ok(owners.filter((owner) => owner !== active).every((owner) => owner.status().resourcesClosed));
      report.switchMemory.push({ cycle: i, slots: switcher.status().slots, processMemory: await process.getProcessMemoryInfo(), electronProcesses: app.getAppMetrics().length });
      assert.equal(switcher.status().slots, 1);
    }
  });
  await step('native Web suspension stops author rAF, settles native pixels and resumes the same source', async () => {
    await switchProject('3790869794', 'web'); await delay(700); await active.pause(); await delay(350);
    assert.equal(active.status().suspension.scriptPaused, true);
    assert.equal(active.status().suspension.animationsPaused, true);
    assert.equal(active.status().suspension.frameSettled, true);
    const source = BrowserWindow.getAllWindows().find((win) => win !== ui), contexts = [];
    const listener = (_, method, params) => { if (method === 'Runtime.executionContextCreated') contexts.push(params.context); };
    source.webContents.debugger.on('message', listener);
    try { await source.webContents.debugger.sendCommand('Runtime.enable'); }
    finally { source.webContents.debugger.removeListener('message', listener); }
    const origin = new URL(source.webContents.mainFrame.frames[0].url).origin;
    const contextId = contexts.find((context) => context.origin === origin && context.auxData?.isDefault)?.id; assert.ok(contextId);
    const position = async () => {
      const result = await source.webContents.debugger.sendCommand('Runtime.evaluate', {
        expression: "document.querySelector('#track').getBoundingClientRect().x", contextId, returnByValue: true,
      });
      assert.equal(typeof result.result.value, 'number'); return result.result.value;
    };
    const x1 = await position(), a = await active.capture(); await delay(500); const x2 = await position(), b = await active.capture();
    assert.equal(x1, x2); assert.equal(difference(a, b), 0);
    assert.ok(electron.nativeImage.createFromBuffer(a.png).toBitmap().equals(electron.nativeImage.createFromBuffer(b.png).toBitmap()));
    await fs.writeFile(path.join(root, 'web-native-paused-a.png'), a.png, { flag: 'wx' });
    await fs.writeFile(path.join(root, 'web-native-paused-b.png'), b.png, { flag: 'wx' });
    report.webSuspension = { scriptPausedAcknowledged: true, nativeBitmapIdentical: true, authorPositionBefore: x1, authorPositionAfter: x2 };
    await active.resume(); await delay(600); const c = await active.capture(); assert.ok(difference(b, c) > .001);
    assert.equal(active.status().suspension.scriptPaused, false);
    assert.equal(BrowserWindow.getAllWindows().find((win) => win !== ui), source);
    await fs.writeFile(path.join(root, 'web-native-resumed.png'), c.png, { flag: 'wx' });
    report.webSuspension.resumeChangedRatio = difference(b, c);
  });
  await step('native corrupt candidate fails M1 prepare/commit without clearing the paused real Web frame', async () => {
    const retained = active, identity = switcher.status().identity;
    await retained.pause(); const before = await retained.capture();
    const fixtureRoot = path.join(root, 'corrupt-scene-negative'); await fs.mkdir(fixtureRoot);
    // This negative fixture lives only in the fresh evidence root, never the WE library.
    await fs.writeFile(path.join(fixtureRoot, 'project.json'), JSON.stringify({ type: 'scene', title: 'corrupt negative only' }), { flag: 'wx' });
    await fs.writeFile(path.join(fixtureRoot, 'scene.pkg'), Buffer.from('invalid native Scene package fixture'), { flag: 'wx' });
    const candidateProject = { id: 'cwb-corrupt-negative', type: 'scene', rootPath: fixtureRoot };
    const handle = switcher.prepare({ project: candidateProject, firstFrameTimeoutMs: 1000 }, candidateProject.id);
    const preparing = switcher.status();
    assert.equal(preparing.state, 'preparing'); assert.equal(preparing.slots, 2);
    assert.equal(preparing.identity, identity); assert.equal(active, retained);
    const candidate = handle.slot, committing = switcher.commit(handle);
    const during = await retained.capture();
    const outcome = await committing; assert.equal(outcome.ok, false); await Promise.all(closes);
    const after = await retained.capture();
    const bitmap = (frame) => electron.nativeImage.createFromBuffer(frame.png).toBitmap();
    assert.ok(bitmap(before).equals(bitmap(during))); assert.ok(bitmap(before).equals(bitmap(after)));
    assert.equal(active, retained); assert.equal(retained.status().closed, false); assert.equal(retained.status().paused, true);
    assert.equal(switcher.status().identity, identity); assert.equal(switcher.status().slots, 1);
    assert.equal(switcher.status().requestedIdentity, null); assert.equal(candidate.status().actualFrame, false);
    assert.equal(candidate.status().resourcesClosed, true); assert.equal(candidate.status().frameClock.offscreen, true);
    assert.equal(candidate.status().frameClock.released, true); assert.equal(candidate.status().boundary.closed, true);
    assert.equal(BrowserWindow.getAllWindows().length, 2);
    for (const [name, frame] of [['before', before], ['during', during], ['after', after]]) {
      await fs.writeFile(path.join(root, `failed-candidate-old-${name}.png`), frame.png, { flag: 'wx' });
    }
    report.failedCandidate = { syntheticNegative: true, nativeCandidateCreated: true, preparingSlots: 2, settledSlots: 1,
      oldOwnerRetained: true, nativeBitmapIdentical: true, candidateResourcesClosed: true, candidate: candidate.status(), outcome };
    await retained.resume(); await delay(600); const resumed = await retained.capture(); assert.ok(difference(after, resumed) > .001);
    report.failedCandidate.oldResumeChangedRatio = difference(after, resumed);
  });
  await step('real source destruction is terminal, remembers failure and closes owned resources', async () => {
    const source = BrowserWindow.getAllWindows().find((win) => win !== ui); assert.ok(source);
    const ended = active, frame = await active.capture(); source.destroy();
    await wait(() => ended.status().resourcesClosed); assert.equal(failureMemory.get(ended.engineIdentity).reason, 'context_lost');
    assert.ok(failureEvents.some((event) => event.identity === ended.engineIdentity && event.actualFrameAvailable));
    const p = await project('3790869794', 'web'), cached = new Owner({ electron, project: p, failures: failureMemory });
    cached.projectId = p.id; owners.push(cached);
    assert.equal(cached.engineIdentity, ended.engineIdentity);
    await assert.rejects(cached.ready, /context_lost/); await cached.release();
    assert.equal(BrowserWindow.getAllWindows().length, 1);
    report.retainedRealFrameBytes = frame.png.length; failureMemory.retry(ended.engineIdentity);
    switcher.clear(); await Promise.all(closes); active = null;
    await switchProject('3790869794', 'web'); assert.equal(active.status().actualFrame, true);
  });
  report.outcome = 'pass';
}
main().catch((error) => { report.outcome = 'fail'; report.steps.push({ name: report.currentStep ?? 'startup', status: 'fail', error: String(error.message).slice(0, 200) }); })
  .finally(async () => {
    try {
      ui?.destroy(); switcher?.close(); await Promise.all(closes); for (const owner of owners) await owner.release(); await server?.close();
      report.owners = owners.map((owner) => ({ id: owner.projectId, ...owner.status() }));
      report.resourcesClosed = report.owners.every((owner) => owner.resourcesClosed); assert.equal(report.resourcesClosed, true);
      report.remainingWindows = BrowserWindow.getAllWindows().length; assert.equal(report.remainingWindows, 0);
    } catch { report.cleanupFailed = true; report.outcome = 'fail'; }
    report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    app.exit(report.outcome === 'pass' ? 0 : 1);
  });
