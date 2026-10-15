import assert from "node:assert/strict";
import test from "node:test";
import { runLaunchAndInjectFlow } from "../src/launch-flow.mjs";

function installation(overrides = {}) {
  return {
    id: "local:test",
    path: "D:\\Work\\Codex\\ChatGPT.exe",
    isRunning: true,
    processIds: [6100, 6200],
    ...overrides,
  };
}

test("a running ordinary Codex is left untouched when the user cancels", async () => {
  const calls = [];
  const result = await runLaunchAndInjectFlow({
    installation: installation(),
    port: 9335,
    adaptive: true,
    isEndpointReady: async () => false,
    verifyEndpointOwner: async () => calls.push("verify"),
    confirmClose: async () => {
      calls.push("confirm");
      return false;
    },
    closeCodex: async () => calls.push("close"),
    launchCodex: async () => calls.push("launch"),
    waitForTarget: async () => calls.push("wait"),
    injectOnce: async () => calls.push("inject"),
  });

  assert.deepEqual(calls, ["confirm"]);
  assert.equal(result.canceled, true);
});

test("confirmation closes the selected Codex before launching and injecting", async () => {
  const calls = [];
  const result = await runLaunchAndInjectFlow({
    installation: installation(),
    port: 9447,
    adaptive: false,
    isEndpointReady: async () => false,
    verifyEndpointOwner: async (selected, port) => {
      calls.push("verify");
      assert.equal(selected.path, installation().path);
      assert.equal(port, 9447);
    },
    confirmClose: async () => {
      calls.push("confirm");
      return true;
    },
    closeCodex: async () => {
      calls.push("close");
      return { closedCount: 2 };
    },
    launchCodex: async ({ installation: selected, port }) => {
      calls.push("launch");
      assert.equal(selected.isRunning, false);
      assert.deepEqual(selected.processIds, []);
      assert.equal(port, 9447);
      return { connected: true };
    },
    waitForTarget: async () => {
      calls.push("wait");
      return [{ target: { id: "codex" } }];
    },
    injectOnce: async ({ port, adaptive }) => {
      calls.push("inject");
      assert.equal(port, 9447);
      assert.equal(adaptive, false);
      return { compatibility: [{ ok: true }] };
    },
  });

  assert.deepEqual(calls, ["confirm", "close", "launch", "wait", "verify", "inject"]);
  assert.equal(result.canceled, false);
  assert.equal(result.closed.closedCount, 2);
  assert.equal(result.launch.connected, true);
});

test("an already-debuggable Codex skips close, launch, and readiness wait", async () => {
  const calls = [];
  await runLaunchAndInjectFlow({
    installation: installation(),
    port: 9335,
    adaptive: true,
    isEndpointReady: async () => true,
    verifyEndpointOwner: async (selected, port) => {
      calls.push("verify");
      assert.equal(selected.path, installation().path);
      assert.equal(port, 9335);
    },
    confirmClose: async () => calls.push("confirm"),
    closeCodex: async () => calls.push("close"),
    launchCodex: async () => {
      calls.push("launch");
      return { connected: true, alreadyListening: true };
    },
    waitForTarget: async () => calls.push("wait"),
    injectOnce: async () => {
      calls.push("inject");
      return { compatibility: [] };
    },
  });

  assert.deepEqual(calls, ["verify", "inject"]);
});

test("a close failure stops launch and injection", async () => {
  const calls = [];
  await assert.rejects(() => runLaunchAndInjectFlow({
    installation: installation(),
    port: 9335,
    adaptive: true,
    isEndpointReady: async () => false,
    verifyEndpointOwner: async () => calls.push("verify"),
    confirmClose: async () => true,
    closeCodex: async () => {
      calls.push("close");
      throw new Error("关闭失败");
    },
    launchCodex: async () => calls.push("launch"),
    waitForTarget: async () => calls.push("wait"),
    injectOnce: async () => calls.push("inject"),
  }), /关闭失败/);

  assert.deepEqual(calls, ["close"]);
});

