import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import test from "node:test";
import {
  createPreviewSession,
  stopPreviewProcess,
  waitForPreviewExit,
} from "../src/preview-session.mjs";

const controlUrl = (port) => `http://127.0.0.1:${port}/1234567890abcdef1234567890abcdef/`;
const tick = () => new Promise((resolve) => setImmediate(resolve));

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}

function childProcess({ autoExit = true } = {}) {
  const child = new EventEmitter();
  child.killCount = 0;
  // Electron UtilityProcess intentionally has neither killed nor exitCode.
  child.kill = () => {
    child.killCount += 1;
    if (autoExit) child.emit("exit", 0);
    return true;
  };
  return child;
}

function sessionOptions(overrides = {}) {
  return {
    start: async (port, { onChild }) => {
      const child = childProcess();
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    validateUrl: (url) => url,
    ...overrides,
  };
}

test("same-port concurrent ensures start once and reuse the live utility process", async () => {
  const started = [];
  const child = childProcess();
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      started.push(port);
      onChild(child);
      await tick();
      return { child, url: controlUrl(port) };
    },
  }));
  const results = await Promise.all([session.ensure(9335), session.ensure("9335")]);
  assert.deepEqual(started, [9335]);
  assert.deepEqual(results, [
    { url: controlUrl(9335), reused: false },
    { url: controlUrl(9335), reused: true },
  ]);
  await session.close();
  assert.equal(child.killCount, 1);
});

test("switching ports waits for the old process exit before starting another", async () => {
  const firstChild = childProcess({ autoExit: false });
  const secondChild = childProcess();
  const started = [];
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      started.push(port);
      const child = port === 9335 ? firstChild : secondChild;
      onChild(child);
      return { child, url: controlUrl(port) };
    },
  }));
  await session.ensure(9335);
  const switchPort = session.ensure(9446);
  await tick();
  assert.equal(firstChild.killCount, 1);
  assert.deepEqual(started, [9335]);
  firstChild.emit("exit", 0);
  assert.deepEqual(await switchPort, { url: controlUrl(9446), reused: false });
  assert.deepEqual(started, [9335, 9446]);
  await session.close();
});

test("unexpected exit invalidates only the matching active session and notifies once", async () => {
  const children = [];
  const disconnected = [];
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      const child = childProcess();
      children.push(child);
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    onDisconnected: (detail) => disconnected.push(detail),
  }));
  await session.ensure(9335);
  children[0].emit("exit", 7);
  assert.equal(disconnected.length, 1);
  assert.equal(disconnected[0].port, 9335);
  assert.equal(disconnected[0].code, 7);
  assert.equal((await session.ensure(9335)).reused, false);
  children[0].emit("exit", 8);
  assert.equal((await session.ensure(9335)).reused, true);
  assert.equal(disconnected.length, 1);
  await session.close();
  assert.equal(disconnected.length, 1);
});

test("close is serial with an in-flight start and permits a later restart", async () => {
  const ready = deferred();
  const child = childProcess();
  let starts = 0;
  let disconnects = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      starts += 1;
      const active = starts === 1 ? child : childProcess();
      onChild(active);
      if (starts === 1) await ready.promise;
      return { child: active, url: controlUrl(port) };
    },
    onDisconnected: () => { disconnects += 1; },
  }));
  const ensure = session.ensure(9335);
  await tick();
  const close = session.close();
  ready.resolve();
  await ensure;
  await close;
  assert.equal(child.killCount, 1);
  assert.equal(disconnects, 0);
  assert.equal((await session.ensure(9335)).reused, false);
  await session.close();
});

test("shutdown seals immediately and cleans a start that completes after shutdown", async () => {
  const ready = deferred();
  const child = childProcess();
  let starts = 0;
  let disconnects = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      starts += 1;
      onChild(child);
      await ready.promise;
      return { child, url: controlUrl(port) };
    },
    onDisconnected: () => { disconnects += 1; },
  }));
  const ensure = session.ensure(9335);
  const rejectedEnsure = assert.rejects(ensure, /退出|关闭/);
  await tick();
  const shutdown = session.shutdown();
  await assert.rejects(session.ensure(9446), /退出|关闭/);
  ready.resolve();
  await rejectedEnsure;
  await shutdown;
  assert.equal(starts, 1);
  assert.equal(child.killCount, 1);
  assert.equal(disconnects, 0);
  await session.close();
  await session.shutdown();
  await assert.rejects(session.ensure(9335), /退出|关闭/);
});

