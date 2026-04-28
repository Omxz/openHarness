import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { appendEvent, createEvent, readEvents } from "../src/audit-log.mjs";

test("appendEvent writes JSONL events that readEvents returns in order", async () => {
  const dir = await mkdtemp(join(tmpdir(), "harness-audit-"));
  const logPath = join(dir, "events.jsonl");

  const first = createEvent({
    taskId: "task-1",
    actor: "user",
    type: "task.created",
    data: { goal: "inspect workspace" },
  });
  const second = createEvent({
    taskId: "task-1",
    actor: "system",
    type: "task.done",
    data: { ok: true },
  });

  await appendEvent(logPath, first);
  await appendEvent(logPath, second);

  assert.deepEqual(await readEvents(logPath), [first, second]);

  const raw = await readFile(logPath, "utf8");
  assert.equal(raw.split("\n").filter(Boolean).length, 2);
});

test("createEvent adds an ISO timestamp and preserves event fields", () => {
  const event = createEvent({
    taskId: "task-2",
    actor: "tool",
    type: "tool.result",
    data: { bytes: 12 },
  });

  assert.equal(event.taskId, "task-2");
  assert.equal(event.actor, "tool");
  assert.equal(event.type, "tool.result");
  assert.deepEqual(event.data, { bytes: 12 });
  assert.doesNotThrow(() => new Date(event.timestamp).toISOString());
});
