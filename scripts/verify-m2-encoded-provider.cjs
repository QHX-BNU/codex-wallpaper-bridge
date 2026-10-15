/* Actual compiled owner -> VP8 -> UtilityProcess -> sandbox CPU decoder.
 * Does not attach to Codex or change the daily Scene/M1 selector.
 */
const electron = require('electron');
const { app, BrowserWindow, utilityProcess, nativeImage, session, ipcMain } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises'), fsSync = require('node:fs'), path = require('node:path');
const { createServer } = require('node:http'), { randomBytes, createHash } = require('node:crypto'), { pathToFileURL } = require('node:url');
const { prepareFeatureEvidenceRoot } = require('./m2-feature-boundary.cjs');
const [workspaceArg, libraryArg, outputArg] = process.argv.slice(2);
if (![workspaceArg, libraryArg, outputArg].every(Boolean)) throw Error('workspace, readonly library and fresh evidence directory required');
const workspace = path.resolve(workspaceArg), library = path.resolve(libraryArg), root = prepareFeatureEvidenceRoot(workspace, outputArg);
app.setPath('userData', path.join(root, 'profile')); app.on('window-all-closed', () => {});
fsSync.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
const report = { at: new Date().toISOString(), scope: 'isolated-real-encoded-provider-data-plane', artifact: 'compiled-desktop-host-owner-preload-and-client',
  electron: process.versions.electron, chromium: process.versions.chrome, codexHostsVerified: false, productionSwitchIntegrated: false,
  dailySceneEnabled: false, audibleOutputVerified: false, authorRendererIpcExposed: false, steps: [], samples: [] };