test("ensures queued before shutdown cannot start after shutdown is submitted", async () => {
  const ready = deferred();
  const children = [];
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      const child = childProcess();
      children.push(child);
      onChild(child);
      await ready.promise;
      return { child, url: controlUrl(port) };
    },
  }));
  const first = assert.rejects(session.ensure(9335), /退出|关闭/);
  const second = assert.rejects(session.ensure(9446), /退出|关闭/);
  await tick();
  const shutdown = session.shutdown();
  ready.resolve();
  await Promise.all([first, second, shutdown]);
  assert.equal(children.length, 1);
  assert.equal(children[0].killCount, 1);
});

test("an exit while startup is pending is observed even without UtilityProcess exitCode", async () => {
  const ready = deferred();
  const child = childProcess();
  let disconnects = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      onChild(child);
      await ready.promise;
      return { child, url: controlUrl(port) };
    },
    onDisconnected: () => { disconnects += 1; },
  }));
  const ensure = assert.rejects(session.ensure(9335), /退出/);
  await tick();
  child.emit("exit", 3);
  ready.resolve();
  await ensure;
  assert.equal(child.killCount, 0);
  assert.equal(disconnects, 0);
  await session.close();
});

test("an exit during asynchronous URL validation is not registered as a live session", async () => {
  const validation = deferred();
  const child = childProcess();
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    validateUrl: async (url) => { await validation.promise; return url; },
  }));
  const ensure = assert.rejects(session.ensure(9335), /退出/);
  await tick();
  child.emit("exit", 0);
  validation.resolve();
  await ensure;
  await session.close();
});

test("startup failure stops the reported child and allows a clean retry", async () => {
  const firstChild = childProcess();
  const secondChild = childProcess();
  let starts = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      const child = ++starts === 1 ? firstChild : secondChild;
      onChild(child);
      if (starts === 1) throw new Error("startup failed");
      return { child, url: controlUrl(port) };
    },
  }));
  await assert.rejects(session.ensure(9335), /startup failed/);
  assert.equal(firstChild.killCount, 1);
  assert.equal((await session.ensure(9335)).reused, false);
  assert.equal(starts, 2);
  await session.close();
});

test("startup failures before a child exists also leave the queue retryable", async () => {
  let attempts = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port) => {
      if (++attempts === 1) throw new Error("spawn failed");
      return { child: childProcess(), url: controlUrl(port) };
    },
  }));
  await assert.rejects(session.ensure(9335), /spawn failed/);
  assert.equal((await session.ensure(9335)).reused, false);
  await session.close();
});

test("invalid startup URL stops the owned process instead of leaking it", async () => {
  const child = childProcess();
  const session = createPreviewSession(sessionOptions({
    start: async () => ({ child, url: "http://untrusted.example/" }),
    validateUrl: () => { throw new Error("untrusted URL"); },
  }));
  await assert.rejects(session.ensure(9335), /untrusted URL/);
  assert.equal(child.killCount, 1);
  await session.close();
});

test("failed process stop keeps ownership and blocks replacement until cleanup succeeds", async () => {
  const child = childProcess();
  let starts = 0;
  let stops = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      starts += 1;
      const active = starts === 1 ? child : childProcess();
      onChild(active);
      return { child: active, url: controlUrl(port) };
    },
    stop: async (active) => {
      if (++stops < 3) throw new Error("stop failed");
      await stopPreviewProcess(active);
    },
  }));
  await session.ensure(9335);
  await assert.rejects(session.ensure(9446), /stop failed/);
  await assert.rejects(session.ensure(9446), /stop failed/);
  assert.equal(starts, 1);
  await session.close();
  assert.equal(child.killCount, 1);
  await session.ensure(9446);
  assert.equal(starts, 2);
  await session.close();
});

test("failed shutdown remains sealed but cleanup can be retried", async () => {
  const child = childProcess();
  let stops = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    stop: async (active) => {
      if (++stops === 1) throw new Error("stop failed");
      return stopPreviewProcess(active);
    },
  }));
  await session.ensure(9335);
  await assert.rejects(session.shutdown(), /stop failed/);
  await assert.rejects(session.ensure(9335), /退出|关闭/);
  await session.shutdown();
  assert.equal(child.killCount, 1);
});

test("unconfirmed custom stop cannot discard ownership or start a replacement", async () => {
  const child = childProcess();
  let starts = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      starts += 1;
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    stop: async () => {},
  }));
  await session.ensure(9335);
  await assert.rejects(session.ensure(9446), /退出/);
  assert.equal(starts, 1);
  child.emit("exit", 0);
  await session.close();
});

