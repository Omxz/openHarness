import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { readEvents } from "../src/audit-log.mjs";
import { runTask } from "../src/kernel.mjs";
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
      "tool.started",
      "tool.finished",
      "model.response",
      "verification.finished",
      "task.done",
    ],
  );
  assert.equal(events[3].data.result.content, "Build the kernel first.\n");
});
