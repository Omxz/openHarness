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
  assert.match(result.stdout, /runs/);
  assert.match(result.stdout, /show <run-id>/);
  assert.match(result.stdout, /serve/);
  assert.match(result.stdout, /--config/);
  assert.match(result.stdout, /scripted, openai-compatible, ollama, codex-worker, claude-worker/);
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
  assert.match(result.stdout, /run: /);
  assert.match(result.stdout, /provider: cli:scripted/);
  assert.match(result.stdout, /final: Scripted provider received: inspect the repo/);
});

test("CLI run with --approve fails fast when stdin is not a TTY", async () => {
  const result = await runNode([
    "bin/harness.mjs",
    "run",
    "inspect the repo",
    "--provider",
    "scripted",
    "--approve",
  ]);

  assert.notEqual(result.exitCode, 0);
  assert.match(result.stderr, /--approve requires a TTY/);
});

test("CLI run accepts --auto-approve and --deny flags without breaking scripted runs", async () => {
  const result = await runNode([
    "bin/harness.mjs",
    "run",
    "inspect the repo",
    "--provider",
    "scripted",
    "--auto-approve",
    "shell,readFile",
    "--deny",
    "destructiveTool",
  ]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /status: done/);
});

test("CLI help advertises the approval flags", async () => {
  const result = await runNode(["bin/harness.mjs", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /--auto-approve/);
  assert.match(result.stdout, /--deny/);
  assert.match(result.stdout, /--approve/);
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

test("CLI runs lists run summaries from an audit log", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-cli-runs-"));
  const logPath = join(dir, "events.jsonl");
  await appendEvent(
    logPath,
    createEvent({
      taskId: "run-1",
      actor: "user",
      type: "task.created",
      data: { goal: "inspect README", providerId: "scripted" },
    }),
  );
  await appendEvent(
    logPath,
    createEvent({
      taskId: "run-1",
      actor: "system",
      type: "task.done",
      data: { status: "done" },
    }),
  );

  const result = await runNode(["bin/harness.mjs", "runs", "--log", logPath]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /run-1/);
  assert.match(result.stdout, /done/);
  assert.match(result.stdout, /inspect README/);
});

test("CLI runs emits JSON for UI consumers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-cli-runs-json-"));
  const logPath = join(dir, "events.jsonl");
  await appendEvent(
    logPath,
    createEvent({
      taskId: "run-1",
      actor: "user",
      type: "task.created",
      data: { goal: "inspect README", providerId: "scripted" },
    }),
  );

  const result = await runNode([
    "bin/harness.mjs",
    "runs",
    "--log",
    logPath,
    "--json",
  ]);

  assert.equal(result.exitCode, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.runs[0].runId, "run-1");
  assert.equal(body.runs[0].goal, "inspect README");
});

test("CLI show emits one run with its full event timeline", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-cli-show-"));
  const logPath = join(dir, "events.jsonl");
  await appendEvent(
    logPath,
    createEvent({
      taskId: "run-1",
      actor: "user",
      type: "task.created",
      data: { goal: "inspect README", workerId: "codex-worker" },
    }),
  );
  await appendEvent(
    logPath,
    createEvent({
      taskId: "run-1",
      actor: "worker",
      type: "worker.finished",
      data: {
        workerId: "codex-worker",
        result: { exitCode: 0, output: "README summary" },
      },
    }),
  );

  const result = await runNode([
    "bin/harness.mjs",
    "show",
    "run-1",
    "--log",
    logPath,
    "--json",
  ]);

  assert.equal(result.exitCode, 0);
  const body = JSON.parse(result.stdout);
  assert.equal(body.run.runId, "run-1");
  assert.equal(body.run.final, "README summary");
  assert.equal(body.run.events.length, 2);
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
