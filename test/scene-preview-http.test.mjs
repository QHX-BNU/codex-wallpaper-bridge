import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
const client = 'a'.repeat(32);
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-preview-http-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const folder = path.join(root, 'scene'); await mkdir(folder);
  await writeFile(path.join(folder, 'project.json'), '{"type":"scene","file":"scene.json"}');
  await writeFile(path.join(folder, 'scene.pkg'), 'PKGV0001-not-a-render-fixture');
  const server = createMediaServer({ projects: [{ id: 'scene-a', type: 'scene', rootPath: folder, playable: false },
    { id: 'video-a', type: 'video', rootPath: folder }] });
  await server.start(); t.after(() => server.close());
  const post = (body, headers = {}) => fetch(new URL('api/scene-preview', server.baseUrl), { method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return { server, post };
}
test('workbench inventory advertises Scene preview separately; registered scene opens an isolated 60 FPS readonly renderer', async (t) => {
  const { server, post } = await fixture(t);
  const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
  assert.equal(inventory.projects[0].playable, false);
  assert.equal(inventory.projects[0].scenePreviewAvailable, true);
  const response = await post({ op: 'open', client, id: 'scene-a', fps: 60 }); assert.equal(response.status, 200);
  const descriptor = await response.json(); assert.notEqual(descriptor.origin, server.origin);
  assert.equal(new URL(descriptor.url).searchParams.get('sceneFps'), '60');
  assert.equal(new URL(descriptor.url).searchParams.get('renderDpr'), '0');
  assert.equal(new URL(descriptor.url).searchParams.get('resources'), '1');
  assert.ok(!JSON.stringify(descriptor).includes(server.token));
  const page = await fetch(descriptor.url);
  assert.match(page.headers.get('content-security-policy'), new RegExp('frame-ancestors ' + server.origin));
  assert.equal(page.headers.get('content-security-policy').split(';').map(value => value.trim())
    .find(value => value.startsWith('frame-ancestors')), `frame-ancestors ${server.origin} cwb-desktop://shell`);
  assert.doesNotMatch(page.headers.get('content-security-policy'), /frame-ancestors[^;]*(?:file:|\*|null)/);
  assert.equal((await fetch(descriptor.origin + '/api/config')).status, 404);
  assert.equal((await post({ op: 'close', client, handle: descriptor.handle })).status, 200);
  await assert.rejects(fetch(descriptor.url));
});
test('Scene preview API rejects foreign writes, arbitrary URL/path, unsupported FPS, unknown/non-scene IDs and methods', async (t) => {
  const { server, post } = await fixture(t);
  assert.equal((await post({ op: 'open', client, id: 'scene-a' }, { Origin: 'http://127.0.0.1:1' })).status, 403);
  for (const body of [{ op: 'open', client, id: 'scene-a', url: 'file:///x' }, { op: 'open', client, id: '../x' },
    { op: 'open', client, id: 'scene-a', fps: 120 }, { op: 'open', client, id: 'scene-a', desktopAncestor: true },
    { op: 'eval', client, script: 'x' }]) assert.equal((await post(body)).status, 400);
  for (const id of ['unknown', 'video-a']) assert.equal((await post({ op: 'open', client, id })).status, 404);
  assert.equal((await fetch(new URL('api/scene-preview', server.baseUrl))).status, 405);
});
test('a closed media server cannot revive sealed preview leases or bind another listener', async (t) => {
  const { server } = await fixture(t);
  await server.close(); await assert.rejects(server.start(), /media server is closed/);
  assert.equal(server.origin, null);
});
