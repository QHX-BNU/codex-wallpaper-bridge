#!/usr/bin/env node
// Programmatic real-workbench acceptance only: never launches/closes apps,
// creates windows, operates the native tray, or captures the Codex host UI.
import { lstat, open, readFile, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { prepareAcceptanceContext } from "../src/acceptance-context.mjs";
import { CdpConnection, isVerifierRendererTarget, verifyOwner } from "./verify-live-host.mjs";
import { DESKTOP_RENDERER_URL } from "../bridge-runtime/src/desktop-origin.mjs";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const acceptanceRoot = path.join(repoRoot, "out", "live-acceptance");
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
class WorkbenchError extends Error {}
function requireCondition(value, code) { if (!value) throw new WorkbenchError(code); }
function inside(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}
export function parseArguments(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    requireCondition(["--run-root", "--desktop-pid", "--desktop-port", "--output-name", "--scope"].includes(key), "unsupported_argument");
    requireCondition(argv[index + 1] && !Object.hasOwn(values, key), "missing_or_duplicate_argument");
    values[key] = argv[index + 1];
  }
  const options = { runRoot: values["--run-root"], desktopPid: Number(values["--desktop-pid"]), desktopPort: Number(values["--desktop-port"]), outputName: values["--output-name"] ?? "report.json", scope: values["--scope"] ?? "full" };
  requireCondition(typeof options.runRoot === "string" && path.isAbsolute(options.runRoot), "absolute_run_root_required");
  options.runRoot = path.resolve(options.runRoot);
  requireCondition(Number.isSafeInteger(options.desktopPid) && options.desktopPid > 0 && options.desktopPid !== process.pid, "invalid_desktop_pid");
  requireCondition(Number.isInteger(options.desktopPort) && options.desktopPort >= 1024 && options.desktopPort <= 65535, "invalid_desktop_port");
  requireCondition(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}\.json$/.test(options.outputName), "invalid_output_basename");
  requireCondition(["full", "control-only"].includes(options.scope), "invalid_verification_scope");
  return options;
}
async function json(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(15_000), redirect: "error" });
  requireCondition(response.ok, "read_only_http_request_failed");
  return response.json();
}
function trustedControlUrl(value) {
  const url = new URL(value);
  requireCondition(url.protocol === "http:" && url.hostname === "127.0.0.1" && !url.username && !url.password
    && !url.search && !url.hash && /^\/[A-Za-z0-9_-]{22,}\/$/.test(url.pathname), "untrusted_control_url");
  return url.href;
}
function version(value) { return typeof value === "string" && /^\d+(?:\.\d+){1,4}$/.test(value) ? value : null; }
export function createWorkbenchReport(scope = "full") {
  requireCondition(["full", "control-only"].includes(scope), "invalid_verification_scope");
  return { schemaVersion: 1, startedAt: new Date().toISOString(), outcome: "fail",
    scope: "programmatic-real-workbench; not human/native tray, renderer reconstruction, new-window or complete M0-05 acceptance",
    verificationScope: scope,
    scopeReason: scope === "control-only" ? "explicit_control_only_scope_no_host_activation_or_visible_video_progression"
      : "full_programmatic_scope_still_excludes_human_and_native_acceptance",
    hostVersion: null, desktopVersion: null, steps: [], completeM0Gate: false, hiddenVideoPlaybackVerified: false,
    visibleVideoPlaybackVerified: false, mediaReferenceVerified: false, hostActivationRequested: false };
}
const HOST_STATE = `(() => {
  const root = document.getElementById('codex-wallpaper-bridge-root');
  const frame = document.getElementById('codex-wallpaper-bridge-media');
  let video; try { video = frame?.contentDocument?.getElementById('cwb-media') } catch {}
  const compat = window.__codexWallpaperElectronCompat;
  return {root:!!root, wallpaperStyle:!!document.getElementById('codex-wallpaper-bridge-style'),
    compatibilityStyle:!!document.getElementById('codex-wallpaper-electron-compat-style'),
    compatibilityRuntime:!!compat, adaptive:typeof compat?.adaptive === 'boolean' ? compat.adaptive : null,
    hidden:document.hidden, video:video?.tagName === 'VIDEO' ? {width:video.videoWidth,height:video.videoHeight,
      readyState:video.readyState,currentTime:video.currentTime,paused:video.paused,errorCode:video.error?.code || 0} : null,
    referenceUnchanged:!!video && video === window.__cwbWorkbenchVideo && frame === window.__cwbWorkbenchFrame};
})()`;
function safeHostState(value, index) {
  const out = { targetIndex: index };
  for (const key of ["root", "wallpaperStyle", "compatibilityStyle", "compatibilityRuntime", "hidden", "referenceUnchanged"]) out[key] = value?.[key] === true;
  out.adaptive = typeof value?.adaptive === "boolean" ? value.adaptive : null;
  out.video = value?.video ? {} : null;
  if (out.video) {
    for (const key of ["width", "height", "readyState", "currentTime", "errorCode"]) out.video[key] = Number.isFinite(value.video[key]) ? value.video[key] : null;
    out.video.paused = value.video.paused === true;
  }
  return out;
}
export function visibleMediaReferenceMatches(values, cohort) {
  if (cohort.size === 0) return false;
  const selected = values.filter((value) => cohort.has(value.targetIndex));
  return selected.length === cohort.size && selected.every((value) => !value.hidden && value.referenceUnchanged
    && value.video?.width > 0 && value.video.height > 0 && value.video.readyState >= 2 && value.video.errorCode === 0);
}
export function ownershipFailureReason(error) {
  if (error?.killed === true) return "owner_query_timeout_or_terminated";
  if (error?.code === "ENOENT") return "owner_query_executable_unavailable";
  if (error?.code === "EACCES" || error?.code === "EPERM") return "owner_query_access_rejected";
  return "process_ownership_or_creation_changed";
}
export function operationFailureReason(error) {
  const reasons = new Map([
    ["renderer metadata evaluation failed", "renderer_metadata_evaluation_failed"],
    ["CDP command timed out", "cdp_command_timeout"], ["CDP socket closed", "cdp_socket_closed"],
    ["CDP socket is not open", "cdp_socket_not_open"], ["CDP command failed", "cdp_command_failed"],
  ]);
  return reasons.get(error?.message) || "operation_failed_raw_diagnostics_omitted";
}
const CONTROL_STATE = `(() => {
  const status=document.querySelector('#desktopApplyStatus'), apply=document.querySelector('#desktopApplyButton');
  const tracker=window.__cwbWorkbenchVerification;
  return {tone:['idle','busy','success','error'].includes(status?.dataset.tone) ? status.dataset.tone : null,
    disabled:apply?.disabled === true, started:tracker?.started === true, complete:tracker?.complete === true,
    error:tracker?.error === true, embedded:document.documentElement.dataset.cwbDesktopEmbedded === 'true'};
})()`;

