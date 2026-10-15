import { createHash } from 'node:crypto';
import { lstat, opendir, realpath } from 'node:fs/promises';
import path from 'node:path';

export const AUTHOR_DIRECTORY_LIMITS = Object.freeze({ files: 128, bytes: 256 * 1024 ** 2, indexBytes: 32768, entries: 1024, depth: 8 });
const fail = (statusCode) => Object.assign(Error('作者目录无效或超过容量上限'), { statusCode });

/** Author defaults only: bounded traversal inside an already registered root.
 * No author/client supplied disk directory, symlink descent or absolute path. */
export async function listAuthorDirectory(root, name, spec) {
  if (name === '') return [];
  if (name !== spec.default || typeof name !== 'string' || name.length > 512 || /[\\\x00-\x1f:%?#]/.test(name)
    || name.startsWith('/') || name.split('/').some(part => !part || part === '.' || part === '..')) throw fail(404);
  let directory = root;
  for (const part of name.split('/')) {
    directory = path.join(directory, part);
    let info;
    try { info = await lstat(directory); } catch (error) { if (error.code === 'ENOENT') return []; throw error; }
    if (!info.isDirectory() || info.isSymbolicLink() || path.relative(directory, await realpath(directory)) !== '') throw fail(404);
  }
  let visited = 0, bytes = 0; const files = [];
  const walk = async (folder, relative, depth) => {
    if (depth > AUTHOR_DIRECTORY_LIMITS.depth) throw fail(413);
    for await (const entry of await opendir(folder)) {
      if (++visited > AUTHOR_DIRECTORY_LIMITS.entries) throw fail(413);
      const file = path.join(folder, entry.name), target = relative + '/' + entry.name;
      if (target.length > 512 || /[\\\x00-\x1f:%?#]/.test(target)) continue;
      const info = await lstat(file);
      if (info.isSymbolicLink()) continue;
      if (path.relative(file, await realpath(file)) !== '') throw fail(404);
      if (info.isDirectory()) await walk(file, target, depth + 1);
      else if (info.isFile() && info.size > 0 && spec.extensions.includes(path.extname(target).toLowerCase())) {
        bytes += info.size;
        if (files.length >= AUTHOR_DIRECTORY_LIMITS.files || info.size > 64 * 1024 ** 2 || bytes > AUTHOR_DIRECTORY_LIMITS.bytes) throw fail(413);
        files.push({ name: target, version: createHash('sha256').update(JSON.stringify([info.dev, info.ino, info.size, info.mtimeMs, info.ctimeMs])).digest('hex') });
      }
    }
  };
  await walk(directory, name, 0);
  return files.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
}
