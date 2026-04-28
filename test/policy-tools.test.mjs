import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPolicy } from "../src/policy.mjs";
import { listFilesTool, readFileTool, shellTool } from "../src/tools.mjs";

test("read tools are allowed and can inspect files inside the workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-tools-"));
  await mkdir(join(workspace, "docs"));
  await writeFile(join(workspace, "docs", "note.md"), "hello harness\n", "utf8");

  const policy = createPolicy({ workspace });

  const readResult = await readFileTool.run(
    { path: "docs/note.md" },
    { workspace, policy },
  );
  const listResult = await listFilesTool.run(
    { path: "docs" },
    { workspace, policy },
  );

  assert.equal(readResult.content, "hello harness\n");
  assert.deepEqual(listResult.entries, ["note.md"]);
});

test("shell tool is blocked unless the approval policy allows it", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-shell-"));
  const deniedPolicy = createPolicy({ workspace });
  const allowedPolicy = createPolicy({
    workspace,
    approvals: { shell: true },
  });

  await assert.rejects(
    () =>
      shellTool.run(
        { command: "node", args: ["--version"] },
        { workspace, policy: deniedPolicy },
      ),
    /requires approval/,
  );

  const result = await shellTool.run(
    { command: "node", args: ["--version"] },
    { workspace, policy: allowedPolicy },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+\./);
});

test("policy creates explicit decisions for tool use", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-policy-"));
  const policy = createPolicy({ workspace });

  assert.deepEqual(policy.decideToolUse(readFileTool, { path: "README.md" }), {
    action: "allow",
    reason: "read tools are allowed",
    toolName: "readFile",
    risk: "read",
  });
  assert.deepEqual(policy.decideToolUse(shellTool, { command: "node" }), {
    action: "needs-approval",
    reason: "write risk requires approval",
    toolName: "shell",
    risk: "write",
  });
});

test("policy records approval decisions before risky tools run", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-approval-"));
  const policy = createPolicy({ workspace });

  policy.recordApproval({
    toolName: "shell",
    action: "allow",
    reason: "test approval",
  });
  const result = await shellTool.run(
    { command: "node", args: ["--version"] },
    { workspace, policy },
  );

  assert.equal(result.exitCode, 0);
  assert.match(result.stdout, /^v\d+\./);
});

test("destructive tools are denied by default", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-destructive-"));
  const policy = createPolicy({ workspace });

  assert.deepEqual(
    policy.decideToolUse({ name: "deleteEverything", risk: "destructive" }, {}),
    {
      action: "deny",
      reason: "destructive tools are denied by default",
      toolName: "deleteEverything",
      risk: "destructive",
    },
  );
});

test("filesystem tools reject paths outside the workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-scope-"));
  const policy = createPolicy({ workspace });

  await assert.rejects(
    () => readFileTool.run({ path: "../outside.txt" }, { workspace, policy }),
    /outside the workspace/,
  );
});
