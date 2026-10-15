import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test('WinRT thumbnail cleanup uses explicit IDisposable and isolates each resource failure', { skip: process.platform !== 'win32' }, async () => {
  const source = await readFile(new URL('../bridge-runtime/native/windows-media.ps1', import.meta.url), 'utf8');
  const cleanup = source.split(/\r?\n/).find(line => line.startsWith('function CloseResource('));
  assert.ok(cleanup, 'a thumbnail cleanup failure must not clear the current media session');
  assert.match(cleanup, /IsComObject\(\$value\).*FinalReleaseComObject\(\$value\)/);
  assert.doesNotMatch(source, /GetInputStreamAt/);
  assert.match(source, /ReadRandomAccessStream\(\$stream,2097152\)/);
  assert.match(source, /\$thumbnailAttempts -lt 10/);
  assert.match(source, /if \(\$newTrack\).*mediaThumbnail.*thumbnail=''/);
  assert.match(source, /finally\s*\{\s*CloseResource \$stream\s*\}/);
  const script = `
    $ErrorActionPreference='Stop'
    Add-Type -TypeDefinition 'using System; public sealed class M3CloseProbe : IDisposable { public int Calls; public bool Fail; public M3CloseProbe(bool fail) { Fail=fail; } void IDisposable.Dispose() { Calls++; if(Fail) throw new Exception("probe"); } }'
    ${cleanup}
    $a=New-Object M3CloseProbe $true; $b=New-Object M3CloseProbe $false
    CloseResource $null; CloseResource $a; CloseResource $b
    if($a.Calls -ne 1 -or $b.Calls -ne 1){throw 'cleanup_failed'}
    [Console]::WriteLine('cleanup_ok')
  `;
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script],
    { windowsHide: true, timeout: 10000, maxBuffer: 32768 });
  assert.equal(stdout.trim(), 'cleanup_ok');
});
