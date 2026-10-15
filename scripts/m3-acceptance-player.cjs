// Self-owned real Chromium/Windows media-session fixture. Never controls another app.
const { app, BrowserWindow, ipcMain, nativeImage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const [root, nonce, portText, label = 'A'] = process.argv.slice(2);
if (!root || !/^[a-f0-9-]+$/.test(nonce) || !/^\d+$/.test(portText)) process.exit(2);
app.setPath('userData', path.join(root, `player-${label}-profile`));
app.setAppUserModelId(`org.cwb.m3.acceptance.${nonce}.${label}`);
app.commandLine.appendSwitch('remote-debugging-address', '127.0.0.1');
app.commandLine.appendSwitch('remote-debugging-port', portText);
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
let window, lastRequest = 0, busy = false;
const messages = [], stateFile = path.join(root, `player-${label}-state.json`);
const emit = value => {
  messages.push(value); if (messages.length > 64) messages.shift();
  fs.writeFileSync(stateFile + '.tmp', JSON.stringify(messages)); fs.renameSync(stateFile + '.tmp', stateFile);
};
ipcMain.on('m3-state', (_event, value) => emit(value));
ipcMain.on('m3-video', (_event, bytes) => {
  fs.writeFileSync(path.join(root, 'assets', 'video', 'sample.webm'), Buffer.from(bytes));
  emit({ type: 'video', bytes: bytes.byteLength });
});
ipcMain.handle('m3-cover', () => 'data:image/png;base64,' + fs.readFileSync(path.join(root, 'assets', 'cover.png')).toString('base64'));
app.whenReady().then(async () => {
  const bitmap = Buffer.alloc(128 * 128 * 4);
  for (let i = 0; i < bitmap.length; i += 4) { bitmap[i] = 195; bitmap[i + 1] = 120; bitmap[i + 2] = 50; bitmap[i + 3] = 255; }
  fs.writeFileSync(path.join(root, 'assets', 'cover.png'), nativeImage.createFromBitmap(bitmap, { width: 128, height: 128 }).toPNG());
  window = new BrowserWindow({ width: 660, height: 420, show: false,
    title: `CWB M3 Acceptance ${nonce} ${label}`,
    webPreferences: { preload: path.join(__dirname, 'm3-acceptance-player-preload.cjs'), contextIsolation: true, sandbox: false, backgroundThrottling: false } });
  window.webContents.on('render-process-gone', (_event, details) => emit({ type: 'renderer-exit', reason: details.reason, exitCode: details.exitCode }));
  window.webContents.on('did-fail-load', (_event, code) => emit({ type: 'load-error', code }));
  window.webContents.on('console-message', (_event, ...args) => {
    const message = typeof args[0] === 'object' ? args[0].message : args[1];
    if (typeof message === 'string') emit({ type: 'fixture-console', message: message.slice(0, 240) });
  });
  await window.loadFile(path.join(root, 'assets', 'player.html'), { query: { nonce, label } });
  emit({ type: 'ready', probe: await window.webContents.executeJavaScript('({fixture:!!window.m3OwnedFixture,initialized:!!globalThis.m3Player,mediaSession:!!navigator.mediaSession})') });
});
// Windows GUI Electron does not reliably inherit redirected stdio. This
// bounded, private fixture protocol deliberately does not expose an HTTP API.
setInterval(async () => {
  try {
    const value = JSON.parse(fs.readFileSync(path.join(root, `player-${label}-command.json`), 'utf8'));
    if (!Number.isSafeInteger(value.request) || value.request <= lastRequest) return;
    if (value.op === 'quit') { emit({ type: 'reply', request: value.request, result: { ok: true } }); app.quit(); return; }
    if (busy) return;
    lastRequest = value.request; busy = true;
    if (window && ['play', 'pause', 'next', 'previous', 'snapshot', 'makeVideo'].includes(value.op)) {
      const result = await window.webContents.executeJavaScript(`globalThis.m3Player.command(${JSON.stringify(value.op)})`, true);
      emit({ type: 'reply', request: value.request, result });
    }
  } catch (e) { if (e.code !== 'ENOENT' && busy) emit({ type: 'error', reason: 'player_command_failed' }); }
  finally { busy = false; }
}, 100);
app.on('window-all-closed', () => app.quit());
