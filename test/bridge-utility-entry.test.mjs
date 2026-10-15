import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

async function worker() {
  const source = (await readFile(new URL("../src/bridge-utility-entry.mjs", import.meta.url), "utf8"))
    .replace(/^import[^\n]*\n/, "")
    .replace("import(pathToFileURL(cliPath).href)", "loadCli()");
  const process = new EventEmitter();
  process.env = { CWB_BRIDGE_CLI: "isolated-test-cli" };
  process.argv = ["electron", "worker", "preview"];
  process.parentPort = new EventEmitter();
  process.exit = () => {};
  vm.runInNewContext(source, {
    process, console: { log() {}, error() {} }, setTimeout, queueMicrotask,
    loadCli: async () => {},
  });
  return process;
}

test("utility accepts only the fixed parent graceful-shutdown message", async () => {
  const process = await worker();
  let stops = 0;
  process.on("SIGTERM", () => stops++);
  process.parentPort.emit("message", { data: { action: "shutdown" } });
  process.parentPort.emit("message", { data: { channel: "cwb-utility", action: "restore" } });
  assert.equal(stops, 0);
  process.parentPort.emit("message", { data: { channel: "cwb-utility", action: "shutdown" } });
  assert.equal(stops, 1);
});

test("utility preserves an early shutdown until CLI has registered its cleanup handler", async () => {
  const process = await worker();
  const message = { data: { channel: "cwb-utility", action: "shutdown" } };
  process.parentPort.emit("message", message);
  process.parentPort.emit("message", message);
  let stops = 0;
  process.on("SIGTERM", () => stops++);
  await new Promise((resolve) => queueMicrotask(resolve));
  assert.equal(stops, 1);
});