async function run(options) {
  requireCondition(inside(acceptanceRoot, options.runRoot), "run_root_outside_acceptance_workspace");
  const resolvedWorkspace = await realpath(repoRoot);
  const resolvedAllowed = await realpath(acceptanceRoot);
  const resolvedRun = await realpath(options.runRoot);
  requireCondition(inside(resolvedWorkspace, resolvedAllowed) && inside(resolvedAllowed, resolvedRun)
    && (await lstat(options.runRoot)).isDirectory() && !(await lstat(options.runRoot)).isSymbolicLink(), "run_root_link_or_containment_failed");
  const context = await prepareAcceptanceContext({ appPath: repoRoot, env: { CWB_ACCEPTANCE_ROOT: resolvedRun } });
  const host = context.expectedHost;
  requireCondition(host.pid !== options.desktopPid && host.port !== options.desktopPort, "host_and_desktop_must_be_distinct");
  const hostOwnerOptions = { port: host.port, expectedPid: host.pid, expectedExe: host.exe, expectedProfile: host.profile };
  const desktopOwnerOptions = { port: options.desktopPort, expectedPid: options.desktopPid,
    expectedExe: path.join(repoRoot, "node_modules", "electron", "dist", "electron.exe"), expectedProfile: context.userData };
  const reportPath = path.join(resolvedRun, options.outputName);
  const screenshotName = `${options.outputName.slice(0, -5)}.png`;
  const reportFile = await open(reportPath, "wx");
  const report = createWorkbenchReport(options.scope);
  let desktopCreation;
  let ownersVerified = false;
  let main;
  let control;
  let controlUrl;
  let installationId;
  let restoreComplete = false;
  let metricsOverridden = false;
  let hiddenPauseControlPresent = false;
  let hiddenPauseUiMutationPerformed = false;
  let pauseWhenHiddenBefore;
  let visibleCohort = new Set();
  const hostConnections = new Map();
  const targetIndices = new Map();
  const step = async (name, operation) => {
    try {
      const metadata = await operation();
      report.steps.push({ name, status: "pass", ...(metadata === undefined ? {} : { metadata }) });
      console.log(JSON.stringify({ step: name, status: "pass" }));
      return metadata;
    } catch (error) {
      const reason = error instanceof WorkbenchError ? error.message : operationFailureReason(error);
      report.steps.push({ name, status: "fail", reason });
      console.log(JSON.stringify({ step: name, status: "fail", reason }));
      throw error;
    }
  };
  const unverified = (name, reason) => {
    if (!report.steps.some((entry) => entry.name === name)) report.steps.push({ name, status: "unverified", reason });
  };
  async function guard() {
    try {
      await verifyOwner(hostOwnerOptions, host.creation);
      await verifyOwner(desktopOwnerOptions, desktopCreation);
    } catch (error) { throw new WorkbenchError(ownershipFailureReason(error)); }
  }
  async function mutate(connection, expression) { await guard(); return connection.evaluate(expression); }
  async function poll(operation, predicate, reason, timeoutMs = 45_000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      // Navigation or a temporary target/socket loss is not a successful poll.
      // Retry within the deadline, never returning arbitrary renderer errors.
      try {
        const value = await operation();
        if (predicate(value)) return value;
      } catch {}
      await pause(200);
    }
    throw new WorkbenchError(reason);
  }
  async function hosts() {
    const targets = (await json(`http://127.0.0.1:${host.port}/json/list`)).filter(isVerifierRendererTarget);
    requireCondition(targets.length > 0, "no_verified_host_application_pages");
    const live = new Set(targets.map((target) => target.id));
    for (const [id, connection] of hostConnections) if (!live.has(id)) { connection.close(); hostConnections.delete(id); }
    for (const target of targets) {
      if (!targetIndices.has(target.id)) targetIndices.set(target.id, targetIndices.size);
      const previous = hostConnections.get(target.id);
      if (previous && (previous.url !== target.webSocketDebuggerUrl || previous.socket?.readyState !== 1)) {
        previous.close(); hostConnections.delete(target.id);
      }
      if (!hostConnections.has(target.id)) {
        const connection = new CdpConnection(target.webSocketDebuggerUrl, host.port);
        await connection.connect(); hostConnections.set(target.id, connection);
      }
    }
    return targets.map((target) => ({ connection: hostConnections.get(target.id), index: targetIndices.get(target.id) }));
  }
  async function states() { return Promise.all((await hosts()).map(async ({ connection, index }) => safeHostState(await connection.evaluate(HOST_STATE), index))); }
  const layers = (value, adaptive) => value.root && value.wallpaperStyle && value.compatibilityStyle && value.compatibilityRuntime && value.adaptive === adaptive;
  const active = (value, adaptive) => layers(value, adaptive) && value.video?.width > 0 && value.video.height > 0 && value.video.readyState >= 2 && value.video.errorCode === 0;
  const restored = (value) => !value.root && !value.wallpaperStyle && !value.compatibilityStyle && !value.compatibilityRuntime;
  async function selectTarget() {
    await mutate(control, `(() => {
      const select=document.querySelector('#desktopInstallationSelect'), port=document.querySelector('#desktopPortInput');
      if(!select || ![...select.options].some(option=>option.value===${JSON.stringify(installationId)}) || !port) throw new Error('missing_controls');
      select.value=${JSON.stringify(installationId)}; select.dispatchEvent(new Event('change',{bubbles:true}));
      port.value=${JSON.stringify(String(host.port))}; port.dispatchEvent(new Event('input',{bubbles:true})); return true;
    })()`);
  }
  async function clickOperation(button, { adaptive = true, brightness } = {}) {
    await selectTarget();
    await mutate(control, `(() => {
      const status=document.querySelector('#desktopApplyStatus'), button=document.querySelector(${JSON.stringify(button)});
      const mode=document.querySelector('#desktopAdaptiveInput');
      if(!status || !button || button.disabled || !mode) throw new Error('controls_not_ready');
      window.__cwbWorkbenchVerification?.observer?.disconnect();
      const tracker=window.__cwbWorkbenchVerification={started:false,complete:false,error:false};
      const observe=()=>{const tone=status.dataset.tone;if(tone==='busy') tracker.started=true;
        if(tracker.started && tone==='success' && !button.disabled) tracker.complete=true;
        if(tone==='error') tracker.error=true;};
      tracker.observer=new MutationObserver(observe);tracker.observer.observe(status,{attributes:true,childList:true,subtree:true});
      tracker.observer.observe(button,{attributes:true});
      mode.checked=${Boolean(adaptive)};mode.dispatchEvent(new Event('change',{bubbles:true}));
      ${brightness === undefined ? "" : `const range=document.querySelector('#brightnessRange');if(!range) throw new Error('missing_brightness');range.value=${Number(brightness)};range.dispatchEvent(new Event('input',{bubbles:true}));`}
      button.click();observe();return true;
    })()`);
    const result = await poll(() => control.evaluate(CONTROL_STATE), (value) => value.complete || value.error, "workbench_operation_did_not_complete");
    requireCondition(result.complete && result.tone === "success" && !result.error, "workbench_reported_operation_error");
    return { busyObserved: result.started, completionObserved: result.complete, tone: "success" };
  }
  async function restoreViaWorkbench() {
    await clickOperation("#desktopRestoreButton");
    const snapshot = await poll(states, (values) => values.every(restored), "workbench_restore_left_host_artifacts");
    restoreComplete = true;
    return { targetCount: snapshot.length, states: snapshot };
  }
  async function readIsolatedConfig() {
    const configFile = await realpath(path.join(context.stateRoot, "CodexWallpaperBridge", "config.json"));
    requireCondition(inside(await realpath(context.stateRoot), configFile) && (await stat(configFile)).size <= 512 * 1024, "isolated_config_read_boundary_failed");
    return JSON.parse(await readFile(configFile, "utf8"));
  }
  try {
    await step("verify-explicit-host-and-desktop-ownership", async () => {
      const hostEvidence = await verifyOwner(hostOwnerOptions, host.creation);
      const desktopEvidence = await verifyOwner(desktopOwnerOptions);
      desktopCreation = desktopEvidence.processCreation;
      ownersVerified = true;
      report.hostVersion = version(hostEvidence.executableVersion);
      report.desktopVersion = version(desktopEvidence.executableVersion);
      return { hostOwnershipVerified: true, desktopOwnershipVerified: true, currentChatExcluded: true };
    });
    await step("connect-existing-workbench-and-manifest-target", async () => {
      const permitted = [DESKTOP_RENDERER_URL, ...["src", "dist"].map((dir) => pathToFileURL(path.join(repoRoot, dir, "renderer", "index.html")).href)].map(url => url.toLowerCase());
      const targets = await poll(async () => (await json(`http://127.0.0.1:${options.desktopPort}/json/list`))
        .filter((target) => target.type === "page" && permitted.includes(String(target.url).toLowerCase())),
      (values) => values.length > 0, "desktop_renderer_did_not_become_ready", 30_000);
      requireCondition(targets.length === 1, "one_exact_existing_desktop_renderer_required");
      main = new CdpConnection(targets[0].webSocketDebuggerUrl, options.desktopPort); await main.connect();
      const source = await poll(() => main.evaluate("document.querySelector('#controlFrame')?.src"),
        (value) => typeof value === "string" && value.startsWith("http://127.0.0.1:"), "workbench_control_frame_did_not_load");
      controlUrl = trustedControlUrl(source);
      const frameTargets = await poll(async () => (await json(`http://127.0.0.1:${options.desktopPort}/json/list`))
        .filter((target) => target.type === "iframe" && target.url === controlUrl),
      (values) => values.length > 0, "workbench_control_cdp_target_did_not_load", 20_000);
      requireCondition(frameTargets.length === 1, "one_exact_existing_control_iframe_required");
      control = new CdpConnection(frameTargets[0].webSocketDebuggerUrl, options.desktopPort); await control.connect();
      await poll(() => control.evaluate(CONTROL_STATE), (value) => value.embedded && !value.disabled, "desktop_embedded_handshake_missing");
      await guard();
      installationId = await main.evaluate(`(async () => { const state=await window.cwbDesktop.getState();
        return state.installations.find(item=>item.path.replaceAll('\\\\','/').toLowerCase()===${JSON.stringify(host.exe.replaceAll("\\", "/").toLowerCase())})?.id || null; })()`);
      requireCondition(typeof installationId === "string" && installationId.length > 0, "manifest_installation_not_found_in_workbench");
      await selectTarget();
      return { desktopTargetCount: targets.length, controlIframeCount: frameTargets.length, manifestInstallationSelected: true };
    });
    let sample;
    await step("click-existing-real-video-library-card", async () => {
      const inventory = await json(new URL("api/inventory", controlUrl));
      const videos = inventory.projects?.filter((item) => item.type === "video" && item.playable === true && item.mediaUrl) || [];
      requireCondition(videos.length > 0, "no_real_playable_video_available");
      const visibleIds = await control.evaluate("[...document.querySelectorAll('.wallpaper-card[data-id]')].map(card=>card.dataset.id)");
      sample = videos.find((item) => Array.isArray(visibleIds) && visibleIds.includes(item.id));
      requireCondition(sample, "no_playable_video_card_visible_in_workbench");
      const source = new URL(sample.mediaUrl, controlUrl), base = new URL(controlUrl);
      requireCondition(source.origin === base.origin && source.pathname.startsWith(`${base.pathname}api/video/`), "video_source_not_session_scoped");
      const response = await fetch(source, { method: "HEAD", redirect: "error", signal: AbortSignal.timeout(15_000) });
      requireCondition(response.ok && (response.headers.get("content-type") || "").startsWith("video/"), "real_video_head_check_failed");
      await mutate(control, `(() => {const card=[...document.querySelectorAll('.wallpaper-card')].find(item=>item.dataset.id===${JSON.stringify(sample.id)});if(!card) throw new Error('missing_card');card.click();return true;})()`);
      return { availableVideoCount: videos.length, actualLibraryCardClicked: true, sourceFilesCopied: false };
    });
    await step("hidden-pause-ui-capability-and-explicit-test-policy", async () => {
      // Current checked-in UI has no such control. Never POST a hidden config
      // override to fabricate full hidden-page playback acceptance.
      hiddenPauseControlPresent = await control.evaluate("document.querySelector('#pauseWhenHiddenInput')?.type === 'checkbox'");
      if (options.scope === "control-only") {
        pauseWhenHiddenBefore = (await json(new URL("api/config", controlUrl))).config?.effects?.pauseWhenHidden;
        requireCondition(typeof pauseWhenHiddenBefore === "boolean", "hidden_pause_initial_state_not_available");
      }
      if (hiddenPauseControlPresent && options.scope === "full") {
        await mutate(control, "(() => {const input=document.querySelector('#pauseWhenHiddenInput'); if(input.disabled) throw new Error('disabled_control'); input.checked=false; input.dispatchEvent(new Event('change',{bubbles:true})); return input.checked === false;})()");
        hiddenPauseUiMutationPerformed = true;
      }
      return { hiddenPauseControlPresent: hiddenPauseControlPresent === true,
        hiddenPauseUiMutationPerformed: hiddenPauseUiMutationPerformed === true,
        uiMutationPerformed: hiddenPauseUiMutationPerformed === true,
        timeProgressScope: options.scope === "full" ? "current-visible-cohort-only" : "not-measured-control-only", hiddenPages: "metadata-only-not-playback-acceptance" };
    });
    await step("brightness-input-immediately-followed-by-real-apply-click", async () => {
      return clickOperation("#desktopApplyButton", { adaptive: true, brightness: 81 });
    });
    await step("save-handshake-api-and-disk-agree", async () => {
      const saved = (await json(new URL("api/config", controlUrl))).config;
      const disk = await readIsolatedConfig();
      requireCondition(saved?.effects?.brightness === 81 && disk?.effects?.brightness === 81
        && saved.selectedId === sample.id && disk.selectedId === sample.id, "latest_ui_config_not_persisted_before_apply");
      if (hiddenPauseUiMutationPerformed) requireCondition(saved.effects.pauseWhenHidden === false && disk.effects.pauseWhenHidden === false, "hidden_pause_ui_change_not_persisted");
      if (options.scope === "control-only") requireCondition(saved.effects.pauseWhenHidden === pauseWhenHiddenBefore && disk.effects.pauseWhenHidden === pauseWhenHiddenBefore, "control_only_scope_changed_hidden_pause_setting");
      return { apiBrightness: 81, diskBrightness: 81, selectedSampleMatches: true,
        hiddenPauseDisabledViaUi: hiddenPauseUiMutationPerformed === true, pauseWhenHidden: saved.effects.pauseWhenHidden === true };
    });
    if (options.scope === "full") {
      await step("activate-one-existing-independent-host-page", async () => {
        const existing = await hosts();
        requireCondition(existing.length > 0, "no_existing_host_page_to_activate");
        await guard(); await existing[0].connection.call("Page.bringToFront");
        report.hostActivationRequested = true;
        return { activationRequested: true, targetIndex: existing[0].index, createdNewWindow: false, nativeUiActivationVerified: false };
      });
      await step("real-host-visible-cohort-video-ready-and-time-advancing", async () => {
        const before = await poll(states, (values) => values.every((value) => layers(value, true))
          && values.some((value) => !value.hidden) && values.filter((value) => !value.hidden).every((value) => active(value, true)), "real_visible_host_video_not_ready");
        visibleCohort = new Set(before.filter((value) => !value.hidden).map((value) => value.targetIndex));
        await pause(1500);
        const after = await states();
        const selected = after.filter((value) => visibleCohort.has(value.targetIndex));
        requireCondition(selected.length === visibleCohort.size && selected.every((value) => {
          const previous = before.find((entry) => entry.targetIndex === value.targetIndex);
          return previous && !value.hidden && active(value, true) && !value.video.paused && Math.abs(value.video.currentTime - previous.video.currentTime) > 0.05;
        }), "real_visible_cohort_video_time_did_not_advance");
        report.visibleVideoPlaybackVerified = true;
        return { visibleCohortTargetCount: visibleCohort.size, hiddenPagesAtStart: before.filter((value) => value.hidden).length,
          progressionScope: "frozen-visible-cohort-only", before, after };
      });
    } else {
      unverified("activate-one-existing-independent-host-page", "control_only_scope_does_not_activate_host_pages");
      await step("real-host-all-target-layers-and-adaptive-mode", async () => {
        const snapshot = await poll(states, (values) => values.every((value) => layers(value, true)), "real_host_layers_or_adaptive_mode_not_applied");
        visibleCohort = new Set(snapshot.filter((value) => !value.hidden).map((value) => value.targetIndex));
        return { targetCount: snapshot.length, naturallyVisibleCohortTargetCount: visibleCohort.size, states: snapshot };
      });
      unverified("real-host-visible-cohort-video-ready-and-time-advancing", "control_only_scope_does_not_measure_visible_video_progression");
    }
    if (visibleCohort.size > 0) {
      await step("capture-real-media-reference-before-safe-apply", async () => {
        await poll(async () => {
          const existing = (await hosts()).filter(({ index }) => visibleCohort.has(index));
          if (existing.length !== visibleCohort.size) return false;
          for (const { connection } of existing) {
            const captured = await mutate(connection, `(() => {const frame=document.getElementById('codex-wallpaper-bridge-media');let video;try{video=frame?.contentDocument?.getElementById('cwb-media')}catch{};if(!video || video.tagName!=='VIDEO') return false;window.__cwbWorkbenchFrame=frame;window.__cwbWorkbenchVideo=video;return true;})()`);
            if (!captured) return false;
          }
          return visibleMediaReferenceMatches(await states(), visibleCohort);
        }, (value) => value === true, "visible_media_reference_capture_not_stable", 60_000);
        return { capturedTargetCount: visibleCohort.size, playbackTimeMeasured: false };
      });
    }
    await step(options.scope === "full" ? "safe-real-apply-preserves-existing-media-reference" : "safe-real-apply-confirms-all-target-layers-and-mode", async () => {
      const handshake = await clickOperation("#desktopApplyButton", { adaptive: false, brightness: 83 });
      const snapshot = await poll(states, (values) => values.every((value) => layers(value, false))
        && (options.scope === "control-only" || visibleMediaReferenceMatches(values, visibleCohort)), "safe_apply_rebuilt_visible_media_or_wrong_mode");
      requireCondition((await json(new URL("api/config", controlUrl))).config?.effects?.brightness === 83, "safe_brightness_not_saved");
      if (options.scope === "control-only") {
        const saved = (await json(new URL("api/config", controlUrl))).config;
        const disk = await readIsolatedConfig();
        requireCondition(disk.effects?.brightness === 83 && saved.selectedId === sample.id && disk.selectedId === sample.id, "safe_ui_config_api_and_disk_disagree");
        requireCondition(saved.effects.pauseWhenHidden === pauseWhenHiddenBefore && disk.effects.pauseWhenHidden === pauseWhenHiddenBefore, "control_only_scope_changed_hidden_pause_setting");
      } else report.mediaReferenceVerified = visibleCohort.size > 0;
      return { handshake, referenceCheckScope: options.scope === "full" ? "previously-visible-cohort-only" : "separate-naturally-visible-cohort-check", states: snapshot };
    });
    if (options.scope === "control-only") {
      if (visibleCohort.size > 0) {
        await step("safe-real-apply-preserves-existing-media-reference", async () => {
          const snapshot = await poll(states, (values) => values.every((value) => layers(value, false))
            && visibleMediaReferenceMatches(values, visibleCohort), "safe_apply_rebuilt_naturally_visible_media_or_cohort_changed");
          report.mediaReferenceVerified = visibleCohort.size > 0;
          return { referenceCheckScope: "naturally-visible-cohort-only-no-time-progression", targetCount: visibleCohort.size, states: snapshot };
        });
      } else unverified("safe-real-apply-preserves-existing-media-reference", "control_only_scope_has_no_naturally_visible_host_cohort");
    }
    await step("desktop-workbench-screenshot-only", async () => {
      await guard();
      const screenshot = await main.call("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
      requireCondition(typeof screenshot.data === "string", "desktop_screenshot_missing");
      await writeFile(path.join(resolvedRun, screenshotName), Buffer.from(screenshot.data, "base64"), { flag: "wx" });
      return { file: screenshotName, capturedDesktopWorkbenchOnly: true, capturedHostContent: false };
    });
    await step("compact-emulated-viewport-layout", async () => {
      await guard();
      metricsOverridden = true;
      await main.call("Emulation.setDeviceMetricsOverride", { width: 1040, height: 700, deviceScaleFactor: 1, mobile: false });
      await pause(250);
      const layout = await control.evaluate(`(() => {const bar=document.querySelector('#desktopTargetBar'),button=document.querySelector('#desktopApplyButton');return {width:innerWidth,barOverflow:!!bar && bar.scrollWidth>bar.clientWidth+1,applyVisible:!!button && button.getBoundingClientRect().right<=innerWidth+1};})()`);
      requireCondition(layout.width <= 1040 && layout.barOverflow === false && layout.applyVisible === true, "compact_workbench_controls_overflow");
      await guard(); await main.call("Emulation.clearDeviceMetricsOverride"); metricsOverridden = false;
      return { width: Number(layout.width), barOverflow: false, applyVisible: true, nativeWindowResizingVerified: false };
    });
    await step("real-workbench-restore-clears-both-host-layers", restoreViaWorkbench);
    report.outcome = "pass";
  } catch { report.outcome = "fail"; }
  finally {
    if (metricsOverridden && main && ownersVerified) {
      await step("cleanup-emulated-viewport", async () => { await guard(); await main.call("Emulation.clearDeviceMetricsOverride"); return { cleared: true }; }).catch(() => { report.outcome = "fail"; });
    }
    if (ownersVerified && control && installationId && !restoreComplete) {
      await step("cleanup-restore-through-verified-real-workbench", restoreViaWorkbench).catch(() => { report.outcome = "fail"; });
    } else if (!restoreComplete) {
      report.steps.push({ name: "cleanup-restore-through-verified-real-workbench", status: "unverified", reason: "ownership_or_workbench_target_gate_not_available_no_mutation_attempted" });
    }
    if (ownersVerified) {
      await step("final-explicit-process-identity-preserved", async () => { await guard(); return { hostNotClosed: true, desktopNotClosed: true }; }).catch(() => { report.outcome = "fail"; });
      for (const connection of hostConnections.values()) {
        try { await mutate(connection, "delete window.__cwbWorkbenchVideo; delete window.__cwbWorkbenchFrame;"); } catch {}
      }
      if (control) {
        try { await mutate(control, "window.__cwbWorkbenchVerification?.observer?.disconnect(); delete window.__cwbWorkbenchVerification;"); } catch {}
      }
    }
    for (const connection of hostConnections.values()) connection.close();
    main?.close(); control?.close();
    if (options.scope === "control-only") {
      unverified("activate-one-existing-independent-host-page", "control_only_scope_does_not_activate_host_pages");
      unverified("real-host-visible-cohort-video-ready-and-time-advancing", "control_only_scope_does_not_measure_visible_video_progression");
      if (!report.mediaReferenceVerified) unverified("safe-real-apply-preserves-existing-media-reference", visibleCohort.size === 0
        ? "control_only_scope_has_no_naturally_visible_host_cohort" : "control_only_scope_media_reference_check_did_not_complete");
    }
    report.steps.push({ name: "hidden-host-page-video-progression", status: "unverified", reason: "hidden_pages_sampled_only_not_counted_as_playback_acceptance" });
    for (const name of ["native-tray-residency-and-complete-exit", "native-menu-new-window", "actual-renderer-process-reconstruction", "human-input-scroll-and-click-review"]) {
      report.steps.push({ name, status: "unverified", reason: "outside_programmatic_workbench_scope" });
    }
    report.restoreComplete = restoreComplete;
    report.finishedAt = new Date().toISOString();
    try { await reportFile.writeFile(`${JSON.stringify(report, null, 2)}\n`, "utf8"); }
    finally { await reportFile.close(); }
  }
  console.log(JSON.stringify({ outcome: report.outcome, completeM0Gate: false, restoreComplete }));
  return report.outcome === "pass" ? 0 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = await run(parseArguments(process.argv.slice(2))); }
  catch { console.error(JSON.stringify({ status: "fail", reason: "workbench_verifier_setup_failed_raw_diagnostics_omitted" })); process.exitCode = 1; }
}
