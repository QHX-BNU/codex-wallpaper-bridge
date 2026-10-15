import { validateEngineVp8Frame } from './engine-vp8-frame.mjs';

/** Native resource leases and data delivery only. Selection/commit/transition
 * stay in the existing renderer M1 switcher. Two sources are shared by targets.
 */
export class NativeEngineDelivery {
  #provider;
  #sources = new Map();
  #failures = new Set();
  #closed = false;
  #interval;
  #onFailure;
  #onReceiverLost;
  constructor({ provider, intervalMs = 30, onFailure = () => {}, onReceiverLost = () => {} }) {
    if (typeof provider?.create !== 'function' || !Number.isFinite(intervalMs) || intervalMs < 10 || intervalMs > 1000) throw TypeError('invalid_native_delivery');
    this.#provider = provider; this.#interval = intervalMs;
    if (typeof onFailure !== 'function') throw TypeError('invalid_native_failure_listener');
    this.#onFailure = onFailure;
    if (typeof onReceiverLost !== 'function') throw TypeError('invalid_native_receiver_listener');
    this.#onReceiverLost = onReceiverLost;
  }
  #call(lease, action, packet = null) {
    return lease.session.socket.call('Runtime.callFunctionOn', { objectId: lease.receiverId,
      functionDeclaration: 'function(action,key,packet){return this[action](key,packet)}',
      arguments: [{ value: action }, { value: lease.key }, { value: packet }], awaitPromise: true, returnByValue: true }, 6000)
      .then((result) => { if (result.exceptionDetails) throw Error('native_receiver_lost'); return result.result?.value; })
      .catch((error) => {
        // Chromium can reject the old private object before delivering its
        // context-cleared event. Only these protocol errors retire a receiver;
        // author/runtime/decode failures still poison the source as before.
        if (!lease.closed && error?.cdpCode === -32000
          && ['Cannot find object with given id', 'Cannot find context with specified id'].includes(error.message)) {
          void this.#release(lease).catch(() => {});
          try { this.#onReceiverLost(lease.session); } catch {}
        }
        throw error;
      });
  }
  prepare(session, key) {
    if (this.#closed) throw Error('native_delivery_closed');
    if (!session.engineTransportId || !/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/.test(key)) throw Error('invalid_native_lease');
    if (this.#failures.has(key)) throw Error('native_source_failed');
    let entry = this.#sources.get(key);
    if (entry?.closed) throw Error('native_source_closing');
    if (!entry) {
      if (this.#sources.size >= 2) throw Error('native_source_capacity');
      entry = { key, owner: this.#provider.create(key), leases: new Set(), closed: false, closing: null,
        timer: null, work: Promise.resolve(), paused: false, volume: 0, delivered: 0, failure: false, samples: [] };
      this.#sources.set(key, entry);
    }
    const lease = { session, receiverId: session.engineTransportId, key, entry, closed: false, closing: null, accepted: 0, cachedState: null };
    entry.leases.add(lease);
    lease.ready = Promise.resolve(entry.owner.ready).then(() => { if (entry.closed || lease.closed) throw Error('native_lease_cancelled'); });
    lease.ready.catch(() => {});
    lease.release = () => this.#release(lease);
    if (!entry.timer && !entry.started) { entry.started = true; this.#schedule(entry, 0); }
    return lease;
  }
  #schedule(entry, ms = this.#interval) {
    if (entry.closed || this.#closed || entry.failure) return;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      entry.work = entry.work.catch(() => {}).then(() => this.#pump(entry));
      void entry.work.finally(() => this.#schedule(entry)).catch(() => {});
    }, ms);
  }
  async #pump(entry) {
    let stage = 'ready', receiverFailure = null;
    try {
      await entry.owner.ready;
      if (entry.closed || this.#closed) return;
      if (entry.paused && entry.owner.health) {
        stage = 'health';
        const health = await entry.owner.health();
        if (health.closed || ['failed', 'released'].includes(health.phase)) throw Error('native_source_failed');
      }
      const stateStarted = performance.now();
      stage = 'state';
      const leases = [...entry.leases].filter((lease) => !lease.closed);
      const states = await Promise.all(leases.map(async (lease) => {
        // A decoded private acknowledgement already contains fresh user/hidden,
        // sound and pointer state. While playing, avoid a second host round trip
        // before the very next frame. Paused/missing receivers still poll so
        // resume, candidate registration and user controls cannot deadlock.
        if (lease.cachedState?.present && lease.cachedState.playing) return { lease, state: lease.cachedState };
        try { return { lease, state: await this.#call(lease, 'state') }; }
        catch { return { lease, state: null }; }
      }));
      if (entry.closed || this.#closed) return;
      const present = states.filter(({ state }) => state?.present && !state.failed);
      const stateMs = performance.now() - stateStarted, controlStarted = performance.now();
      stage = 'control';
      // No source work before the M1 factory has registered a candidate.
      if (!present.length) return;
      const playing = present.some(({ lease, state }) => !lease.accepted || state.playing);
      if (entry.paused === playing) {
        await entry.owner[playing ? 'resume' : 'pause'](); entry.paused = !playing;
      }
      const volume = Math.max(...present.map(({ state }) => state.volume || 0));
      if (entry.owner.volume && volume !== entry.volume) { await entry.owner.volume(volume); entry.volume = volume; }
      if (playing && entry.owner.pointer) {
        for (const { state } of present) for (const input of state.pointer || []) await entry.owner.pointer(input);
      }
      if (entry.closed || this.#closed) return;
      // A fully paused source already delivered a real frame; no busy polling of
      // native capture or duplicate encoded data while user/hidden intent is paused.
      if (!playing && present.every(({ lease }) => lease.accepted)) return;
      const controlMs = performance.now() - controlStarted;
      const started = performance.now(), startedAt = Date.now();
      stage = 'capture';
      const frame = validateEngineVp8Frame(await entry.owner.captureEncoded()), captured = performance.now();
      if (entry.closed || this.#closed) return;
      const packet = { sequence: frame.sequence, timestamp: frame.timestamp, vp8: frame.vp8.toString('base64') };
      let acknowledged = 0;
      stage = 'accept';
      await Promise.all(present.map(async ({ lease }) => {
        if (lease.closed || entry.closed) return;
        let result;
        try { result = await this.#call(lease, 'accept', packet); }
        catch (error) {
          // A page reload/disconnect disposes this receiver, not the shared native
          // source. Its pending old-context rejection must not poison live peers.
          if (lease.closed || entry.closed || this.#closed) return;
          throw error;
        }
        if (lease.closed || entry.closed) return;
        lease.cachedState = result?.state || null;
        if (result?.ok) { lease.accepted++; entry.delivered++; acknowledged++; }
        else if (!['missing', 'detached', 'closed', 'stale', 'busy', 'paused'].includes(result?.reason)) {
          receiverFailure = {
            reason: ['failed', 'invalid-frame', 'decode'].includes(result?.reason) ? result.reason : 'receiver-failed',
            decodeStage: ['configure', 'decode', 'flush', 'output', 'copy', 'draw'].includes(result?.failureStage) ? result.failureStage : null,
            decodeKind: ['TypeError', 'ReferenceError', 'NotSupportedError', 'InvalidStateError', 'DataError', 'SecurityError', 'AbortError', 'Timeout', 'Unknown'].includes(result?.failureKind) ? result.failureKind : null,
          };
          const diagnostic = result?.diagnostic;
          if (diagnostic && typeof diagnostic === 'object' && !Array.isArray(diagnostic)) receiverFailure.decodeDiagnostic = {
            signal: ['none', 'timeout', 'cancelled', 'duplicate-output', 'timestamp-mismatch', 'dimension-mismatch', 'decoder-error'].includes(diagnostic.signal) ? diagnostic.signal : null,
            decoderState: ['unconfigured', 'configured', 'closed'].includes(diagnostic.decoderState) ? diagnostic.decoderState : null,
            queueSize: Number.isInteger(diagnostic.queueSize) && diagnostic.queueSize >= 0 && diagnostic.queueSize <= 64 ? diagnostic.queueSize : null,
            outputs: Number.isInteger(diagnostic.outputs) && diagnostic.outputs >= 0 && diagnostic.outputs <= 8 ? diagnostic.outputs : null,
            documentHidden: typeof diagnostic.documentHidden === 'boolean' ? diagnostic.documentHidden : null,
            timestampMatched: typeof diagnostic.timestampMatched === 'boolean' ? diagnostic.timestampMatched : null,
            dimensionsMatched: typeof diagnostic.dimensionsMatched === 'boolean' ? diagnostic.dimensionsMatched : null,
          };
          throw Error('native_receiver_failed');
        }
      }));
      entry.samples.push({ sequence: frame.sequence, acknowledged, stateMs, controlMs, captureMs: captured - started,
        ackMs: performance.now() - captured, totalMs: performance.now() - started, startedAt, endedAt: Date.now() });
      if (entry.samples.length > 128) entry.samples.shift();
    } catch {
      if (entry.closed || this.#closed) return;
      entry.failure = true; this.#failures.add(entry.key);
      try { this.#onFailure({ stage, ...(receiverFailure || { reason: 'operation-failed', decodeStage: null, decodeKind: null }) }); } catch {}
      if (this.#failures.size > 128) this.#failures.delete(this.#failures.values().next().value);
      // Fixed failure label only. No author exception, script or path enters host.
      await Promise.allSettled([...entry.leases].filter((lease) => !lease.closed).map((lease) => this.#call(lease, 'fail')));
      try { await entry.owner.release(); } catch {}
    }
  }
  #release(lease) {
    if (lease.closing) return lease.closing;
    lease.closed = true; const entry = lease.entry; entry.leases.delete(lease);
    if (entry.leases.size) return Promise.resolve();
    entry.closed = true; clearTimeout(entry.timer); entry.timer = null;
    lease.closing = (async () => {
      await entry.owner.release(); await entry.work.catch(() => {});
      if (entry.owner.status?.().resourcesClosed !== true) throw Error('native_release_incomplete');
      if (this.#sources.get(entry.key) === entry) this.#sources.delete(entry.key);
    })();
    lease.closing.catch(() => { lease.closing = null; }); return lease.closing;
  }
  properties(key, values = null) {
    const entry = this.#sources.get(key);
    if (!entry || entry.closed || entry.failure) return Promise.resolve({ phase: 'unavailable', method: 'none', values: {} });
    const operation = entry.work.catch(() => {}).then(async () => {
      if (entry.closed || this.#closed) return { phase: 'unavailable', method: 'none', values: {} };
      return entry.owner.properties(values);
    });
    entry.work = operation; return operation;
  }
  async retry(key) {
    if (this.#closed) throw Error('native_delivery_closed');
    if (!this.#failures.has(key)) throw Error('native_source_not_failed');
    const entry = this.#sources.get(key);
    if (entry && !entry.failure) throw Error('native_source_not_failed');
    if (entry) await Promise.all([...entry.leases].map((lease) => this.#release(lease)));
    if (this.#sources.has(key)) throw Error('native_source_closing');
    // The parent owns a second failure cache. Neither is cleared until all old
    // resources are acknowledged closed and the parent revalidates the registry.
    if (typeof this.#provider.retry !== 'function' || (await this.#provider.retry(key))?.cleared !== true) throw Error('native_retry_unavailable');
    if (this.#closed) throw Error('native_delivery_closed');
    this.#failures.delete(key); return { cleared: true };
  }
  async close() {
    this.#closed = true;
    const attempts = [...this.#sources.values()].flatMap((entry) => {
      const leases = [...entry.leases];
      if (!leases.length) leases.push({ key: entry.key, entry, closed: true, closing: null });
      return leases.map((lease) => this.#release(lease));
    });
    const results = await Promise.allSettled(attempts);
    if (results.some((result) => result.status === 'rejected')) throw Error('native_release_incomplete');
    this.#failures.clear();
  }
  status() {
    return { closed: this.#closed, sources: this.#sources.size,
      leases: [...this.#sources.values()].reduce((sum, entry) => sum + entry.leases.size, 0) };
  }
  diagnostics() {
    return [...this.#sources.values()].map((entry) => ({ id: entry.key, paused: entry.paused, failed: entry.failure,
      delivered: entry.delivered, samples: entry.samples.map((sample) => ({ ...sample })) }));
  }
}
