import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { openNativeEngineProvider } from '../bridge-runtime/src/native-engine-provider.mjs';

test('CLI native provider is absent in standalone Node or without the fixed owned-parent marker', () => {
  assert.equal(openNativeEngineProvider({ processContext: { env: {} } }), null);
  assert.equal(openNativeEngineProvider({ processContext: { env: { CWB_NATIVE_ENGINE_PROVIDER: 'owned-parent-v1' } } }), null);
  assert.equal(openNativeEngineProvider({ processContext: { env: { CWB_NATIVE_ENGINE_PROVIDER: 'other' }, parentPort: new EventEmitter() } }), null);
});
test('owned utility client listens only on parentPort, never author/window IPC, and seals on close', () => {
  const port = new EventEmitter(), messages = []; port.postMessage = (data) => messages.push(data);
  const provider = openNativeEngineProvider({ processContext: { env: { CWB_NATIVE_ENGINE_PROVIDER: 'owned-parent-v1' }, parentPort: port } });
  assert.ok(provider); assert.equal(port.listenerCount('message'), 1); provider.close();
  assert.equal(port.listenerCount('message'), 0); assert.equal(messages.length, 1); assert.equal(messages[0].op, 'close');
});
