import assert from 'node:assert/strict';
import test from 'node:test';
import { CONTENT_RATINGS, eligibleProjects, normalizeLibrary, projectPolicy } from '../bridge-runtime/src/library-policy.mjs';
import { mergeConfig, normalizeConfig } from '../bridge-runtime/src/config-store.mjs';

test('version 2 keeps effect patches independent of library index and policy', () => {
  const before = normalizeConfig({ library: { hiddenIds: ['one'], ratings: { two: 'PG13' } } });
  const after = mergeConfig(before, { effects: { brightness: 90 }, library: { allowedRatings: ['everyone'] } });
  assert.deepEqual(after.library.hiddenIds, ['one']);
  assert.equal(after.library.ratings.two, 'pg13');
  assert.deepEqual(after.library.allowedRatings, ['everyone']);
  assert.equal(after.effects.brightness, 90);
});

test('library index rejects arbitrary paths, mismatched hash identities and invalid sizes', () => {
  const hash = 'a'.repeat(64);
  const asset = { hash, id: `upload:${hash}`, fileName: `${hash}.png`, size: 100, title: '图', rating: 'Mature' };
  const library = normalizeLibrary({ assets: [asset, asset, { ...asset, fileName: '../original.png' },
    { ...asset, id: 'some-other-id' }, { ...asset, size: -1 }], hiddenIds: ['one', 'one', null] });
  assert.equal(library.assets.length, 1);
  assert.equal(library.assets[0].type, 'image');
  assert.equal(library.assets[0].rating, 'mature');
  assert.deepEqual(library.hiddenIds, ['one']);
  assert.deepEqual(library.allowedRatings, CONTENT_RATINGS);
});

test('all candidate consumers share hidden, rating overrides and unrated policy', () => {
  const projects = [{ id: 'a', metadata: { contentRating: 'Everyone' } },
    { id: 'b', contentRating: 'PG-13' }, { id: 'c', contentRating: 'Mature' }, { id: 'd' }];
  const config = normalizeConfig({ library: { hiddenIds: ['a'], ratings: { b: 'Everyone' }, allowedRatings: ['everyone'] } });
  assert.deepEqual(eligibleProjects(projects, config).map(({ id }) => id), ['b']);
  assert.deepEqual(projectPolicy(projects[0], config), { contentRating: 'everyone', hidden: true, eligible: false });
  assert.deepEqual(eligibleProjects(projects, { library: { allowedRatings: [] } }), []);
  assert.deepEqual(eligibleProjects(projects, {}), projects);
});

test('object prototype keys cannot masquerade as per-project rating overrides', () => {
  const project = { id: 'constructor', contentRating: 'Everyone' };
  assert.equal(projectPolicy(project, normalizeConfig()).contentRating, 'everyone');
  const ratings = Object.fromEntries([['__proto__', 'mature']]);
  assert.equal(projectPolicy({ id: '__proto__' }, normalizeConfig({ library: { ratings } })).contentRating, 'mature');
});
