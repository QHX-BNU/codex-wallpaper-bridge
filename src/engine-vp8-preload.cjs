// This isolated world only receives main-owned native pixels. Never expose a
// contextBridge/window API or accept author postMessage, URLs or codec options.
const { ipcRenderer } = require('electron');
if (process.isMainFrame) {
  let encoder, operation = null, stopped = false, sequence = 0;
  const close = () => { if (encoder && encoder.state !== 'closed') encoder.close(); };
  const onFrame = async (_event, packet) => {
    const reply = (result) => ipcRenderer.send('cwb-engine-vp8-encoded-v1', { sequence: packet?.sequence, ...result });
    if (stopped) return reply({ ok: false, reason: 'closed' });
    if (operation) return reply({ ok: false, reason: 'busy' });
    if (!packet || Array.isArray(packet) || !Number.isSafeInteger(packet.sequence) || packet.sequence <= sequence || packet.sequence > 2147483647
      || packet.timestamp !== packet.sequence * 100000 || !(packet.bgra instanceof Uint8Array) || packet.bgra.length !== 1440000) {
      return reply({ ok: false, reason: 'invalid-frame' });
    }
    sequence = packet.sequence;
    const current = { timestamp: packet.timestamp, outputs: 0, chunk: null, invalid: false }; operation = current;
    let frame; const started = performance.now();
    try {
      if (!encoder) {
        const config = { codec: 'vp8', width: 800, height: 450, bitrate: 5000000,
          framerate: 10, latencyMode: 'realtime', hardwareAcceleration: 'prefer-software' };
        if (typeof VideoEncoder !== 'function' || typeof VideoFrame !== 'function' || !(await VideoEncoder.isConfigSupported(config)).supported) throw Error('codec');
        // Stop may arrive while the support query is pending. Never allocate a late codec.
        if (stopped || operation !== current) throw Error('closed');
        encoder = new VideoEncoder({ output(chunk) {
          if (!operation || stopped) return;
          operation.outputs++;
          if (operation.outputs !== 1 || chunk.type !== 'key' || chunk.timestamp !== operation.timestamp
            || chunk.byteLength < 11 || chunk.byteLength > 2097152) { operation.invalid = true; return; }
          const bytes = new Uint8Array(chunk.byteLength); chunk.copyTo(bytes); operation.chunk = bytes;
        }, error() { if (operation) operation.invalid = true; } });
        encoder.configure(config);
      }
      if (stopped || encoder.state !== 'configured' || encoder.encodeQueueSize !== 0) throw Error('codec');
      frame = new VideoFrame(packet.bgra, { format: 'BGRA', codedWidth: 800, codedHeight: 450, timestamp: packet.timestamp, duration: 100000 });
      encoder.encode(frame, { keyFrame: true }); frame.close(); frame = null;
      await encoder.flush();
      if (stopped || current.invalid || current.outputs !== 1 || !current.chunk) throw Error('codec');
      reply({ ok: true, timestamp: packet.timestamp, vp8: current.chunk, encodeMs: performance.now() - started });
    } catch { stopped = true; close(); reply({ ok: false, reason: 'encode' }); }
    finally { frame?.close(); current.chunk = null; operation = null; }
  };
  const onStop = () => {
    stopped = true; close();
    ipcRenderer.removeListener('cwb-engine-vp8-frame-v1', onFrame); ipcRenderer.removeListener('cwb-engine-vp8-stop-v1', onStop);
  };
  ipcRenderer.on('cwb-engine-vp8-frame-v1', onFrame); ipcRenderer.on('cwb-engine-vp8-stop-v1', onStop);
}
