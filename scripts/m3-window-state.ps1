param([Parameter(Mandatory=$true)][string]$TargetFile)
$ErrorActionPreference='Stop'
$workspace=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')).TrimEnd('\')
$allowed=Join-Path $workspace 'out\live-acceptance'
$targetPath=[IO.Path]::GetFullPath($TargetFile)
if(-not $targetPath.StartsWith($allowed+'\',[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($targetPath) -ne 'target.json'){throw 'unexpected_target_path'}
$cursor=Get-Item -LiteralPath $targetPath
while($cursor.FullName -ne $workspace){
  if($cursor.Attributes -band [IO.FileAttributes]::ReparsePoint){throw 'redirected_target_path'}
  $cursor=if($cursor -is [IO.DirectoryInfo]){$cursor.Parent}else{$cursor.Directory}
  if(-not $cursor){throw 'target_outside_workspace'}
}
$target=Get-Content -LiteralPath $targetPath -Raw -Encoding utf8|ConvertFrom-Json
$protected=@(Get-Content -LiteralPath (Join-Path (Split-Path -Parent $targetPath) 'protected-chat.json') -Raw -Encoding utf8|ConvertFrom-Json)
if([int]$target.pid -le 0 -or [int]$target.pid -in $protected.pid){throw 'protected_or_invalid_target'}
$profile=[IO.Path]::GetFullPath($target.profile)
if($profile -ne (Join-Path (Split-Path -Parent $targetPath) 'host-profile')){throw 'unexpected_profile'}
$p=Get-CimInstance Win32_Process -Filter ('ProcessId='+[int]$target.pid)
if(-not $p -or $p.ExecutablePath -ne $target.exe -or $p.CreationDate.ToUniversalTime().ToString('o') -ne $target.creation){throw 'target_identity_changed'}
if($p.CommandLine -notmatch ('(?:^|\s)--user-data-dir=(?:"'+[regex]::Escape($profile)+'"|'+[regex]::Escape($profile)+')(?:\s|$)')){throw 'target_profile_changed'}
$listeners=@(Get-NetTCPConnection -State Listen -LocalPort ([int]$target.port) -ErrorAction Stop)
$owners=@($listeners.OwningProcess|Select-Object -Unique)
if($owners.Count -ne 1 -or $owners[0] -ne $p.ProcessId -or @($listeners|Where-Object LocalAddress -NotIn '127.0.0.1','::1').Count){throw 'target_listener_changed'}
Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class CwbM3WindowState {
  public delegate bool EnumCallback(IntPtr window,IntPtr value);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumCallback callback,IntPtr value);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window,out Rect rect);
  [DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr window,int attribute,out int value,int size);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
  public static IntPtr[] Owned(int pid) {
    var windows=new List<IntPtr>();
    EnumWindows((window,value)=>{uint owner;GetWindowThreadProcessId(window,out owner);if(owner==pid)windows.Add(window);return true;},IntPtr.Zero);
    return windows.ToArray();
  }
}
'@
$foreground=[CwbM3WindowState]::GetForegroundWindow()
$rows=@(foreach($window in [CwbM3WindowState]::Owned([int]$target.pid)){
  $cloaked=0;$hr=[CwbM3WindowState]::DwmGetWindowAttribute($window,14,[ref]$cloaked,4)
  $rect=New-Object CwbM3WindowState+Rect;$rectOk=[CwbM3WindowState]::GetWindowRect($window,[ref]$rect)
  [ordered]@{handle=$window.ToInt64();visible=[CwbM3WindowState]::IsWindowVisible($window);iconic=[CwbM3WindowState]::IsIconic($window);foreground=($foreground -eq $window);cloaked=if($hr -eq 0){$cloaked}else{$null};rect=if($rectOk){@($rect.Left,$rect.Top,$rect.Right,$rect.Bottom)}else{$null}}
})
[ordered]@{at=[DateTime]::UtcNow.ToString('o');pid=[int]$target.pid;identityVerified=$true;windows=$rows}|ConvertTo-Json -Depth 5 -Compress
