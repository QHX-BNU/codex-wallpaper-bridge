import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createSceneServer, MAX_SCENE_ASSET_BYTES, verifyWebWallglAssets, prewarmSceneAssets } from '../bridge-runtime/src/scene-server.mjs';

async function fixture(t, options = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-scene-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const projectRoot = path.join(root, 'project');
  await mkdir(projectRoot);
  await writeFile(path.join(projectRoot, 'project.json'), JSON.stringify({ type: 'scene', file: 'scene.json' }));
  await writeFile(path.join(projectRoot, 'scene.pkg'), 'PKGV0001-test-payload');
  await writeFile(path.join(root, 'secret.json'), '{"secret":true}');
  await writeFile(path.join(projectRoot, 'evil.exe'), 'not a scene asset');
  const server = createSceneServer({ project: { id: 'scene', type: 'scene', rootPath: projectRoot },
    parentOrigin: 'http://127.0.0.1:42341', ...options });
  await server.start();
  t.after(() => server.close());
  return { root, projectRoot, server };
}

function raw(server, relative, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = httpRequest(server.origin + '/', { path: relative, method, headers }, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject);
    req.end();
  });
}

test('vendored renderer/dependency provenance has exact hashes and both licenses', async () => {
  const result = await verifyWebWallglAssets();
  assert.equal(result.version, '2.1.0');
  assert.equal(result.commit, '4ba71c406fbc78f24c99b1bb1edd9d9cef9793c8');
  assert.equal(result.dependencies[0].license, 'MPL-2.0');
  assert.ok(result.files['assets/renderer-AJkjEL9i.js'].size > 1_000_000);
});

test('optional resource warming respects exclusion and cancellation before accessing any project files', async () => {
  const project = { id: 'blocked', type: 'scene', rootPath: 'missing-fixture-not-accessed' };
  for (const patch of [{ hidden: true }, { eligible: false }, { type: 'web' }]) {
    assert.equal(await prewarmSceneAssets({ project: { ...project, ...patch } }), false);
  }
  assert.equal(await prewarmSceneAssets({ project, cancelled: () => true }), false);
});

