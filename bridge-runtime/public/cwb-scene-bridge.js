/* Trusted adapter on the dedicated readonly scene origin; never contains the control capability. */
(() => {
  'use strict';
  const session = document.querySelector('meta[name="cwb-scene-session"]')?.content;
  if (!/^[a-f0-9]{32}$/.test(session ?? '')) return;
  let draws = 0;
  // FPS needs a second frame and an idle scene may render only once. Count actual
  // WebGL submits before the async engine mount, rather than treating iframe load as ready.
  const patches = [];
  const audioElements = new Set();
  const mediaProto = window.HTMLMediaElement?.prototype;
  if (mediaProto && typeof mediaProto.play === 'function') {
    const original = mediaProto.play;
    const wrapped = function (...args) {
      if (this.tagName === 'AUDIO' && audioElements.size < 128) audioElements.add(this);
      return original.apply(this, args);
    };
    mediaProto.play = wrapped;
    patches.push(() => { if (mediaProto.play === wrapped) mediaProto.play = original; audioElements.clear(); });
  }
  for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    for (const method of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const proto = type?.prototype;
      if (!proto || !Object.hasOwn(proto, method) || typeof proto[method] !== 'function') continue;
      const original = proto[method];
      const wrapped = function (...args) { const value = original.apply(this, args); draws = Math.min(1e9, draws + 1); return value; };
      proto[method] = wrapped;
      patches.push(() => { if (proto[method] === wrapped) proto[method] = original; });
    }
  }
  void fetch(`/${session}/bridge-config.json`).then((response) => {
    if (!response.ok) throw new Error('scene-bridge-config');
    return response.json();
  }).then(({ parentOrigin, channel, firstFrameTimeoutMs, authorProperties = { schema: {}, values: {} } }) => {
    let sequence = 0;
    let phase = 'loading';
    let timer;
    let released = false;
    let propertyRevision = 0;
    let volume = 0;
    let audioBridgeInstalled = false, audioReceived = 0;
    const silence = () => ({ left: Array(64).fill(0), right: Array(64).fill(0) });
    let audioSnapshot = silence();
    const installAudioBridge = () => {
      if (audioBridgeInstalled || typeof window.__wp?.setAudioBridge !== 'function') return;
      // The pinned engine's host bridge suppresses its simulated FFT fallback.
      // Empty/disabled sources are silence, not synthetic system audio.
      window.__wp.setAudioBridge(() => audioSnapshot); audioBridgeInstalled = true;
    };
    let pointerInFlight = false;
    let pointerAccepted = 0, pointerDelivered = 0;
    let pointerAcknowledged = 0, renderCompletions = 0;
    const pointerQueue = [];
    const startedAt = performance.now();
    const snapshot = () => {
      const meter = window.__wpStats?.frame?.() ?? {};
      const canvas = document.querySelector('canvas');
      const readback = window.__cwbReadProperties?.(authorProperties.schema, window.__wp?.getProperties?.(), window.__cwbValidateProperties)
        ?? { values: {}, rejected: 0 };
      return { fps: Number.isFinite(meter.fps) ? Math.max(0, Math.min(240, meter.fps)) : 0,
        running: meter.running === true, idle: meter.idle === true, draws,
        paused: window.__wp?.getState?.().paused === true,
        layers: Math.min(10000, window.__sceneLayers?.length ?? 0),
        width: canvas?.width ?? 0, height: canvas?.height ?? 0, volume, propertyRevision,
        pendingPointers: pointerQueue.length, pointerAccepted, pointerDelivered, pointerAcknowledged, renderCompletions,
        systemAudio: { attached: audioBridgeInstalled, received: audioReceived },
        audio: { elements: audioElements.size, ready: [...audioElements].filter((audio) => audio.readyState >= 2).length,
          playing: [...audioElements].filter((audio) => !audio.paused && !audio.ended).length,
          time: Math.round([...audioElements].reduce((time, audio) => time + (Number.isFinite(audio.currentTime) ? audio.currentTime : 0), 0) * 1000) / 1000 },
        properties: readback.values, propertyReadbackRejected: readback.rejected };
    };
    const cancelPointers = () => {
      pointerInFlight = false; pointerQueue.length = 0;
    };
    const pumpPointer = () => {
      if (phase !== 'ready' || window.__wp?.getState?.().paused === true) { cancelPointers(); return; }
      // A GL submission is before cursor dispatch. Only the pinned engine's
      // exact post-dispatch/beginFrame callback may consume an in-flight transition.
      if (pointerQueue.length && !pointerInFlight) {
        const value = pointerQueue.shift();
        pointerInFlight = true;
        window.__wp?.pushPointer?.(value.u, value.v, value.buttons, value.mods);
        pointerDelivered = Math.min(1e9, pointerDelivered + 1);
        publish();
      }
    };
    const previousComplete = window.__cwbSceneRenderComplete;
    const onRenderComplete = () => {
      if (released || phase === 'failed' || phase === 'released') return;
      renderCompletions = Math.min(1e9, renderCompletions + 1);
      if (pointerInFlight) {
        pointerAcknowledged = Math.min(1e9, pointerAcknowledged + 1); pointerInFlight = false;
        pumpPointer(); publish();
      }
    };
    window.__cwbSceneRenderComplete = onRenderComplete;
    patches.push(() => {
      if (window.__cwbSceneRenderComplete === onRenderComplete) {
        if (previousComplete === undefined) delete window.__cwbSceneRenderComplete;
        else window.__cwbSceneRenderComplete = previousComplete;
      }
    });
    const cleanup = () => {
      audioSnapshot = silence(); if (audioBridgeInstalled) window.__wp?.setAudioBridge?.(null); audioBridgeInstalled = false;
      clearInterval(timer);
      cancelPointers();
      window.removeEventListener('message', onMessage);
      for (const restore of patches) restore();
      if (!released) { released = true; window.__wp?.release?.(); }
    };
    const publish = (propertyRequest) => {
      const state = snapshot();
      if (phase === 'loading') {
        if (window.__scene && state.layers > 0 && state.draws > 0 && state.width > 0 && state.height > 0) {
          phase = 'ready';
          window.__wp?.updateWebProps?.(Object.fromEntries(Object.entries(authorProperties.values).map(([key, value]) => [key, { value }])));
        }
        else if (performance.now() - startedAt > firstFrameTimeoutMs) {
          phase = 'failed'; cleanup();
        }
      }
      if (phase === 'ready') installAudioBridge();
      const message = { source: 'cwb-scene', channel, sequence: ++sequence, phase, ...snapshot() };
      if (Number.isSafeInteger(propertyRequest) && propertyRequest > 0) message.propertyRequest = propertyRequest;
      window.__cwbScene = Object.freeze(message);
      if (parentOrigin && window.parent !== window) window.parent.postMessage(message, parentOrigin);
      if (phase === 'failed' || phase === 'released') clearInterval(timer);
    };
    const onMessage = (event) => {
      const message = event.data;
      if (!parentOrigin || event.origin !== parentOrigin || event.source !== window.parent
        || message?.source !== 'cwb-scene-control' || message.channel !== channel) return;
      if (phase === 'failed' || phase === 'released') return;
      let propertyRequest;
      if (message.op === 'pause') { audioSnapshot = silence(); cancelPointers(); window.__wp?.pointerLeave?.(); window.__wp?.pause?.(); }
      else if (message.op === 'resume') window.__wp?.resume?.();
      else if (message.op === 'release') { phase = 'released'; cleanup(); }
      else if (message.op === 'audio' && phase === 'ready') {
        if (window.__wp?.getState?.().paused === true) return;
        let input; try { input = window.__cwbValidateWebInput?.({ op: 'audio', values: message.values }); } catch { return; }
        if (!input) return;
        audioSnapshot = { left: input.values.slice(0, 64), right: input.values.slice(64) };
        installAudioBridge(); audioReceived = Math.min(1e9, audioReceived + 1);
      }
      else if (message.op === 'pointer' && phase === 'ready') {
        const { u, v, buttons = 0, mods = 0 } = message;
        if (![u, v].every((n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 1)
          || ![0, 1].includes(buttons) || !Number.isInteger(mods) || mods < 0 || mods > 15) return;
        if (window.__wp?.getState?.().paused === true) return;
        pointerAccepted = Math.min(1e9, pointerAccepted + 1);
        const last = pointerQueue.at(-1);
        if (last?.buttons === buttons) pointerQueue[pointerQueue.length - 1] = { u, v, buttons, mods };
        else if (pointerQueue.length < 64) pointerQueue.push({ u, v, buttons, mods });
        else { phase = 'failed'; cleanup(); publish(); return; }
        pumpPointer();
      }
      else if (message.op === 'pointerLeave' && phase === 'ready') { cancelPointers(); window.__wp?.pointerLeave?.(); }
      else if (message.op === 'volume' && phase === 'ready') {
        if (typeof message.value !== 'number' || !Number.isFinite(message.value) || message.value < 0 || message.value > 1) return;
        window.__wp?.setVolume?.(message.value); volume = message.value;
      }
      else if (message.op === 'fit' && phase === 'ready') {
        if (!['cover', 'contain', 'fill'].includes(message.value)) return;
        window.__wp?.setFit?.(message.value);
      }
      else if (['properties', 'resetProperties'].includes(message.op) && phase === 'ready') {
        if (Object.hasOwn(message, 'propertyRequest')
          && (!Number.isSafeInteger(message.propertyRequest) || message.propertyRequest <= 0)) return;
        const patch = window.__cwbValidateProperties?.(authorProperties.schema,
          message.op === 'resetProperties' ? authorProperties.values : message.values);
        if (!patch) return;
        window.__wp?.updateWebProps?.(Object.fromEntries(Object.entries(patch).map(([key, value]) => [key, { value }])));
        propertyRevision++;
        propertyRequest = message.propertyRequest;
      }
      else if (message.op === 'readProperties' && phase === 'ready') {
        if (!Number.isSafeInteger(message.propertyRequest) || message.propertyRequest <= 0) return;
        propertyRequest = message.propertyRequest;
      }
      else return;
      publish(propertyRequest);
    };
    window.addEventListener('message', onMessage);
    window.addEventListener('pagehide', () => {
      cleanup();
    }, { once: true });
    timer = setInterval(publish, 250);
    publish();
  }).catch(() => {
    for (const restore of patches) restore();
    window.__wp?.release?.();
    window.__cwbScene = Object.freeze({ phase: 'failed', reason: 'scene-bridge-config' });
  });
})();
