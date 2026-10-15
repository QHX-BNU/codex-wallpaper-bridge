/* Isolated Electron acceptance. No Codex discovery, injection, or daily config access. */
const { app, BrowserWindow, nativeImage } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const workspace = path.resolve(__dirname, '..');
const root = path.join(workspace, 'out', 'm1-20261010-playback', `electron-${Date.now()}`);
require('node:fs').mkdirSync(path.join(root, 'profile'), { recursive: true });
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
const report = { startedAt: new Date().toISOString(), scope: 'isolated-electron-playback',
  electron: process.versions.electron, chromium: process.versions.chrome,
  codexHostsVerified: false, nativeVisiblePlayback: false, fullDesktopIpcVerified: false,
  completeM0Gate: false, steps: [] };
const windows = [];
let server;
const mod = (relative) => import(pathToFileURL(path.join(workspace, relative)).href);
async function bounded(promise, label, ms = 10000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timeout`)), ms);
  })]); } finally { clearTimeout(timer); }
}
const evaluate = (win, expression) => bounded(win.webContents.executeJavaScript(expression), 'JavaScript');
async function wait(win, expression, ms = 15000) {
  const until = Date.now() + ms;
  do {
    if (await evaluate(win, expression)) return;
    await new Promise((resolve) => setTimeout(resolve, 60));
  } while (Date.now() < until);
  throw new Error(`wait timeout: ${expression.slice(0, 160)}`);
}
async function step(name, fn) {
  report.currentStep = name;
  await fn();
  report.steps.push({ name, status: 'pass' });
  await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
}
async function windowAt(url) {
  const win = new BrowserWindow({ width: 1360, height: 960, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  windows.push(win);
  await bounded(win.loadURL(url), 'window load', 20000);
  win.webContents.debugger.attach('1.3');
  return win;
}
async function click(win, selector) {
  await evaluate(win, `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  const point = await evaluate(win, `(() => { const e=document.querySelector(${JSON.stringify(selector)});
    if(!e||e.disabled||e.hidden)throw Error('not actionable'); e.scrollIntoView({block:'center'});
    const r=e.getBoundingClientRect(); const x=r.x+r.width/2,y=r.y+r.height/2;
    const hit=document.elementFromPoint(x,y); if(hit!==e&&!e.contains(hit))throw Error('native hit test intercepted: '+${JSON.stringify(selector)});
    return {x,y}; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await win.webContents.debugger.sendCommand('Input.dispatchMouseEvent', {
    type, ...point, button: 'left', clickCount: 1,
  });
}
async function numeric(win, selector, value) {
  await click(win, selector);
  await evaluate(win, `document.querySelector(${JSON.stringify(selector)}).select()`);
  await win.webContents.insertText(String(value));
}
async function selectValue(win, selector, value) {
  // Select adapters are programmatic DOM input/change; mouse, text and file input paths are real Chromium events.
  await evaluate(win, `(()=>{const e=document.querySelector(${JSON.stringify(selector)});e.value=${JSON.stringify(value)};e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`);
}
async function setFile(win, selector, file) {
  const { root: dom } = await win.webContents.debugger.sendCommand('DOM.getDocument');
  const { nodeId } = await win.webContents.debugger.sendCommand('DOM.querySelector', { nodeId: dom.nodeId, selector });
  await win.webContents.debugger.sendCommand('DOM.setFileInputFiles', { nodeId, files: [file] });
}
async function capture(win, name) {
  await evaluate(win, `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
  await bounded(win.webContents.capturePage(), 'capture warmup');
  await new Promise((r) => setTimeout(r, 120));
  await fs.writeFile(path.join(root, `${name}.png`), (await bounded(win.webContents.capturePage(), 'capture')).toPNG());
}
async function main() {
  await app.whenReady();
  const { ConfigStore } = await mod('bridge-runtime/src/config-store.mjs');
  const { createMediaServer } = await mod('bridge-runtime/src/media-server.mjs');
  const { buildInjectionPlan } = await mod('bridge-overrides/src/injection-plan.mjs');
  const { buildRestoreScript } = await mod('bridge-overrides/src/injected-renderer.mjs');
  const imagePath = path.join(root, 'fixture.png');
  const videoPath = path.join(root, 'fixture-video.mp4');
  const otherImagePath = path.join(root, 'fixture-b.png');
  const badImagePath = path.join(root, 'decode-bad.png');
  await fs.writeFile(imagePath, nativeImage.createFromBitmap(Buffer.from([255, 80, 30, 255, 30, 100, 255, 255]), { width: 2, height: 1 }).toPNG());
  await fs.writeFile(otherImagePath, nativeImage.createFromBitmap(Buffer.from([30, 180, 100, 255, 230, 60, 210, 255]), { width: 2, height: 1 }).toPNG());
  await fs.writeFile(badImagePath, 'present file, invalid PNG');
  await fs.copyFile(path.join(workspace, 'out', 'm1-20261009-library', 'electron-1791539851579', 'fixture-video.mp4'), videoPath);
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') });
  await store.load();
  server = createMediaServer({ configStore: store, projects: [
    ...['image-a', 'image-b'].map((id) => ({ id, title: id, type: 'image', rootPath: root,
      mediaPath: id === 'image-b' ? otherImagePath : imagePath, previewPath: imagePath, playable: true })),
    { id: 'video-a', title: 'video-a', type: 'video', rootPath: root, mediaPath: videoPath, previewPath: imagePath, playable: true },
    { id: 'bad-image', title: 'bad-image', type: 'image', rootPath: root, mediaPath: path.join(root, 'missing.png'), playable: true },
    { id: 'decode-bad', title: 'decode-bad', type: 'image', rootPath: root, mediaPath: badImagePath, playable: true },
  ] });
  await server.start();
  const win = await windowAt(server.baseUrl);
  await wait(win, `document.querySelector('#connectionStatus')?.dataset.state==='connected'&&document.querySelector('.wallpaper-card')`);
  await click(win, '.wallpaper-card');
  await wait(win, `document.querySelector('#backgroundImage').naturalWidth===2`);
  await step('Actual numeric controls persist all new effects and audio off retains volume', async () => {
    for (const [selector, value] of Object.entries({ positionXNumber: 17, positionYNumber: 81, zoomNumber: 123,
      playbackRateNumber: 1.5, contrastNumber: 137, opacityNumber: 68, volumeNumber: 37 })) await numeric(win, `#${selector}`, value);
    await click(win, '#mirrorInput');
    await click(win, '#audioEnabledInput');
    await wait(win, `!document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    assert.deepEqual([store.get().effects.positionX, store.get().effects.positionY, store.get().effects.zoom], [17, 81, 123]);
    assert.deepEqual([store.get().effects.playbackRate, store.get().effects.contrast, store.get().effects.opacity], [1.5, 137, 68]);
    assert.equal(store.get().effects.mirror, true);
    await click(win, '#audioEnabledInput');
    await wait(win, `!document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    assert.equal(store.get().effects.audioEnabled, false);
    assert.equal(store.get().effects.volume, 37);
  });
  await step('Production serialized runtime applies transforms and same-media effects without recreation', async () => {
    const host = await windowAt('data:text/html,<html><body>Controlled renderer</body></html>');
    const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
    let plan = buildInjectionPlan({ server, config: store.get(), inventory });
    await evaluate(host, plan.bootstrapScript);
    assert.equal((await evaluate(host, plan.applyScript)).ok, true);
    await wait(host, `document.querySelector('#codex-wallpaper-bridge-media')?.contentDocument?.querySelector('img')?.naturalWidth===2`);
    await evaluate(host, `window.oldFrame=document.querySelector('#codex-wallpaper-bridge-media')`);
    await store.set({ effects: { zoom: 151, opacity: 0 } });
    plan = buildInjectionPlan({ server, config: store.get(), inventory });
    await evaluate(host, plan.applyScript);
    await wait(host, `document.querySelector('#codex-wallpaper-bridge-media').contentDocument.querySelector('img').style.transform.includes('1.51')`);
    assert.equal(await evaluate(host, `window.oldFrame===document.querySelector('#codex-wallpaper-bridge-media')`), true);
    assert.equal(await evaluate(host, `getComputedStyle(window.oldFrame).opacity`), '0');
    await evaluate(host, buildRestoreScript());
    assert.equal(await evaluate(host, `Boolean(document.querySelector('#codex-wallpaper-bridge-root'))`), false);
    host.destroy();
  });
  await step('Production runtime rejects failed media without replacing old frame and rapid switching retains newest', async () => {
    const host = await windowAt('data:text/html,<html><body>Switch fixture</body></html>');
    const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
    const planFor = (id) => buildInjectionPlan({ server, config: { ...store.get(), selectedId: id }, inventory });
    await evaluate(host, planFor('image-a').bootstrapScript);
    await evaluate(host, planFor('image-a').applyScript);
    await wait(host, `window.__codexWallpaperBridgeRuntime.status().switch.state==='ready'`);
    await evaluate(host, `window.oldFrame=document.querySelector('#codex-wallpaper-bridge-media')`);
    assert.equal((await evaluate(host, planFor('bad-image').applyScript)).ok, false);
    assert.equal(await evaluate(host, `window.oldFrame===document.querySelector('#codex-wallpaper-bridge-media')`), true);
    await evaluate(host, `void ${planFor('image-b').applyScript};void ${planFor('image-a').applyScript}`);
    await wait(host, `window.__codexWallpaperBridgeRuntime.status().switch.slots===1&&window.__codexWallpaperBridgeRuntime.status().switch.identity.includes('image-a')`);
    assert.equal(await evaluate(host, `document.querySelectorAll('#codex-wallpaper-bridge-root>iframe').length`), 1);
    await evaluate(host, buildRestoreScript());
    assert.equal(await evaluate(host, `Boolean(document.querySelector('#codex-wallpaper-bridge-root'))`), false);
    host.destroy();
  });
  await step('Controlled video decodes, advances, and rate/audio updates keep the same frame', async () => {
    await click(win, '#pauseWhenHiddenInput');
    await click(win, '.wallpaper-card[data-id="video-a"]');
    await wait(win, `document.querySelector('#backgroundVideo')?.videoWidth>0&&document.querySelector('#backgroundVideo').currentTime>0.3&&!document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    const host = await windowAt('data:text/html,<html><body>Video fixture</body></html>');
    const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
    let plan = buildInjectionPlan({ server, config: store.get(), inventory });
    await evaluate(host, plan.bootstrapScript);
    await evaluate(host, plan.applyScript);
    await wait(host, `document.querySelector('#codex-wallpaper-bridge-media')?.contentDocument?.querySelector('video')?.currentTime>0.3&&window.__codexWallpaperBridgeRuntime.status().switch.state==='ready'`);
    await evaluate(host, `window.oldFrame=document.querySelector('#codex-wallpaper-bridge-media')`);
    await store.set({ effects: { playbackRate: 2, volume: 29 } });
    plan = buildInjectionPlan({ server, config: store.get(), inventory });
    await evaluate(host, plan.applyScript);
    await wait(host, `document.querySelector('#codex-wallpaper-bridge-media').contentDocument.querySelector('video').playbackRate===2`);
    assert.equal(await evaluate(host, `window.oldFrame===document.querySelector('#codex-wallpaper-bridge-media')`), true);
    assert.equal(await evaluate(host, `window.oldFrame.contentDocument.querySelector('video').volume`), .29);
    assert.equal(await evaluate(host, `window.oldFrame.contentDocument.querySelector('video').muted`), true);
    report.controlledVideoTimeAdvance = true;
    await evaluate(host, buildRestoreScript());
    host.destroy();
    await store.set({ effects: { volume: 37 } });
  });
  await step('Reopened workbench and fresh config reader preserve all playback controls', async () => {
    const expected = store.get().effects;
    win.destroy();
    assert.equal((await new ConfigStore({ filePath: store.filePath }).load()).effects.volume, 37);
    const fresh = await windowAt(server.baseUrl);
    await wait(fresh, `document.querySelector('#zoomNumber').value===${JSON.stringify(String(expected.zoom))}`);
    assert.equal(await evaluate(fresh, `document.querySelector('#mirrorInput').checked`), true);
    await click(fresh, '#resetEffectsButton');
    await wait(fresh, `document.querySelector('#zoomNumber').value==='100'&&!document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    assert.deepEqual([store.get().effects.zoom, store.get().effects.mirror, store.get().effects.volume], [100, false, 50]);
    await evaluate(fresh, `new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)))`);
    await bounded(fresh.webContents.capturePage(), 'snapshot warmup');
    const shot = await bounded(fresh.webContents.capturePage(), 'snapshot');
    await fs.writeFile(path.join(root, 'workbench.png'), shot.toPNG());
  });
  const fresh = windows.at(-1);
  await click(fresh, '.wallpaper-card[data-id="image-a"]');
  await step('Playlist CRUD, ordering, real WE JSON file input and bounded async reading', async () => {
    await click(fresh, '#playlistTools>summary');
    await numeric(fresh, '#playlistNameInput', '列表一');
    await click(fresh, '#playlistCreateButton');
    await wait(fresh, `document.querySelector('#playlistSelect').options.length===1&&!window.__cwbPlaylistBusy`);
    await click(fresh, '#playlistAddCurrentButton');
    await wait(fresh, `document.querySelectorAll('#playlistEntries li').length===1&&!window.__cwbPlaylistBusy`);
    for (const id of ['image-b', 'decode-bad']) await click(fresh, `.wallpaper-card[data-id="${id}"] + .asset-controls .asset-mark`);
    await click(fresh, '#playlistAddMarkedButton');
    await wait(fresh, `document.querySelectorAll('#playlistEntries li').length===3&&!window.__cwbPlaylistBusy`);
    await click(fresh, '#playlistEntries li:nth-child(3) button:first-of-type');
    await wait(fresh, `document.querySelector('#playlistEntries li:nth-child(2) span').textContent.includes('decode-bad')&&!window.__cwbPlaylistBusy`);
    assert.deepEqual(store.get().playlists.items[0].ids, ['image-a', 'decode-bad', 'image-b']);
    await numeric(fresh, '#playlistNameInput', '重命名一'); await click(fresh, '#playlistRenameButton');
    await wait(fresh, `document.querySelector('#playlistSelect').textContent.includes('重命名一')&&!window.__cwbPlaylistBusy`);
    const jsonPath = path.join(root, 'we-playlist.json');
    await fs.writeFile(jsonPath, JSON.stringify({ name: 'WE文件', items: ['image-a', 'image-b', '../unknown'] }));
    await evaluate(fresh, `window.originalFileText=File.prototype.text;File.prototype.text=async function(){await new Promise(r=>setTimeout(r,600));return window.originalFileText.call(this)};void 0`);
    await setFile(fresh, '#playlistImportInput', jsonPath);
    await wait(fresh, `window.__cwbPlaylistBusy===true`);
    await wait(fresh, `document.querySelector('#playlistSelect').options.length===2&&!window.__cwbPlaylistBusy`);
    assert.deepEqual(store.get().playlists.items[1].ids, ['image-a', 'image-b']);
    await evaluate(fresh, `File.prototype.text=async function(){throw Error('fixture read failure')};void 0`);
    await setFile(fresh, '#playlistImportInput', jsonPath);
    await wait(fresh, `document.querySelector('#toastRegion').textContent.includes('fixture read failure')&&!window.__cwbPlaylistBusy`);
    assert.equal(store.get().playlists.items.length, 2);
    await evaluate(fresh, `File.prototype.text=window.originalFileText;void 0`);
    await selectValue(fresh, '#playlistSelect', store.get().playlists.items[1].id);
    await wait(fresh, `!window.__cwbPlaylistBusy`);
    await click(fresh, '#playlistDeleteButton'); await wait(fresh, `document.querySelector('#libraryConfirmDialog').open`);
    await click(fresh, '#libraryConfirmAcceptButton');
    await wait(fresh, `document.querySelector('#playlistSelect').options.length===1&&!window.__cwbPlaylistBusy`);
  });
  await step('Preview decode failures roll back and skip without labelling the old frame as new', async () => {
    await click(fresh, '#playlistNextButton');
    await wait(fresh, `document.querySelector('.wallpaper-card.is-selected')?.dataset.id==='image-b'&&!window.__cwbPlaylistBusy`);
    assert.equal(store.get().selectedId, 'image-b');
    const status = await (await fetch(new URL('api/playlists?state=1', server.baseUrl))).json();
    assert.ok(status.status.failedIds.includes('decode-bad'));
    assert.equal(await evaluate(fresh, `document.querySelectorAll('.wallpaper__media[src]').length`), 1);
  });
  await step('Continuous timed rotation, pause/restart and random non-repeat use the same workbench media', async () => {
    await numeric(fresh, '#playlistIntervalInput', 5);
    await click(fresh, '#playlistTools>summary'); // Blur saves interval before the next independent click.
    await wait(fresh, `!window.__cwbPlaylistBusy`);
    await click(fresh, '#playlistTools>summary');
    await click(fresh, '#playlistEnabledInput');
    await wait(fresh, `document.querySelector('#playlistStatusText').textContent.includes('轮播运行中')&&!window.__cwbPlaylistBusy`);
    const first = store.get().selectedId;
    await wait(fresh, `document.querySelector('.wallpaper-card.is-selected')?.dataset.id!==${JSON.stringify(first)}`, 12000);
    const second = store.get().selectedId;
    await wait(fresh, `document.querySelector('.wallpaper-card.is-selected')?.dataset.id!==${JSON.stringify(second)}`, 12000);
    await click(fresh, '#playButton');
    await wait(fresh, `document.querySelector('#playlistStatusText').textContent.includes('用户已暂停')`);
    const paused = store.get().selectedId;
    await new Promise((r) => setTimeout(r, 5600)); assert.equal(store.get().selectedId, paused);
    await click(fresh, '#playButton'); await wait(fresh, `document.querySelector('#playlistStatusText').textContent.includes('轮播运行中')`);
    await selectValue(fresh, '#playlistOrderSelect', 'random'); await wait(fresh, `!window.__cwbPlaylistBusy`);
    const before = store.get().selectedId;
    await click(fresh, '#playlistNextButton'); await wait(fresh, `!window.__cwbPlaylistBusy`);
    assert.notEqual(store.get().selectedId, before); assert.equal(store.get().playlists.order, 'random');
    await click(fresh, '#playlistEnabledInput'); await wait(fresh, `!window.__cwbPlaylistBusy`);
  });
  await step('Hidden/rating policy filters rotation and insufficient lists keep the current frame', async () => {
    const other = store.get().selectedId === 'image-a' ? 'image-b' : 'image-a';
    const post = async (route, body) => { const response = await fetch(new URL(route, server.baseUrl), { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); assert.equal(response.status, 200); return response.json(); };
    await post('api/library/manage', { action: 'hide', ids: [other] });
    const before = store.get().selectedId; await click(fresh, '#playlistNextButton'); await wait(fresh, `!window.__cwbPlaylistBusy`);
    assert.equal(store.get().selectedId, before);
    await post('api/library/manage', { action: 'restore', ids: [other] });
    await post('api/library/manage', { action: 'rating', ids: [other], rating: 'mature' });
    await post('api/config', { library: { allowedRatings: ['unrated'] } });
    await click(fresh, '#playlistNextButton'); await wait(fresh, `!window.__cwbPlaylistBusy`); assert.equal(store.get().selectedId, before);
    await post('api/config', { library: { allowedRatings: ['unrated', 'mature'] } });
    await post('api/library/manage', { action: 'rating', ids: [other], rating: 'unrated' });
  });
  await step('Slow polling is single-flight and cannot override a newer manual selection', async () => {
    await evaluate(fresh, `window.originalPollFetch=fetch;window.pollActive=0;window.pollMax=0;window.pollCount=0;
      window.fetch=async function(input,init){if(String(input).includes('playlists?state=1')){window.pollCount++;window.pollActive++;window.pollMax=Math.max(window.pollMax,window.pollActive);
      try{const r=await window.originalPollFetch(input,init);await new Promise(r=>setTimeout(r,2500));return r}finally{window.pollActive--}}
      return window.originalPollFetch(input,init)};void 0`);
    await wait(fresh, `window.pollActive===1`);
    const other = store.get().selectedId === 'image-a' ? 'image-b' : 'image-a';
    await click(fresh, `.wallpaper-card[data-id="${other}"]`);
    await wait(fresh, `document.querySelector('.wallpaper-card.is-selected')?.dataset.id===${JSON.stringify(other)}&&!document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    await new Promise((r) => setTimeout(r, 5600));
    assert.equal(store.get().selectedId, other);
    assert.equal(await evaluate(fresh, `window.pollMax`), 1);
    assert.equal(await evaluate(fresh, `document.querySelector('.wallpaper-card.is-selected').dataset.id`), other);
    await evaluate(fresh, `window.fetch=window.originalPollFetch;void 0`);
  });
  await step('Seven production transitions render intermediate frames; reduced motion and restore release slots', async () => {
    const host = await windowAt('data:text/html,<html><body>Transition fixture</body></html>');
    const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
    const planFor = (id, transition, extra = {}) => buildInjectionPlan({ server, inventory, config: { ...store.get(), selectedId: id,
      effects: { ...store.get().effects, brightness: 100, saturation: 100, darkness: 0, dim: 0, opacity: 100, transition,
        transitionDurationMs: 1000, transitionDirection: 'left', reduceMotion: false, ...extra } } });
    await evaluate(host, planFor('image-a', 'cut').bootstrapScript); await evaluate(host, planFor('image-a', 'cut').applyScript);
    await wait(host, `window.__codexWallpaperBridgeRuntime.status().switch.state==='ready'`);
    await host.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    report.transitions = [];
    let current = 'image-a';
    for (const transition of ['cut', 'fade', 'push', 'wipe', 'iris', 'zoom', 'stripes']) {
      current = current === 'image-a' ? 'image-b' : 'image-a';
      const applied = await evaluate(host, planFor(current, transition).applyScript); assert.equal(applied.ok, true);
      const middle = await evaluate(host, `(()=>{const node=document.querySelector('#codex-wallpaper-bridge-media');const animations=document.querySelector('#codex-wallpaper-bridge-root').getAnimations({subtree:true});
        animations.forEach(a=>{a.pause();a.currentTime=500});return {kind:node.dataset.cwbTransition,count:animations.length,
          frames:animations.map(a=>a.effect.getKeyframes()),state:window.__codexWallpaperBridgeRuntime.status().switch}})()`);
      assert.equal(middle.kind, transition); assert.equal(middle.count, transition === 'cut' ? 0 : transition === 'push' ? 2 : 1);
      assert.equal(middle.state.slots, transition === 'cut' ? 1 : 2);
      await capture(host, `transition-${transition}-middle`);
      await evaluate(host, `document.querySelector('#codex-wallpaper-bridge-root').getAnimations({subtree:true}).forEach(a=>a.finish())`);
      await wait(host, `window.__codexWallpaperBridgeRuntime.status().switch.slots===1`);
      report.transitions.push(middle);
    }
    await host.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'reduce' }] });
    await evaluate(host, planFor('image-a', 'fade').applyScript);
    assert.equal(await evaluate(host, `document.querySelector('#codex-wallpaper-bridge-media').dataset.cwbTransition`), 'cut');
    await host.webContents.debugger.sendCommand('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }] });
    await evaluate(host, planFor('image-b', 'push', { reduceMotion: true }).applyScript);
    assert.equal(await evaluate(host, `window.__codexWallpaperBridgeRuntime.status().switch.slots`), 1);
    await evaluate(host, planFor('image-a', 'stripes').applyScript);
    await evaluate(host, buildRestoreScript());
    assert.equal(await evaluate(host, `Boolean(document.querySelector('#codex-wallpaper-bridge-root'))`), false);
    host.destroy();
    await selectValue(fresh, '#transitionSelect', 'wipe'); await selectValue(fresh, '#transitionDirectionSelect', 'down');
    await numeric(fresh, '#transitionDurationNumber', 450); await click(fresh, '#reduceMotionInput');
    await wait(fresh, `!document.querySelector('#saveIndicator').classList.contains('is-saving')`);
    assert.deepEqual([store.get().effects.transition, store.get().effects.transitionDirection, store.get().effects.transitionDurationMs, store.get().effects.reduceMotion], ['wipe', 'down', 450, true]);
    await capture(fresh, 'workbench-playlists-transitions');
  });
}
main().then(() => { report.outcome = 'pass'; }, (error) => {
  report.outcome = 'fail'; report.error = error.stack;
  return Promise.all(windows.filter((win) => !win.isDestroyed()).map(async (win) => {
    try { report.diagnostic = await evaluate(win, `({src:document.querySelector('#backgroundImage')?.src,
      width:document.querySelector('#backgroundImage')?.naturalWidth, error:document.querySelector('#errorMessage')?.textContent,
      selected:document.querySelector('.wallpaper-card.is-selected')?.dataset.id,
      values:[...document.querySelectorAll('[data-effect]')].map(e=>[e.dataset.effect,e.value,e.checked])})`); }
    catch {}
  }));
}).finally(async () => {
  for (const win of windows) if (!win.isDestroyed()) win.destroy();
  try { await bounded(server?.close(), 'server close'); report.mediaServerClosed = true; }
  catch (error) { report.outcome = 'fail'; report.cleanupError = error.message; }
  report.finishedAt = new Date().toISOString();
  await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ root, outcome: report.outcome, steps: report.steps.length, error: report.error }));
  app.exit(report.outcome === 'pass' ? 0 : 1);
});
