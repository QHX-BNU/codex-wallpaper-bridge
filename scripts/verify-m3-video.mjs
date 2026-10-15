import { build, transform } from 'esbuild';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { createTestScratch, cleanupTestScratch } from './m3-test-artifacts.mjs';

// Fresh isolated compile + loopback proof, not a build of shared dist or an EXE.
const run = process.argv[2] || 'compile-01';
if (!/^[a-z][a-z0-9-]{0,79}$/.test(run)) throw Error('compile_run_invalid');
const evidenceRoot = path.resolve('out/m3-b-20261014', run);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const sourceFiles = ['config-store', 'media-server', 'managed-cache', 'video-tools', 'video-optimizer', 'video-stream']
  .map(file => `bridge-runtime/src/${file}.mjs`).concat(['bridge-runtime/public/app.js', 'bridge-runtime/public/index.html']);
const beforeHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await readFile(file))])));
await mkdir(evidenceRoot, { recursive: false });
const scratch = await createTestScratch(evidenceRoot), root = scratch.directory;
try {
await mkdir(path.join(root, 'runtime/src'), { recursive: true });
await mkdir(path.join(root, 'runtime/public'), { recursive: true });
const base = { bundle: true, platform: 'node', format: 'esm', target: 'node22', minify: true, logLevel: 'silent' };
const serverFile = path.join(root, 'runtime/src/media-server.mjs');
await build({ ...base, entryPoints: ['bridge-runtime/src/media-server.mjs'], outfile: serverFile });
await build({ ...base, entryPoints: ['bridge-runtime/src/cli.mjs'], outfile: path.join(root, 'runtime/src/cli.mjs'),
  external: ['electron', 'ws', 'bufferutil', 'utf-8-validate'],
  banner: { js: 'import { createRequire as __cr } from "node:module"; const require=__cr(import.meta.url);' } });
const compiledServer = await readFile(serverFile, 'utf8');
const ui = await transform(await readFile('bridge-runtime/public/app.js', 'utf8'), { minify: true, loader: 'js', target: 'chrome130' });
const compiledUI = ui.code;
new vm.Script(compiledUI); await writeFile(path.join(root, 'runtime/public/app.js'), compiledUI);
await writeFile(path.join(root, 'runtime/public/index.html'), await readFile('bridge-runtime/public/index.html'));

const atom = (type, payload = Buffer.alloc(0)) => { const b = Buffer.alloc(8); b.writeUInt32BE(8 + payload.length); b.write(type, 4); return Buffer.concat([b, payload]); };
const ftyp = atom('ftyp', Buffer.from('isom0000')), mdat = atom('mdat', Buffer.from('compiled fixture bytes'));
const offsets = Buffer.alloc(12); offsets.writeUInt32BE(1, 4); offsets.writeUInt32BE(ftyp.length + 8, 8);
const raw = Buffer.concat([ftyp, mdat, atom('moov', atom('trak', atom('mdia', atom('minf', atom('stbl', atom('stco', offsets))))))]);
const file = path.join(root, 'fixture.mp4'); await writeFile(file, raw);
const { createMediaServer } = await import(pathToFileURL(serverFile).href);
const server = createMediaServer({ projects: [{ id: 'compiled', rootPath: root, type: 'video', playable: true, mediaPath: file }] });
const results = {};
try {
  await server.start();
  const inventory = await (await fetch(new URL('api/inventory', server.baseUrl))).json();
  const url = new URL(inventory.projects[0].mediaUrl, server.origin);
  const first = await fetch(url), bytes = Buffer.from(await first.arrayBuffer());
  if (first.headers.get('X-CWB-Video-Layout') !== 'faststart' || bytes.equals(raw)) throw Error('compiled_faststart_invalid');
  const range = await fetch(url, { headers: { Range: 'bytes=12-37' } });
  if (range.status !== 206 || !Buffer.from(await range.arrayBuffer()).equals(bytes.subarray(12, 38))) throw Error('compiled_range_invalid');
  await fetch(new URL('api/config', server.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ video: { faststart: false } }) });
  const stable = await fetch(url);
  if (!Buffer.from(await stable.arrayBuffer()).equals(bytes) || !(await readFile(file)).equals(raw)) throw Error('compiled_version_changed');
  Object.assign(results, { compiledServerHTTP: true, faststart: true, range: true, versionStable: true, originalUnchanged: true, uiSyntax: true, cliBundled: true });
} finally { await server.close(); }
const hashes = {};
for (const name of ['cli', 'cdp-injector', 'injection-plan', 'injected-renderer']) {
  const [override, runtime] = await Promise.all(['bridge-overrides', 'bridge-runtime'].map(dir => readFile(`${dir}/src/${name}.mjs`)));
  if (sha(override) !== sha(runtime)) throw Error('override_runtime_drift'); hashes[name] = sha(runtime);
}
const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, sha(await readFile(file))])));
if (JSON.stringify(sourceHashes) !== JSON.stringify(beforeHashes)) throw Error('compiled_source_drift');
await writeFile(path.join(evidenceRoot, 'compile-proof.json'), JSON.stringify({ results, hashes, sourceHashes,
  sourceStable: true, compiledServerSha: sha(compiledServer), compiledUISha: sha(compiledUI), sharedDistRebuilt: false, realCodexOperated: false, visualUIAcceptance: false }, null, 2));
console.log(JSON.stringify(results));
} finally { await cleanupTestScratch(scratch); }
