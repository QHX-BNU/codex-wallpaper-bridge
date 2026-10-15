import assert from "node:assert/strict";
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareAcceptanceContext } from "../src/acceptance-context.mjs";
import { verifyCdpEndpointOwner } from "../src/cdp-owner.mjs";
import { validateProcessCreation } from "../src/process-creation.mjs";

async function fixture(t) {
  const appPath = await mkdtemp(path.join(os.tmpdir(), "cwb-acceptance-"));
  t.after(() => rm(appPath, { recursive: true, force: true }));
  const root = path.join(appPath, "out", "live-acceptance", "independent");
  await mkdir(root, { recursive: true });
  const profile = path.join(root, "host-profile");
  await mkdir(profile);
  await writeFile(path.join(root, "target.json"), JSON.stringify({
    port: 19335, pid: 1000, creation: "2026-10-09T07:00:00.0000000Z", exe: path.join(appPath, "ChatGPT.exe"), profile,
  }));
  return { appPath, root, env: { CWB_ACCEPTANCE_ROOT: root } };
}

test("ordinary desktop launch does not change user data or environment", async () => {
  assert.equal(await prepareAcceptanceContext({ appPath: "unused", env: {} }), null);
});

test("acceptance refuses missing target identity or a daily host profile", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.root, "target.json"));
  await assert.rejects(prepareAcceptanceContext(f));
  await writeFile(path.join(f.root, "target.json"), JSON.stringify({
    port: 19335, pid: 1000, creation: "2026-10-09T07:00:00.0000000Z", exe: path.join(f.appPath, "ChatGPT.exe"), profile: f.appPath,
  }));
  await assert.rejects(prepareAcceptanceContext(f), /独立验收必须/);
});

test("acceptance isolates desktop data, bridge config/state and logs under an explicit run", async (t) => {
  const f = await fixture(t);
  const context = await prepareAcceptanceContext(f);
  assert.equal(context.userData, path.join(f.root, "desktop-user-data"));
  assert.equal(context.logsRoot, path.join(f.root, "desktop-logs"));
  assert.deepEqual(context.bridgeEnv, {
    LOCALAPPDATA: path.join(f.root, "bridge-state"),
    XDG_CONFIG_HOME: path.join(f.root, "bridge-state"),
    XDG_STATE_HOME: path.join(f.root, "bridge-state"),
  });
  assert.deepEqual(await prepareAcceptanceContext(f), context);
});

test("acceptance preserves seven creation ticks and the manifest identity on repeated reads", async (t) => {
  const f = await fixture(t);
  const targetPath = path.join(f.root, "target.json");
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  target.creation = "2026-10-09T15:00:00.1234567+08:00";
  await writeFile(targetPath, JSON.stringify(target));
  const original = await readFile(targetPath, "utf8");
  const context = await prepareAcceptanceContext(f);
  assert.deepEqual(context.expectedHost, target);
  assert.equal(validateProcessCreation(context.expectedHost.creation), target.creation);
  assert.deepEqual(await prepareAcceptanceContext(f), context);
  assert.equal(await readFile(targetPath, "utf8"), original);
});

test("acceptance manifest identity is usable by CDP ownership validation without metadata conversion", { skip: process.platform !== "win32" }, async (t) => {
  const f = await fixture(t);
  const { expectedHost } = await prepareAcceptanceContext(f);
  const { pid, port, creation, profile, exe } = expectedHost;
  let queried = false;
  const result = await verifyCdpEndpointOwner({
    installation: { path: exe },
    port,
    expectedProcess: { pid, creation, profile },
    platform: "win32",
    processRunner: async (_executable, _arguments, options) => {
      queried = true;
      assert.deepEqual(JSON.parse(options.env.CWB_CDP_EXPECTED_PROCESS), { pid, creation, profile });
      return { stdout: JSON.stringify({
        listeners: [{ localAddress: "127.0.0.1", localPort: port, owningProcess: pid }],
        owners: [{ processId: pid, executablePath: exe, remoteDebuggingPorts: [port], hasInvalidRemoteDebuggingPort: false }],
        independentIdentity: {
          processIdMatches: true, creationMatches: true, profileMatches: true,
          notQueryAncestor: true, ancestorChainVerified: true,
        },
      }) };
    },
  });
  assert.equal(queried, true);
  assert.equal(result.processId, pid);
});

for (const creation of [
  "2026-10-09T07:00:00.000Z", "2026-10-09T07:00:00.000000Z",
  "2026-02-30T07:00:00.0000000Z", "1600-12-31T23:59:59.9999999Z",
  "2026-10-09T07:00:00.0000000+14:01", "2026-10-09T07:00:00.0000000-15:00",
]) {
  test(`acceptance rejects invalid creation before writing isolated directories (${creation})`, async (t) => {
    const f = await fixture(t);
    const targetPath = path.join(f.root, "target.json");
    const target = JSON.parse(await readFile(targetPath, "utf8"));
    await writeFile(targetPath, JSON.stringify({ ...target, creation }));
    const original = await readFile(targetPath, "utf8");
    await assert.rejects(prepareAcceptanceContext(f), /独立验收 creation/);
    for (const name of ["desktop-user-data", "bridge-state", "desktop-logs"]) {
      await assert.rejects(lstat(path.join(f.root, name)), { code: "ENOENT" });
    }
    assert.equal(await readFile(targetPath, "utf8"), original);
  });
}

test("acceptance rejects a PID above the Windows uint32 boundary before writing directories", async (t) => {
  const f = await fixture(t);
  const targetPath = path.join(f.root, "target.json");
  const target = JSON.parse(await readFile(targetPath, "utf8"));
  await writeFile(targetPath, JSON.stringify({ ...target, pid: 0x100000000 }));
  await assert.rejects(prepareAcceptanceContext(f), /独立验收必须/);
  for (const name of ["desktop-user-data", "bridge-state", "desktop-logs"]) {
    await assert.rejects(lstat(path.join(f.root, name)), { code: "ENOENT" });
  }
  await writeFile(targetPath, JSON.stringify({ ...target, pid: 0xFFFFFFFF }));
  assert.equal((await prepareAcceptanceContext(f)).expectedHost.pid, 0xFFFFFFFF);
});

test("invalid opt-in never silently falls back to daily settings", async (t) => {
  const f = await fixture(t);
  for (const CWB_ACCEPTANCE_ROOT of ["", "relative", f.appPath, path.dirname(f.root)]) {
    await assert.rejects(prepareAcceptanceContext({ ...f, env: { CWB_ACCEPTANCE_ROOT } }));
  }
  await assert.rejects(prepareAcceptanceContext({ ...f, isPackaged: true }));
});

test("acceptance rejects a junction to data outside its run before writing", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.appPath, "outside");
  await mkdir(outside);
  await symlink(outside, path.join(f.root, "desktop-user-data"), process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(prepareAcceptanceContext(f), /普通目录|逃逸/);
});
