// Offscreen fixture only: never opens/restores a window or touches a Codex host.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [root, url, resourceProbe] = process.argv.slice(2);
const workspace = path.resolve(__dirname, '..');
const relative = root && path.relative(path.join(workspace, 'out', 'live-acceptance'), path.resolve(root));
if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}\/$/.test(url || '')) process.exit(2);
if (resourceProbe !== undefined && resourceProbe !== '--resource-probe') process.exit(2);
app.setPath('userData', path.join(root, 'offscreen-profile'));
let window;
app.whenReady().then(async () => {
  window = new BrowserWindow({ show: false, width: 640, height: 360,
    webPreferences: { offscreen: true, backgroundThrottling: false, contextIsolation: true, sandbox: true, nodeIntegration: false } });
  window.webContents.setFrameRate(20);
  window.webContents.on('paint', () => {});
  window.webContents.on('render-process-gone', () => { fs.writeFileSync(path.join(root, 'background-state.json'), JSON.stringify({ rendererGone: true, visible: window.isVisible() })); app.exit(3); });
  window.webContents.on('did-fail-load', (_event, code) => fs.writeFileSync(path.join(root, 'background-state.json'), JSON.stringify({ loadError: code, visible: window.isVisible() })));
  await window.loadURL(url);
  if (resourceProbe) window.webContents.debugger.attach('1.3'); // this owned fixture only
  fs.writeFileSync(path.join(root, 'background-state.json'), JSON.stringify({ loaded: true, visible: window.isVisible(), offscreen: window.webContents.isOffscreen() }));
}).catch(() => app.exit(2));
let memoryBusy = false;
const memorySeen = new Set();
async function sampleMemory() {
  if (!resourceProbe || memoryBusy || !window?.webContents.debugger.isAttached()) return;
  const request = path.join(root, 'background-memory-request');
  if (!fs.existsSync(request)) return;
  const label = fs.readFileSync(request, 'utf8');
  if (!['start', 'end'].includes(label) || memorySeen.has(label)) return;
  memorySeen.add(label); memoryBusy = true;
  try {
    // Diagnostic GC distinguishes retained JS/DOM from transient allocations;
    // it is not a product GC workaround or a no-leak acceptance claim.
    await window.webContents.debugger.sendCommand('HeapProfiler.collectGarbage');
    const heap = await window.webContents.debugger.sendCommand('Runtime.getHeapUsage');
    const dom = await window.webContents.debugger.sendCommand('Memory.getDOMCounters');
    const processes = app.getAppMetrics().map(({ pid, type, memory }) => ({ pid, type, memoryKiB: memory }));
    fs.writeFileSync(path.join(root, `background-memory-${label}.json`), JSON.stringify({ at: Date.now(), forcedDiagnosticGc: true,
      heap, dom, node: process.memoryUsage(), processes }));
  } catch {
    fs.writeFileSync(path.join(root, `background-memory-${label}.json`), JSON.stringify({ failed: true, reason: 'owned_memory_probe_failed' }));
  } finally { memoryBusy = false; }
}
setInterval(() => { void sampleMemory(); }, 150).unref();
setInterval(() => { if (fs.existsSync(path.join(root, 'background-stop'))) app.quit(); }, 150).unref();
setTimeout(() => app.exit(4), 35 * 60 * 1000).unref(); // bounded focused soak, still never shown
app.on('window-all-closed', () => app.quit());
