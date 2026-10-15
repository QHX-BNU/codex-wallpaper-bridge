import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const helper = await readFile(new URL('../scripts/verify-m2-live-scene.cjs', import.meta.url), 'utf8');
const launcher = await readFile(new URL('../scripts/verify-m2-live-scene.ps1', import.meta.url), 'utf8');
const workspace = path.resolve(import.meta.dirname, '..');
const root = path.join(workspace, 'out', 'live-acceptance', 'direct-gpu-fixture');
function startup(flags, candidate = root) {
  const calls = [];
  const fs = { realpathSync: (value) => value, existsSync: () => false,
    lstatSync: () => ({ isDirectory: () => true, isSymbolicLink: () => false }) };
  const app = { setPath: (...args) => calls.push(args), on() {}, commandLine: { appendSwitch() {} } };
  return { calls, run: () => vm.runInNewContext(helper.slice(0, helper.indexOf('const report =')),
    { __dirname: path.join(workspace, 'scripts'), process: { argv: ['electron', 'helper', candidate, workspace, ...flags] },
      require: (name) => name === 'electron' ? { app } : name === 'node:fs' ? fs : require(name) }) };
}

test('direct GPU mode is explicit and never aliases an existing transfer/probe mode', () => {
  assert.match(helper, /const directGpu = process\.argv\.slice\(4\)\.includes\('--direct-gpu'\)/);
  for (const flag of ['--probe-only', '--frame-transfer', '--encoded-transfer']) {
    const env = startup(['--direct-gpu', flag]);
    assert.throws(env.run, /mutually exclusive/); assert.equal(env.calls.length, 0);
  }
});
test('direct GPU experiment retains pre-profile containment checks', () => {
  const env = startup(['--direct-gpu'], workspace);
  assert.throws(env.run, /root|required/); assert.equal(env.calls.length, 0);
});
test('independent target selection allows native activation but never skips the real visible-document gate', () => {
  const selection = helper.slice(helper.indexOf('const metadata = []'), helper.indexOf('async function sceneProbe()'));
  assert.doesNotMatch(selection, /!state\.hidden/);
  assert.match(helper, /await connection\.call\('Page\.bringToFront'\);\s*await wait\('!document\.hidden', 10000\)/);
});
test('direct GPU source-only experiment reuses the workbench readonly server at native quality and 60 FPS', () => {
  assert.match(helper, /directGpu \? 'bridge-runtime\/src\/scene-server\.mjs'/);
  assert.match(helper, /frameRate: directGpu \? 60 : 30, nativeQuality: directGpu/);
  assert.match(helper, /artifact: directGpu \? 'source-only-direct-gpu-poc'/);
});
test('only identity-guarded direct mode enables CSP bypass and cleanup restores it before server teardown', () => {
  assert.match(helper, /if \(directGpu\) \{[\s\S]*?await guard\(\);[\s\S]*?cspBypassAttempted = true;[\s\S]*?Page\.setBypassCSP[\s\S]*?enabled: true/);
  const cleanup = helper.slice(helper.indexOf('}).finally(async () => {'));
  assert.match(cleanup, /if \(connection && cspBypassAttempted\)/);
  assert.ok(cleanup.indexOf('enabled: false') < cleanup.indexOf('await server.close()'));
  assert.match(cleanup, /report\.cspRestored = true/);
});
test('CSP restoration has a fresh local iframe rejection test, not just a command acknowledgement', () => {
  assert.match(helper, /cspRestorationProbe/);
  assert.match(helper, /effectiveDirective === 'frame-src'/);
  assert.match(helper, /report\.cspRestoreBlockedFreshFrame/);
});
test('CSP bypass and reset both take effect through a verified independent document reload', () => {
  assert.match(helper, /enabled: true \}\);\s*await reloadOwnedDocument\(\)/);
  const cleanup = helper.slice(helper.indexOf('}).finally(async () => {'));
  const disabled = cleanup.indexOf('enabled: false');
  assert.ok(disabled >= 0 && cleanup.indexOf('await reloadOwnedDocument(', disabled) > disabled);
  assert.match(helper, /async function reloadOwnedDocument\([^\n]*\) \{\s*await guard\(\)/);
  assert.match(helper, /__cwbDirectReloadSentinel/);
});
test('direct captures are cropped to the owned opaque 1280x720 scene, never surrounding chat', () => {
  assert.match(helper, /const captureWidth = directGpu \? 1280 : 800/);
  assert.match(helper, /const captureHeight = directGpu \? 720 : 450/);
  assert.match(helper, /clip\.width === captureWidth && clip\.height === captureHeight/);
});
test('direct benchmark counts real render completions and retains time spent capturing native screenshots', () => {
  assert.match(helper, /renderCompletions/);
  assert.match(helper, /rendererCompletedFps:/);
  assert.match(helper, /includesNativeScreenshots: true, physicalScreenFps: null/);
  assert.match(helper, /performanceSamples/);
});
test('direct diagnostics attach to the exact isolated scene before waiting for first frame', () => {
  const firstFrame = helper.slice(helper.indexOf("await step('real scene.pkg WebGL first frame"), helper.indexOf("await step('three cropped"));
  assert.ok(firstFrame.indexOf('await selectContext(scene)') < firstFrame.indexOf('await wait('));
  assert.match(firstFrame, /sceneCapabilities/);
  assert.match(helper, /details\.executionContextId === context\.id/);
  assert.match(helper, /report\.cspResetAcknowledged = true/);
});
test('launcher requires visible independent direct mode and keeps existing identity-bound teardown', () => {
  assert.match(launcher, /\[switch\]\$DirectGpu/);
  assert.match(launcher, /\$DirectGpu -and -not \$Visible/);
  assert.match(launcher, /\$DirectGpu\)\{\$arguments\+='--direct-gpu'\}/);
  assert.match(launcher, /directGpu=\[bool\]\$DirectGpu/);
  assert.match(launcher, /\$windowOwner\.CreationDate\.ToUniversalTime\(\)\.Ticks -ne \$hostMetadata\.CreationDate/);
  assert.match(launcher, /Stop-Process -InputObject \$native -Force/);
  assert.doesNotMatch(launcher + helper, /disable-web-security|disable-site-isolation|Get-Process -Name|EnumWindows/);
});

