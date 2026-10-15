import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { ConfigStore, DEFAULT_CONFIG, normalizeConfig } from "../bridge-runtime/src/config-store.mjs";

async function fixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), "cwb-config-"));
  context.after(() => rm(root, { recursive: true, force: true }));
  const filePath = path.join(root, "config.json");
  return { root, filePath, store: new ConfigStore({ filePath }) };
}

test('author revisions track only the affected wallpaper including queued unrelated writes', async (t) => {
  const { store } = await fixture(t); await store.load();
  const revision = store.authorPropertiesRevision('a');
  await Promise.all([store.set({ selectedId: 'a', effects: { brightness: 90 } }),
    store.setAuthorProperties('b', { enabled: false }),
    store.setAuthorProperties('a', { enabled: false }, { ifRevision: revision })]);
  assert.ok(store.authorPropertiesRevision('a') > revision);
  assert.equal(store.get().authorProperties.a.enabled, false); assert.equal(store.get().effects.brightness, 90);
  await assert.rejects(store.setAuthorProperties('a', { enabled: true }, { ifRevision: revision }), (e) => e.statusCode === 409);
});

test('generic replacement, same-value author writes, ABA and reload invalidate affected author tokens', async (t) => {
  const { store } = await fixture(t); await store.load();
  let revision = store.authorPropertiesRevision('a');
  await store.replace({ ...store.get(), authorProperties: { a: { enabled: false } } });
  await assert.rejects(store.setAuthorProperties('a', null, { ifRevision: revision }), (e) => e.statusCode === 409);
  revision = store.authorPropertiesRevision('a');
  await store.setAuthorProperties('a', { enabled: false });
  assert.ok(store.authorPropertiesRevision('a') > revision);
  revision = store.authorPropertiesRevision('a');
  await store.setAuthorProperties('a', null); await store.setAuthorProperties('a', { enabled: false });
  await assert.rejects(store.setAuthorProperties('a', null, { ifRevision: revision }), (e) => e.statusCode === 409);
  revision = store.authorPropertiesRevision('a'); await store.load();
  await assert.rejects(store.setAuthorProperties('a', null, { ifRevision: revision }), (e) => e.statusCode === 409);
});

test('failed author persistence keeps values/revision and bounded tombstones never revive an old token', async (t) => {
  const { store, filePath } = await fixture(t); await store.load();
  const revision = store.authorPropertiesRevision('a');
  await mkdir(filePath);
  await assert.rejects(store.setAuthorProperties('a', { enabled: true }, { ifRevision: revision }));
  assert.equal(store.authorPropertiesRevision('a'), revision); assert.equal(store.get().authorProperties.a, undefined);
  await rm(filePath, { recursive: true, force: true });
  await store.setAuthorProperties('a', { enabled: true }, { ifRevision: revision }); await store.setAuthorProperties('a', null);
  for (let i = 0; i < 260; i++) await store.setAuthorProperties('tombstone-' + i, null);
  assert.ok(store.authorPropertiesRevision('a') > revision);
  await assert.rejects(store.setAuthorProperties('a', { enabled: false }, { ifRevision: revision }), (e) => e.statusCode === 409);
});

test("config schema retains supported fields and discards unknown fields", () => {
  const config = normalizeConfig({
    selectedId: "scene-1", unknown: "discard",
    effects: { position: "40% 60%", glassOpacity: 35, brightness: 999, arbitrary: true },
  });
  assert.equal(config.schemaVersion, DEFAULT_CONFIG.schemaVersion);
  assert.equal(config.effects.position, "40% 60%");
  assert.equal(config.effects.glassOpacity, 35);
  assert.equal(config.effects.brightness, 160);
  assert.equal(Object.hasOwn(config, "unknown"), false);
  assert.equal(Object.hasOwn(config.effects, "arbitrary"), false);
});

