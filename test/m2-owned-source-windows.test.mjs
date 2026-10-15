import assert from 'node:assert/strict';
import test from 'node:test';
import { trackNativeOwnerWindows } from '../scripts/m2-owned-source-windows.mjs';

test('source and codec identities come from exact owned construction, not runtime preference serialization', () => {
  const passed = [];
  function BrowserWindow(options) {
    passed.push(options);
    return { gone: false, isDestroyed() { return this.gone; },
      webContents: { getLastWebPreferences() { return {}; } } };
  }
  const owner = trackNativeOwnerWindows(BrowserWindow), unrelated = new BrowserWindow({});
  const sourceOptions = { show: false, webPreferences: { offscreen: true, sandbox: true, nodeIntegration: false } };
  const codecOptions = { show: false, webPreferences: { preload: 'private-codec-preload.cjs', sandbox: true, nodeIntegration: false } };
  const source = new owner.BrowserWindow(sourceOptions), codec = new owner.BrowserWindow(codecOptions);
  assert.equal(passed[1], sourceOptions); assert.equal(passed[2], codecOptions);
  assert.deepEqual(owner.sources(), [source]); assert.ok(!owner.sources().includes(unrelated));
  // Electron's public preference snapshot is not required to retain preload.
  assert.equal(codec.webContents.getLastWebPreferences().preload, undefined);
  source.gone = true; assert.deepEqual(owner.sources(), []); assert.equal(codec.isDestroyed(), false);
});
