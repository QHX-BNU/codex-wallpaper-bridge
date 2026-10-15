/** Real hidden Windows helper + compiled HTTP save/recovery, power-only.
 * No audio capture, GSMTC, player, Codex window, long resource run or EXE.
 */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { build } from 'esbuild';
import { createTestScratch, cleanupTestScratch } from './m3-test-artifacts.mjs';

if (process.platform !== 'win32' || process.argv.length !== 3 || process.argv[2] !== '--approved-power-only') throw Error('power_only_opt_in_required');
const workspace = path.resolve(import.meta.dirname, '..');
const evidenceRoot = path.join(workspace, 'out', `m3-provider-recovery-${Date.now()}-${randomUUID().slice(0, 8)}`);
await mkdir(evidenceRoot);
const scratch = await createTestScratch(evidenceRoot), root = scratch.directory;
const report = { scope: 'compiled-HTTP-and-real-hidden-power-only-helper', realCodexOperated: false, foregroundRequested: false,
  audioCaptured: false, nowPlayingRead: false, physicalPowerChanged: false, longResourceRun: false, checks: [], children: [] };
const sources = ['bridge-runtime/src/windows-media-provider.mjs', 'bridge-runtime/src/media-middleware.mjs',
  'bridge-runtime/native/windows-media.cs', 'bridge-runtime/native/windows-media.ps1', 'bridge-runtime/src/media-server.mjs',
  'bridge-runtime/src/config-store.mjs', 'bridge-runtime/src/media-lyrics.mjs', 'scripts/verify-m3-provider-recovery.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(sources.map(async file =>
  [file, createHash('sha256').update(await readFile(path.join(workspace, file))).digest('hex')])));
report.sourceSha256 = await hashes();
const children = [], powerEvents = [];
let provider, media, server;
const check = (name, ok) => { report.checks.push({ name, ok: Boolean(ok) }); assert.ok(ok, name); };
const until = async predicate => {
  const deadline = Date.now() + 8000;
  while (!predicate()) { if (Date.now() >= deadline) throw Error('recovery_observation_timeout'); await new Promise(resolve => setTimeout(resolve, 25)); }
};
try {
  await mkdir(path.join(root, 'src')); await mkdir(path.join(root, 'native'));
  for (const file of ['windows-media.cs', 'windows-media.ps1']) await copyFile(path.join(workspace, 'bridge-runtime/native', file), path.join(root, 'native', file));
  const entry = path.join(root, 'src', 'probe.mjs');
  await build({ stdin: { contents: [
    "export { WindowsMediaProvider } from './bridge-runtime/src/windows-media-provider.mjs';",
    "export { MediaMiddleware } from './bridge-runtime/src/media-middleware.mjs';",
    "export { ConfigStore } from './bridge-runtime/src/config-store.mjs';",
    "export { createMediaServer } from './bridge-runtime/src/media-server.mjs';",
    "export { LyricsStore } from './bridge-runtime/src/media-lyrics.mjs';",
  ].join('\n'), resolveDir: workspace, sourcefile: 'm3-recovery-entry.mjs', loader: 'js' },
  outfile: entry, bundle: true, minify: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' });
  report.compiledSha256 = createHash('sha256').update(await readFile(entry)).digest('hex');
  const api = await import(pathToFileURL(entry).href);
  const store = new api.ConfigStore({ filePath: path.join(root, 'config.json') }); await store.load();
  await store.set({ effects: { playing: false, pauseOnBattery: true }, cache: { directory: path.join(root, 'cache') }, library: { directory: path.join(root, 'library') } });
  provider = new api.WindowsMediaProvider({ spawnChild: (file, args, options) => {
    assert.equal(options.windowsHide, true); assert.equal(options.shell, false);
    assert.equal(args[args.indexOf('-Audio') + 1], '0'); assert.equal(args[args.indexOf('-Media') + 1], '0');
    assert.equal(args[args.indexOf('-Power') + 1], '1'); assert.equal(args[args.indexOf('-File') + 1], path.join(root, 'native/windows-media.ps1'));
    const child = spawn(file, args, options), record = { pid: child.pid, exited: false };
    report.children.push(record); children.push(child);
    child.once('exit', (code, signal) => Object.assign(record, { exited: true, code, signal }));
    child.once('error', () => { if (!child.pid) Object.assign(record, { exited: true, spawnFailed: true }); });
    return child;
  } });
  media = new api.MediaMiddleware({ getConfig: () => store.get(), createProvider: () => provider,
    lyrics: new api.LyricsStore({ root: path.join(root, 'lyrics') }), onPower: value => powerEvents.push({ onBattery: value.onBattery }) });
  server = api.createMediaServer({ configStore: store, projects: [], cacheEnv: {}, media, onConfigChange: () => media.configure() });
  await server.start(); await media.configure(); await until(() => powerEvents.length > 0);
  check('real-hidden-power-only-helper-ready', provider.status().running && provider.status().reason === 'ready');
  const state = await (await fetch(new URL('api/media', server.baseUrl))).json();
  check('audio-media-controls-remain-disabled', state.track === null && state.commands.length === 0 && state.sources.audio === 'off' && state.sources.media === 'off');
  // A natural stop outside configure reproduces an unexpected helper exit
  // without force-killing a process or changing any OS power setting.
  children[0].stdin.end('{"op":"stop"}\n'); await until(() => report.children[0].exited);
  check('exit-observed-without-auto-respawn', provider.status().running === false && provider.status().reason === 'unavailable' && children.length === 1);
  const before = powerEvents.length;
  const response = await fetch(new URL('api/config', server.baseUrl), { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: server.origin },
    body: JSON.stringify({ effects: { playing: false, pauseOnBattery: true } }) });
  await response.arrayBuffer(); await until(() => powerEvents.length > before);
  check('same-settings-HTTP-save-restarts-one-helper', response.status === 200 && children.length === 2 && provider.status().reason === 'ready');
  await media.configure(); await media.snapshot(); await media.pump();
  check('healthy-configure-and-poll-do-not-respawn', children.length === 2);
  check('manual-pause-and-opt-in-config-preserved', store.get().effects.playing === false && store.get().effects.onBattery === undefined
    && Object.values(store.get().media).every(value => value === false));
  await media.close(); await until(() => report.children.every(child => child.exited));
  check('owned-helpers-exit-naturally', report.children.every(child => child.code === 0 && child.signal === null) && provider.status().forcedStops === 0);
  await assert.rejects(media.configure(), /media_closed/); await assert.rejects(provider.configure({ power: true }), /media_provider_closed/);
  check('shutdown-seals-recovery', children.length === 2);
  assert.deepEqual(await hashes(), report.sourceSha256); check('source-stable', true);
  report.ok = true;
} catch (error) {
  report.ok = false; report.error = /^[a-z0-9_-]+$/.test(error.message) ? error.message : 'recovery_validation_failed';
  process.exitCode = 1;
} finally {
  try { await server?.close(); await media?.close(); }
  catch { report.ok = false; report.cleanupError = 'owned_shutdown_failed'; process.exitCode = 1; }
  report.provider = provider?.status();
  if (report.children.every(child => child.exited)) report.cleanup = await cleanupTestScratch(scratch);
  else { report.ok = false; report.cleanupError = 'owned_helper_still_running'; process.exitCode = 1; }
  await writeFile(path.join(evidenceRoot, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ evidenceRoot, ok: report.ok, checks: report.checks, provider: report.provider, scratchRemoved: report.cleanup?.removed, error: report.error }));
}
