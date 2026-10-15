import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createDesktopEngineHost } from '../src/desktop-engine-host.mjs';
import { createEngineProviderClient } from '../src/engine-provider-rpc.mjs';

const turn = () => new Promise((resolve) => setImmediate(resolve));
function peer() {
  const child = new EventEmitter(), port = new EventEmitter();
  child.postMessage = (data) => queueMicrotask(() => port.emit('message', { data: structuredClone(data) }));
  port.postMessage = (data) => queueMicrotask(() => child.emit('message', structuredClone(data)));
  return { child, port, client: createEngineProviderClient({ port, timeoutMs: 1000 }) };
}
async function fixture(t, overrides = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-desktop-native-')); t.after(() => rm(root, { recursive: true, force: true }));
  const configPath = path.join(root, 'CodexWallpaperBridge', 'config.json'); await mkdir(path.dirname(configPath));
  const config = { schemaVersion: 4, authorProperties: { registered: { enabled: false } } };
  await writeFile(configPath, JSON.stringify(config));
  const owners = [], scans = [];
  const host = createDesktopEngineHost({ env: { LOCALAPPDATA: root }, platform: 'win32',
    scan: async (options) => { scans.push(options); return { projects: [{ id: 'registered', type: 'scene', rootPath: 'trusted-scanner-only' }] }; },
    createOwner: (snapshot) => {
      const owner = { snapshot, ready: Promise.resolve(), releases: 0, closed: false,
        status() { return { phase: 'ready', actualFrame: true, closed: this.closed, resourcesClosed: this.closed }; },
        capture: async () => {}, release: async () => { owner.releases++; owner.closed = true; } };
      owners.push(owner); return owner;
    }, ...overrides });
  t.after(() => host.close());
  return { root, configPath, config, host, owners, scans };
}
test('desktop native host uses readonly fresh config and trusted scanner, never child filesystem inputs', async (t) => {
  const f = await fixture(t), a = peer(); t.after(() => a.client.close()); f.host.attach(a.child);
  const original = await readFile(f.configPath, 'utf8'), owner = a.client.create('registered'); await owner.ready;
  assert.equal(f.owners[0].snapshot.project.rootPath, 'trusted-scanner-only');
  assert.equal(f.owners[0].snapshot.properties.enabled, false); assert.equal(await readFile(f.configPath, 'utf8'), original);
  await owner.release(); f.config.authorProperties.registered.enabled = true; await writeFile(f.configPath, JSON.stringify(f.config));
  const next = a.client.create('registered'); await next.ready; assert.equal(f.owners[1].snapshot.properties.enabled, true);
  assert.equal(f.scans.length, 2); assert.ok(f.scans.every((value) => value === undefined));
});
test('parent retry revalidates registration, rejects live reservations and does not create windows or write config', async (t) => {
  const f = await fixture(t), p = peer(); t.after(() => p.client.close()); f.host.attach(p.child);
  const before = await readFile(f.configPath, 'utf8'), active = p.client.create('registered'); await active.ready;
  await assert.rejects(p.client.retry('registered'), /provider_busy/); await active.release();
  assert.deepEqual(await p.client.retry('registered'), { cleared: true });
  await assert.rejects(p.client.retry('unknown'), /unregistered_project/);
  assert.equal(f.owners.length, 1); assert.equal(f.host.status().slots, 0);
  assert.equal(await readFile(f.configPath, 'utf8'), before);
});
test('global two-slot reservation spans two utility peers and a pending readonly scan', async (t) => {
  let resolve; const scan = new Promise((yes) => { resolve = yes; });
  const f = await fixture(t, { scan: () => scan }), a = peer(), b = peer();
  t.after(() => { a.client.close(); b.client.close(); }); f.host.attach(a.child); f.host.attach(b.child);
  const first = a.client.create('registered'), second = b.client.create('registered');
  await turn(); await turn(); assert.equal(f.host.status().slots, 2);
  const third = b.client.create('registered'); await assert.rejects(third.ready, /provider_capacity/);
  await f.host.close(); resolve({ projects: [{ id: 'registered', type: 'scene', rootPath: 'trusted' }] });
  a.client.close(); b.client.close(); await Promise.allSettled([first.ready, second.ready]); await turn();
  assert.equal(f.owners.length, 0); assert.equal(f.host.status().slots, 0);
});
test('hidden, excluded rating, application and duplicate project IDs are never instantiated', async (t) => {
  for (const mode of ['hidden', 'rating', 'application', 'duplicate']) {
    const f = await fixture(t, { scan: async () => ({ projects: mode === 'duplicate'
      ? [{ id: 'registered', type: 'scene' }, { id: 'registered', type: 'scene' }]
      : [{ id: 'registered', type: mode === 'application' ? 'application' : 'scene', contentRating: 'mature' }] }) });
    if (mode === 'hidden') f.config.library = { hiddenIds: ['registered'] };
    if (mode === 'rating') f.config.library = { allowedRatings: ['everyone'] };
    await writeFile(f.configPath, JSON.stringify(f.config));
    const p = peer(); t.after(() => p.client.close()); f.host.attach(p.child);
    await assert.rejects(p.client.create('registered').ready, /unregistered_project/);
    assert.equal(f.owners.length, 0); assert.equal(f.host.status().slots, 0);
  }
});
test('future or broken disk config fails closed without rewriting or leaking filesystem details', async (t) => {
  const f = await fixture(t), a = peer(); t.after(() => a.client.close()); f.host.attach(a.child);
  for (const raw of ['{not-json', '{"schemaVersion":999}']) {
    await writeFile(f.configPath, raw); await assert.rejects(a.client.create('registered').ready, /engine_unavailable/);
    assert.equal(await readFile(f.configPath, 'utf8'), raw); assert.equal(f.host.status().slots, 0);
  }
  assert.equal(f.owners.length, 0);
});
test('utility exit/parent close await actual native release, not merely child termination', async (t) => {
  let resolve, releaseStarted = false;
  const released = new Promise((yes) => { resolve = yes; });
  const f = await fixture(t, { createOwner: () => ({ ready: Promise.resolve(), capture() {},
    status: () => ({ phase: 'ready', actualFrame: true, resourcesClosed: releaseStarted && done }),
    async release() { releaseStarted = true; await released; } }) });
  let done = false; const a = peer(); t.after(() => a.client.close()); f.host.attach(a.child);
  await a.client.create('registered').ready; a.child.emit('exit', 0); const closing = f.host.close();
  await turn(); assert.equal(releaseStarted, true); assert.equal(f.host.status().slots, 1);
  done = true; resolve(); await closing; assert.equal(f.host.status().slots, 0); assert.equal(f.host.status().peers, 0);
  assert.throws(() => f.host.attach(peer().child), /provider_closed/);
});
