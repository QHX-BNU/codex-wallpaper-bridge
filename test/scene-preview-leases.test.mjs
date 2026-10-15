import assert from 'node:assert/strict';
import test from 'node:test';
import { ScenePreviewLeases } from '../bridge-runtime/src/scene-preview-leases.mjs';

const client = 'a'.repeat(32), other = 'b'.repeat(32);
function fixture(options = {}) {
  let now = 0;
  const servers = [];
  const leases = new ScenePreviewLeases({ parentOrigin: () => 'http://127.0.0.1:41414',
    getProject: async (id) => ({ id, type: 'scene', rootPath: '/registered-scene' }), getConfig: async () => ({}),
    createServer: (options) => {
      const server = { options, origin: 'http://127.0.0.1:41415', rendererUrl: 'http://127.0.0.1:41415/wallpaper-engine/scene-live/index.html',
        channel: 'c'.repeat(32), authorProperties: { schema: {}, values: {} },
        async start() {}, async close() { server.closed = true; } };
      servers.push(server); return server;
    }, now: () => now, watch: false, ...options });
  return { leases, servers, advance: (ms) => { now += ms; } };
}
test('Scene preview leases reserve before async lookup, cap active+pending at two and bind a distinct readonly origin', async () => {
  const lookups = [];
  const f = fixture({ getProject: (id) => new Promise((resolve) => { lookups.push(() => resolve({ id, type: 'scene', rootPath: '/registered-scene' })); }) });
  const one = f.leases.open({ client, id: 'scene-a', fps: 60 });
  const two = f.leases.open({ client: other, id: 'scene-b', fps: 30 });
  await assert.rejects(f.leases.open({ client, id: 'scene-c' }), /preview_capacity/);
  // Resolve both independent reservations without allowing a third source.
  for (const lookup of lookups) lookup();
  await Promise.all([one, two]);
  assert.equal(f.leases.status().slots, 2);
  await f.leases.close(); assert.equal(f.leases.status().slots, 0);
});
test('Scene preview descriptors contain no host capability or path and validate FPS/identity/operations', async () => {
  const f = fixture();
  const value = await f.leases.open({ client, id: 'scene-a', fps: 60 });
  assert.match(value.handle, /^[a-f0-9]{32}$/); assert.equal(value.fps, 60);
  assert.equal(f.servers[0].options.parentOrigin, 'http://127.0.0.1:41414');
  assert.equal(f.servers[0].options.frameRate, 60);
  assert.doesNotMatch(JSON.stringify(value), /registered-scene|rootPath|controlToken/);
  for (const args of [{ client: '*', id: 'x' }, { client, id: '../x' }, { client, id: 'x', fps: 61 }, { client, id: 'x', url: 'file:///x' }]) {
    await assert.rejects(f.leases.open(args), /preview_invalid/);
  }
  await assert.rejects(f.leases.renew({ client: other, handle: value.handle }), /preview_unavailable/);
  await f.leases.renew({ client, handle: value.handle });
  await f.leases.release({ client, handle: value.handle });
  assert.equal(f.servers[0].closed, true); assert.equal(f.leases.status().slots, 0);
  await f.leases.close();
});

test('Web previews use the same readonly GPU descriptor, with exact type retained across validation', async () => {
  let type = 'web';
  const f = fixture({ getProject: async id => ({ id, type, rootPath: '/registered-web' }) });
  const descriptor = await f.leases.open({ client, id: 'web' });
  assert.equal(descriptor.type, 'web'); assert.equal(f.servers[0].options.project.type, 'web');
  type = 'scene'; assert.equal((await f.leases.validate({ client, handle: descriptor.handle })).current, false);
  await f.leases.close();
});
test('expired, cancelled-during-start and failed sources are closed; server shutdown seals new work', async () => {
  let finish;
  const f = fixture({ createServer: () => {
    const server = { origin: 'http://127.0.0.1:41415', rendererUrl: 'http://127.0.0.1:41415/scene', channel: 'c'.repeat(32),
      authorProperties: { schema: {}, values: {} }, start: () => new Promise((resolve) => { finish = resolve; }),
      async close() { server.closed = true; } };
    f.servers.push(server); return server;
  } });
  const opening = f.leases.open({ client, id: 'scene-a' });
  for (let i = 0; i < 4; i++) await Promise.resolve();
  const closing = f.leases.close(); finish();
  await assert.rejects(opening, /preview_cancelled/); await closing;
  assert.equal(f.servers[0].closed, true); assert.equal(f.leases.status().slots, 0);
  await assert.rejects(f.leases.open({ client, id: 'scene-b' }), /preview_closed/);
  const expired = fixture(); await expired.leases.open({ client, id: 'scene-a' });
  expired.advance(90001); await expired.leases.reap();
  assert.equal(expired.leases.status().slots, 0); assert.equal(expired.servers[0].closed, true);
  await expired.leases.close();
  const failed = fixture({ getProject: async () => null });
  await assert.rejects(failed.leases.open({ client, id: 'missing' }), /preview_unavailable/);
  assert.equal(failed.leases.status().slots, 0); await failed.leases.close();
});
test('a failed close retains capacity and can be retried rather than falsely reporting resource release', async () => {
  const f = fixture(); const value = await f.leases.open({ client, id: 'scene-a' });
  let attempts = 0; f.servers[0].close = async () => { if (!attempts++) throw Error('close_failed'); f.servers[0].closed = true; };
  await assert.rejects(f.leases.release({ client, handle: value.handle }), /close_failed/);
  assert.equal(f.leases.status().slots, 1);
  await f.leases.close(); assert.equal(f.leases.status().slots, 0); assert.equal(f.servers[0].closed, true);
});
