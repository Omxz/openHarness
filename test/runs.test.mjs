import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildRuns,
  formatRunDetail,
  formatRunList,
  getRun,
  listRuns,
} from "../src/runs.mjs";

test("buildRuns groups audit events into newest-first run summaries", () => {
  const runs = buildRuns([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "Inspect README",
      providerId: "scripted",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "model", "model.response", {
      providerId: "scripted",
      response: { type: "final", content: "README summary" },
    }),
    event("run-1", "2026-04-28T10:00:02.000Z", "system", "verification.finished", {
      result: { exitCode: 0 },
    }),
    event("run-1", "2026-04-28T10:00:03.000Z", "system", "task.done", {
      status: "done",
    }),
    event("run-2", "2026-04-28T10:05:00.000Z", "user", "task.created", {
      goal: "Use Codex",
      workerId: "codex-worker",
    }),
    event("run-2", "2026-04-28T10:05:02.000Z", "worker", "worker.finished", {
      workerId: "codex-worker",
      result: { exitCode: 1, output: "Codex was blocked" },
    }),
    event("run-2", "2026-04-28T10:05:03.000Z", "system", "task.done", {
      status: "blocked",
    }),
  ]);

  assert.equal(runs.length, 2);
  assert.equal(runs[0].runId, "run-2");
  assert.equal(runs[0].goal, "Use Codex");
  assert.equal(runs[0].workerId, "codex-worker");
  assert.equal(runs[0].status, "blocked");
  assert.equal(runs[0].final, "Codex was blocked");
  assert.equal(runs[0].durationMs, 3000);

  assert.equal(runs[1].runId, "run-1");
  assert.equal(runs[1].providerId, "scripted");
  assert.equal(runs[1].status, "done");
  assert.equal(runs[1].final, "README summary");
  assert.equal(runs[1].verification.exitCode, 0);
  assert.equal(runs[1].eventCount, 4);
});

test("listRuns and getRun read run summaries from a JSONL audit log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-runs-"));
  const logPath = join(dir, "events.jsonl");
  await writeEvents(logPath, [
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "Inspect README",
      providerId: "scripted",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "system", "task.done", {
      status: "done",
    }),
  ]);

  const runs = await listRuns(logPath);
  const run = await getRun(logPath, "run-1");

  assert.equal(runs[0].runId, "run-1");
  assert.equal(run.runId, "run-1");
  assert.equal(run.events.length, 2);
});

test("buildRuns marks runs with an unmatched approval.requested as pendingApproval", () => {
  const runs = buildRuns([
    event("run-pending", "2026-04-28T11:00:00.000Z", "user", "task.created", {
      goal: "do work",
      providerId: "scripted",
    }),
    event(
      "run-pending",
      "2026-04-28T11:00:01.000Z",
      "system",
      "approval.requested",
      { toolName: "shell", risk: "write" },
    ),
  ]);

  const run = runs[0];
  assert.equal(run.runId, "run-pending");
  assert.equal(run.pendingApproval, true);
  assert.equal(run.pendingApprovalTool, "shell");
});

test("buildRuns clears pendingApproval once a later approval.decided arrives", () => {
  const runs = buildRuns([
    event("run-decided", "2026-04-28T11:00:00.000Z", "user", "task.created", {
      goal: "do work",
      providerId: "scripted",
    }),
    event(
      "run-decided",
      "2026-04-28T11:00:01.000Z",
      "system",
      "approval.requested",
      { toolName: "shell", risk: "write" },
    ),
    event(
      "run-decided",
      "2026-04-28T11:00:02.000Z",
      "system",
      "approval.decided",
      { toolName: "shell", action: "allow" },
    ),
  ]);

  const run = runs[0];
  assert.equal(run.pendingApproval, false);
  assert.equal(run.pendingApprovalTool, null);
});

test("buildRuns surfaces the most recent pending approval when several requests pile up", () => {
  const runs = buildRuns([
    event("run-multi", "2026-04-28T11:00:00.000Z", "user", "task.created", {
      goal: "do work",
      providerId: "scripted",
    }),
    event(
      "run-multi",
      "2026-04-28T11:00:01.000Z",
      "system",
      "approval.requested",
      { toolName: "shell", risk: "write" },
    ),
    event(
      "run-multi",
      "2026-04-28T11:00:02.000Z",
      "system",
      "approval.decided",
      { toolName: "shell", action: "allow" },
    ),
    event(
      "run-multi",
      "2026-04-28T11:00:03.000Z",
      "system",
      "approval.requested",
      { toolName: "writeFile", risk: "write" },
    ),
  ]);

  const run = runs[0];
  assert.equal(run.pendingApproval, true);
  assert.equal(run.pendingApprovalTool, "writeFile");
});

test("formatRunList and formatRunDetail render operator-friendly text", () => {
  const [run] = buildRuns([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "Inspect README",
      providerId: "scripted",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "system", "task.done", {
      status: "done",
    }),
  ]);

  assert.match(formatRunList([run]), /run-1/);
  assert.match(formatRunList([run]), /done/);
  assert.match(formatRunList([run]), /Inspect README/);
  assert.match(formatRunDetail(run), /Run run-1/);
  assert.match(formatRunDetail(run), /task.created/);
});

function event(taskId, timestamp, actor, type, data) {
  return { taskId, timestamp, actor, type, data };
}

async function writeEvents(logPath, events) {
  await writeFile(
    logPath,
    `${events.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
}
