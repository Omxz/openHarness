import { test } from "node:test";
import assert from "node:assert/strict";

import { adaptRun, pendingApprovalIndicator } from "../web/src/lib/adapt.js";
import { summarize } from "../web/src/lib/events.js";

test("UI run adapter passes through partial worker output from the run summary", () => {
  const run = adaptRun({
    runId: "run-stream",
    status: "running",
    goal: "stream",
    eventCount: 2,
    partialStdout: "first second",
    partialStderr: "warn",
    partialStdoutTruncated: false,
    events: [
      {
        type: "worker.output",
        data: { workerId: "codex-worker", stream: "stdout", chunk: "first second" },
      },
      {
        type: "worker.output",
        data: { workerId: "codex-worker", stream: "stderr", chunk: "warn" },
      },
    ],
  });

  assert.equal(run.partialStdout, "first second");
  assert.equal(run.partialStderr, "warn");
  assert.equal(run.partialStdoutTruncated, false);
});

test("UI run adapter falls back to deriving partial output from events when the summary is missing it", () => {
  const run = adaptRun({
    runId: "run-stream-derive",
    status: "running",
    goal: "stream",
    eventCount: 2,
    events: [
      {
        type: "worker.output",
        data: { workerId: "codex-worker", stream: "stdout", chunk: "alpha " },
      },
      {
        type: "worker.output",
        data: { workerId: "codex-worker", stream: "stdout", chunk: "beta" },
      },
    ],
  });

  assert.equal(run.partialStdout, "alpha beta");
  assert.equal(run.partialStderr, "");
});

test("UI event summaries use backend approval decision field names", () => {
  const approval = {
    type: "approval.decided",
    data: {
      toolName: "shell",
      action: "needs-approval",
      risk: "write",
    },
  };

  assert.equal(summarize(approval), "shell -> needs-approval · write");
});

test("UI run adapter derives blocked reason from approval decisions", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "blocked",
    goal: "check node",
    eventCount: 2,
    events: [
      {
        type: "approval.decided",
        data: {
          toolName: "shell",
          action: "needs-approval",
          risk: "write",
        },
      },
      {
        type: "task.done",
        data: { status: "blocked" },
      },
    ],
  });

  assert.equal(run.reason, "awaiting approval for shell (write risk)");
});

test("UI event summarizer renders worker.output stdout chunks", () => {
  assert.equal(
    summarize({
      type: "worker.output",
      data: { stream: "stdout", chunk: "hello world" },
    }),
    "stdout · hello world",
  );
});

test("UI event summarizer renders worker.output stderr chunks", () => {
  assert.equal(
    summarize({
      type: "worker.output",
      data: { stream: "stderr", chunk: "boom" },
    }),
    "stderr · boom",
  );
});

test("UI event summarizer renders approval.requested as a pending request", () => {
  const requested = {
    type: "approval.requested",
    data: {
      toolName: "shell",
      risk: "write",
    },
  };

  assert.equal(summarize(requested), "shell pending · write");
});

test("UI run adapter exposes pendingApproval status from the run summary", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "running",
    goal: "do work",
    eventCount: 2,
    pendingApproval: true,
    pendingApprovalTool: "shell",
    events: [
      {
        type: "approval.requested",
        data: { toolName: "shell", risk: "write" },
      },
    ],
  });

  assert.equal(run.pendingApproval, true);
  assert.equal(run.pendingApprovalTool, "shell");
});

test("UI run adapter falls back to deriving pendingApproval from events when the summary is missing it", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "running",
    goal: "do work",
    eventCount: 1,
    events: [
      {
        type: "approval.requested",
        data: { toolName: "writeFile", risk: "write" },
      },
    ],
  });

  assert.equal(run.pendingApproval, true);
  assert.equal(run.pendingApprovalTool, "writeFile");
});

test("UI run adapter reports pendingApproval=false when an approval.decided clears the request", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "done",
    goal: "do work",
    eventCount: 2,
    events: [
      {
        type: "approval.requested",
        data: { toolName: "shell", risk: "write" },
      },
      {
        type: "approval.decided",
        data: { toolName: "shell", action: "allow" },
      },
    ],
  });

  assert.equal(run.pendingApproval, false);
  assert.equal(run.pendingApprovalTool, null);
});

test("pendingApprovalIndicator returns a label and tool when the run is pending", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "running",
    goal: "do work",
    eventCount: 1,
    pendingApproval: true,
    pendingApprovalTool: "shell",
    events: [
      { type: "approval.requested", data: { toolName: "shell", risk: "write" } },
    ],
  });

  const indicator = pendingApprovalIndicator(run);
  assert.equal(indicator.label, "pending approval");
  assert.equal(indicator.tool, "shell");
  assert.match(indicator.detail, /awaiting decision for shell/);
});

test("pendingApprovalIndicator returns null when nothing is pending", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "done",
    goal: "do work",
    eventCount: 0,
    events: [],
  });

  assert.equal(pendingApprovalIndicator(run), null);
});

test("pendingApprovalIndicator falls back to a generic tool label when toolName is missing", () => {
  const indicator = pendingApprovalIndicator({
    pendingApproval: true,
    pendingApprovalTool: null,
  });

  assert.equal(indicator.tool, "tool");
  assert.match(indicator.detail, /awaiting decision for tool/);
});
