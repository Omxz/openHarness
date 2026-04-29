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

test("Codex worker forwards onChunk callbacks via runProcess onStdout/onStderr", async () => {
  const provider = createCodexWorkerProvider({
    runProcess: async (command, args, options) => {
      options.onStdout?.("partial-1 ");
      options.onStdout?.("partial-2");
      options.onStderr?.("warn");
      return { exitCode: 0, stdout: "partial-1 partial-2", stderr: "warn" };
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
    { stream: "stdout", chunk: "partial-1 " },
    { stream: "stdout", chunk: "partial-2" },
    { stream: "stderr", chunk: "warn" },
  ]);
});

test("Codex worker forwards an AbortSignal into runProcess", async () => {
  let receivedSignal = null;
  const provider = createCodexWorkerProvider({
    runProcess: async (command, args, options) => {
      receivedSignal = options.signal;
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
  });

  const controller = new AbortController();
  await provider.runTask({
    task: {
      id: "task-signal",
      goal: "inspect",
      workspace: "/tmp",
      privacyMode: "ask-before-api",
    },
    signal: controller.signal,
  });

  assert.ok(receivedSignal, "runProcess should receive a signal");
  assert.equal(receivedSignal.aborted, false);
});

test("Codex worker rejects when signal aborts mid-run", async () => {
  const provider = createCodexWorkerProvider({
    // Simulate a long-running subprocess: only resolves once the signal aborts.
    runProcess: (command, args, options) =>
      new Promise((_, reject) => {
        if (options.signal?.aborted) {
          const err = new Error("aborted-before-call");
          err.name = "AbortError";
          return reject(err);
        }
        options.signal?.addEventListener("abort", () => {
          const err = new Error("aborted");
          err.name = "AbortError";
          err.partialStdout = "in-flight output";
          err.partialStderr = "";
          reject(err);
        });
      }),
  });

  const controller = new AbortController();
  const promise = provider.runTask({
    task: {
      id: "task-cancel",
      goal: "inspect",
      workspace: "/tmp",
      privacyMode: "ask-before-api",
    },
    signal: controller.signal,
  });

  controller.abort("user cancelled");
  await assert.rejects(promise, (err) => {
    assert.equal(err.name, "AbortError");
    assert.equal(err.partialStdout, "in-flight output");
    return true;
  });
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
