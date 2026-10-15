import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { AuthorFileStore } from '../bridge-runtime/src/author-file-store.mjs';
import { AuthorPropertyController } from '../bridge-runtime/src/author-property-controller.mjs';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { createReadonlyWallpaperServer } from '../bridge-runtime/src/scene-server.mjs';
import { normalizeAuthorProperties, validateAuthorPropertyPatch } from '../bridge-runtime/src/author-properties.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfAAAAABJRU5ErkJggg==', 'base64');
const properties = { photos: { type: 'directory', mode: 'fetchall', value: 'defaults', filetype: 'image' },
  other: { type: 'directory', value: '', filetype: 'image' }, enabled: { type: 'bool', value: true } };
test('directory schema accepts only empty/default/scoped index IDs, never a local folder or arbitrary file array', () => {
  const manifest = normalizeAuthorProperties({ ...properties, bad: { type: 'directory', value: '../outside' } });
  assert.equal(manifest.schema.photos.type, 'directory'); assert.equal(manifest.values.bad, '');
  const id = 'cwb-author-directories/' + 'a'.repeat(32) + '-' + 'b'.repeat(32) + '-' + 'c'.repeat(64) + '.json';
  assert.deepEqual(validateAuthorPropertyPatch(manifest.schema, { photos: id }), { photos: id });
  for (const value of ['C:/secret', 'file:///C:/secret', 'https://evil.test', '../outside', 'other-default', [id]]) {
    assert.equal(validateAuthorPropertyPatch(manifest.schema, { photos: value }), null);
  }
});

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-author-directory-')); t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project'); await mkdir(path.join(projectRoot, 'defaults'), { recursive: true });
  await writeFile(path.join(projectRoot, 'project.json'), JSON.stringify({ file: 'index.html', general: { properties } }));
  await writeFile(path.join(projectRoot, 'index.html'), '<html><head></head><body>directory</body></html>');
  await writeFile(path.join(projectRoot, 'defaults', 'one.png'), png);
  await writeFile(path.join(projectRoot, 'defaults', 'ignore.txt'), 'not media');
  const store = new ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load();
  await writeFile(store.filePath, JSON.stringify(store.get()));
  const projects = ['a', 'b'].map(id => ({ id, type: 'web', rootPath: projectRoot }));
  const server = createMediaServer({ configStore: store, projects }); await server.start(); t.after(() => server.close());
  const url = suffix => new URL('api/author-properties/a' + suffix, server.baseUrl);
  const get = async () => (await fetch(url(''))).json();
  const upload = (key, revision, bytes = png) => fetch(url(`/directory-file/${key}?filename=photo.png&revision=${revision}`), {
    method: 'POST', body: bytes, headers: { 'Content-Type': 'application/octet-stream', 'X-CWB-File-Size': String(bytes.length) },
  });
  const commit = (key, revision, files) => fetch(url('/directory/' + key), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ revision, files }) });
  const post = body => fetch(url(''), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const readonly = createReadonlyWallpaperServer({ project: projects[0], authorFiles: server.authorFiles, parentOrigin: 'http://127.0.0.1:41234' }); await readonly.start(); t.after(() => readonly.close());
  const catalog = (key, value) => fetch(readonly.resourceBase.replace('/files/project', '/author-directory/') + key + '?value=' + encodeURIComponent(value));
  return { root, projectRoot, store, server, readonly, get, upload, commit, post, catalog };
}

