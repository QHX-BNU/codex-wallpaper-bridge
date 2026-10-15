import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { createContext, runInContext } from "node:vm";

const rendererSource = await readFile(new URL("../src/renderer/renderer-desktop.mjs", import.meta.url), "utf8");
const controlUrl = "http://127.0.0.1:12345/abcdefghijklmnopqrstuv/";
const turn = () => new Promise((resolve) => setImmediate(resolve));
const copy = (value) => JSON.parse(JSON.stringify(value));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function harness(context, { applyResult, restoreResult, storage = new Map(), url = controlUrl } = {}) {
  const messages = [];
  const listeners = new Map();
  const timers = new Set();
  const calls = { apply: [], restore: [] };
  const frame = {
    src: "",
    contentWindow: { postMessage: (message, origin) => messages.push({ message: copy(message), origin }) },
  };
  const placeholderNodes = { strong: { textContent: "" }, p: { textContent: "" } };
  const placeholder = { hidden: false, querySelector: (selector) => placeholderNodes[selector] };
  const window = {
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    cwbDesktop: {
      getState: async () => ({ installations: [{ id: "isolated-codex" }], selectedId: "isolated-codex", port: 12345, adaptive: true }),
      openControlPanel: async () => ({ ok: true, url }),
      applyCodex: (options) => {
        calls.apply.push(copy(options));
        return applyResult?.promise || Promise.resolve({ ok: true, message: "applied" });
      },
      restore: (options) => {
        calls.restore.push(copy(options));
        return restoreResult?.promise || Promise.resolve({ ok: true });
      },
      onTrayAction: () => {},
    },
    addEventListener: (type, listener) => listeners.set(type, listener),
    setTimeout: (callback, ms) => {
      const timer = setTimeout(() => { timers.delete(timer); callback(); }, ms);
      timers.add(timer);
      return timer;
    },
    clearTimeout: (timer) => { clearTimeout(timer); timers.delete(timer); },
  };
  context.after(() => { for (const timer of timers) clearTimeout(timer); });
  const sandbox = createContext({
    window, URL,
    document: { querySelector: (selector) => selector === "#controlFrame" ? frame : placeholder },
  });
  runInContext(rendererSource, sandbox, { filename: "renderer-desktop.mjs" });
  await turn();
  const expectedUrl = new URL(url);
  expectedUrl.searchParams.set('workbenchTheme', storage.get('cwb.workbench.theme') || 'dark');
  assert.equal(frame.src, expectedUrl.href, "the actual renderer must seed the workbench theme before loading");

  function emit(message) {
    listeners.get("message")({
      source: frame.contentWindow, origin: new URL(url).origin,
      data: { channel: "cwb-control", ...message },
    });
  }
  emit({ type: "ready" });
  return {
    calls, messages, storage, frame,
    emitFrom: (source, origin, message) => listeners.get('message')({ source, origin, data: { channel:'cwb-control', ...message } }),
    snapshot: () => copy(runInContext("desktopPayload()", sandbox)),
    execute: (action, payload = {}) => {
      sandbox.actionInput = action;
      sandbox.payloadInput = payload;
      return runInContext("executeDesktopAction(actionInput, payloadInput)", sandbox);
    },
    flushes: () => messages.filter(({ message }) => message.action === "flush-config"),
    completeFlush: (ok, message) => {
      const request = messages.findLast(({ message: value }) => value.action === "flush-config");
      assert.ok(request, "the actual renderer must request a save handshake");
      emit({ type: "flush-complete", requestId: request.message.requestId, ok, message });
    },
    emit,
  };
}

test("apply remains busy until both the delayed save handshake and apply IPC finish", async (context) => {
  const applyResult = deferred();
  const renderer = await harness(context, { applyResult });
  const operation = renderer.execute("apply");
  await turn();
  assert.equal(renderer.flushes().length, 1);
  assert.equal(renderer.calls.apply.length, 0, "apply must wait for the save response");
  assert.equal(renderer.snapshot().busy, true, "save handshake must retain the busy guard");

  renderer.completeFlush(true);
  await turn();
  assert.deepEqual(renderer.calls.apply, [{ installationId: "isolated-codex", port: 12345, adaptive: true }]);
  assert.equal(renderer.snapshot().busy, true, "in-flight apply IPC must retain the busy guard");
  applyResult.resolve({ ok: true, message: "applied" });
  assert.deepEqual(copy(await operation), { ok: true, message: "applied" });
  assert.equal(renderer.snapshot().busy, false);
  assert.equal(renderer.snapshot().feedbackTone, "success");
});

test('workbench theme persists in the stable desktop origin across bridge port changes without apply IPC', async context => {
  const storage = new Map();
  const first = await harness(context, { storage });
  const messagesBefore = first.messages.length;
  first.emit({ type:'workbench-theme', theme:'light' });
  assert.equal(first.snapshot().workbenchTheme, 'light');
  assert.equal(storage.get('cwb.workbench.theme'), 'light');
  assert.equal(first.calls.apply.length + first.calls.restore.length, 0);
  assert.equal(first.messages.length, messagesBefore, 'changing the theme must not redraw or reset unsaved controls');
  const restarted = await harness(context, { storage, url:'http://127.0.0.1:23456/new-bridge/' });
  assert.equal(new URL(restarted.frame.src).searchParams.get('workbenchTheme'), 'light');
  assert.equal(restarted.snapshot().workbenchTheme, 'light');
});

