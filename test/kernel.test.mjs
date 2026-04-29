import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { readEvents } from "../src/audit-log.mjs";
import { runTask, runWorkerTask } from "../src/kernel.mjs";
import { createScriptedProvider } from "../src/providers.mjs";
import { createDefaultTools } from "../src/tools.mjs";

test("runTask executes a model tool call, logs events, verifies, and returns final output", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-kernel-"));
  const logPath = join(workspace, "events.jsonl");
  await writeFile(join(workspace, "brief.txt"), "Build the kernel first.\n", "utf8");

  const provider = createScriptedProvider({
    id: "test:scripted",
    responses: [
      {
        type: "tool_call",
        toolName: "readFile",
        input: { path: "brief.txt" },
      },
      {
        type: "final",
        content: "Read brief.txt and confirmed: Build the kernel first.",
      },
    ],
  });

  const result = await runTask({
    goal: "summarize the brief",
    workspace,
    logPath,
    privacyMode: "local-only",
    provider,
    tools: createDefaultTools(),
    verifier: {
      command: "node",
      args: ["--version"],
    },
  });

  assert.equal(result.status, "done");
  assert.equal(result.providerId, "test:scripted");
  assert.equal(result.final, "Read brief.txt and confirmed: Build the kernel first.");
  assert.equal(result.verification.exitCode, 0);

  const events = await readEvents(logPath);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "task.created",
      "model.response",
      "approval.decided",
      "tool.started",
      "tool.finished",
      "model.response",
      "verification.finished",
      "task.done",
    ],
  );
  assert.equal(events[4].data.result.content, "Build the kernel first.\n");
});

test("runTask emits approval.requested before invoking the approval callback for needs-approval tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-approval-requested-"));
  const logPath = join(workspace, "events.jsonl");
  const provider = createScriptedProvider({
    id: "test:approval-requested",
    responses: [
      {
        type: "tool_call",
        toolName: "shell",
        input: { command: "node", args: ["--version"] },
      },
      {
        type: "final",
        content: "Shell command ran.",
      },
    ],
  });

  let observedTypesWhenCallbackFires = null;
  const result = await runTask({
    goal: "check node",
    workspace,
    logPath,
    provider,
    tools: createDefaultTools(),
    approveToolUse: async ({ decision }) => {
      observedTypesWhenCallbackFires = (await readEvents(logPath)).map(
        (event) => event.type,
      );
      return { ...decision, action: "allow", reason: "test approval" };
    },
    verifier: {
      command: "node",
      args: ["--version"],
    },
  });

  assert.equal(result.status, "done");
  assert.ok(
    observedTypesWhenCallbackFires?.includes("approval.requested"),
    "approval.requested must be logged before the approval callback fires",
  );
  assert.ok(
    !observedTypesWhenCallbackFires?.includes("approval.decided"),
    "approval.decided must not be logged before the approval callback fires",
  );

  const events = await readEvents(logPath);
  const requested = events.find((event) => event.type === "approval.requested");
  const decided = events.find((event) => event.type === "approval.decided");
  assert.ok(requested, "approval.requested should be present");
  assert.equal(requested.data.toolName, "shell");
  assert.equal(requested.data.risk, "write");
  assert.deepEqual(requested.data.input, {
    command: "node",
    args: ["--version"],
  });
  assert.ok(
    events.indexOf(requested) < events.indexOf(decided),
    "approval.requested must come before approval.decided",
  );
});

test("runTask attaches a stable approvalId to approval.requested, approval.decided, and the approval callback context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-approval-id-"));
  const logPath = join(workspace, "events.jsonl");
  const provider = createScriptedProvider({
    id: "test:approval-id",
    responses: [
      {
        type: "tool_call",
        toolName: "shell",
        input: { command: "node", args: ["--version"] },
      },
      { type: "final", content: "ok" },
    ],
  });

  let callbackContext = null;
  await runTask({
    goal: "check node",
    workspace,
    logPath,
    provider,
    tools: createDefaultTools(),
    approveToolUse: async (context) => {
      callbackContext = context;
      return { ...context.decision, action: "allow", reason: "test approval" };
    },
    verifier: { command: "node", args: ["--version"] },
  });

  const events = await readEvents(logPath);
  const requested = events.find((event) => event.type === "approval.requested");
  const decided = events.find((event) => event.type === "approval.decided");

  assert.ok(requested.data.approvalId, "approval.requested must include approvalId");
  assert.match(requested.data.approvalId, /^[0-9a-f-]{36}$/);
  assert.equal(decided.data.approvalId, requested.data.approvalId);
  assert.equal(callbackContext.approvalId, requested.data.approvalId);
});