test('directory upload→atomic selection→private catalog/bytes→independent reload→clear/default is a real HTTP flow', async t => {
  const f = await fixture(t), before = await f.get();
  const upload = await f.upload('photos', before.revision); assert.equal(upload.status, 200);
  const file = (await upload.json()).value;
  assert.equal((await f.get()).revision, before.revision, 'staging cannot mutate confirmed selection');
  const reply = await f.commit('photos', before.revision, [file, file]); assert.equal(reply.status, 200);
  const state = await reply.json(); assert.match(state.values.photos, /^cwb-author-directories\/[a-f0-9-]+\.json$/);
  const catalog = await (await f.catalog('photos', state.values.photos)).json();
  assert.equal(catalog.files.length, 1); assert.equal(catalog.files[0].url, f.readonly.resourceBase + '/' + file);
  assert.match(catalog.files[0].version, /^[a-f0-9]{64}$/);
  assert.ok(Buffer.from(await (await fetch(catalog.files[0].url)).arrayBuffer()).equals(png));
  assert.equal((await fetch(catalog.files[0].url, { headers: { Range: 'bytes=-8' } })).status, 206);
  assert.equal((await f.catalog('other', state.values.photos)).status, 404);
  const saved = new ConfigStore({ filePath: f.store.filePath }); await saved.load();
  const files = new AuthorFileStore({ configStore: saved }), controller = new AuthorPropertyController({ configStore: saved, authorFiles: files });
  t.after(() => files.close()); t.after(() => controller.close());
  assert.equal((await controller.state({ id: 'a', rootPath: f.projectRoot })).values.photos, state.values.photos);
  assert.doesNotMatch(await readFile(f.store.filePath, 'utf8'), /photo\.png|file:\/\/|projectRoot|http:/);
  assert.equal((await f.post({ revision: state.revision, values: { photos: '' } })).status, 200);
  assert.equal((await (await f.catalog('photos', '')).json()).files.length, 0);
  const reset = await f.post({ revision: (await f.get()).revision, reset: true }); assert.equal(reset.status, 200);
  const defaults = await (await f.catalog('photos', 'defaults')).json(); assert.equal(defaults.files.length, 1);
  assert.match(defaults.files[0].url, /\/defaults\/one\.png$/);
  assert.ok((await readdir(path.join(f.root, 'author-files'))).every(name => !name.endsWith('.part')));
});

test('directory writes reject cross-property/CAS/path/invalid media and preserve the last confirmed config', async t => {
  const f = await fixture(t), before = await f.get(), file = (await (await f.upload('photos', before.revision)).json()).value;
  const disk = await readFile(f.store.filePath, 'utf8');
  assert.equal((await f.commit('other', before.revision, [file])).status, 400);
  assert.equal((await f.commit('photos', before.revision, ['file:///C:/secret.png'])).status, 400);
  assert.equal((await f.upload('enabled', before.revision)).status, 400);
  assert.equal((await f.upload('photos', before.revision, Buffer.from('<script>'))).status, 400);
  assert.equal((await f.commit('photos', before.revision, Array(129).fill(file))).status, 413);
  assert.equal(await readFile(f.store.filePath, 'utf8'), disk);
  await f.post({ revision: before.revision, values: { enabled: false } });
  assert.equal((await f.commit('photos', before.revision, [file])).status, 409);
  assert.equal((await f.get()).values.photos, 'defaults');
});

test('default directory cannot follow outside links, accept traversal or exceed enumeration limits', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.png'), png);
  await symlink(outside, path.join(f.projectRoot, 'defaults', 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await (await f.catalog('photos', 'defaults')).json()).files.length, 1);
  assert.equal((await f.catalog('photos', '../outside')).status, 404);
  assert.equal((await f.catalog('enabled', 'defaults')).status, 404);
  await Promise.all(Array.from({ length: 128 }, (_, i) => writeFile(path.join(f.projectRoot, 'defaults', i + '.png'), png)));
  assert.equal((await f.catalog('photos', 'defaults')).status, 413);
});

