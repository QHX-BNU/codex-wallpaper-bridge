// Run the hidden, app-owned fixture and verify its report, not just Electron's exit code.
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const require = createRequire(import.meta.url);
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(repo, 'out');
const root = process.argv[2] ? path.resolve(process.argv[2]) : path.join(out, `first-media-${randomUUID()}`);
const relative = path.relative(out, root);
if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw Error('Fixture output must stay inside out');
await mkdir(path.dirname(root), { recursive: true });
await mkdir(root); // Never reuse a previous proof or overwrite failure evidence.
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(require('electron'), [path.join(repo, 'scripts/verify-first-media.cjs'), root,
  ...(process.argv[3] ? [path.resolve(process.argv[3])] : [])], { cwd: repo, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
let log = '', timedOut = false;
for (const stream of [child.stdout, child.stderr]) stream.on('data', bytes => { log = (log + bytes).slice(-2 * 1024 * 1024); });
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 90000);
let code;
try { code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); }); }
finally { clearTimeout(timer); await writeFile(path.join(root, 'process.log'), log); }
const proof = JSON.parse(await readFile(path.join(root, 'proof.json'), 'utf8'));
let profileRemoved = false;
// Resolve both paths before deleting the one private fixture profile. A junction
// outside this output directory must never turn cleanup into an external delete.
const actualRoot = await realpath(root), profile = await realpath(path.join(root, 'profile'));
if (path.dirname(profile) !== actualRoot || path.basename(profile) !== 'profile') throw Error('Fixture profile escaped its owned output');
await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
profileRemoved = true;
const ok = code === 0 && !timedOut && proof.ok === true && proof.modes.length === 3;
await writeFile(path.join(root, 'runner.json'), JSON.stringify({ ok, code, timedOut, profileRemoved }, null, 2));
console.log(JSON.stringify({ ok, modes: proof.modes.length, profileRemoved, root, error: proof.error }));
process.exitCode = ok ? 0 : 1;
