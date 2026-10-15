param([Parameter(Mandatory=$true)][string[]]$Roots,
  [Parameter(Mandatory=$true)][int]$ProtectedPid,
  [Parameter(Mandatory=$true)][string]$ProtectedCreation)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$allowed=(Join-Path $workspace 'out\live-acceptance')+'\'
function Ticks([string]$creation) {
  [DateTime]::ParseExact($creation,'o',[Globalization.CultureInfo]::InvariantCulture,[Globalization.DateTimeStyles]::RoundtripKind).ToUniversalTime().Ticks
}
$all=@(Get-CimInstance Win32_Process)
$approved=@{}
$ports=@()
$excludedOlderChildren=@()
foreach($root in $Roots) {
  $resolved=(Resolve-Path -LiteralPath $root).Path
  if(-not $resolved.StartsWith($allowed,[StringComparison]::OrdinalIgnoreCase)) {throw 'Invalid teardown root'}
  $l=Get-Content -LiteralPath (Join-Path $root 'launch.json') -Raw -Encoding utf8 | ConvertFrom-Json -DateKind String
  $creation=$l.desktopCreation
  if(-not $creation) { $creation=(Get-Content -LiteralPath (Join-Path $root 'launcher-ancestry.json') -Raw -Encoding utf8 | ConvertFrom-Json -DateKind String).desktopCreation }
  $expected=@([pscustomobject]@{pid=$l.target.pid;exe=$l.target.exe;creation=$l.target.creation;profile=$l.target.profile;port=$l.target.port},
    [pscustomobject]@{pid=$l.desktopPid;exe=$l.desktopExe;creation=$creation;profile=$l.desktopProfile;port=$l.desktopPort})
  foreach($e in $expected) {
    if($e.pid -eq $ProtectedPid -or $e.pid -eq $PID) {throw 'Protected PID excluded'}
    $p=$all | Where-Object ProcessId -EQ $e.pid
    if(-not $p) {continue}
    $pattern='(?:^|\s)--user-data-dir=(?:"'+[regex]::Escape($e.profile)+'"|'+[regex]::Escape($e.profile)+')(?:\s|$)'
    if($p.ExecutablePath -ne $e.exe -or $p.CreationDate.ToUniversalTime().Ticks -ne (Ticks $e.creation) -or $p.CommandLine -notmatch $pattern) {throw 'Teardown identity mismatch'}
    $listeners=@(Get-NetTCPConnection -State Listen -LocalPort $e.port -ErrorAction SilentlyContinue)
    if($listeners.Count -and @($listeners | Where-Object OwningProcess -NE $e.pid).Count) {throw 'Teardown listener mismatch'}
    $approved[[int]$p.ProcessId]=$p
    $ports+=$e.port
  }
}
do {
  $count=$approved.Count
  foreach($p in $all) {
    if(-not $approved.ContainsKey([int]$p.ParentProcessId) -or $approved.ContainsKey([int]$p.ProcessId)) {continue}
    $parent=$approved[[int]$p.ParentProcessId]
    # Windows retains the original parent PID after exit. An older child cannot
    # belong to this newer root; exclude it rather than killing an unrelated tree.
    if($p.CreationDate.ToUniversalTime().Ticks -lt $parent.CreationDate.ToUniversalTime().Ticks) {
      $excludedOlderChildren+=$p.ProcessId; continue
    }
    if($p.ProcessId -eq $ProtectedPid -or $p.ProcessId -eq $PID) {throw 'Protected descendant excluded'}
    $approved[[int]$p.ProcessId]=$p
  }
} while($approved.Count -gt $count)
$stopped=@()
foreach($p in $approved.Values | Sort-Object CreationDate) {
  $current=Get-CimInstance Win32_Process -Filter ('ProcessId='+$p.ProcessId)
  if(-not $current) {continue}
  if($current.CreationDate.ToUniversalTime().Ticks -ne $p.CreationDate.ToUniversalTime().Ticks -or $current.ExecutablePath -ne $p.ExecutablePath) {throw 'Teardown PID reused'}
  $native=Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
  if($native) {
    # WMI DMTF CreationDate has microsecond precision; native FILETIME retains
    # the final 100 ns digit. Compare at WMI's actual precision, not a rounded
    # floating-point value. Reading StartTime holds this process's native handle.
    $nativeTicks=$native.StartTime.ToUniversalTime().Ticks
    $wmiTicks=$p.CreationDate.ToUniversalTime().Ticks
    if(($wmiTicks%10) -ne 0 -or ($nativeTicks-($nativeTicks%10)) -ne $wmiTicks) {throw 'Native handle creation mismatch'}
    Stop-Process -InputObject $native -Force
    $stopped+=$p.ProcessId
  }
}
Start-Sleep -Milliseconds 600
$remaining=@(Get-CimInstance Win32_Process | Where-Object {$approved.ContainsKey([int]$_.ProcessId)})
$protected=Get-CimInstance Win32_Process -Filter ('ProcessId='+$ProtectedPid)
if(-not $protected -or $protected.CreationDate.ToUniversalTime().Ticks -ne (Ticks $ProtectedCreation)) {throw 'Protected chat identity check failed'}
foreach($root in $Roots) { 'finished' | Set-Content -LiteralPath (Join-Path $root 'stop-launcher') -Encoding utf8 }
$report=[ordered]@{scope='explicit newly-created M1 test trees only';forcedTestCleanup=$true;nativeTrayExitVerified=$false;
  stoppedVerifiedPids=$stopped;excludedOlderChildren=@($excludedOlderChildren | Select-Object -Unique);remainingCount=$remaining.Count;
  testListenerCount=@(Get-NetTCPConnection -State Listen -LocalPort $ports -ErrorAction SilentlyContinue).Count;
  protectedChatPreserved=$true;checkedAt=(Get-Date).ToUniversalTime().ToString('o')}
$report | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $workspace 'out\m1-20261010-playback\live-teardown.json') -Encoding utf8
$report | ConvertTo-Json -Depth 4
