import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';
import { readAuthorProperties, validateAuthorPropertyPatch } from '../bridge-runtime/src/author-properties.mjs';
import { validateWebWallpaperInput } from '../bridge-runtime/src/web-wallpaper-input.mjs';
import { effectiveAuthorFileProperties } from '../bridge-runtime/src/author-property-state.mjs';

const source = await readFile(new URL('../bridge-runtime/src/direct-scene-delivery.mjs', import.meta.url), 'utf8');
function fixture(t, options = {}) {
  const servers = [];
  const schema = { enabled: { type: 'bool', value: true, label: 'Enabled' } };
  const context = { randomBytes, readAuthorProperties, validateAuthorPropertyPatch, validateWebWallpaperInput, effectiveAuthorFileProperties, setInterval, clearInterval,
    prewarmSceneAssets: async () => true,
    createSceneServer: () => {
      const server = { origin: 'http://127.0.0.1:44000', rendererUrl: 'http://127.0.0.1:44000/scene', channel: 'a'.repeat(32),
        firstFrameTimeoutMs: 15000, authorProperties: { schema, values: { enabled: true } },
        start: async () => {}, isCurrent: async () => true, close: async () => { server.closed = true; } };
      servers.push(server); return server;
    } };
  vm.runInNewContext(source.slice(source.indexOf('export class')).replace('export class', 'class') + '\nglobalThis.Delivery = DirectSceneDelivery;', context);
  const config = { selectedId: 'web', effects: { playing: true } };
  const delivery = new context.Delivery({ getProject: key => ({ id: key, type: key === 'web' ? 'web' : 'scene', rootPath: '/readonly/' + key }), getConfig: () => config, ...options });
  t.after(() => delivery.close());
  const session = (reply = { phase: 'ready', values: { enabled: true } }) => ({ sceneTransportId: randomBytes(8).toString('hex'),
    socket: { closed: false, async call(_method, params) {
      if (params.functionDeclaration.includes('this.register')) return { result: { value: true } };
      const action = params.arguments[0].value;
      return { result: { value: action === 'properties' ? reply : action === 'state'
        ? { present: true, committed: true, prepared: true } : true } };
    } } });
  return { delivery, servers, session, config };
}

test('Web input dispatch is selected-only, excludes preloads/retired leases, stops on pause and never returns metadata', async t => {
  const f = fixture(t), audio = { op: 'audio', values: Array(128).fill(0.5) };
  const active = await f.delivery.prepare(f.session(), 'web');
  const retired = await f.delivery.prepare(f.session(), 'web'); retired.retire();
  await f.delivery.prepare(f.session(), 'web', { speculative: true });
  assert.equal((await f.delivery.input('web', audio)).delivered, 1);
  f.config.effects.playing = false; assert.equal((await f.delivery.input('web', audio)).delivered, 0);
  f.config.effects.playing = true; f.config.selectedId = 'scene';
  assert.equal((await f.delivery.input('web', audio)).delivered, 0);
  f.config.selectedId = 'web'; await active.release();
  assert.equal((await f.delivery.input('web', audio)).delivered, 0);
  await assert.rejects(f.delivery.input('web', { ...audio, path: 'secret' }), /web_input_invalid/);
  await f.delivery.close(); assert.equal((await f.delivery.input('web', audio)).delivered, 0);
});

test('M3 unchanged metadata avoids CDP repeats, but a new lease gets its own replay', async t => {
  const f = fixture(t), input = { op: 'lyrics', value: { text: 'line', next: '' } };
  await f.delivery.prepare(f.session(), 'web');
  assert.equal((await f.delivery.input('web', input)).delivered, 1);
  const repeated = await f.delivery.input('web', input); assert.equal(repeated.status, 'unchanged'); assert.equal(repeated.delivered, 0);
  await f.delivery.prepare(f.session(), 'web'); assert.equal((await f.delivery.input('web', input)).delivered, 1);
});

