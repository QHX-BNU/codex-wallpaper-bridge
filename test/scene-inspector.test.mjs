import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectSceneProject } from '../bridge-runtime/src/scene-inspector.mjs';

function packageBytes(files) {
  const magic = Buffer.from('PKGV0001');
  const header = Buffer.alloc(4 + magic.length + 4);
  header.writeUInt32LE(magic.length); magic.copy(header, 4); header.writeUInt32LE(files.length, 4 + magic.length);
  let offset = 0;
  const table = [], data = [];
  for (const [name, value] of files) {
    const bytes = Buffer.from(value), text = Buffer.from(name), entry = Buffer.alloc(4 + text.length + 8);
    entry.writeUInt32LE(text.length); text.copy(entry, 4); entry.writeUInt32LE(offset, 4 + text.length);
    entry.writeUInt32LE(bytes.length, 8 + text.length); offset += bytes.length; table.push(entry); data.push(bytes);
  }
  return Buffer.concat([header, ...table, ...data]);
}
async function fixture(t, files) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-inspect-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'project.json'), JSON.stringify({ type: 'Scene', general: { properties: { music: { type: 'bool', value: true } } } }));
  await writeFile(path.join(root, 'scene.pkg'), packageBytes(files));
  return root;
}

test('readonly package inspection distinguishes declared features, not support claims', async (t) => {
  const root = await fixture(t, [
    ['scene.json', JSON.stringify({ general: { cameraparallax: true }, objects: [
      { particle: 'particles/a.json' }, { sound: ['sounds/a.ogg'] },
      { origin: { script: 'export function cursorClick() {} export function update() {}' } },
    ] })],
    ['models/a.json', '{"puppet":"models/a.mdl"}'], ['models/a.mdl', 'model'],
    ['sounds/a.ogg', 'audio'], ['materials/video.mp4', 'video'],
  ]);
  const before = await readFile(path.join(root, 'scene.pkg'));
  const result = await inspectSceneProject(root);
  assert.equal(result.status, 'inspected');
  assert.equal(result.features.particles, 1); assert.equal(result.features.puppets, 1);
  assert.equal(result.features.scripts, 1); assert.equal(result.features.cursorScripts, 1);
  assert.equal(result.features.audioFiles, 1); assert.equal(result.features.videos, 1);
  assert.equal(result.features.parallax, true); assert.equal(result.properties, 1);
  assert.equal(result.renderVerified, false); assert.equal(result.package.sha256.length, 64);
  assert.deepEqual(await readFile(path.join(root, 'scene.pkg')), before);
  assert.doesNotMatch(JSON.stringify(result), /export function|cwb-inspect-|sounds\/a/);
});

for (const [name, files] of [
  ['traversal', [['../scene.json', '{}']]],
  ['duplicates', [['scene.json', '{}'], ['scene.json', '{}']]],
  ['case duplicates', [['scene.json', '{}'], ['SCENE.JSON', '{}']]],
  ['ADS', [['scene.json:stream', '{}']]],
  ['missing scene', [['models/a.json', '{}']]],
  ['malformed JSON', [['scene.json', '{bad']]],
]) test(`inspection fails closed for ${name}`, async (t) => {
  const result = await inspectSceneProject(await fixture(t, files));
  assert.equal(result.status, 'failed'); assert.match(result.reason, /^scene_/);
  assert.doesNotMatch(JSON.stringify(result), /cwb-inspect-|SyntaxError|[A-Z]:\\/);
});

test('entry extents and table counts are validated before seeking asset bytes', async (t) => {
  const root = await fixture(t, [['scene.json', '{}']]);
  const file = path.join(root, 'scene.pkg'), b = await readFile(file);
  b.writeUInt32LE(0xffffffff, 4 + 8 + 4 + 4 + 'scene.json'.length);
  await writeFile(file, b); assert.equal((await inspectSceneProject(root)).status, 'failed');
  b.writeUInt32LE(0xffffffff, 12); await writeFile(file, b);
  assert.equal((await inspectSceneProject(root)).status, 'failed');
});

test('external package symlink cannot be inspected as an in-root asset', async (t) => {
  const root = await fixture(t, [['scene.json', '{}']]);
  const child = path.join(root, 'child'); await mkdir(child);
  await writeFile(path.join(child, 'project.json'), '{"type":"scene"}');
  await symlink(root, path.join(child, 'scene.pkg'), process.platform === 'win32' ? 'junction' : 'dir');
  await writeFile(path.join(child, 'scene.json'), '{}');
  const result = await inspectSceneProject(child);
  assert.equal(result.status, 'failed'); assert.equal(result.reason, 'scene_path');
});

test('raw scene.json is inspected and never evaluated; non-scene manifest denied', async (t) => {
  const root = await fixture(t, [['scene.json', '{}']]);
  await writeFile(path.join(root, 'project.json'), '{"type":"web"}');
  assert.equal((await inspectSceneProject(root)).reason, 'scene_manifest');
});
