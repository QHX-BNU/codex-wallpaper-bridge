import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { ConfigStore, DEFAULT_CONFIG, normalizeConfig } from '../bridge-runtime/src/config-store.mjs';
import { effectiveAuthorProperties, normalizeSavedAuthorProperties, updateSavedAuthorProperties } from '../bridge-runtime/src/author-property-state.mjs';
import { normalizeAuthorProperties } from '../bridge-runtime/src/author-properties.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-author-state-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, 'config.json'), store = new ConfigStore({ filePath });
  await store.load(); return { root, filePath, store };
}
test('saved author state is bounded primitive-only and rejects prototype keys', () => {
  const result = normalizeSavedAuthorProperties(JSON.parse('{"a":{"ok":true,"n":3,"bad":{},"constructor":1},"__proto__":{"p":1}}'));
  assert.deepEqual(result, { a: { ok: true, n: 3 } });
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal(normalizeConfig({ authorProperties: result }).authorProperties.a.ok, true);
  assert.throws(() => updateSavedAuthorProperties({}, 'constructor', { ok: true }), /属性/);
  assert.throws(() => updateSavedAuthorProperties({}, 'a', { file: {} }), /属性/);
  assert.throws(() => updateSavedAuthorProperties({}, 'a', Object.fromEntries(Array.from({ length: 257 }, (_, i) => ['x' + i, true]))), /属性/);
});
test('schema changes discard invalid overrides per field and retain safe defaults', () => {
  const manifest = normalizeAuthorProperties({ enabled: { type: 'bool', value: true }, speed: { type: 'slider', value: 3, min: 0, max: 5 } });
  assert.deepEqual(effectiveAuthorProperties(manifest, { enabled: false, speed: 99, unknown: true }),
    { values: { enabled: false, speed: 3 }, discarded: 2 });
});
test('per-wallpaper writes serialize with effects, restart reads disk and resetting one leaves others', async (t) => {
  const { store, filePath } = await fixture(t);
  await Promise.all([store.setAuthorProperties('a', { enabled: false }), store.set({ effects: { blur: 7 } }),
    store.setAuthorProperties('b', { text: 'hello' })]);
  const restarted = new ConfigStore({ filePath }); await restarted.load();
  assert.deepEqual(restarted.get().authorProperties, { a: { enabled: false }, b: { text: 'hello' } });
  assert.equal(restarted.get().effects.blur, 7);
  await restarted.setAuthorProperties('a', null);
  assert.deepEqual(restarted.get().authorProperties, { b: { text: 'hello' } });
  assert.deepEqual(JSON.parse(await readFile(filePath, 'utf8')).authorProperties, { b: { text: 'hello' } });
});
test('legacy v3 snapshot is backed up unchanged and a stale guarded author write cannot win', async (t) => {
  const { root, filePath } = await fixture(t), raw = '{"schemaVersion":3,"selectedId":"a","effects":{"blur":2}}\r\n';
  await writeFile(filePath, raw);
  const store = new ConfigStore({ filePath }); await store.load(); const revision = store.revision;
  await store.setAuthorProperties('a', { enabled: false }, { ifRevision: revision });
  await assert.rejects(store.setAuthorProperties('a', { enabled: true }, { ifRevision: revision }), (e) => e.statusCode === 409);
  const backup = (await readdir(root)).find((name) => name.endsWith('.bak'));
  assert.equal(await readFile(path.join(root, backup), 'utf8'), raw);
  assert.equal(store.get().schemaVersion, DEFAULT_CONFIG.schemaVersion);
});
test('failed author save rolls back disk-success state without changing selection/effects', async (t) => {
  const { store, filePath } = await fixture(t); await store.set({ selectedId: 'a', effects: { brightness: 81 } });
  const before = store.get(), revision = store.revision;
  await rm(filePath); await mkdir(filePath);
  await assert.rejects(store.setAuthorProperties('a', { enabled: false }));
  assert.deepEqual(store.get(), before); assert.equal(store.revision, revision);
});
test('capacity overflow fails instead of silently evicting unrelated wallpaper settings', () => {
  const before = Object.fromEntries(Array.from({ length: 128 }, (_, i) => ['wallpaper-' + i, { x: true }]));
  assert.throws(() => updateSavedAuthorProperties(before, 'additional', { x: true }), /容量/);
  assert.equal(Object.keys(updateSavedAuthorProperties(before, 'wallpaper-0', { x: false })).length, 128);
});
