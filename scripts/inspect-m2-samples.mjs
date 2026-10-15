import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { inspectSceneProject } from '../bridge-runtime/src/scene-inspector.mjs';

const [root, destination] = process.argv.slice(2);
if (!root || !destination) throw new Error('Usage: node inspect-m2-samples.mjs <readonly-library-root> <fresh-report.json>');
const report = { at: new Date().toISOString(), scope: 'readonly-declared-feature-inventory', renderVerified: false, samples: [] };
for (const item of await readdir(root, { withFileTypes: true })) {
  if (!item.isDirectory()) continue;
  let manifest;
  try { manifest = JSON.parse((await readFile(path.join(root, item.name, 'project.json'), 'utf8')).replace(/^\uFEFF/, '')); }
  catch { continue; }
  const type = String(manifest.type).toLowerCase();
  if (type === 'scene') report.samples.push({ id: item.name, type, ...await inspectSceneProject(path.join(root, item.name)) });
  else if (type === 'web') report.samples.push({ id: item.name, type, renderVerified: false,
    properties: Object.keys(manifest.general?.properties ?? {}).length });
}
await writeFile(destination, JSON.stringify(report, null, 2), { flag: 'wx' });
console.log(JSON.stringify({ samples: report.samples.length, scenes: report.samples.filter((s) => s.type === 'scene').length,
  web: report.samples.filter((s) => s.type === 'web').length, failed: report.samples.filter((s) => s.status === 'failed').length }));
