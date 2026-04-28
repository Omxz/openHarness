import { spawn } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { appendEvent, createEvent } from "../src/audit-log.mjs";

test("CLI prints help", async () => {
  const result = await runNode(["bin/harness.mjs", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage: harness/);
  assert.match(result.stdout, /Commands:/);
  assert.match(result.stdout, /doctor/);
  assert.match(result.stdout, /run <goal>/);
  assert.match(result.stdout, /log <path>/);
  assert.match(result.stdout, /--config/);
  assert.match(result.stdout, /scripted, openai-compatible, ollama, codex-worker/);
});

test("CLI doctor prints diagnostic report", async () => {
  const result = await runNode(["bin/harness.mjs", "doctor"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /OpenHarness doctor/);
  assert.match(result.stdout, /node/);
  assert.match(result.stdout, /codex/);
});

test("CLI demo runs the harness loop and writes an event log", async () => {
  const result = await runNode(["bin/harness.mjs", "demo"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /status: done/);
  assert.match(result.stdout, /event log:/);
});

test("CLI run executes a goal with the scripted provider", async () => {
  const result = await runNode([
    "bin/harness.mjs",
    "run",
    "inspect the repo",
    "--provider",
    "scripted",
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /status: done/);
  assert.match(result.stdout, /provider: cli:scripted/);
  assert.match(result.stdout, /final: Scripted provider received: inspect the repo/);
});

test("CLI log pretty-prints an audit log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-cli-log-"));
  const logPath = join(dir, "events.jsonl");
  await appendEvent(
    logPath,
    createEvent({
      taskId: "task-1",
      actor: "system",
      type: "task.done",
      data: { status: "done" },
    }),
  );

  const result = await runNode(["bin/harness.mjs", "log", logPath]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /system task.done status=done/);
});

function runNode(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("node", args, { shell: false });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({ exitCode, stdout, stderr });
    });
  });
}
