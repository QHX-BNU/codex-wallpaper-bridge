// Isolated Chromium/CSP regression. Never discovers or connects to real Codex.
const { app, BrowserWindow, protocol } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repo = path.resolve(__dirname, '..');
const output = path.resolve(process.argv[2] || '');
const relative = path.relative(path.join(repo, 'out'), output);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('An isolated output directory inside out is required');
const runtimeRoot = process.argv[3] ? path.resolve(process.argv[3]) : path.join(repo, 'bridge-overrides/src');
if (process.argv[3]) {
  const runtimeRelative = path.relative(path.join(repo, 'out'), runtimeRoot);
  if (!runtimeRelative || runtimeRelative.startsWith('..') || path.isAbsolute(runtimeRelative)) throw Error('Compiled fixture modules must stay inside out');
}
app.setPath('userData', path.join(output, 'profile'));
app.setPath('sessionData', path.join(output, 'profile', 'session'));
app.disableHardwareAcceleration();
protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
let win, server, injector;
const evidence = { scope: 'synthetic app://- only; no real Codex, daily configuration or user media', modes: [] };

app.whenReady().then(async () => {
  await fs.mkdir(output, { recursive: true });
  const { CdpWallpaperInjector } = await import(pathToFileURL(path.join(runtimeRoot, 'cdp-injector.mjs')));
  const { buildInjectionPlan } = await import(pathToFileURL(path.join(runtimeRoot, 'injection-plan.mjs')));
  const { buildBootstrapScript, buildApplyScript, buildRestoreScript } = await import(pathToFileURL(path.join(runtimeRoot, 'injected-renderer.mjs')));
  protocol.handle('app', () => new Response(`<!doctype html><html class="electron-light"><meta charset="utf-8">
    <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; img-src 'self' app: blob: data: https:; media-src 'self' app: blob: data: https:; frame-src 'self' blob:">
    <body><main id="root">Isolated media fixture</main></body></html>`, { headers: { 'Content-Type': 'text/html' } }));
  win = new BrowserWindow({ show: false, width: 640, height: 480, webPreferences: {
    offscreen: true, sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false,
  } });
  const evaluate = expression => win.webContents.executeJavaScript(expression, true);
  await win.loadURL('data:text/html,<html><body></body></html>');
  const video = Buffer.from(await evaluate(`(async () => {
    const canvas = document.createElement('canvas'); canvas.width=320; canvas.height=180; document.body.append(canvas);
    const ctx=canvas.getContext('2d'); const stream=canvas.captureStream(15), chunks=[];
    const recorder=new MediaRecorder(stream,{mimeType:'video/webm;codecs=vp8'});
    const done=new Promise(resolve=>{recorder.ondataavailable=e=>chunks.push(e.data);recorder.onstop=resolve;});
    let frame=0; const draw=()=>{ctx.fillStyle=frame++%2?'#6688cc':'#88bb99';ctx.fillRect(0,0,320,180);};
    draw(); recorder.start(); const timer=setInterval(draw,40);
    await new Promise(resolve=>setTimeout(resolve,650)); recorder.stop(); clearInterval(timer); await done;
    stream.getTracks().forEach(track=>track.stop()); return [...new Uint8Array(await new Blob(chunks).arrayBuffer())];
  })()`));
  assert.ok(video.length > 100);
  const image = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j4QAAAABJRU5ErkJggg==', 'base64');
  let requests = 0;
  server = http.createServer((request, response) => {
    requests++;
    const bytes = request.url.endsWith('/invalid') ? Buffer.from('not a video') : request.url.endsWith('/image') ? image : video;
    const range = /^bytes=(\d+)-(\d*)$/.exec(request.headers.range || '');
    const start = range ? Number(range[1]) : 0, end = range?.[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
    response.writeHead(range ? 206 : 200, { 'Content-Type': request.url.endsWith('/image') ? 'image/png' : 'video/webm',
      'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${bytes.length}` } : {}) });
    response.end(bytes.subarray(start, end + 1));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`, basePath = '/1234567890abcdef1234567890abcdef';
  const projects = ['video', 'invalid', 'image'].map(id => ({ id, type: id === 'image' ? 'image' : 'video', mediaUrl: `${basePath}/${id}` }));
  const plan = (id, options) => buildInjectionPlan({ server: { origin, basePath }, config: { selectedId: id }, inventory: { projects }, ...options });
  const snapshot = () => evaluate(`(() => {const media=document.getElementById('codex-wallpaper-bridge-media'); return {
    root:!!document.getElementById('codex-wallpaper-bridge-root'), tag:media?.tagName||null,
    width:media?.videoWidth||media?.naturalWidth||0, readyState:media?.readyState??null,
    state:globalThis.__codexWallpaperBridgeRuntime?.status().state||null,
    theme:document.documentElement.classList.contains('electron-dark')?'dark':'light' };})()`);

  await win.loadURL('app://-/fixture');
  await evaluate(`(async()=>{await ${buildBootstrapScript({ nativeEnabled: true, directSceneEnabled: true })};return true;})()`);
  const baseline = await evaluate(buildApplyScript({ wallpaper: { id: 'video', type: 'video', playable: 'video', mediaUrl: origin + basePath + '/video' } }));
  assert.equal(baseline.ok, false); assert.equal(requests, 0, 'official CSP must block uninitialized loopback media');
  evidence.cspBlockedWithoutInitialization = true;
  await evaluate(buildRestoreScript());

  for (const options of [{ nativeEnabled: true, directSceneEnabled: true }, { nativeEnabled: true }, {}]) {
    await win.loadURL('app://-/fixture');
    let reloads = 0;
    const statuses = [];
    injector = new CdpWallpaperInjector({ pollIntervalMs: 60000, verifyEndpoint: async () => ({ verified: true }),
      onStatus: status => statuses.push(status), socketFactory: () => ({ closed: false,
        async connect() { win.webContents.debugger.attach('1.3'); },
        async call(method, params = {}) { if (method === 'Page.reload') reloads++; return win.webContents.debugger.sendCommand(method, params); },
        onEvent(name, handler) { const receive = (_event, method, params) => { if (method === name) handler(params); };
          win.webContents.debugger.on('message', receive); return () => win.webContents.debugger.removeListener('message', receive); },
        close() { this.closed = true; if (win.webContents.debugger.isAttached()) win.webContents.debugger.detach(); },
      }) });
    injector.nativeDelivery = { close: async () => {} };
    injector.sceneDelivery = { close: async () => {} };
    injector.listTargets = async () => [{ id: 'isolated', type: 'page', url: 'app://-', webSocketDebuggerUrl: 'ws://127.0.0.1:9335/devtools/page/isolated' }];
    const first = await injector.start(plan('video', options));
    assert.equal(first.failed, 0); assert.equal(first.sessions, 1); assert.equal(reloads, 1);
    const after = await snapshot();
    // Hidden policy-paused documents must have actual decoded data, not a poster.
    assert.equal(after.state, 'ready'); assert.equal(after.theme, 'dark');
    if (options.nativeEnabled) { assert.equal(after.tag, 'VIDEO'); assert.equal(after.width, 320); assert.ok(after.readyState >= 2); }
    for (let pass = 0; pass < 3; pass++) {
      const reused = await injector.update(plan('video', options));
      assert.equal(reused.failed, 0, 'effect-only updates must verify reused media, not just avoid a reload');
      assert.equal((await snapshot()).state, 'ready');
    }
    assert.equal(reloads, 1);
    assert.equal((await injector.update(plan('image', options))).failed, 0);
    assert.equal((await injector.update(plan('video', options))).failed, 0);
    assert.equal((await injector.update(plan('invalid', options))).failed, 1);
    assert.equal((await snapshot()).root, true);
    if (options.nativeEnabled) assert.equal((await snapshot()).width, 320, 'decode failure must keep the committed video');
    await injector.restore();
    const restored = await snapshot(); assert.equal(restored.root, false); assert.equal(restored.theme, 'light'); assert.equal(reloads, 2);
    const beforeBlocked = requests;
    const blockedAgain = await evaluate(`new Promise(resolve=>{const v=document.createElement('video');v.onerror=()=>resolve(true);v.src=${JSON.stringify(origin + basePath + '/video')};document.body.append(v);})`);
    assert.equal(blockedAgain, true); assert.equal(requests, beforeBlocked, 'restore must reinstate official media CSP');
    evidence.modes.push({ options, firstMediaState: first.timings[0].mediaState, after, reloads, verifiedReusedApplies: 3,
      failedCandidateKeptOldMedia: true, restored, officialCspRestored: true });
    await injector.close(); injector = null;
  }
  evidence.ok = true;
}).catch(error => { evidence.ok = false; evidence.error = error.stack; process.exitCode = 1; }).finally(async () => {
  try { await injector?.close({ restore: true }); } catch {}
  win?.destroy();
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await fs.writeFile(path.join(output, 'proof.json'), JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify({ ok: evidence.ok, modes: evidence.modes.length, proof: path.join(output, 'proof.json'), error: evidence.error }));
  app.exit(evidence.ok ? 0 : 1);
});
