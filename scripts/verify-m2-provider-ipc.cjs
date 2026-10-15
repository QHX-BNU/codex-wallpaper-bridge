// Legacy verifier is sealed while its required sample is excluded by the user.
require('./m2-test-policy.cjs').assertM2TestProject('3790869794');
/* Real isolated Electron main/UtilityProcess/native source, not Codex acceptance. */
const electron = require('electron');
const { app, BrowserWindow, utilityProcess } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { pathToFileURL } = require('node:url');
const { prepareFeatureEvidenceRoot } = require('./m2-feature-boundary.cjs');
const [workspaceArg, libraryArg, outputArg] = process.argv.slice(2);
if (![workspaceArg, libraryArg, outputArg].every(Boolean)) throw Error('workspace, readonly library and fresh evidence directory required');
const workspace = path.resolve(workspaceArg), library = path.resolve(libraryArg), root = prepareFeatureEvidenceRoot(workspace, outputArg);
app.setPath('userData', path.join(root, 'profile')); app.on('window-all-closed', () => {});
fsSync.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
const report = { at: new Date().toISOString(), scope: 'isolated-real-utility-native-provider-prerequisite', artifact: 'compiled-dist-provider-and-owner',
  electron: process.versions.electron, chromium: process.versions.chrome, codexHostsVerified: false, productionSwitchIntegrated: false,
  dailyCliProviderIntegrated: false, authorRendererIpcExposed: false, steps: [], captures: [] };
const owners = [], captures = [];
let child, childEnded = false, binding, host;
const mod = (relative) => import(pathToFileURL(path.join(workspace, relative)).href);
async function bounded(promise, ms = 90000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('native_provider_probe_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
async function main() {
  await app.whenReady();
  const { EngineRendererOwner } = await mod('dist/bridge-runtime/src/engine-renderer-owner.mjs');
  const { createDesktopEngineHost } = await mod('dist/bridge-runtime/src/desktop-engine-host.mjs');
  const { ConfigStore } = await mod('bridge-runtime/src/config-store.mjs');
  const { normalizeAuthorProperties } = await mod('bridge-runtime/src/author-properties.mjs');
  const { scanWallpaperProjects } = await mod('bridge-runtime/src/scanner.mjs');
  const stateRoot = path.join(root, 'state');
  const store = new ConfigStore({ filePath: path.join(stateRoot, 'CodexWallpaperBridge', 'config.json') }); await store.load();
  let key, saved;
  for (const [id, type] of [['3233141951', 'scene'], ['3790869794', 'web'], ['1778944028', 'scene']]) {
    const rootPath = path.join(library, id), manifest = JSON.parse(await fs.readFile(path.join(rootPath, 'project.json'), 'utf8'));
    assert.equal(String(manifest.type).toLowerCase(), type);
    if (id === '3233141951') {
      const normalized = normalizeAuthorProperties(manifest.general.properties);
      key = Object.keys(normalized.schema).find((name) => normalized.schema[name].type === 'bool'); assert.ok(key);
      saved = !normalized.values[key]; await store.setAuthorProperties(id, { [key]: saved });
    }
  }
  report.persistedConfigOnlyInEvidenceRoot = true;
  report.desktopRegistryAndReadOnlyDiskResolverUsed = true;
  child = utilityProcess.fork(path.join(workspace, 'scripts/m2-provider-ipc-probe.mjs'), [workspace, key, String(saved)],
    { cwd: workspace, env: { ...process.env, CWB_NATIVE_ENGINE_PROVIDER: 'owned-parent-v1' },
      stdio: 'pipe', serviceName: 'M2 isolated native provider probe' });
  report.utilityPid = child.pid;
  child.once('spawn', () => { report.utilityPid = child.pid; });
  const ended = new Promise((resolve) => child.once('exit', (code) => { childEnded = true; resolve(code); }));
  host = createDesktopEngineHost({ electron, env: { ...process.env, LOCALAPPDATA: stateRoot, XDG_CONFIG_HOME: stateRoot },
    scan: async () => {
      const inventory = await scanWallpaperProjects({ steamRoots: [path.resolve(library, '../../../..')] });
      report.registryCount = inventory.projects.length; return inventory;
    }, createOwner: (snapshot) => {
    const owner = new EngineRendererOwner({ electron, ...snapshot }); owner.projectId = snapshot.project.id; owners.push(owner);
    const capture = owner.capture.bind(owner);
    owner.capture = async () => {
      const frame = await capture(); assert.ok(captures.length < 16);
      const hash = createHash('sha256').update(frame.png).digest('hex'); captures.push({ id: owner.projectId, hash, frame });
      return frame;
    };
    return owner;
  } });
  binding = host.attach(child);
  child.on('message', (message) => {
    if (message?.channel !== 'cwb-provider-probe') return;
    if (message.event === 'step') {
      assert.ok(report.steps.length < 8);
      report.steps.push({ ...message, status: 'pass', nativeWindows: BrowserWindow.getAllWindows().length, slots: binding.status().slots });
    }
    if (message.event === 'done') { report.probeOutcome = message.outcome; report.probeError = message.error; }
  });
  const code = await bounded(ended); assert.equal(code, 0); assert.equal(report.probeOutcome, 'pass'); assert.equal(report.steps.length, 5);
  await binding.close(); await host.close();
  const hashes = new Set(captures.map((capture) => capture.hash));
  for (const step of report.steps) for (const key of ['frameHash', 'pausedHash', 'resumedHash']) if (step[key]) assert.ok(hashes.has(step[key]), 'IPC bytes must hash-match an exact native parent capture');
  for (const [index, capture] of captures.entries()) {
    await fs.writeFile(path.join(root, `parent-native-${index}.png`), capture.frame.png, { flag: 'wx' });
    report.captures.push({ id: capture.id, sequence: capture.frame.sequence, bytes: capture.frame.png.length, hash: capture.hash });
  }
  report.parentNativeHashMatches = true; report.providerClosed = binding.status().closed; assert.equal(binding.status().slots, 0);
  report.desktopHost = host.status(); assert.equal(report.desktopHost.slots, 0); assert.equal(report.desktopHost.peers, 0);
  assert.equal(child.listenerCount('message'), 1); // Only this helper's fixed result listener remains.
  report.outcome = 'pass';
}
main().catch((error) => { report.outcome = 'fail'; report.error = String(error.message).slice(0, 240); })
  .finally(async () => {
    try {
      await binding?.close(); await host?.close(); for (const owner of owners) await owner.release();
      if (child && !childEnded) child.kill();
      report.owners = owners.map((owner) => ({ id: owner.projectId, ...owner.status() }));
      report.resourcesClosed = report.owners.every((owner) => owner.resourcesClosed); assert.equal(report.resourcesClosed, true);
      report.remainingWindows = BrowserWindow.getAllWindows().length; assert.equal(report.remainingWindows, 0);
    } catch { report.cleanupFailed = true; report.outcome = 'fail'; }
    report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    app.exit(report.outcome === 'pass' ? 0 : 1);
  });
