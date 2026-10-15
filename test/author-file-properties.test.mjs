import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { normalizeAuthorProperties, validateAuthorPropertyPatch } from '../bridge-runtime/src/author-properties.mjs';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { createReadonlyWallpaperServer } from '../bridge-runtime/src/scene-server.mjs';
import { mapAuthorFileProperties } from '../bridge-runtime/src/author-properties.mjs';
import { AuthorFileStore, AUTHOR_FILE_LIMITS } from '../bridge-runtime/src/author-file-store.mjs';
import { Readable } from 'node:stream';
import { AuthorPropertyController } from '../bridge-runtime/src/author-property-controller.mjs';
import { DirectSceneDelivery } from '../bridge-runtime/src/direct-scene-delivery.mjs';

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfAAAAABJRU5ErkJggg==', 'base64');

test('file schema exposes a safe picker category, default and accepted extensions without author paths', () => {
  const result = normalizeAuthorProperties({
    image: { type: 'file', filetype: 'image', value: '' },
    video: { type: 'file', filetype: 'video', value: 'assets/default.mp4' },
    unsafe: { type: 'file', value: 'file:///C:/secret.png' },
    unsupported: { type: 'file', filetype: 'executable', value: '' },
  });
  assert.equal(result.schema.image.type, 'file');
  assert.ok(result.schema.image.extensions.includes('.png'));
  assert.equal(result.values.video, 'assets/default.mp4');
  assert.equal(result.values.unsafe, '');
  assert.equal(result.schema.unsupported, undefined);
  assert.deepEqual(validateAuthorPropertyPatch(result.schema, { image: '' }), { image: '' });
  for (const value of ['C:/secret.png', '../secret.png', 'https://host/a.png', 'data:image/png;base64,a', 'blob:x', 'assets/other.png']) {
    assert.equal(validateAuthorPropertyPatch(result.schema, { image: value }), null);
  }
});

test('managed file URLs use only the readonly origin; property telemetry and ordinary values keep their IDs/types', () => {
  const properties = normalizeAuthorProperties({ picture: { type: 'file', value: '' }, flag: { type: 'bool', value: false } });
  const id = 'cwb-author-files/' + 'a'.repeat(32) + '-' + 'b'.repeat(32) + '-' + 'c'.repeat(64) + '.png';
  const base = 'http://127.0.0.1:42341/private/files/project';
  const values = { picture: id, flag: false };
  assert.deepEqual(mapAuthorFileProperties(properties.schema, values, base), { picture: base + '/' + id, flag: false });
  assert.equal(values.picture, id); assert.deepEqual(mapAuthorFileProperties(properties.schema, { picture: '' }, base), { picture: '' });
});