test('M3 media opt-out invalidates cleared lease values so the same track can return', async t => {
  const f = fixture(t), lyrics = { op: 'lyrics', value: { text: 'line', next: '' } };
  const session = f.session(); await f.delivery.prepare(session, 'web');
  await f.delivery.input('web', { op: 'mediaStatus', value: { enabled: true } });
  assert.equal((await f.delivery.input('web', lyrics)).delivered, 1);
  const off = { op: 'mediaStatus', value: { enabled: false } };
  const call = session.socket.call;
  session.socket.call = async (method, params) => params.arguments[0].value === 'input'
    && params.arguments[2].value.op === 'mediaStatus' ? { result: { value: false } } : call(method, params);
  assert.equal((await f.delivery.input('web', off)).delivered, 0);
  assert.equal((await f.delivery.input('web', lyrics)).status, 'unchanged'); // a rejected clear cannot invalidate state
  session.socket.call = call;
  assert.equal((await f.delivery.input('web', off)).delivered, 1);
  assert.equal((await f.delivery.input('web', off)).status, 'unchanged');
  await f.delivery.input('web', { op: 'mediaStatus', value: { enabled: true } });
  assert.equal((await f.delivery.input('web', lyrics)).delivered, 1);
  assert.equal((await f.delivery.input('web', lyrics)).status, 'unchanged');
});

test('M3 selected Scene receives audio and repeated spectra replay after pause, but metadata stays Web-only', async t => {
  const f = fixture(t); f.config.selectedId = 'scene';
  await f.delivery.prepare(f.session(), 'scene'); const audio = { op: 'audio', values: Array(128).fill(0.4) };
  assert.equal((await f.delivery.input('scene', audio)).delivered, 1);
  assert.equal((await f.delivery.input('scene', audio)).delivered, 1);
  assert.equal((await f.delivery.input('scene', { op: 'mediaStatus', value: { enabled: true } })).delivered, 0);
  f.config.effects.playing = false; assert.equal((await f.delivery.input('scene', audio)).delivered, 0);
  f.config.effects.playing = true; assert.equal((await f.delivery.input('scene', audio)).delivered, 1);
});

test('M3 private GPU control dispatches only committed non-speculative leases and ACKs the receiver', async t => {
  const commands = [], replies = [];
  const f = fixture(t, { onMediaControl: async (key, value) => { commands.push({ key, value }); return { ok: true }; } });
  const session = f.session(), call = session.socket.call; let pending = false;
  session.socket.call = async (method, params) => {
    const action = params.arguments[0].value;
    if (action === 'state' && pending) { pending = false; return { result: { value: { present: true, committed: true, mediaControls: [{ requestId: 1, command: 'play', sessionId: 'a'.repeat(32) }] } } }; }
    if (action === 'mediaControlResult') replies.push(params.arguments[2].value);
    return call(method, params);
  };
  await f.delivery.prepare(session, 'web'); pending = true; await f.delivery.sweep();
  assert.equal(commands.length, 1); assert.equal(commands[0].key, 'web'); assert.equal(replies[0].ok, true);
  const candidate = f.session(), candidateCall = candidate.socket.call;
  candidate.socket.call = async (method, params) => params.arguments[0].value === 'state'
    ? { result: { value: { present: true, committed: true, prepared: true, mediaControls: [{ requestId: 2, command: 'next', sessionId: 'a'.repeat(32) }] } } } : candidateCall(method, params);
  await f.delivery.prepare(candidate, 'web', { speculative: true }); await f.delivery.sweep(); assert.equal(commands.length, 1);
});