test('dedicated scene origin serves engine and only a per-project readonly capability', async (t) => {
  const { server } = await fixture(t);
  assert.match(server.origin, /^http:\/\/127\.0\.0\.1:\d+$/);
  assert.notEqual(server.origin, 'http://127.0.0.1:42341');
  const html = await fetch(server.rendererUrl);
  assert.equal(html.status, 200);
  assert.match(await html.text(), /cwb-scene-bridge.js/);
  const csp = html.headers.get('content-security-policy');
  assert.match(csp, /connect-src 'self' blob:/);
  assert.match(csp, /frame-ancestors http:\/\/127\.0\.0\.1:42341/);
  assert.match(csp, /sandbox allow-scripts allow-same-origin/);
  const manifest = await fetch(server.resourceBase + '/project.json');
  assert.equal(manifest.status, 200);
  assert.equal((await manifest.json()).type, 'scene');
  for (const route of ['/api/config', '/api/local-assets', '/api/command', '/cwb-scene-config.json']) {
    assert.equal((await fetch(server.origin + route)).status, 404, route);
  }
  assert.equal((await fetch(server.origin + '/cwb-verifier-probe.js')).status, 404);
  assert.doesNotMatch(await (await fetch(server.rendererUrl)).text(), /cwb-verifier-probe/);
  assert.equal((await fetch(server.resourceBase.replace(/\/[a-f0-9]{32}\//, '/wrong/') + '/scene.pkg')).status, 404);
  assert.equal((await fetch(server.resourceBase + '/evil.exe')).status, 404);
  assert.equal((await fetch(server.resourceBase + '/project.json', { method: 'POST' })).status, 405);
});
test('served scene renderer has an exact completion overlay; vendored bytes remain immutable and Range/HEAD match served bytes', async (t) => {
  const { server } = await fixture(t);
  const original = await readFile(new URL('../bridge-runtime/vendor/webwallgl/assets/renderer-AJkjEL9i.js', import.meta.url));
  const url = server.origin + '/wallpaper-engine/scene-live/assets/renderer-AJkjEL9i.js';
  const response = await fetch(url), patched = Buffer.from(await response.arrayBuffer());
  assert.equal(response.status, 200); assert.ok(patched.length > original.length);
  assert.match(patched.toString(), /en\.beginFrame\(\);.*?t\.raf=requestAnimationFrame\(eo\);try\{window\.__cwbSceneRenderComplete\?\.\(\)\}catch\{\}/);
  assert.ok((await readFile(new URL('../bridge-runtime/vendor/webwallgl/assets/renderer-AJkjEL9i.js', import.meta.url))).equals(original));
  const head = await fetch(url, { method: 'HEAD' }); assert.equal(Number(head.headers.get('content-length')), patched.length);
  const ranged = await fetch(url, { headers: { Range: `bytes=${patched.length - 20}-` } });
  assert.equal(ranged.status, 206); assert.equal(ranged.headers.get('content-range'), `bytes ${patched.length - 20}-${patched.length - 1}/${patched.length}`);
  assert.ok(Buffer.from(await ranged.arrayBuffer()).equals(patched.subarray(-20)));
  assert.equal((await fetch(url, { headers: { Range: `bytes=${patched.length}-` } })).status, 416);
  assert.equal(server.diagnostics().rendererOverlay, 'scene-render-completion-v1');
});

test('verifier tracing is explicit only and normal source/permission boundaries remain unchanged', async (t) => {
  const { server } = await fixture(t, { diagnosticProbe: true });
  assert.match(await (await fetch(server.rendererUrl)).text(), /cwb-verifier-probe/);
  assert.equal((await fetch(server.origin + '/cwb-verifier-probe.js')).status, 200);
  assert.equal((await fetch(server.origin + '/api/config')).status, 404);
});

test('verified Codex standard app origin gets an exact ancestor and message target, never a wildcard', async (t) => {
  const { server } = await fixture(t, { parentOrigin: 'app://-' });
  const response = await fetch(server.rendererUrl);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors app:\/\/-;/);
  const capability = new URL(server.resourceBase).pathname.split('/')[1];
  const config = await (await fetch(`${server.origin}/${capability}/bridge-config.json`)).json();
  assert.equal(config.parentOrigin, 'app://-');
  assert.equal((await raw(server, new URL(server.resourceBase).pathname + '/project.json', { Origin: 'app://-' })).status, 403);
});

test('opaque, noncanonical, credentialed and different app origins fail closed before listening', () => {
  for (const parentOrigin of ['null', '*', 'app://-/index.html', 'app://-/', 'app://other', 'APP://-',
    'app://-:42', 'app://user@-', 'file://', 'https://127.0.0.1:1234', 'http://localhost:1234',
    'http://127.0.0.2:1234', 'http://user@127.0.0.1:1234', 'http://127.0.0.1:1234/']) {
    assert.throws(() => createSceneServer({ project: { type: 'scene', rootPath: process.cwd() }, parentOrigin }), /parent|URL/, parentOrigin);
  }
});

test('desktop ancestry is an explicit boolean opt-in and never changes the immediate message origin', async t => {
  const { server } = await fixture(t, { desktopAncestor: true });
  const response = await fetch(server.rendererUrl);
  const csp = response.headers.get('content-security-policy');
  assert.match(csp, /frame-ancestors http:\/\/127\.0\.0\.1:42341 cwb-desktop:\/\/shell;/);
  assert.doesNotMatch(csp, /frame-ancestors[^;]*(?:file:|\*|null)/);
  const capability = new URL(server.resourceBase).pathname.split('/')[1];
  const config = await (await fetch(`${server.origin}/${capability}/bridge-config.json`)).json();
  assert.equal(config.parentOrigin, 'http://127.0.0.1:42341');
  for (const desktopAncestor of ['file:', '*', 'cwb-desktop://other', [], null]) {
    assert.throws(() => createSceneServer({ project: { type: 'scene', rootPath: process.cwd() }, desktopAncestor }), /ancestor/);
  }
  assert.throws(() => createSceneServer({ project: { type: 'scene', rootPath: process.cwd() }, desktopAncestor: true }), /ancestor/);
});

test('scene payload supports bounded single Range, HEAD and deterministic transfer accounting', async (t) => {
  const { server } = await fixture(t);
  const response = await fetch(server.resourceBase + '/scene.pkg', { headers: { Range: 'bytes=0-7' } });
  assert.equal(response.status, 206);
  assert.equal(await response.text(), 'PKGV0001');
  assert.equal(response.headers.get('content-range'), 'bytes 0-7/21');
  assert.equal((await fetch(server.resourceBase + '/scene.pkg', { method: 'HEAD' })).status, 200);
  for (const range of ['bytes=999-', 'bytes=0-1,3-4', 'bytes=9-2', 'bytes=-0']) {
    assert.equal((await fetch(server.resourceBase + '/scene.pkg', { headers: { Range: range } })).status, 416, range);
  }
  assert.equal(server.diagnostics().bytes, 8);
  assert.ok(!JSON.stringify(server.diagnostics()).includes(new URL(server.resourceBase).pathname.split('/')[1]));
});

test('raw encoded traversal, ADS, symlink escape and vendor non-allowlist paths are rejected', async (t) => {
  const { server, root, projectRoot } = await fixture(t);
  const prefix = new URL(server.resourceBase).pathname;
  for (const suffix of ['/../secret.json', '/%2e%2e/secret.json', '/%2E%2E%5csecret.json', '/scene.pkg%3Asecret', '/%00.json', '/%zz']) {
    const result = await raw(server, prefix + suffix);
    assert.equal(result.status, 400, suffix);
    assert.doesNotMatch(result.body, /secret|[A-Z]:\\/);
  }
  await symlink(root, path.join(projectRoot, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.equal((await fetch(server.resourceBase + '/escape/secret.json')).status, 404);
  assert.equal((await fetch(server.origin + '/wallpaper-engine/scene-live/LICENSE')).status, 404);
});

test('wrong Host, cross-origin reads and OPTIONS cannot authorize control or scene resources', async (t) => {
  const { server } = await fixture(t);
  const route = new URL(server.resourceBase).pathname + '/project.json';
  assert.equal((await raw(server, route, { Host: 'evil.test' })).status, 403);
  for (const origin of ['http://evil.test', 'null', 'http://127.0.0.1:42341']) {
    const result = await raw(server, route, { Origin: origin });
    assert.equal(result.status, 403);
    assert.equal(result.headers['access-control-allow-origin'], undefined);
  }
  assert.equal((await raw(server, route, { Origin: server.origin })).status, 200);
  assert.equal((await raw(server, route, {}, 'OPTIONS')).status, 405);
});

test('close is idempotent, concurrent lifecycle calls do not leak listeners, restart changes origin', async (t) => {
  const { server } = await fixture(t);
  const previous = server.origin;
  await Promise.all([server.start(), server.start()]);
  assert.equal(server.origin, previous);
  await Promise.all([server.close(), server.close()]);
  await assert.rejects(fetch(previous + '/'));
  await Promise.all([server.start(), server.start()]);
  assert.notEqual(server.origin, previous);
});

test('closing an active payload destroys its stream; restart uses a fresh transfer ledger', async (t) => {
  const { server, projectRoot } = await fixture(t);
  await writeFile(path.join(projectRoot, 'large.pkg'), Buffer.alloc(24 * 1024 ** 2, 7));
  const req = httpRequest(server.resourceBase + '/large.pkg');
  const res = await new Promise((resolve, reject) => { req.on('response', resolve); req.on('error', reject); req.end(); });
  res.pause();
  await server.close();
  res.destroy(); req.destroy();
  await server.start();
  assert.deepEqual(server.diagnostics().requests, []);
  assert.equal(server.diagnostics().bytes, 0);
  assert.equal((await fetch(server.resourceBase + '/project.json')).status, 200);
});

test('oversized scene payload and rating-blocked projects are explicitly denied', async (t) => {
  const { server, projectRoot } = await fixture(t);
  const file = path.join(projectRoot, 'oversized.pkg');
  await writeFile(file, ''); await truncate(file, MAX_SCENE_ASSET_BYTES + 1);
  assert.equal((await fetch(server.resourceBase + '/oversized.pkg', { method: 'HEAD' })).status, 404);
  const blocked = createSceneServer({ project: { id: 'scene', type: 'scene', rootPath: projectRoot, metadata: { contentRating: 'Mature' } },
    config: { library: { allowedRatings: ['everyone'] } } });
  await assert.rejects(blocked.start(), /eligible/);
});

test('startup rejects non-scene, hidden/rating-blocked projects, or tampered vendored assets', async (t) => {
  const { projectRoot } = await fixture(t);
  assert.throws(() => createSceneServer({ project: { type: 'web', rootPath: projectRoot } }), /scene/);
  const hidden = createSceneServer({ project: { id: 'scene', type: 'scene', rootPath: projectRoot },
    config: { library: { hiddenIds: ['scene'] } } });
  await assert.rejects(hidden.start(), /eligible/);
  const tampered = path.join(projectRoot, 'vendor');
  await mkdir(tampered);
  await writeFile(path.join(tampered, 'vendor-lock.json'), await readFile(new URL('../bridge-runtime/vendor/webwallgl/vendor-lock.json', import.meta.url)));
  await assert.rejects(verifyWebWallglAssets(tampered), /integrity/);
});
