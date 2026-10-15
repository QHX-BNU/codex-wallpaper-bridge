import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import test from "node:test";
import { promisify } from "node:util";
import { verifyCdpEndpointOwner } from "../src/cdp-owner.mjs";

const selected = { path: "C:\\Program Files\\WindowsApps\\OpenAI.Codex_1.0\\app\\ChatGPT.exe" };
const execFileAsync = promisify(execFile);
const independentProcess = { pid: 6100, creation: "2026-10-09T13:00:00.1234567", profile: "D:\\Acceptance Fixtures\\SECRET_PROFILE" };

function evidence(overrides = {}) {
  return {
    listeners: [{ localAddress: "127.0.0.1", localPort: 9335, owningProcess: 6100 }],
    owners: [{ processId: 6100, executablePath: selected.path, remoteDebuggingPorts: [9335], hasInvalidRemoteDebuggingPort: false }],
    ...overrides,
  };
}

function verify(payload = evidence(), options = {}) {
  return verifyCdpEndpointOwner({
    installation: selected,
    port: 9335,
    platform: "win32",
    processRunner: async () => ({ stdout: JSON.stringify(payload) }),
    ...options,
  });
}

test("a loopback listener matches the selected executable and actual debugging-port argv", async () => {
  const result = await verify();
  assert.deepEqual(result, {
    port: 9335,
    processId: 6100,
    executablePath: selected.path,
    listenerAddresses: ["127.0.0.1"],
  });
});

test("Windows path comparison is case-insensitive and normalizes separators", async () => {
  const owner = evidence().owners[0];
  const result = await verify(evidence({ owners: [{ ...owner, executablePath: selected.path.toLowerCase().replaceAll("\\", "/") }] }));
  assert.equal(result.processId, 6100);
});

test("one owning process may listen on both IPv4 and IPv6 loopback", async () => {
  const result = await verify(evidence({ listeners: [
    { localAddress: "127.0.0.1", localPort: 9335, owningProcess: 6100 },
    { localAddress: "::1", localPort: 9335, owningProcess: 6100 },
  ] }));
  assert.deepEqual(result.listenerAddresses, ["127.0.0.1", "::1"]);
});

test("a selected Store installation never adopts a local EXE endpoint", async () => {
  const owner = evidence().owners[0];
  await assert.rejects(verify(evidence({ owners: [{ ...owner, executablePath: "D:\\Apps\\Codex\\ChatGPT.exe" }] })), /所选 Codex/);
});

for (const address of ["0.0.0.0", "::", "192.168.1.5", "::ffff:192.168.1.5", "localhost", "127.0.0.999"]) {
  test(`non-loopback or malformed listener ${address} is rejected`, async () => {
    await assert.rejects(verify(evidence({ listeners: [{ localAddress: address, localPort: 9335, owningProcess: 6100 }] })), /loopback/);
  });
}

test("multiple listener owners fail closed even when both executable paths match", async () => {
  const owner = evidence().owners[0];
  await assert.rejects(verify(evidence({
    listeners: [
      { localAddress: "127.0.0.1", localPort: 9335, owningProcess: 6100 },
      { localAddress: "::1", localPort: 9335, owningProcess: 6200 },
    ],
    owners: [owner, { ...owner, processId: 6200 }],
  })), /多个进程/);
});

for (const remoteDebuggingPorts of [[], [9447], [9335, 9447], [9335, 9335], ["9335"], [null]]) {
  test(`missing, ambiguous, or mismatched actual argv ports ${JSON.stringify(remoteDebuggingPorts)} are rejected`, async () => {
    const owner = evidence().owners[0];
    await assert.rejects(verify(evidence({ owners: [{ ...owner, remoteDebuggingPorts }] })), /remote-debugging-port/);
  });
}

test("a malformed debugging-port flag fails closed", async () => {
  const owner = evidence().owners[0];
  await assert.rejects(verify(evidence({ owners: [{ ...owner, hasInvalidRemoteDebuggingPort: true }] })), /remote-debugging-port/);
});

test("a listener cannot be verified without accessible executable metadata", async () => {
  const owner = evidence().owners[0];
  await assert.rejects(verify(evidence({ owners: [{ ...owner, executablePath: null }] })), /可执行文件路径/);
});

for (const payload of [null, {}, { listeners: [], owners: [] }, evidence({ owners: [] }), evidence({ owners: [{ ...evidence().owners[0], processId: 6200 }] }), evidence({ listeners: [{ localAddress: "127.0.0.1", localPort: 9447, owningProcess: 6100 }] })]) {
  test(`incomplete or inconsistent owner evidence ${JSON.stringify(payload)} is rejected`, async () => {
    await assert.rejects(verify(payload));
  });
}