test("cleanup failure preserves both startup error and process ownership", async () => {
  const child = childProcess();
  let stopFails = true;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      onChild(child);
      throw new Error("startup failed");
    },
    stop: async (active) => {
      if (stopFails) throw new Error("cleanup failed");
      return stopPreviewProcess(active);
    },
  }));
  await assert.rejects(session.ensure(9335), (error) => {
    assert.ok(error instanceof AggregateError);
    assert.match(error.message, /startup failed/);
    assert.match(error.message, /cleanup failed/);
    return true;
  });
  stopFails = false;
  await session.close();
  assert.equal(child.killCount, 1);
});

test("invalid ports do not invoke startup or break the queue", async () => {
  let starts = 0;
  const options = sessionOptions();
  const session = createPreviewSession({ ...options, start: (...args) => { starts += 1; return options.start(...args); } });
  for (const port of [0, 1023, 65536, 9335.2, "invalid"]) {
    await assert.rejects(session.ensure(port), /端口/);
  }
  assert.equal(starts, 0);
  await session.ensure(9335);
  await session.close();
});

test("stop helper waits for UtilityProcess exit rather than relying on killed", async () => {
  const child = childProcess({ autoExit: false });
  let stopped = false;
  const stop = stopPreviewProcess(child, { timeoutMs: 1000 }).then(() => { stopped = true; });
  await tick();
  assert.equal(stopped, false);
  assert.equal(child.killCount, 1);
  child.emit("exit", 0);
  await stop;
  assert.equal(stopped, true);
  await stopPreviewProcess(child);
  assert.equal(child.killCount, 1);
});

test("stop helper handles synchronous kill exit without missing the event", async () => {
  const child = childProcess();
  const exit = await stopPreviewProcess(child);
  assert.equal(exit.code, 0);
  assert.equal(child.killCount, 1);
});

test("exit timeout is finite, is retryable, and never kills an unrelated process", async () => {
  const owned = childProcess({ autoExit: false });
  const unrelated = childProcess();
  await assert.rejects(stopPreviewProcess(owned, { timeoutMs: 10 }), /退出.*超时/);
  assert.equal(owned.killCount, 1);
  assert.equal(unrelated.killCount, 0);
  owned.emit("exit", 0);
  await stopPreviewProcess(owned);
  assert.equal(owned.killCount, 1);
});

test("stop helper surfaces kill refusal and synchronous kill errors without a dangling timer", async () => {
  const refused = childProcess({ autoExit: false });
  refused.kill = () => false;
  await assert.rejects(stopPreviewProcess(refused, { timeoutMs: 1000 }), /停止/);
  refused.emit("exit", 0);
  const failed = childProcess({ autoExit: false });
  failed.kill = () => { throw new Error("kill failed"); };
  await assert.rejects(stopPreviewProcess(failed, { timeoutMs: 1000 }), /kill failed/);
  failed.emit("exit", 0);
});

test("wait helper observes process error and can later wait for actual exit", async () => {
  const child = childProcess({ autoExit: false });
  const rejected = assert.rejects(waitForPreviewExit(child, { timeoutMs: 1000 }), /utility failure/);
  child.emit("error", { report: "utility failure" });
  await rejected;
  const exit = waitForPreviewExit(child, { timeoutMs: 1000 });
  child.emit("exit", 2);
  assert.equal((await exit).code, 2);
  assert.equal(child.killCount, 0);
});

test("already-exited Node child does not receive another kill request", async () => {
  const child = childProcess({ autoExit: false });
  child.exitCode = 0;
  assert.equal((await stopPreviewProcess(child)).code, 0);
  assert.equal(child.killCount, 0);
});

test("nonzero exit and signal still count as confirmed process termination", async () => {
  const child = childProcess({ autoExit: false });
  const stop = stopPreviewProcess(child, { timeoutMs: 1000 });
  child.emit("exit", null, "SIGTERM");
  assert.deepEqual(await stop, { code: null, signal: "SIGTERM" });
});

test("disconnection callback failures do not corrupt the lifecycle queue", async () => {
  const children = [];
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      const child = childProcess();
      children.push(child);
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    onDisconnected: () => { throw new Error("notification failed"); },
  }));
  await session.ensure(9335);
  assert.doesNotThrow(() => children[0].emit("exit", 1));
  assert.equal((await session.ensure(9335)).reused, false);
  await session.close();
});