test('guarded media feedback is checked against committed revision inside the persistence queue', async (context) => {
  const { store } = await fixture(context);
  await store.load(); await store.set({ selectedId: 'a' });
  const revision = store.revision;
  const userWrite = store.set({ selectedId: 'b' });
  const feedback = store.set({ selectedId: 'old' }, { ifRevision: revision });
  await userWrite;
  await assert.rejects(feedback, (error) => error.statusCode === 409);
  assert.equal(store.get().selectedId, 'b'); assert.equal(store.revision, revision + 1);
});

test("legacy config is backed up byte-for-byte before its first versioned save", async (context) => {
  const { root, filePath, store } = await fixture(context);
  const original = '\uFEFF{"selectedId":"old-video","effects":{"brightness":84,"glassBlur":12},"unknownLegacy":42}\r\n';
  await writeFile(filePath, original, "utf8");
  const loaded = await store.load();
  assert.equal(loaded.schemaVersion, DEFAULT_CONFIG.schemaVersion);
  assert.equal(loaded.selectedId, "old-video");
  assert.equal(loaded.effects.brightness, 84);
  assert.equal(loaded.effects.glassBlur, 12);
  assert.equal(await readFile(filePath, "utf8"), original);
  await store.set({ effects: { saturation: 120 } });
  const backups = (await readdir(root)).filter((name) => name.endsWith(".bak"));
  assert.equal(backups.length, 1);
  assert.equal(await readFile(path.join(root, backups[0]), "utf8"), original);
  const saved = JSON.parse(await readFile(filePath, "utf8"));
  assert.equal(saved.schemaVersion, DEFAULT_CONFIG.schemaVersion);
  assert.equal(saved.selectedId, "old-video");
  assert.equal(saved.effects.saturation, 120);
  await store.set({ effects: { blur: 3 } });
  assert.equal((await readdir(root)).filter((name) => name.endsWith(".bak")).length, 1);
});

test("damaged config is reported and protected from subsequent writes", async (context) => {
  const { filePath, store } = await fixture(context);
  const original = '{"selectedId":"do-not-lose"';
  await writeFile(filePath, original);
  await assert.rejects(store.load(), /配置/);
  await assert.rejects(store.set({ selectedId: "replacement" }), /配置/);
  assert.equal(await readFile(filePath, "utf8"), original);
});

test("future schema is never downgraded or overwritten", async (context) => {
  const { filePath, store } = await fixture(context);
  const original = JSON.stringify({ schemaVersion: 99, selectedId: "future", futureFeature: true });
  await writeFile(filePath, original);
  await assert.rejects(store.load(), /版本/);
  await assert.rejects(store.reset(), /版本/);
  assert.equal(await readFile(filePath, "utf8"), original);
});

test("non-object config and invalid schema versions are protected", async (context) => {
  const { filePath, store } = await fixture(context);
  for (const value of [[], null, { schemaVersion: -1 }, { schemaVersion: "1" }]) {
    const original = JSON.stringify(value);
    await writeFile(filePath, original);
    await assert.rejects(store.load(), /配置/);
    await assert.rejects(store.save(), /配置/);
    assert.equal(await readFile(filePath, "utf8"), original);
  }
});

test("failed persistence does not change committed state and later retry works", async (context) => {
  const { root, filePath, store } = await fixture(context);
  await store.load();
  const before = store.get();
  await mkdir(filePath);
  await assert.rejects(store.set({ selectedId: "not-saved", effects: { brightness: 99 } }));
  assert.deepEqual(store.get(), before);
  assert.equal((await readdir(root)).some((name) => name.endsWith(".tmp")), false);
  await rm(filePath, { recursive: true, force: true });
  const result = await store.set({ selectedId: "saved" });
  assert.equal(result.selectedId, "saved");
  assert.equal(result.effects.brightness, before.effects.brightness);
  assert.equal(JSON.parse(await readFile(filePath, "utf8")).selectedId, "saved");
});

