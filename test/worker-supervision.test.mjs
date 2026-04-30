import { test } from "node:test";
import assert from "node:assert/strict";

import { classifyWorkerResult } from "../src/worker-supervision.mjs";

test("classifyWorkerResult returns null for successful worker results", () => {
  const supervision = classifyWorkerResult({
    workerId: "codex-worker",
    result: { exitCode: 0, stdout: "ok", stderr: "", output: "ok" },
  });

  assert.equal(supervision, null);
});

test("classifyWorkerResult identifies usage limit failures", () => {
  const supervision = classifyWorkerResult({
    workerId: "codex-worker",
    result: {
      exitCode: 1,
      stdout: '{"type":"turn.failed","error":{"message":"Usage limit reached. Try again later."}}\n',
      stderr: "",
      output: "Usage limit reached. Try again later.",
    },
  });

  assert.equal(supervision.state, "blocked");
  assert.equal(supervision.category, "usage-limit");
  assert.equal(supervision.reason, "codex-worker hit a usage limit");
  assert.equal(
    supervision.suggestedAction,
    "Wait for the reset window or reroute to another ready provider.",
  );
  assert.equal(supervision.exitCode, 1);
});

test("classifyWorkerResult identifies auth failures", () => {
  const supervision = classifyWorkerResult({
    workerId: "claude-worker",
    result: {
      exitCode: 1,
      stdout: "",
      stderr: "Not logged in. Run claude auth login.",
      output: "Not logged in. Run claude auth login.",
    },
  });

  assert.equal(supervision.category, "auth-required");
  assert.equal(supervision.reason, "claude-worker needs authentication");
  assert.equal(
    supervision.suggestedAction,
    "Sign in to the worker CLI or choose another ready provider.",
  );
});

test("classifyWorkerResult falls back to a generic nonzero exit", () => {
  const supervision = classifyWorkerResult({
    workerId: "local-worker",
    result: { exitCode: 2, stdout: "", stderr: "boom", output: "boom" },
  });

  assert.equal(supervision.category, "worker-exit");
  assert.equal(supervision.reason, "local-worker exited with code 2");
  assert.equal(
    supervision.suggestedAction,
    "Inspect the worker output, then rerun or choose another provider.",
  );
});
