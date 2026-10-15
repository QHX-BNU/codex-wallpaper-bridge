import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { protectEngineRenderer } from '../src/engine-boundary.mjs';

function fixture() {
  const wc = new EventEmitter(), session = new EventEmitter();
  wc.setWindowOpenHandler = (handler) => { wc.open = handler; };
  session.webRequest = { onBeforeRequest: (filter, handler) => { session.request = handler; } };
  session.setPermissionRequestHandler = (handler) => { session.permission = handler; };
  session.setPermissionCheckHandler = (handler) => { session.check = handler; };
  session.setDisplayMediaRequestHandler = (handler) => { session.display = handler; };
  const boundary = protectEngineRenderer({ webContents: wc, session,
    wrapperUrl: 'http://127.0.0.1:12345/owned', rendererOrigin: 'http://127.0.0.1:12346' });
  return { wc, session, boundary };
}
test('native request boundary allows only owned origins and readonly methods, including redirected targets', () => {
  const { session } = fixture();
  const check = (url, method = 'GET', resourceType = 'script') => {
    let result; session.request({ url, method, resourceType }, (r) => { result = r.cancel; }); return result;
  };
  assert.equal(check('http://127.0.0.1:12346/script.js'), false);
  assert.equal(check('http://127.0.0.1:12345/owned'), false);
  for (const url of ['http://127.0.0.1:12345/api/config', 'http://127.0.0.1:12347/',
    'https://example.invalid/', 'file:///C:/test.html', 'http://user@127.0.0.1:12346/']) assert.equal(check(url), true);
  assert.equal(check('http://127.0.0.1:12346/script.js', 'POST'), true);
  assert.equal(check('blob:http://127.0.0.1:12346/id'), false);
  assert.equal(check('data:text/html,hello', 'GET', 'mainFrame'), true);
  assert.equal(check('data:image/png;base64,AA==', 'GET', 'image'), false);
});
test('Electron details-event navigation rejects author escape to wrapper, external and custom schemes', () => {
  const { wc } = fixture();
  const check = (name, url, isMainFrame) => {
    let rejected = false; wc.emit(name, { url, isMainFrame, preventDefault() { rejected = true; } }); return rejected;
  };
  assert.equal(check('will-frame-navigate', 'http://127.0.0.1:12346/index.html', false), false);
  assert.equal(check('will-frame-navigate', 'http://127.0.0.1:12345/owned', false), true);
  assert.equal(check('will-frame-navigate', 'https://example.invalid/', false), true);
  assert.equal(check('will-frame-navigate', 'app://-/anything', false), true);
  assert.equal(check('will-navigate', 'http://127.0.0.1:12346/', true), true);
  assert.equal(check('will-redirect', 'https://example.invalid/', true), true);
  assert.equal(check('will-navigate', 'http://127.0.0.1:12345/owned', true), false);
});
test('popups, webviews, downloads and every permission denied; released boundary stays fail-closed', () => {
  const { wc, session, boundary } = fixture();
  assert.deepEqual(wc.open({ url: 'https://example.invalid/' }), { action: 'deny' });
  let denied = false; wc.emit('will-attach-webview', { preventDefault() { denied = true; } }); assert.equal(denied, true);
  session.permission(wc, 'camera', (result) => assert.equal(result, false));
  assert.equal(session.check(wc, 'microphone'), false);
  session.display({}, (result) => assert.deepEqual(result, {}));
  let cancelled = false; session.emit('will-download', {}, { cancel() { cancelled = true; } }); assert.equal(cancelled, true);
  boundary.release(); boundary.release();
  session.request({ url: 'http://127.0.0.1:12346/' }, (result) => assert.equal(result.cancel, true));
  assert.equal(boundary.status().closed, true);
  assert.equal(wc.listenerCount('will-frame-navigate'), 0);
});
test('invalid origin or credential contexts fail before setting security hooks', () => {
  for (const wrapperUrl of ['file:///C:/test.html', 'http://localhost:12345/', 'http://user@127.0.0.1:12345/']) {
    assert.throws(() => protectEngineRenderer({ webContents: {}, session: {}, wrapperUrl,
      rendererOrigin: 'http://127.0.0.1:12346' }), /boundary/);
  }
});
