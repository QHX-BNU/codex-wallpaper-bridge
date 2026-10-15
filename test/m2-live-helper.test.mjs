import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import vm from 'node:vm';
import test from 'node:test';

const require = createRequire(import.meta.url);
const script = await readFile(new URL('../scripts/verify-m2-live-scene.cjs', import.meta.url), 'utf8');
const startup = script.slice(0, script.indexOf('const report ='));
const workspace = path.resolve(import.meta.dirname, '..');
const allowed = path.join(workspace, 'out', 'live-acceptance');
const root = path.join(allowed, 'm2-safe-fixture');

function fixture({ candidate = root, redirected, symbolic, existingProfile = false, flags = ['--probe-only'] } = {}) {
  const appCalls = [];
  const app = { setPath: (...args) => appCalls.push(args), on() {}, commandLine: { appendSwitch() {} } };
  const fs = { realpathSync: (value) => value === redirected ? path.join(path.parse(workspace).root, 'outside-acceptance') : value,
    existsSync: () => existingProfile,
    lstatSync: (value) => ({ isDirectory: () => true, isSymbolicLink: () => value === symbolic }) };
  const run = () => vm.runInNewContext(startup, { __dirname: path.join(workspace, 'scripts'),
    process: { argv: ['electron', 'helper', candidate, workspace, ...flags] },
    require: (name) => name === 'electron' ? { app } : name === 'node:fs' ? fs : require(name) });
  return { run, appCalls };
}

test('live helper accepts an ordinary independent root before configuring Electron state', () => {
  const env = fixture(); env.run();
  assert.deepEqual(env.appCalls, [['userData', path.join(root, 'probe-profile')]]);
});

test('live helper rejects lexical daily/outside root before Electron can write state', () => {
  const env = fixture({ candidate: workspace });
  assert.throws(env.run, /root|required/);
  assert.deepEqual(env.appCalls, []);
});

test('live helper rejects a root junction escape before Electron can write state', () => {
  const env = fixture({ redirected: root, symbolic: root });
  assert.throws(env.run);
  assert.deepEqual(env.appCalls, []);
});

test('live helper rejects an acceptance ancestor redirected outside the workspace', () => {
  const env = fixture({ redirected: allowed });
  assert.throws(env.run);
  assert.deepEqual(env.appCalls, []);
});

test('live helper rejects a pre-existing helper-profile junction before Electron startup', () => {
  const env = fixture({ existingProfile: true, symbolic: path.join(root, 'probe-profile') });
  assert.throws(env.run);
  assert.deepEqual(env.appCalls, []);
});

test('pixel-transfer mode retains the same pre-profile directory guard', () => {
  const env = fixture({ flags: ['--frame-transfer'], redirected: root });
  assert.throws(env.run); assert.deepEqual(env.appCalls, []);
});

test('mutually exclusive probe modes reject before Electron writes a profile', () => {
  const env = fixture({ flags: ['--frame-transfer', '--probe-only'] });
  assert.throws(env.run, /mutually exclusive/); assert.deepEqual(env.appCalls, []);
});

test('encoded-transfer mode keeps the directory guard and rejects all mixed probe flags before startup', () => {
  const redirected = fixture({ flags: ['--encoded-transfer'], redirected: root });
  assert.throws(redirected.run); assert.deepEqual(redirected.appCalls, []);
  for (const flags of [['--encoded-transfer', '--frame-transfer'], ['--encoded-transfer', '--probe-only']]) {
    const env = fixture({ flags }); assert.throws(env.run, /mutually exclusive/); assert.deepEqual(env.appCalls, []);
  }
  const safe = fixture({ flags: ['--encoded-transfer'] }); safe.run(); assert.equal(safe.appCalls.length, 1);
});

test('isolated GPU capture compares decoded saved PNG bytes, not a lazy GPU bitmap', async () => {
  const helper = await readFile(new URL('../scripts/verify-m2-scene-ui.cjs', import.meta.url), 'utf8');
  const source = helper.slice(helper.indexOf('async function capture(name) {'), helper.indexOf('\nfunction difference(a, b) {'));
  const png = Buffer.from('fixture-png-bytes');
  const colored = Buffer.from([40, 80, 120, 255]);
  const saved = [];
  const pixels = await vm.runInNewContext(source + '\ncapture("frame-b")', { path, root, report: {},
    assert, bounded: async (promise) => promise,
    win: { webContents: { capturePage: async () => ({ toPNG: () => png, toBitmap: () => Buffer.alloc(4) }) } },
    nativeImage: { createFromBuffer: (bytes) => { assert.strictEqual(bytes, png); return { isEmpty: () => false, toBitmap: () => colored }; } },
    fs: { writeFile: async (name, bytes) => saved.push({ name, bytes }) } });
  assert.strictEqual(saved[0].bytes, png);
  assert.deepEqual(pixels, colored);
});

test('production visible helper uses identity-bound native window restore, not unsupported Browser window commands', async () => {
  const helper = await readFile(new URL('../scripts/verify-m2-production.cjs', import.meta.url), 'utf8');
  const launcher = await readFile(new URL('../scripts/verify-m2-live-scene.ps1', import.meta.url), 'utf8');
  const restore = await readFile(new URL('../scripts/restore-m2-owned-window.ps1', import.meta.url), 'utf8');
  assert.doesNotMatch(helper, /Browser\.(?:getWindowForTarget|setWindowBounds)/);
  assert.match(launcher, /if\s*\(\$Visible\)/);
  assert.match(restore, /GetWindowThreadProcessId/);
  assert.match(restore, /GetFullPath\(\(Join-Path \$PSScriptRoot '\.\.'\)\)\.TrimEnd/);
  assert.match(restore, /\$cursor -is \[IO\.DirectoryInfo\]/);
  assert.match(restore, /\$windowPid -ne \$hostProcess\.Id/);
  assert.match(restore, /\$windowOwner\.ExecutablePath -ne \$exePath/);
  assert.match(restore, /\$windowOwner\.CreationDate\.ToUniversalTime\(\)\.Ticks -ne \$expectedTicks/);
  assert.match(restore, /ShowWindowAsync\(\$windowHandle,9\)/);
  assert.match(helper, /await focusOwned\(\)/);
  assert.match(launcher, /window-control\.json/);
  assert.doesNotMatch(launcher + restore, /EnumWindows|FindWindow|Get-Process -Name/);
  assert.doesNotMatch(helper, /defineProperty\([^\n]*hidden|pauseWhenHidden:\s*false/);
});
