import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { DESKTOP_RENDERER_ORIGIN, DESKTOP_RENDERER_URL } from '../bridge-runtime/src/desktop-origin.mjs';
import { registerDesktopRendererScheme, installDesktopRendererProtocol } from '../src/desktop-renderer-protocol.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-desktop-protocol-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const rendererRoot = path.join(root, 'renderer'); await mkdir(rendererRoot);
  for (const name of ['index.html', 'renderer-desktop.mjs', 'styles.css']) await writeFile(path.join(rendererRoot, name), name);
  let handle;
  await installDesktopRendererProtocol({ protocol: { handle: (scheme, fn) => {
    assert.equal(scheme, 'cwb-desktop'); handle = fn;
  } }, rendererRoot });
  return { root, rendererRoot, request: (url, method = 'GET') => handle({ url, method }) };
}

test('desktop shell has an exact standard secure origin without bypassing CSP or enabling Node', () => {
  const calls = [];
  registerDesktopRendererScheme({ registerSchemesAsPrivileged: value => calls.push(value) });
  assert.equal(DESKTOP_RENDERER_ORIGIN, 'cwb-desktop://shell');
  assert.equal(DESKTOP_RENDERER_URL, `${DESKTOP_RENDERER_ORIGIN}/index.html`);
  assert.deepEqual(calls, [[{ scheme: 'cwb-desktop', privileges: { standard: true, secure: true, supportFetchAPI: true } }]]);
});

test('desktop protocol serves only three owned renderer assets with explicit types and nosniff', async t => {
  const f = await fixture(t);
  for (const [name, type] of [['index.html', 'text/html'], ['renderer-desktop.mjs', 'text/javascript'], ['styles.css', 'text/css']]) {
    const response = await f.request(`${DESKTOP_RENDERER_ORIGIN}/${name}`);
    assert.equal(response.status, 200); assert.equal(await response.text(), name);
    assert.match(response.headers.get('content-type'), new RegExp(type));
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(response.headers.get('cache-control'), 'no-store');
  }
  const head = await f.request(DESKTOP_RENDERER_URL, 'HEAD');
  assert.equal(head.status, 200); assert.equal(await head.text(), '');
});

test('desktop protocol rejects foreign authorities, credentials, queries, encodings, methods and arbitrary files', async t => {
  const f = await fixture(t);
  for (const url of ['file:///index.html', 'http://127.0.0.1/index.html', 'cwb-desktop://other/index.html',
    'cwb-desktop://shell:123/index.html', 'cwb-desktop://user@shell/index.html',
    `${DESKTOP_RENDERER_URL}?anything=1`, `${DESKTOP_RENDERER_URL}#hash`,
    `${DESKTOP_RENDERER_ORIGIN}/%69ndex.html`, `${DESKTOP_RENDERER_ORIGIN}/../preload.cjs`,
    `${DESKTOP_RENDERER_ORIGIN}/preload.cjs`, `${DESKTOP_RENDERER_ORIGIN}/settings.json`]) {
    assert.equal((await f.request(url)).status, 404, url);
  }
  assert.equal((await f.request(DESKTOP_RENDERER_URL, 'POST')).status, 405);
});

test('desktop protocol refuses linked asset paths escaping the owned renderer root and oversized assets', async t => {
  const f = await fixture(t), outside = path.join(f.root, 'outside'); await mkdir(outside);
  await writeFile(path.join(outside, 'secret.css'), 'private');
  await rm(path.join(f.rendererRoot, 'styles.css'));
  await symlink(outside, path.join(f.rendererRoot, 'styles.css'), 'junction');
  assert.equal((await f.request(`${DESKTOP_RENDERER_ORIGIN}/styles.css`)).status, 404);
  await writeFile(path.join(f.rendererRoot, 'renderer-desktop.mjs'), Buffer.alloc(1024 * 1024));
  assert.equal((await f.request(`${DESKTOP_RENDERER_ORIGIN}/renderer-desktop.mjs`)).status, 404);
});
