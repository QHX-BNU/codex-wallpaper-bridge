import { build } from 'esbuild';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createTestScratch, cleanupTestScratch } from './m3-test-artifacts.mjs';

// Isolated compilation only. Never starts Electron, capture or an injector.
const run = process.argv[2] || 'compile-smoke-final';
if (!/^[a-z][a-z0-9-]{0,79}$/.test(run)) throw Error('compile_run_name_invalid');
const evidenceRoot = path.resolve('out/m3-a-20261014', run);
await mkdir(evidenceRoot, { recursive: false }); // fresh directory: never replace prior evidence
const scratch = await createTestScratch(evidenceRoot), root = scratch.directory;
try {
const entry = 'bridge-runtime/src/injected-renderer.mjs', file = path.join(root, 'injected-renderer.mjs');
const base = { bundle: true, format: 'esm', platform: 'node', target: 'node22', minify: true, logLevel: 'silent' };
await build({ ...base, entryPoints: [entry], outfile: file });
const compiledSource = await readFile(file, 'utf8');
const exports = await import(pathToFileURL(file).href), results = [];
for (const flags of [{}, { nativeEnabled: true }, { directSceneEnabled: true }, { nativeEnabled: true, directSceneEnabled: true }]) {
  const script = exports.buildBootstrapScript(flags);
  if (Buffer.byteLength(script) >= 100 * 1024) throw Error('compiled_bootstrap_limit');
  const context = vm.createContext({ document: { hidden: false }, location: { origin: 'app://-' }, addEventListener() {}, removeEventListener() {},
    setTimeout, clearTimeout, setInterval, clearInterval, performance, URL, AbortController });
  vm.runInContext('globalThis.parent=globalThis;', context);
  const result = await vm.runInContext(script, context);
  if (result.ready !== true) throw Error('compiled_bootstrap_invalid');
  if (vm.runInContext('globalThis.__codexWallpaperBridgeRuntime.setPower({onBattery:true})', context) !== true) throw Error('compiled_power_invalid');
  results.push({ flags, bytes: Buffer.byteLength(script), ready: result.ready, power: true });
}
await build({ ...base, entryPoints: ['bridge-runtime/src/cli.mjs'], outfile: path.join(root, 'cli.mjs'),
  external: ['electron', 'ws', 'bufferutil', 'utf-8-validate'],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require=__cr(import.meta.url);' } });
await build({ ...base, entryPoints: ['bridge-runtime/src/media-middleware.mjs'], outfile: path.join(root, 'media-middleware.mjs') });
await build({ ...base, entryPoints: ['bridge-runtime/src/workbench-scene-preview.mjs'], outfile: path.join(root, 'workbench-scene-preview.js'),
  format: 'iife', globalName: 'cwbScenePreview', platform: 'browser', target: 'chrome130' });
const hashes = {};
for (const name of ['cli', 'cdp-injector', 'injection-plan', 'injected-renderer']) {
  const values = await Promise.all(['bridge-overrides', 'bridge-runtime'].map(async directory =>
    createHash('sha256').update(await readFile(`${directory}/src/${name}.mjs`)).digest('hex')));
  if (values[0] !== values[1]) throw Error('override_runtime_drift'); hashes[name] = values[0];
}
await writeFile(path.join(evidenceRoot, 'compile-proof.json'), JSON.stringify({ results, hashes,
  rendererSha: createHash('sha256').update(compiledSource).digest('hex'), isolated: true, sharedDistRebuilt: false }, null, 2));
console.log(JSON.stringify({ results, overrideRuntimeHashesMatch: true }));
} finally { await cleanupTestScratch(scratch); }
