// Isolated-world encoder in the OWNED independent wrapper only. No contextBridge,
// window API, author messages, network, files, arbitrary codec or commands.
const { ipcRenderer } = require('electron');
if (process.isMainFrame) {
  let encoder, busy = false, stopped = false, operation;
  const close = () => { if (encoder && encoder.state !== 'closed') encoder.close(); };
  const onFrame = async (_event, packet) => {
    const reply = (result) => ipcRenderer.send('cwb-m2-vp8-encoded', { sequence: packet?.sequence, ...result });
    if (stopped) return reply({ ok: false, reason: 'closed' });
    if (busy) return reply({ ok: false, reason: 'busy' });
    if (!packet || Array.isArray(packet) || !Number.isSafeInteger(packet.sequence) || packet.sequence < 1 || packet.sequence > 2147483647
      || packet.timestamp !== packet.sequence * 100000 || !(packet.bgra instanceof Uint8Array) || packet.bgra.length !== 1440000) {
      return reply({ ok: false, reason: 'invalid-frame' });
    }
    busy = true; operation = { timestamp: packet.timestamp, outputs: 0, chunk: null }; let frame;
    const started = performance.now();
    try {
      if (!encoder) {
        const config = { codec: 'vp8', width: 800, height: 450, bitrate: 5000000,
          framerate: 10, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' };
        if (typeof VideoEncoder !== 'function' || !(await VideoEncoder.isConfigSupported(config)).supported) throw Error('codec unsupported');
        encoder = new VideoEncoder({ output(chunk) {
          if (!operation || stopped) return;
          operation.outputs++;
          if (operation.outputs !== 1 || chunk.type !== 'key' || chunk.timestamp !== operation.timestamp
            || chunk.byteLength < 11 || chunk.byteLength > 2097152) { operation.invalid = true; return; }
          const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes);
          operation.chunk = bytes;
        }, error() { if (operation) operation.invalid = true; } });
        encoder.configure(config);
      }
      if (encoder.state !== 'configured' || encoder.encodeQueueSize !== 0) throw Error('encoder not ready');
      frame = new VideoFrame(packet.bgra, { format: 'BGRA', codedWidth: 800, codedHeight: 450,
        timestamp: packet.timestamp, duration: 100000 });
      encoder.encode(frame, { keyFrame: true }); frame.close(); frame = null;
      await encoder.flush();
      if (stopped || operation.invalid || operation.outputs !== 1 || !operation.chunk) throw Error('encoder failed');
      reply({ ok: true, timestamp: packet.timestamp, vp8: operation.chunk, encodeMs: performance.now() - started });
    } catch { stopped = true; close(); reply({ ok: false, reason: 'encode' }); }
    finally { frame?.close(); operation = null; busy = false; }
  };
  const onStop = () => {
    stopped = true; close();
    ipcRenderer.removeListener('cwb-m2-vp8-frame', onFrame);
    ipcRenderer.removeListener('cwb-m2-vp8-stop', onStop);
    ipcRenderer.send('cwb-m2-vp8-stopped', { stopped: true, encoderState: encoder?.state ?? 'absent' });
  };
  ipcRenderer.on('cwb-m2-vp8-frame', onFrame);
  ipcRenderer.on('cwb-m2-vp8-stop', onStop);
}
