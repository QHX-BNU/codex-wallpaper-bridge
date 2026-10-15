// Legacy verifier is sealed while its required sample is excluded by the user.
import m2TestPolicy from './m2-test-policy.cjs';
m2TestPolicy.assertM2TestProject('3790869794');
/* Dedicated utility test driver; never loaded by the daily CLI. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [workspace, key, savedArg] = process.argv.slice(2);
const { openNativeEngineProvider } = await import(pathToFileURL(path.join(workspace, 'dist/bridge-runtime/src/native-engine-provider.mjs')).href);
const client = openNativeEngineProvider(); assert.ok(client);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const digest = (frame) => createHash('sha256').update(frame.png).digest('hex');
const step = (name, data = {}) => process.parentPort.postMessage({ channel: 'cwb-provider-probe', event: 'step', name, ...data });
try {
  const scene = client.create('3233141951'); await scene.ready; assert.equal(scene.status().actualFrame, true);
  const frame = await scene.capture(); assert.equal(frame.width, 800); assert.equal(frame.height, 450);
  const props = await scene.properties(); assert.equal(props.method, 'engine-readback'); assert.equal(props.values[key], savedArg === 'true');
  const changed = await scene.properties({ [key]: savedArg !== 'true' }); assert.equal(changed.values[key], savedArg !== 'true');
  await assert.rejects(scene.properties({ [key]: 'invalid actual schema bool' }), /engine_unavailable/);
  const unknown = client.create('unregistered'); await assert.rejects(unknown.ready, /unregistered_project/);
  step('real native Scene ready/capture and parent-persisted properties cross owned IPC', { frameHash: digest(frame), bytes: frame.png.length });
  const web = client.create('3790869794'); await web.ready; await delay(500); await web.pause();
  const a = await web.capture(); await delay(350); const b = await web.capture(); assert.equal(digest(a), digest(b));
  await web.resume(); await delay(500); const c = await web.capture(); assert.notEqual(digest(b), digest(c));
  step('native Web pause/resume returns genuine stable/changing IPC frames', { pausedHash: digest(a), resumedHash: digest(c) });
  const third = client.create('1778944028'); await assert.rejects(third.ready, /provider_capacity/);
  step('third registered owner is denied while two real native resources are live');
  await scene.release(); await web.release();
  const cancelled = client.create('1778944028'); await cancelled.release(); await assert.rejects(cancelled.ready, /engine_cancelled|engine_unavailable/);
  step('cancel before ready releases startup resources instead of waiting for first-frame deadline');
  const abandoned = client.create('3790869794'); await abandoned.ready;
  step('utility exits with a live real owner for parent exit cleanup');
  process.parentPort.postMessage({ channel: 'cwb-provider-probe', event: 'done', outcome: 'pass' });
  // Deliberately no client.close/release here: exercise the actual child exit path.
  setTimeout(() => process.exit(0), 50);
} catch (error) {
  client.close(); process.parentPort.postMessage({ channel: 'cwb-provider-probe', event: 'done', outcome: 'fail', error: String(error.message).slice(0, 200) });
  setTimeout(() => process.exit(1), 50);
}
