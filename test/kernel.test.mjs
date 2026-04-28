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
