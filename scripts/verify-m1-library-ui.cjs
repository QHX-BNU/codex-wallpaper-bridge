/* Isolated Electron UI smoke. Never starts/connects/closes a Codex process. */
const { app, BrowserWindow, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const workspace = path.resolve(__dirname, '..');
const evidenceParent = path.join(workspace, 'out', 'm1-20261009-library');
const runRoot = path.join(evidenceParent, `electron-${Date.now()}`);
require('node:fs').mkdirSync(path.join(runRoot, 'profile'), { recursive: true });
app.setPath('userData', path.join(runRoot, 'profile'));
app.setName('Wallpaper Library Acceptance');
// Keep the main process alive for explicit cleanup/reporting after the last test window closes.
app.on('window-all-closed', () => {});
const report = { startedAt: new Date().toISOString(), electron: process.versions.electron,
  chromium: process.versions.chrome, scope: 'isolated-electron-workbench-and-fixture-renderer',
  completeM0Gate: false, codexHostsVerified: false, steps: [], errors: [] };
let server;
const windows = [];

async function moduleAt(relative) { return import(pathToFileURL(path.join(workspace, relative)).href); }
async function bounded(promise, label, milliseconds = 10_000) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`${label} timed out`)), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}
async function step(name, operation) {
  report.currentStep = name;
  console.log(JSON.stringify({ step: name, status: 'started' }));
  await operation();
  report.steps.push({ name, status: 'pass' });
  await fs.writeFile(path.join(runRoot, 'progress.json'), JSON.stringify(report, null, 2));
}
async function evaluate(win, expression) { return bounded(win.webContents.executeJavaScript(expression), 'fixture JavaScript'); }
async function wait(win, expression, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(win, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  }
  throw new Error(`UI wait timed out: ${expression.slice(0, 150)}`);
}
async function click(win, selector) {
  const box = await evaluate(win, `(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.disabled || el.hidden) throw new Error('control not actionable');
    el.scrollIntoView({block:'nearest'}); const r = el.getBoundingClientRect();
    return {x:r.x+r.width/2,y:r.y+r.height/2,width:r.width,height:r.height};
  })()`);
  assert.ok(box.width > 0 && box.height > 0);
  for (const type of ['mousePressed', 'mouseReleased']) {
    await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
}
async function setFiles(win, files) {
  const { root } = await win.webContents.debugger.sendCommand('DOM.getDocument', {});
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: root.nodeId, selector: '#importWallpapersInput' });
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files });
}
async function capture(win, name) {
  // Hidden windows can expose an old surface; prime it, then take a fresh native snapshot.
  await bounded(win.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true }), 'snapshot warmup');
  await new Promise((resolve) => setTimeout(resolve, 150));
  const shot = await bounded(win.webContents.capturePage(undefined, { stayHidden: false, stayAwake: true }), 'native snapshot');
  assert.ok(shot.toBitmap().some((value, index) => index % 4 !== 3 && value !== 0), 'snapshot is blank');
  await fs.writeFile(path.join(runRoot, name), shot.toPNG(), { flag: 'wx' });
}
async function createWindow(url) {
  const win = new BrowserWindow({ width: 1360, height: 920, show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false } });
  windows.push(win);
  const loading = win.loadURL(url);
  let timer;
  try {
    await Promise.race([loading, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('isolated renderer load timed out')), 20_000);
    })]);
  } finally { clearTimeout(timer); }
  win.webContents.debugger.attach('1.3');
  await bounded(win.webContents.debugger.sendCommand('Page.enable'), 'fixture debugger initialization');
  return win;
}

