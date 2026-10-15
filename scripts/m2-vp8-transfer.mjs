// PoC-only all-keyframe VP8; bytes originate from trusted native capture, not authors.
export function validateSceneVp8Keyframe(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 11 || bytes.length > 2097152) throw Error('invalid scene VP8');
  const tag = bytes[0] | bytes[1] << 8 | bytes[2] << 16;
  if (tag & 1 || (tag >> 1 & 7) > 3 || !(tag & 16) || (tag >>> 5) < 1 || (tag >>> 5) + 10 > bytes.length
    || bytes[3] !== 157 || bytes[4] !== 1 || bytes[5] !== 42
    || (bytes[6] | bytes[7] << 8) !== 800 || (bytes[8] | bytes[9] << 8) !== 450) throw Error('invalid scene VP8 keyframe');
  return { width: 800, height: 450, bytes: bytes.length };
}

// Both functions are serialized into the verified host. No global API, scene
// scripts, arbitrary codec/config/URL, permissions or author postMessage listener.
export async function installVp8Receiver({ nonce, timeoutMs = 5000 }, validateKeyframe) {
  if (!/^[a-f0-9]{32}$/.test(nonce) || !Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 5000
    || typeof validateKeyframe !== 'function') throw Error('invalid encoded receiver identity');
  if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function') throw Error('VP8 decoder unavailable');
  const config = { codec: 'vp8', codedWidth: 800, codedHeight: 450, optimizeForLatency: true, hardwareAcceleration: 'prefer-software' };
  if (!(await VideoDecoder.isConfigSupported(config)).supported) throw Error('VP8 decoder unsupported');
  const id = 'cwb-m2-vp8-poc-' + nonce;
  if (document.getElementById(id)) throw Error('encoded receiver already exists');
  const root = document.createElement('div'); root.id = id;
  root.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:800px;height:480px;z-index:2147483647;pointer-events:none';
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 450;
  canvas.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:800px;height:450px;background:#000';
  const label = document.createElement('div'); label.hidden = true;
  label.style.cssText = 'all:initial;position:absolute;left:0;top:450px;width:800px;height:30px;background:#211b09;color:#ffe08a;font:14px sans-serif';
  root.append(canvas, label); document.body.append(root);
  const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
  if (!context) { root.remove(); throw Error('encoded pixel surface unavailable'); }
  const rgba = new Uint8ClampedArray(1440000), imageData = new ImageData(rgba, 800, 450);
  let phase = 'waiting', sequence = 0, accepted = 0, rejected = 0, busy = false, fallbackKind = null, pending;
  const closed = () => phase === 'failed' || phase === 'released';
  const reject = (reason) => { rejected++; return { ok: false, reason }; };
  const decoder = new VideoDecoder({
    output(frame) {
      if (!pending || closed()) { frame.close(); return; }
      pending.outputs++;
      if (pending.outputs !== 1 || frame.timestamp !== pending.timestamp || frame.displayWidth !== 800 || frame.displayHeight !== 450) {
        frame.close(); pending.invalid = true; return;
      }
      pending.frame = frame;
    },
    error() { if (pending) pending.invalid = true; },
  });
  try { decoder.configure(config); } catch { root.remove(); decoder.close(); throw Error('VP8 decoder configure failed'); }
  const closeDecoder = () => { if (decoder.state !== 'closed') decoder.close(); };
  const fail = (reason) => {
    if (phase === 'released') return;
    phase = 'failed'; fallbackKind = accepted ? 'last-real-frame' : 'empty';
    label.textContent = !accepted ? 'M2 PoC: no scene frame available'
      : reason === 'scene-failed' ? 'M2 PoC: scene failed; last real frame' : 'M2 PoC: source ended; last real frame';
    label.hidden = false; closeDecoder();
  };
  return {
    async accept(packet) {
      if (closed()) return reject('closed');
      if (!root.isConnected) return reject('detached');
      if (busy) return reject('busy');
      if (!packet || Array.isArray(packet) || !Number.isSafeInteger(packet.sequence)
        || packet.sequence < 1 || packet.sequence > 2147483647 || packet.timestamp !== packet.sequence * 100000
        || typeof packet.vp8 !== 'string' || packet.vp8.length > 2796204 || packet.vp8.length % 4
        || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.vp8)) return reject('invalid-frame');
      if (packet.sequence <= sequence) return reject('stale');
      let bytes;
      try {
        bytes = Uint8Array.from(atob(packet.vp8), (char) => char.charCodeAt(0));
        validateKeyframe(bytes);
      } catch { return reject('invalid-frame'); }
      busy = true; pending = { timestamp: packet.timestamp, outputs: 0, frame: null, invalid: false };
      const operation = pending, started = performance.now(); let timer;
      try {
        decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: packet.timestamp, duration: 100000, data: bytes }));
        const submitted = performance.now();
        const timeout = new Promise((_, rejectTimeout) => {
          timer = setTimeout(() => rejectTimeout(Error('bounded VP8 decode timeout')), timeoutMs);
        });
        await Promise.race([decoder.flush(), timeout]);
        if (closed()) return reject('closed');
        if (!root.isConnected) return reject('detached');
        if (operation.invalid || operation.outputs !== 1 || !operation.frame) throw Error('invalid decoded frame');
        const flushed = performance.now();
        // Avoid the measured ~9s first GPU YUV VideoFrame draw. Copy fixed RGBA
        // pixels and commit a CPU-backed ImageData only after decode validation.
        await Promise.race([operation.frame.copyTo(rgba, { format: 'RGBA', rect: { x: 0, y: 0, width: 800, height: 450 } }), timeout]);
        const copied = performance.now();
        if (closed()) return reject('closed');
        if (!root.isConnected) return reject('detached');
        let nonblack = 0;
        for (let i = 0; i < rgba.length; i += 4) if (rgba[i] + rgba[i + 1] + rgba[i + 2] > 30) nonblack++;
        if (nonblack <= 18000) throw Error('black decoded scene pixels');
        // No clear: failed / late / black output cannot erase a committed surface.
        context.putImageData(imageData, 0, 0);
        const drawn = performance.now();
        sequence = packet.sequence; accepted++; phase = 'ready';
        return { ok: true, sequence, decodeMs: performance.now() - started,
          submitMs: submitted - started, flushMs: flushed - submitted, copyMs: copied - flushed, drawMs: drawn - copied };
      } catch { if (!closed()) fail('scene-failed'); return reject('decode'); }
      finally { clearTimeout(timer); operation.frame?.close(); pending = null; busy = false; }
    },
    fail,
    stats() { return { phase, sequence, accepted, rejected, pending: busy ? 1 : 0,
      decoderState: decoder.state, fallbackKind, failureLabelVisible: !label.hidden, removed: !root.isConnected }; },
    rect() { const r = canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; },
    release() { phase = 'released'; closeDecoder(); root.remove(); },
  };
}
