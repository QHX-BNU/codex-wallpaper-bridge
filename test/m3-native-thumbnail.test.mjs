import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { compileWindowsMedia } from '../scripts/compile-windows-media.mjs';

test('compiled helper reads a real WinRT random access stream without dynamic COM members', { skip: process.platform !== 'win32' }, async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'cwb-m3-thumbnail-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const native = path.join(root, 'native'); await mkdir(native);
  await compileWindowsMedia({ nativeRoot: path.resolve('bridge-runtime/native'), outputRoot: native });
  const bytes = Buffer.from('CWB M3 bounded WinRT stream fixture');
  const fixture = path.join(root, 'fixture.bin'); await writeFile(fixture, bytes);
  const source = await readFile(new URL('../bridge-runtime/native/windows-media.ps1', import.meta.url), 'utf8');
  const thumbnailRead = source.match(/if \(\$properties\.Thumbnail\) \{[\s\S]*?\n              \}/)?.[0];
  assert.ok(thumbnailRead, 'exercise the production PowerShell thumbnail read, not only its C# helper');
  const script = path.join(root, 'probe.ps1');
  await writeFile(script, `
    param([string]$Assembly,[string]$Fixture)
    $ErrorActionPreference='Stop'
    Add-Type -AssemblyName System.Runtime.WindowsRuntime
    $storage=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
    $streamType=[Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
    function Await($op,$type){$m=[System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object{$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1}|Select-Object -First 1;$t=$m.MakeGenericMethod($type).Invoke($null,@($op));if(!$t.Wait(1200)){throw 'timeout'};return $t.Result}
    Add-Type -Path $Assembly
    $file=Await ($storage::GetFileFromPathAsync($Fixture)) $storage
    $reference=[Windows.Storage.Streams.RandomAccessStreamReference,Windows.Storage.Streams,ContentType=WindowsRuntime]::CreateFromFile($file)
    $stream=Await ($reference.OpenReadAsync()) $streamType
    try {[Convert]::ToBase64String([CwbMedia.Host]::ReadRandomAccessStream($stream,2097152))}
    finally {if([Runtime.InteropServices.Marshal]::IsComObject($stream)){$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)}}
    $limited=Await ($reference.OpenReadAsync()) $streamType
    try {if([CwbMedia.Host]::ReadRandomAccessStream($limited,8).Length -ne 0){throw 'oversize_stream_not_rejected'}}
    finally {if([Runtime.InteropServices.Marshal]::IsComObject($limited)){$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($limited)}}
    Add-Type -AssemblyName System.Drawing
    $imagePath=$Fixture+'.png';$image=New-Object Drawing.Bitmap 16,16
    try {$image.Save($imagePath,[Drawing.Imaging.ImageFormat]::Png)} finally {$image.Dispose()}
    $cover=Await ($storage::GetFileFromPathAsync($imagePath)) $storage
    $properties=[pscustomobject]@{Thumbnail=[Windows.Storage.Streams.RandomAccessStreamReference,Windows.Storage.Streams,ContentType=WindowsRuntime]::CreateFromFile($cover)}
    $thumbnail='';$stream=$null
    try {${thumbnailRead}} finally {if($stream -and [Runtime.InteropServices.Marshal]::IsComObject($stream)){$null=[Runtime.InteropServices.Marshal]::FinalReleaseComObject($stream)}}
    [Console]::WriteLine('thumbnail='+$thumbnail.Length)
  `);
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-File', script,
    '-Assembly', path.join(native, 'windows-media.dll'), '-Fixture', fixture], { windowsHide: true, timeout: 15000, maxBuffer: 32768 });
  const lines = stdout.trim().split(/\r?\n/);
  assert.deepEqual(Buffer.from(lines[0], 'base64'), bytes);
  assert.ok(Number(lines[1]?.split('=')[1]) > 0, 'the production PS path must decode real WinRT artwork');
  assert.equal((await readFile(fixture)).equals(bytes), true);
});
