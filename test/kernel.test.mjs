import { mkdtemp, writeFile } from "node:fs/promises";
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
