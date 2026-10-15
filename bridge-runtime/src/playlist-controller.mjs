import { randomUUID } from 'node:crypto';
import { normalizePlaylists, parseWEPlaylists, playlistCandidates, PLAYLIST_LIMITS } from './playlists.mjs';

function invalid(message, statusCode = 400) { return Object.assign(new Error(message), { statusCode }); }
/** One server-owned scheduler; every choice uses the existing config/apply path. */
export class PlaylistController {
  #store; #projects; #apply; #available; #busy; #random;
  #queue = Promise.resolve(); #timer = null; #closed = false; #failed = new Set();
  #state = 'stopped'; #error = null;
  #previewSelection = null;
  #preload; #planned = null;
  constructor({ configStore, getProjects, apply = async () => {}, available = async () => true,
    busy = () => false, random = Math.random, preload = null }) {
    this.#store = configStore; this.#projects = getProjects; this.#apply = apply;
    this.#available = available; this.#busy = busy; this.#random = random;
    if (preload !== null && typeof preload !== 'function') throw TypeError('invalid playlist preloader');
    this.#preload = preload;
  }
  #enqueue(fn) {
    if (this.#closed) return Promise.reject(invalid('播放列表已关闭', 409));
    const operation = this.#queue.catch(() => {}).then(() => {
      if (this.#closed) throw invalid('播放列表已关闭', 409);
      return fn();
    });
    this.#queue = operation.catch(() => {});
    return operation;
  }
  status() { return { state: this.#state, error: this.#error, failedIds: [...this.#failed], nextId: this.#planned?.id ?? null }; }
  resetFailures() { this.#failed.clear(); this.#error = null; this.#planned = null; }
  #signature(config, candidates) {
    return JSON.stringify([config.selectedId, config.playlists.activeId, config.playlists.order, candidates.map((project) => project.id)]);
  }
  #choices(config, candidates, randomize = true) {
    const index = candidates.findIndex((project) => project.id === config.selectedId);
    const choices = config.playlists.order === 'random' ? candidates.filter((project) => project.id !== config.selectedId)
      : [...candidates.slice(index + 1), ...candidates.slice(0, Math.max(0, index))];
    if (randomize && config.playlists.order === 'random' && choices.length > 1) {
      const selected = Math.min(choices.length - 1, Math.max(0, Math.floor(this.#random() * choices.length)));
      choices.unshift(...choices.splice(selected, 1));
    }
    return choices;
  }
  #warmNext(config, candidates) {
    if (this.#state !== 'running') {
      if (this.#planned && this.#preload) Promise.resolve().then(() => this.#preload(null)).catch(() => {});
      this.#planned = null; return;
    }
    const signature = this.#signature(config, candidates);
    if (this.#planned?.signature !== signature) {
      const project = this.#choices(config, candidates)[0];
      this.#planned = project ? { id: project.id, signature } : null;
    }
    const project = candidates.find((item) => item.id === this.#planned?.id);
    // Re-request after injector startup/effect applies too; the delivery layer
    // reuses an existing candidate. The playlist queue never waits for readiness.
    if (this.#preload) Promise.resolve().then(() => this.#preload(project?.type === 'scene' ? project.id : null)).catch(() => {});
  }
  refresh() { return this.#enqueue(() => this.#refresh()); }
  async #refresh() {
    clearTimeout(this.#timer); this.#timer = null;
    if (this.#closed) return;
    const config = await this.#store.get();
    const candidates = playlistCandidates(await this.#projects(), config).filter((p) => !this.#failed.has(p.id));
    this.#state = !config.playlists.enabled ? 'stopped' : !config.effects.playing ? 'paused'
      : candidates.length < 2 ? 'insufficient' : this.#busy() ? 'busy' : 'running';
    this.#warmNext(config, candidates);
    if (!config.playlists.enabled || !config.effects.playing) return;
    // Insufficient candidates stay idle until the next interval or an explicit refresh.
    const delay = Math.max(5000, config.playlists.intervalSeconds * 1000);
    this.#timer = setTimeout(() => {
      this.#enqueue(async () => { await this.#tick(); await this.#refresh(); }).catch(() => { this.#state = 'error'; });
    }, delay);
    this.#timer.unref?.();
  }
  next() { return this.#enqueue(async () => { await this.#tick(true); await this.#refresh(); return this.#store.get(); }); }
  reportFailure({ selectedId, revision } = {}) {
    return this.#enqueue(async () => {
      const config = await this.#store.get();
      const selection = this.#previewSelection;
      if (!Number.isSafeInteger(revision) || revision !== this.#store.revision
        || !selection || selectedId !== selection.id || config.selectedId !== selectedId) {
        throw invalid('选择已更新或并非轮播候选，忽略过期媒体反馈', 409);
      }
      const candidates = playlistCandidates(await this.#projects(), config);
      if (!candidates.some((p) => p.id === selectedId)) throw invalid('候选已经失效', 409);
      const previousId = candidates.some((p) => p.id === selection.previousId && !this.#failed.has(p.id))
        ? selection.previousId : null;
      // The store guard is checked inside its write queue, including writes arriving during awaits.
      const rollback = await this.#store.set({ selectedId: previousId }, { ifRevision: revision });
      const rollbackRevision = this.#store.revision;
      this.#failed.add(selectedId);
      this.#error = '候选媒体解码失败；已保留旧画面并跳过，可重新扫描后重试';
      this.#previewSelection = null;
      await this.#apply(rollback, { selectedId: previousId });
      if (this.#store.revision === rollbackRevision) await this.#tick(true);
      await this.#refresh();
      return this.#store.get();
    });
  }
  async #tick(manual = false) {
    if (this.#closed || this.#busy()) { this.#state = 'busy'; return; }
    let config = await this.#store.get();
    if (!manual && !config.playlists.enabled) return;
    if (!config.effects.playing) { this.#state = 'paused'; return; }
    const projects = await this.#projects();
    const originalId = config.selectedId;
    let candidates = playlistCandidates(projects, config).filter((p) => !this.#failed.has(p.id));
    const available = await Promise.all(candidates.map(async (p) => {
      try { return await this.#available(p); } catch { return false; }
    }));
    candidates.forEach((p, index) => { if (!available[index]) this.#failed.add(p.id); });
    // Recheck policy/user changes after filesystem awaits, not just at the timer's start.
    config = await this.#store.get();
    if (this.#closed || this.#busy() || config.selectedId !== originalId || !config.effects.playing) return;
    candidates = playlistCandidates(projects, config).filter((p) => !this.#failed.has(p.id));
    if (candidates.length < 2) { this.#state = 'insufficient'; return; }
    const planned = this.#planned?.signature === this.#signature(config, candidates) ? this.#planned.id : null;
    const choices = this.#choices(config, candidates, !planned);
    const plannedIndex = choices.findIndex((project) => project.id === planned);
    if (plannedIndex > 0) choices.unshift(...choices.splice(plannedIndex, 1));
    for (const project of choices) {
      if (this.#closed || this.#busy()) return;
      const expectedRevision = this.#store.revision;
      const latest = await this.#store.get();
      if (latest.selectedId !== originalId || !latest.effects.playing
        || (!manual && !latest.playlists.enabled)) return;
      let appliedRevision;
      try {
        const next = await this.#store.set({ selectedId: project.id }, { ifRevision: expectedRevision });
        appliedRevision = this.#store.revision;
        this.#previewSelection = { id: project.id, previousId: originalId };
        await this.#apply(next, { selectedId: project.id });
        this.#state = 'running';
        return;
      } catch (error) {
        if (error.statusCode === 409) return;
        this.#failed.add(project.id);
        this.#error = '候选媒体不可用或宿主切换失败；已跳过，可重新扫描后重试';
        const latest = await this.#store.get();
        if (latest.selectedId !== project.id || this.#store.revision !== appliedRevision) return;
        let rollback;
        try { rollback = await this.#store.set({ selectedId: originalId }, { ifRevision: appliedRevision }); }
        catch (error) { if (error.statusCode === 409) return; throw error; }
        try { await this.#apply(rollback, { selectedId: originalId }); }
        catch { this.#state = 'error'; return; }
      }
    }
    this.#state = 'insufficient';
  }
  manage(body) {
    return this.#enqueue(async () => {
      const config = await this.#store.get();
      const lists = normalizePlaylists(config.playlists);
      const known = new Set((await this.#projects()).map((p) => p.id));
      const ids = (value) => {
        if (!Array.isArray(value) || value.length > PLAYLIST_LIMITS.entries) throw invalid('列表项目无效或超过上限');
        if (value.some((id) => typeof id !== 'string' || !known.has(id))) throw invalid('列表项目不存在');
        return [...new Set(value)];
      };
      const name = (value) => {
        if (typeof value !== 'string' || !value.trim() || value.length > 80) throw invalid('列表名称需为 1–80 字');
        return value.trim();
      };
      let unmatchedCount = 0;
      if (body.action === 'create') {
        lists.items.push({ id: randomUUID(), name: name(body.name), ids: ids(body.ids ?? []) });
      } else if (body.action === 'update' || body.action === 'delete') {
        const item = lists.items.find((item) => item.id === body.id);
        if (!item) throw invalid('播放列表不存在', 404);
        if (body.action === 'delete') {
          lists.items = lists.items.filter((item) => item.id !== body.id);
          if (lists.activeId === body.id) { lists.activeId = null; lists.enabled = false; }
        } else {
          if (body.name !== undefined) item.name = name(body.name);
          if (body.ids !== undefined) item.ids = ids(body.ids);
        }
      } else if (body.action === 'import') {
        let imported;
        try { imported = parseWEPlaylists(body.value, await this.#projects()); }
        catch (error) { throw invalid(error.message); }
        unmatchedCount = imported.unmatchedCount;
        const matched = imported.lists.filter((list) => list.ids.length);
        if (!matched.length) throw invalid('WE 列表没有匹配到本机已扫描的项目', 409);
        lists.items.push(...matched.map((list) => ({ ...list, id: randomUUID() })));
      } else if (body.action === 'settings') {
        if (body.activeId !== undefined) {
          if (body.activeId !== null && !lists.items.some((item) => item.id === body.activeId)) throw invalid('播放列表不存在');
          lists.activeId = body.activeId;
        }
        if (body.enabled !== undefined) { if (typeof body.enabled !== 'boolean') throw invalid('轮播开关无效'); lists.enabled = body.enabled; }
        if (body.order !== undefined) { if (!['sequential', 'random'].includes(body.order)) throw invalid('轮播顺序无效'); lists.order = body.order; }
        if (body.intervalSeconds !== undefined) {
          if (typeof body.intervalSeconds !== 'number' || !Number.isFinite(body.intervalSeconds) || body.intervalSeconds < 5 || body.intervalSeconds > 86400) throw invalid('轮播间隔需为 5–86400 秒');
          lists.intervalSeconds = body.intervalSeconds;
        }
      } else if (body.action === 'retry') this.resetFailures();
      else throw invalid('不支持的列表操作');
      if (lists.items.length > PLAYLIST_LIMITS.lists) throw invalid('播放列表数量超过上限');
      await this.#store.set({ playlists: lists });
      this.resetFailures();
      await this.#refresh();
      return { config: await this.#store.get(), status: this.status(), unmatchedCount };
    });
  }
  async close() {
    this.#closed = true; clearTimeout(this.#timer); this.#timer = null;
    this.#planned = null;
    await this.#queue; this.#state = 'closed';
  }
}
