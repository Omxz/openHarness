import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { appendEvent, createEvent } from "../src/audit-log.mjs";
import { formatEvents, formatLogFile } from "../src/log-viewer.mjs";

test("formatEvents renders a compact audit timeline", () => {
  const lines = formatEvents([
    {
      timestamp: "2026-04-28T10:00:00.000Z",
      actor: "user",
      type: "task.created",
      data: { goal: "inspect README", providerId: "ollama" },
    },
    {
      timestamp: "2026-04-28T10:00:01.000Z",
      actor: "system",
      type: "tool.started",
      data: { toolName: "readFile" },
    },
    {
      timestamp: "2026-04-28T10:00:02.000Z",
      actor: "system",
      type: "approval.decided",
      data: { toolName: "shell", action: "allow" },
    },
    {
      timestamp: "2026-04-28T10:00:03.000Z",
      actor: "system",
      type: "verification.finished",
      data: { result: { exitCode: 0 } },
    },
    {
      timestamp: "2026-04-28T10:00:04.000Z",
      actor: "system",
      type: "task.done",
      data: { status: "done" },
    },
  ]);

  assert.deepEqual(lines, [
    "2026-04-28T10:00:00.000Z user task.created goal=\"inspect README\" provider=ollama",
    "2026-04-28T10:00:01.000Z system tool.started tool=readFile",
    "2026-04-28T10:00:02.000Z system approval.decided tool=shell action=allow",
    "2026-04-28T10:00:03.000Z system verification.finished exit=0",
    "2026-04-28T10:00:04.000Z system task.done status=done",
  ]);
});

test("formatEvents summarizes approval.requested with the tool and risk", () => {
  const lines = formatEvents([
    {
      timestamp: "2026-04-28T10:00:00.000Z",
      actor: "system",
      type: "approval.requested",
      data: { toolName: "shell", risk: "write" },
    },
  ]);

  assert.deepEqual(lines, [
    "2026-04-28T10:00:00.000Z system approval.requested tool=shell risk=write",
  ]);
});

test("formatLogFile reads JSONL events and returns display text", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-log-viewer-"));
  const logPath = join(dir, "events.jsonl");

  await appendEvent(
    logPath,
    createEvent({
      taskId: "task-1",
      actor: "worker",
      type: "worker.finished",
      data: { workerId: "codex-worker", result: { exitCode: 0 } },
    }),
  );

  const output = await formatLogFile(logPath);

  assert.match(output, /worker worker.finished worker=codex-worker exit=0/);
});