test("query failures do not expose stderr, a full command line, or profile information", async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: async () => { throw new Error("access denied SECRET_PROFILE --user-data-dir=secret"); },
  }), (error) => {
    assert.match(error.message, /无法核验/);
    assert.doesNotMatch(error.message, /SECRET_PROFILE|user-data-dir|secret/);
    return true;
  });
});

test("invalid query output is rejected without echoing raw content", async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: async () => ({ stdout: "SECRET_PROFILE" }),
  }), (error) => {
    assert.match(error.message, /无效/);
    assert.doesNotMatch(error.message, /SECRET_PROFILE/);
    return true;
  });
});

test("structured query failure remains fail-closed with only whitelisted diagnostics", async () => {
  await assert.rejects(verify({ ...evidence(), queryFailure: { stage: "listeners", kind: "access", nativeCode: 2, message: "SECRET_PROFILE", commandLine: "secret" } }), (error) => {
    assert.equal(error.code, "CWB_CDP_OWNER_QUERY_FAILED");
    assert.equal(error.queryStage, "listeners");
    assert.equal(error.queryKind, "access");
    assert.equal(error.nativeCode, 2);
    assert.match(error.message, /监听端口.*访问被拒绝/);
    assert.doesNotMatch(JSON.stringify(error) + error.message, /SECRET_PROFILE|commandLine|secret/);
    return true;
  });
});

for (const queryFailure of [null, {}, { stage: "SECRET_PROFILE", kind: "query", nativeCode: null },
  { stage: "owner", kind: "secret", nativeCode: null }, { stage: "owner", kind: "cim", nativeCode: "2" },
  { stage: "owner", kind: "cim", nativeCode: -1 }, { stage: ["owner"], kind: ["query"], nativeCode: null }]) {
  test("untrusted query failure fields are rejected without echo", async () => {
    await assert.rejects(verify({ queryFailure }), (error) => {
      assert.match(error.message, /结果无效/);
      assert.doesNotMatch(error.message, /SECRET_PROFILE|secret/);
      return true;
    });
  });
}

for (const [cause, expected] of [[{ code: "ENOENT" }, /PowerShell 不可用/], [{ code: "EPERM" }, /启动被拒绝/],
  [{ killed: true }, /查询超时/]]) {
  test("query launch and timeout diagnostics omit raw process errors", async () => {
    await assert.rejects(verify(evidence(), {
      processRunner: async () => { throw Object.assign(new Error("SECRET_PROFILE"), cause); },
    }), (error) => { assert.match(error.message, expected); assert.doesNotMatch(error.message, /SECRET_PROFILE/); return true; });
  });
}

test("the injected execFile runner receives a hidden read-only PowerShell query and a numeric port environment value", async () => {
  let queried = false;
  await verify(evidence(), {
    port: "9335",
    processRunner: async (executable, arguments_, options) => {
      queried = true;
      assert.equal(executable, "powershell.exe");
      assert.deepEqual(arguments_.slice(0, 3), ["-NoProfile", "-NonInteractive", "-Command"]);
      assert.match(arguments_[3], /Get-NetTCPConnection/);
      assert.match(arguments_[3], /Get-CimInstance/);
      assert.match(arguments_[3], /CommandLineToArgvW/);
      assert.doesNotMatch(arguments_[3], /Stop-Process|Start-Process|Set-Content|Out-File/);
      assert.doesNotMatch(arguments_[3], /CommandLine\s*=/);
      assert.equal(options.env.CWB_CDP_OWNER_PORT, "9335");
      assert.equal(options.env.CWB_CDP_EXPECTED_PROCESS, "");
      assert.equal(options.windowsHide, true);
      assert.equal(options.encoding, "utf8");
      assert.ok(options.timeout > 0);
      return { stdout: JSON.stringify(evidence()) };
    },
  });
  assert.equal(queried, true);
});

test("invalid caller inputs are rejected before running PowerShell", async () => {
  const processRunner = async () => { assert.fail("must not query"); };
  await assert.rejects(verify(evidence(), { installation: null, processRunner }), /可执行文件路径/);
  await assert.rejects(verify(evidence(), { installation: { path: "ChatGPT.exe" }, processRunner }), /可执行文件路径/);
  await assert.rejects(verify(evidence(), { port: "9335;Stop-Process", processRunner }), /端口/);
  await assert.rejects(verify(evidence(), { platform: "linux", processRunner }), /Windows/);
});

