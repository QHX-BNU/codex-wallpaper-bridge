import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { gpuResourceDelta, readOwnedGpuResources } from '../scripts/m2-gpu-resource-sampler.mjs';
const row = (pid, cpuMs = 0, creation = 'a') => ({ pid, exe: 'owned', creation, cpuMs, rss: 100, privateBytes: 80, dedicatedBytes: 50, sharedBytes: 20, gpuEnginePercentSum: 4, gpuMemoryInstances: 1, gpuEngineInstances: 1 });
const snapshot = (at, processes, available = true) => ({ at, processes, logicalProcessors: 4, gpuMemoryAvailable: available, gpuEngineAvailable: available });
test('resource CPU excludes recycled PIDs and missing GPU counters remain unavailable, not zero', () => {
  const before = snapshot('2026-10-13T00:00:00Z', [row(1), row(2)]);
  const after = snapshot('2026-10-13T00:00:01Z', [row(1, 1000), row(2, 999999, 'new')], false);
  const delta = gpuResourceDelta(before, after);
  assert.equal(delta.cpuMachinePercent, 25); assert.equal(delta.stableProcessCount, 1);
  assert.equal(delta.rss, 200); assert.equal(delta.dedicatedBytes, null); assert.equal(delta.gpuEnginePercentSum, null);
  assert.equal(delta.gpuCountersAvailable, false); assert.equal(delta.physicalScreenFps, null);
});
test('an available WDDM class without counters for any owned process is unavailable, not zero VRAM', () => {
  const before = snapshot('2026-10-13T00:00:00Z', [row(1)]);
  const after = snapshot('2026-10-13T00:00:01Z', [{ ...row(1), gpuMemoryInstances: 0, gpuEngineInstances: 0 }]);
  const delta = gpuResourceDelta(before, after);
  assert.equal(delta.gpuCountersAvailable, false); assert.equal(delta.dedicatedBytes, null); assert.equal(delta.gpuEnginePercentSum, null);
});
test('resource sampler rejects untrusted root identities before executing a shell', async () => {
  for (const roots of [[], [{ pid: 1, exe: 'relative', creation: '2026-10-13' }], [{ pid: 1, exe: 'C:/owned.exe', creation: "';secret" }]]) {
    await assert.rejects(readOwnedGpuResources(roots), /resource_identity_invalid/);
  }
  assert.throws(() => gpuResourceDelta(snapshot('now', []), snapshot('before', [])), /resource_clock_invalid/);
});
test('read-only sampler verifies exact root and native ticks, never returns command lines or operates on processes', async () => {
  const source = await readFile(new URL('../scripts/m2-gpu-resource-sampler.mjs', import.meta.url), 'utf8');
  assert.match(source, /resource_identity_changed/); assert.match(source, /\$ticks%10/);
  assert.doesNotMatch(source, /Stop-Process|taskkill|\.CommandLine|SendMessage|SetForegroundWindow/);
});
