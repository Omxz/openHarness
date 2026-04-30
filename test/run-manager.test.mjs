import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { readEvents } from "../src/audit-log.mjs";
import { normalizeConfig } from "../src/config.mjs";
import { createRunManager } from "../src/run-manager.mjs";

test("createRunManager pauses API-started runs for dashboard approval and resumes after approve", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-run-manager-"));
  const logPath = join(workspace, "events.jsonl");
  const fakeProvider = await startFakeOpenAICompatibleProvider([
    {
      type: "tool_call",
      toolName: "shell",
      input: { command: "node", args: ["--version"] },
    },
    {
      type: "final",
      content: "approved shell command completed",
    },
  ]);

  try {
    const manager = createRunManager({
      workspace,
      logPath,
      config: normalizeConfig({
        provider: "openai-compatible",
        providers: {
          "openai-compatible": {
            baseUrl: fakeProvider.url,
            model: "fake-model",
          },
        },
      }),
      verifier: { command: "node", args: ["--version"] },
    });

    const run = manager.startRun({
      goal: "check node version",
      provider: "openai-compatible",
      privacyMode: "local-only",
    });

    const pending = await waitForPendingApproval(manager);
    assert.equal(pending.runId, run.runId);
    assert.equal(pending.toolName, "shell");
    assert.equal(pending.risk, "write");
    assert.deepEqual(pending.input, { command: "node", args: ["--version"] });

    manager.approvalManager.approve(pending.approvalId, {
      reason: "integration test approval",
    });

    const result = await run.promise;
    assert.equal(result.status, "done");
    assert.equal(result.final, "approved shell command completed");

    const events = await readEvents(logPath);
    const requested = events.find((event) => event.type === "approval.requested");
    const decided = events.find((event) => event.type === "approval.decided");
    assert.equal(requested.data.approvalId, pending.approvalId);
    assert.equal(decided.data.approvalId, pending.approvalId);
    assert.equal(decided.data.action, "allow");
    assert.equal(decided.data.reason, "integration test approval");
    assert.ok(events.some((event) => event.type === "tool.finished"));
    assert.ok(events.some((event) => event.type === "task.done"));
  } finally {
    await fakeProvider.close();
  }
});

test("createRunManager.cancelRun clears a pending approval and finishes the run as cancelled", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-cancel-pending-"));
  const logPath = join(workspace, "events.jsonl");
  const fakeProvider = await startFakeOpenAICompatibleProvider([
    {
      type: "tool_call",
      toolName: "shell",
      input: { command: "node", args: ["--version"] },
    },
  ]);

  try {
    const manager = createRunManager({
      workspace,
      logPath,
      config: normalizeConfig({
        provider: "openai-compatible",
        providers: {
          "openai-compatible": {
            baseUrl: fakeProvider.url,
            model: "fake-model",
          },
        },
      }),
      verifier: { command: "node", args: ["--version"] },
    });

    const run = manager.startRun({
      goal: "cancel me while pending",
      provider: "openai-compatible",
      privacyMode: "local-only",
    });

    const pending = await waitForPendingApproval(manager);
    assert.equal(pending.runId, run.runId);

    const cancelResult = manager.cancelRun(run.runId, { reason: "user cancelled" });
    assert.equal(cancelResult.ok, true);
    assert.equal(cancelResult.summary.runId, run.runId);
    assert.equal(cancelResult.summary.status, "cancelled");

    const result = await run.promise;
    assert.equal(result.status, "cancelled");

    assert.equal(manager.approvalManager.list().length, 0);

    const events = await readEvents(logPath);
    const types = events.map((event) => event.type);
    assert.ok(types.includes("task.cancelled"), "task.cancelled must be logged");
    assert.equal(
      types.filter((type) => type === "task.done").length,
      0,
      "cancelled runs must not also log task.done",
    );
    assert.equal(
      types.filter((type) => type === "tool.started").length,
      0,
      "cancelled pending approval must never start the tool",
    );
    const cancelled = events.find((event) => event.type === "task.cancelled");
    assert.equal(cancelled.data.reason, "user cancelled");
  } finally {
    await fakeProvider.close();
  }
});

test("createRunManager dispatches worker runs and reports the workerId as providerId", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-rm-worker-"));
  const logPath = join(workspace, "events.jsonl");
  const calls = [];
  const fakeWorker = {
    id: "codex-worker",
    async runTask({ task, signal }) {
      calls.push({ taskId: task.id, hasSignal: !!signal });
      return {
        workerId: "codex-worker",
        command: "codex",
        args: ["exec"],
        exitCode: 0,
        stdout: "worker output",
        stderr: "",
        output: "worker output",
      };
    },
  };

  const manager = createRunManager({
    workspace,
    logPath,
    config: normalizeConfig({}),
    verifier: { command: "node", args: ["--version"] },
    workerFactory: () => fakeWorker,
  });

  const run = manager.startRun({
    goal: "delegate to codex",
    provider: "codex-worker",
    privacyMode: "ask-before-api",
  });

  assert.equal(run.providerId, "codex-worker");
  const result = await run.promise;
  assert.equal(result.status, "done");
  assert.equal(result.taskId, run.runId);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].hasSignal, true);

  const events = await readEvents(logPath);
  assert.deepEqual(
    Array.from(new Set(events.map((event) => event.taskId))),
    [run.runId],
  );
  const types = events.map((e) => e.type);
  assert.ok(types.includes("worker.started"));
  assert.ok(types.includes("worker.finished"));
  assert.ok(types.includes("task.done"));
});