// Run the production PowerShell and native argv parser, replacing only the two
// OS metadata queries with fixtures. No real process is inspected or changed.
function fixturePowerShellRunner({ commandLine, executablePath = selected.path, localAddress = "127.0.0.1", listeners, queryError = false, creation = independentProcess.creation, creationKind = "roundtrip", ancestorMode = "normal" }) {
  return async (executable, arguments_, options) => {
    const fixtures = String.raw`
function Get-NetTCPConnection {
  if ($env:CWB_TEST_QUERY_ERROR -eq 'true') { throw 'SECRET_PROFILE access denied' }
  foreach ($fixtureListener in ($env:CWB_TEST_LISTENERS | ConvertFrom-Json)) { $fixtureListener }
}
function Get-CimInstance {
  [CmdletBinding()]
  param([string]$ClassName, [string]$Filter, [string[]]$Property)
  if ($Property -contains 'ParentProcessId') {
    if ($Filter -notmatch '^ProcessId = ([0-9]+)$') { throw 'Invalid fixture filter' }
    $queriedId = [int]$Matches[1]
    if ($queriedId -eq $PID) { $parentId = 9000 }
    elseif ($env:CWB_TEST_ANCESTOR_MODE -eq 'host' -and $queriedId -eq 9000) { $parentId = 6100 }
    elseif ($env:CWB_TEST_ANCESTOR_MODE -eq 'predates' -and $queriedId -eq 9000) { $parentId = 9999 }
    elseif ($env:CWB_TEST_ANCESTOR_MODE -eq 'predates') { return }
    elseif ($env:CWB_TEST_ANCESTOR_MODE -eq 'cycle') { $parentId = 9000 }
    elseif ($env:CWB_TEST_ANCESTOR_MODE -in @('missing', 'same-tick')) { return }
    elseif ($env:CWB_TEST_ANCESTOR_MODE -eq 'too-deep') { $parentId = $queriedId + 1 }
    else { $parentId = 0 }
    $ancestorCreation = [DateTime]::ParseExact($env:CWB_TEST_CREATION, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind).AddTicks(1)
    if ($env:CWB_TEST_ANCESTOR_MODE -eq 'predates' -and $queriedId -ne $PID) { $ancestorCreation = $ancestorCreation.AddTicks(-2) }
    if ($env:CWB_TEST_ANCESTOR_MODE -eq 'reused-parent' -and $queriedId -ne $PID) { $ancestorCreation = $ancestorCreation.AddTicks(1) }
    if ($env:CWB_TEST_ANCESTOR_MODE -eq 'same-tick') { $ancestorCreation = $ancestorCreation.AddTicks(-1) }
    if ($env:CWB_TEST_ANCESTOR_MODE -eq 'missing-date') { $ancestorCreation = $null }
    return [pscustomobject]@{ ProcessId = $queriedId; ParentProcessId = $parentId; CreationDate = $ancestorCreation }
  }
  $creationDate = [DateTime]::ParseExact($env:CWB_TEST_CREATION, 'o', [Globalization.CultureInfo]::InvariantCulture, [Globalization.DateTimeStyles]::RoundtripKind)
  if ($env:CWB_TEST_CREATION_KIND -eq 'local') { $creationDate = $creationDate.ToLocalTime() }
  [pscustomobject]@{
    ProcessId = 6100
    ExecutablePath = $env:CWB_TEST_EXE
    CommandLine = $env:CWB_TEST_ARGV
    CreationDate = $creationDate
  }
}
`;
    const result = await execFileAsync(executable, [...arguments_.slice(0, 3), `${fixtures}\n${arguments_[3]}`], {
      ...options,
      env: {
        ...options.env,
        CWB_TEST_EXE: executablePath,
        CWB_TEST_ARGV: commandLine,
        CWB_TEST_LISTENERS: JSON.stringify(listeners || [{ LocalAddress: localAddress, LocalPort: 9335, OwningProcess: 6100 }]),
        CWB_TEST_QUERY_ERROR: String(queryError),
        CWB_TEST_CREATION: creation,
        CWB_TEST_CREATION_KIND: creationKind,
        CWB_TEST_ANCESTOR_MODE: ancestorMode,
      },
    });
    assert.doesNotMatch(result.stdout, /SECRET_PROFILE|CommandLine|user-data-dir/);
    return result;
  };
}

const windowsOnly = { skip: process.platform !== "win32" };