test("runTask issues distinct approval ids for separate approval requests", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-approval-multi-"));
  const logPath = join(workspace, "events.jsonl");
  const provider = createScriptedProvider({
    id: "test:approval-multi",
    responses: [
      {
        type: "tool_call",
        toolName: "shell",
        input: { command: "node", args: ["--version"] },
      },
      {
        type: "tool_call",
        toolName: "writeFile",
        input: { path: "out.txt", content: "hi", createDirs: true },
      },
      { type: "final", content: "ok" },
    ],
  });

  await runTask({
    goal: "two approvals",
    workspace,
    logPath,
    provider,
    tools: createDefaultTools(),
    approveToolUse: async ({ decision }) => ({
      ...decision,
      action: "allow",
      reason: "test approval",
    }),
    verifier: { command: "node", args: ["--version"] },
  });

  const events = await readEvents(logPath);
  const requested = events.filter((event) => event.type === "approval.requested");
  assert.equal(requested.length, 2);
  assert.notEqual(requested[0].data.approvalId, requested[1].data.approvalId);
});

test("runTask does not emit approval.requested for tools allowed without approval", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-approval-skip-"));
  const logPath = join(workspace, "events.jsonl");
  await writeFile(join(workspace, "brief.txt"), "ok\n", "utf8");
  const provider = createScriptedProvider({
    id: "test:read-no-request",
    responses: [
      { type: "tool_call", toolName: "readFile", input: { path: "brief.txt" } },
      { type: "final", content: "done" },
    ],
  });

  await runTask({
    goal: "read",
    workspace,
    logPath,
    privacyMode: "local-only",
    provider,
    tools: createDefaultTools(),
    verifier: { command: "node", args: ["--version"] },
  });

  const events = await readEvents(logPath);
  assert.equal(
    events.find((event) => event.type === "approval.requested"),
    undefined,
    "no approval.requested should be emitted for a read-only tool",
  );
});

test("runTask redacts writeFile content from audit events while preserving approval context", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-writefile-kernel-"));
  const logPath = join(workspace, "events.jsonl");
  const provider = createScriptedProvider({
    id: "test:writefile",
    responses: [
      {
        type: "tool_call",
        toolName: "writeFile",
        input: {
          path: "notes/result.md",
          content: "private draft body\n",
          createDirs: true,
        },
      },
      {
        type: "final",
        content: "File written.",
      },
    ],
  });

  const result = await runTask({
    goal: "write a note",
    workspace,
    logPath,
    provider,
    tools: createDefaultTools(),
    approveToolUse: async ({ decision }) => ({
      ...decision,
      action: "allow",
      reason: "test approval",
    }),
    verifier: {
      command: "node",
      args: ["--version"],
    },
  });

  assert.equal(result.status, "done");
  assert.equal(
    await readFile(join(workspace, "notes", "result.md"), "utf8"),
    "private draft body\n",
  );

  const events = await readEvents(logPath);
  const serializedEvents = JSON.stringify(events);
  assert.equal(
    serializedEvents.includes("private draft body"),
    false,
    "writeFile content must not be stored in audit events",
  );

  const modelResponse = events.find((event) => event.type === "model.response");
  const requested = events.find((event) => event.type === "approval.requested");
  const started = events.find((event) => event.type === "tool.started");
  const finished = events.find((event) => event.type === "tool.finished");
  assert.equal(modelResponse.data.response.input.content, undefined);
  assert.equal(requested.data.input.content, undefined);
  assert.equal(started.data.input.content, undefined);
  assert.equal(requested.data.input.path, "notes/result.md");
  assert.equal(requested.data.input.bytesWritten, 19);
  assert.equal(requested.data.input.createDirs, true);
  assert.equal(finished.data.result.path, "notes/result.md");
  assert.equal(finished.data.result.bytesWritten, 19);
  assert.ok(finished.data.result.sha256);
});

test("runTask logs approval decisions before running risky tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-approval-kernel-"));
  const logPath = join(workspace, "events.jsonl");
  const provider = createScriptedProvider({
    id: "test:approval",
    responses: [
      {
        type: "tool_call",
        toolName: "shell",
        input: { command: "node", args: ["--version"] },
      },
      {
        type: "final",
        content: "Shell command ran.",
      },
    ],
  });

  const result = await runTask({
    goal: "check node",
    workspace,
    logPath,
    provider,
    tools: createDefaultTools(),
    approveToolUse: async ({ decision }) => ({
      ...decision,
      action: "allow",
      reason: "test approval",
    }),
    verifier: {
      command: "node",
      args: ["--version"],
    },
  });

  assert.equal(result.status, "done");

  const events = await readEvents(logPath);
  const approval = events.find((event) => event.type === "approval.decided");
  assert.equal(approval.data.toolName, "shell");
  assert.equal(approval.data.action, "allow");
  assert.equal(approval.data.reason, "test approval");
});

