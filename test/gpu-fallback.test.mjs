import assert from 'node:assert/strict';
import test from 'node:test';
import { buildInjectionPlan } from '../bridge-overrides/src/injection-plan.mjs';
import { normalizeConfig, mergeConfig } from '../bridge-runtime/src/config-store.mjs';

const prefix = '/' + 'a'.repeat(32);
const server = { origin: 'http://127.0.0.1:44100', basePath: prefix };
function plan(patch = {}) {
  return buildInjectionPlan({ server, config: normalizeConfig({ selectedId: 'scene', ...patch }),
    nativeEnabled: true, directSceneEnabled: true, inventory: { projects: [
      { id: 'scene', type: 'scene', previewUrl: prefix + '/api/preview/scene', embeddedVideoUrl: prefix + '/api/embedded-video/scene' },
      { id: 'static', type: 'image', playable: true, mediaUrl: prefix + '/api/image/static' },
      { id: 'video', type: 'video', playable: true, mediaUrl: prefix + '/api/video/video' },
      { id: 'web', type: 'web', playable: true, webUrl: prefix + '/api/web/web/' },
    ] } });
}
test('GPU fallback scripts contain only trusted streaming descriptors, ordered video/static/preview/empty with explicit degradation', () => {
  const p = plan({ engineFallbacks: { scene: { staticId: 'static' } } });
  assert.deepEqual(p.fallbackScripts.map(entry => entry.reason), ['embedded_video', 'custom_static', 'preview', 'empty']);
  for (const entry of p.fallbackScripts) { assert.ok(Buffer.byteLength(entry.script) < 10000); assert.match(entry.script, /degraded: true/); assert.match(entry.script, /await runtime.waitForMedia/); }
  assert.match(p.fallbackScripts[0].script, /api\/embedded-video\/scene/);
  assert.doesNotMatch(p.fallbackScripts[0].script, /VideoDecoder|vp8|rootPath/);
  assert.match(p.fallbackScripts.at(-1).script, /"wallpaper":null/);
  assert.deepEqual(plan({ engineFallbacks: { scene: { staticId: 'video' } } }).fallbackScripts.map(entry => entry.reason), ['embedded_video', 'preview', 'empty']);
});
test('Web is direct GPU, never native VP8, with no author URL/code or resource paths in apply', () => {
  const p = plan({ selectedId: 'web' });
  assert.equal(p.directSceneId, 'web'); assert.equal(p.nativeWallpaperId, null); assert.equal(p.metrics.renderer, 'direct-gpu');
  assert.match(p.applyScript, /"type":"web","playable":"direct-gpu"/); assert.doesNotMatch(p.applyScript, /api\/web\/web/);
});
test('fallback persistence is bounded, registered-ID-only and ordinary effects patches retain it', () => {
  const config = normalizeConfig({ engineFallbacks: { scene: { staticId: 'static', path: 'secret' }, bad: { staticId: 'file:///private' } } });
  assert.deepEqual(config.engineFallbacks, { scene: { staticId: 'static' } });
  assert.deepEqual(mergeConfig(config, { effects: { brightness: 50 } }).engineFallbacks, config.engineFallbacks);
  assert.equal(Object.keys(normalizeConfig({ engineFallbacks: Object.fromEntries(Array.from({ length: 200 }, (_, i) => ['s' + i, { staticId: 'static' }])) }).engineFallbacks).length, 128);
});
