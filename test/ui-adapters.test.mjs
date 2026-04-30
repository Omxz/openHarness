import { test } from "node:test";
import assert from "node:assert/strict";

import { buildActivityCards } from "../web/src/lib/activity.js";
import { adaptRun, pendingApprovalIndicator } from "../web/src/lib/adapt.js";
import { summarize } from "../web/src/lib/events.js";

test("operator activity cards summarize worker lifecycle and codex JSON events", () => {
  const cards = buildActivityCards({
    status: "running",
    events: [
      {
        timestamp: "2026-04-29T12:00:00.000Z",
        type: "task.created",
        data: { goal: "inspect repo" },
      },
      {
        timestamp: "2026-04-29T12:00:01.000Z",
        type: "worker.started",
        data: { workerId: "codex-worker" },
      },
      {
        timestamp: "2026-04-29T12:00:02.000Z",
        type: "worker.output",
        data: {
          stream: "stdout",
          chunk:
            '{"type":"thread.started","thread_id":"abc123"}\n' +
            '{"type":"turn.started"}\n' +
            '{"type":"exec_command.started","command":"npm test"}\n',
        },
      },
      {
        timestamp: "2026-04-29T12:00:03.000Z",
        type: "verification.finished",
        data: { result: { exitCode: 0 } },
      },
    ],
  });

  assert.deepEqual(
    cards.map((card) => card.title),
    [
      "Task queued",
      "Worker started",
      "Session started",
      "Planning",
      "Running command",
      "Verification passed",
    ],
  );
  assert.equal(cards[4].detail, "npm test");
  assert.equal(cards[4].tone, "active");
});

test("operator activity cards classify stderr warnings and plain stdout output", () => {
  const cards = buildActivityCards({
    events: [
      {
        timestamp: "2026-04-29T12:00:00.000Z",
        type: "worker.output",
        data: {
          stream: "stderr",
          chunk: "2026-04-29T12:00:00 WARN codex_core_skills::loader: ignored icon\n",
        },
      },
      {
        timestamp: "2026-04-29T12:00:01.000Z",
        type: "worker.output",
        data: { stream: "stdout", chunk: "Reading README.md\n" },
      },
    ],
  });

  assert.equal(cards[0].title, "Worker warning");
  assert.equal(cards[0].tone, "warn");
  assert.equal(cards[0].detail, "ignored icon");
  assert.equal(cards[1].title, "Output");
  assert.equal(cards[1].detail, "Reading README.md");
});

test("operator activity cards classify JSON worker failures as errors", () => {
  const cards = buildActivityCards({
    events: [
      {
        timestamp: "2026-04-29T12:00:00.000Z",
        type: "worker.output",
        data: {
          stream: "stdout",
          chunk:
            '{"type":"error","message":"worker quit"}\n' +
            '{"type":"turn.failed","error":{"message":"usage limit"}}\n',
        },
      },
    ],
  });

  assert.equal(cards[0].title, "Worker error");
  assert.equal(cards[0].detail, "worker quit");
  assert.equal(cards[0].tone, "err");
  assert.equal(cards[1].title, "Turn failed");
  assert.equal(cards[1].detail, "usage limit");
  assert.equal(cards[1].tone, "err");
});

test("operator activity cards keep the most recent activity bounded", () => {
  const events = Array.from({ length: 16 }, (_, index) => ({
    timestamp: new Date(Date.parse("2026-04-29T12:00:00.000Z") + index).toISOString(),
    type: "worker.output",
    data: { stream: "stdout", chunk: `line ${index}\n` },
  }));

  const cards = buildActivityCards({ events });

  assert.equal(cards.length, 10);
  assert.equal(cards[0].detail, "line 6");
  assert.equal(cards.at(-1).detail, "line 15");
});

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

test("UI run adapter exposes worker supervision from run summaries", () => {
  const run = adaptRun({
    runId: "run-limit",
    status: "blocked",
    goal: "delegate",
    eventCount: 2,
    reason: "codex-worker hit a usage limit",
    supervision: {
      state: "blocked",
      category: "usage-limit",
      reason: "codex-worker hit a usage limit",
      suggestedAction: "Wait for the reset window or reroute to another ready provider.",
      exitCode: 1,
    },
    events: [
      {
        type: "worker.finished",
        data: {
          workerId: "codex-worker",
          result: { exitCode: 1, output: "Usage limit reached." },
        },
      },
      {
        type: "task.done",
        data: { status: "blocked" },
      },
    ],
  });

  assert.equal(run.reason, "codex-worker hit a usage limit");
  assert.equal(run.supervision.category, "usage-limit");
  assert.equal(
    run.supervision.suggestedAction,
    "Wait for the reset window or reroute to another ready provider.",
  );
});

test("UI run adapter passes through retry metadata", () => {
  const run = adaptRun({
    runId: "retry-run",
    status: "running",
    goal: "retry",
    eventCount: 1,
    privacyMode: "ask-before-api",
    retryOfRunId: "origin-run",
    retryPlan: {
      available: true,
      providerId: "claude-worker",
      providerLabel: "Claude",
      privacyMode: "ask-before-api",
    },
    events: [],
  });

  assert.equal(run.privacyMode, "ask-before-api");
  assert.equal(run.retryOfRunId, "origin-run");
  assert.equal(run.retryPlan.providerId, "claude-worker");
});

test("UI event summarizer includes worker supervision category", () => {
  assert.equal(
    summarize({
      type: "worker.finished",
      data: {
        workerId: "codex-worker",
        result: { exitCode: 1 },
        supervision: { category: "usage-limit" },
      },
    }),
    "codex-worker · usage-limit · exit 1",
  );
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
