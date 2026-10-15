param(
  [Parameter(Mandatory=$true)][ValidateSet('local','store')][string]$Kind,
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$HostPort,
  [Parameter(Mandatory=$true)][string]$ProjectRoot,
  [switch]$ProbeOnly,
  [switch]$FrameTransfer,
  [switch]$EncodedTransfer,
  [switch]$ProductionSwitch,
  [switch]$SwitchOnly,
  [switch]$DirectGpu,
  [switch]$Visible
)
$ErrorActionPreference='Stop'
if($SwitchOnly -and -not $ProductionSwitch){throw 'SwitchOnly requires ProductionSwitch'}
if(@($ProbeOnly,$FrameTransfer,$EncodedTransfer,$ProductionSwitch,$DirectGpu | Where-Object {$_}).Count -gt 1){throw 'M2 probe modes are mutually exclusive'}
if($DirectGpu -and -not $Visible){throw 'Direct GPU experiment requires a visible independent host'}
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if(-not $ProductionSwitch){
  & node -e "require(process.argv[1]).assertM2TestRoot(process.argv[2])" (Join-Path $PSScriptRoot 'm2-test-policy.cjs') $ProjectRoot
  if($LASTEXITCODE -ne 0){throw 'M2 sample preflight rejected the test wallpaper'}
}
$allowed=Join-Path $workspace 'out\live-acceptance'
foreach($ancestor in @((Join-Path $workspace 'out'),$allowed)){
  $item=Get-Item -LiteralPath $ancestor
  if(-not $item.PSIsContainer -or ($item.Attributes -band [IO.FileAttributes]::ReparsePoint)){throw 'Acceptance ancestors must be ordinary workspace directories'}
}
$exePath=(Get-Item -LiteralPath $Exe).FullName
if ([IO.Path]::GetExtension($exePath) -ne '.exe') { throw 'Existing EXE required' }
if (@(Get-NetTCPConnection -State Listen -LocalPort $HostPort -ErrorAction SilentlyContinue).Count) { throw 'Test port must be free' }
$root=Join-Path $allowed ('m2-'+$Kind+'-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
if (-not $root.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Outside acceptance workspace' }
if (Test-Path -LiteralPath $root) { throw 'Evidence root must be fresh' }
$profile=Join-Path $root 'host-profile'
New-Item -ItemType Directory -Path $profile | Out-Null
$protected=@(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type=' })
$protectedMetadata=@($protected | ForEach-Object { [ordered]@{pid=$_.ProcessId;creation=$_.CreationDate.ToUniversalTime().ToString('o');exe=$_.ExecutablePath} })
ConvertTo-Json -InputObject $protectedMetadata -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'protected-chat.json') -Encoding utf8
$knownRoots=@()
$result=1
try {
  $hostWindowStyle=if($Visible){'Normal'}else{'Hidden'}
  $hostProcess=Start-Process -FilePath $exePath -ArgumentList @('--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$HostPort","--user-data-dir=`"$profile`"") -WindowStyle $hostWindowStyle -PassThru
  $hostMetadata=Get-CimInstance Win32_Process -Filter ('ProcessId='+$hostProcess.Id)
  if (-not $hostMetadata -or $hostMetadata.ExecutablePath -ne $exePath) { throw 'Created host identity unavailable' }
  $knownRoots+=$hostMetadata
  $deadline=(Get-Date).AddSeconds(60)
  do { Start-Sleep -Milliseconds 300; $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $HostPort -ErrorAction SilentlyContinue) } while (-not $listeners.Count -and (Get-Date) -lt $deadline)
  $owners=@($listeners.OwningProcess | Select-Object -Unique)
  if ($owners.Count -ne 1 -or $owners[0] -ne $hostProcess.Id -or $owners[0] -in $protected.ProcessId -or @($listeners | Where-Object LocalAddress -NotIn '127.0.0.1','::1').Count) { throw 'Unexpected host listener owner' }
  $owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owners[0])
  $profilePattern='(?:^|\s)--user-data-dir=(?:"'+[regex]::Escape($profile)+'"|'+[regex]::Escape($profile)+')(?:\s|$)'
  if ($owner.ExecutablePath -ne $exePath -or $owner.CreationDate.ToUniversalTime().Ticks -ne $hostMetadata.CreationDate.ToUniversalTime().Ticks -or $owner.CommandLine -notmatch $profilePattern) { throw 'Host identity mismatch' }
  $target=[ordered]@{port=$HostPort;pid=$owner.ProcessId;creation=$owner.CreationDate.ToUniversalTime().ToString('o');exe=$exePath;profile=$profile}
  $target | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'target.json') -Encoding utf8
  if($Visible){
    # Electron's page CDP endpoint does not implement Browser window bounds.
    # Only restore/position the HWND belonging to this newly verified host PID.
    Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CwbOwnedWindow {
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hWnd, int command);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr hWnd, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hWnd);
}
'@
    $windowDeadline=(Get-Date).AddSeconds(10)
    do {
      $hostProcess.Refresh()
      $windowHandle=$hostProcess.MainWindowHandle
      if($windowHandle -ne [IntPtr]::Zero){break}
      Start-Sleep -Milliseconds 200
    } while((Get-Date) -lt $windowDeadline)
    if($windowHandle -eq [IntPtr]::Zero){throw 'Independent host window unavailable'}
    $windowOwner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$hostProcess.Id)
    if(-not $windowOwner -or $windowOwner.ExecutablePath -ne $exePath -or $windowOwner.CreationDate.ToUniversalTime().Ticks -ne $hostMetadata.CreationDate.ToUniversalTime().Ticks){throw 'Window process identity mismatch'}
    $nativeTicks=$hostProcess.StartTime.ToUniversalTime().Ticks
    if(($nativeTicks-($nativeTicks%10)) -ne $hostMetadata.CreationDate.ToUniversalTime().Ticks){throw 'Window process handle identity mismatch'}
    [uint32]$windowPid=0
    [void][CwbOwnedWindow]::GetWindowThreadProcessId($windowHandle,[ref]$windowPid)
    if($windowPid -ne $hostProcess.Id -or $windowPid -in $protected.ProcessId){throw 'Window owner mismatch'}
    [void][CwbOwnedWindow]::ShowWindowAsync($windowHandle,9)
    $windowWidth=if($DirectGpu){1400}else{1050}
    $windowHeight=if($DirectGpu){900}else{720}
    if(-not [CwbOwnedWindow]::SetWindowPos($windowHandle,[IntPtr]::new(-1),40,60,$windowWidth,$windowHeight,0x0040)){throw 'Independent window positioning failed'}
    $foregroundRequested=[CwbOwnedWindow]::SetForegroundWindow($windowHandle)
    Start-Sleep -Milliseconds 200
    $restored=-not [CwbOwnedWindow]::IsIconic($windowHandle)
    if(-not $restored){throw 'Independent window remains minimized'}
    [ordered]@{pid=$hostProcess.Id;identityVerified=$true;restored=$restored;topmostRequested=$true;foregroundRequested=$foregroundRequested;width=$windowWidth;height=$windowHeight} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'window-control.json') -Encoding utf8
  }
  $helperExe=Join-Path $workspace 'node_modules\electron\dist\electron.exe'
  $helperScript=if($ProductionSwitch){'verify-m2-production.cjs'}else{'verify-m2-live-scene.cjs'}
  $arguments=@('"'+(Join-Path $PSScriptRoot $helperScript)+'"','"'+$root+'"','"'+[IO.Path]::GetFullPath($ProjectRoot)+'"')
  if($ProbeOnly){$arguments+='--probe-only'}
  if($FrameTransfer){$arguments+='--frame-transfer'}
  if($EncodedTransfer){$arguments+='--encoded-transfer'}
  if($DirectGpu){$arguments+='--direct-gpu'}
  if($SwitchOnly){$arguments+='--switch-only'}
  $helper=Start-Process -FilePath $helperExe -WorkingDirectory $workspace -ArgumentList $arguments -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $root 'helper.stdout.log') -RedirectStandardError (Join-Path $root 'helper.stderr.log')
  $helperMetadata=Get-CimInstance Win32_Process -Filter ('ProcessId='+$helper.Id)
  if($helperMetadata -and $helperMetadata.ExecutablePath -eq $helperExe){$knownRoots+=$helperMetadata}
  [ordered]@{runRoot=$root;kind=$Kind;target=$target;helperPid=$helper.Id;launcherPid=$PID;probeOnly=[bool]$ProbeOnly;frameTransfer=[bool]$FrameTransfer;encodedTransfer=[bool]$EncodedTransfer;directGpu=[bool]$DirectGpu;visibleRequested=[bool]$Visible} | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath (Join-Path $root 'launch.json') -Encoding utf8
  $watchdogMs=if($ProductionSwitch){600000}else{240000}
  if(-not $helper.WaitForExit($watchdogMs)){throw 'Helper watchdog expired'}
  $helper.Refresh()
  $result=$helper.ExitCode
  $helperReport=Get-Content -LiteralPath (Join-Path $root 'scene-report.json') -Raw -Encoding utf8 | ConvertFrom-Json
  if($helperReport.outcome -ne 'pass' -or $result -ne 0){$result=1}
} catch {
  [ordered]@{outcome='fail';phase='launch-or-helper';rawDiagnosticsOmitted=$true} | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'launcher-failure.json') -Encoding utf8
} finally {
  # Stop only this new, identity-bound tree. Do not touch existing hosts or reuse PIDs.
  $all=@(Get-CimInstance Win32_Process)
  $approved=@{}
  foreach($known in $knownRoots){
    $p=$all | Where-Object ProcessId -EQ $known.ProcessId
    if(-not $p){continue}
    if($p.ProcessId -in $protected.ProcessId -or $p.ProcessId -eq $PID -or $p.ExecutablePath -ne $known.ExecutablePath -or $p.CreationDate.ToUniversalTime().Ticks -ne $known.CreationDate.ToUniversalTime().Ticks){throw 'Teardown root identity mismatch'}
    $approved[[int]$p.ProcessId]=$p
  }
  do {
    $count=$approved.Count
    foreach($p in $all){
      if(-not $approved.ContainsKey([int]$p.ParentProcessId) -or $approved.ContainsKey([int]$p.ProcessId)){continue}
      if($p.CreationDate.ToUniversalTime().Ticks -lt $approved[[int]$p.ParentProcessId].CreationDate.ToUniversalTime().Ticks){continue}
      if($p.ProcessId -in $protected.ProcessId -or $p.ProcessId -eq $PID){throw 'Protected descendant excluded'}
      $approved[[int]$p.ProcessId]=$p
    }
  } while($approved.Count -gt $count)
  @($approved.Values | ForEach-Object { [ordered]@{pid=$_.ProcessId;exe=$_.ExecutablePath;creation=$_.CreationDate.ToUniversalTime().ToString('o');parentPid=$_.ParentProcessId} }) | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'teardown-owned-tree.json') -Encoding utf8
  $stopped=@()
  $identitySkips=@()
  foreach($p in $approved.Values | Sort-Object CreationDate -Descending){
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ProcessId)
    if(-not $current){continue}
    if($current.ExecutablePath -ne $p.ExecutablePath -or $current.CreationDate.ToUniversalTime().Ticks -ne $p.CreationDate.ToUniversalTime().Ticks){
      # Exiting processes can lose WMI fields. Never weaken identity matching or
      # kill this PID; continue safe entries and account for it in the final check.
      $identitySkips+=[ordered]@{pid=$p.ProcessId;exeMatches=($current.ExecutablePath -eq $p.ExecutablePath);creationMatches=($current.CreationDate.ToUniversalTime().Ticks -eq $p.CreationDate.ToUniversalTime().Ticks)}
      continue
    }
    $native=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    if($native){
      $nativeTicks=$native.StartTime.ToUniversalTime().Ticks
      $wmiTicks=$p.CreationDate.ToUniversalTime().Ticks
      if(($wmiTicks%10) -ne 0 -or ($nativeTicks-($nativeTicks%10)) -ne $wmiTicks){throw 'Native handle creation mismatch'}
      try {
        Stop-Process -InputObject $native -Force
        $stopped+=$p.ProcessId
      } catch { if(-not $native.HasExited){throw 'Verified process cleanup failed'} }
    }
  }
  Start-Sleep -Milliseconds 600
  $remaining=@(Get-CimInstance Win32_Process | Where-Object { $approved.ContainsKey([int]$_.ProcessId) })
  foreach($p in $protected){
    $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ProcessId)
    if(-not $current -or $current.ExecutablePath -ne $p.ExecutablePath -or $current.CreationDate.ToUniversalTime().Ticks -ne $p.CreationDate.ToUniversalTime().Ticks){throw 'Protected chat identity changed'}
  }
  $teardown=[ordered]@{scope='new independent M2 test trees only';forcedCleanup=$true;nativeTrayExitVerified=$false;stoppedVerifiedPids=$stopped;skippedMismatchedIdentities=$identitySkips;remainingCount=$remaining.Count;listenerCount=@(Get-NetTCPConnection -State Listen -LocalPort $HostPort -ErrorAction SilentlyContinue).Count;protectedChatPreserved=$true}
  $teardown | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'teardown-result.json') -Encoding utf8
  if($teardown.remainingCount -or $teardown.listenerCount){$result=1}
  Write-Output ('M2_EVIDENCE_ROOT='+$root)
  Write-Output ('M2_HELPER_EXIT='+$result)
}
exit $result