test("runTask blocks denied risky tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-denied-kernel-"));
  const logPath = join(workspace, "events.jsonl");
  const provider = createScriptedProvider({
    id: "test:deny",
    responses: [
      {
        type: "tool_call",
        toolName: "shell",
        input: { command: "node", args: ["--version"] },
      },
    ],
  });

  await assert.rejects(
    () =>
      runTask({
        goal: "check node",
        workspace,
        logPath,
        provider,
        tools: createDefaultTools(),
        approveToolUse: async ({ decision }) => ({
          ...decision,
          action: "deny",
          reason: "user denied",
        }),
      }),
    /Tool "shell" with write risk is denied/,
  );

  const events = await readEvents(logPath);
  const approval = events.find((event) => event.type === "approval.decided");
  assert.equal(approval.data.action, "deny");
  assert.equal(approval.data.reason, "user denied");
});

test("runWorkerTask logs worker.cancelled and returns cancelled when signal aborts mid-run", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-worker-cancel-"));
  const logPath = join(workspace, "events.jsonl");
  const controller = new AbortController();
  const worker = {
    id: "test:worker",
    async runTask({ task, signal }) {
      // Simulate a long-running subprocess that aborts when signal fires.
      return new Promise((_, reject) => {
        signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          err.partialStdout = "partial output";
          err.partialStderr = "";
          reject(err);
        });
        // Trigger the abort on the next tick so the test stays fast.
        setImmediate(() => controller.abort("user cancelled"));
      });
    },
  };

  const result = await runWorkerTask({
    goal: "inspect",
    workspace,
    logPath,
    privacyMode: "ask-before-api",
    worker,
    verifier: { command: "node", args: ["--version"] },
    signal: controller.signal,
  });

  assert.equal(result.status, "cancelled");
  assert.equal(result.final, null);
  assert.equal(result.verification, null);

  const events = await readEvents(logPath);
  assert.deepEqual(
    events.map((event) => event.type),
    ["task.created", "worker.started", "worker.cancelled"],
  );
  const cancelled = events.at(-1);
  assert.equal(cancelled.data.workerId, "test:worker");
  assert.equal(cancelled.data.stage, "during-run");
  assert.equal(cancelled.data.partialStdout, "partial output");
});

test("runWorkerTask exits before spawning when signal is already aborted", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-worker-pre-abort-"));
  const logPath = join(workspace, "events.jsonl");
  const controller = new AbortController();
  controller.abort("aborted before start");
  let spawned = false;
  const worker = {
    id: "test:worker",
    async runTask() {
      spawned = true;
      return { exitCode: 0, stdout: "", stderr: "", output: "" };
    },
  };

  const result = await runWorkerTask({
    goal: "inspect",
    workspace,
    logPath,
    privacyMode: "ask-before-api",
    worker,
    verifier: { command: "node", args: ["--version"] },
    signal: controller.signal,
  });

  assert.equal(spawned, false, "worker should not spawn when signal is already aborted");
  assert.equal(result.status, "cancelled");

  const events = await readEvents(logPath);
  assert.deepEqual(
    events.map((event) => event.type),
    ["task.created", "worker.cancelled"],
  );
  assert.equal(events.at(-1).data.stage, "before-spawn");
});

test("runWorkerTask delegates to a worker, logs events, verifies, and returns final output", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-worker-"));
  const logPath = join(workspace, "events.jsonl");
  const worker = {
    id: "test:worker",
    async runTask({ task }) {
      return {
        workerId: "test:worker",
        command: "worker",
        args: ["run"],
        exitCode: 0,
        stdout: `handled ${task.goal}`,
        stderr: "",
        output: `handled ${task.goal}`,
      };
    },
  };

  const result = await runWorkerTask({
    goal: "inspect README",
    workspace,
    logPath,
    privacyMode: "ask-before-api",
    worker,
    verifier: {
      command: "node",
      args: ["--version"],
    },
  });

  assert.equal(result.status, "done");
  assert.equal(result.workerId, "test:worker");
  assert.equal(result.final, "handled inspect README");
  assert.equal(result.verification.exitCode, 0);

  const events = await readEvents(logPath);
  assert.deepEqual(
    events.map((event) => event.type),
    [
      "task.created",
      "worker.started",
      "worker.finished",
      "verification.finished",
      "task.done",
    ],
  );
  assert.equal(events[2].data.result.output, "handled inspect README");
});