test('missing Web media events pass through the same private GPU CDP lease as typed copies, with no public payload echo', async t => {
  const f = fixture(t), session = f.session(), calls = [], call = session.socket.call;
  session.socket.call = async (method, params) => {
    if (params.arguments[0].value === 'input') calls.push(params.arguments[2].value);
    return call(method, params);
  };
  await f.delivery.prepare(session, 'web');
  for (const input of [{ op: 'mediaStatus', value: { enabled: true } }, { op: 'mediaThumbnail', value: { thumbnail: '', highContrastColor: '#ffffff' } }]) {
    const result = await f.delivery.input('web', input);
    assert.equal(result.delivered, 1); assert.deepEqual(calls.at(-1), input); assert.notEqual(calls.at(-1).value, input.value);
    assert.doesNotMatch(JSON.stringify(result), /thumbnail|enabled|highContrastColor/);
  }
  await assert.rejects(f.delivery.input('web', { op: 'mediaThumbnail', value: { thumbnail: 'file:///C:/secret.png' } }), /web_input_invalid/);
});

test('Web uses the same private GPU lease but reports author delivery rather than fabricated engine readback', async t => {
  const f = fixture(t);
  await f.delivery.prepare(f.session({ phase: 'ready', method: 'author-delivery', values: { enabled: true } }), 'web');
  const result = await f.delivery.properties('web');
  assert.equal(result.phase, 'ready'); assert.equal(result.method, 'author-delivery');
  assert.equal(result.source, 'codex-gpu');
  await f.delivery.close(); assert.equal(f.servers[0].closed, true);
});

test('rejected private receivers cannot poison the content cache and later authorize a fallback', async t => {
  const f = fixture(t), session = f.session(), original = session.socket.call;
  session.socket.call = async (method, params) => params.functionDeclaration.includes('this.register')
    ? { result: { value: false } } : original(method, params);
  await assert.rejects(f.delivery.prepare(session, 'scene'), /gpu_descriptor_rejected/);
  await assert.rejects(f.delivery.retry('scene'), /gpu_source_not_failed/);
  const healthy = await f.delivery.prepare(f.session(), 'scene'); assert.equal(healthy.closed, false);
});

test('GPU readback does not claim ready when an engine returns no valid author values', async t => {
  const f = fixture(t); await f.delivery.prepare(f.session({ phase: 'ready', values: { enabled: 'wrong-type' } }), 'scene');
  const result = await f.delivery.properties('scene');
  assert.equal(result.phase, 'unavailable'); assert.equal(result.method, 'none');
});
test('GPU readback requires every active target, not the first successful renderer', async t => {
  const f = fixture(t);
  await f.delivery.prepare(f.session(), 'scene');
  await f.delivery.prepare(f.session({ phase: 'failed', values: {} }), 'scene');
  const result = await f.delivery.properties('scene');
  assert.notEqual(result.phase, 'ready'); assert.equal(result.method, 'none');
});
test('GPU readback rejects disagreement between two active targets and stale values after a write', async t => {
  const f = fixture(t);
  await f.delivery.prepare(f.session(), 'scene');
  assert.notEqual((await f.delivery.properties('scene', { enabled: false })).phase, 'ready');
  await f.delivery.prepare(f.session({ phase: 'ready', values: { enabled: false } }), 'scene');
  assert.notEqual((await f.delivery.properties('scene')).phase, 'ready');
});
test('matching GPU readback is identified as Codex GPU and release closes the shared server only after the last lease', async t => {
  const f = fixture(t), a = await f.delivery.prepare(f.session(), 'scene'), b = await f.delivery.prepare(f.session(), 'scene');
  const result = await f.delivery.properties('scene', { enabled: true });
  assert.equal(result.phase, 'ready'); assert.equal(result.method, 'engine-readback'); assert.equal(result.source, 'codex-gpu');
  assert.equal(result.values.enabled, true); assert.equal(f.servers.length, 1);
  await a.release(); assert.notEqual(f.servers[0].closed, true);
  await b.release(); assert.equal(f.servers[0].closed, true);
  assert.equal((await f.delivery.properties('scene')).phase, 'unavailable');
});
