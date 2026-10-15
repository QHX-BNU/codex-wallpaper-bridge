param(
  [Parameter(Mandatory=$true)][ValidateSet('local','store')][string]$Kind,
  [Parameter(Mandatory=$true)][string]$Exe,
  [Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$HostPort,
  [Parameter(Mandatory=$true)][ValidateRange(1024,65535)][int]$DesktopPort
)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowed=Join-Path $workspace 'out\live-acceptance'
if ($HostPort -eq $DesktopPort -or @(Get-NetTCPConnection -State Listen -LocalPort $HostPort,$DesktopPort -ErrorAction SilentlyContinue).Count) { throw 'Test ports must be distinct and free' }
$exePath=(Get-Item -LiteralPath $Exe).FullName
if ([IO.Path]::GetExtension($exePath) -ne '.exe') { throw 'An existing EXE is required' }
$root=Join-Path $allowed ('m1-'+$Kind+'-'+(Get-Date).ToUniversalTime().ToString('yyyyMMddTHHmmssZ')+'-'+[guid]::NewGuid().ToString('N').Substring(0,8))
if (-not $root.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase)) { throw 'Outside acceptance workspace' }
$profile=Join-Path $root 'host-profile'
$desktopProfile=Join-Path $root 'desktop-user-data'
New-Item -ItemType Directory -Path $profile,$desktopProfile -Force | Out-Null
$protected=@(Get-CimInstance Win32_Process | Where-Object {$_.Name -eq 'ChatGPT.exe' -and $_.CommandLine -notmatch '--type='})
@($protected | ForEach-Object {[ordered]@{pid=$_.ProcessId;creation=$_.CreationDate.ToUniversalTime().ToString('o');exe=$_.ExecutablePath}}) | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'protected-chat.json') -Encoding utf8
$hostProcess=Start-Process -FilePath $exePath -ArgumentList @('--remote-debugging-address=127.0.0.1',"--remote-debugging-port=$HostPort","--user-data-dir=`"$profile`"") -WindowStyle Hidden -PassThru
$deadline=(Get-Date).AddSeconds(60)
do { Start-Sleep -Milliseconds 300; $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $HostPort -ErrorAction SilentlyContinue) } while (-not $listeners.Count -and (Get-Date) -lt $deadline)
$owners=@($listeners.OwningProcess | Select-Object -Unique)
if ($owners.Count -ne 1 -or $owners[0] -in $protected.ProcessId) { throw 'Unexpected host listener owner' }
$owner=Get-CimInstance Win32_Process -Filter ('ProcessId='+$owners[0])
if ($owner.ExecutablePath -ne $exePath -or $owner.CommandLine -notlike ('*'+$profile+'*')) { throw 'Host identity mismatch' }
$target=[ordered]@{port=$HostPort;pid=$owner.ProcessId;creation=$owner.CreationDate.ToUniversalTime().ToString('o');exe=$exePath;profile=$profile}
$target | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'target.json') -Encoding utf8
$env:CWB_ACCEPTANCE_ROOT=$root
$desktopExe=Join-Path $workspace 'node_modules\electron\dist\electron.exe'
$desktop=Start-Process -FilePath $desktopExe -WorkingDirectory $workspace -ArgumentList @('.',"--remote-debugging-address=127.0.0.1","--remote-debugging-port=$DesktopPort","--user-data-dir=`"$desktopProfile`"") -WindowStyle Hidden -PassThru
$desktopMetadata=Get-CimInstance Win32_Process -Filter ('ProcessId='+$desktop.Id)
$launch=[ordered]@{runRoot=$root;target=$target;desktopPid=$desktop.Id;desktopPort=$DesktopPort;desktopExe=$desktopExe;desktopProfile=$desktopProfile;desktopCreation=$desktopMetadata.CreationDate.ToUniversalTime().ToString('o');launcherPid=$PID}
$launch | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $root 'launch.json') -Encoding utf8
$launch | ConvertTo-Json -Depth 4
# Keep a verifiable ancestor predating the independent target alive. The desktop's
# fail-closed identity check must never depend on an already-exited launcher PID.
# Ending this launcher does not close applications; teardown must separately verify identities.
while (-not (Test-Path -LiteralPath (Join-Path $root 'stop-launcher'))) { Start-Sleep -Milliseconds 500 }