async function main() {
  await app.whenReady();
  const { ConfigStore } = await moduleAt('bridge-runtime/src/config-store.mjs');
  const { createMediaServer } = await moduleAt('bridge-runtime/src/media-server.mjs');
  const { buildInjectionPlan } = await moduleAt('bridge-overrides/src/injection-plan.mjs');
  const { buildRestoreScript } = await moduleAt('bridge-overrides/src/injected-renderer.mjs');
  const store = new ConfigStore({ filePath: path.join(runRoot, 'config.json') });
  const fixturePublic = path.join(runRoot, 'public');
  await fs.cp(path.join(workspace, 'bridge-runtime', 'public'), fixturePublic, { recursive: true });
  server = createMediaServer({ configStore: store, publicDir: fixturePublic });
  await server.start();
  const bitmap = nativeImage.createFromBitmap(Buffer.from([32, 128, 255, 255]), { width: 1, height: 1 });
  assert.equal(bitmap.isEmpty(), false);
  const png = bitmap.toPNG();
  const pngPath = path.join(runRoot, 'fixture.png');
  const jpgPath = path.join(runRoot, 'fixture.jpg');
  await fs.writeFile(pngPath, png);
  await fs.writeFile(jpgPath, bitmap.toJPEG(85));
  console.log(JSON.stringify({ phase: 'fixtures-and-server-ready' }));
  let win = await createWindow(server.baseUrl);
  await wait(win, `document.querySelector('#connectionStatus')?.dataset.state==='connected'`);
  await step('Chromium file input imports genuine PNG and JPG through streaming HTTP', async () => {
    await setFiles(win, [pngPath, jpgPath]);
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===2 && document.querySelector('#assetTaskText').textContent.includes('fixture.jpg') && !document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    assert.equal(store.get().library.assets.length, 2);
    assert.equal(await evaluate(win, `document.querySelector('#errorBanner').hidden`), true);
  });
  await step('Duplicate bytes do not add a second resource', async () => {
    await setFiles(win, [pngPath]);
    await wait(win, `document.querySelector('#assetTaskText').textContent.includes('fixture.png') && document.querySelector('#assetTaskText').textContent.includes('completed') && !document.querySelector('#importWallpapersButton').disabled`);
    assert.equal(store.get().library.assets.length, 2);
  });
  const imageId = store.get().library.assets.find((asset) => asset.fileName.endsWith('.png')).id;
  const card = `.wallpaper-card[data-id="${imageId}"]`;
  await step('Actual card click selects and decodes the image in the workbench', async () => {
    await click(win, card);
    await wait(win, `document.querySelector('#backgroundImage').naturalWidth===1 && !document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    assert.equal(store.get().selectedId, imageId);
  });
  await step('Production bootstrap/apply decodes image in a controlled media child; restore releases it', async () => {
    const host = await createWindow('data:text/html,<html><body><main id="root">Runtime fixture</main></body></html>');
    const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
    const plan = buildInjectionPlan({ server, config: store.get(), inventory });
    assert.ok(plan.metrics.bootstrapBytes < 100 * 1024 && plan.metrics.applyBytes < 10 * 1024);
    await evaluate(host, plan.bootstrapScript);
    const applied = await evaluate(host, plan.applyScript);
    assert.equal(applied.ok, true);
    await wait(host, `document.querySelector('#codex-wallpaper-bridge-media')?.contentDocument?.querySelector('img')?.naturalWidth===1`);
    await evaluate(host, buildRestoreScript());
    assert.equal(await evaluate(host, `Boolean(document.querySelector('#codex-wallpaper-bridge-root'))`), false);
    host.close();
  });
  await click(win, '#libraryTools > summary');
  await step('Bulk hide and single restore use UI controls and do not remove original bytes', async () => {
    await click(win, `${card} + .asset-controls .asset-mark`);
    await click(win, '#batchHideButton');
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===1 && !document.querySelector('#importWallpapersButton').disabled`);
    assert.ok(store.get().library.hiddenIds.includes(imageId));
    assert.equal((await fs.stat(pngPath)).size, png.length);
    await click(win, '#hiddenViewInput');
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===1 && document.querySelector('.asset-restore').hidden===false`);
    await click(win, '.asset-restore');
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===0 && !document.querySelector('#importWallpapersButton').disabled`);
    assert.deepEqual(store.get().library.hiddenIds, []);
    await click(win, '#hiddenViewInput');
  });
  await step('Content policy checkbox excludes and restores ungraded resources', async () => {
    await click(win, '#ratingPolicyInputs input[value="unrated"]');
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===0 && !document.querySelector('#importWallpapersButton').disabled`);
    assert.equal(store.get().selectedId, null);
    await click(win, '#ratingPolicyInputs input[value="unrated"]');
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===2 && !document.querySelector('#importWallpapersButton').disabled`);
  });
  const parent = path.join(runRoot, 'destination');
  await fs.mkdir(parent);
  await step('Directory migration from real UI copies/verifies indexed resources and retains rollback files', async () => {
    await evaluate(win, `document.querySelector('#libraryDirectoryInput').focus()`);
    await win.webContents.insertText(parent);
    await click(win, '#migrateLibraryButton');
    await wait(win, `document.querySelector('#libraryConfirmDialog').open`);
    await click(win, '#libraryConfirmAcceptButton');
    await wait(win, `document.querySelector('#assetTaskText').textContent.includes('资源目录迁移') && document.querySelector('#assetTaskText').textContent.includes('completed') && !document.querySelector('#importWallpapersButton').disabled`);
    assert.equal(store.get().library.directory, path.join(parent, 'CodexWallpaperBridge-library'));
    for (const asset of store.get().library.assets) {
      assert.equal((await fs.stat(path.join(store.get().library.directory, asset.fileName))).size, asset.size);
      assert.equal((await fs.stat(path.join(runRoot, 'assets', asset.fileName))).size, asset.size);
    }
  });
  await step('Workbench reload plus a new ConfigStore preserve resource index/location/policy', async () => {
    win.close();
    win = await createWindow(server.baseUrl);
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===2 && document.querySelector('#connectionStatus').dataset.state==='connected'`);
    const restarted = new ConfigStore({ filePath: store.filePath });
    await restarted.load();
    assert.deepEqual(restarted.get(), store.get());
    await capture(win, 'workbench.png');
    const errors = await evaluate(win, `Array.from(document.querySelectorAll('.toast.is-error')).map(el=>el.textContent)`);
    assert.deepEqual(errors, []);
  });
  await step('UI removal confirms and deletes only the indexed managed copy', async () => {
    await click(win, `${card} + .asset-controls .asset-remove`);
    await wait(win, `document.querySelector('#libraryConfirmDialog').open`);
    await click(win, '#libraryConfirmAcceptButton');
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===1 && !document.querySelector('#importWallpapersButton').disabled`);
    assert.equal(store.get().library.assets.length, 1);
    assert.equal((await fs.stat(pngPath)).size, png.length);
  });
  await step('Real WE MP4 is read-only copied to a fixture and imported via the Chromium file input', async () => {
    const { scanWallpaperProjects } = await moduleAt('bridge-runtime/src/scanner.mjs');
    const inventory = await scanWallpaperProjects();
    const candidates = [];
    for (const project of inventory.projects.filter((item) => item.type === 'video' && item.mediaPath?.toLowerCase().endsWith('.mp4'))) {
      const info = await fs.stat(project.mediaPath).catch(() => null);
      if (info?.isFile() && info.size <= 100 * 1024 ** 2) candidates.push({ project, size: info.size });
    }
    candidates.sort((a, b) => a.size - b.size);
    assert.ok(candidates.length > 0, 'no read-only MP4 sample below 100 MiB is available');
    const videoPath = path.join(runRoot, 'fixture-video.mp4');
    await fs.copyFile(candidates[0].project.mediaPath, videoPath);
    await setFiles(win, [videoPath]);
    await wait(win, `document.querySelectorAll('.wallpaper-card').length===2 && document.querySelector('#assetTaskText').textContent.includes('fixture-video.mp4') && document.querySelector('#assetTaskText').textContent.includes('completed') && !document.querySelector('#importWallpapersButton').disabled`, 30_000);
    const video = store.get().library.assets.find((asset) => asset.type === 'video');
    assert.ok(video);
    assert.equal(video.size, candidates[0].size);
    const response = await fetch(new URL(`api/video/${encodeURIComponent(video.id)}`, server.baseUrl), { headers: { Range: 'bytes=0-15' } });
    assert.equal(response.status, 206);
    assert.equal(Buffer.from(await response.arrayBuffer()).toString('ascii', 4, 8), 'ftyp');
    report.realMp4ImportedBytes = video.size;
    report.videoPlaybackVerified = false;
    const types = await evaluate(win, `Array.from(document.querySelectorAll('.wallpaper-card__type')).map(el=>el.textContent)`);
    assert.deepEqual(types.sort(), ['IMAGE', 'VIDEO']);
    await capture(win, 'workbench-with-video.png');
  });
  await step('Desktop sandbox flags allow inline confirmation and same-origin library writes without allow-modals', async () => {
    const wrapper = path.join(fixturePublic, 'embedded-host.html');
    await fs.writeFile(wrapper, `<!doctype html><html><body style="margin:0"><iframe style="width:100vw;height:100vh;border:0" sandbox="allow-scripts allow-same-origin allow-forms" src="${server.baseUrl}"></iframe></body></html>`, { flag: 'wx' });
    const embedded = await createWindow(new URL('embedded-host.html', server.baseUrl).href);
    // Same-origin test wrapper lets the test invoke the real child's DOM APIs.
    // This validates sandbox flags, not the desktop file-origin IPC chain.
    const frame = { executeJavaScript: (expression) => evaluate(embedded,
      `document.querySelector('iframe').contentWindow.eval(${JSON.stringify(expression)})`) };
    async function waitFrame(expression) {
      const until = Date.now() + 10_000;
      while (Date.now() < until) {
        if (await bounded(frame.executeJavaScript(expression), 'embedded fixture JavaScript')) return;
        await new Promise((resolve) => setTimeout(resolve, 60));
      }
      throw new Error('embedded library UI wait timed out');
    }
    await waitFrame(`document.querySelectorAll('.wallpaper-card').length===2 && document.querySelector('#connectionStatus').dataset.state==='connected'`);
    const before = store.get();
    await bounded(frame.executeJavaScript(`document.querySelector('#libraryDirectoryInput').value=${JSON.stringify(parent)};
      document.querySelector('#migrateLibraryButton').click();`), 'embedded confirmation click');
    await waitFrame(`document.querySelector('#libraryConfirmDialog').open`);
    await bounded(frame.executeJavaScript(`document.querySelector('#libraryConfirmCancelButton').click()`), 'embedded cancel click');
    await waitFrame(`!document.querySelector('#libraryConfirmDialog').open`);
    assert.deepEqual(store.get(), before);
    await bounded(frame.executeJavaScript(`document.querySelector('.asset-mark').click(); document.querySelector('#batchHideButton').click();`), 'embedded hide click');
    await waitFrame(`document.querySelectorAll('.wallpaper-card').length===1 && !document.querySelector('#importWallpapersButton').disabled`);
    assert.equal(store.get().library.hiddenIds.length, 1);
    await bounded(frame.executeJavaScript(`document.querySelector('#restoreAllWallpapersButton').click()`), 'embedded restore click');
    await waitFrame(`document.querySelectorAll('.wallpaper-card').length===2 && !document.querySelector('#importWallpapersButton').disabled`);
    assert.deepEqual(store.get().library.hiddenIds, []);
    await capture(embedded, 'embedded-workbench.png');
    embedded.close();
  });
  report.outcome = 'pass';
}

main().catch((error) => {
  report.outcome = 'fail';
  report.errors.push(String(error.message).slice(0, 500));
}).finally(async () => {
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  try { await bounded(server?.close(), 'media server cleanup'); report.mediaServerClosed = true; }
  catch { report.mediaServerClosed = false; report.outcome = 'fail'; }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(runRoot, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ outcome: report.outcome, passedSteps: report.steps.length, runRoot, errors: report.errors }));
  app.exit(report.outcome === 'pass' ? 0 : 1);
});