test("concurrent updates merge in order against committed state", async (context) => {
  const { filePath, store } = await fixture(context);
  await store.load();
  const [first, second, third] = await Promise.all([
    store.set({ selectedId: "video-1", effects: { brightness: 81 } }),
    store.set({ effects: { saturation: 137 } }),
    store.set({ selectedId: "video-2", effects: { blur: 4 } }),
  ]);
  assert.equal(first.selectedId, "video-1");
  assert.equal(first.effects.saturation, 100);
  assert.equal(second.effects.brightness, 81);
  assert.equal(third.selectedId, "video-2");
  assert.equal(third.effects.saturation, 137);
  assert.equal(third.effects.blur, 4);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), store.get());
});

test("queued patch and returned snapshots cannot be mutated by callers", async (context) => {
  const { store } = await fixture(context);
  await store.load();
  const patch = { selectedId: "original", effects: { brightness: 90 } };
  const pending = store.set(patch);
  patch.selectedId = "mutated";
  patch.effects.brightness = 40;
  const result = await pending;
  assert.equal(result.selectedId, "original");
  assert.equal(result.effects.brightness, 90);
  result.effects.brightness = 30;
  assert.equal(store.get().effects.brightness, 90);
});

test("a repaired protected file can be explicitly reloaded", async (context) => {
  const { filePath, store } = await fixture(context);
  await writeFile(filePath, "not-json");
  await assert.rejects(store.load(), /配置/);
  await writeFile(filePath, JSON.stringify({ schemaVersion: 1, selectedId: "repaired" }));
  await store.load();
  await store.set({ effects: { blur: 2 } });
  assert.equal(store.get().selectedId, "repaired");
});

test("reload and writes share one queue so future config cannot be overwritten", async (context) => {
  const { filePath, store } = await fixture(context);
  await store.load();
  const original = JSON.stringify({ schemaVersion: 99, selectedId: "future-on-disk" });
  await writeFile(filePath, original);
  const results = await Promise.allSettled([
    store.load(), store.set({ selectedId: "do-not-write" }), store.save(),
  ]);
  assert.ok(results.every((result) => result.status === "rejected"));
  assert.equal(await readFile(filePath, "utf8"), original);
});

test("queued reload observes the preceding write instead of reverting its state", async (context) => {
  const { filePath, store } = await fixture(context);
  await store.load();
  await store.set({ selectedId: "before" });
  const [, loaded, updated] = await Promise.all([
    store.set({ selectedId: "after" }), store.load(), store.set({ effects: { blur: 6 } }),
  ]);
  assert.equal(loaded.selectedId, "after");
  assert.equal(updated.selectedId, "after");
  assert.equal(updated.effects.blur, 6);
  assert.deepEqual(JSON.parse(await readFile(filePath, "utf8")), store.get());
});

test("version 1 is backed up without changing selection/effects while migrating to the current library schema", async (context) => {
  const { root, filePath, store } = await fixture(context);
  const original = '{"schemaVersion":1,"selectedId":"we-video","effects":{"brightness":87,"position":"20% 70%","glassBlur":5}}\r\n';
  await writeFile(filePath, original);
  const config = await store.load();
  assert.equal(config.schemaVersion, DEFAULT_CONFIG.schemaVersion);
  assert.equal(config.selectedId, 'we-video');
  assert.equal(config.effects.position, '20% 70%');
  assert.deepEqual(config.library.assets, []);
  assert.deepEqual(config.library.allowedRatings, ['everyone', 'pg13', 'mature', 'unrated']);
  assert.equal(await readFile(filePath, 'utf8'), original);
  await store.set({ library: { hiddenIds: ['one'] } });
  const backup = (await readdir(root)).find((name) => name.endsWith('.bak'));
  assert.equal(await readFile(path.join(root, backup), 'utf8'), original);
  assert.equal(store.get().effects.brightness, 87);
});
