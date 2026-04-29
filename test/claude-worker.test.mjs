import { test } from "node:test";
import assert from "node:assert/strict";

import {
  createClaudeWorkerProvider,
  detectClaudeAuth,
  detectClaudeWorker,
} from "../src/workers.mjs";

test("Claude worker runs claude print mode with scoped workspace and prompt", async () => {
  const calls = [];
  const provider = createClaudeWorkerProvider({
    command: "claude",
    args: ["-p", "--output-format", "text"],
    model: "sonnet",
    permissionMode: "dontAsk",
    runProcess: async (command, args, options) => {
      calls.push({ command, args, options });
      return {
        exitCode: 0,
        stdout: "Claude inspected README.",
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
  assert.equal(result.output, "Claude inspected README.");
  assert.equal(calls[0].command, "claude");
  assert.equal(calls[0].options.cwd, "/tmp/workspace");
  assert.deepEqual(calls[0].args.slice(0, 7), [
    "-p",
    "--output-format",
    "text",
    "--model",
    "sonnet",
    "--permission-mode",
    "dontAsk",
  ]);
  assert.match(calls[0].args.at(-1), /OpenHarness delegated task/);
  assert.match(calls[0].args.at(-1), /inspect README/);
  assert.equal(calls[0].options.input, undefined);
});

test("Claude worker forwards onChunk callbacks via runProcess onStdout/onStderr", async () => {
  const provider = createClaudeWorkerProvider({
    runProcess: async (command, args, options) => {
      options.onStdout?.("hello ");
      options.onStdout?.("there");
      options.onStderr?.("warn-1");
      return { exitCode: 0, stdout: "hello there", stderr: "warn-1" };
    },
  });

  const observed = [];
  await provider.runTask({
    task: {
      id: "task-stream",
      goal: "stream",
      workspace: "/tmp",
      privacyMode: "ask-before-api",
    },
    onChunk: (entry) => observed.push(entry),
  });

  assert.deepEqual(observed, [
    { stream: "stdout", chunk: "hello " },
    { stream: "stdout", chunk: "there" },
    { stream: "stderr", chunk: "warn-1" },
  ]);
});

test("Claude worker captures nonzero exits without throwing", async () => {
  const provider = createClaudeWorkerProvider({
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

test("detectClaudeWorker reports availability from command version check", async () => {
  const available = await detectClaudeWorker({
    command: "claude",
    runProcess: async (command, args) => ({
      exitCode: 0,
      stdout: "1.2.3",
      stderr: "",
      command,
      args,
    }),
  });
  const unavailable = await detectClaudeWorker({
    command: "missing-claude",
    runProcess: async () => ({
      exitCode: 127,
      stdout: "",
      stderr: "command not found",
    }),
  });

  assert.deepEqual(available, {
    available: true,
    command: "claude",
    detail: "1.2.3",
  });
  assert.deepEqual(unavailable, {
    available: false,
    command: "missing-claude",
    detail: "command not found",
  });
});

test("detectClaudeAuth reports signed-in subscription readiness", async () => {
  const signedIn = await detectClaudeAuth({
    command: "claude",
    runProcess: async () => ({
      exitCode: 0,
      stdout: JSON.stringify({
        loggedIn: true,
        authMethod: "subscription",
        apiProvider: "firstParty",
      }),
      stderr: "",
    }),
  });
  const signedOut = await detectClaudeAuth({
    command: "claude",
    runProcess: async () => ({
      exitCode: 1,
      stdout: JSON.stringify({
        loggedIn: false,
        authMethod: "none",
        apiProvider: "firstParty",
      }),
      stderr: "",
    }),
  });

  assert.deepEqual(signedIn, {
    available: true,
    command: "claude",
    detail: "logged in via subscription",
  });
  assert.deepEqual(signedOut, {
    available: false,
    command: "claude",
    detail: "not logged in",
  });
});
