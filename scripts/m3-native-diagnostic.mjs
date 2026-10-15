import { spawn } from 'node:child_process';
import { readFile, writeFile, mkdir, copyFile, rename } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [prior] = process.argv.slice(2); if (!prior) throw Error('prior_run_required');
const root = path.join(prior, 'native-diagnostic'); await mkdir(root);
const original = await readFile(path.join(prior, 'compiled-snapshot/runtime/native/windows-media.ps1'), 'utf8');
const marker = "catch { $session=$null; $sessionId=''; $sourceId=''; $trackId='';";
if (!original.includes(marker)) throw Error('diagnostic_source_changed');
const source = original
  .replace("$bytes=[CwbMedia.Host]::ReadRandomAccessStream($stream,2097152)", "$bytes=[CwbMedia.Host]::ReadRandomAccessStream($stream,2097152); Emit @{type='probeBytes';count=$bytes.Length;streamSize=[uint64]$stream.Size}")
  .replace(marker, "catch { Emit @{type='probeError';exceptionType=$_.Exception.GetBaseException().GetType().Name;line=$_.InvocationInfo.ScriptLineNumber}; $session=$null; $sessionId=''; $sourceId=''; $trackId='';");
await writeFile(path.join(root, 'windows-media.ps1'), source);
await copyFile(path.join(prior, 'compiled-snapshot/runtime/native/windows-media.dll'), path.join(root, 'windows-media.dll'));
const { WindowsMediaProvider } = await import(pathToFileURL(path.join(prior, 'compiled-snapshot/runtime/src/m3.mjs')));
const trace = [], label = 'B', nonce = '35847080-5ad8-4bdb-813c-f05eadba6d87';
const fixture = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', 'scripts/m3-acceptance-native-player.ps1', '-Root', prior, '-Nonce', nonce, '-Label', label], { windowsHide: true, stdio: ['ignore', 'ignore', 'ignore'] });
const exited = new Promise(r => fixture.once('exit', (code, signal) => r({ code, signal })));
const provider = new WindowsMediaProvider({ spawnChild: (exe, args, opts) => {
  const mapped = [...args]; mapped[mapped.indexOf('-File') + 1] = path.join(root, 'windows-media.ps1'); const child = spawn(exe, mapped, opts); let buffer = '';
  child.stdout.on('data', bytes => { buffer += bytes.toString(); let i; while ((i = buffer.indexOf('\n')) >= 0) { const line = buffer.slice(0, i); buffer = buffer.slice(i + 1); try { const v = JSON.parse(line); if (v.type === 'probeError') trace.push({ type: v.type, exceptionType: v.exceptionType, line: v.line }); if (v.type === 'probeBytes') trace.push({ type: v.type, count: v.count, streamSize: v.streamSize }); } catch {} } }); return child;
} });
provider.onEvent(e => { if (e.type === 'status') trace.push({ type: 'status', source: e.source, state: e.state }); if (e.type === 'input' && e.input.op === 'media') trace.push({ type: 'media', own: e.input.value.title.startsWith('CWB-M3-' + nonce), state: e.input.value.state }); if (e.type === 'input' && e.input.op === 'mediaThumbnail') trace.push({ type: 'thumbnail', bytes: e.input.value.thumbnail.length }); });
try { await provider.configure({ media: true }); await new Promise(r => setTimeout(r, 6500)); }
finally { await provider.close(); const command = path.join(prior, `player-${label}-command.json`); await writeFile(command + '.tmp', JSON.stringify({ request: 99999, op: 'quit' })); await rename(command + '.tmp', command); const exit = await Promise.race([exited, new Promise(r => setTimeout(() => r(null), 6000))]); if (!exit) fixture.kill(); await writeFile(path.join(root, 'trace.json'), JSON.stringify({ trace, fixtureExit: exit, provider: provider.status() }, null, 2)); console.log(JSON.stringify({ trace, fixtureExit: exit, provider: provider.status() })); }