test("renderer readiness failure stops automatic injection", async () => {
  const calls = [];
  await assert.rejects(() => runLaunchAndInjectFlow({
    installation: installation({ isRunning: false, processIds: [] }),
    port: 9335,
    adaptive: true,
    isEndpointReady: async () => false,
    verifyEndpointOwner: async () => calls.push("verify"),
    confirmClose: async () => calls.push("confirm"),
    closeCodex: async () => calls.push("close"),
    launchCodex: async () => {
      calls.push("launch");
      return { connected: true };
    },
    waitForTarget: async () => {
      calls.push("wait");
      throw new Error("renderer 未就绪");
    },
    injectOnce: async () => calls.push("inject"),
  }), /renderer 未就绪/);

  assert.deepEqual(calls, ["launch", "wait"]);
});

for (const isReady of [true, false]) {
  test(`endpoint ownership failure stops injection (initially ready: ${isReady})`, async () => {
    const calls = [];
    await assert.rejects(runLaunchAndInjectFlow({
      installation: installation({ isRunning: false }),
      port: 9335,
      adaptive: true,
      isEndpointReady: async () => isReady,
      verifyEndpointOwner: async () => {
        calls.push("verify");
        throw new Error("端口不属于所选 Codex");
      },
      confirmClose: async () => calls.push("confirm"),
      closeCodex: async () => calls.push("close"),
      launchCodex: async () => calls.push("launch"),
      waitForTarget: async () => calls.push("wait"),
      injectOnce: async () => calls.push("inject"),
    }), /不属于所选 Codex/);
    assert.deepEqual(calls, isReady ? ["verify"] : ["launch", "wait", "verify"]);
  });
}

test("already-ready ownership rejection does not confirm or close a running selected installation", async () => {
  const calls = [];
  await assert.rejects(runLaunchAndInjectFlow({
    installation: installation(),
    port: 9335,
    adaptive: true,
    isEndpointReady: async () => true,
    verifyEndpointOwner: async () => { calls.push("verify"); throw new Error("所选 Codex 不匹配"); },
    confirmClose: async () => calls.push("confirm"),
    closeCodex: async () => calls.push("close"),
    launchCodex: async () => calls.push("launch"),
    waitForTarget: async () => calls.push("wait"),
    injectOnce: async () => calls.push("inject"),
  }), /不匹配/);
  assert.deepEqual(calls, ["verify"]);
});

test("ownership verification callback is mandatory before any endpoint or lifecycle operation", async () => {
  const calls = [];
  await assert.rejects(runLaunchAndInjectFlow({
    installation: installation(),
    port: 9335,
    isEndpointReady: async () => { calls.push("ready"); return true; },
    confirmClose: async () => calls.push("confirm"),
    closeCodex: async () => calls.push("close"),
    launchCodex: async () => calls.push("launch"),
    waitForTarget: async () => calls.push("wait"),
    injectOnce: async () => calls.push("inject"),
  }), /verifyEndpointOwner/);
  assert.deepEqual(calls, []);
});

function separateLaunchFixture(overrides = {}) {
  const calls = [];
  const selected = installation({ id: "store", isRunning: false, processIds: [] });
  const running = installation({ id: "local", path: "D:\\OtherCodex\\ChatGPT.exe" });
  const options = {
    installation: selected,
    runningInstallations: [running],
    port: 9335,
    isEndpointReady: async () => false,
    verifyEndpointOwner: async () => calls.push("verify"),
    confirmClose: async () => { calls.push("confirm-close"); return true; },
    confirmLaunchSeparate: async (target, others) => {
      calls.push("confirm-separate");
      assert.equal(target, selected);
      assert.deepEqual(others, [running]);
      return true;
    },
    closeCodex: async () => calls.push("close"),
    launchCodex: async ({ installation: target }) => {
      calls.push("launch");
      assert.equal(target, selected);
      return { connected: true };
    },
    waitForTarget: async () => calls.push("wait"),
    injectOnce: async () => { calls.push("inject"); return { compatibility: [] }; },
    ...overrides,
  };
  return { calls, options, selected, running };
}

