/** Browser File objects only. Sequential bounded staging does not select a
 * directory until its final CAS. Cancellation leaves the old selection intact. */
export async function uploadAuthorDirectory({ api, id, key, files, revision, signal, onProgress = () => {}, onCommit = () => {} }) {
  if (!Array.isArray(files) || !files.length || files.length > 128 || !Number.isSafeInteger(revision) || revision < 0
    || files.some(file => typeof file.name !== 'string' || !file.name || file.name.length > 255 || /[\/:\x00-\x1f]/.test(file.name)
      || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 64 * 1024 ** 2)
    || files.reduce((sum, file) => sum + file.size, 0) > 256 * 1024 ** 2) throw Error('目录文件数量或容量超限');
  const check = () => signal?.throwIfAborted();
  const scoped = ms => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
  const route = 'author-properties/' + encodeURIComponent(id), values = [];
  for (const file of files) {
    check();
    const query = new URLSearchParams({ filename: file.name, revision: String(revision) });
    const result = await api(route + '/directory-file/' + encodeURIComponent(key) + '?' + query, {
      method: 'POST', body: file, signal: scoped(35000),
      headers: { 'Content-Type': 'application/octet-stream', 'X-CWB-File-Size': String(file.size) },
    });
    check();
    if (typeof result?.value !== 'string' || !/^cwb-author-files\/[a-f0-9]{32}-[a-f0-9]{32}-[a-f0-9]{64}\.[a-z0-9]+$/.test(result.value)) throw Error('目录文件导入未取得受管资源');
    values.push(result.value); onProgress({ completed: values.length, total: files.length });
  }
  check(); onCommit(); check();
  return api(route + '/directory/' + encodeURIComponent(key), {
    method: 'POST', body: JSON.stringify({ revision, files: values }), signal: scoped(30000),
  });
}
