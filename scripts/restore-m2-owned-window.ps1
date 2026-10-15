param([Parameter(Mandatory=$true)][string]$TargetFile,
  [ValidateSet('restore','minimize')][string]$WindowAction='restore',
  [long]$OwnedWindowHandle=0)
$ErrorActionPreference='Stop'
$restoreStage='path-check'
trap { [ordered]@{ok=$false;stage=$restoreStage;category='owned-window-operation-failed'}|ConvertTo-Json -Compress; exit 1 }
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$allowed=Join-Path $workspace 'out\live-acceptance'
$targetPath=[IO.Path]::GetFullPath($TargetFile)
if(-not $targetPath.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($targetPath) -ne 'target.json'){throw 'Unexpected test target file'}
$cursor=Get-Item -LiteralPath $targetPath
while($cursor.FullName -ne $workspace){
  if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'Redirected test path'}
  $cursor=if($cursor -is [IO.DirectoryInfo]){$cursor.Parent}else{$cursor.Directory}
  if(-not $cursor){throw 'Test path outside workspace'}
}
$target=Get-Content -LiteralPath $targetPath -Raw -Encoding utf8 | ConvertFrom-Json
$restoreStage='target-identity'
$expectedPid=[int]$target.pid
if($expectedPid -le 0 -or $expectedPid -eq $PID){throw 'Invalid test PID'}
$expectedTicks=[DateTimeOffset]::Parse($target.creation).UtcTicks
$exePath=[IO.Path]::GetFullPath($target.exe)
$profile=[IO.Path]::GetFullPath($target.profile)
$runRoot=[IO.Path]::GetDirectoryName($targetPath)
if($profile -ne (Join-Path $runRoot 'host-profile')){throw 'Unexpected independent profile'}
$protected=@(Get-Content -LiteralPath (Join-Path $runRoot 'protected-chat.json') -Raw -Encoding utf8 | ConvertFrom-Json)
if($expectedPid -in $protected.pid){throw 'Protected chat is not a test window'}
$restoreStage='process-identity'
$windowOwner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$expectedPid)
if(-not $windowOwner -or $windowOwner.ExecutablePath -ne $exePath -or $windowOwner.CreationDate.ToUniversalTime().Ticks -ne $expectedTicks){throw 'Window process identity mismatch'}
$profilePattern='(?:^|\s)--user-data-dir=(?:"'+[regex]::Escape($profile)+'"|'+[regex]::Escape($profile)+')(?:\s|$)'
if($windowOwner.CommandLine -notmatch $profilePattern){throw 'Window profile identity mismatch'}
$restoreStage='listener-identity'
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$target.port) -ErrorAction Stop)
$owners=@($listeners.OwningProcess|Select-Object -Unique)
if($owners.Count -ne 1 -or $owners[0] -ne $expectedPid -or @($listeners|Where-Object LocalAddress -NotIn '127.0.0.1','::1').Count){throw 'Window CDP owner mismatch'}
$restoreStage='native-process-handle'
$hostProcess=Get-Process -Id $expectedPid
$nativeTicks=$hostProcess.StartTime.ToUniversalTime().Ticks
if(($nativeTicks-($nativeTicks%10)) -ne $expectedTicks){throw 'Window process handle identity mismatch'}
$restoreStage='native-api-load'
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
$restoreStage='native-window-handle'
$deadline=(Get-Date).AddSeconds(5)
do {
  $hostProcess.Refresh(); $windowHandle=if($OwnedWindowHandle -gt 0){[IntPtr]::new($OwnedWindowHandle)}else{$hostProcess.MainWindowHandle}
  if($windowHandle -ne [IntPtr]::Zero){break}
  Start-Sleep -Milliseconds 100
} while((Get-Date) -lt $deadline)
if($windowHandle -eq [IntPtr]::Zero){throw 'Independent host window unavailable'}
[uint32]$windowPid=0
[void][CwbOwnedWindow]::GetWindowThreadProcessId($windowHandle,[ref]$windowPid)
if($windowPid -ne $hostProcess.Id -or $windowPid -in $protected.pid){throw 'Window owner mismatch'}
if($WindowAction -eq 'minimize'){
  $restoreStage='native-window-minimize'
  [void][CwbOwnedWindow]::ShowWindowAsync($windowHandle,6)
  $deadline=(Get-Date).AddSeconds(5)
  do { $minimized=[CwbOwnedWindow]::IsIconic($windowHandle); if($minimized){break}; Start-Sleep -Milliseconds 100 } while((Get-Date) -lt $deadline)
  if(-not $minimized){throw 'Independent window did not minimize'}
  [ordered]@{pid=$expectedPid;identityVerified=$true;minimized=$true;foregroundRequested=$false;windowHandle=$windowHandle.ToInt64()}|ConvertTo-Json -Compress
  exit 0
}
$restoreStage='native-window-restore'
[void][CwbOwnedWindow]::ShowWindowAsync($windowHandle,9)
if(-not [CwbOwnedWindow]::SetWindowPos($windowHandle,[IntPtr]::new(-1),40,60,1050,720,0x0040)){throw 'Independent window positioning failed'}
$foregroundRequested=[CwbOwnedWindow]::SetForegroundWindow($windowHandle)
Start-Sleep -Milliseconds 100
$restored=-not [CwbOwnedWindow]::IsIconic($windowHandle)
if(-not $restored){throw 'Independent window remains minimized'}
[ordered]@{pid=$expectedPid;identityVerified=$true;restored=$restored;topmostRequested=$true;foregroundRequested=$foregroundRequested;width=1050;height=720}|ConvertTo-Json -Compress