async function fixture(t, live = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-author-file-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project'); await mkdir(projectRoot);
  await writeFile(path.join(projectRoot, 'project.json'), JSON.stringify({ general: { properties: {
    picture: { type: 'file', filetype: 'image', value: '' },
    second: { type: 'file', filetype: 'image', value: '' },
    enabled: { type: 'bool', value: true },
  } } }));
  const filePath = path.join(root, 'config.json'), store = new ConfigStore({ filePath }); await store.load();
  const server = createMediaServer({ configStore: store, projects: ['a', 'b'].map(id => ({ id, type: 'web', rootPath: projectRoot })), onAuthorProperties: live });
  await server.start(); t.after(() => server.close());
  const get = async (id = 'a') => (await fetch(new URL(`api/author-properties/${id}`, server.baseUrl))).json();
  const upload = (revision, options = {}) => fetch(new URL(`api/author-properties/${options.id || 'a'}/file/${options.key || 'picture'}?filename=${encodeURIComponent(options.name || 'selected.png')}&revision=${revision}`, server.baseUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-CWB-File-Size': String((options.body || png).length), ...options.headers }, body: options.body || png,
  });
  const post = (body, id = 'a') => fetch(new URL(`api/author-properties/${id}`, server.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  return { root, projectRoot, filePath, store, server, get, upload, post };
}

test('file upload commits a property-scoped ID, live update, independent persistence and reset across reload', async t => {
  const calls = [], f = await fixture(t, async request => {
    calls.push(request); return { phase: 'ready', method: 'author-delivery', values: request.values };
  });
  const response = await f.upload((await f.get()).revision); assert.equal(response.status, 200);
  const saved = await response.json();
  assert.match(saved.values.picture, /^cwb-author-files\/[a-f0-9-]+\.png$/);
  assert.equal(saved.live.values.picture, saved.values.picture);
  assert.equal(calls.at(-1).operation, 'apply');
  assert.equal(f.store.get().authorProperties.a.picture, saved.values.picture);
  const store2 = new ConfigStore({ filePath: f.filePath }); await store2.load();
  assert.equal(store2.get().authorProperties.a.picture, saved.values.picture);
  const files2 = new AuthorFileStore({ configStore: store2 }); t.after(() => files2.close());
  assert.ok((await files2.resolve('a', 'picture', saved.values.picture)).info.isFile());
  assert.equal((await f.get('b')).values.picture, '');
  assert.equal((await f.post({ revision: saved.revision, values: { picture: '' } })).status, 200);
  assert.equal((await f.get()).values.picture, '');
  const again = await f.upload((await f.get()).revision); assert.equal(again.status, 200);
  const restored = await f.post({ revision: (await f.get()).revision, reset: true }); assert.equal(restored.status, 200);
  assert.equal((await restored.json()).values.picture, '');
  assert.equal(f.store.get().authorProperties.a, undefined);
  assert.doesNotMatch(await readFile(f.filePath, 'utf8'), /file:\/\/|blob:|selected\.png|cwb-author-file-/);
  assert.ok((await readdir(path.join(f.root, 'author-files'))).every(name => !name.endsWith('.part')));
});

test('invalid uploads, cross-property/project reference and stale CAS preserve confirmed values', async t => {
  const f = await fixture(t);
  const before = await f.get(), initial = await f.upload(before.revision); assert.equal(initial.status, 200);
  const state = await initial.json(), disk = await readFile(f.filePath, 'utf8');
  for (const options of [{ name: 'evil.exe' }, { name: '../x.png' }, { body: Buffer.from('<script>not png</script>') },
    { key: 'enabled' }, { headers: { Origin: 'https://evil.invalid' } }]) {
    const reply = await f.upload(state.revision, options); assert.ok([400, 403].includes(reply.status), `${options.name || options.key || 'invalid'}:${reply.status}`);
  }
  assert.equal((await f.upload(before.revision)).status, 409);
  assert.equal((await f.post({ revision: state.revision, values: { second: state.values.picture } })).status, 400);
  assert.equal((await f.post({ revision: (await f.get('b')).revision, values: { picture: state.values.picture } }, 'b')).status, 400);
  assert.equal(await readFile(f.filePath, 'utf8'), disk);
});

test('private Scene/Web resource services resolve only their own managed files with MIME/Range/HEAD and intact CSP', async t => {
  const f = await fixture(t), saved = await (await f.upload((await f.get()).revision)).json();
  for (const type of ['scene', 'web']) {
    if (type === 'web') await writeFile(path.join(f.projectRoot, 'index.html'), '<html><head></head><body></body></html>');
    const server = createReadonlyWallpaperServer({ project: { id: 'a', type, rootPath: f.projectRoot }, authorFiles: f.server.authorFiles });
    await server.start(); t.after(() => server.close());
    const url = server.resourceBase + '/' + saved.values.picture;
    const reply = await fetch(url); assert.equal(reply.status, 200); assert.equal(reply.headers.get('content-type'), 'image/png');
    assert.ok(Buffer.from(await reply.arrayBuffer()).equals(png));
    assert.match(reply.headers.get('content-security-policy'), /connect-src 'self' blob:/);
    const head = await fetch(url, { method: 'HEAD' }); assert.equal(Number(head.headers.get('content-length')), png.length);
    const suffix = await fetch(url, { headers: { Range: 'bytes=-8' } }); assert.equal(suffix.status, 206);
    assert.ok(Buffer.from(await suffix.arrayBuffer()).equals(png.subarray(-8)));
    assert.equal((await fetch(url, { headers: { Range: `bytes=${png.length}-` } })).status, 416);
    assert.equal((await fetch(url, { method: 'POST' })).status, 405);
    // The real token is already part of the source's private resource base.
    const bridgeConfig = await (await fetch(server.resourceBase.replace('/files/project', '/bridge-config.json'))).json();
    assert.equal(bridgeConfig.resourceBase, server.resourceBase);
    const other = createReadonlyWallpaperServer({ project: { id: 'b', type, rootPath: f.projectRoot }, authorFiles: f.server.authorFiles });
    await other.start(); t.after(() => other.close());
    assert.equal((await fetch(other.resourceBase + '/' + saved.values.picture)).status, 404);
    assert.equal((await fetch(server.origin + '/api/author-properties/a')).status, 404);
    assert.ok(await server.isCurrent(), 'managed files must not be recorded as WE project source mutations');
  }
});

test('tampered/missing managed file cannot be replayed, and links never escape the owned resource directory', async t => {
  const f = await fixture(t), saved = await (await f.upload((await f.get()).revision)).json();
  const entry = await f.server.authorFiles.resolve('a', 'picture', saved.values.picture);
  await writeFile(entry.path, Buffer.alloc(png.length, 1));
  const state = await f.get(); assert.equal(state.values.picture, ''); assert.equal(state.discarded, 1);
  assert.equal((await f.post({ revision: state.revision, values: { picture: saved.values.picture } })).status, 400);
  await rm(entry.path);
  const outside = path.join(f.root, 'outside'); await mkdir(outside);
  await symlink(outside, entry.path, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.server.authorFiles.resolve('a', 'picture', saved.values.picture), /已变化|不可用/);
});

test('a disk-save failure during file selection preserves the last config and cleans temporary upload data', async t => {
  const f = await fixture(t); await f.post({ revision: (await f.get()).revision, values: { enabled: false } });
  const original = f.store.get(), before = await readFile(f.filePath, 'utf8'), set = f.store.setAuthorProperties;
  f.store.setAuthorProperties = async () => { throw Error('simulated config write failure'); };
  const reply = await f.upload((await f.get()).revision); assert.equal(reply.status, 500);
  assert.deepEqual(f.store.get(), original); assert.equal(await readFile(f.filePath, 'utf8'), before);
  assert.ok((await readdir(path.join(f.root, 'author-files'))).every(name => !name.endsWith('.part')));
  f.store.setAuthorProperties = set;
});

test('managed import is bounded, deduplicated, property-scoped and verifies every resolved byte', async t => {
  const f = await fixture(t), files = f.server.authorFiles, spec = (await f.get()).schema.picture;
  const first = await files.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length });
  assert.equal(await files.import('a', 'picture', spec, Readable.from([png]), { filename: 'same.png', size: png.length }), first);
  const second = await files.import('a', 'second', spec, Readable.from([png]), { filename: 'same.png', size: png.length });
  assert.notEqual(second, first);
  await assert.rejects(files.resolve('b', 'picture', first), /引用无效/);
  await assert.rejects(files.resolve('a', 'second', first), /引用无效/);
  await assert.rejects(files.import('a', 'picture', spec, Readable.from([]), { filename: 'safe.png', size: AUTHOR_FILE_LIMITS.fileBytes + 1 }), /64 MiB/);
  await assert.rejects(files.import('a', 'picture', spec, Readable.from([png.subarray(0, 8)]), { filename: 'safe.png', size: png.length }), /未完整/);
  await assert.rejects(files.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length - 1 }), /超过声明/);
  assert.ok((await readdir(path.join(f.root, 'author-files'))).every(name => !name.endsWith('.part')));
});

