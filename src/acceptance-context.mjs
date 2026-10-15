import { lstat, mkdir, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { validateProcessCreation } from "./process-creation.mjs";

function isChild(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Explicit opt-in for independent desktop acceptance. Ordinary launches keep
// their existing paths; a bad opt-in fails closed instead of using daily data.
export async function prepareAcceptanceContext({ appPath, isPackaged = false, env = process.env }) {
  const rawRoot = env.CWB_ACCEPTANCE_ROOT;
  if (rawRoot === undefined) return null;
  if (isPackaged || !rawRoot || !path.isAbsolute(rawRoot)) {
    throw new Error("独立验收目录必须是源码工作区内的绝对路径");
  }
  const workspace = await realpath(appPath);
  const allowedRoot = await realpath(path.join(workspace, "out", "live-acceptance"));
  const root = await realpath(rawRoot);
  if (!isChild(workspace, allowedRoot) || !isChild(allowedRoot, root) || !(await lstat(root)).isDirectory()) {
    throw new Error("独立验收目录必须位于 out/live-acceptance 内，不能经链接逃逸");
  }
  const expectedHost = JSON.parse(await readFile(path.join(root, "target.json"), "utf8"));
  validateProcessCreation(expectedHost?.creation);
  if (!Number.isInteger(expectedHost.port) || expectedHost.port < 1024 || expectedHost.port > 65535
    || !Number.isSafeInteger(expectedHost.pid) || expectedHost.pid <= 0 || expectedHost.pid > 0xFFFFFFFF
    || typeof expectedHost.exe !== "string" || !path.isAbsolute(expectedHost.exe)
    || typeof expectedHost.profile !== "string" || !path.isAbsolute(expectedHost.profile)
    || !(await lstat(await realpath(expectedHost.profile))).isDirectory()
    || !isChild(allowedRoot, await realpath(expectedHost.profile))) {
    throw new Error("独立验收必须提供明确的测试 PID、创建时间、端口、EXE 与隔离 profile");
  }
  const directories = {};
  for (const [key, name] of Object.entries({ userData: "desktop-user-data", stateRoot: "bridge-state", logsRoot: "desktop-logs" })) {
    const candidate = path.join(root, name);
    const existing = await lstat(candidate).catch((error) => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (existing && (!existing.isDirectory() || existing.isSymbolicLink())) {
      throw new Error("独立验收子目录不是受信任的普通目录");
    }
    await mkdir(candidate, { recursive: true });
    const resolved = await realpath(candidate);
    if (!isChild(root, resolved)) throw new Error("独立验收子目录经链接逃逸");
    directories[key] = resolved;
  }
  return {
    ...directories,
    expectedHost,
    bridgeEnv: {
      LOCALAPPDATA: directories.stateRoot,
      XDG_CONFIG_HOME: directories.stateRoot,
      XDG_STATE_HOME: directories.stateRoot,
    },
  };
}