for (const response of [false, undefined, 0]) {
  test(`canceling a different-installation launch leaves the original windows untouched (response: ${response})`, async () => {
    const fixture = separateLaunchFixture();
    fixture.options.confirmLaunchSeparate = async () => { fixture.calls.push("confirm-separate"); return response; };
    const result = await runLaunchAndInjectFlow(fixture.options);
    assert.equal(result.canceled, true);
    assert.match(result.message, /未启动另一版本/);
    assert.deepEqual(fixture.calls, ["confirm-separate"]);
  });
}

test("explicit cross-installation confirmation starts only the selected version and never closes the other version", async () => {
  const fixture = separateLaunchFixture();
  const result = await runLaunchAndInjectFlow(fixture.options);
  assert.equal(result.canceled, false);
  assert.equal(result.closed, null);
  assert.deepEqual(fixture.calls, ["confirm-separate", "launch", "wait", "verify", "inject"]);
});

test("a missing cross-installation confirmation callback fails closed", async () => {
  const fixture = separateLaunchFixture({ confirmLaunchSeparate: undefined });
  await assert.rejects(runLaunchAndInjectFlow(fixture.options), /启动另一版本.*需要确认/);
  assert.deepEqual(fixture.calls, []);
});

test("a rejected cross-installation confirmation never starts or closes anything", async () => {
  const fixture = separateLaunchFixture({ confirmLaunchSeparate: async () => { throw new Error("dialog failed"); } });
  await assert.rejects(runLaunchAndInjectFlow(fixture.options), /dialog failed/);
  assert.deepEqual(fixture.calls, []);
});

test("an existing verified endpoint is reused without prompting to open another window", async () => {
  const fixture = separateLaunchFixture({ isEndpointReady: async () => true });
  await runLaunchAndInjectFlow(fixture.options);
  assert.deepEqual(fixture.calls, ["verify", "inject"]);
});

test("an existing endpoint owned by another installation is rejected before any dialog or lifecycle action", async () => {
  const fixture = separateLaunchFixture({ isEndpointReady: async () => true });
  fixture.options.verifyEndpointOwner = async () => { fixture.calls.push("verify"); throw new Error("所选 Codex 不匹配"); };
  await assert.rejects(runLaunchAndInjectFlow(fixture.options), /不匹配/);
  assert.deepEqual(fixture.calls, ["verify"]);
});

test("stopped installations and the selected installation itself do not trigger the other-version prompt", async () => {
  const fixture = separateLaunchFixture();
  fixture.options.runningInstallations = [
    { ...fixture.running, isRunning: false },
    { ...fixture.selected, isRunning: true },
  ];
  await runLaunchAndInjectFlow(fixture.options);
  assert.deepEqual(fixture.calls, ["launch", "wait", "verify", "inject"]);
});

test("startup phase diagnostics preserve ordering and carry no installation or document data", async () => {
  const phases = [];
  const fixture = separateLaunchFixture({ onPhase: (phase) => phases.push(phase) });
  await runLaunchAndInjectFlow(fixture.options);
  assert.deepEqual(phases.map(({ phase }) => phase), ["endpoint", "confirmation", "launch", "target", "owner", "inject"]);
  for (const phase of phases) {
    assert.equal(phase.ok, true);
    assert.ok(Number.isFinite(phase.elapsedMs) && phase.elapsedMs >= 0);
    assert.deepEqual(Object.keys(phase).sort(), ["elapsedMs", "ok", "phase"]);
  }
});

test("failed phases are timed without converting failure into success, and diagnostics cannot break launch", async () => {
  const phases = [];
  const fixture = separateLaunchFixture({ isEndpointReady: async () => true, onPhase: (phase) => phases.push(phase) });
  fixture.options.verifyEndpointOwner = async () => { throw Error("fixture-owner-mismatch"); };
  await assert.rejects(runLaunchAndInjectFlow(fixture.options), /owner-mismatch/);
  assert.deepEqual(phases.map(({ phase, ok }) => [phase, ok]), [["endpoint", true], ["owner", false]]);
  const observerFailure = separateLaunchFixture({ onPhase: () => { throw Error("observer failed"); } });
  assert.equal((await runLaunchAndInjectFlow(observerFailure.options)).canceled, false);
});
