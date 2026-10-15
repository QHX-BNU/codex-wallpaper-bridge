import assert from 'node:assert/strict';
import test from 'node:test';
import { runMediaTransition, createMediaSwitcher } from '../bridge-runtime/src/media-switch.mjs';
import { normalizeConfig, mergeConfig } from '../bridge-runtime/src/config-store.mjs';
import { rendererEffects } from '../bridge-overrides/src/injection-plan.mjs';

function nodes() {
  const calls = [];
  const node = () => ({ dataset: {}, animate(frames, timing) {
    const animation = { finished: Promise.resolve(), cancel() { animation.cancelled = true; } };
    calls.push({ frames, timing, animation }); return animation;
  } });
  return { next: { node: node() }, before: { node: node() }, calls };
}
test('seven transitions use bounded timing and direction without overriding media transforms', async () => {
  for (const transition of ['cut', 'fade', 'push', 'wipe', 'iris', 'zoom', 'stripes']) {
    const f = nodes();
    const run = runMediaTransition(f.next, f.before, { transition, transitionDurationMs: 650, transitionDirection: 'up' });
    assert.equal(f.next.node.dataset.cwbTransition, transition);
    assert.equal(Boolean(run), transition !== 'cut');
    if (run) { await run.finished; run.cancel(); }
    for (const { frames, timing, animation } of f.calls) {
      assert.equal(timing.duration, 650);
      assert.equal(animation.cancelled, true);
      assert.ok(frames.every((frame) => !Object.hasOwn(frame, 'transform')));
    }
    if (transition === 'push') assert.match(f.calls[0].frames[0].translate, /100%/);
    if (transition === 'stripes') assert.match(f.calls[0].frames[0].clipPath, /polygon/);
  }
});
test('explicit reduced motion and invalid types fall back to a true hard cut', () => {
  for (const options of [{ transition: 'fade', reduceMotion: true }, { transition: '<script>' }]) {
    const f = nodes(); assert.equal(runMediaTransition(f.next, f.before, options), null);
    assert.deepEqual(f.calls, []);
  }
});
test('transition schema rejects unsafe enums and clamps speed; lightweight payload preserves fields', () => {
  const cfg = normalizeConfig({ effects: { transition: 'wipe', transitionDirection: 'down', transitionDurationMs: 9999, reduceMotion: true } });
  assert.equal(cfg.effects.transitionDurationMs, 3000);
  for (const key of ['transition', 'transitionDirection', 'transitionDurationMs', 'reduceMotion']) assert.equal(rendererEffects(cfg)[key], cfg.effects[key]);
  const invalid = mergeConfig(cfg, { effects: { transition: 'evil', transitionDirection: 'evil', transitionDurationMs: 0 } });
  assert.equal(invalid.effects.transition, 'cut');
  assert.equal(invalid.effects.transitionDirection, 'left');
  assert.equal(invalid.effects.transitionDurationMs, 100);
});
test('interrupting transitions or restoring cancels animations and retains at most two slots', async () => {
  const disposed = [], runs = [];
  const switcher = createMediaSwitcher({ create: () => ({ ready: Promise.resolve() }), commit() {},
    dispose: (slot) => disposed.push(slot), transition() {
      const run = { finished: new Promise(() => {}), cancel() { run.cancelled = true; } }; runs.push(run); return run;
    } });
  await switcher.switchTo({}, 'a'); await switcher.switchTo({}, 'b');
  assert.equal(switcher.status().slots, 2);
  await switcher.switchTo({}, 'c');
  assert.equal(runs[0].cancelled, true); assert.equal(switcher.status().slots, 2);
  switcher.clear(); assert.equal(runs[1].cancelled, true);
  assert.equal(switcher.status().slots, 0); assert.equal(disposed.length, 3);
});

function visibilityFixture(t, hidden = false) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const listeners = new Set();
  const document = { hidden,
    addEventListener(name, fn) { assert.equal(name, 'visibilitychange'); listeners.add(fn); },
    removeEventListener(name, fn) { assert.equal(name, 'visibilitychange'); listeners.delete(fn); } };
  Object.defineProperty(globalThis, 'document', { configurable: true, value: document });
  t.after(() => { if (original) Object.defineProperty(globalThis, 'document', original); else delete globalThis.document; });
  return { listeners, hide() { document.hidden = true; for (const fn of [...listeners]) fn(); } };
}
test('a hidden document never starts WAAPI and immediately cuts to the real prepared slot', (t) => {
  visibilityFixture(t, true);
  const f = nodes();
  assert.equal(runMediaTransition(f.next, f.before, { transition: 'fade' }), null);
  assert.equal(f.next.node.dataset.cwbTransition, 'cut');
  assert.equal(f.calls.length, 0);
});
test('visibility loss cancels stalled WAAPI and releases only the retired slot, preserving playback intent', async (t) => {
  const visibility = visibilityFixture(t);
  const disposed = [], playing = true;
  const node = () => ({ dataset: {}, animate() {
    let reject;
    return { finished: new Promise((_, fail) => { reject = fail; }), cancel() { reject(Error('cancelled')); } };
  } });
  const switcher = createMediaSwitcher({ create: () => ({ node: node(), ready: Promise.resolve(), playing }),
    commit() {}, dispose: (slot) => disposed.push(slot), transition: runMediaTransition });
  await switcher.switchTo({}, 'a'); await switcher.switchTo({}, 'b', { transition: 'fade' });
  assert.equal(switcher.status().slots, 2);
  visibility.hide();
  for (let i = 0; i < 6; i++) await Promise.resolve();
  assert.equal(switcher.status().slots, 1);
  assert.equal(switcher.status().identity, 'b');
  assert.equal(disposed.length, 1); assert.equal(disposed[0].playing, true);
  assert.equal(visibility.listeners.size, 0);
  switcher.clear();
});
