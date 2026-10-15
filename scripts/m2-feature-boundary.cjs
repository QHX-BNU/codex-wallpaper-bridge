const fs = require('node:fs');
const path = require('node:path');

function prepareFeatureEvidenceRoot(workspace, requested) {
  workspace = fs.realpathSync(path.resolve(workspace));
  const base = path.join(workspace, 'out', 'm2-20261010-compatibility');
  const root = path.resolve(requested), relative = path.relative(base, root);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw Error('M2 evidence child directory required');
  // Check every ancestor before profile setup, refusing junctions and reused evidence.
  let cursor = workspace;
  for (const segment of path.relative(workspace, path.dirname(root)).split(path.sep)) {
    cursor = path.join(cursor, segment);
    if (fs.existsSync(cursor)) {
      const info = fs.lstatSync(cursor);
      if (info.isSymbolicLink() || !info.isDirectory()) throw Error('M2 evidence ancestor is not a plain directory');
    } else fs.mkdirSync(cursor);
  }
  if (fs.existsSync(root)) throw Error('fresh M2 evidence directory required');
  fs.mkdirSync(root);
  return root;
}
module.exports = { prepareFeatureEvidenceRoot };
