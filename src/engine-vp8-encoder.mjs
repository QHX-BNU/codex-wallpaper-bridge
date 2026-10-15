import { validateEngineVp8Frame } from '../bridge-runtime/src/engine-vp8-frame.mjs';

const FRAME = 'cwb-engine-vp8-frame-v1', ENCODED = 'cwb-engine-vp8-encoded-v1', STOP = 'cwb-engine-vp8-stop-v1';
const error = (reason) => Error(reason);

/** Only the parent's native captures enter this isolated preload. Replies from
 * authors/subframes/wrong documents are ignored. No public renderer API exists.
 */
export function bindEngineVp8Encoder({ ipcMain, webContents, nativeImage, wrapperUrl, timeoutMs = 5000 }) {
  const url = new URL(wrapperUrl);
  if (!ipcMain?.on || !ipcMain.removeListener || !webContents?.send || !webContents.on || !webContents.removeListener
    || !nativeImage?.createFromBuffer || url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port
    || url.username || url.password || url.search || url.hash || !/^\/[a-f0-9]{32}(?:\/codec)?$/.test(url.pathname)
    || !Number.isFinite(timeoutMs) || timeoutMs < 10 || timeoutMs > 5000) throw TypeError('invalid native encoder');
  let closed = false, busy = false, pending = null, sequence = 0, lastRaw = null, lastEncoded = null, duplicates = 0;
  const owned = (event) => {
    try { return !closed && !webContents.isDestroyed() && event?.sender === webContents
      && event.senderFrame === webContents.mainFrame && event.senderFrame.url === wrapperUrl && webContents.getURL() === wrapperUrl; }
    catch { return false; }
  };
  function close(reason = error('engine_encoder_closed')) {
    if (closed) return;
    closed = true;
    ipcMain.removeListener(ENCODED, receive);
    webContents.removeListener('destroyed', onGone); webContents.removeListener('render-process-gone', onGone);
    if (pending) { clearTimeout(pending.timer); pending.reject(reason); pending = null; }
    lastRaw = null; lastEncoded = null;
    try { if (!webContents.isDestroyed()) webContents.send(STOP); } catch {}
  }
  function receive(event, packet) {
    if (!owned(event) || !pending || packet?.sequence !== pending.sequence) return;
    const waiter = pending;
    try {
      if (packet.ok !== true || packet.timestamp !== waiter.sequence * 100000
        || !Number.isFinite(packet.encodeMs) || packet.encodeMs < 0 || packet.encodeMs > 60000) throw error('engine_encode_failed');
      const frame = validateEngineVp8Frame({ ...packet, width: 800, height: 450 });
      clearTimeout(waiter.timer); pending = null; waiter.resolve(frame);
    } catch { close(error('engine_encode_failed')); }
  }
  const onGone = () => close();
  ipcMain.on(ENCODED, receive); webContents.on('destroyed', onGone); webContents.on('render-process-gone', onGone);
  return {
    async encode(frame) {
      if (closed) throw error('engine_encoder_closed');
      if (busy) throw error('engine_encoder_busy');
      busy = true;
      try {
        if (!frame || frame.width !== 800 || frame.height !== 450
          || !Number.isSafeInteger(frame.sequence) || frame.sequence <= sequence || frame.sequence > 2147483647) throw error('invalid_native_frame');
        let raw;
        if (frame.bgra !== undefined) {
          if (frame.png !== undefined || !(frame.bgra instanceof Uint8Array) || frame.bgra.length !== 1440000) throw error('invalid_native_frame');
          raw = Buffer.from(frame.bgra);
        } else {
          const png = frame.png;
          if (!(png instanceof Uint8Array) || png.length < 33 || png.length > 2097152) throw error('invalid_native_frame');
          const bytes = Buffer.from(png);
          if (!bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex')) || bytes.readUInt32BE(8) !== 13
            || bytes.toString('ascii', 12, 16) !== 'IHDR' || bytes.readUInt32BE(16) !== 800 || bytes.readUInt32BE(20) !== 450) throw error('invalid_native_frame');
          const native = nativeImage.createFromBuffer(bytes), size = native.getSize();
          if (native.isEmpty() || size.width !== 800 || size.height !== 450) throw error('invalid_native_frame');
          raw = Buffer.from(native.toBitmap()); if (raw.length !== 1440000) throw error('invalid_native_frame');
        }
        sequence = frame.sequence;
        if (lastRaw && lastEncoded && raw.equals(lastRaw)) {
          duplicates++; return { ...validateEngineVp8Frame({ ...lastEncoded, sequence, timestamp: sequence * 100000 }), duplicate: true };
        }
        const encoded = await new Promise((resolve, reject) => {
          const timer = setTimeout(() => close(error('engine_encode_timeout')), timeoutMs);
          pending = { sequence, timer, resolve, reject };
          try { webContents.send(FRAME, { sequence, timestamp: sequence * 100000, bgra: raw }); }
          catch { close(); }
        });
        if (closed) throw error('engine_encoder_closed');
        lastRaw = raw; lastEncoded = encoded;
        return { ...validateEngineVp8Frame(encoded), duplicate: false };
      } finally { busy = false; }
    },
    close,
    status: () => ({ closed, pending: pending ? 1 : 0, cachedBytes: (lastRaw?.length ?? 0) + (lastEncoded?.vp8.length ?? 0), duplicates }),
  };
}
