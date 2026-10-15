param([ValidateSet(0,1)][int]$Audio=0, [ValidateSet(0,1)][int]$Media=0, [ValidateSet(0,1)][int]$Power=0)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
function Emit($value) { $hostState.EmitJson(($value | ConvertTo-Json -Depth 8 -Compress)) }
function Text($value) { if ($null -eq $value) { return '' }; return ([string]$value).Substring(0,[Math]::Min(512,([string]$value).Length)) }
function InputEvent($op,$value) { Emit @{ type='input'; input=@{ op=$op; value=$value } } }
function CloseResource($value) { if ($null -ne $value) { try { ([System.IDisposable]$value).Dispose() } catch { try { if ([Runtime.InteropServices.Marshal]::IsComObject($value)) { $null = [Runtime.InteropServices.Marshal]::FinalReleaseComObject($value) } } catch {} } } }
# Windows PowerShell 5.1 WinRT projection; tasks are bounded and never awaited forever.
function Await($operation,$type) {
  $method = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1 } | Select-Object -First 1
  $task = $method.MakeGenericMethod($type).Invoke($null,@($operation))
  if (!$task.Wait(1200)) { try { $operation.Cancel() } catch {}; throw 'media_async_timeout' }
  return $task.Result
}
$hostState = $null
try {
  $assembly=Join-Path $PSScriptRoot 'windows-media.dll'
  if(Test-Path -LiteralPath $assembly) { Add-Type -Path $assembly }
  else { Add-Type -Path (Join-Path $PSScriptRoot 'windows-media.cs') -ReferencedAssemblies System.Drawing }
  $hostState = New-Object CwbMedia.Host ([bool]$Audio)
  $manager = $null
  if ($Media) {
    try {
      Add-Type -AssemblyName System.Runtime.WindowsRuntime
      $managerType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionManager,Windows.Media.Control,ContentType=WindowsRuntime]
      $propertiesType = [Windows.Media.Control.GlobalSystemMediaTransportControlsSessionMediaProperties,Windows.Media.Control,ContentType=WindowsRuntime]
      $streamType = [Windows.Storage.Streams.IRandomAccessStreamWithContentType,Windows.Storage.Streams,ContentType=WindowsRuntime]
      $null = [Windows.Storage.Streams.DataReader,Windows.Storage.Streams,ContentType=WindowsRuntime]
      $manager = Await ($managerType::RequestAsync()) $managerType
      Emit @{ type='status'; source='media'; state='ready' }
    } catch { Emit @{ type='status'; source='media'; state='unavailable' } }
  }
  Emit @{ type='ready' }
  $sourceId = ''; $sessionId = ''; $trackId = ''; $thumbnailAttempts = 0; $lastMedia = -1000; $lastAudio = -66; $lastPower = -2; $audioState = ''; $session = $null
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  while (!$hostState.Stopped) {
    $command = $hostState.NextCommand()
    while ($null -ne $command) {
      try {
        $request = $command | ConvertFrom-Json
        if ($request.op -eq 'stop') { $hostState.Stopped=$true; break }
        $ok = $false
        if ($Media -and $manager -and $request.op -eq 'control' -and $request.command -in @('play','pause','previous','next') -and $request.sessionId -eq $sessionId -and $sessionId -and $request.expiresAt -gt [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds()) {
          $current = $manager.GetCurrentSession()
          if ($current -and [CwbMedia.Host]::SameSession($current,$session)) {
            $controls = $current.GetPlaybackInfo().Controls
            $operation = $null
            switch ($request.command) {
              'play' { if($controls.IsPlayEnabled) { $operation=$current.TryPlayAsync() } }
              'pause' { if($controls.IsPauseEnabled) { $operation=$current.TryPauseAsync() } }
              'previous' { if($controls.IsPreviousEnabled) { $operation=$current.TrySkipPreviousAsync() } }
              'next' { if($controls.IsNextEnabled) { $operation=$current.TrySkipNextAsync() } }
            }
            if ($operation) { $ok=[bool](Await $operation ([bool])) }
          }
        }
        if ($request.op -eq 'control' -and $request.request -is [int]) { Emit @{ type='reply'; request=$request.request; ok=$ok } }
      } catch { if ($request -and $request.op -eq 'control') { Emit @{ type='reply'; request=$request.request; ok=$false } } }
      $command = $hostState.NextCommand()
    }
    if ($hostState.Stopped) { break }
    $now = $clock.ElapsedMilliseconds
    if ($Power) {
      $battery = [CwbMedia.Host]::Battery()
      if ($battery -ne $lastPower) { $lastPower=$battery; Emit @{ type='power'; onBattery=($battery -eq 1) } }
    }
    # Spectrum/status is emitted on the native audio thread, independent of
    # potentially slow WinRT metadata/thumbnail tasks on this control loop.
    if ($Media -and $manager -and $now-$lastMedia -ge 1000) {
      try {
        $currentSession = $manager.GetCurrentSession()
        if (!$currentSession) {
          $sourceId=''; $sessionId=''; $trackId=''; $thumbnailAttempts=0; $session=$null
          Emit @{ type='session'; id=''; commands=@() }; InputEvent 'mediaStatus' @{ enabled=$false }
        } else {
          if (![CwbMedia.Host]::SameSession($currentSession,$session)) { $sessionId=[Guid]::NewGuid().ToString('N'); $trackId='' }
          $session=$currentSession; $sourceId=$session.SourceAppUserModelId
          $properties = Await ($session.TryGetMediaPropertiesAsync()) $propertiesType
          $playback = $session.GetPlaybackInfo(); $timeline = $session.GetTimelineProperties()
          $commands = @(); $controls=$playback.Controls
          if ($controls.IsPlayEnabled) { $commands+='play' }; if ($controls.IsPauseEnabled) { $commands+='pause' }
          if ($controls.IsPreviousEnabled) { $commands+='previous' }; if ($controls.IsNextEnabled) { $commands+='next' }
          Emit @{ type='session'; id=$sessionId; commands=@($commands) }; InputEvent 'mediaStatus' @{ enabled=$true }
          $duration=[Math]::Max(0,[Math]::Min(86400,($timeline.EndTime-$timeline.StartTime).TotalSeconds))
          $position=[Math]::Max(0,[Math]::Min($duration,($timeline.Position-$timeline.StartTime).TotalSeconds))
          $state='stopped'; if ([string]$playback.PlaybackStatus -eq 'Playing') { $state='playing' }; if ([string]$playback.PlaybackStatus -eq 'Paused') { $state='paused' }
          InputEvent 'media' @{ state=$state; title=(Text $properties.Title); artist=(Text $properties.Artist); album=(Text $properties.AlbumTitle); albumTitle=(Text $properties.AlbumTitle); albumArtist=(Text $properties.AlbumArtist); subTitle=(Text $properties.Subtitle); genres=(Text ($properties.Genres -join ', ')); position=$position; duration=$duration }
          $key=([string]$properties.Title)+"`n"+$properties.Artist+"`n"+$properties.AlbumTitle
          $newTrack=$key -ne $trackId
          if ($newTrack) { $trackId=$key; $thumbnailAttempts=0; InputEvent 'mediaThumbnail' @{ thumbnail='' } }
          # Artwork can become available after the first metadata snapshot.
          # Retry for at most ten 1 Hz polls; do not retain stale artwork or
          # emit repeated empty callbacks forever.
          if ($thumbnailAttempts -lt 10) {
            $thumbnailAttempts++; $thumbnail=''; $stream=$null
            try {
              if ($properties.Thumbnail) {
                $stream=Await ($properties.Thumbnail.OpenReadAsync()) $streamType
                # PS 5.1 may expose this as System.__ComObject: Size is then
                # absent, not zero. The native reader already enforces 2 MiB.
                $bytes=[CwbMedia.Host]::ReadRandomAccessStream($stream,2097152)
                $thumbnail=[CwbMedia.Host]::Thumbnail($bytes)
              }
            } catch {} finally { CloseResource $stream }
            if ($thumbnail) { $thumbnailAttempts=10; InputEvent 'mediaThumbnail' @{ thumbnail=$thumbnail } }
          }
        }
      } catch { $session=$null; $sessionId=''; $sourceId=''; $trackId=''; $thumbnailAttempts=0; Emit @{ type='session'; id=''; commands=@() }; InputEvent 'mediaStatus' @{ enabled=$false }; Emit @{ type='status'; source='media'; state='unavailable' } }
      $lastMedia=$now
    }
    Start-Sleep -Milliseconds 20
  }
} finally { if ($hostState) { $hostState.Dispose() } }
