/** Serialized into the host by CDP. Authors never share this origin or receive
 * this controller. Its one-shot remote handle is the only encoded pixel input.
 */
export function createEngineMediaTransport(playback = null) {
  // CDP also supports this adapter alone, without module-scope imports. The
  // normal bootstrap passes the shared policy; this fallback has the same gate.
  playback ||= (effects = {}, environment = {}) => ({ playing: effects.playing !== false
    && !(environment.hidden === true && effects.pauseWhenHidden !== false)
    && !(effects.onBattery === true && effects.pauseOnBattery === true) });
  const slots = new Map();
  const liveSlots = new Set();
  let closed = false;
  const config = { codec: 'vp8', codedWidth: 800, codedHeight: 450, optimizeForLatency: true, hardwareAcceleration: 'prefer-software' };
  const reject = (reason) => ({ ok: false, reason });
  const pointerListeners = new Map();
  function create({ wallpaper, effects }) {
    const key = wallpaper.id;
    if (closed || typeof key !== 'string' || (slots.has(key) && !slots.get(key).retryRequested) || liveSlots.size >= 2) throw Error('native_slot_capacity');
    const node = document.createElement('div'), canvas = document.createElement('canvas'), label = document.createElement('div');
    node.style.cssText = 'position:absolute;inset:0;overflow:hidden;pointer-events:none';
    node.dataset.cwbNative = wallpaper.type || 'scene'; node.style.opacity = '0';
    canvas.width = 800; canvas.height = 450;
    canvas.style.cssText = 'display:block;width:100%;height:100%';
    label.hidden = true; label.style.cssText = 'position:absolute;bottom:8px;left:8px;color:#ffe08a;background:#211b09;font:12px sans-serif;padding:4px';
    node.append(canvas, label);
    const context = canvas.getContext('2d', { alpha: false, willReadFrequently: true });
    if (!context) throw Error('native_canvas_unavailable');
    let resolveReady, rejectReady;
    const ready = new Promise((resolve, rejectPromise) => { resolveReady = resolve; rejectReady = rejectPromise; });
    ready.catch(() => {});
    const slot = { key, node, canvas, label, context, ready, resolveReady, rejectReady, effects,
      committed: false, released: false, failed: false, retryRequested: false, sequence: 0, accepted: 0, busy: false,
      decoder: null, configuring: null, pending: null, pointer: [], fallback: null,
      rgba: new Uint8ClampedArray(1440000), image: null,
      update(value) {
        this.effects = value.effects;
        canvas.style.objectFit = value.effects.fit || 'cover'; canvas.style.objectPosition = value.effects.position || '50% 50%';
        canvas.style.transform = 'scale(' + ((value.effects.zoom ?? 100) / 100) + ') scaleX(' + (value.effects.mirror ? -1 : 1) + ')';
        canvas.style.transformOrigin = value.effects.position || '50% 50%';
      },
      activate() { this.committed = true; node.style.removeProperty('opacity'); },
      retire() { this.committed = false; this.pointer.length = 0; },
      release() {
        if (this.released) return;
        this.released = true; this.committed = false; this.pointer.length = 0;
        this.rejectReady(Error('native_slot_cancelled'));
        this.pending?.rejectOutput(Error('native_slot_cancelled'));
        if (this.decoder?.state !== 'closed') this.decoder?.close();
        liveSlots.delete(this);
        if (slots.get(key) === this) {
          const previous = [...liveSlots].find((candidate) => candidate.key === key);
          if (previous) slots.set(key, previous); else slots.delete(key);
        }
        node.remove(); this.rgba = null; this.image = null;
      },
    };
    slot.image = new ImageData(slot.rgba, 800, 450); slot.update({ effects }); slots.set(key, slot); liveSlots.add(slot);
    return slot;
  }
  function fail(key) {
    const slot = slots.get(key); if (!slot || slot.released || slot.failed) return;
    slot.failed = true; slot.fallback = slot.accepted ? 'last-real-frame' : 'empty';
    slot.label.textContent = slot.accepted ? '场景已停止，保留最后真实画面' : '场景不可用'; slot.label.hidden = false;
    slot.rejectReady(Error('native_source_failed'));
    slot.pending?.rejectOutput(Error('native_source_failed'));
    if (slot.decoder?.state !== 'closed') slot.decoder?.close();
  }
  function packetBytes(packet) {
    if (!packet || Array.isArray(packet) || Object.keys(packet).length !== 3
      || !['sequence', 'timestamp', 'vp8'].every((key) => Object.hasOwn(packet, key))
      || !Number.isSafeInteger(packet.sequence) || packet.sequence < 1 || packet.sequence > 2147483647
      || packet.timestamp !== packet.sequence * 100000 || typeof packet.vp8 !== 'string'
      || packet.vp8.length > 2796204 || packet.vp8.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(packet.vp8)) throw Error('invalid_frame');
    const bytes = Uint8Array.from(atob(packet.vp8), (value) => value.charCodeAt(0));
    if (bytes.length < 11 || bytes.length > 2097152) throw Error('invalid_frame');
    const tag = bytes[0] | bytes[1] << 8 | bytes[2] << 16;
    if (tag & 1 || (tag >> 1 & 7) > 3 || !(tag & 16) || (tag >>> 5) < 1 || (tag >>> 5) + 10 > bytes.length
      || bytes[3] !== 157 || bytes[4] !== 1 || bytes[5] !== 42
      || (bytes[6] | bytes[7] << 8) !== 800 || (bytes[8] | bytes[9] << 8) !== 450) throw Error('invalid_frame');
    return bytes;
  }
  async function configure(slot) {
    if (slot.configuring) return slot.configuring;
    slot.configuring = (async () => {
      if (typeof VideoDecoder !== 'function' || typeof EncodedVideoChunk !== 'function'
        || !(await VideoDecoder.isConfigSupported(config)).supported) throw Error('decoder_unavailable');
      if (closed || slot.released || slot.failed) throw Error('closed');
      slot.decoder = new VideoDecoder({
        output(frame) {
          const pending = slot.pending;
          if (!pending || slot.released || slot.failed) { frame.close(); return; }
          pending.outputs = Math.min(8, pending.outputs + 1);
          pending.timestampMatched = frame.timestamp === pending.timestamp;
          pending.dimensionsMatched = frame.displayWidth === 800 && frame.displayHeight === 450;
          if (pending.frame || !pending.timestampMatched || !pending.dimensionsMatched) {
            pending.signal = pending.frame ? 'duplicate-output' : !pending.timestampMatched ? 'timestamp-mismatch' : 'dimension-mismatch';
            frame.close(); pending.invalid = true; pending.rejectOutput(Error('invalid_decode')); return;
          }
          pending.frame = frame; pending.resolveOutput();
        },
        error(error) { if (slot.pending) {
          slot.pending.invalid = true; slot.pending.signal = 'decoder-error';
          slot.pending.errorKind = ['TypeError', 'ReferenceError', 'NotSupportedError', 'InvalidStateError', 'DataError', 'SecurityError', 'AbortError'].includes(error?.name) ? error.name : 'Unknown';
          slot.pending.rejectOutput(Error('invalid_decode'));
        } },
      });
      slot.decoder.configure(config);
    })();
    return slot.configuring;
  }
  async function accept(key, packet) {
    const slot = slots.get(key);
    if (closed || !slot || slot.released) return reject('missing');
    if (slot.failed) return reject('failed');
    if (slot.accepted && !playback(slot.effects, { hidden: document.hidden === true }).playing) return { ...reject('paused'), state: state(key) };
    if (!slot.node.isConnected) return reject('detached');
    if (slot.busy) return reject('busy');
    let bytes; try { bytes = packetBytes(packet); } catch { return reject('invalid-frame'); }
    if (packet.sequence <= slot.sequence) return reject('stale');
    slot.busy = true; let timer, failureStage = 'configure';
    const operation = { timestamp: packet.timestamp, frame: null, invalid: false, outputs: 0,
      signal: 'none', timestampMatched: null, dimensionsMatched: null, errorKind: null };
    operation.output = new Promise((resolve, rejectOutput) => { operation.resolveOutput = resolve; operation.rejectOutput = rejectOutput; });
    operation.output.catch(() => {});
    const alive = () => !closed && !slot.released && !slot.failed && slots.get(key) === slot && slot.node.isConnected;
    const started = performance.now();
    try {
      const timeout = new Promise((_, rejectTimeout) => { timer = setTimeout(() => rejectTimeout(Error('decode_timeout')), 5000); });
      await Promise.race([configure(slot), timeout]); if (!alive()) return reject('closed');
      failureStage = 'decode';
      slot.pending = operation;
      slot.decoder.decode(new EncodedVideoChunk({ type: 'key', timestamp: packet.timestamp, duration: 100000, data: bytes }));
      // A live stream needs one genuine, matching output, not a flush barrier
      // after every keyframe. Keep the same deadline and single pending frame.
      failureStage = 'output';
      await Promise.race([operation.output, timeout]);
      if (!alive()) return reject('closed');
      if (operation.invalid || !operation.frame) throw Error('invalid_decode');
      failureStage = 'copy';
      await Promise.race([operation.frame.copyTo(slot.rgba, { format: 'RGBA', rect: { x: 0, y: 0, width: 800, height: 450 } }), timeout]);
      if (!alive()) return reject('closed');
      if (slot.accepted && !playback(slot.effects, { hidden: document.hidden === true }).playing) return { ...reject('paused'), state: state(key) };
      // All-black can be a legitimate author frame. Readiness is native-owner
      // provenance plus successful fixed-size decode, not a brightness heuristic.
      failureStage = 'draw';
      slot.context.putImageData(slot.image, 0, 0);
      slot.sequence = packet.sequence; slot.accepted++; slot.resolveReady();
      slot.node.dataset.cwbSequence = String(slot.sequence);
      return { ok: true, sequence: slot.sequence, decodeMs: performance.now() - started, state: state(key) };
    } catch (error) {
      // M1 release explicitly rejects the pending output and closes its
      // decoder. This is receiver retirement, not a source decode failure.
      // Do not use !alive(): a real source failure also makes alive() false.
      if (closed || slot.released) return reject('closed');
      const failureKind = operation.errorKind || (error?.message === 'decode_timeout' ? 'Timeout'
        : ['TypeError', 'ReferenceError', 'NotSupportedError', 'InvalidStateError', 'DataError', 'SecurityError', 'AbortError'].includes(error?.name) ? error.name : 'Unknown');
      const diagnostic = {
        signal: error?.message === 'decode_timeout' ? 'timeout' : ['native_slot_cancelled', 'native_source_failed'].includes(error?.message) ? 'cancelled' : operation.signal,
        decoderState: ['unconfigured', 'configured', 'closed'].includes(slot.decoder?.state) ? slot.decoder.state : null,
        queueSize: Number.isInteger(slot.decoder?.decodeQueueSize) && slot.decoder.decodeQueueSize >= 0 && slot.decoder.decodeQueueSize <= 64 ? slot.decoder.decodeQueueSize : null,
        documentHidden: document.hidden === true, outputs: operation.outputs,
        timestampMatched: operation.timestampMatched, dimensionsMatched: operation.dimensionsMatched,
      };
      if (alive()) {
        slot.node.dataset.cwbFailureStage = failureStage; slot.node.dataset.cwbFailureKind = failureKind;
        fail(key);
      }
      return { ...reject('decode'), failureStage, failureKind, diagnostic };
    }
    finally { clearTimeout(timer); operation.frame?.close(); slot.pending = null; slot.busy = false; }
  }
  function state(key) {
    const slot = slots.get(key); if (!slot || !slot.node.isConnected) return { present: false };
    const playing = playback(slot.effects, { hidden: document.hidden === true }).playing;
    return { present: true, playing, committed: slot.committed, failed: slot.failed, retryRequested: slot.retryRequested,
      volume: slot.committed && playing && slot.effects.audioEnabled ? Math.max(0, Math.min(1, (slot.effects.volume ?? 50) / 100)) : 0,
      pointer: slot.pointer.splice(0, 64), sequence: slot.sequence, accepted: slot.accepted, fallback: slot.fallback };
  }
  const pointer = (event) => {
    for (const slot of slots.values()) {
      if (!slot.committed || slot.released || slot.failed || !playback(slot.effects).playing || document.hidden) continue;
      const rect = slot.canvas.getBoundingClientRect(); if (!rect.width || !rect.height) continue;
      const value = { u: Math.max(0, Math.min(1, (event.clientX - rect.x) / rect.width)),
        v: Math.max(0, Math.min(1, (event.clientY - rect.y) / rect.height)), buttons: event.buttons & 1,
        mods: Number(Boolean(event.shiftKey)) + Number(Boolean(event.ctrlKey)) * 2 + Number(Boolean(event.altKey)) * 4 + Number(Boolean(event.metaKey)) * 8 };
      const last = slot.pointer.at(-1);
      if (last?.buttons === value.buttons) slot.pointer[slot.pointer.length - 1] = value;
      else if (slot.pointer.length < 64) slot.pointer.push(value);
      else fail([...slots].find(([, candidate]) => candidate === slot)[0]);
    }
  };
  for (const event of ['pointermove', 'pointerdown', 'pointerup']) {
    pointerListeners.set(event, pointer); addEventListener(event, pointer, { passive: true, capture: true });
  }
  return { create, accept, fail, state,
    retry(key) { const slot = slots.get(key); if (!slot?.failed || slot.released) return false; slot.retryRequested = true; return true; },
    close() {
      if (closed) return; closed = true;
      for (const slot of [...liveSlots]) slot.release();
      for (const [event, listener] of pointerListeners) removeEventListener(event, listener, { capture: true });
      pointerListeners.clear();
    },
  };
}
