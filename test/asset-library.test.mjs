import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { AssetLibrary } from '../bridge-runtime/src/asset-library.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aOZ8AAAAASUVORK5CYII=', 'base64');

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-library-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') });
  await store.load();
  const library = new AssetLibrary({ configStore: store });
  t.after(() => library.close());
  return { root, store, library };
}

async function upload(library, data = png, filename = '测试.png') {
  const job = library.beginImport({ filename, size: data.length, rating: 'everyone' });
  return library.upload(job.id, Readable.from([data.subarray(0, 12), data.subarray(12)]));
}

test('streamed import commits managed image, deduplicates by bytes and survives restart', async (t) => {
  const { library, store } = await fixture(t);
  const first = await upload(library);
  assert.equal(first.status, 'completed', first.error);
  assert.equal(first.bytes, png.length);
  const duplicate = await upload(library, png, '另一个名字.png');
  assert.equal(duplicate.result.deduplicated, true);
  assert.equal(store.get().library.assets.length, 1);
  const project = (await library.projects())[0];
  assert.equal(project.type, 'image');
  assert.equal(project.source, 'imported');
  assert.deepEqual(await readFile(project.mediaPath), png);
  const restarted = new ConfigStore({ filePath: store.filePath });
  await restarted.load();
  const next = new AssetLibrary({ configStore: restarted });
  assert.equal((await next.projects())[0].id, project.id);
  assert.equal((await next.projects())[0].contentRating, 'everyone');
  assert.ok((await readdir(library.directory)).every((name) => !name.endsWith('.part')));
});

test('extension, content signature, empty/oversized data and length mismatch are rejected', async (t) => {
  const { library, store } = await fixture(t);
  for (const metadata of [{ filename: 'app.exe', size: 10 }, { filename: 'x.png', size: 0 },
    { filename: '../file.png', size: 10 }, { filename: 'x.mp4', size: 30 * 1024 ** 3 }]) {
    assert.throws(() => library.beginImport(metadata));
  }
  for (const [data, filename] of [[Buffer.from('not a PNG'), 'bad.png'], [png, 'bad.mp4']]) {
    const result = await upload(library, data, filename);
    assert.equal(result.status, 'failed');
  }
  const job = library.beginImport({ filename: 'short.png', size: png.length + 1 });
  assert.equal((await library.upload(job.id, Readable.from([png]))).status, 'failed');
  assert.equal(store.get().library.assets.length, 0);
  assert.ok((await readdir(library.directory)).every((name) => !name.endsWith('.part')));
});

