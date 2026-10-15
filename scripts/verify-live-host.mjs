#!/usr/bin/env node
// Real-host verifier. It never launches, closes, or creates windows in Codex.
import { execFile, spawn } from "node:child_process";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { WebSocket } from "ws";
import { invokeBridgeAction, parseControlUrl } from "../src/bridge-runner.mjs";

const execFileAsync = promisify(execFile);
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const acceptanceRoot = path.join(repoRoot, "out", "live-acceptance");
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class VerificationError extends Error {}
function requireCondition(value, reason) { if (!value) throw new VerificationError(reason); }

export function isVerifierRendererTarget(target) {
  return Boolean(target && target.type === "page" && target.webSocketDebuggerUrl
    && String(target.url || "").startsWith("app://")
    && !/initialRoute=.*(?:avatar|pet|overlay)/i.test(String(target.url || "")));
}

// A navigation is not a target closure. Only absence from the full list closes
// an initial target; additional application pages never join this test cohort.
export function classifyInitialTargetCohort(initialIds, actualTargets) {
  const ids = new Set(initialIds);
  const targets = Array.isArray(actualTargets) ? actualTargets : [];
  const present = new Set(targets.map((target) => target.id));
  return {
    liveInitial: targets.filter((target) => ids.has(target.id)),
    closedInitialIds: [...ids].filter((id) => !present.has(id)),
    additional: targets.filter((target) => !ids.has(target.id) && isVerifierRendererTarget(target)),
  };
}

// Failure diagnostics have a second whitelist independent of renderer responses.
function safeStateMetadata(value, targetIndex, metadataAvailable = true) {
  const out = { targetIndex, metadataAvailable };
  if (!metadataAvailable || !value || typeof value !== "object") return out;
  for (const key of ["documentReady", "hidden", "reloadSentinelPresent", "wallpaperRoot", "wallpaperStyle", "wallpaperActive", "runtimeReady", "compatibilityStyle", "compatibilityRuntime", "compatibilityActive", "referenceUnchanged", "previousFrameDisconnected"]) {
    if (typeof value[key] === "boolean") out[key] = value[key];
  }
  out.adaptive = typeof value.adaptive === "boolean" ? value.adaptive : null;
  out.autoClearedCount = Number.isSafeInteger(value.autoClearedCount) && value.autoClearedCount >= 0 ? value.autoClearedCount : null;
  out.frameTag = value.frameTag === "iframe" ? "iframe" : null;
  out.mediaTag = value.mediaTag === "video" ? "video" : null;
  out.mediaState = ["idle", "loading", "loadstart", "loadeddata", "canplay", "playing", "pause", "loaded", "error", "play-rejected"].includes(value.mediaState) ? value.mediaState : null;
  if (value.video && typeof value.video === "object") {
    out.video = {};
    for (const key of ["readyState", "width", "height", "currentTime", "duration", "playbackRate", "errorCode"]) out.video[key] = typeof value.video[key] === "number" && Number.isFinite(value.video[key]) ? value.video[key] : null;
    for (const key of ["paused", "muted"]) out.video[key] = typeof value.video[key] === "boolean" ? value.video[key] : null;
  } else out.video = null;
  const styles = value.styles || {};
  out.styles = {
    filter: typeof styles.filter === "string" && /^(?:none|(?:\s*(?:brightness|saturate|blur)\([\d.%px\s]+\))+)$/.test(styles.filter) ? styles.filter : null,
    fit: ["cover", "contain", "fill", "none", "scale-down"].includes(styles.fit) ? styles.fit : null,
    blur: typeof styles.blur === "string" && /^\d+(?:\.\d+)?px$/.test(styles.blur) ? styles.blur : null,
    brightness: typeof styles.brightness === "string" && /^\d+(?:\.\d+)?$/.test(styles.brightness) ? styles.brightness : null,
  };
  return out;
}
function inside(root, target) {
  const relative = path.relative(root, target);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index];
    requireCondition(["--port", "--expected-exe", "--expected-profile", "--expected-pid", "--output"].includes(name), "unsupported argument");
    requireCondition(argv[index + 1] && !Object.hasOwn(values, name), "missing or duplicate argument");
    values[name] = argv[index + 1];
  }
  const options = {
    port: Number(values["--port"]), expectedPid: Number(values["--expected-pid"]),
    expectedExe: values["--expected-exe"], expectedProfile: values["--expected-profile"], output: values["--output"],
  };
  requireCondition(Number.isInteger(options.port) && options.port >= 1024 && options.port <= 65535, "invalid port");
  requireCondition(Number.isSafeInteger(options.expectedPid) && options.expectedPid > 0 && options.expectedPid !== process.pid, "invalid host PID");
  for (const key of ["expectedExe", "expectedProfile", "output"]) {
    requireCondition(typeof options[key] === "string" && path.isAbsolute(options[key]), `absolute ${key} is required`);
    options[key] = path.resolve(options[key]);
  }
  requireCondition(path.extname(options.output).toLowerCase() === ".json", "output must be a JSON file");
  return options;
}

