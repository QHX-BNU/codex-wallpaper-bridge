import assert from 'node:assert/strict';
import test from 'node:test';
import { createMediaSwitcher } from '../bridge-runtime/src/media-switch.mjs';

function fixture(timeoutMs = 80) {
  const created = [];
  const disposed = [];
  let visible = null;
  const switcher = createMediaSwitcher({ timeoutMs,
    create(value) { let ready, fail; const slot = { value, ready: new Promise((r, j) => { ready = r; fail = j; }),
      resolve: () => ready(), reject: () => fail(Error('decode')), update: (v) => { slot.value = v; } };
      created.push(slot); return slot; },
    commit(slot) { visible = slot; }, dispose(slot) { if (slot) disposed.push(slot); },
  });
  return { switcher, created, disposed, visible: () => visible };
}
test('explicit force re-prepares the same identity and retains old slot until decoded candidate is ready', async () => {
  const f = fixture(); let h = f.switcher.prepare('old', 'same'); f.created[0].resolve(); await f.switcher.commit(h);
  h = f.switcher.prepare('retry', 'same', { force: true });
  assert.equal(h.reused, undefined); assert.equal(f.switcher.status().slots, 2); assert.equal(f.visible().value, 'old');
  f.created[1].resolve(); await f.switcher.commit(h); assert.equal(f.visible().value, 'retry');
  assert.deepEqual(f.disposed, [f.created[0]]); f.switcher.close();
});

test('prepare keeps old media until ready and commit, then disposes old', async () => {
  const f = fixture();
  let h = f.switcher.prepare('a', 'a'); f.created[0].resolve(); await f.switcher.commit(h);
  h = f.switcher.prepare('b', 'b');
  assert.equal(f.visible().value, 'a');
  assert.equal(f.switcher.status().slots, 2);
  f.created[1].resolve(); await f.switcher.commit(h);
  assert.equal(f.visible().value, 'b');
  assert.deepEqual(f.disposed, [f.created[0]]);
});

test('failed readiness and timeout never remove old media', async () => {
  const f = fixture(10);
  let h = f.switcher.prepare('a', 'a'); f.created[0].resolve(); await f.switcher.commit(h);
  h = f.switcher.prepare('bad', 'bad'); f.created[1].reject();
  assert.equal((await f.switcher.commit(h)).ok, false);
  assert.equal(f.visible().value, 'a');
  h = f.switcher.prepare('timeout', 'timeout');
  assert.match((await f.switcher.commit(h)).error, /timed out/);
  assert.equal(f.visible().value, 'a');
});

test('a trusted per-preparation Scene timeout does not expand subsequent media waits', (t) => {
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (_, ms) => { delays.push(ms); return 0; });
  const f = fixture(10);
  f.switcher.prepare('video', 'video');
  f.switcher.prepare('scene', 'scene', { loadTimeoutMs: 90000 });
  f.switcher.prepare('image', 'image');
  assert.deepEqual(delays, [10, 90000, 10]);
  f.switcher.close();
});

test('invalid per-preparation timeouts retain the configured media timeout', (t) => {
  const delays = [];
  t.mock.method(globalThis, 'setTimeout', (_, ms) => { delays.push(ms); return 0; });
  const f = fixture(10);
  for (const loadTimeoutMs of [0, -1, Infinity, NaN, '90000', 90001]) {
    f.switcher.prepare('media', String(delays.length), { loadTimeoutMs });
  }
  assert.deepEqual(delays, [10, 10, 10, 10, 10, 10]);
  f.switcher.close();
});

test('rapid changes cancel stale completion and bound slots', async () => {
  const f = fixture();
  const a = f.switcher.prepare('a', 'a');
  const b = f.switcher.prepare('b', 'b');
  f.created[0].resolve(); f.created[1].resolve();
  assert.equal((await f.switcher.commit(a)).cancelled, true);
  assert.equal((await f.switcher.commit(b)).ok, true);
  assert.equal(f.visible().value, 'b');
  assert.equal(f.switcher.status().slots, 1);
});

test('same-media effects reuse the active slot, cancel pending, and restore releases both slots', async () => {
  const f = fixture();
  const a = f.switcher.prepare({ zoom: 100 }, 'a'); f.created[0].resolve(); await f.switcher.commit(a);
  f.switcher.prepare('b', 'b');
  assert.equal((await f.switcher.switchTo({ zoom: 130 }, 'a')).reused, true);
  assert.equal(f.created.length, 2);
  assert.deepEqual(f.visible().value, { zoom: 130 });
  const c = f.switcher.prepare('c', 'c');
  f.switcher.close();
  f.created[2].resolve();
  assert.equal((await f.switcher.commit(c)).cancelled, true);
  assert.equal(f.switcher.status().slots, 0);
  assert.throws(() => f.switcher.prepare('d', 'd'), /closed/);
});