test('theme messages reject unknown values, foreign origins and non-control sources', async context => {
  const renderer = await harness(context);
  renderer.emit({ type:'workbench-theme', theme:'invalid' });
  renderer.emitFrom({}, new URL(controlUrl).origin, { type:'workbench-theme', theme:'light' });
  renderer.emitFrom(renderer.frame.contentWindow, 'http://127.0.0.1:12346', { type:'workbench-theme', theme:'light' });
  assert.equal(renderer.snapshot().workbenchTheme, 'dark');
  assert.equal(renderer.storage.get('cwb.workbench.theme'), 'dark');
  assert.equal(renderer.flushes().length, 0);
});

test("failed save handshake returns structured failure and never invokes apply IPC", async (context) => {
  const renderer = await harness(context);
  // Capture either outcome immediately so the old rejection is a test failure,
  // not an unhandled promise rejection outside the runtime under test.
  const operation = renderer.execute("apply").then(
    (value) => ({ status: "resolved", value: copy(value) }),
    (error) => ({ status: "rejected", message: error.message }),
  );
  await turn();
  renderer.completeFlush(false, "save failed");
  assert.deepEqual(await operation, { status: "resolved", value: { ok: false, message: "save failed" } });
  assert.equal(renderer.calls.apply.length, 0);
  assert.equal(renderer.snapshot().busy, false);
  assert.equal(renderer.snapshot().feedback, "save failed");
  assert.equal(renderer.snapshot().feedbackTone, "error");
});

test("duplicate apply and restore requests are rejected throughout save and apply IPC", async (context) => {
  const applyResult = deferred();
  const renderer = await harness(context, { applyResult });
  const operation = renderer.execute("apply");
  await turn();
  const duplicate = renderer.execute("apply");
  await turn();
  assert.equal(renderer.flushes().length, 1, "a duplicate must not begin a second save handshake");
  assert.deepEqual(copy(await duplicate), { ok: false, message: "当前操作尚未完成，请稍候" });

  renderer.completeFlush(true);
  await turn();
  assert.deepEqual(copy(await renderer.execute("restore")), { ok: false, message: "当前操作尚未完成，请稍候" });
  assert.equal(renderer.calls.restore.length, 0);
  assert.equal(renderer.calls.apply.length, 1);
  applyResult.resolve({ ok: true });
  await operation;
  assert.equal(renderer.snapshot().busy, false);
});

test("restore keeps the busy guard until its asynchronous IPC has finished", async (context) => {
  const restoreResult = deferred();
  const renderer = await harness(context, { restoreResult });
  const operation = renderer.execute("restore");
  await turn();
  assert.deepEqual(renderer.calls.restore, [{ installationId: "isolated-codex", port: 12345 }]);
  assert.equal(renderer.snapshot().busy, true);
  restoreResult.resolve({ ok: true });
  assert.deepEqual(copy(await operation), { ok: true });
  assert.equal(renderer.snapshot().busy, false);
  assert.equal(renderer.snapshot().feedbackTone, "success");
});

test("restore IPC rejection is caught and returns a recoverable structured failure", async (context) => {
  const restoreResult = deferred();
  const renderer = await harness(context, { restoreResult });
  const operation = renderer.execute("restore").then(
    (value) => ({ status: "resolved", value: copy(value) }),
    (error) => ({ status: "rejected", message: error.message }),
  );
  restoreResult.reject(new Error("restore failed"));
  assert.deepEqual(await operation, { status: "resolved", value: { ok: false, message: "restore failed" } });
  assert.equal(renderer.snapshot().busy, false);
  assert.equal(renderer.snapshot().feedback, "restore failed");
  assert.equal(renderer.snapshot().feedbackTone, "error");
});

test("restore passes an explicitly selected installation and port to its IPC", async (context) => {
  const renderer = await harness(context);
  assert.deepEqual(copy(await renderer.execute("restore", { installationId: "other-isolated-codex", port: 12346 })), { ok: true });
  assert.deepEqual(renderer.calls.restore, [{ installationId: "other-isolated-codex", port: 12346 }]);
});

test("apply displays the specific cancellation reason without claiming that injection succeeded", async (context) => {
  const applyResult = deferred();
  const renderer = await harness(context, { applyResult });
  const operation = renderer.execute("apply");
  await turn();
  renderer.completeFlush(true);
  const message = "已取消，未启动另一版本，原有 Codex 窗口保持不变";
  applyResult.resolve({ ok: true, canceled: true, message });
  assert.deepEqual(copy(await operation), { ok: true, canceled: true, message });
  assert.equal(renderer.snapshot().feedback, message);
  assert.equal(renderer.snapshot().feedbackTone, "idle");
  assert.equal(renderer.snapshot().busy, false);
});