// Resolve existing ancestors too: a not-yet-created output must not escape via a junction.
async function resolvedDestination(candidate) {
  const suffix = [];
  let cursor = candidate;
  for (;;) {
    try { return path.join(await realpath(cursor), ...suffix.reverse()); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      requireCondition(parent !== cursor, "path has no existing ancestor");
      suffix.push(path.basename(cursor)); cursor = parent;
    }
  }
}

async function validatePaths(options) {
  requireCondition(inside(acceptanceRoot, options.output) && inside(acceptanceRoot, options.expectedProfile), "output and test profile must stay in out/live-acceptance");
  const repository = await realpath(repoRoot);
  const resolvedRoot = await resolvedDestination(acceptanceRoot);
  requireCondition(inside(repository, resolvedRoot), "acceptance root escapes the workspace through a link");
  for (const candidate of [options.output, options.expectedProfile]) {
    requireCondition(inside(resolvedRoot, await resolvedDestination(candidate)), "output or profile escapes the acceptance root through a link");
  }
  requireCondition((await stat(options.expectedProfile)).isDirectory(), "expected test profile does not exist");
  requireCondition((await stat(options.expectedExe)).isFile(), "expected executable does not exist");
  requireCondition(!(await stat(options.output).catch(() => null)), "output already exists; choose a fresh report path");
  await mkdir(path.dirname(options.output), { recursive: true });
  const stateRoot = path.join(path.dirname(options.output), "state", `live-${options.port}-${options.expectedPid}-${Date.now()}`);
  requireCondition(inside(resolvedRoot, await resolvedDestination(stateRoot)), "test state escapes acceptance root");
  await mkdir(stateRoot, { recursive: true });
  return stateRoot;
}