test('a foreign marker or a linked root never permits import into someone else\'s directory', async t => {
  const f = await fixture(t), spec = (await f.get()).schema.picture;
  const root = path.join(f.root, 'author-files'); await mkdir(root);
  await writeFile(path.join(root, '.cwb-author-files.json'), JSON.stringify({ app: 'CodexWallpaperBridge', owner: 'foreign', version: 1 }));
  await assert.rejects(f.server.authorFiles.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length }), /归属无效/);
  assert.equal(path.relative(f.root, root), 'author-files');
  await rm(root, { recursive: true });
  const outside = path.join(f.root, 'outside-root'); await mkdir(outside);
  await symlink(outside, root, process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(f.server.authorFiles.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length }), /归属无效/);
  assert.deepEqual(await readdir(outside), []);
});

test('an ancestor junction is rejected before creating an author-files directory outside the config root', async t => {
  const f = await fixture(t), spec = (await f.get()).schema.picture, outside = path.join(f.root, 'ancestor-outside'), link = path.join(f.root, 'ancestor-link');
  await mkdir(outside); await symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir');
  const files = new AuthorFileStore({ configStore: { filePath: path.join(link, 'config.json') } }); t.after(() => files.close());
  await assert.rejects(files.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length }), /归属无效/);
  assert.deepEqual(await readdir(outside), []);
});

test('stale revision after streaming still rejects the file commit and preserves another concurrent author edit', async t => {
  const f = await fixture(t), state = await f.get();
  const original = f.server.authorFiles.import.bind(f.server.authorFiles);
  f.server.authorFiles.import = async (...args) => {
    const value = await original(...args); await f.store.setAuthorProperties('a', { enabled: false }); return value;
  };
  assert.equal((await f.upload(state.revision)).status, 409);
  assert.deepEqual(f.store.get().authorProperties.a, { enabled: false });
  assert.equal((await f.get()).values.picture, '');
});

test('closing file store aborts a partial stream without leaking temporary files or writes', async t => {
  const f = await fixture(t), files = f.server.authorFiles, spec = (await f.get()).schema.picture;
  let started, resume; const active = new Promise(resolve => { started = resolve; }), waiting = new Promise(resolve => { resume = resolve; });
  const source = Readable.from((async function* () { yield png.subarray(0, 8); started(); await waiting; yield png.subarray(8); })());
  const work = files.import('a', 'picture', spec, source, { filename: 'safe.png', size: png.length });
  const rejected = assert.rejects(work, /abort/i);
  await active; const closing = files.close(); resume(); await closing; await rejected;
  assert.ok((await readdir(path.join(f.root, 'author-files'))).every(name => !name.endsWith('.part')));
  await assert.rejects(files.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length }), /已关闭/);
});

