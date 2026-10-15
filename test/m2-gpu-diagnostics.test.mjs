import assert from 'node:assert/strict';
import test from 'node:test';

const moduleUrl = new URL('../scripts/m2-gpu-diagnostics.mjs', import.meta.url);
const page = { id: 'page', type: 'page', url: 'app://-/' };
const frame = id => ({ id, type: 'iframe', url: 'http://127.0.0.1:41000/wallpaper-engine/scene-live/index.html?type=scene&src=project' });

test('GPU diagnostics reject an unverified owner before listing or connecting targets', async () => {
  const { readOwnedGpuDocuments } = await import(moduleUrl);
  let touched = false;
  await assert.rejects(readOwnedGpuDocuments({ verifyOwner: async () => { throw Error('owner_changed'); },
    listTargets: async () => { touched = true; return []; }, connect: async () => { touched = true; } }), /owner_changed/);
  assert.equal(touched, false);
});

test('GPU diagnostics bind the DOM frame and whitelist metadata independently of renderer responses', async () => {
  const { readOwnedGpuDocuments } = await import(moduleUrl);
  const connected = [], closed = [];
  const values = await readOwnedGpuDocuments({ verifyOwner: async () => {},
    listTargets: async () => [page, frame('other-window'), frame('owned'),
      { id: 'private', type: 'page', url: 'https://example.com/private' }],
    connect: async target => {
      connected.push(target.id);
      return { evaluate: async () => target.type === 'page'
        ? { hidden: true, runtimeReady: true, mediaState: 'error', switchError: 'Media failed to load or decode',
          title: 'secret', body: 'secret', origin: 'secret', width: Infinity, frameCount: 1 }
        : { hidden: true, phase: 'failed', draws: 0, layers: 2, width: 1280, height: 720,
          renderCompletions: 0, paused: false, properties: { secret: 'secret' }, channel: 'secret' },
      call: async method => method === 'DOM.getDocument' ? { root: { nodeId: 1 } }
        : method === 'DOM.querySelectorAll' ? { nodeIds: [2] } : { node: { frameId: 'owned' } },
      close: () => closed.push(target.id) };
    } });
  assert.deepEqual(connected, ['page', 'owned']);
  assert.deepEqual(closed.sort(), ['owned', 'page']);
  assert.equal(values[0].document.hidden, true);
  assert.equal(values[0].document.width, null);
  assert.equal(values[0].scenes[0].phase, 'failed');
  assert.equal(values[0].scenes[0].draws, 0);
  assert.doesNotMatch(JSON.stringify(values), /secret|private|app:\/\/|127\.0\.0\.1|owned|page/);
});

test('GPU diagnostics bound documents and frames and keep unavailable observations explicit', async () => {
  const { readOwnedGpuDocuments } = await import(moduleUrl);
  const values = await readOwnedGpuDocuments({ verifyOwner: async () => {},
    listTargets: async () => Array.from({ length: 20 }, (_, i) => ({ ...page, id: String(i) })),
    connect: async () => { throw Error('private exception'); } });
  assert.equal(values.length, 8);
  assert.ok(values.every(value => value.available === false));
  assert.doesNotMatch(JSON.stringify(values), /private exception/);
});
