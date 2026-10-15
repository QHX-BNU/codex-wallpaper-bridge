import { spawn } from 'node:child_process';
import { mkdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export async function compileWindowsMedia({ nativeRoot, outputRoot, platform = process.platform }) {
  if (platform !== 'win32') throw Error('windows_media_compile_requires_windows');
  await mkdir(outputRoot, { recursive: true });
  await copyFile(path.join(nativeRoot, 'windows-media.ps1'), path.join(outputRoot, 'windows-media.ps1'));
  const script = fileURLToPath(new URL('./compile-windows-media.ps1', import.meta.url));
  const executable = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  await new Promise((resolve, reject) => {
    const child = spawn(executable, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script,
      '-Source', path.resolve(nativeRoot, 'windows-media.cs'), '-OutputAssembly', path.resolve(outputRoot, 'windows-media.dll')],
    { windowsHide: true, shell: false, stdio: 'ignore' });
    const timer = setTimeout(() => { child.kill(); reject(Error('windows_media_compile_timeout')); }, 30000);
    child.once('error', () => { clearTimeout(timer); reject(Error('windows_media_compile_unavailable')); });
    child.once('exit', code => { clearTimeout(timer); code === 0 ? resolve() : reject(Error('windows_media_compile_failed')); });
  });
}
