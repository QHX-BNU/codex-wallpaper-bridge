// PoC only: pixel data, never scene HTML, script, author telemetry or arbitrary URLs.
export function validateScenePng(bytes) {
  const magic = [137, 80, 78, 71, 13, 10, 26, 10];
  if (!(bytes instanceof Uint8Array) || bytes.length < 33 || bytes.length > 2097152
    || magic.some((value, index) => bytes[index] !== value)
    || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
    || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') throw Error('invalid scene PNG');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(16) !== 800 || view.getUint32(20) !== 450) throw Error('invalid scene PNG dimensions');
  return { width: 800, height: 450, bytes: bytes.length };
}

export function normalizeSceneCapture(image) {
  const png = image.resize({ width: 800, height: 450, quality: 'best' }).toPNG();
  validateScenePng(png);
  return png;
}

export function carrierPerformanceGate(stream) {
  return { passed: Number.isFinite(stream?.deliveredFps) && stream.deliveredFps >= 4
    && Number.isFinite(stream?.captureToAckMs?.p95) && stream.captureToAckMs.p95 < 750
    && Number.isFinite(stream?.durationMs) && stream.durationMs >= 6000,
  minimumFps: 4, maximumP95MsExclusive: 750, minimumDurationMs: 6000 };
}

// Serialized into the verified initial app renderer. Returned only as a CDP object
// handle: no window API, postMessage receiver, author-controlled code or URL.
export function installFrameReceiver({ nonce, carrier = 'blob' }) {
  if (!/^[a-f0-9]{32}$/.test(nonce)) throw Error('invalid receiver identity');
  if (!['blob', 'data'].includes(carrier)) throw Error('invalid image carrier');
  const id = 'cwb-m2-frame-poc-' + nonce;
  if (document.getElementById(id)) throw Error('receiver already exists');
  const root = document.createElement('div'); root.id = id;
  root.style.cssText = 'all:initial;position:fixed;left:0;top:0;width:800px;height:480px;z-index:2147483647;pointer-events:none';
  const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 450;
  canvas.style.cssText = 'all:initial;position:absolute;left:0;top:0;width:800px;height:450px;background:#000';
  const label = document.createElement('div'); label.hidden = true;
  label.style.cssText = 'all:initial;position:absolute;left:0;top:450px;width:800px;height:30px;background:#211b09;color:#ffe08a;font:14px sans-serif';
  root.append(canvas, label); document.body.append(root);
  const context = canvas.getContext('2d', { alpha: false });
  if (!context) { root.remove(); throw Error('pixel surface unavailable'); }
  let phase = 'waiting', sequence = 0, accepted = 0, rejected = 0, busy = false;
  let fallbackKind = null;
  let pendingImage;
  const blobs = new Set();
  const revoke = (url) => { if (blobs.delete(url)) URL.revokeObjectURL(url); };
  const reject = (reason) => { rejected++; return { ok: false, reason }; };
  const closed = () => phase === 'released' || phase === 'failed';
  return {
    async accept(packet) {
      if (closed()) return reject('closed');
      if (!root.isConnected) return reject('detached');
      if (busy) return reject('busy');
      if (!packet || Array.isArray(packet) || !Number.isSafeInteger(packet.sequence)
        || packet.sequence < 1 || packet.sequence > 2147483647 || typeof packet.png !== 'string'
        || packet.png.length > 2796204 || packet.png.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.png)) return reject('invalid-frame');
      if (packet.sequence <= sequence) return reject('stale');
      let bytes;
      try {
        const byteLength = packet.png.length * 3 / 4 - (packet.png.endsWith('==') ? 2 : packet.png.endsWith('=') ? 1 : 0);
        if (byteLength < 33 || byteLength > 2097152) return reject('invalid-frame');
        // The decoder validates the complete image. For data URLs, inspect only
        // the bounded binary header; do not expand every base64 byte in JS.
        const raw = atob(carrier === 'data' ? packet.png.slice(0, 44) : packet.png);
        bytes = Uint8Array.from(raw, (char) => char.charCodeAt(0));
        const magic = [137, 80, 78, 71, 13, 10, 26, 10];
        if (bytes.length < 33 || bytes.length > 2097152 || magic.some((value, index) => bytes[index] !== value)
          || bytes[8] !== 0 || bytes[9] !== 0 || bytes[10] !== 0 || bytes[11] !== 13
          || String.fromCharCode(...bytes.subarray(12, 16)) !== 'IHDR') return reject('invalid-frame');
        const view = new DataView(bytes.buffer);
        if (view.getUint32(16) !== 800 || view.getUint32(20) !== 450) return reject('invalid-frame');
      } catch { return reject('invalid-frame'); }
      busy = true;
      let url;
      const started = performance.now();
      try {
        const image = new Image(); pendingImage = image;
        image.decoding = 'sync'; image.loading = 'eager'; image.fetchPriority = 'high';
        if (carrier === 'blob') { url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' })); blobs.add(url); }
        image.src = carrier === 'data' ? 'data:image/png;base64,' + packet.png : url;
        await image.decode();
        if (closed()) return reject('closed');
        if (!root.isConnected) return reject('detached');
        if (image.naturalWidth !== 800 || image.naturalHeight !== 450) return reject('invalid-frame');
        // No clear: failed / late / undecodable frames never erase committed pixels.
        context.drawImage(image, 0, 0, 800, 450);
        sequence = packet.sequence; accepted++; phase = 'ready';
        return { ok: true, sequence, decodeMs: performance.now() - started };
      } catch { return reject(closed() ? 'closed' : 'decode'); }
      finally { if (url) revoke(url); pendingImage = null; busy = false; }
    },
    fail(reason) {
      if (phase === 'released') return;
      phase = 'failed'; fallbackKind = accepted ? 'last-real-frame' : 'empty';
      label.textContent = reason === 'scene-failed' ? 'M2 PoC: scene failed; last real frame' : 'M2 PoC: source ended; last real frame';
      if (!accepted) label.textContent = 'M2 PoC: no scene frame available';
      label.hidden = false;
      if (pendingImage) pendingImage.src = '';
      for (const url of blobs) revoke(url);
    },
    stats() { return { phase, sequence, accepted, rejected, pending: busy ? 1 : 0,
      liveBlobs: blobs.size, fallbackKind, failureLabelVisible: !label.hidden, removed: !root.isConnected }; },
    rect() { const r = canvas.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, scale: 1 }; },
    release() {
      phase = 'released'; root.remove(); if (pendingImage) pendingImage.src = '';
      for (const url of blobs) revoke(url);
    },
  };
}
