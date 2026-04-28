import { spawn } from "node:child_process";
import { test } from "node:test";
import assert from "node:assert/strict";

test("CLI prints help", async () => {
  const result = await runNode(["bin/harness.mjs", "--help"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /Usage: harness/);
  assert.match(result.stdout, /Commands:/);
});

test("CLI demo runs the harness loop and writes an event log", async () => {
  const result = await runNode(["bin/harness.mjs", "demo"]);

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /status: done/);
  assert.match(result.stdout, /event log:/);
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