const OWNER_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$OutputEncoding = [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class CwbCommandLine {
  [DllImport("shell32.dll", SetLastError=true)] public static extern IntPtr CommandLineToArgvW([MarshalAs(UnmanagedType.LPWStr)] string command, out int count);
  [DllImport("kernel32.dll")] public static extern IntPtr LocalFree(IntPtr value);
}
'@
$expectedPid = [int]$env:CWB_VERIFY_PID
$port = [int]$env:CWB_VERIFY_PORT
$expectedExe = [IO.Path]::GetFullPath($env:CWB_VERIFY_EXE)
$expectedProfile = [IO.Path]::GetFullPath($env:CWB_VERIFY_PROFILE)
$listeners = @(Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction Stop)
$owners = @($listeners | Select-Object -ExpandProperty OwningProcess -Unique)
$ownerMatch = $owners.Count -eq 1 -and [int]$owners[0] -eq $expectedPid
$loopbackOnly = @($listeners | Where-Object {$_.LocalAddress -notin @('127.0.0.1','::1')}).Count -eq 0
$hostProcess = Get-CimInstance Win32_Process -Filter "ProcessId = $expectedPid" -ErrorAction Stop
if (-not $hostProcess) {throw 'host process missing'}
$count = 0
$argvPointer = [CwbCommandLine]::CommandLineToArgvW($hostProcess.CommandLine, [ref]$count)
try {
  $arguments = @(for($i = 0; $i -lt $count; $i++) {
    [Runtime.InteropServices.Marshal]::PtrToStringUni([Runtime.InteropServices.Marshal]::ReadIntPtr($argvPointer, $i * [IntPtr]::Size))
  })
} finally { if ($argvPointer -ne [IntPtr]::Zero) {[void][CwbCommandLine]::LocalFree($argvPointer)} }
function Read-Argument([string]$name) {
  for($i = 0; $i -lt $arguments.Count; $i++) {
    if ($arguments[$i].StartsWith($name + '=', [StringComparison]::OrdinalIgnoreCase)) {return $arguments[$i].Substring($name.Length + 1)}
    if ([string]::Equals($arguments[$i],$name,[StringComparison]::OrdinalIgnoreCase) -and $i + 1 -lt $arguments.Count) {return $arguments[$i + 1]}
  }
  return $null
}
$profile = Read-Argument '--user-data-dir'
$profileMatch = $false
if ($profile) {$profileMatch = [string]::Equals([IO.Path]::GetFullPath($profile),$expectedProfile,[StringComparison]::OrdinalIgnoreCase)}
$exeMatch = $hostProcess.ExecutablePath -and [string]::Equals([IO.Path]::GetFullPath($hostProcess.ExecutablePath),$expectedExe,[StringComparison]::OrdinalIgnoreCase)
$ancestors = @()
$cursor = Get-CimInstance Win32_Process -Filter "ProcessId = $PID"
for($i = 0; $i -lt 32 -and $cursor; $i++) {
  $ancestors += [int]$cursor.ProcessId
  if ($cursor.ParentProcessId -eq 0 -or $ancestors -contains [int]$cursor.ParentProcessId) {break}
  $parentId = [int]$cursor.ParentProcessId
  $cursor = Get-CimInstance Win32_Process -Filter "ProcessId = $parentId"
}
[pscustomobject]@{
  ownerMatch = [bool]$ownerMatch; loopbackOnly = [bool]$loopbackOnly; executableMatch = [bool]$exeMatch
  profileMatch = [bool]$profileMatch; debugPortMatch = (Read-Argument '--remote-debugging-port') -eq [string]$port
  independentOfCurrentHost = $ancestors -notcontains $expectedPid
  processCreation = $hostProcess.CreationDate.ToUniversalTime().ToString('o')
  executableVersion = (Get-Item -LiteralPath $expectedExe).VersionInfo.ProductVersion
} | ConvertTo-Json -Compress
`;

export async function verifyOwner(options, expectedCreation = null) {
  requireCondition(process.platform === "win32", "this verifier requires Windows process ownership evidence");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(OWNER_SCRIPT, "utf16le").toString("base64")], {
    windowsHide: true, encoding: "utf8", timeout: 20_000, maxBuffer: 256 * 1024,
    env: { ...process.env, CWB_VERIFY_PID: String(options.expectedPid), CWB_VERIFY_PORT: String(options.port), CWB_VERIFY_EXE: options.expectedExe, CWB_VERIFY_PROFILE: options.expectedProfile },
  });
  let evidence;
  try { evidence = JSON.parse(stdout.replace(/^\uFEFF/, "").trim()); }
  catch { throw new VerificationError("ownership evidence was not valid JSON"); }
  for (const key of ["ownerMatch", "loopbackOnly", "executableMatch", "profileMatch", "debugPortMatch", "independentOfCurrentHost"]) {
    requireCondition(evidence[key] === true, `host ownership gate failed: ${key}`);
  }
  requireCondition(!expectedCreation || expectedCreation === evidence.processCreation, "host PID has been reused");
  return evidence;
}

export class CdpConnection {
  constructor(url, port) { this.url = url; this.port = port; this.pending = new Map(); this.nextId = 1; }
  async connect() {
    const url = new URL(this.url);
    requireCondition(url.protocol === "ws:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname), "non-loopback CDP socket rejected");
    requireCondition(Number(url.port) === this.port, "CDP target socket does not belong to the verified listener port");
    this.socket = new WebSocket(this.url, { handshakeTimeout: 5_000 });
    await new Promise((resolve, reject) => {
      this.socket.once("open", resolve);
      this.socket.once("error", () => reject(new VerificationError("CDP socket connection failed")));
    });
    this.socket.on("error", () => {});
    this.socket.on("message", (raw) => {
      let message; try { message = JSON.parse(raw.toString()); } catch { return; }
      const pending = this.pending.get(message.id); if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) pending.reject(new VerificationError("CDP command failed")); else pending.resolve(message.result || {});
    });
    this.socket.on("close", () => {
      for (const pending of this.pending.values()) pending.reject(new VerificationError("CDP socket closed"));
      this.pending.clear();
    });
    await this.call("Page.enable");
  }
  call(method, params = {}) {
    requireCondition(this.socket?.readyState === WebSocket.OPEN, "CDP socket is not open");
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(id); reject(new VerificationError("CDP command timed out")); }, 15_000);
      this.pending.set(id, { resolve: (value) => { clearTimeout(timer); resolve(value); }, reject: (error) => { clearTimeout(timer); reject(error); } });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.call("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    requireCondition(!result.exceptionDetails, "renderer metadata evaluation failed");
    return result.result?.value;
  }
  close() { try { this.socket?.terminate(); } catch {} }
}

// No textContent, title, href, source URL, auth value, or media identity is returned.
const STATE_EXPRESSION = `(() => {
  const root = document.getElementById('codex-wallpaper-bridge-root');
  const frame = document.getElementById('codex-wallpaper-bridge-media');
  let media = null; try {media = frame?.contentDocument?.getElementById('cwb-media')} catch {}
  const runtime = window.__codexWallpaperBridgeRuntime;
  const compatibility = window.__codexWallpaperElectronCompat;
  const state = runtime?.status?.();
  const frameStyle = frame ? getComputedStyle(frame) : null;
  const mediaStyle = media ? getComputedStyle(media) : null;
  return {
    documentReady: document.readyState === 'complete', hidden: document.hidden,
    reloadSentinelPresent: window.__cwbLiveVerifierReloadSentinel === true,
    wallpaperRoot: !!root, wallpaperStyle: !!document.getElementById('codex-wallpaper-bridge-style'),
    wallpaperActive: document.documentElement.hasAttribute('data-codex-wallpaper-bridge'),
    runtimeReady: runtime?.ready === true,
    mediaState: ['idle','loading','loadstart','loadeddata','canplay','playing','pause','loaded','error','play-rejected'].includes(state?.state) ? state.state : null,
    compatibilityStyle: !!document.getElementById('codex-wallpaper-electron-compat-style'),
    compatibilityRuntime: !!compatibility, adaptive: typeof compatibility?.adaptive === 'boolean' ? compatibility.adaptive : null,
    compatibilityActive: document.documentElement.hasAttribute('data-cwb-electron-compat'),
    autoClearedCount: document.querySelectorAll('[data-cwb-electron-auto-clear]').length,
    frameTag: frame?.tagName === 'IFRAME' ? 'iframe' : null, mediaTag: media?.tagName === 'VIDEO' ? 'video' : null,
    video: media?.tagName === 'VIDEO' ? {readyState: media.readyState, width: media.videoWidth, height: media.videoHeight,
      currentTime: Math.round(media.currentTime * 1000) / 1000, duration: Number.isFinite(media.duration) ? media.duration : null,
      paused: media.paused, muted: media.muted, playbackRate: media.playbackRate, errorCode: media.error?.code || null} : null,
    styles: {filter: frameStyle?.filter || null, fit: mediaStyle?.objectFit || null,
      blur: root?.style.getPropertyValue('--cwb-blur') || null, brightness: root?.style.getPropertyValue('--cwb-brightness') || null},
    referenceUnchanged: !!window.__cwbLiveVerifierMedia && window.__cwbLiveVerifierMedia === media && window.__cwbLiveVerifierFrame === frame,
    previousFrameDisconnected: !!window.__cwbLiveVerifierFrame && !window.__cwbLiveVerifierFrame.isConnected
  };
})()`;
const MARK_MEDIA = `(() => {
  const frame = document.getElementById('codex-wallpaper-bridge-media');
  window.__cwbLiveVerifierFrame = frame;
  window.__cwbLiveVerifierMedia = frame?.contentDocument?.getElementById('cwb-media') || null;
  return !!window.__cwbLiveVerifierMedia;
})()`;
const CLEAN_MARKERS = `(() => {delete window.__cwbLiveVerifierMedia; delete window.__cwbLiveVerifierFrame; delete window.__cwbLiveVerifierReloadSentinel; return true})()`;

async function getJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(30_000), redirect: "error" });
  requireCondition(response.ok, `local HTTP operation failed (${response.status})`);
  return response.json();
}

async function startCli(options, stateRoot, onChild) {
  const child = spawn(process.execPath, [path.join(repoRoot, "bridge-runtime", "src", "cli.mjs"), "preview", "--no-open", "--cdp-port", String(options.port)], {
    cwd: path.join(repoRoot, "bridge-runtime"), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, LOCALAPPDATA: stateRoot, XDG_CONFIG_HOME: stateRoot, XDG_STATE_HOME: stateRoot, CWB_DEBUG: "" },
  });
  onChild(child);
  return new Promise((resolve, reject) => {
    let output = ""; let settled = false;
    const timer = setTimeout(() => finish(new VerificationError("isolated bridge CLI startup timed out")), 120_000);
    function finish(error, value) {
      if (settled) return; settled = true; clearTimeout(timer); output = "";
      if (error) reject(error); else resolve(value);
    }
    const consume = (chunk) => {
      if (settled) return; output = (output + chunk.toString("utf8")).slice(-64 * 1024);
      const url = parseControlUrl(output);
      if (url) {
        const base = new URL(url);
        if (base.protocol !== "http:" || base.hostname !== "127.0.0.1" || base.search || base.hash || !/^\/[A-Za-z0-9_-]{22,}\/$/.test(base.pathname)) {
          finish(new VerificationError("isolated bridge control endpoint failed validation")); return;
        }
        finish(null, url);
      }
    };
    child.stdout.on("data", consume); child.stderr.on("data", consume);
    child.once("error", () => finish(new VerificationError("isolated bridge CLI could not start")));
    child.once("exit", () => finish(new VerificationError("isolated bridge CLI exited before readiness")));
  });
}

async function run(options) {
  const stateRoot = await validatePaths(options);
  const report = { schemaVersion: 1, startedAt: new Date().toISOString(), port: options.port, expectedPid: options.expectedPid,
    closedInitialTargets: 0, closedInitialTargetIndices: [], observedAdditionalTargets: 0, connectionReconnectAttempts: 0,
    scope: "isolated real-host lifecycle; not desktop UI or complete M0-05", steps: [], outcome: "fail" };
  let child; let controlUrl; let hostCreation; let connections = [];
  const initialIndices = new Map(); const closedInitialIds = new Set(); const additionalIds = new Set();
  let restoreComplete = false;
  const step = async (name, operation) => {
    const started = Date.now();
    try {
      const details = await operation(); report.steps.push({ name, status: "pass", elapsedMs: Date.now() - started, details });
      console.log(JSON.stringify({ step: name, status: "pass" })); return details;
    } catch (error) {
      // Arbitrary renderer, HTTP, child-process, and filesystem error text is never logged.
      const reason = error instanceof VerificationError ? error.message : "operation failed; raw diagnostics intentionally omitted";
      const details = error instanceof VerificationError && Array.isArray(error.lastSnapshot)
        ? { lastSnapshot: error.lastSnapshot.map((value, index) => safeStateMetadata(value, value?.targetIndex ?? index, value?.metadataAvailable !== false)), ...(error.lastProbeError ? { lastProbeError: error.lastProbeError } : {}) }
        : undefined;
      report.steps.push({ name, status: "fail", elapsedMs: Date.now() - started, reason, ...(details ? { details } : {}) });
      console.log(JSON.stringify({ step: name, status: "fail", reason })); throw error;
    }
  };
  const guard = () => verifyOwner(options, hostCreation);
  const refreshCohort = async () => {
    const actual = await getJson(`http://127.0.0.1:${options.port}/json/list`);
    requireCondition(Array.isArray(actual), "actual target list was not an array");
    const cohort = classifyInitialTargetCohort(initialIndices.keys(), actual);
    for (const id of cohort.closedInitialIds) closedInitialIds.add(id);
    for (const target of cohort.additional) additionalIds.add(target.id);
    report.closedInitialTargets = closedInitialIds.size;
    report.closedInitialTargetIndices = [...closedInitialIds].map((id) => initialIndices.get(id)).sort((a, b) => a - b);
    report.observedAdditionalTargets = additionalIds.size;
    const present = new Map(cohort.liveInitial.map((target) => [target.id, target]));
    connections = connections.filter((connection) => {
      if (present.has(connection.targetId)) return true;
      connection.close(); return false;
    });
    report.activeInitialTargets = connections.length;
    requireCondition(connections.length > 0, "all initial application targets have closed; lifecycle cannot be verified");
    for (let index = 0; index < connections.length; index += 1) {
      const old = connections[index]; const target = present.get(old.targetId);
      if (old.socket?.readyState === WebSocket.OPEN && old.url === target.webSocketDebuggerUrl) continue;
      // Preserve cohort identity and the page's DOM references, not a dead socket.
      old.close(); report.connectionReconnectAttempts += 1;
      const replacement = new CdpConnection(target.webSocketDebuggerUrl, options.port);
      replacement.targetId = old.targetId; replacement.targetIndex = old.targetIndex;
      connections[index] = replacement;
      try { await replacement.connect(); } catch { /* states() reports unavailable metadata and a later poll retries */ }
    }
    return connections;
  };
  const states = async () => {
    const current = await refreshCohort();
    const results = await Promise.allSettled(current.map((connection) => connection.evaluate(STATE_EXPRESSION)));
    if (results.some((result) => result.status === "rejected")) {
      const error = new VerificationError("one or more selected targets could not provide metadata");
      error.lastSnapshot = results.map((result, index) => safeStateMetadata(result.value, current[index].targetIndex, result.status === "fulfilled"));
      throw error;
    }
    return results.map((result, index) => ({ ...result.value, targetIndex: current[index].targetIndex }));
  };
  const poll = async (predicate, reason, timeoutMs = 45_000) => {
    const deadline = Date.now() + timeoutMs; let snapshot; let lastSnapshot = []; let lastProbeError = null;
    do {
      try {
        snapshot = await states(); lastSnapshot = snapshot.map((value, index) => safeStateMetadata(value, value.targetIndex ?? index)); lastProbeError = null;
        if (snapshot.length && snapshot.every(predicate)) return snapshot;
      } catch (error) {
        if (error instanceof VerificationError && Array.isArray(error.lastSnapshot)) lastSnapshot = error.lastSnapshot;
        lastProbeError = error instanceof VerificationError ? error.message : "metadata probe failed; raw diagnostics intentionally omitted";
      }
      await delay(250);
    } while (Date.now() < deadline);
    const error = new VerificationError(reason);
    error.lastSnapshot = lastSnapshot; error.lastProbeError = lastProbeError;
    throw error;
  };
  const active = (adaptive) => (value) => value.runtimeReady && value.wallpaperRoot && value.wallpaperStyle && value.wallpaperActive && value.compatibilityRuntime && value.compatibilityStyle && value.compatibilityActive && value.adaptive === adaptive;
  const playing = (value) => value.video?.readyState >= 2 && value.video.width > 0 && value.video.height > 0 && !value.video.paused && !value.video.errorCode;
  const restored = (value) => value.documentReady && !value.wallpaperRoot && !value.wallpaperStyle && !value.wallpaperActive && !value.compatibilityRuntime && !value.compatibilityStyle && !value.compatibilityActive && value.autoClearedCount === 0;
  const config = async (patch) => {
    await guard(); const result = await getJson(new URL("api/config", controlUrl), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    requireCondition(result.config?.selectedId === patch.selectedId || patch.selectedId === undefined, "selected project was not persisted");
  };
  const action = async (name, adaptive) => {
    await guard(); await invokeBridgeAction({ controlUrl, action: name, ...(adaptive === undefined ? {} : { adaptive }), timeoutMs: 60_000 });
  };
  const reload = async () => {
    await guard();
    const current = await refreshCohort();
    await Promise.all(current.map((connection) => connection.evaluate("(() => {window.__cwbLiveVerifierReloadSentinel = true; return true})()")));
    await Promise.all(current.map((connection) => connection.call("Page.reload", { ignoreCache: true })));
    await delay(750);
    await poll((value) => value.documentReady && !value.reloadSentinelPresent, "Page.reload did not create a new ready document", 30_000);
  };
  try {
    await step("host-ownership", async () => { const evidence = await verifyOwner(options); hostCreation = evidence.processCreation; report.hostVersion = evidence.executableVersion; return evidence; });
    await step("browser-and-existing-targets", async () => {
      const browser = await getJson(`http://127.0.0.1:${options.port}/json/version`);
      const all = await getJson(`http://127.0.0.1:${options.port}/json/list`);
      const selected = all.filter(isVerifierRendererTarget);
      requireCondition(selected.length > 0, "no existing application page target");
      for (const [index, target] of selected.entries()) {
        initialIndices.set(target.id, index);
        const connection = new CdpConnection(target.webSocketDebuggerUrl, options.port);
        connection.targetId = target.id; connection.targetIndex = index;
        connections.push(connection); await connection.connect();
      }
      report.browser = { browser: browser.Browser, protocolVersion: browser["Protocol-Version"], v8Version: browser["V8-Version"] };
      report.targetCounts = { all: all.length, pages: all.filter((target) => target.type === "page").length, selected: selected.length };
      return { browser: report.browser, targetCounts: report.targetCounts };
    });
    await step("isolated-cli-preview", async () => { controlUrl = await startCli(options, stateRoot, (value) => {child = value;}); return { childPid: child.pid, isolatedState: true, openedBrowser: false }; });
    let videos;
    await step("real-video-inventory", async () => {
      const inventory = await getJson(new URL("api/inventory", controlUrl));
      videos = inventory.projects.filter((project) => project.type === "video" && project.playable === true && project.mediaUrl);
      requireCondition(videos.length >= 2, "fewer than two real playable video projects");
      const media = [];
      for (const video of videos.slice(0, 2)) {
        const source = new URL(video.mediaUrl, controlUrl);
        const base = new URL(controlUrl);
        requireCondition(source.origin === base.origin && source.pathname.startsWith(`${base.pathname}api/video/`), "non-local project media rejected");
        const response = await fetch(source, { method: "HEAD", signal: AbortSignal.timeout(15_000), redirect: "error" });
        requireCondition(response.ok, "real video HEAD failed");
        const contentType = response.headers.get("content-type") || "";
        requireCondition(contentType.startsWith("video/"), "selected project did not serve video media");
        media.push({ contentType, bytes: Number(response.headers.get("content-length")), acceptsRanges: response.headers.get("accept-ranges") === "bytes" });
      }
      return { projects: inventory.projects.length, playableVideos: videos.length, selectedMedia: media, sourceFilesCopied: false };
    });
    await step("adaptive-inject-and-video-progress", async () => {
      await config({ selectedId: videos[0].id, effects: { playing: true, pauseWhenHidden: false, blur: 0, brightness: 72, fit: "cover" } });
      await action("inject", true); const before = await poll((value) => active(true)(value) && playing(value), "adaptive layers or real video did not become ready");
      await delay(1_200); const after = await states();
      requireCondition(after.every((value) => {
        const previous = before.find((entry) => entry.targetIndex === value.targetIndex);
        return previous && playing(value) && Math.abs(value.video.currentTime - previous.video.currentTime) > 0.05;
      }), "real video currentTime did not advance");
      return { before, after };
    });
    await step("parameter-update-preserves-media", async () => {
      const current = await refreshCohort();
      requireCondition((await Promise.all(current.map((connection) => connection.evaluate(MARK_MEDIA)))).every(Boolean), "could not mark existing media reference");
      await config({ effects: { blur: 2, brightness: 80, fit: "contain" } });
      return poll((value) => active(true)(value) && value.referenceUnchanged && value.styles.blur === "2px" && value.styles.brightness === "0.8" && value.styles.fit === "contain", "parameter update rebuilt media or did not apply styles");
    });
    await step("switch-second-real-video", async () => {
      await config({ selectedId: videos[1].id });
      return poll((value) => active(true)(value) && playing(value) && value.previousFrameDisconnected && !value.referenceUnchanged, "second video did not replace the previous media");
    });
    await step("safe-mode-and-real-page-reload", async () => {
      await action("inject", false); await poll(active(false), "safe compatibility mode was not applied");
      await reload(); return poll((value) => active(false)(value) && playing(value), "safe mode or wallpaper failed to survive real page reload");
    });
    await step("restore-both-layers", async () => { await action("restore"); const snapshot = await poll(restored, "restore left wallpaper or compatibility artifacts"); restoreComplete = true; return snapshot; });
    await step("reload-after-restore-does-not-reinstall", async () => { await reload(); await poll(restored, "restore was undone after real page reload"); await delay(3_000); const snapshot = await states(); requireCondition(snapshot.every(restored), "resident reinjection resumed after restore"); return snapshot; });
    report.outcome = "pass";
  } catch { report.outcome = "fail"; }
  finally {
    if (controlUrl) {
      await step("cleanup-resident-restore-before-cli-stop", async () => {
        await action("restore"); const snapshot = connections.length ? await poll(restored, "cleanup restore was not verified", 20_000) : [];
        restoreComplete = true; return { restoreComplete, states: snapshot };
      }).catch(() => { report.outcome = "fail"; });
    }
    if (initialIndices.size) await refreshCohort().catch(() => {});
    for (const connection of connections) { try { await connection.evaluate(CLEAN_MARKERS); } catch {} connection.close(); }
    if (child && child.exitCode === null && child.signalCode === null) {
      await step("stop-own-cli-process", async () => {
        // Only the ChildProcess created above is terminated. Codex stays running.
        const exited = new Promise((resolve) => child.once("exit", resolve));
        child.kill("SIGTERM"); await Promise.race([exited, delay(8_000)]);
        if (child.exitCode === null && child.signalCode === null) { child.kill("SIGKILL"); await Promise.race([exited, delay(3_000)]); }
        requireCondition(child.exitCode !== null || child.signalCode !== null, "own CLI process did not stop");
        return { restoreBeforeStop: restoreComplete, codexNotClosed: true };
      }).catch(() => { report.outcome = "fail"; });
    }
    for (const name of ["host-ownership", "browser-and-existing-targets", "isolated-cli-preview", "real-video-inventory", "adaptive-inject-and-video-progress", "parameter-update-preserves-media", "switch-second-real-video", "safe-mode-and-real-page-reload", "restore-both-layers", "reload-after-restore-does-not-reinstall"]) {
      if (!report.steps.some((entry) => entry.name === name)) report.steps.push({ name, status: "unverified", reason: "not reached because an earlier gate failed" });
    }
    report.steps.push({ name: "new-window-full-lifecycle", status: "unverified", reason: "no safe real application new-window entry; no synthetic target creation used" });
    report.steps.push({ name: "desktop-ui-and-complete-M0-05", status: "unverified", reason: "this verifier covers process ownership and lifecycle only" });
    report.finishedAt = new Date().toISOString();
    await writeFile(options.output, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  }
  console.log(JSON.stringify({ outcome: report.outcome, steps: report.steps.map(({ name, status }) => ({ name, status })) }));
  return report.outcome === "pass" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await run(parseArguments(process.argv.slice(2))); }
  catch (error) {
    console.error(JSON.stringify({ status: "fail", reason: error instanceof VerificationError ? error.message : "verifier setup failed; raw diagnostics intentionally omitted" }));
    process.exitCode = 1;
  }
}
