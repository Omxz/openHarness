import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createCodexWorkerProvider,
  detectCodexWorker,
} from "../src/workers.mjs";

test("Codex worker runs codex exec with scoped workspace and prompt", async () => {
  const calls = [];
  const provider = createCodexWorkerProvider({
    command: "codex",
    args: ["exec", "--json", "--color", "never"],
    model: "gpt-5.4",
    profile: "work",
    runProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        exitCode: 0,
        stdout: "Codex inspected README.",
        stderr: "",
      };
    },
  });

  const result = await provider.runTask({
    task: {
      id: "task-1",
      goal: "inspect README",
      workspace: "/tmp/workspace",
      privacyMode: "ask-before-api",
    },
  });

  assert.equal(result.exitCode, 0);
  assert.equal(result.output, "Codex inspected README.");
  assert.equal(calls[0].command, "codex");
  assert.deepEqual(calls[0].args.slice(0, 9), [
    "exec",
    "--json",
    "--color",
    "never",
    "-m",
    "gpt-5.4",
    "-p",
    "work",
    "--cd",
  ]);
  assert.equal(calls[0].args[9], "/tmp/workspace");
  assert.equal(calls[0].args.at(-1), "-");
  assert.equal(calls[0].options.cwd, "/tmp/workspace");
  assert.match(calls[0].options.input, /OpenHarness delegated task/);
  assert.match(calls[0].options.input, /inspect README/);
});

test("Codex worker captures nonzero exits without throwing", async () => {
  const provider = createCodexWorkerProvider({
    runProcess: async () => ({
      exitCode: 1,
      stdout: "",
      stderr: "not authenticated",
    }),
  });

  const result = await provider.runTask({
    task: {
      id: "task-2",
      goal: "inspect README",
      workspace: "/tmp/workspace",
      privacyMode: "ask-before-api",
    },
  });

  assert.equal(result.exitCode, 1);
  assert.equal(result.output, "not authenticated");
  assert.equal(result.stderr, "not authenticated");
});

test("detectCodexWorker reports availability from command version check", async () => {
  const available = await detectCodexWorker({
    command: "codex",
    runProcess: async (command, args) => ({
      exitCode: 0,
      stdout: "codex-cli 1.0.0",
      stderr: "",
      command,
      args,
    }),
  });
  const unavailable = await detectCodexWorker({
    command: "missing-codex",
    runProcess: async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "command not found",
    }),
  });

  assert.deepEqual(available, {
    available: true,
    command: "codex",
    detail: "codex-cli 1.0.0",
  });
  assert.deepEqual(unavailable, {
    available: false,
    command: "missing-codex",
    detail: "command not found",
  });
});
