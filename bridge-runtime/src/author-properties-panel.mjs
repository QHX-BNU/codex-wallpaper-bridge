export { uploadAuthorDirectory } from './author-directory-upload.mjs';

/** DOM-only control panel. Confirmed values remain separate from pending edits and live telemetry. */
export function createAuthorPropertiesPanel({ root, fetchState, saveState, uploadFile = null, uploadDirectory = null, onBusyChange = () => {}, onError = () => {} }) {
  const doc = root.ownerDocument;
  let selected = null, confirmed = null, epoch = 0, busy = false, refreshRequested = false;
  let importAbort = null, committing = false;
  const setBusy = value => { busy = value; onBusyChange(value); };
  const element = (tag, text = '') => { const node = doc.createElement(tag); node.textContent = text; return node; };
  const status = element('p'), fields = element('div'), reset = element('button', '恢复作者默认值'), refresh = element('button', '重新读取');
  const cancel = element('button', '取消目录导入'); cancel.type = 'button'; cancel.className = 'text-button'; cancel.hidden = true;
  cancel.dataset.authorDirectoryCancel = ''; cancel.addEventListener('click', () => { if (!committing) importAbort?.abort(); });
  status.className = 'effect-hint'; status.setAttribute('aria-live', 'polite');
  fields.className = 'author-property-fields'; fields.dataset.authorFields = '';
  reset.type = refresh.type = 'button'; reset.className = refresh.className = 'text-button';
  reset.dataset.authorReset = ''; refresh.dataset.authorRefresh = '';
  root.replaceChildren(element('summary', 'WE 作者属性'), status, fields, reset, refresh, cancel);
  const message = (state) => {
    if (state.live?.phase === 'failed') return '设置已保存，但实时引擎应用失败；尚未取得实际读回。';
    if (state.live?.phase === 'unsupported') return '该作者未实现属性回调；保存值不代表实际效果支持。';
    if (state.live?.phase !== 'ready') return '每张壁纸独立保存；当前未取得有效引擎读回，不将保存值视为实际读回。';
    if (state.live.method === 'engine-readback' && state.live.source === 'workbench-preview') {
      return '已取得工作台 Scene 引擎实际属性读回；不代表 Codex 宿主验收。';
    }
    return state.live.method === 'engine-readback' ? '已取得场景引擎实际属性读回。' : '已交付作者回调；不等同于实际效果读回。';
  };
  const disable = (value) => {
    for (const input of fields.querySelectorAll('input, select, button')) input.disabled = value || input.dataset.fileUnavailable === 'true';
    reset.disabled = value || !confirmed || !Object.keys(confirmed.schema).length;
    refresh.disabled = value;
    cancel.hidden = !importAbort; cancel.disabled = !importAbort || committing;
  };
  const finishBusy = (version) => {
    if (version !== epoch) return;
    setBusy(false); disable(false);
    if (refreshRequested) { refreshRequested = false; void load(); }
  };
  const edit = async (operation, transfer = false) => {
    if (busy || !confirmed || !selected) return { ok: false };
    const identity = selected.id, version = epoch, before = confirmed;
    const controller = transfer ? new AbortController() : null;
    if (controller) { importAbort = controller; committing = false; }
    setBusy(true); disable(true); status.textContent = '正在保存作者属性…';
    try {
      const next = await operation(identity, before.revision, controller?.signal, {
        onProgress({ completed, total }) { if (version === epoch && !controller?.signal.aborted) status.textContent = `目录导入 ${completed}/${total}；原设置尚未替换。`; },
        onCommit() { if (version === epoch) { committing = true; cancel.disabled = true; status.textContent = '正在提交目录选择…'; } },
      });
      if (version === epoch && selected?.id === identity) { confirmed = next; render(); }
      return { ok: true };
    } catch (error) {
      if (version === epoch) {
        confirmed = before; render(); status.textContent = controller?.signal.aborted ? '目录导入已取消，原设置已保留。' : '保存失败，已恢复上次确认值。';
        if (!controller?.signal.aborted) onError(error);
      }
      return { ok: false };
    } finally {
      if (importAbort === controller) { importAbort = null; committing = false; }
      finishBusy(version);
    }
  };
  const save = (values, defaults = false) => edit((id, revision) => saveState(id, { revision, ...(defaults ? { reset: true } : { values }) }));
  const saveFile = (key, file) => {
    if (!file || !uploadFile) return Promise.resolve({ ok: false });
    const spec = confirmed?.schema[key];
    if (spec?.type !== 'file' || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 64 * 1024 ** 2
      || typeof file.name !== 'string' || !spec.extensions.some(ext => file.name.toLowerCase().endsWith(ext))) {
      onError(Error('请选择受支持且不超过 64 MiB 的文件')); return Promise.resolve({ ok: false });
    }
    return edit((id, revision) => uploadFile(id, key, file, revision));
  };
  const saveDirectory = (key, selection) => {
    if (busy || !confirmed || !selected || !uploadDirectory || !selection?.length) return Promise.resolve({ ok: false });
    const spec = confirmed.schema[key];
    if (spec?.type !== 'directory' || selection.length > 1024) { onError(Error('请选择包含受支持媒体的有界目录')); return Promise.resolve({ ok: false }); }
    const files = Array.from(selection).filter(file => typeof file.name === 'string' && spec.extensions.some(ext => file.name.toLowerCase().endsWith(ext)));
    if (!files.length || files.length > 128 || files.some(file => !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 64 * 1024 ** 2)
      || files.reduce((sum, file) => sum + file.size, 0) > 256 * 1024 ** 2) {
      onError(Error('目录最多128个媒体文件、合计256 MiB，单文件不超过64 MiB')); return Promise.resolve({ ok: false });
    }
    return edit((id, revision, signal, progress) => uploadDirectory(id, key, files, revision, { signal, ...progress }), true);
  };
  const render = () => {
    fields.replaceChildren();
    if (!confirmed) return;
    status.textContent = message(confirmed) + (confirmed.discarded ? ' 作者定义已变化，失效旧值已忽略。' : '');
    if (!Object.keys(confirmed.schema).length) { status.textContent = '此壁纸没有受支持的作者属性。'; disable(busy); return; }
    let index = 0;
    for (const [key, spec] of Object.entries(confirmed.schema)) {
      const row = element('div'), label = element('label', spec.label), readback = element('output');
      row.className = 'author-property-row'; row.dataset.authorProperty = key;
      const value = confirmed.values[key];
      const live = confirmed.live?.values?.[key];
      readback.textContent = confirmed.live?.method === 'engine-readback' && live !== undefined ? `实际：${live}` : '实际读回：未取得';
      readback.className = 'author-property-readback';
      let input;
      if (spec.type === 'file' || spec.type === 'directory') {
        const directory = spec.type === 'directory';
        const group = element('div'), picker = element('input'), current = element('span'), clear = element('button', '清空');
        group.className = 'author-file-controls'; picker.type = 'file'; picker.accept = spec.extensions.join(',');
        if (directory) { picker.multiple = true; picker.webkitdirectory = true; picker.setAttribute('webkitdirectory', ''); }
        picker.id = 'cwb-author-input-' + index++; label.htmlFor = picker.id;
        picker.dataset.fileUnavailable = String(!(directory ? uploadDirectory : uploadFile) || confirmed.fileSelectionAvailable === false);
        picker.setAttribute('aria-label', spec.label);
        current.textContent = value ? (value.startsWith(directory ? 'cwb-author-directories/' : 'cwb-author-files/')
          ? `已选受管${directory ? '目录' : '文件'}：…` + value.slice(-20) : `作者默认${directory ? '目录' : '文件'}：` + value) : `未选择${directory ? '目录' : '文件'}`;
        clear.type = 'button'; clear.className = 'text-button'; clear.dataset.authorFileClear = key;
        picker.addEventListener('change', () => { if (directory) void saveDirectory(key, picker.files); else { const file = picker.files?.[0]; if (file) void saveFile(key, file); } });
        clear.addEventListener('click', () => { void save({ [key]: '' }); });
        group.append(picker, current, clear); input = group;
      } else if (spec.type === 'color') {
        const channels = String(value).split(/\s+/).map(Number), group = element('div'); group.className = 'author-color';
        for (let i = 0; i < 3; i++) {
          const channel = element('input'); channel.type = 'number'; channel.min = '0'; channel.max = '1'; channel.step = 'any'; channel.value = channels[i];
          channel.setAttribute('aria-label', `${spec.label} ${['R', 'G', 'B'][i]}`);
          channel.addEventListener('change', () => {
            if (channel.checkValidity && !channel.checkValidity()) return;
            channels[i] = Number(channel.value); void save({ [key]: channels.join(' ') });
          }); group.append(channel);
        }
        input = group;
      } else {
        input = element(spec.type === 'combo' ? 'select' : 'input');
        if (spec.type === 'combo') {
          spec.options.forEach((option, i) => { const node = element('option', option.label); node.value = String(i); input.append(node); });
          input.value = String(spec.options.findIndex((option) => option.value === value));
        } else if (spec.type === 'bool') { input.type = 'checkbox'; input.checked = value; }
        else if (spec.type === 'slider') { input.type = 'number'; input.min = spec.min; input.max = spec.max; input.step = spec.integer ? '1' : 'any'; input.value = value; }
        else { input.type = 'text'; input.maxLength = 1024; input.value = value; }
        input.id = 'cwb-author-input-' + index++; label.htmlFor = input.id;
        input.addEventListener('change', () => {
          if (input.checkValidity && !input.checkValidity()) return;
          const value = spec.type === 'bool' ? input.checked : spec.type === 'slider' ? Number(input.value)
            : spec.type === 'combo' ? spec.options[Number(input.value)]?.value : input.value;
          void save({ [key]: value });
        });
      }
      row.append(label, input, readback); fields.append(row);
    }
    disable(busy);
  };
  const load = async () => {
    if (busy || !selected) return;
    const version = epoch, identity = selected.id;
    setBusy(true); disable(true); status.textContent = '正在读取作者属性…';
    try { const value = await fetchState(identity); if (version === epoch) { confirmed = value; render(); } }
    catch (error) { if (version === epoch) { status.textContent = '作者属性读取失败。'; onError(error); } }
    finally { finishBusy(version); }
  };
  reset.addEventListener('click', () => { void save(null, true); });
  refresh.addEventListener('click', () => { void load(); });
  return {
    select(project) {
      const next = project && ['scene', 'web'].includes(project.type) && project.eligible !== false ? project : null;
      if (next?.id === selected?.id) return Promise.resolve();
      importAbort?.abort(); importAbort = null; committing = false; cancel.hidden = true;
      epoch++; selected = next; confirmed = null; setBusy(false); refreshRequested = false;
      root.hidden = !next; fields.replaceChildren(); disable(false);
      return next ? load() : Promise.resolve();
    },
    refresh: load,
    refreshWhenIdle() {
      if (!selected) return Promise.resolve();
      if (busy) { refreshRequested = true; return Promise.resolve(); }
      return load();
    },
    save,
    saveFile,
    saveDirectory,
    status: () => ({ id: selected?.id ?? null, busy, values: confirmed ? { ...confirmed.values } : null, live: confirmed?.live }),
  };
}
