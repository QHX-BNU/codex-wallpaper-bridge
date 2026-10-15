import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';

async function fixture(t, onAuthorProperties = null) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-author-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const manifest = { general: { properties: { enabled: { type: 'bool', value: true, text: '<b>Flag</b>' },
    speed: { type: 'slider', min: 0, max: 10, value: 3 }, text: { type: 'textinput', value: 'default' } } } };
  await writeFile(path.join(root, 'project.json'), JSON.stringify(manifest));
  const filePath = path.join(root, 'config.json'), store = new ConfigStore({ filePath }); await store.load();
  const server = createMediaServer({ projects: ['a', 'b'].map((id) => ({ id, type: 'scene', rootPath: root })),
    configStore: store, onAuthorProperties });
  await server.start(); t.after(() => server.close());
  const get = async (id = 'a') => (await fetch(new URL('api/author-properties/' + id, server.baseUrl))).json();
  const post = (body, route = 'api/author-properties/a', headers = {}) => fetch(new URL(route, server.baseUrl), {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { root, filePath, store, server, manifest, get, post };
}
test('author API reads only registered eligible manifest; typed save, readback class and reset persist', async (t) => {
  const { store, get, post } = await fixture(t);
  const before = await get(); assert.equal(before.schema.enabled.label, 'Flag'); assert.equal(before.live.method, 'none');
  const r = await post({ revision: before.revision, values: { enabled: false, text: '<img>plain text' } }); assert.equal(r.status, 200);
  const saved = await r.json(); assert.equal(saved.values.enabled, false); assert.equal(saved.live.phase, 'unavailable');
  assert.equal(store.get().authorProperties.a.text, '<img>plain text');
  await store.setAuthorProperties('b', { enabled: false });
  const current = await get(); assert.equal((await post({ revision: current.revision, reset: true })).status, 200);
  assert.equal((await get()).values.enabled, true); assert.equal(store.get().authorProperties.b.enabled, false);
});
test('unknown ids/fields, unsafe types, outside origin and generic config bypass rejected without disk changes', async (t) => {
  const { filePath, get, post } = await fixture(t); const before = await get();
  assert.equal((await post({ values: { enabled: false }, revision: before.revision })).status, 200);
  const disk = await readFile(filePath, 'utf8'); const revision = (await get()).revision;
  for (const values of [{ enabled: 'false' }, { speed: 99 }, { file: 'file:///test' }, JSON.parse('{"__proto__":true}')]) {
    assert.equal((await post({ values, revision })).status, 400);
  }
  assert.equal((await post({ values: {}, revision, path: 'file:///test' })).status, 400);
  assert.equal((await post({ values: {}, revision }, 'api/author-properties/unknown')).status, 404);
  assert.equal((await post({ values: {}, revision }, 'api/author-properties/a', { Origin: 'https://evil.invalid' })).status, 403);
  assert.equal((await post({ authorProperties: { a: { enabled: true } } }, 'api/config')).status, 400);
  assert.equal((await post({ values: { enabled: true }, revision: before.revision })).status, 409);
  assert.equal(await readFile(filePath, 'utf8'), disk);
});
test('updated schema filters invalid stored values; live engine readback differs from delivered Web values', async (t) => {
  const calls = [], { root, manifest, get, post } = await fixture(t, async (request) => {
    calls.push(request.operation); return { phase: 'ready', method: 'engine-readback', values: { enabled: false, speed: 2, unknown: 'discard' } };
  });
  let state = await get(); assert.equal(state.live.values.enabled, false); assert.equal(state.live.values.unknown, undefined);
  assert.equal((await post({ revision: state.revision, values: { speed: 9 } })).status, 200);
  manifest.general.properties.speed.max = 5; await writeFile(path.join(root, 'project.json'), JSON.stringify(manifest));
  state = await get(); assert.equal(state.values.speed, 3); assert.equal(state.discarded, 1); assert.ok(calls.includes('apply'));
});
test('author API retains only the trusted GPU readback source, never an arbitrary source string', async (t) => {
  let source = 'codex-gpu';
  const { get } = await fixture(t, async () => ({ phase: 'ready', method: 'engine-readback', source, values: { enabled: false } }));
  assert.equal((await get()).live.source, 'codex-gpu');
  source = 'private-path-or-url';
  assert.equal((await get()).live.source, undefined);
});
test('hidden/disallowed projects and manifest symlink escape unavailable', async (t) => {
  const { root, get, store, server } = await fixture(t);
  await store.set({ library: { hiddenIds: ['a'] } });
  assert.equal((await fetch(new URL('api/author-properties/a', server.baseUrl))).status, 404);
  await store.set({ library: { hiddenIds: [] } });
  const outside = await mkdtemp(path.join(os.tmpdir(), 'cwb-author-outside-')); t.after(() => rm(outside, { recursive: true, force: true }));
  const manifest = path.join(outside, 'project.json'); await writeFile(manifest, '{}');
  await rm(path.join(root, 'project.json'));
  await symlink(process.platform === 'win32' ? outside : manifest, path.join(root, 'project.json'), process.platform === 'win32' ? 'junction' : 'file');
  assert.equal((await get()).error, '作者属性元数据不可用');
});

test('selection/effect saves and another wallpaper do not expire the author panel revision', async (t) => {
  const { store, get, post } = await fixture(t);
  const before = await get();
  assert.equal((await post({ selectedId: 'a', effects: { brightness: 91 } }, 'api/config')).status, 200);
  await store.setAuthorProperties('b', { enabled: false });
  assert.equal((await get()).revision, before.revision);
  const response = await post({ revision: before.revision, values: { enabled: false, speed: 7 } });
  assert.equal(response.status, 200);
  const saved = await response.json();
  assert.equal(saved.values.enabled, false); assert.equal(saved.values.speed, 7);
  assert.equal(store.get().effects.brightness, 91); assert.equal(store.get().authorProperties.b.enabled, false);
  await store.set({ effects: { volume: 14 } });
  assert.equal((await post({ revision: saved.revision, reset: true })).status, 200);
  assert.equal(store.get().effects.volume, 14);
});

test('same-wallpaper concurrent edits and ABA still reject stale author revisions', async (t) => {
  const { store, filePath, get, post } = await fixture(t);
  const initial = await get();
  await store.setAuthorProperties('a', { enabled: false });
  await store.setAuthorProperties('a', null);
  const disk = await readFile(filePath, 'utf8');
  assert.equal((await post({ revision: initial.revision, values: { speed: 8 } })).status, 409);
  assert.equal(await readFile(filePath, 'utf8'), disk);
  const current = await get();
  const replies = await Promise.all([post({ revision: current.revision, values: { enabled: false } }),
    post({ revision: current.revision, values: { speed: 8 } })]);
  assert.deepEqual(replies.map((r) => r.status).sort(), [200, 409]);
});
