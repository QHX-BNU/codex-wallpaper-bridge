import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.resolve(process.argv[2] || "");
const relative = path.relative(path.join(repo, "out"), output);
if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) throw Error("An isolated out directory is required");
await mkdir(output);
const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(createRequire(import.meta.url)("electron"), [path.join(repo, "scripts/verify-window-chrome.cjs"), output,
  ...(process.argv[3] ? [path.resolve(process.argv[3])] : [])], { cwd: repo, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
let log = "", timedOut = false;
for (const stream of [child.stdout, child.stderr]) stream.on("data", bytes => { log = (log + bytes).slice(-131072); });
const timer = setTimeout(() => { timedOut = true; child.kill(); }, 45000);
const code = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", resolve); }).finally(() => clearTimeout(timer));
await writeFile(path.join(output, "process.log"), log);
const proof = JSON.parse(await readFile(path.join(output, "proof.json"), "utf8"));
const root = await realpath(output), profile = await realpath(path.join(output, "profile"));
const actualOut = await realpath(path.join(repo, "out")), contained = path.relative(actualOut, root);
if (!contained || contained.startsWith("..") || path.isAbsolute(contained)) throw Error("Fixture output escaped the real out directory");
if (path.dirname(profile) !== root || path.basename(profile) !== "profile") throw Error("Fixture profile escaped its owned output");
await rm(profile, { recursive: true, force: true, maxRetries: 2, retryDelay: 200 });
const ok = code === 0 && !timedOut && proof.ok === true;
await writeFile(path.join(output, "runner.json"), JSON.stringify({ ok, code, timedOut, profileRemoved: true }));
console.log(JSON.stringify({ ok, themes: proof.themes.length, nativeHitTest: proof.nativeHitTest, error: proof.error }));
process.exitCode = ok ? 0 : 1;