test('queued and in-flight cancellation never commits partial files; close drains active work', async (t) => {
  const { library, store } = await fixture(t);
  const queued = library.beginImport({ filename: 'cancel.png', size: png.length });
  assert.equal(library.cancel(queued.id).status, 'cancelled');
  await assert.rejects(library.upload(queued.id, Readable.from([png])));
  let release;
  const stream = Readable.from((async function* () {
    yield png.subarray(0, 16);
    await new Promise((resolve) => { release = resolve; });
    yield png.subarray(16);
  })());
  const job = library.beginImport({ filename: 'inflight.png', size: png.length });
  const pending = library.upload(job.id, stream);
  const deadline = Date.now() + 2000;
  while (!release && Date.now() < deadline && library.getJob(job.id).status === 'running') {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (!release) { stream.destroy(); assert.fail(`import did not start: ${library.getJob(job.id).error}`); }
  library.cancel(job.id);
  release();
  assert.equal((await pending).status, 'cancelled');
  await library.close();
  assert.equal(store.get().library.assets.length, 0);
  assert.ok((await readdir(library.directory)).every((name) => !name.endsWith('.part')));
  assert.throws(() => library.beginImport({ filename: 'late.png', size: png.length }));
});

test('persistence failure rolls back newly created files and retains the previous index', async (t) => {
  const { library, store, root } = await fixture(t);
  await mkdir(store.filePath);
  const result = await upload(library);
  assert.equal(result.status, 'failed');
  assert.deepEqual(store.get().library.assets, []);
  assert.deepEqual((await readdir(library.directory)).filter((name) => name.endsWith('.png')), []);
  assert.ok((await readdir(root)).includes('config.json'));
});

test('remove only accepts indexed imports and leaves unrelated files and WE resources intact', async (t) => {
  const { library, store, root } = await fixture(t);
  await upload(library);
  const project = (await library.projects())[0];
  const original = path.join(root, 'WE-original.png');
  const unknown = path.join(library.directory, 'unknown.txt');
  await writeFile(original, png);
  await writeFile(unknown, 'keep');
  await assert.rejects(library.remove('workshop:123'), /导入/);
  await library.remove(project.id);
  assert.equal(store.get().library.assets.length, 0);
  assert.deepEqual(await readFile(original), png);
  assert.equal(await readFile(unknown, 'utf8'), 'keep');
});

test('migration copies only indexed files, changes location atomically and retains rollback source', async (t) => {
  const { library, store, root } = await fixture(t);
  await upload(library);
  const oldDirectory = library.directory;
  const project = (await library.projects())[0];
  await writeFile(path.join(oldDirectory, 'unknown.txt'), 'keep');
  const parent = path.join(root, 'new-parent');
  await mkdir(parent);
  const job = await library.beginMigration(parent);
  await library.wait(job.id);
  assert.equal(library.getJob(job.id).status, 'completed');
  assert.equal(library.getJob(job.id).result.sourceRetained, true);
  assert.equal(store.get().library.directory, path.join(parent, 'CodexWallpaperBridge-library'));
  assert.deepEqual(await readFile((await library.projects())[0].mediaPath), png);
  assert.deepEqual(await readFile(project.mediaPath), png);
  assert.equal(await readFile(path.join(oldDirectory, 'unknown.txt'), 'utf8'), 'keep');
  assert.equal((await readdir(library.directory)).includes('unknown.txt'), false);
});

test('migration refuses foreign directories and conflicting destination files without changing state', async (t) => {
  const { library, store, root } = await fixture(t);
  await upload(library);
  const parent = path.join(root, 'foreign');
  await mkdir(path.join(parent, 'CodexWallpaperBridge-library'), { recursive: true });
  await writeFile(path.join(parent, 'CodexWallpaperBridge-library', 'original.txt'), 'keep');
  const before = store.get();
  const job = await library.beginMigration(parent);
  await library.wait(job.id);
  assert.equal(library.getJob(job.id).status, 'failed');
  assert.deepEqual(store.get(), before);
  assert.equal(await readFile(path.join(parent, 'CodexWallpaperBridge-library', 'original.txt'), 'utf8'), 'keep');
});

test('remove persistence failure restores bytes and the old committed index', async (t) => {
  const { library, store } = await fixture(t);
  await upload(library);
  const project = (await library.projects())[0];
  const before = store.get();
  const originalSet = store.set.bind(store);
  store.set = async () => { throw new Error('injected persistence failure'); };
  await assert.rejects(library.remove(project.id));
  assert.deepEqual(store.get(), before);
  assert.deepEqual(await readFile(project.mediaPath), png);
  assert.ok((await readdir(library.directory)).every((name) => !name.endsWith('.trash')));
  store.set = originalSet;
});

test('migration cancellation leaves the committed directory and source unchanged', async (t) => {
  const { library, store, root } = await fixture(t);
  await upload(library);
  const before = store.get();
  const parent = path.join(root, 'cancel-destination');
  await mkdir(parent);
  const job = await library.beginMigration(parent);
  library.cancel(job.id);
  assert.equal((await library.wait(job.id)).status, 'cancelled');
  assert.deepEqual(store.get(), before);
  assert.deepEqual(await readFile((await library.projects())[0].mediaPath), png);
});

test('migration persistence failure removes only newly created destinations and retains source', async (t) => {
  const { library, store, root } = await fixture(t);
  await upload(library);
  const before = store.get();
  const parent = path.join(root, 'failed-destination');
  await mkdir(parent);
  const originalSet = store.set.bind(store);
  store.set = async () => { throw new Error('injected persistence failure'); };
  const job = await library.beginMigration(parent);
  assert.equal((await library.wait(job.id)).status, 'failed');
  assert.deepEqual(store.get(), before);
  assert.deepEqual((await readdir(path.join(parent, 'CodexWallpaperBridge-library'))).filter((name) => name.endsWith('.png') || name.endsWith('.part')), []);
  assert.deepEqual(await readFile((await library.projects())[0].mediaPath), png);
  store.set = originalSet;
});

test('changed content and directory links are never treated as mutable managed resources', async (t) => {
  const { library, store, root } = await fixture(t);
  await upload(library);
  const project = (await library.projects())[0];
  await writeFile(project.mediaPath, Buffer.alloc(png.length, 42));
  await assert.rejects(library.remove(project.id), /内容已变化/);
  assert.equal(store.get().library.assets.length, 1);
  const second = await fixture(t);
  const foreign = path.join(root, 'foreign-originals');
  await mkdir(foreign);
  await writeFile(path.join(foreign, 'keep.txt'), 'keep');
  await symlink(foreign, second.library.directory, process.platform === 'win32' ? 'junction' : 'dir');
  const result = await upload(second.library);
  assert.equal(result.status, 'failed');
  assert.equal(await readFile(path.join(foreign, 'keep.txt'), 'utf8'), 'keep');
  assert.equal((await readdir(foreign)).length, 1);
});