test('tampered index or member cannot replay on restart; cross-wallpaper, Origin and generic config bypass stay denied', async t => {
  const f = await fixture(t), before = await f.get(), file = (await (await f.upload('photos', before.revision)).json()).value;
  const saved = await (await f.commit('photos', before.revision, [file])).json();
  const url = suffix => new URL(suffix, f.server.baseUrl);
  const response = await fetch(url('api/author-properties/b'), { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ revision: 0, values: { photos: saved.values.photos } }) }); assert.equal(response.status, 400);
  const index = path.join(f.root, 'author-files', 'd-' + saved.values.photos.split('/')[1]);
  assert.equal((await f.catalog('photos', saved.values.photos)).status, 200);
  const original = await readFile(index); await writeFile(index, '{}');
  assert.equal((await f.get()).values.photos, 'defaults'); assert.equal((await f.get()).discarded, 1);
  assert.equal((await f.catalog('photos', saved.values.photos)).status, 404);
  await writeFile(index, original);
  const member = await f.server.authorFiles.resolve('a', 'photos', file); await writeFile(member.path, Buffer.alloc(png.length, 1));
  assert.equal((await f.get()).values.photos, 'defaults'); assert.equal((await f.catalog('photos', saved.values.photos)).status, 404);
  const foreign = await fetch(url('api/author-properties/a/directory/photos'), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://evil.test' },
    body: JSON.stringify({ revision: saved.revision, files: [] }) }); assert.equal(foreign.status, 403);
  const config = await fetch(url('api/config'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ authorProperties: { a: { photos: '' } } }) });
  assert.equal(config.status, 400);
  const head = await fetch(f.readonly.resourceBase.replace('/files/project', '/author-directory/') + 'photos?value=defaults', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('directory selection disk failure/close cannot mutate config or leave active staging files', async t => {
  const f = await fixture(t), before = await f.get(), file = (await (await f.upload('photos', before.revision)).json()).value;
  const disk = await readFile(f.store.filePath, 'utf8');
  f.store.setAuthorProperties = async () => { throw Error('simulated save failure'); };
  assert.equal((await f.commit('photos', before.revision, [file])).status, 500);
  assert.equal((await f.get()).values.photos, 'defaults'); assert.equal(await readFile(f.store.filePath, 'utf8'), disk);
  assert.ok((await readdir(path.join(f.root, 'author-files'))).every(name => !name.endsWith('.part')));
  await f.server.authorFiles.close();
  await assert.rejects(f.server.authorFiles.createDirectory('a', 'photos', (await f.get()).schema.photos, [file]), /已关闭/);
});

test('actual private HTTP validator/shim joins staged files, index, author callbacks, random URLs and source release', async t => {
  const f = await fixture(t), listeners = new Map(), callbacks = [], parent = { postMessage() {} };
  const token = new URL(f.readonly.resourceBase).pathname.split('/')[1];
  const window = { parent, location: { origin: f.readonly.origin }, innerWidth: 800, innerHeight: 450,
    wallpaperPropertyListener: { applyUserProperties() {}, userDirectoryFilesAddedOrChanged: (key, files) => callbacks.push(['added', key, [...files]]),
      userDirectoryFilesRemoved: (key, files) => callbacks.push(['removed', key, [...files]]) },
    addEventListener: (key, fn) => listeners.set(key, fn), removeEventListener: key => listeners.delete(key),
    setTimeout, clearTimeout, setInterval, clearInterval };
  const context = vm.createContext({ window, URL, AbortController, atob, performance,
    requestAnimationFrame: fn => fn(),
    document: { querySelector: () => ({ content: token }), querySelectorAll: () => [] },
    fetch: (url, options) => fetch(new URL(url, f.readonly.origin), options) });
  vm.runInContext(await (await fetch(f.readonly.origin + '/cwb-property-validator.js')).text(), context);
  vm.runInContext(await (await fetch(f.readonly.origin + '/cwb-web-bridge.js')).text(), context);
  const release = () => listeners.get('message')?.({ source: parent, origin: 'http://127.0.0.1:41234',
    data: { source: 'cwb-web-control', channel: f.readonly.channel, op: 'release' } });
  t.after(release); listeners.get('load')();
  const until = async predicate => {
    const deadline = Date.now() + 2000;
    while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 5));
    assert.ok(predicate());
  };
  await until(() => callbacks.length === 1); assert.match(callbacks[0][2][0], /defaults\/one\.png$/);
  const before = await f.get(), file = (await (await f.upload('photos', before.revision)).json()).value;
  const selected = await (await f.commit('photos', before.revision, [file])).json();
  listeners.get('message')({ source: parent, origin: 'http://127.0.0.1:41234', data: {
    source: 'cwb-web-control', channel: f.readonly.channel, op: 'properties', values: selected.values, propertyRequest: 17,
  } });
  await until(() => window.__cwbWeb.propertyRequest === 17);
  assert.equal(window.__cwbWeb.directoryStatus, 'ready'); assert.equal(window.__cwbWeb.properties.photos, selected.values.photos);
  assert.equal(callbacks.at(-2)[0], 'removed'); assert.equal(callbacks.at(-1)[0], 'added');
  let random; window.wallpaperRequestRandomFileForProperty('photos', (key, url) => { random = { key, url }; });
  await until(() => Boolean(random)); assert.equal(random.key, 'photos'); assert.equal(random.url, f.readonly.resourceBase + '/' + file);
  const resolved = window.__cwbRewriteResourceUrl('file:///' + random.url, f.readonly.resourceBase);
  assert.ok(Buffer.from(await (await fetch(resolved)).arrayBuffer()).equals(png));
  release(); assert.equal(listeners.has('message'), false); assert.equal(window.__cwbWeb.phase, 'released');
});
