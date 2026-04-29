import { test } from "node:test";
import assert from "node:assert/strict";

import { runProcess } from "../src/workers.mjs";

test("runProcess invokes onStdout for each stdout chunk", async () => {
  const chunks = [];
  const result = await runProcess(
    process.execPath,
    [
      "-e",
      "process.stdout.write('hello '); setTimeout(() => process.stdout.write('world'), 10);",
    ],
    {
      cwd: process.cwd(),
      onStdout: (chunk) => {
        chunks.push(chunk);
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "hello world");
  assert.ok(chunks.length >= 1, "onStdout should have been invoked");
  assert.equal(chunks.join(""), "hello world");
  for (const chunk of chunks) {
    assert.equal(typeof chunk, "string", "chunks should be strings");
  }
});

test("runProcess invokes onStderr for each stderr chunk", async () => {
  const chunks = [];
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stderr.write('boom')"],
    {
      cwd: process.cwd(),
      onStderr: (chunk) => {
        chunks.push(chunk);
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stderr, "boom");
  assert.equal(chunks.join(""), "boom");
});

test("runProcess survives an onStdout callback that throws", async () => {
  let calls = 0;
  const result = await runProcess(
    process.execPath,
    ["-e", "process.stdout.write('ok')"],
    {
      cwd: process.cwd(),
      onStdout: () => {
        calls += 1;
        throw new Error("boom");
      },
    },
  );

  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, "ok");
  assert.ok(calls >= 1);
});