test("runtime PowerShell native parser accepts a real equals-form debugging switch and emits only narrow evidence", windowsOnly, async () => {
  const result = await verify(evidence(), {
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="C:\\SECRET_PROFILE"` }),
  });
  assert.equal(result.processId, 6100);
});

test("runtime PowerShell native parser accepts a separate port value", windowsOnly, async () => {
  const result = await verify(evidence(), {
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port 9335` }),
  });
  assert.equal(result.port, 9335);
});

test("runtime PowerShell native parser does not mistake a switch embedded inside a quoted profile value for actual argv", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" "--user-data-dir=C:\\SECRET_PROFILE --remote-debugging-port=9335"` }),
  }), /remote-debugging-port/);
});

test("runtime PowerShell rejects a listener belonging to another executable", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: fixturePowerShellRunner({ commandLine: '"D:\\Apps\\ChatGPT.exe" --remote-debugging-port=9335', executablePath: "D:\\Apps\\ChatGPT.exe" }),
  }), /所选 Codex/);
});

test("runtime PowerShell rejects a non-loopback listener", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335`, localAddress: "0.0.0.0" }),
  }), /loopback/);
});

test("runtime PowerShell query denial fails closed without exposing raw diagnostics", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335`, queryError: true }),
  }), (error) => {
    assert.match(error.message, /无法核验/);
    assert.equal(error.queryStage, "listeners");
    assert.equal(error.queryKind, "query");
    assert.doesNotMatch(error.message, /SECRET_PROFILE|access denied/);
    return true;
  });
});

test("runtime PowerShell rejects multiple listener owners", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    processRunner: fixturePowerShellRunner({
      commandLine: `"${selected.path}" --remote-debugging-port=9335`,
      listeners: [
        { LocalAddress: "127.0.0.1", LocalPort: 9335, OwningProcess: 6100 },
        { LocalAddress: "::1", LocalPort: 9335, OwningProcess: 6200 },
      ],
    }),
  }), /多个进程/);
});

for (const suffix of ["--remote-debugging-port=9447", "--remote-debugging-port=abc", "--remote-debugging-port", "--remote-debugging-port=9335 --remote-debugging-port=9335"]) {
  test(`runtime PowerShell rejects missing, invalid, duplicate, or mismatched argv: ${suffix}`, windowsOnly, async () => {
    await assert.rejects(verify(evidence(), {
      processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" ${suffix}` }),
    }), /remote-debugging-port/);
  });
}

function independentEvidence(overrides = {}) {
  return evidence({ independentIdentity: {
    processIdMatches: true,
    creationMatches: true,
    profileMatches: true,
    notQueryAncestor: true,
    ancestorChainVerified: true,
    ...overrides,
  } });
}

test("optional independent metadata is validated and passed whole as JSON without changing returned fields", async () => {
  const result = await verify(independentEvidence(), {
    expectedProcess: independentProcess,
    processRunner: async (_executable, _arguments, options) => {
      assert.deepEqual(JSON.parse(options.env.CWB_CDP_EXPECTED_PROCESS), independentProcess);
      return { stdout: JSON.stringify(independentEvidence()) };
    },
  });
  assert.deepEqual(Object.keys(result).sort(), ["executablePath", "listenerAddresses", "port", "processId"]);
  assert.doesNotMatch(JSON.stringify(result), /SECRET_PROFILE|creation|token/);
});

for (const field of ["processIdMatches", "creationMatches", "profileMatches", "notQueryAncestor", "ancestorChainVerified"]) {
  test(`independent identity rejects a failed ${field} check`, async () => {
    await assert.rejects(verify(independentEvidence({ [field]: false }), { expectedProcess: independentProcess }), /独立验收/);
  });
}

test("independent metadata requires identity booleans rather than accepting incomplete evidence", async () => {
  await assert.rejects(verify(evidence(), { expectedProcess: independentProcess }), /独立验收/);
});

for (const expectedProcess of [null, {}, [], { ...independentProcess, pid: 0 }, { ...independentProcess, pid: "6100" }, { ...independentProcess, pid: Number.MAX_SAFE_INTEGER + 1 }, { ...independentProcess, profile: "relative-profile" }, { ...independentProcess, profile: "\\root-relative" }, { ...independentProcess, creation: "2026-10-09" }, { ...independentProcess, creation: "2026-02-30T13:00:00.1234567" }, { ...independentProcess, token: "SECRET_TOKEN" }]) {
  test(`invalid independent metadata is rejected before querying (${JSON.stringify(expectedProcess)})`, async () => {
    await assert.rejects(verify(evidence(), {
      expectedProcess,
      processRunner: async () => assert.fail("must not query invalid metadata"),
    }), /独立验收/);
  });
}

