var cwbAuthorProperties = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // bridge-runtime/src/author-properties-panel.mjs
  var author_properties_panel_exports = {};
  __export(author_properties_panel_exports, {
    createAuthorPropertiesPanel: () => createAuthorPropertiesPanel,
    uploadAuthorDirectory: () => uploadAuthorDirectory
  });

  // bridge-runtime/src/author-directory-upload.mjs
  async function uploadAuthorDirectory({ api, id, key, files, revision, signal, onProgress = () => {
  }, onCommit = () => {
  } }) {
    if (!Array.isArray(files) || !files.length || files.length > 128 || !Number.isSafeInteger(revision) || revision < 0 || files.some((file) => typeof file.name !== "string" || !file.name || file.name.length > 255 || /[\/:\x00-\x1f]/.test(file.name) || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 64 * 1024 ** 2) || files.reduce((sum, file) => sum + file.size, 0) > 256 * 1024 ** 2) throw Error("\u76EE\u5F55\u6587\u4EF6\u6570\u91CF\u6216\u5BB9\u91CF\u8D85\u9650");
    const check = () => signal?.throwIfAborted();
    const scoped = (ms) => signal ? AbortSignal.any([signal, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
    const route = "author-properties/" + encodeURIComponent(id), values = [];
    for (const file of files) {
      check();
      const query = new URLSearchParams({ filename: file.name, revision: String(revision) });
      const result = await api(route + "/directory-file/" + encodeURIComponent(key) + "?" + query, {
        method: "POST",
        body: file,
        signal: scoped(35e3),
        headers: { "Content-Type": "application/octet-stream", "X-CWB-File-Size": String(file.size) }
      });
      check();
      if (typeof result?.value !== "string" || !/^cwb-author-files\/[a-f0-9]{32}-[a-f0-9]{32}-[a-f0-9]{64}\.[a-z0-9]+$/.test(result.value)) throw Error("\u76EE\u5F55\u6587\u4EF6\u5BFC\u5165\u672A\u53D6\u5F97\u53D7\u7BA1\u8D44\u6E90");
      values.push(result.value);
      onProgress({ completed: values.length, total: files.length });
    }
    check();
    onCommit();
    check();
    return api(route + "/directory/" + encodeURIComponent(key), {
      method: "POST",
      body: JSON.stringify({ revision, files: values }),
      signal: scoped(3e4)
    });
  }

  // bridge-runtime/src/author-properties-panel.mjs
  function createAuthorPropertiesPanel({ root, fetchState, saveState, uploadFile = null, uploadDirectory = null, onBusyChange = () => {
  }, onError = () => {
  } }) {
    const doc = root.ownerDocument;
    let selected = null, confirmed = null, epoch = 0, busy = false, refreshRequested = false;
    let importAbort = null, committing = false;
    const setBusy = (value) => {
      busy = value;
      onBusyChange(value);
    };
    const element = (tag, text = "") => {
      const node = doc.createElement(tag);
      node.textContent = text;
      return node;
    };
    const status = element("p"), fields = element("div"), reset = element("button", "\u6062\u590D\u4F5C\u8005\u9ED8\u8BA4\u503C"), refresh = element("button", "\u91CD\u65B0\u8BFB\u53D6");
    const cancel = element("button", "\u53D6\u6D88\u76EE\u5F55\u5BFC\u5165");
    cancel.type = "button";
    cancel.className = "text-button";
    cancel.hidden = true;
    cancel.dataset.authorDirectoryCancel = "";
    cancel.addEventListener("click", () => {
      if (!committing) importAbort?.abort();
    });
    status.className = "effect-hint";
    status.setAttribute("aria-live", "polite");
    fields.className = "author-property-fields";
    fields.dataset.authorFields = "";
    reset.type = refresh.type = "button";
    reset.className = refresh.className = "text-button";
    reset.dataset.authorReset = "";
    refresh.dataset.authorRefresh = "";
    root.replaceChildren(element("summary", "WE \u4F5C\u8005\u5C5E\u6027"), status, fields, reset, refresh, cancel);
    const message = (state) => {
      if (state.live?.phase === "failed") return "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\uFF0C\u4F46\u5B9E\u65F6\u5F15\u64CE\u5E94\u7528\u5931\u8D25\uFF1B\u5C1A\u672A\u53D6\u5F97\u5B9E\u9645\u8BFB\u56DE\u3002";
      if (state.live?.phase === "unsupported") return "\u8BE5\u4F5C\u8005\u672A\u5B9E\u73B0\u5C5E\u6027\u56DE\u8C03\uFF1B\u4FDD\u5B58\u503C\u4E0D\u4EE3\u8868\u5B9E\u9645\u6548\u679C\u652F\u6301\u3002";
      if (state.live?.phase !== "ready") return "\u6BCF\u5F20\u58C1\u7EB8\u72EC\u7ACB\u4FDD\u5B58\uFF1B\u5F53\u524D\u672A\u53D6\u5F97\u6709\u6548\u5F15\u64CE\u8BFB\u56DE\uFF0C\u4E0D\u5C06\u4FDD\u5B58\u503C\u89C6\u4E3A\u5B9E\u9645\u8BFB\u56DE\u3002";
      if (state.live.method === "engine-readback" && state.live.source === "workbench-preview") {
        return "\u5DF2\u53D6\u5F97\u5DE5\u4F5C\u53F0 Scene \u5F15\u64CE\u5B9E\u9645\u5C5E\u6027\u8BFB\u56DE\uFF1B\u4E0D\u4EE3\u8868 Codex \u5BBF\u4E3B\u9A8C\u6536\u3002";
      }
      return state.live.method === "engine-readback" ? "\u5DF2\u53D6\u5F97\u573A\u666F\u5F15\u64CE\u5B9E\u9645\u5C5E\u6027\u8BFB\u56DE\u3002" : "\u5DF2\u4EA4\u4ED8\u4F5C\u8005\u56DE\u8C03\uFF1B\u4E0D\u7B49\u540C\u4E8E\u5B9E\u9645\u6548\u679C\u8BFB\u56DE\u3002";
    };
    const disable = (value) => {
      for (const input of fields.querySelectorAll("input, select, button")) input.disabled = value || input.dataset.fileUnavailable === "true";
      reset.disabled = value || !confirmed || !Object.keys(confirmed.schema).length;
      refresh.disabled = value;
      cancel.hidden = !importAbort;
      cancel.disabled = !importAbort || committing;
    };
    const finishBusy = (version) => {
      if (version !== epoch) return;
      setBusy(false);
      disable(false);
      if (refreshRequested) {
        refreshRequested = false;
        void load();
      }
    };
    const edit = async (operation, transfer = false) => {
      if (busy || !confirmed || !selected) return { ok: false };
      const identity = selected.id, version = epoch, before = confirmed;
      const controller = transfer ? new AbortController() : null;
      if (controller) {
        importAbort = controller;
        committing = false;
      }
      setBusy(true);
      disable(true);
      status.textContent = "\u6B63\u5728\u4FDD\u5B58\u4F5C\u8005\u5C5E\u6027\u2026";
      try {
        const next = await operation(identity, before.revision, controller?.signal, {
          onProgress({ completed, total }) {
            if (version === epoch && !controller?.signal.aborted) status.textContent = `\u76EE\u5F55\u5BFC\u5165 ${completed}/${total}\uFF1B\u539F\u8BBE\u7F6E\u5C1A\u672A\u66FF\u6362\u3002`;
          },
          onCommit() {
            if (version === epoch) {
              committing = true;
              cancel.disabled = true;
              status.textContent = "\u6B63\u5728\u63D0\u4EA4\u76EE\u5F55\u9009\u62E9\u2026";
            }
          }
        });
        if (version === epoch && selected?.id === identity) {
          confirmed = next;
          render();
        }
        return { ok: true };
      } catch (error) {
        if (version === epoch) {
          confirmed = before;
          render();
          status.textContent = controller?.signal.aborted ? "\u76EE\u5F55\u5BFC\u5165\u5DF2\u53D6\u6D88\uFF0C\u539F\u8BBE\u7F6E\u5DF2\u4FDD\u7559\u3002" : "\u4FDD\u5B58\u5931\u8D25\uFF0C\u5DF2\u6062\u590D\u4E0A\u6B21\u786E\u8BA4\u503C\u3002";
          if (!controller?.signal.aborted) onError(error);
        }
        return { ok: false };
      } finally {
        if (importAbort === controller) {
          importAbort = null;
          committing = false;
        }
        finishBusy(version);
      }
    };
    const save = (values, defaults = false) => edit((id, revision) => saveState(id, { revision, ...defaults ? { reset: true } : { values } }));
    const saveFile = (key, file) => {
      if (!file || !uploadFile) return Promise.resolve({ ok: false });
      const spec = confirmed?.schema[key];
      if (spec?.type !== "file" || !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 64 * 1024 ** 2 || typeof file.name !== "string" || !spec.extensions.some((ext) => file.name.toLowerCase().endsWith(ext))) {
        onError(Error("\u8BF7\u9009\u62E9\u53D7\u652F\u6301\u4E14\u4E0D\u8D85\u8FC7 64 MiB \u7684\u6587\u4EF6"));
        return Promise.resolve({ ok: false });
      }
      return edit((id, revision) => uploadFile(id, key, file, revision));
    };
    const saveDirectory = (key, selection) => {
      if (busy || !confirmed || !selected || !uploadDirectory || !selection?.length) return Promise.resolve({ ok: false });
      const spec = confirmed.schema[key];
      if (spec?.type !== "directory" || selection.length > 1024) {
        onError(Error("\u8BF7\u9009\u62E9\u5305\u542B\u53D7\u652F\u6301\u5A92\u4F53\u7684\u6709\u754C\u76EE\u5F55"));
        return Promise.resolve({ ok: false });
      }
      const files = Array.from(selection).filter((file) => typeof file.name === "string" && spec.extensions.some((ext) => file.name.toLowerCase().endsWith(ext)));
      if (!files.length || files.length > 128 || files.some((file) => !Number.isSafeInteger(file.size) || file.size <= 0 || file.size > 64 * 1024 ** 2) || files.reduce((sum, file) => sum + file.size, 0) > 256 * 1024 ** 2) {
        onError(Error("\u76EE\u5F55\u6700\u591A128\u4E2A\u5A92\u4F53\u6587\u4EF6\u3001\u5408\u8BA1256 MiB\uFF0C\u5355\u6587\u4EF6\u4E0D\u8D85\u8FC764 MiB"));
        return Promise.resolve({ ok: false });
      }
      return edit((id, revision, signal, progress) => uploadDirectory(id, key, files, revision, { signal, ...progress }), true);
    };
    const render = () => {
      fields.replaceChildren();
      if (!confirmed) return;
      status.textContent = message(confirmed) + (confirmed.discarded ? " \u4F5C\u8005\u5B9A\u4E49\u5DF2\u53D8\u5316\uFF0C\u5931\u6548\u65E7\u503C\u5DF2\u5FFD\u7565\u3002" : "");
      if (!Object.keys(confirmed.schema).length) {
        status.textContent = "\u6B64\u58C1\u7EB8\u6CA1\u6709\u53D7\u652F\u6301\u7684\u4F5C\u8005\u5C5E\u6027\u3002";
        disable(busy);
        return;
      }
      let index = 0;
      for (const [key, spec] of Object.entries(confirmed.schema)) {
        const row = element("div"), label = element("label", spec.label), readback = element("output");
        row.className = "author-property-row";
        row.dataset.authorProperty = key;
        const value = confirmed.values[key];
        const live = confirmed.live?.values?.[key];
        readback.textContent = confirmed.live?.method === "engine-readback" && live !== void 0 ? `\u5B9E\u9645\uFF1A${live}` : "\u5B9E\u9645\u8BFB\u56DE\uFF1A\u672A\u53D6\u5F97";
        readback.className = "author-property-readback";
        let input;
        if (spec.type === "file" || spec.type === "directory") {
          const directory = spec.type === "directory";
          const group = element("div"), picker = element("input"), current = element("span"), clear = element("button", "\u6E05\u7A7A");
          group.className = "author-file-controls";
          picker.type = "file";
          picker.accept = spec.extensions.join(",");
          if (directory) {
            picker.multiple = true;
            picker.webkitdirectory = true;
            picker.setAttribute("webkitdirectory", "");
          }
          picker.id = "cwb-author-input-" + index++;
          label.htmlFor = picker.id;
          picker.dataset.fileUnavailable = String(!(directory ? uploadDirectory : uploadFile) || confirmed.fileSelectionAvailable === false);
          picker.setAttribute("aria-label", spec.label);
          current.textContent = value ? value.startsWith(directory ? "cwb-author-directories/" : "cwb-author-files/") ? `\u5DF2\u9009\u53D7\u7BA1${directory ? "\u76EE\u5F55" : "\u6587\u4EF6"}\uFF1A\u2026` + value.slice(-20) : `\u4F5C\u8005\u9ED8\u8BA4${directory ? "\u76EE\u5F55" : "\u6587\u4EF6"}\uFF1A` + value : `\u672A\u9009\u62E9${directory ? "\u76EE\u5F55" : "\u6587\u4EF6"}`;
          clear.type = "button";
          clear.className = "text-button";
          clear.dataset.authorFileClear = key;
          picker.addEventListener("change", () => {
            if (directory) void saveDirectory(key, picker.files);
            else {
              const file = picker.files?.[0];
              if (file) void saveFile(key, file);
            }
          });
          clear.addEventListener("click", () => {
            void save({ [key]: "" });
          });
          group.append(picker, current, clear);
          input = group;
        } else if (spec.type === "color") {
          const channels = String(value).split(/\s+/).map(Number), group = element("div");
          group.className = "author-color";
          for (let i = 0; i < 3; i++) {
            const channel = element("input");
            channel.type = "number";
            channel.min = "0";
            channel.max = "1";
            channel.step = "any";
            channel.value = channels[i];
            channel.setAttribute("aria-label", `${spec.label} ${["R", "G", "B"][i]}`);
            channel.addEventListener("change", () => {
              if (channel.checkValidity && !channel.checkValidity()) return;
              channels[i] = Number(channel.value);
              void save({ [key]: channels.join(" ") });
            });
            group.append(channel);
          }
          input = group;
        } else {
          input = element(spec.type === "combo" ? "select" : "input");
          if (spec.type === "combo") {
            spec.options.forEach((option, i) => {
              const node = element("option", option.label);
              node.value = String(i);
              input.append(node);
            });
            input.value = String(spec.options.findIndex((option) => option.value === value));
          } else if (spec.type === "bool") {
            input.type = "checkbox";
            input.checked = value;
          } else if (spec.type === "slider") {
            input.type = "number";
            input.min = spec.min;
            input.max = spec.max;
            input.step = spec.integer ? "1" : "any";
            input.value = value;
          } else {
            input.type = "text";
            input.maxLength = 1024;
            input.value = value;
          }
          input.id = "cwb-author-input-" + index++;
          label.htmlFor = input.id;
          input.addEventListener("change", () => {
            if (input.checkValidity && !input.checkValidity()) return;
            const value2 = spec.type === "bool" ? input.checked : spec.type === "slider" ? Number(input.value) : spec.type === "combo" ? spec.options[Number(input.value)]?.value : input.value;
            void save({ [key]: value2 });
          });
        }
        row.append(label, input, readback);
        fields.append(row);
      }
      disable(busy);
    };
    const load = async () => {
      if (busy || !selected) return;
      const version = epoch, identity = selected.id;
      setBusy(true);
      disable(true);
      status.textContent = "\u6B63\u5728\u8BFB\u53D6\u4F5C\u8005\u5C5E\u6027\u2026";
      try {
        const value = await fetchState(identity);
        if (version === epoch) {
          confirmed = value;
          render();
        }
      } catch (error) {
        if (version === epoch) {
          status.textContent = "\u4F5C\u8005\u5C5E\u6027\u8BFB\u53D6\u5931\u8D25\u3002";
          onError(error);
        }
      } finally {
        finishBusy(version);
      }
    };
    reset.addEventListener("click", () => {
      void save(null, true);
    });
    refresh.addEventListener("click", () => {
      void load();
    });
    return {
      select(project) {
        const next = project && ["scene", "web"].includes(project.type) && project.eligible !== false ? project : null;
        if (next?.id === selected?.id) return Promise.resolve();
        importAbort?.abort();
        importAbort = null;
        committing = false;
        cancel.hidden = true;
        epoch++;
        selected = next;
        confirmed = null;
        setBusy(false);
        refreshRequested = false;
        root.hidden = !next;
        fields.replaceChildren();
        disable(false);
        return next ? load() : Promise.resolve();
      },
      refresh: load,
      refreshWhenIdle() {
        if (!selected) return Promise.resolve();
        if (busy) {
          refreshRequested = true;
          return Promise.resolve();
        }
        return load();
      },
      save,
      saveFile,
      saveDirectory,
      status: () => ({ id: selected?.id ?? null, busy, values: confirmed ? { ...confirmed.values } : null, live: confirmed?.live })
    };
  }
  return __toCommonJS(author_properties_panel_exports);
})();