const owners = [], captures = new Map(), encoded = new Map(), previousSamples = new Map();
let child, childEnded = false, host, binding, surface, surfaceSession, server, clock, renderQueue = Promise.resolve(), requests = 0;
const mod = (relative) => import(pathToFileURL(path.join(workspace, relative)).href);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const normalized = (png) => nativeImage.createFromBuffer(png).resize({ width: 800, height: 450, quality: 'good' }).toBitmap();
function difference(a, b) {
  assert.equal(a.length, 1440000); assert.equal(b.length, a.length);
  let changed = 0, error = 0, nonblack = 0;
  for (let i = 0; i < a.length; i += 4) {
    const delta = Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]);
    if (delta > 12) changed++; error += delta; if (a[i] + a[i + 1] + a[i + 2] > 30) nonblack++;
  }
  return { changedRatio: changed / 360000, meanRgbError: error / 1080000, nonblackRatio: nonblack / 360000 };
}
async function bounded(promise, ms = 90000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('encoded_provider_probe_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function installDecoder() {
  const canvas = document.getElementById('surface'), ctx = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  const rgba = new Uint8ClampedArray(1440000), image = new ImageData(rgba, 800, 450); let pending;
  const config = { codec: 'vp8', codedWidth: 800, codedHeight: 450, hardwareAcceleration: 'prefer-software', optimizeForLatency: true };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) throw Error('decoder unavailable');
  const decoder = new VideoDecoder({ output(frame) {
    if (!pending || pending.frame || frame.timestamp !== pending.timestamp || frame.displayWidth !== 800 || frame.displayHeight !== 450) {
      frame.close(); if (pending) pending.invalid = true; return;
    }
    pending.frame = frame;
  }, error() { if (pending) pending.invalid = true; } }); decoder.configure(config);
  window.__nativeEncodedProbe = {
    async accept(packet) {
      if (pending || packet.timestamp !== packet.sequence * 100000) throw Error('invalid packet');
      pending = { timestamp: packet.timestamp }; const current = pending;
      try {
        const bytes = Uint8Array.from(atob(packet.vp8), (value) => value.charCodeAt(0));
        decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: packet.timestamp, duration: 100000, data: bytes })); await decoder.flush();
        if (!current.frame || current.invalid) throw Error('invalid decoded frame');
        await current.frame.copyTo(rgba, { format: 'RGBA', rect: { x: 0, y: 0, width: 800, height: 450 } }); ctx.putImageData(image, 0, 0);
        return { sequence: packet.sequence };
      } finally { current.frame?.close(); pending = null; }
    },
    close() { decoder.close(); canvas.remove(); return decoder.state; },
  };
}
async function render(message) {
  assert.ok(++requests <= 96); assert.equal(message.request, requests); assert.ok(message.packet?.vp8 instanceof Uint8Array);
  assert.ok(message.packet.vp8.length <= 2097152); assert.ok(!message.sample || /^[a-z0-9-]{1,32}$/.test(message.sample));
  const key = message.projectId + ':' + message.packet.sequence;
  const source = captures.get(key); assert.ok(source); assert.equal(hash(message.packet.vp8), encoded.get(key));
  const packet = { sequence: message.packet.sequence, timestamp: message.packet.timestamp, vp8: Buffer.from(message.packet.vp8).toString('base64') };
  let started = performance.now();
  const ack = await bounded(surface.webContents.executeJavaScript(`window.__nativeEncodedProbe.accept(${JSON.stringify(packet)})`), 5000);
  assert.equal(ack.sequence, packet.sequence);
  const decodeAckMs = performance.now() - started; started = performance.now();
  const result = { bytes: message.packet.vp8.length, sourceHash: hash(source.bgra), parentEncodedHashMatches: true,
    nativeCaptureMs: source.captureMs, parentEncodeTotalMs: source.encodeTotalMs, decodeAckMs };
  result.sourceHashMs = performance.now() - started;
  if (message.sample) {
    const sourcePng = source.nativeImage.toPNG(), raw = source.bgra;
    const nativeComparison = difference(raw, normalized(sourcePng)); assert.equal(nativeComparison.meanRgbError, 0);
    const image = await bounded(surface.webContents.capturePage(), 5000), png = image.toPNG(), pixels = normalized(png);
    const comparison = difference(raw, pixels); assert.ok(comparison.meanRgbError < 8);
    const previous = previousSamples.get(message.projectId);
    Object.assign(result, { meanRgbError: comparison.meanRgbError, exactRawSavedPngError: nativeComparison.meanRgbError, sourceNonblackRatio: difference(raw, raw).nonblackRatio,
      previousSampleChangedRatio: previous ? difference(previous, pixels).changedRatio : null });
    previousSamples.set(message.projectId, pixels);
    await fs.writeFile(path.join(root, message.sample + '-source.png'), sourcePng, { flag: 'wx' });
    await fs.writeFile(path.join(root, message.sample + '.bgra'), raw, { flag: 'wx' });
    await fs.writeFile(path.join(root, message.sample + '-decoded.png'), png, { flag: 'wx' });
    await fs.writeFile(path.join(root, message.sample + '.vp8'), message.packet.vp8, { flag: 'wx' });
    report.samples.push({ name: message.sample, projectId: message.projectId, sequence: packet.sequence, ...result });
  }
  captures.delete(key); encoded.delete(key); return result;
}
async function main() {
  await app.whenReady();
  const { EngineRendererOwner, createEngineFrameClock } = await mod('dist/bridge-runtime/src/engine-renderer-owner.mjs');
  const { createDesktopEngineHost } = await mod('dist/bridge-runtime/src/desktop-engine-host.mjs');
  const { ConfigStore } = await mod('bridge-runtime/src/config-store.mjs'), { scanWallpaperProjects } = await mod('bridge-runtime/src/scanner.mjs');
  const stateRoot = path.join(root, 'state'), store = new ConfigStore({ filePath: path.join(stateRoot, 'CodexWallpaperBridge/config.json') }); await store.load();
  // The only config save is this explicitly isolated test directory.
  await store.set({ selectedId: '3233141951' });
  const nonce = randomBytes(16).toString('hex'); let surfaceUrl;
  server = createServer((request, response) => {
    if (request.headers.host !== new URL(surfaceUrl).host || request.url !== '/' + nonce || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(403); response.end(); return; }
    response.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'");
    response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html><head><style>html,body{margin:0;overflow:hidden}canvas{display:block;width:800px;height:450px}</style></head><body><canvas id="surface" width="800" height="450"></canvas></body></html>');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve)); surfaceUrl = `http://127.0.0.1:${server.address().port}/${nonce}`;
  surfaceSession = session.fromPartition('cwb-encoded-probe-' + nonce);
  surfaceSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => callback({ cancel: details.url !== surfaceUrl }));
  surfaceSession.setPermissionRequestHandler((_wc, _permission, callback) => callback(false)); surfaceSession.setPermissionCheckHandler(() => false);
  surface = new BrowserWindow({ width: 800, height: 450, useContentSize: true, show: false,
    webPreferences: { session: surfaceSession, sandbox: true, contextIsolation: true, nodeIntegration: false, offscreen: true, backgroundThrottling: false } });
  surface.webContents.setWindowOpenHandler(() => ({ action: 'deny' })); clock = createEngineFrameClock(surface.webContents);
  await surface.loadURL(surfaceUrl); await bounded(surface.webContents.executeJavaScript(`(${installDecoder.toString()})()`), 5000);
  child = utilityProcess.fork(path.join(workspace, 'scripts/m2-encoded-provider-probe.mjs'), [workspace],
    { cwd: workspace, env: { ...process.env, CWB_NATIVE_ENGINE_PROVIDER: 'owned-parent-v1' }, stdio: 'pipe', serviceName: 'M2 isolated encoded provider probe' });
  report.utilityPid = child.pid; child.once('spawn', () => { report.utilityPid = child.pid; });
  child.stderr.on('data', (bytes) => { fsSync.appendFileSync(path.join(root, 'utility.stderr.log'), bytes); });
  const ended = new Promise((resolve) => child.once('exit', (code) => { childEnded = true; resolve(code); }));
  host = createDesktopEngineHost({ electron, env: { ...process.env, LOCALAPPDATA: stateRoot, XDG_CONFIG_HOME: stateRoot },
    scan: () => scanWallpaperProjects({ steamRoots: [path.resolve(library, '../../../..')] }),
    createOwner: (snapshot) => {
      const owner = new EngineRendererOwner({ electron, ...snapshot }); owner.projectId = snapshot.project.id; owners.push(owner);
      const capture = owner.captureRaw.bind(owner), captureEncoded = owner.captureEncoded.bind(owner);
      owner.captureRaw = async () => { const started = performance.now(), frame = await capture(); assert.ok(captures.size < 96); captures.set(owner.projectId + ':' + frame.sequence, { ...frame, captureMs: performance.now() - started }); return frame; };
      owner.captureEncoded = async () => {
        const started = performance.now();
        const pending = captureEncoded();
        if (owner.projectId === '1778944028') {
          // A real source window is destroyed during actual lazy codec startup, not a fake rejection.
          const sources = BrowserWindow.getAllWindows().filter((win) => win !== surface && !win.webContents.getLastWebPreferences().preload);
          assert.equal(sources.length, 1); sources[0].destroy(); report.actualSourceDestroyedDuringEncoding = true;
        }
        const frame = await pending; const key = owner.projectId + ':' + frame.sequence;
        captures.get(key).encodeTotalMs = performance.now() - started; encoded.set(key, hash(frame.vp8)); return frame;
      };
      return owner;
    },
  }); binding = host.attach(child);
  child.on('message', (message) => {
    if (message?.channel !== 'cwb-encoded-probe') return;
    if (message.event === 'frame') {
      renderQueue = renderQueue.then(() => render(message)).then((result) => child.postMessage({ channel: 'cwb-encoded-probe', event: 'frame-ack', request: message.request, ok: true, result }))
        .catch((error) => { report.renderError = String(error.message).slice(0, 160); child.postMessage({ channel: 'cwb-encoded-probe', event: 'frame-ack', request: message.request, ok: false }); });
    }
    if (message.event === 'step') {
      assert.ok(report.steps.length < 8); const windows = BrowserWindow.getAllWindows().length;
      assert.ok(windows <= 5); report.steps.push({ ...message, status: message.passed === false ? 'fail' : 'pass', nativeWindows: windows, slots: host.status().slots });
    }
    if (message.event === 'done') { report.probeOutcome = message.outcome; report.probeError = message.error; }
  });
  const code = await bounded(ended, 180000); await renderQueue; assert.equal(code, 0); assert.equal(report.probeOutcome, 'pass'); assert.equal(report.steps.length, 8);
  await binding.close(); await host.close(); report.desktopHost = host.status(); assert.equal(report.desktopHost.slots, 0); assert.equal(report.desktopHost.peers, 0);
  assert.equal(report.actualSourceDestroyedDuringEncoding, true); report.outcome = 'pass';
}
main().catch((error) => { report.outcome = 'fail'; report.error = String(error.message).slice(0, 240); })
  .finally(async () => {
    try {
      await binding?.close(); await host?.close(); for (const owner of owners) await owner.release();
      if (child && !childEnded) child.kill();
      report.owners = owners.map((owner) => ({ id: owner.projectId, ...owner.status() }));
      report.resourcesClosed = report.owners.every((owner) => owner.resourcesClosed); assert.equal(report.resourcesClosed, true);
      report.encoderListenersRemoved = ipcMain.listenerCount('cwb-engine-vp8-encoded-v1') === 0; assert.equal(report.encoderListenersRemoved, true);
      if (surface && !surface.isDestroyed()) { report.decoderClosed = await surface.webContents.executeJavaScript('window.__nativeEncodedProbe.close()'); assert.equal(report.decoderClosed, 'closed'); }
      clock?.release(); if (surface && !surface.isDestroyed()) surface.destroy();
      if (server) { server.closeAllConnections(); await new Promise((resolve) => server.close(resolve)); }
      if (surfaceSession) await Promise.all([surfaceSession.clearCache(), surfaceSession.clearStorageData()]);
      captures.clear(); encoded.clear(); previousSamples.clear(); report.parentCachesCleared = true;
      report.remainingWindows = BrowserWindow.getAllWindows().length; assert.equal(report.remainingWindows, 0);
    } catch (error) { report.cleanupFailed = true; report.cleanupError = String(error.message).slice(0, 160); report.outcome = 'fail'; }
    report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    app.exit(report.outcome === 'pass' ? 0 : 1);
  });
