param([Parameter(Mandatory=$true)][string]$Root,[Parameter(Mandatory=$true)][string]$Nonce,[ValidateSet('A','B')][string]$Label='A',[switch]$StartupOnly)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
Add-Type -Path (Join-Path $PSScriptRoot 'm3-acceptance-media-events.cs')
$playerType=[Windows.Media.Playback.MediaPlayer,Windows.Media.Playback,ContentType=WindowsRuntime]
$sourceType=[Windows.Media.Core.MediaSource,Windows.Media.Core,ContentType=WindowsRuntime]
$storageType=[Windows.Storage.StorageFile,Windows.Storage,ContentType=WindowsRuntime]
$streamType=[Windows.Storage.Streams.RandomAccessStreamReference,Windows.Storage.Streams,ContentType=WindowsRuntime]
$null=[Windows.Media.SystemMediaTransportControlsTimelineProperties,Windows.Media,ContentType=WindowsRuntime]
$null=[Windows.Media.MediaPlaybackType,Windows.Media,ContentType=WindowsRuntime]
$null=[Windows.Media.MediaPlaybackStatus,Windows.Media,ContentType=WindowsRuntime]
$messages=[Collections.Generic.List[object]]::new()
$stateFile=Join-Path $Root ('player-'+$Label+'-state.json')
$commandFile=Join-Path $Root ('player-'+$Label+'-command.json')
$index=0;$lastRequest=0;$paused=$false;$remote=@{play=0;pause=0;next=0;previous=0}
$player=$null;$controls=$null;$source=$null;$stage='construct';$sink=$null
function Emit($value){
  $messages.Add($value);if($messages.Count -gt 64){$messages.RemoveAt(0)}
  $json=ConvertTo-Json -InputObject @($messages.ToArray()) -Depth 7 -Compress
  [IO.File]::WriteAllText($stateFile+'.tmp',$json,[Text.UTF8Encoding]::new($false));[IO.File]::Copy($stateFile+'.tmp',$stateFile,$true)
}
function Await($operation,$type){
  $method=[System.WindowsRuntimeSystemExtensions].GetMethods()|Where-Object {$_.Name -eq 'AsTask' -and $_.IsGenericMethod -and $_.GetGenericArguments().Count -eq 1 -and $_.GetParameters().Count -eq 1}|Select-Object -First 1
  $task=$method.MakeGenericMethod($type).Invoke($null,@($operation));if(!$task.Wait(1500)){throw 'fixture_async_timeout'};return $task.Result
}
function Snapshot {
  return @{index=$script:index;paused=$script:paused;position=$player.PlaybackSession.Position.TotalSeconds;remote=@{play=$remote.play;pause=$remote.pause;next=$remote.next;previous=$remote.previous};title=('CWB-M3-'+$Nonce+'-'+$Label+'-'+$script:index);playbackState=[string]$player.PlaybackSession.PlaybackState}
}
function SelectTrack([int]$value){
  $script:index=($value+2)%2
  if($script:source){([IDisposable]$script:source).Dispose()}
  $file=Join-Path $Root ('assets\tone-'+(@(440,880)[$script:index])+'.wav')
  $script:source=$sourceType::CreateFromUri([Uri]::new($file));$player.Source=$script:source
  $updater=$controls.DisplayUpdater;$updater.Type=[Windows.Media.MediaPlaybackType]::Music
  $updater.MusicProperties.Title=('CWB-M3-'+$Nonce+'-'+$Label+'-'+$script:index);$updater.MusicProperties.Artist='CWB Acceptance Fixture';$updater.MusicProperties.AlbumTitle=('CWB M3 '+$Nonce)
  $cover=Await ($storageType::GetFileFromPathAsync((Join-Path $Root 'assets\cover.png'))) $storageType
  $updater.Thumbnail=$streamType::CreateFromFile($cover);$updater.Update()
  $script:paused=$false;$player.Play();$controls.PlaybackStatus=[Windows.Media.MediaPlaybackStatus]::Playing
}
function Command([string]$op){
  switch($op){
    'play'{$script:paused=$false;$player.Play();$controls.PlaybackStatus=[Windows.Media.MediaPlaybackStatus]::Playing}
    'pause'{$script:paused=$true;$player.Pause();$controls.PlaybackStatus=[Windows.Media.MediaPlaybackStatus]::Paused}
    'next'{SelectTrack ($script:index+1)}
    'previous'{SelectTrack ($script:index-1)}
  }
}
try {
  $player=[Activator]::CreateInstance($playerType);$player.Volume=0.08;$player.IsLoopingEnabled=$true;$player.CommandManager.IsEnabled=$false
  $controls=$player.SystemMediaTransportControls;$controls.IsEnabled=$true;$controls.IsPlayEnabled=$true;$controls.IsPauseEnabled=$true;$controls.IsNextEnabled=$true;$controls.IsPreviousEnabled=$true
  $stage='subscribe';$sink=New-Object CwbAcceptanceMediaEvents;$sink.Attach($controls,[Windows.Media.SystemMediaTransportControls,Windows.Media,ContentType=WindowsRuntime])
  $stage='select'
  SelectTrack 0
  Emit @{type='ready';kind='real_winrt_media_player'}
  if($StartupOnly){Start-Sleep -Milliseconds 600;exit 0}
  $clock=[Diagnostics.Stopwatch]::StartNew();$lastState=-1000;$quit=$false
  while(!$quit){
    $op=$sink.Take()
    while($null -ne $op){
      if($op -eq 'next'){$op='next'};if($op -eq 'previous'){$op='previous'}
      if($op -in @('play','pause','next','previous')){$remote[$op]++;Command $op}
      $op=$sink.Take()
    }
    if(Test-Path -LiteralPath $commandFile){
      try {$request=[IO.File]::ReadAllText($commandFile)|ConvertFrom-Json} catch {$request=$null}
      if($request -and $request.request -gt $lastRequest){
        $lastRequest=[int]$request.request
        if($request.op -eq 'quit'){Emit @{type='reply';request=$lastRequest;result=@{ok=$true}};$quit=$true}
        elseif($request.op -in @('play','pause','next','previous','snapshot')){Command $request.op;Emit @{type='reply';request=$lastRequest;result=(Snapshot)}}
      }
    }
    if($clock.ElapsedMilliseconds-$lastState -ge 500){
      $timeline=New-Object Windows.Media.SystemMediaTransportControlsTimelineProperties
      $timeline.StartTime=[TimeSpan]::Zero;$timeline.EndTime=[TimeSpan]::FromSeconds(20);$timeline.MinSeekTime=[TimeSpan]::Zero;$timeline.MaxSeekTime=[TimeSpan]::FromSeconds(20);$timeline.Position=$player.PlaybackSession.Position
      $controls.UpdateTimelineProperties($timeline);$value=Snapshot;$value.type='state';Emit $value;$lastState=$clock.ElapsedMilliseconds
    }
    Start-Sleep -Milliseconds 30
  }
} catch { Emit @{type='error';reason='native_fixture_failed';exceptionType=$_.Exception.GetBaseException().GetType().Name;stage=$stage;line=$_.InvocationInfo.ScriptLineNumber};exit 2 }
finally {
  if($sink){$sink.Detach()}
  if($controls){$controls.IsEnabled=$false};if($player){$player.Pause();([IDisposable]$player).Dispose()};if($source){([IDisposable]$source).Dispose()}
}
