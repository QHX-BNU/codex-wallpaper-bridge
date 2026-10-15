import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { VideoTools, parseVideoProbe, buildTranscodeArgs } from '../bridge-runtime/src/video-tools.mjs';

function fakeSpawn(behavior, calls = []) {
  return (file, args, options) => {
    calls.push({ file, args, options });
    const child = new EventEmitter(); child.pid = 123; child.stdout = new PassThrough(); child.stderr = new PassThrough();
    child.stdin = new PassThrough(); let stopped = false;
    const end = (code = 0, signal = null) => {
      if (stopped) return; stopped = true; child.stdout.end(); child.stderr.end(); child.emit('close', code, signal);
    };
    child.kill = signal => { queueMicrotask(() => end(null, signal)); return true; };
    queueMicrotask(() => behavior({ child, file, args, end })); return child;
  };
}
test('bounded local capability probe distinguishes advertised encoders from actual hardware availability', async t => {
  const calls = [], tools = new VideoTools({ env: {}, spawn: fakeSpawn(({ child, args, file, end }) => {
    child.stdout.write(args.includes('-encoders') ? ' V....D libx264 software\n V....D h264_nvenc hardware\n'
      : `${file.includes('ffprobe') ? 'ffprobe' : 'ffmpeg'} version test\n`); end();
  }, calls) }); t.after(() => tools.close());
  const result = await tools.probeCapabilities(); assert.equal(result.available, true);
  assert.deepEqual(result.encoders, ['libx264', 'h264_nvenc']); assert.equal(result.hardwareVerified, false);
  const count = calls.length; await tools.probeCapabilities(); assert.equal(calls.length, count);
  assert.ok(calls.every(call => call.options.shell === false && call.options.windowsHide && call.options.stdio[0] === 'ignore'));
});
test('missing tool is an explicit degradation, not a fake capability or downloaded dependency', async t => {
  const tools = new VideoTools({ env: {}, spawn: fakeSpawn(({ child, end }) => {
    child.emit('error', Object.assign(Error('private path'), { code: 'ENOENT' })); end(-1);
  }) }); t.after(() => tools.close());
  const cap = await tools.probeCapabilities(); assert.equal(cap.available, false); assert.equal(cap.error, 'video_tool_missing');
  assert.doesNotMatch(JSON.stringify(cap), /private path/);
});
test('tool output bound, timeout and abort wait for owned process close; close rejects new requests', async () => {
  const huge = new VideoTools({ env: {}, spawn: fakeSpawn(({ child }) => child.stdout.write(Buffer.alloc(1024))) });
  await assert.rejects(huge.run('ffmpeg', [], { maxOutputBytes: 16 }), /video_tool_output_limit/);
  assert.equal((await huge.close()).remaining, 0);
  const slow = new VideoTools({ env: {}, spawn: fakeSpawn(() => {}) });
  await assert.rejects(slow.run('ffmpeg', [], { timeoutMs: 20 }), /video_tool_timeout/);
  const controller = new AbortController(), running = slow.run('ffmpeg', [], { signal: controller.signal }); controller.abort();
  await assert.rejects(running, /video_tool_cancelled/); assert.equal((await slow.close()).remaining, 0);
  await assert.rejects(slow.run('ffmpeg', []), /video_tools_closed/);
});
test('probe is bounded/validated; frame cap never raises existing lower fps; fixed args do not open arbitrary protocols', () => {
  const input = { streams: [{ codec_type: 'video', codec_name: 'h264', width: 1920, height: 1080, avg_frame_rate: '60/1' }], format: { duration: '12.5' } };
  const video = parseVideoProbe(input); assert.equal(video.fps, 60);
  const args = buildTranscodeArgs('C:\\source video.mp4', 'C:\\cache\\own.part', video, { fpsCap: 30 }, 'libx264');
  assert.ok(args.includes('file')); assert.ok(args.includes('pipe:1')); assert.ok(args.includes('+faststart'));
  assert.equal(args[args.indexOf('-enable_drefs') + 1], '0'); assert.equal(args[args.indexOf('-use_absolute_path') + 1], '0');
  assert.equal(args[args.indexOf('-f') + 1], 'mov');
  assert.match(args[args.indexOf('-vf') + 1], /fps=30/); assert.ok(!args.includes('shell'));
  const low = buildTranscodeArgs('a', 'b', { ...video, fps: 24 }, { fpsCap: 30 }, 'libx264');
  assert.match(low[low.indexOf('-vf') + 1], /fps=24/);
  for (const bad of [{}, { ...input, format: { duration: 'Infinity' } }, { ...input, streams: [{ ...input.streams[0], width: 999999 }] }]) {
    assert.throws(() => parseVideoProbe(bad), /video_probe_invalid/);
  }
});
test('invalid configured executable degrades without breaking server construction; container autodetect is not an arbitrary-file loader', async t => {
  let called = false;
  const tools = new VideoTools({ env: { CWB_FFMPEG_PATH: 'relative -command' }, spawn: () => { called = true; } }); t.after(() => tools.close());
  assert.equal((await tools.probeCapabilities()).error, 'video_tool_path_invalid'); assert.equal(called, false);
  assert.throws(() => buildTranscodeArgs('malicious.m3u8', 'output', { fps: 30 }, {}, 'libx264'), /video_format_unsupported/);
});
test('real owned Node child exercises natural close and bounded timeout cleanup, not an ffmpeg capability claim', async () => {
  const tools = new VideoTools({ env: {} });
  assert.equal(await tools.run(process.execPath, ['-e', 'process.stdout.write("owned fixture")']), 'owned fixture');
  await assert.rejects(tools.run(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { timeoutMs: 50 }), /video_tool_timeout/);
  const status = await tools.close(); assert.equal(status.remaining, 0); assert.equal(status.clean, true);
});