for (const profileArgument of [`--user-data-dir="${independentProcess.profile}"`, `--user-data-dir "${independentProcess.profile}"`]) {
  test(`runtime independent identity matches PID, creation, and a spaced profile argv (${profileArgument.startsWith("--user-data-dir=") ? "equal" : "split"})`, windowsOnly, async () => {
    const result = await verify(evidence(), {
      expectedProcess: independentProcess,
      processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 ${profileArgument}` }),
    });
    assert.equal(result.processId, independentProcess.pid);
    assert.doesNotMatch(JSON.stringify(result), /SECRET_PROFILE|creation/);
  });
}

test("runtime independent identity rejects PID reuse with a different creation tick", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    expectedProcess: independentProcess,
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="${independentProcess.profile}"`, creation: "2026-10-09T13:00:00.1234568" }),
  }), /独立验收/);
});

for (const [ownerCreation, expectedCreation, creationKind] of [
  ["2026-10-09T13:00:00.1234567+08:00", "2026-10-09T05:00:00.1234567Z", "roundtrip"],
  ["2026-10-09T05:00:00.1234567Z", "2026-10-09T13:00:00.1234567+08:00", "roundtrip"],
  ["2026-10-09T05:00:00.1234567Z", "2026-10-09T05:00:00.1234567Z", "local"],
]) {
  test(`runtime creation timezone equivalents compare exact UTC ticks (${creationKind}, ${expectedCreation.endsWith("Z") ? "Z" : "offset"} metadata)`, windowsOnly, async () => {
    const result = await verify(evidence(), {
      expectedProcess: { ...independentProcess, creation: expectedCreation },
      processRunner: fixturePowerShellRunner({
        commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="${independentProcess.profile}"`,
        creation: ownerCreation,
        creationKind,
      }),
    });
    assert.equal(result.processId, independentProcess.pid);
  });
}

for (const [ownerCreation, expectedCreation] of [
  ["2026-10-09T13:00:00.1234568+08:00", "2026-10-09T05:00:00.1234567Z"],
  ["2026-10-09T13:00:00.1234567+08:00", "2026-10-09T13:00:00.1234567Z"],
]) {
  test(`runtime creation timezone differences reject a distinct instant or one tick (${ownerCreation.slice(-7)})`, windowsOnly, async () => {
    await assert.rejects(verify(evidence(), {
      expectedProcess: { ...independentProcess, creation: expectedCreation },
      processRunner: fixturePowerShellRunner({
        commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="${independentProcess.profile}"`,
        creation: ownerCreation,
      }),
    }), /独立验收/);
  });
}

test("runtime independent identity rejects a different listener PID", windowsOnly, async () => {
  await assert.rejects(verify(evidence(), {
    expectedProcess: { ...independentProcess, pid: 6200 },
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="${independentProcess.profile}"` }),
  }), /独立验收/);
});

for (const profileArgument of ['--user-data-dir="D:\\Wrong\\SECRET_PROFILE"', '"--title=--user-data-dir=D:\\Acceptance Fixtures\\SECRET_PROFILE"', `--user-data-dir="${independentProcess.profile}" --user-data-dir="${independentProcess.profile}"`, '--user-data-dir="\\Acceptance Fixtures\\SECRET_PROFILE"', `-- --user-data-dir="${independentProcess.profile}"`, "--user-data-dir"]) {
  test(`runtime independent identity rejects mismatched, embedded, duplicate, or missing profile argv (${profileArgument.split(" ")[0]})`, windowsOnly, async () => {
    await assert.rejects(verify(evidence(), {
      expectedProcess: independentProcess,
      processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 ${profileArgument}` }),
    }), /独立验收/);
  });
}

for (const ancestorMode of ["host", "cycle", "missing", "too-deep", "same-tick", "missing-date", "reused-parent"]) {
  test(`runtime independent identity excludes the current query host and unverified ancestry (${ancestorMode})`, windowsOnly, async () => {
    await assert.rejects(verify(evidence(), {
      expectedProcess: independentProcess,
      processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="${independentProcess.profile}"`, ancestorMode }),
    }), /独立验收|无法核验/);
  });
}

test("runtime ancestry can prove independence at an exact-tick boundary before the target existed", windowsOnly, async () => {
  const result = await verify(evidence(), {
    expectedProcess: independentProcess,
    processRunner: fixturePowerShellRunner({ commandLine: `"${selected.path}" --remote-debugging-port=9335 --user-data-dir="${independentProcess.profile}"`, ancestorMode: "predates" }),
  });
  assert.equal(result.processId, independentProcess.pid);
});