test("createRunManager records retry lineage on task.created", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-rm-retry-"));
  const logPath = join(workspace, "events.jsonl");
  const manager = createRunManager({
    workspace,
    logPath,
    config: normalizeConfig({}),
    verifier: { command: "node", args: ["--version"] },
  });

  const run = manager.startRun({
    goal: "retry the original task",
    provider: "scripted",
    privacyMode: "local-only",
    retryOfRunId: "origin-run",
  });

  assert.equal(run.retryOfRunId, "origin-run");
  const result = await run.promise;
  assert.equal(result.status, "done");

  const events = await readEvents(logPath);
  const created = events.find((event) => event.type === "task.created");
  assert.equal(created.data.retryOfRunId, "origin-run");
});

test("createRunManager.cancelRun aborts a running worker subprocess and emits worker.cancelled", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-rm-worker-cancel-"));
  const logPath = join(workspace, "events.jsonl");
  let receivedSignal = null;
  let resolveStarted;
  const startedPromise = new Promise((resolve) => {
    resolveStarted = resolve;
  });

  const fakeWorker = {
    id: "codex-worker",
    runTask({ signal }) {
      receivedSignal = signal;
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          err.partialStdout = "in-flight";
          err.partialStderr = "";
          reject(err);
        });
        // Signal back to the test that the worker has begun and is now waiting
        // on the abort signal — only then is it safe to cancel.
        resolveStarted();
      });
    },
  };

  const manager = createRunManager({
    workspace,
    logPath,
    config: normalizeConfig({}),
    verifier: { command: "node", args: ["--version"] },
    workerFactory: () => fakeWorker,
  });

  const run = manager.startRun({
    goal: "long-running worker task",
    provider: "codex-worker",
    privacyMode: "ask-before-api",
  });

  await startedPromise;

  const cancel = manager.cancelRun(run.runId, { reason: "user cancelled" });
  assert.equal(cancel.ok, true);
  assert.equal(cancel.summary.status, "cancelled");

  await run.promise;

  assert.ok(receivedSignal, "worker should have received a signal");

  const events = await readEvents(logPath);
  assert.deepEqual(
    Array.from(new Set(events.map((event) => event.taskId))),
    [run.runId],
  );
  const types = events.map((e) => e.type);
  assert.ok(types.includes("worker.started"));
  assert.ok(types.includes("worker.cancelled"));
  assert.ok(types.includes("task.cancelled"));
  const workerCancelled = events.find((e) => e.type === "worker.cancelled");
  assert.equal(workerCancelled.data.stage, "during-run");
  assert.equal(workerCancelled.data.partialStdout, "in-flight");
});

test("createRunManager.cancelRun returns not_found for unknown run ids", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-cancel-missing-"));
  const logPath = join(workspace, "events.jsonl");
  const manager = createRunManager({
    workspace,
    logPath,
    config: normalizeConfig({}),
    verifier: { command: "node", args: ["--version"] },
  });

  const result = manager.cancelRun("does-not-exist");
  assert.equal(result.ok, false);
  assert.equal(result.code, "not_found");
});

test("createRunManager.cancelRun does not cancel runs that already finished", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-cancel-finished-"));
  const logPath = join(workspace, "events.jsonl");
  const manager = createRunManager({
    workspace,
    logPath,
    config: normalizeConfig({}),
    verifier: { command: "node", args: ["--version"] },
  });

  const run = manager.startRun({
    goal: "finish quickly",
    provider: "scripted",
    privacyMode: "local-only",
  });
  const result = await run.promise;
  assert.equal(result.status, "done");

  const cancelResult = manager.cancelRun(run.runId);
  assert.equal(cancelResult.ok, false);
  assert.equal(cancelResult.code, "not_found");

  const events = await readEvents(logPath);
  assert.equal(
    events.some((event) => event.type === "task.cancelled"),
    false,
    "finished runs must not gain task.cancelled after completion",
  );
});

async function waitForPendingApproval(manager, { attempts = 50 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [pending] = manager.approvalManager.list();
    if (pending) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for pending approval");
}

async function startFakeOpenAICompatibleProvider(responses) {
  const remaining = [...responses];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }

    await consume(request);
    const modelResponse = remaining.shift();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(modelResponse),
            },
          },
        ],
      }),
    );
  });

  await listen(server);
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => close(server),
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function consume(stream) {
  for await (const _chunk of stream) {
    // Drain the request body so the fake server behaves like a real provider.
  }
}