function reloadFixture(hidden, guardFails = false) {
  const source = helper.slice(helper.indexOf('async function reloadOwnedDocument('), helper.indexOf('\nasync function cspRestorationProbe()'));
  const calls = [], report = {}, window = {}, nonce = 'fixture-nonce'; let now = 0;
  const context = { window, location: { origin: 'app://-' }, document: { readyState: 'complete', hidden } };
  const fn = vm.runInNewContext(source + '\nreloadOwnedDocument', { report, nonce, JSON,
    Date: { now: () => now }, delay: async () => { now += 10000; },
    guard: async () => { if (guardFails) throw Error('identity_mismatch'); calls.push('guard'); },
    connection: { evaluate: async (expression) => vm.runInNewContext(expression, context),
      call: async (method) => { calls.push(method); delete window.__cwbDirectReloadSentinel; } } });
  return { fn, calls, report };
}
test('CSP cleanup reload verifies a fresh document even when the independent window becomes hidden', async () => {
  const env = reloadFixture(true); await env.fn({ requireVisible: false });
  assert.deepEqual(env.calls, ['guard', 'Page.reload']);
  assert.equal(env.report.ownedDocumentReloads, 1);
});
test('CSP enable reload still rejects a hidden independent document for the visible FPS test', async () => {
  const env = reloadFixture(true); await assert.rejects(env.fn(), /reload timeout/);
  assert.equal(env.report.ownedDocumentReloads, undefined);
});
test('failed exact identity guard forbids even a cleanup reload', async () => {
  const env = reloadFixture(false, true); await assert.rejects(env.fn({ requireVisible: false }), /identity_mismatch/);
  assert.deepEqual(env.calls, []);
});
