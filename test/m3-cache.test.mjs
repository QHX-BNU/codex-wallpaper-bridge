import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { ConfigStore, normalizeConfig, mergeConfig } from '../bridge-runtime/src/config-store.mjs';
import { ManagedCache } from '../bridge-runtime/src/managed-cache.mjs';

const key = 'a'.repeat(64);
async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-cache-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load();
  const cache = new ManagedCache({ configStore: store, env: {}, ...options }); await cache.init();
  t.after(() => cache.close());
  const dir = await cache.directory('video'); await writeFile(path.join(dir, `${key}.mp4`), 'owned bytes');
  await writeFile(path.join(dir, 'do-not-touch.txt'), 'unknown child');
  await writeFile(path.join(cache.status().actualDirectory, 'unknown-root.bin'), 'unknown root');
  const parent = path.join(root, 'next'); await mkdir(parent);
  return { root, store, cache, parent, dir };
}
async function finish(cache, id) {
  await cache.wait(); return cache.job(id);
}
test('copy/hash/config-last migration keeps originals and unknown files; supports verified retry destination', async t => {
  const { store, cache, parent, dir } = await fixture(t);
  const job = await cache.beginMigration(parent), done = await finish(cache, job.id);
  assert.equal(done.status, 'completed', done.error); assert.equal(done.result.sourceRetained, true);
  assert.equal(done.result.copied, 1);
  assert.equal(store.get().cache.directory, path.join(parent, 'CodexWallpaperBridge-cache'));
  assert.equal(await readFile(path.join(await cache.directory('video'), `${key}.mp4`), 'utf8'), 'owned bytes');
  assert.equal(await readFile(path.join(dir, 'do-not-touch.txt'), 'utf8'), 'unknown child');
  assert.equal(await readFile(path.join(dir, `${key}.mp4`), 'utf8'), 'owned bytes');
  assert.ok(!(await readdir(await cache.directory('video'))).includes('do-not-touch.txt'));
});
test('environment root reports actual versus configured; migration under override cannot silently change another path', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-cache-env-')); t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load();
  await store.set({ cache: { directory: path.join(root, 'configured') } });
  const cache = new ManagedCache({ configStore: store, env: { CWB_CACHE_ROOT: path.join(root, 'override') } });
  await cache.init(); t.after(() => cache.close());
  assert.equal(cache.status().environmentOverride, true); assert.equal(cache.status().actualDirectory, path.join(root, 'override'));
  assert.equal(cache.status().configuredDirectory, path.join(root, 'configured'));
  await assert.rejects(cache.beginMigration(root), /cache_environment_override/);
});
test('write lease and concurrent migration are mutually exclusive; cancelled copy never commits config', async t => {
  let release; const blocked = new Promise(resolve => { release = resolve; });
  const { store, cache, parent } = await fixture(t, { beforeCopy: () => blocked });
  const lease = cache.acquireWriter(); await assert.rejects(cache.beginMigration(parent), /cache_busy/); lease();
  const job = await cache.beginMigration(parent);
  await assert.rejects(cache.beginMigration(parent), /cache_busy/);
  assert.throws(() => cache.acquireWriter(), /cache_busy/);
  cache.cancel(job.id); release(); const done = await finish(cache, job.id);
  assert.equal(done.status, 'cancelled'); assert.equal(store.get().cache.directory, null);
  assert.equal(cache.cancel(job.id).status, 'cancelled');
});
test('unowned/conflicting target is never overwritten and retry after correction is explicit', async t => {
  const { cache, parent } = await fixture(t);
  const dest = path.join(parent, 'CodexWallpaperBridge-cache'); await mkdir(dest); await writeFile(path.join(dest, 'unknown'), 'preserve');
  const job = await cache.beginMigration(parent), failed = await finish(cache, job.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'cache_unowned_directory');
  assert.equal(await readFile(path.join(dest, 'unknown'), 'utf8'), 'preserve');
  await rm(path.join(dest, 'unknown')); const next = await cache.retry(job.id);
  assert.equal((await finish(cache, next.id)).status, 'completed');
});
test('interrupted durable journal can be resumed in a new owner without traversing unknown directories', async t => {
  const { cache, store, parent, root } = await fixture(t);
  const job = await cache.beginMigration(parent); assert.equal((await finish(cache, job.id)).status, 'completed');
  const journal = JSON.parse(await readFile(path.join(root, 'cache-migration.json'), 'utf8'));
  await store.set({ cache: { directory: journal.source } }); journal.phase = 'copying';
  await writeFile(path.join(root, 'cache-migration.json'), JSON.stringify(journal)); await cache.close();
  const resumed = new ManagedCache({ configStore: store, env: {} }); await resumed.init(); t.after(() => resumed.close());
  assert.equal(resumed.status().recovery.resumable, true);
  const retry = await resumed.resume(); assert.equal((await finish(resumed, retry.id)).status, 'completed');
  assert.equal(resumed.status().recovery, null);
});
test('symlink known directory is rejected, root unknown stays intact', async t => {
  const { cache, root, parent, dir } = await fixture(t);
  await rm(dir, { recursive: true }); const outside = path.join(root, 'other'); await mkdir(outside);
  await writeFile(path.join(outside, `${key}.mp4`), 'not ours');
  await symlink(outside, dir, 'junction');
  const job = await cache.beginMigration(parent); assert.equal((await finish(cache, job.id)).status, 'failed');
  assert.equal(await readFile(path.join(outside, `${key}.mp4`), 'utf8'), 'not ours');
});
test('bounded config additions preserve other settings, defaults are conservative, cache reset is explicit', () => {
  const dir = path.resolve('out/cache-config-test');
  const value = normalizeConfig({ video: { fpsCap: 999, encoder: 'shell', faststart: false }, cache: { directory: dir }, effects: { playing: false } });
  assert.equal(value.video.fpsCap, 120); assert.equal(value.video.encoder, 'auto'); assert.equal(value.video.useOptimized, false);
  const next = mergeConfig(value, { video: { fpsCap: 24 }, cache: { directory: null } });
  assert.equal(next.video.faststart, false); assert.equal(next.video.fpsCap, 24); assert.equal(next.effects.playing, false); assert.equal(next.cache.directory, null);
  for (const directory of ['relative', 'bad\0value', {}, 12]) assert.equal(normalizeConfig({ cache: { directory } }).cache.directory, null);
});
test('owned destination conflict stays intact; no overwrite or config commit until explicit retry', async t => {
  const { cache, store, parent } = await fixture(t), dest = path.join(parent, 'CodexWallpaperBridge-cache');
  await mkdir(path.join(dest, 'video'), { recursive: true });
  await writeFile(path.join(dest, '.cwb-cache.json'), await readFile(path.join(cache.status().actualDirectory, '.cwb-cache.json')));
  const conflict = path.join(dest, 'video', `${key}.mp4`); await writeFile(conflict, 'different');
  await writeFile(path.join(dest, 'video', 'unknown'), 'untouched');
  const first = await cache.beginMigration(parent); const failed = await finish(cache, first.id);
  assert.equal(failed.error, 'cache_destination_conflict'); assert.equal(store.get().cache.directory, null);
  assert.equal(await readFile(conflict, 'utf8'), 'different'); assert.equal(cache.status().recovery.resumable, true);
  await rm(conflict); const retry = await cache.retry(first.id); assert.equal((await finish(cache, retry.id)).status, 'completed');
  assert.equal(await readFile(path.join(dest, 'video', 'unknown'), 'utf8'), 'untouched');
});
test('config commit failure retains old path and copy for verified retry, not a claimed migration success', async t => {
  const { cache, store, parent, dir } = await fixture(t), originalSet = store.set.bind(store);
  store.set = async () => { throw Object.assign(Error('private disk failure'), { code: 'EIO' }); };
  const job = await cache.beginMigration(parent); const failed = await finish(cache, job.id);
  assert.equal(failed.status, 'failed'); assert.equal(failed.error, 'cache_migration_failed'); assert.equal(store.get().cache.directory, null);
  assert.equal(await readFile(path.join(dir, `${key}.mp4`), 'utf8'), 'owned bytes');
  store.set = originalSet; const retry = await cache.retry(job.id); assert.equal((await finish(cache, retry.id)).status, 'completed');
});
test('invalid future/traversal recovery journal is rejected and preserved, never executed', async t => {
  const { cache, store, root } = await fixture(t); await cache.close();
  const file = path.join(root, 'cache-migration.json'), content = JSON.stringify({ schemaVersion: 100, owner: 'fake', entries: [{ relative: '../private' }] });
  await writeFile(file, content); const next = new ManagedCache({ configStore: store, env: {} }); t.after(() => next.close());
  await assert.rejects(next.init(), /cache_invalid_journal/); assert.equal(await readFile(file, 'utf8'), content);
});
