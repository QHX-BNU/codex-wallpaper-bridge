import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import test from 'node:test';
import { createEngineFrameClock } from '../src/engine-frame-clock.mjs';

function fixture(offscreen = true) {
  const contents = new EventEmitter(); let closed = false, starts = 0, stops = 0, rate = 0;
  Object.assign(contents, { isDestroyed: () => closed, isOffscreen: () => offscreen,
    setFrameRate: (n) => { rate = n; }, startPainting: () => { starts++; },
    stopPainting: () => { if (closed) throw Error('destroyed_native_call'); stops++; } });
  return { contents, close: () => { closed = true; contents.emit('destroyed'); },
    frame: () => contents.emit('paint', {}, {}, { authorImageMustNotBeRead: true }), counts: () => ({ starts, stops, rate }) };
}
test('hidden offscreen clock has fixed 30 FPS, retains no images and releases native painting once', () => {
  const f = fixture(), clock = createEngineFrameClock(f.contents); f.frame(); f.frame();
  assert.deepEqual(clock.status(), { released: false, presentations: 2, frameRate: 30, offscreen: true });
  clock.release(); clock.release(); f.frame();
  assert.deepEqual(f.counts(), { starts: 1, stops: 1, rate: 30 }); assert.equal(clock.status().presentations, 2);
  assert.equal(f.contents.listenerCount('paint'), 0); assert.equal(f.contents.listenerCount('destroyed'), 0);
});
test('externally destroyed native source clears the frame clock without accessing torn-down native methods', () => {
  const f = fixture(), clock = createEngineFrameClock(f.contents); f.close(); clock.release();
  assert.equal(clock.status().released, true); assert.equal(f.counts().stops, 0);
  assert.equal(f.contents.listenerCount('paint'), 0); assert.equal(f.contents.listenerCount('destroyed'), 0);
});
test('native frame clock rejects regular windows, missing and destroyed source APIs rather than falling back to timer input pumping', () => {
  assert.throws(() => createEngineFrameClock({}), /invalid_native_frame_clock/);
  const f = fixture(); f.close(); assert.throws(() => createEngineFrameClock(f.contents), /invalid_native_frame_clock/);
  assert.throws(() => createEngineFrameClock(fixture(false).contents), /invalid_native_frame_clock/);
});
