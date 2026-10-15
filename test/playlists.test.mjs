import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizePlaylists, parseWEPlaylists, playlistCandidates } from '../bridge-runtime/src/playlists.mjs';
import { PlaylistController } from '../bridge-runtime/src/playlist-controller.mjs';
import { mergeConfig, normalizeConfig } from '../bridge-runtime/src/config-store.mjs';

const projects = [
  { id: 'a', rootPath: 'D:/steam/projects/workshop/100', projectFile: 'D:/steam/projects/workshop/100/project.json', workshopId: '100', type: 'image', playable: true },
  { id: 'b', rootPath: 'D:/steam/projects/workshop/200', workshopId: '200', type: 'video', playable: true },
  { id: 'c', type: 'image', playable: true },
];
const config = () => normalizeConfig({ selectedId: 'a', playlists: { items: [{ id: 'list', name: 'list', ids: ['a', 'b', 'c'] }], activeId: 'list', enabled: true, intervalSeconds: 60 } });
function fixture(options = {}) {
  let current = config(); const applied = [];
  const store = { get: () => structuredClone(current), set: async (patch) => { current = mergeConfig(current, patch); return store.get(); } };
  const controller = new PlaylistController({ configStore: store, getProjects: async () => projects,
    apply: async (next) => { applied.push(next.selectedId); if (options.fail === next.selectedId) throw Error('renderer failed'); },
    available: async (p) => p.id !== options.missing, random: () => 0,
  });
  return { store, controller, applied };
}

test('playlist schema bounds values, deduplicates IDs, and active list must exist', () => {
  const value = normalizePlaylists({ items: [{ id: 'x', name: 'x', ids: ['a', 'a', 'b'] }], activeId: 'bad', intervalSeconds: 0, order: 'evil' });
  assert.deepEqual(value.items[0].ids, ['a', 'b']);
  assert.equal(value.activeId, 'x');
  assert.equal(value.intervalSeconds, 5);
  assert.equal(value.order, 'sequential');
});

test('WE JSON resolves only known IDs/workshop IDs/paths and reports unmatched entries', () => {
  const result = parseWEPlaylists({ playlists: [{ name: 'WE', items: ['100', { file: 'D:\\steam\\projects\\workshop\\200\\project.json' }, { file: '../secret.json' }, 'unknown'] }] }, projects);
  assert.deepEqual(result.lists[0].ids, ['a', 'b']);
  assert.equal(result.unmatchedCount, 2);
  assert.throws(() => parseWEPlaylists({ playlists: Array(21).fill({ items: ['a'] }) }, projects), /上限/);
});

test('playlist candidates use the same hidden/rating rules as direct selection', () => {
  const cfg = config(); cfg.library.hiddenIds = ['b']; cfg.library.ratings = { c: 'mature' };
  cfg.library.allowedRatings = ['unrated'];
  assert.deepEqual(playlistCandidates(projects, cfg).map((p) => p.id), ['a']);
});

test('sequential next and random never repeat the current item', async (t) => {
  const f = fixture(); t.after(() => f.controller.close());
  await f.controller.next(); assert.equal(f.store.get().selectedId, 'b');
  await f.controller.manage({ action: 'settings', order: 'random' });
  await f.controller.next(); assert.notEqual(f.store.get().selectedId, 'b');
});

test('missing/decode-failed media are skipped and fewer than two candidates hold', async (t) => {
  const f = fixture({ fail: 'b' }); t.after(() => f.controller.close());
  await f.controller.next(); assert.equal(f.store.get().selectedId, 'c');
  assert.ok(f.controller.status().failedIds.includes('b'));
  const g = fixture({ missing: 'b' }); t.after(() => g.controller.close());
  await g.store.set({ library: { hiddenIds: ['c'] } });
  await g.controller.next(); assert.equal(g.store.get().selectedId, 'a');
  assert.equal(g.controller.status().state, 'insufficient');
});

test('CRUD is serialized and paused/closed rotation cannot apply', async () => {
  const f = fixture();
  await Promise.all([f.controller.manage({ action: 'create', name: 'one', ids: ['a'] }), f.controller.manage({ action: 'create', name: 'two', ids: ['b'] })]);
  assert.equal(f.store.get().playlists.items.length, 3);
  await assert.rejects(f.controller.manage({ action: 'update', id: 'list', ids: ['unknown'] }), /不存在/);
  await f.store.set({ effects: { playing: false } }); await f.controller.next();
  assert.deepEqual(f.applied, []);
  await f.controller.close(); await assert.rejects(f.controller.next(), /关闭/);
});
