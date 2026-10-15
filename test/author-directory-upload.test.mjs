import assert from 'node:assert/strict';
import test from 'node:test';
import { uploadAuthorDirectory } from '../bridge-runtime/src/author-directory-upload.mjs';

const file = name => ({ name, size: 64, path: 'C:/secret/ignored', webkitRelativePath: 'folder/' + name });
const id = n => 'cwb-author-files/' + 'a'.repeat(32) + '-' + 'b'.repeat(32) + '-' + String(n).repeat(64) + '.png';
test('directory browser helper streams Files in order, reports progress and commits one CAS with no paths', async () => {
  const calls = [], progress = []; let concurrent = 0;
  const files = [file('one.png'), file('two.png')];
  const result = await uploadAuthorDirectory({ id: 'wall paper', key: 'photos', files, revision: 7,
    onProgress: value => progress.push(value), onCommit: () => progress.push('commit'),
    api: async (route, options) => {
      assert.equal(++concurrent, 1); await Promise.resolve(); concurrent--;
      calls.push({ route, options });
      if (route.includes('/directory-file/')) return { value: id(calls.length) };
      return { revision: 8, values: { photos: 'selected' } };
    } });
  assert.equal(result.revision, 8); assert.equal(calls.length, 3);
  assert.equal(calls[0].options.body, files[0]); assert.equal(calls[1].options.body, files[1]);
  assert.match(calls[0].route, /^author-properties\/wall%20paper\/directory-file\/photos\?filename=one.png&revision=7$/);
  assert.ok(calls.every(call => call.options.signal));
  assert.deepEqual(JSON.parse(calls[2].options.body), { revision: 7, files: [id(1), id(2)] });
  assert.doesNotMatch(calls[2].options.body, /secret|folder|http:/);
  assert.deepEqual(progress, [{ completed: 1, total: 2 }, { completed: 2, total: 2 }, 'commit']);
});
test('cancel or failed staging never issues the final directory selection request', async () => {
  for (const fail of ['cancel', 'transfer', 'invalid-reply']) {
    const controller = new AbortController(), routes = [];
    const task = uploadAuthorDirectory({ id: 'a', key: 'photos', files: [file('one.png'), file('two.png')], revision: 0, signal: controller.signal,
      api: async route => {
        routes.push(route);
        if (fail === 'cancel') controller.abort();
        if (fail === 'transfer') throw Error('transfer_failed');
        return { value: fail === 'invalid-reply' ? 'file:///C:/secret' : id(1) };
      } });
    await assert.rejects(task); assert.equal(routes.length, 1); assert.ok(routes.every(route => route.includes('/directory-file/')));
  }
});
test('directory helper rejects capacity and bad name before any network request', async () => {
  let calls = 0;
  for (const files of [[], Array(129).fill(file('a.png')), [file('../a.png')], [{ name: 'a.png', size: 64 * 1024 ** 2 + 1 }],
    Array(5).fill({ name: 'a.png', size: 64 * 1024 ** 2 })]) {
    await assert.rejects(uploadAuthorDirectory({ api: async () => calls++, id: 'a', key: 'photos', revision: 0, files }));
  }
  assert.equal(calls, 0);
});
