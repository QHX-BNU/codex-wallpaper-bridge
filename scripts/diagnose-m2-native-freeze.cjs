// Legacy verifier is sealed while its required sample is excluded by the user.
require('./m2-test-policy.cjs').assertM2TestProject('3790869794');
/* Native lifecycle diagnostic, limited to its own isolated readonly Web renderer. */
const electron = require('electron');
const { app, BrowserWindow, nativeImage } = electron;
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { prepareFeatureEvidenceRoot } = require('./m2-feature-boundary.cjs');
const [workspaceArg, libraryArg, outputArg] = process.argv.slice(2);
if (![workspaceArg, libraryArg, outputArg].every(Boolean)) throw Error('workspace, readonly library and fresh evidence directory required');
const workspace = path.resolve(workspaceArg), library = path.resolve(libraryArg), root = prepareFeatureEvidenceRoot(workspace, outputArg);
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
const report = { scope: 'isolated-web-native-freeze-diagnostic', at: new Date().toISOString(),
  pid: process.pid, codexHostsVerified: false, productionSwitchIntegrated: false, phases: [], attachedFrames: [] };
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
let owner, win, contextId;
async function bounded(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('diagnostic_timeout')), 45000); })]); }
  finally { clearTimeout(timer); }
}
function difference(a, b) {
  const pa = nativeImage.createFromBuffer(a).toBitmap(), pb = nativeImage.createFromBuffer(b).toBitmap();
  if (!pa.length || pa.length !== pb.length) throw Error('invalid_native_pixels');
  let changed = 0;
  for (let i = 0; i < pa.length; i += 4) if (Math.abs(pa[i] - pb[i]) + Math.abs(pa[i + 1] - pb[i + 1]) + Math.abs(pa[i + 2] - pb[i + 2]) > 9) changed++;
  return changed / (pa.length / 4);
}
async function position() {
  const result = await bounded(win.webContents.debugger.sendCommand('Runtime.evaluate', {
    expression: "document.querySelector('#track')?.getBoundingClientRect().x??null", contextId, returnByValue: true,
  }));
  return typeof result.result?.value === 'number' ? result.result.value : null;
}
async function phase(name, before, stayHidden) {
  await before(); await delay(350);
  const x1 = await position(), a = (await bounded(win.webContents.capturePage(undefined, { stayHidden }))).toPNG();
  await delay(500);
  const x2 = await position(), b = (await bounded(win.webContents.capturePage(undefined, { stayHidden }))).toPNG();
  await fs.writeFile(path.join(root, name + '-a.png'), a, { flag: 'wx' });
  await fs.writeFile(path.join(root, name + '-b.png'), b, { flag: 'wx' });
  report.phases.push({ name, stayHidden, nativeChangedRatio: difference(a, b), authorPositionBefore: x1, authorPositionAfter: x2 });
  await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
}
async function main() {
  await app.whenReady();
  const { EngineRendererOwner } = await import(pathToFileURL(path.join(workspace, 'dist/bridge-runtime/src/engine-renderer-owner.mjs')).href);
  owner = new EngineRendererOwner({ electron, project: { id: '3790869794', type: 'web', rootPath: path.join(library, '3790869794') } });
  await bounded(owner.ready); win = BrowserWindow.getAllWindows()[0];
  win.webContents.debugger.attach('1.3');
  const contexts = [];
  win.webContents.debugger.on('message', (_, method, params) => {
    if (method === 'Target.attachedToTarget') report.attachedFrames.push({ type: params.targetInfo.type, loopback: params.targetInfo.url.startsWith('http://127.0.0.1:') });
    if (method === 'Runtime.executionContextCreated') contexts.push(params.context);
  });
  await bounded(win.webContents.debugger.sendCommand('Runtime.enable'));
  const sourceOrigin = new URL(win.webContents.mainFrame.frames[0].url).origin;
  contextId = contexts.find((context) => context.origin === sourceOrigin && context.auxData?.isDefault)?.id;
  if (!contextId) throw Error('source_context_missing');
  await bounded(win.webContents.debugger.sendCommand('Target.setAutoAttach', { autoAttach: true, flatten: true, waitForDebuggerOnStart: false }));
  await phase('running', async () => {}, false);
  await phase('legacy-root-freeze', () => owner.pause(), false);
  await phase('root-freeze-hidden-capture', () => win.webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' }), true);
  await phase('hidden-lifecycle-and-capture', async () => {
    win.webContents.setBackgroundThrottling(true);
    await bounded(win.webContents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' }));
  }, true);
  await phase('resume-native-owner', async () => { win.webContents.setBackgroundThrottling(false); await owner.resume(); }, false);
  await phase('native-script-and-animation-suspend', async () => {
    await bounded(win.webContents.debugger.sendCommand('Animation.enable'));
    await bounded(win.webContents.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 0 }));
    await bounded(win.webContents.debugger.sendCommand('Debugger.enable', { maxScriptsCacheSize: 0 }));
    const paused = new Promise((resolve) => {
      const onMessage = (_, method) => {
        if (method === 'Debugger.paused') { win.webContents.debugger.removeListener('message', onMessage); report.scriptPausedAcknowledged = true; resolve(); }
      };
      win.webContents.debugger.on('message', onMessage);
    });
    await bounded(Promise.all([paused, win.webContents.debugger.sendCommand('Debugger.pause')]));
  }, false);
  // Separate a pending pre-pause compositor submission from a running author loop.
  // This second interval keeps the same native pause and uses fresh real captures.
  await phase('native-suspension-after-compositor-drain', async () => {}, false);
  await phase('native-script-and-animation-resume', async () => {
    await bounded(win.webContents.debugger.sendCommand('Animation.setPlaybackRate', { playbackRate: 1 }));
    await bounded(win.webContents.debugger.sendCommand('Debugger.resume'));
  }, false);
  report.outcome = 'diagnosed';
}
main().catch((error) => { report.outcome = 'fail'; report.error = String(error.message).slice(0, 160); })
  .finally(async () => {
    try { await owner?.release(); report.resourcesClosed = owner?.status().resourcesClosed; report.remainingWindows = BrowserWindow.getAllWindows().length; }
    catch { report.cleanupFailed = true; }
    report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    app.exit(report.outcome === 'diagnosed' ? 0 : 1);
  });
