import assert from 'node:assert/strict';
import test from 'node:test';
import { GPU_REMAINING_SAMPLES, resourcePlateau } from '../scripts/m2-gpu-remaining-checks.mjs';

test('remaining matrix has only the approved five Scene/two Web samples with separately declared requirements', () => {
  assert.equal(GPU_REMAINING_SAMPLES.length, 7);
  assert.equal(GPU_REMAINING_SAMPLES.filter(s => s.type === 'scene').length, 5);
  assert.equal(GPU_REMAINING_SAMPLES.filter(s => s.type === 'web').length, 2);
  assert.ok(GPU_REMAINING_SAMPLES.every(s => s.id !== '3790869794'));
});
test('plateau measures real nullable counters and rejects missing samples or sustained growth', () => {
  const flat = Array.from({ length: 20 }, () => ({ rss: 200e6, privateBytes: 100e6, dedicatedBytes: 300e6, sharedBytes: 10e6 }));
  assert.ok(Object.values(resourcePlateau(flat)).every(p => p.available && p.pass));
  assert.throws(() => resourcePlateau(flat.slice(0, 3)), /missing/);
  const growing = flat.map((s, i) => ({ ...s, rss: s.rss + i * 30e6, dedicatedBytes: null }));
  const result = resourcePlateau(growing); assert.equal(result.rss.pass, false); assert.equal(result.dedicatedBytes.available, false);
});
