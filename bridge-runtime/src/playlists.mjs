import path from 'node:path';
import { eligibleProjects } from './library-policy.mjs';

export const PLAYLIST_LIMITS = Object.freeze({ lists: 20, entries: 1000, name: 80, jsonBytes: 512 * 1024 });
export const DEFAULT_PLAYLISTS = Object.freeze({ items: Object.freeze([]), activeId: null,
  enabled: false, order: 'sequential', intervalSeconds: 60 });
const safeId = (value) => typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\x00-\x1f]/.test(value);
export function normalizePlaylists(input = {}) {
  const value = input && typeof input === 'object' && !Array.isArray(input) ? input : {};
  const seen = new Set();
  const items = (Array.isArray(value.items) ? value.items : []).slice(0, PLAYLIST_LIMITS.lists).flatMap((item) => {
    if (!item || !/^[A-Za-z0-9_-]{1,64}$/.test(item.id ?? '') || seen.has(item.id)) return [];
    seen.add(item.id);
    return [{ id: item.id, name: (typeof item.name === 'string' ? item.name.trim().slice(0, 80) : '') || '未命名列表',
      ids: [...new Set((Array.isArray(item.ids) ? item.ids : []).filter(safeId))].slice(0, PLAYLIST_LIMITS.entries) }];
  });
  return { items, activeId: items.some((item) => item.id === value.activeId) ? value.activeId : (items[0]?.id ?? null),
    enabled: value.enabled === true, order: value.order === 'random' ? 'random' : 'sequential',
    intervalSeconds: typeof value.intervalSeconds === 'number' && Number.isFinite(value.intervalSeconds)
      ? Math.min(86400, Math.max(5, value.intervalSeconds)) : 60 };
}
export function playlistCandidates(projects, config) {
  const lists = normalizePlaylists(config?.playlists);
  const list = lists.items.find((item) => item.id === lists.activeId);
  const candidates = new Map(eligibleProjects(projects, config).map((project) => [project.id, project]));
  return (list?.ids ?? []).flatMap((id) => candidates.has(id) ? [candidates.get(id)] : []);
}
function canonical(value) { return String(value ?? '').replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase(); }
/** Match WE export references against known inventory only; never open input-provided paths. */
export function parseWEPlaylists(input, projects) {
  if (typeof input === 'string') {
    if (Buffer.byteLength(input) > PLAYLIST_LIMITS.jsonBytes) throw new Error('WE JSON 大小超过上限');
    try { input = JSON.parse(input.replace(/^\uFEFF/, '')); } catch { throw new Error('WE JSON 无法解析'); }
  }
  const rawLists = Array.isArray(input?.playlists) ? input.playlists
    : (Array.isArray(input) ? [{ name: 'WE 导入', items: input }] : [input]);
  if (rawLists.length > PLAYLIST_LIMITS.lists) throw new Error('播放列表数量超过上限');
  let unmatchedCount = 0;
  const lists = rawLists.map((list) => {
    const entries = list?.items ?? list?.wallpapers ?? list?.ids;
    if (!Array.isArray(entries) || entries.length > PLAYLIST_LIMITS.entries) throw new Error('WE 列表项目无效或超过上限');
    const ids = entries.flatMap((entry) => {
      const ref = typeof entry === 'object' && entry ? entry.id ?? entry.workshopId ?? entry.file ?? entry.path : entry;
      if (!['string', 'number'].includes(typeof ref)) { unmatchedCount++; return []; }
      const text = String(ref);
      const normalized = canonical(text);
      if (text.length > 2048 || /[\x00-\x1f]/.test(text) || normalized.split('/').includes('..')) { unmatchedCount++; return []; }
      const matches = projects.filter((project) => {
        const workshopId = project.workshopId ?? project.metadata?.workshopId;
        if (project.id === text || (workshopId && String(workshopId) === text)) return true;
        const root = project.rootPath ?? project.rootDir;
        const known = [project.projectFile, project.mediaPath, project.contentPath,
          root ? path.join(root, 'project.json') : null, root && project.metadata?.declaredFile ? path.join(root, project.metadata.declaredFile) : null];
        return known.filter(Boolean).some((file) => canonical(file) === normalized);
      });
      if (matches.length !== 1) { unmatchedCount++; return []; }
      return [matches[0].id];
    });
    return { name: typeof list?.name === 'string' ? list.name.trim().slice(0, 80) : 'WE 导入', ids: [...new Set(ids)] };
  });
  return { lists, unmatchedCount };
}