test('clear and reset distinguish an empty file from a package-relative author default', async t => {
  const f = await fixture(t), manifestPath = path.join(f.projectRoot, 'project.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8')); manifest.general.properties.picture.value = 'default.png';
  await writeFile(manifestPath, JSON.stringify(manifest)); await writeFile(path.join(f.projectRoot, 'default.png'), png);
  assert.equal((await f.get()).values.picture, 'default.png');
  assert.equal((await f.upload((await f.get()).revision)).status, 200);
  const cleared = await f.post({ revision: (await f.get()).revision, values: { picture: '' } });
  assert.equal((await cleared.json()).values.picture, '');
  const reset = await f.post({ revision: (await f.get()).revision, reset: true });
  const state = await reset.json(); assert.equal(state.values.picture, 'default.png'); assert.equal(state.defaults.picture, 'default.png');
});

test('the managed file-count quota refuses a new version but permits byte-identical reuse and keeps the previous selection', async t => {
  const f = await fixture(t), saved = await (await f.upload((await f.get()).revision)).json(), spec = saved.schema.picture;
  const root = path.join(f.root, 'author-files'), name = saved.values.picture.split('/')[1], prefix = name.slice(0, 66);
  for (let i = 0; i < AUTHOR_FILE_LIMITS.files - 1; i++) {
    await writeFile(path.join(root, prefix + i.toString(16).padStart(64, '0') + '.png'), 'x', { flag: 'wx' });
  }
  await assert.rejects(f.server.authorFiles.import('a', 'second', spec, Readable.from([png]), { filename: 'safe.png', size: png.length }), /文件库已满/);
  assert.equal(await f.server.authorFiles.import('a', 'picture', spec, Readable.from([png]), { filename: 'safe.png', size: png.length }), saved.values.picture);
  assert.equal(f.store.get().authorProperties.a.picture, saved.values.picture);
  assert.ok((await readdir(root)).every(file => !file.endsWith('.part')));
});

test('closing the controller seals new saves and uploads before they can mutate configuration', async t => {
  const f = await fixture(t), controller = new AuthorPropertyController({ configStore: f.store, authorFiles: f.server.authorFiles });
  const project = { id: 'a', type: 'web', rootPath: f.projectRoot }, state = await controller.state(project);
  await controller.close();
  await assert.rejects(controller.state(project, { revision: state.revision, values: { enabled: false } }), /服务已关闭/);
  await assert.rejects(controller.upload(project, 'picture', Readable.from([png]), { filename: 'safe.png', size: png.length, revision: state.revision }), /服务已关闭/);
  assert.equal(f.store.get().authorProperties.a, undefined);
});

test('actual preview HTTP and private GPU lease both wire the same persisted file ID to a readonly resource server', async t => {
  const f = await fixture(t); await writeFile(path.join(f.projectRoot, 'index.html'), '<html><head></head><body></body></html>');
  const saved = await (await f.upload((await f.get()).revision)).json();
  const client = 'd'.repeat(32), route = new URL('api/scene-preview', f.server.baseUrl);
  const preview = await (await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ op: 'open', client, id: 'a', fps: 60 }) })).json();
  assert.equal(preview.properties.picture, saved.values.picture);
  assert.equal((await fetch(preview.resourceBase + '/' + saved.values.picture)).status, 200);
  await fetch(route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ op: 'close', client, handle: preview.handle }) });
  let descriptor;
  const delivery = new DirectSceneDelivery({ getProject: id => ({ id, type: 'web', rootPath: f.projectRoot }),
    getConfig: () => f.store.get(), authorFiles: f.server.authorFiles }); t.after(() => delivery.close());
  const session = { sceneTransportId: 'private-test-receiver', socket: { async call(_method, params) {
    if (params.functionDeclaration.includes('this.register')) { descriptor = params.arguments[0].value; return { result: { value: true } }; }
    return { result: { value: params.arguments[0].value === 'state' ? { present: true, prepared: true, committed: true } : true } };
  } } };
  const lease = await delivery.prepare(session, 'a');
  assert.equal(descriptor.properties.picture, saved.values.picture);
  const image = await fetch(descriptor.resourceBase + '/' + saved.values.picture); assert.equal(image.status, 200);
  assert.ok(Buffer.from(await image.arrayBuffer()).equals(png));
  await lease.release(); assert.equal(delivery.diagnostics().length, 0);
});