test("close submission suppresses disconnect notifications before its queued cleanup starts", async () => {
  const child = childProcess({ autoExit: false });
  let disconnects = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    onDisconnected: () => { disconnects += 1; },
  }));
  await session.ensure(9335);
  const close = session.close();
  child.emit("exit", 0);
  await close;
  assert.equal(disconnects, 0);
  assert.equal(child.killCount, 0);
});

test("shutdown submitted before a queued ensure begins never spawns a child", async () => {
  let starts = 0;
  const session = createPreviewSession(sessionOptions({ start: async () => { starts += 1; } }));
  const ensure = assert.rejects(session.ensure(9335), /退出|关闭/);
  const shutdown = session.shutdown();
  await Promise.all([ensure, shutdown]);
  assert.equal(starts, 0);
});

test("concurrent stop calls share a single owned-process kill request", async () => {
  const child = childProcess({ autoExit: false });
  const first = stopPreviewProcess(child, { timeoutMs: 1000 });
  const second = stopPreviewProcess(child, { timeoutMs: 1000 });
  assert.equal(child.killCount, 1);
  child.emit("exit", 0);
  await Promise.all([first, second]);
});

test("Node killed flag never substitutes for observed process exit", async () => {
  const child = childProcess({ autoExit: false });
  child.killed = true;
  let done = false;
  const stop = stopPreviewProcess(child, { timeoutMs: 1000 }).then(() => { done = true; });
  await tick();
  assert.equal(done, false);
  child.emit("exit", 0);
  await stop;
});

test("real stop timeout keeps the session blocked until a late process exit", async () => {
  const firstChild = childProcess({ autoExit: false });
  let starts = 0;
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      const child = ++starts === 1 ? firstChild : childProcess();
      onChild(child);
      return { child, url: controlUrl(port) };
    },
    stop: (child) => stopPreviewProcess(child, { timeoutMs: 10 }),
  }));
  await session.ensure(9335);
  await assert.rejects(session.ensure(9446), /退出.*超时/);
  assert.equal(starts, 1);
  firstChild.emit("exit", 0);
  assert.equal((await session.ensure(9446)).reused, false);
  assert.equal(starts, 2);
  await session.close();
});

test("UtilityProcess stop requests worker cleanup through a fixed parent message, never kill", async () => {
  const child = childProcess({ autoExit: false });
  const messages = [];
  child.postMessage = (message) => { messages.push(message); };
  let done = false;
  const stop = stopPreviewProcess(child, { timeoutMs: 1000 }).then((exit) => { done = true; return exit; });
  await tick();
  assert.deepEqual(messages, [{ channel: "cwb-utility", action: "shutdown" }]);
  assert.equal(child.killCount, 0);
  assert.equal(done, false);
  child.emit("exit", 0);
  assert.deepEqual(await stop, { code: 0, signal: null });
});

test("graceful worker cleanup failure rejects shutdown but releases the exited process", async () => {
  const child = childProcess({ autoExit: false });
  child.postMessage = () => child.emit("exit", 1);
  const session = createPreviewSession(sessionOptions({
    start: async (port, { onChild }) => {
      onChild(child);
      return { child, url: controlUrl(port) };
    },
  }));
  await session.ensure(9335);
  await assert.rejects(session.shutdown(), (error) => {
    assert.match(error.message, /清理.*退出码 1/);
    assert.deepEqual(error.exit, { code: 1, signal: null });
    return true;
  });
  assert.equal(child.killCount, 0);
  await session.shutdown();
  // Startup-failure cleanup of an already exited child must not replace its error.
  assert.deepEqual(await stopPreviewProcess(child), { code: 1, signal: null });
});

test("graceful request failure is visible and never falls back to forced kill", async () => {
  const child = childProcess({ autoExit: false });
  child.postMessage = () => { throw new Error("parent message failed"); };
  await assert.rejects(stopPreviewProcess(child, { timeoutMs: 1000 }), /parent message failed/);
  assert.equal(child.killCount, 0);
  child.emit("exit", 0);
  await stopPreviewProcess(child);
});

test("graceful request timeout can be retried without forcing process termination", async () => {
  const child = childProcess({ autoExit: false });
  let requests = 0;
  child.postMessage = () => { requests += 1; };
  await assert.rejects(stopPreviewProcess(child, { timeoutMs: 10 }), /退出.*超时/);
  assert.equal(child.killCount, 0);
  const retried = stopPreviewProcess(child, { timeoutMs: 1000 });
  assert.equal(requests, 2);
  child.emit("exit", 0);
  await retried;
});
