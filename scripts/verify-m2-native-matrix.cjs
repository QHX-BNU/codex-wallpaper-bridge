/* Allowed readonly projects through the actual native owner and shared M1 switcher.
 * Short isolated regression only, not Codex, audible or long-duration acceptance. */
const electron = require('electron');
const { app, BrowserWindow, nativeImage } = electron;
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { prepareFeatureEvidenceRoot } = require('./m2-feature-boundary.cjs');
const [workspaceArg, libraryArg, outputArg] = process.argv.slice(2);
if (![workspaceArg, libraryArg, outputArg].every(Boolean) || process.argv.length !== 5) throw Error('workspace, readonly library and fresh evidence directory required');
const workspace = path.resolve(workspaceArg), library = path.resolve(libraryArg), root = prepareFeatureEvidenceRoot(workspace, outputArg);
app.setPath('userData', path.join(root, 'profile'));
app.on('window-all-closed', () => {});
fsSync.writeFileSync(path.join(root, 'startup.json'), JSON.stringify({ pid: process.pid, at: new Date().toISOString() }));
const samples = [
  ['1778944028', 'scene', true], ['3000932165', 'scene', true], ['3444535389', 'scene', true],
  ['3233141951', 'scene', true], ['3553574985', 'scene', true],
  ['3785016842', 'web', false], ['895116177', 'web', false],
];
const configuredCycles = 3;
const report = { at: new Date().toISOString(), scope: 'isolated-native-allowed-project-short-switch-regression',
  artifact: 'compiled-dist-owner', electron: process.versions.electron, chromium: process.versions.chrome,
  codexHostsVerified: false, productionSwitchIntegrated: false, audibleOutputVerified: false, longDurationVerified: false,
  configuredCycles, configuredSampleCount: samples.length,
  configuredSceneCount: samples.filter(([, type]) => type === 'scene').length,
  configuredWebCount: samples.filter(([, type]) => type === 'web').length,
  configuredSwitches: samples.length * configuredCycles, samples: [], switches: [], resourceSnapshots: [] };
const owners = [], closing = [];
let Owner, switcher, active;
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mod = (relative) => import(pathToFileURL(path.join(workspace, relative)).href);
async function bounded(promise, ms = 60000) {
  let timer; try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('native_matrix_timeout')), ms); })]); }
  finally { clearTimeout(timer); }
}
function pixels(a, b) {
  const left = nativeImage.createFromBuffer(a.png).toBitmap(), right = nativeImage.createFromBuffer(b.png).toBitmap();
  assert.equal(left.length, 800 * 450 * 4); assert.equal(left.length, right.length);
  let changed = 0, nonblack = 0;
  for (let i = 0; i < left.length; i += 4) {
    if (Math.abs(left[i] - right[i]) + Math.abs(left[i + 1] - right[i + 1]) + Math.abs(left[i + 2] - right[i + 2]) > 9) changed++;
    if (left[i] + left[i + 1] + left[i + 2] > 30) nonblack++;
  }
  return { changedRatio: changed / (left.length / 4), nonblackRatio: nonblack / (left.length / 4) };
}
async function snapshot(label) {
  report.resourceSnapshots.push({ label, at: new Date().toISOString(), windows: BrowserWindow.getAllWindows().length,
    mainMemoryKiB: await process.getProcessMemoryInfo(), processes: app.getAppMetrics().map((item) => ({
      pid: item.pid, type: item.type, cpu: item.cpu, memory: item.memory,
    })) });
  await fs.writeFile(path.join(root, 'progress.json'), JSON.stringify(report, null, 2));
}
async function main() {
  await bounded(app.whenReady());
  ({ EngineRendererOwner: Owner } = await mod('dist/bridge-runtime/src/engine-renderer-owner.mjs'));
  const { createMediaSwitcher } = await mod('bridge-runtime/src/media-switch.mjs');
  const { EngineFailureMemory } = await mod('bridge-runtime/src/engine-health.mjs');
  const failures = new EngineFailureMemory();
  switcher = createMediaSwitcher({ timeoutMs: 45000, create: (project) => {
    const owner = new Owner({ electron, project, failures }); owner.projectId = project.id; owners.push(owner); return owner;
  }, commit: (owner) => { active = owner; }, dispose: (owner) => { closing.push(owner.release()); } });
  await snapshot('no-source-baseline');
  for (let cycle = 0; cycle < configuredCycles; cycle++) {
    for (const [id, type, expectedDynamic] of samples) {
      const result = { id, type, cycle, expectedDynamic, outcome: 'pending' }; report.switches.push(result);
      if (cycle === 0) report.samples.push(result);
      const before = active, started = Date.now();
      try {
        const rootPath = path.join(library, id);
        require('./m2-test-policy.cjs').assertM2TestRoot(rootPath);
        const manifest = JSON.parse(await fs.readFile(path.join(rootPath, 'project.json'), 'utf8'));
        assert.equal(String(manifest.type).toLowerCase(), type);
        const handle = switcher.prepare({ id, type, rootPath, title: 'readonly native matrix ' + id }, id);
        result.preparingSlots = switcher.status().slots; assert.equal(active, before);
        assert.ok(result.preparingSlots <= 2); assert.equal(result.preparingSlots, before ? 2 : 1);
        const commit = await bounded(switcher.commit(handle)); assert.equal(commit.ok, true);
        await Promise.all(closing); result.readyMs = Date.now() - started;
        assert.equal(active.status().actualFrame, true); assert.equal(active.status().frameClock.offscreen, true);
        assert.equal(BrowserWindow.getAllWindows().length, 1); assert.equal(switcher.status().slots, 1);
        assert.ok(owners.filter((owner) => owner !== active).every((owner) => owner.status().resourcesClosed));
        if (cycle === 0) {
          const a = await active.capture(); await delay(700); const b = await active.capture();
          for (const [name, frame] of [['a', a], ['b', b]]) await fs.writeFile(path.join(root, `${id}-${name}.png`), frame.png, { flag: 'wx' });
          result.nativePixels = pixels(a, b);
          // Sample-specific dynamic oracle, not a universal brightness or first-frame gate.
          if (expectedDynamic) assert.ok(result.nativePixels.changedRatio > .001, 'declared animated sample must change native pixels');
        } else {
          const frame = await active.capture(); assert.ok(frame.png.length > 0);
        }
        result.outcome = 'pass';
      } catch (error) {
        result.outcome = 'fail'; result.error = String(error.message).slice(0, 240);
        await Promise.all(closing); result.retainedPreviousOwner = active === before;
      }
      result.settledSlots = switcher.status().slots;
      await snapshot(`cycle-${cycle}-${id}`);
    }
  }
  report.outcome = report.switches.length === 24 && report.switches.every((item) => item.outcome === 'pass') ? 'pass' : 'fail';
}
main().catch((error) => { report.outcome = 'fail'; report.error = String(error.message).slice(0, 240); })
  .finally(async () => {
    try {
      switcher?.close(); await Promise.all(closing); for (const owner of owners) await owner.release();
      report.owners = owners.map((owner) => ({ id: owner.projectId, ...owner.status() }));
      report.resourcesClosed = report.owners.every((owner) => owner.resourcesClosed); assert.equal(report.resourcesClosed, true);
      report.remainingWindows = BrowserWindow.getAllWindows().length; assert.equal(report.remainingWindows, 0);
      await snapshot('all-owners-closed');
    } catch { report.cleanupFailed = true; report.outcome = 'fail'; }
    report.finishedAt = new Date().toISOString(); await fs.writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2), { flag: 'wx' });
    app.exit(report.outcome === 'pass' ? 0 : 1);
  });
