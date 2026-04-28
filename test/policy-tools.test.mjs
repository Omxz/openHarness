import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { createPolicy } from "../src/policy.mjs";
import {
  listFilesTool,
  readFileTool,
  shellTool,
  writeFileTool,
} from "../src/tools.mjs";

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

test("writeFile tool is blocked unless the approval policy allows it", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-write-blocked-"));
  const deniedPolicy = createPolicy({ workspace });
  const allowedPolicy = createPolicy({
    workspace,
    approvals: { writeFile: true },
  });

  await assert.rejects(
    () =>
      writeFileTool.run(
        { path: "notes/todo.md", content: "ship it\n", createDirs: true },
        { workspace, policy: deniedPolicy },
      ),
    /requires approval/,
  );

  const result = await writeFileTool.run(
    { path: "notes/todo.md", content: "ship it\n", createDirs: true },
    { workspace, policy: allowedPolicy },
  );

  assert.equal(await readFile(join(workspace, "notes", "todo.md"), "utf8"), "ship it\n");
  assert.deepEqual(result, {
    path: "notes/todo.md",
    bytesWritten: 8,
    created: true,
    overwritten: false,
    sha256: "54c150f30b97bdac97ff2251dec182544130c6661454bc08f271a642c942a17c",
  });
});

test("writeFile refuses overwrites by default and overwrites only when requested", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-write-overwrite-"));
  await writeFile(join(workspace, "note.md"), "old\n", "utf8");
  const policy = createPolicy({
    workspace,
    approvals: { writeFile: true },
  });

  await assert.rejects(
    () => writeFileTool.run({ path: "note.md", content: "new\n" }, { workspace, policy }),
    /exists and overwrite=false/,
  );

  const result = await writeFileTool.run(
    { path: "note.md", content: "new\n", overwrite: true },
    { workspace, policy },
  );

  assert.equal(await readFile(join(workspace, "note.md"), "utf8"), "new\n");
  assert.equal(result.created, false);
  assert.equal(result.overwritten, true);
  assert.equal(result.previousBytes, 4);
});

test("writeFile rejects unsafe targets", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-write-unsafe-"));
  const outside = await mkdtemp(join(tmpdir(), "harness-write-outside-"));
  await writeFile(join(outside, "target.txt"), "outside\n", "utf8");
  await mkdir(join(workspace, "dir"));
  await symlink(outside, join(workspace, "escape"));
  await symlink(join(outside, "target.txt"), join(workspace, "linked-file"));
  const policy = createPolicy({
    workspace,
    approvals: { writeFile: true },
  });

  await assert.rejects(
    () => writeFileTool.run({ path: "/tmp/nope.txt", content: "x" }, { workspace, policy }),
    /absolute paths are not allowed/,
  );
  await assert.rejects(
    () => writeFileTool.run({ path: "../outside.txt", content: "x" }, { workspace, policy }),
    /outside the workspace/,
  );
  await assert.rejects(
    () => writeFileTool.run({ path: "escape/file.txt", content: "x" }, { workspace, policy }),
    /outside the workspace/,
  );
  await assert.rejects(
    () => writeFileTool.run({ path: "dir", content: "x", overwrite: true }, { workspace, policy }),
    /not a regular file/,
  );
  await assert.rejects(
    () =>
      writeFileTool.run(
        { path: "linked-file", content: "x", overwrite: true },
        { workspace, policy },
      ),
    /not a regular file/,
  );
  await assert.rejects(
    () => writeFileTool.run({ path: ".", content: "x" }, { workspace, policy }),
    /does not name a writable file/,
  );
  await assert.rejects(
    () => writeFileTool.run({ path: "dir/", content: "x" }, { workspace, policy }),
    /not a regular file/,
  );
});

test("writeFile createDirs controls missing parent directory creation", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-write-parents-"));
  const policy = createPolicy({
    workspace,
    approvals: { writeFile: true },
  });

  await assert.rejects(
    () => writeFileTool.run({ path: "missing/file.txt", content: "x" }, { workspace, policy }),
    /parent directory does not exist/,
  );

  const result = await writeFileTool.run(
    { path: "missing/file.txt", content: "x", createDirs: true },
    { workspace, policy },
  );

  assert.equal(result.bytesWritten, 1);
  assert.equal(await readFile(join(workspace, "missing", "file.txt"), "utf8"), "x");
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
  assert.deepEqual(policy.decideToolUse(writeFileTool, { path: "x", content: "y" }), {
    action: "needs-approval",
    reason: "write risk requires approval",
    toolName: "writeFile",
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
