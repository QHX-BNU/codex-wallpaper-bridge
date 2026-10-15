import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { build } from 'esbuild';
import { desktopMainBuildOptions } from '../scripts/desktop-main-build.mjs';
import { COMPILED_BRIDGE_UNPACKED_FILES } from '../src/package-layout.mjs';

const workspace = fileURLToPath(new URL('..', import.meta.url));
const base = { bundle: true, external: ['electron', 'ws'], format: 'esm', platform: 'node', logLevel: 'silent', metafile: true };
async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-main-build-'));
  t.after(async () => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    await rm(root, { recursive: true, force: true });
  });
  const sourceRoot = path.join(root, 'src'), distRoot = path.join(root, 'dist');
  await mkdir(sourceRoot); await mkdir(path.join(distRoot, 'bridge-runtime', 'src'), { recursive: true });
  return { root, sourceRoot, distRoot };
}

test('actual desktop main leaves the native host at its packaged module-relative asset base', async t => {
  const { distRoot } = await fixture(t);
  const result = await build(desktopMainBuildOptions({ sourceRoot: path.join(workspace, 'src'), distRoot, base }));
  const inputs = Object.keys(result.metafile.inputs).map(file => file.replaceAll('\\', '/'));
  assert.equal(inputs.some(file => file.endsWith('/engine-renderer-owner.mjs')), false,
    'inlining the owner relocates scene-server import.meta.url to desktop main');
  assert.equal(inputs.some(file => file.endsWith('/scene-server.mjs')), false);
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  assert.ok(imports.some(entry => entry.external && entry.path === './bridge-runtime/src/desktop-engine-host.mjs'));
  assert.ok(COMPILED_BRIDGE_UNPACKED_FILES.includes('dist/bridge-runtime/src/desktop-engine-host.mjs'));
  const source = await readFile(path.join(workspace, 'scripts', 'build-app.mjs'), 'utf8');
  assert.match(source, /build\(desktopMainBuildOptions\(\{ sourceRoot, distRoot, base: nodeBuild \}\)\)/);
});

test('a relocated main really resolves native assets and preload relative to the emitted host, not main', async t => {
  const { sourceRoot, distRoot } = await fixture(t);
  const source = `export const vendor = new URL('../vendor/webwallgl/', import.meta.url).href;
    export const bridge = new URL('../public/cwb-scene-bridge.js', import.meta.url).href;
    export const preload = new URL('./engine-vp8-preload.cjs', import.meta.url).href;`;
  await writeFile(path.join(sourceRoot, 'desktop-engine-host.mjs'), source);
  await writeFile(path.join(sourceRoot, 'main.mjs'), `export { vendor, bridge, preload } from './desktop-engine-host.mjs';`);
  const hostFile = path.join(distRoot, 'bridge-runtime', 'src', 'desktop-engine-host.mjs');
  await build({ ...base, entryPoints: [path.join(sourceRoot, 'desktop-engine-host.mjs')], outfile: hostFile });
  await build(desktopMainBuildOptions({ sourceRoot, distRoot, base }));
  const actual = await import(pathToFileURL(path.join(distRoot, 'main.mjs')).href);
  for (const [key, relative] of [['vendor', '../vendor/webwallgl/'], ['bridge', '../public/cwb-scene-bridge.js'], ['preload', './engine-vp8-preload.cjs']]) {
    assert.equal(actual[key], new URL(relative, pathToFileURL(hostFile)).href);
  }
});

test('native host boundary does not redirect same-named imports from unrelated entry points', async t => {
  const { sourceRoot, distRoot } = await fixture(t);
  await writeFile(path.join(sourceRoot, 'desktop-engine-host.mjs'), 'export const local = 7;');
  await writeFile(path.join(sourceRoot, 'other.mjs'), `export { local } from './desktop-engine-host.mjs';`);
  const result = await build({ ...desktopMainBuildOptions({ sourceRoot, distRoot, base }),
    entryPoints: [path.join(sourceRoot, 'other.mjs')], outfile: path.join(distRoot, 'other.mjs') });
  const imports = Object.values(result.metafile.outputs).flatMap(output => output.imports);
  assert.equal(imports.some(entry => entry.path.includes('bridge-runtime')), false);
  assert.equal((await import(pathToFileURL(path.join(distRoot, 'other.mjs')).href)).local, 7);
});
