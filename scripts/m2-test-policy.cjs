/* Test selection only. Never changes the user's library, configuration or WE files. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const EXCLUDED_M2_TEST_IDS = Object.freeze(['3790869794']);
function isM2TestProjectAllowed(project) {
  const id = typeof project === 'object' && project !== null ? project.id : project;
  const title = typeof project?.title === 'string' ? project.title.normalize('NFKC').replace(/\s+/gu, '') : '';
  return typeof id === 'string' && id.length > 0 && !EXCLUDED_M2_TEST_IDS.includes(id)
    && !title.includes('泰拉身高体检');
}
function assertM2TestProject(project) {
  if (!isM2TestProjectAllowed(project)) throw Error('m2_test_sample_excluded');
  return project;
}
function assertM2TestRoot(root) {
  const resolved = fs.realpathSync(root), file = path.join(resolved, 'project.json');
  if (fs.statSync(file).size > 1024 * 1024) throw Error('m2_test_manifest_invalid');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
  return assertM2TestProject({ id: path.basename(resolved), title: manifest.title });
}
module.exports = { EXCLUDED_M2_TEST_IDS, isM2TestProjectAllowed, assertM2TestProject, assertM2TestRoot };
