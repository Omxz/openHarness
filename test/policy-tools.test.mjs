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

test("filesystem tools reject paths outside the workspace", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "harness-scope-"));
  const policy = createPolicy({ workspace });

  await assert.rejects(
    () => readFileTool.run({ path: "../outside.txt" }, { workspace, policy }),
    /outside the workspace/,
  );
});
