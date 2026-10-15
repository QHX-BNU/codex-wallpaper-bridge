import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

const exec = promisify(execFile);

/** Read only the verified roots and their current descendants. No command lines,
 * user data, URLs or authentication text are returned. Missing WDDM counters
 * remain null, never a fabricated zero-GPU/zero-VRAM result.
 */
export async function readOwnedGpuResources(roots) {
  if (!Array.isArray(roots) || !roots.length || roots.length > 4 || roots.some(root =>
    !Number.isSafeInteger(root.pid) || root.pid <= 0 || typeof root.exe !== 'string' || !path.isAbsolute(root.exe)
    || !/^\d{4}-\d\d-\d\dT[0-9:.]+Z$/.test(root.creation))) throw Error('resource_identity_invalid');
  const expected = JSON.stringify(roots.map(({ pid, exe, creation }) => ({ pid, exe, creation }))).replaceAll("'", "''");
  const script = `$ErrorActionPreference='Stop';$expected=ConvertFrom-Json '${expected}';$all=@(Get-CimInstance Win32_Process);$ids=New-Object 'System.Collections.Generic.HashSet[int]';
foreach($e in $expected){$p=$all|Where-Object ProcessId -eq $e.pid;if(-not $p -or $p.ExecutablePath -ne $e.exe -or $p.CreationDate.ToUniversalTime().ToString('o') -ne $e.creation){throw 'resource_identity_changed'};[void]$ids.Add([int]$e.pid)};
for($i=0;$i -lt 32;$i++){$before=$ids.Count;foreach($p in $all){if($ids.Contains([int]$p.ParentProcessId)){[void]$ids.Add([int]$p.ProcessId)}};if($ids.Count -gt 128){throw 'resource_tree_capacity'};if($ids.Count -eq $before){break}};
$memory=$null;$engines=$null;try{$memory=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUProcessMemory)}catch{};try{$engines=@(Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUEngine)}catch{};
$rows=@(foreach($p in $all){if(-not $ids.Contains([int]$p.ProcessId)){continue};try{$n=Get-Process -Id $p.ProcessId -ErrorAction Stop;$ticks=$n.StartTime.ToUniversalTime().Ticks;if(($ticks-($ticks%10)) -ne $p.CreationDate.ToUniversalTime().Ticks){continue};$pidText='^pid_'+$p.ProcessId+'_';$m=@($memory|Where-Object {$_.Name -match $pidText});$g=@($engines|Where-Object {$_.Name -match $pidText});[pscustomobject]@{pid=$p.ProcessId;exe=$p.ExecutablePath;creation=$p.CreationDate.ToUniversalTime().ToString('o');cpuMs=$n.TotalProcessorTime.TotalMilliseconds;rss=$n.WorkingSet64;privateBytes=$n.PrivateMemorySize64;dedicatedBytes=if($null -eq $memory){$null}else{($m|Measure-Object DedicatedUsage -Sum).Sum};sharedBytes=if($null -eq $memory){$null}else{($m|Measure-Object SharedUsage -Sum).Sum};gpuEnginePercentSum=if($null -eq $engines){$null}else{($g|Measure-Object UtilizationPercentage -Sum).Sum};gpuMemoryInstances=$m.Count;gpuEngineInstances=$g.Count}}catch{}});
foreach($e in $expected){if(-not @($rows|Where-Object {$_.pid -eq $e.pid -and $_.exe -eq $e.exe -and $_.creation -eq $e.creation})){throw 'resource_identity_changed'}};
[pscustomobject]@{at=[DateTime]::UtcNow.ToString('o');logicalProcessors=[Environment]::ProcessorCount;gpuMemoryAvailable=($null -ne $memory);gpuEngineAvailable=($null -ne $engines);processes=$rows}|ConvertTo-Json -Depth 5 -Compress`;
  const result = await exec(path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
    ['-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, timeout: 20000, maxBuffer: 128 * 1024 });
  const value = JSON.parse(result.stdout.replace(/^\uFEFF/, '').trim());
  if (!Array.isArray(value.processes) || !Number.isInteger(value.logicalProcessors) || value.logicalProcessors < 1) throw Error('resource_snapshot_invalid');
  return value;
}

export function gpuResourceDelta(before, after) {
  const elapsedMs = Date.parse(after.at) - Date.parse(before.at);
  if (!(elapsedMs > 0)) throw Error('resource_clock_invalid');
  const previous = new Map(before.processes.map(row => [row.pid, row]));
  const stable = after.processes.filter(row => previous.get(row.pid)?.creation === row.creation && previous.get(row.pid)?.exe === row.exe);
  const sum = (key, available) => available ? after.processes.reduce((total, row) => total + Math.max(0, Number(row[key]) || 0), 0) : null;
  const memoryAvailable = after.gpuMemoryAvailable === true && after.processes.some(row => row.gpuMemoryInstances > 0);
  const engineAvailable = after.gpuEngineAvailable === true && after.processes.some(row => row.gpuEngineInstances > 0);
  return { elapsedMs, processCount: after.processes.length, stableProcessCount: stable.length,
    cpuMachinePercent: Math.round(stable.reduce((total, row) => total + Math.max(0, row.cpuMs - previous.get(row.pid).cpuMs), 0) / elapsedMs / after.logicalProcessors * 10000) / 100,
    rss: sum('rss', true), privateBytes: sum('privateBytes', true),
    dedicatedBytes: sum('dedicatedBytes', memoryAvailable), sharedBytes: sum('sharedBytes', memoryAvailable),
    gpuEnginePercentSum: sum('gpuEnginePercentSum', engineAvailable),
    gpuCountersAvailable: memoryAvailable && engineAvailable,
    // Summed WDDM engine utilization is not physical display FPS or one-GPU utilization.
    physicalScreenFps: null };
}
