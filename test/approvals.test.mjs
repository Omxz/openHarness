import { test } from "node:test";
import assert from "node:assert/strict";
import { PassThrough } from "node:stream";

import {
  createCliApprovalGate,
  createReadlineApprovalPrompt,
  decideFromAnswer,
  parseToolList,
} from "../src/approvals.mjs";

const shellTool = { name: "shell", risk: "write" };
const baseDecision = {
  action: "needs-approval",
  toolName: "shell",
  risk: "write",
  reason: "write risk requires approval",
};

test("parseToolList splits comma-separated values, trims, and drops empties", () => {
  assert.deepEqual(parseToolList("shell, readFile, ,listFiles"), [
    "shell",
    "readFile",
    "listFiles",
  ]);
  assert.deepEqual(parseToolList(""), []);
  assert.deepEqual(parseToolList(undefined), []);
});

test("createCliApprovalGate defaults to fail-closed (returns the original needs-approval decision)", async () => {
  const gate = createCliApprovalGate();
  const result = await gate({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  assert.equal(result.action, "needs-approval");
});

test("createCliApprovalGate auto-approves tools listed via --auto-approve", async () => {
  const gate = createCliApprovalGate({ autoApprove: ["shell"] });
  const result = await gate({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  assert.equal(result.action, "allow");
  assert.match(result.reason, /auto-approve/);
});

test("createCliApprovalGate denies tools listed via --deny and --deny wins over --auto-approve", async () => {
  const gate = createCliApprovalGate({
    autoApprove: ["shell"],
    deny: ["shell"],
  });
  const result = await gate({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  assert.equal(result.action, "deny");
  assert.match(result.reason, /deny/);
});

test("createCliApprovalGate refuses --approve without a TTY", () => {
  assert.throws(
    () => createCliApprovalGate({ interactive: true, isTty: false }),
    /--approve requires a TTY/,
  );
});

test("createCliApprovalGate routes interactive approvals through the supplied prompt when on a TTY", async () => {
  const seen = [];
  const gate = createCliApprovalGate({
    interactive: true,
    isTty: true,
    prompt: async ({ tool, decision }) => {
      seen.push(tool.name);
      return { ...decision, action: "allow", reason: "user accepted" };
    },
  });
  const result = await gate({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  assert.equal(result.action, "allow");
  assert.equal(result.reason, "user accepted");
  assert.deepEqual(seen, ["shell"]);
});

test("createCliApprovalGate keeps unlisted tools in needs-approval (fail-closed) even with auto-approve set", async () => {
  const gate = createCliApprovalGate({ autoApprove: ["readFile"] });
  const result = await gate({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  assert.equal(result.action, "needs-approval");
});

test("decideFromAnswer maps y/yes (case-insensitive, padded) to allow with a clear reason", () => {
  for (const answer of ["y", "Y", "yes", "YES", "  y  ", " yes\n"]) {
    const result = decideFromAnswer(answer, {
      tool: shellTool,
      decision: baseDecision,
    });
    assert.equal(result.action, "allow", `expected allow for ${JSON.stringify(answer)}`);
    assert.match(result.reason, /approved at TTY prompt for shell/);
  }
});

test("decideFromAnswer maps n/no/empty to needs-approval (fail-closed)", () => {
  for (const answer of ["n", "N", "no", "NO", "", "   ", undefined, null]) {
    const result = decideFromAnswer(answer, {
      tool: shellTool,
      decision: baseDecision,
    });
    assert.equal(
      result.action,
      "needs-approval",
      `expected needs-approval for ${JSON.stringify(answer)}`,
    );
    assert.match(result.reason, /declined at TTY prompt for shell/);
  }
});

test("decideFromAnswer fails closed on unrecognized responses (e.g. 'maybe')", () => {
  const result = decideFromAnswer("maybe", {
    tool: shellTool,
    decision: baseDecision,
  });

  assert.equal(result.action, "needs-approval");
  assert.match(result.reason, /unrecognized response "maybe"/);
});

test("createReadlineApprovalPrompt returns allow when the user types 'y' on the TTY", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompt = createReadlineApprovalPrompt({ input, output });

  let captured = "";
  output.on("data", (chunk) => {
    captured += chunk.toString();
  });

  const promise = prompt({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  setImmediate(() => input.write("y\n"));

  const result = await promise;

  assert.equal(result.action, "allow");
  assert.match(result.reason, /approved at TTY prompt/);
  assert.match(captured, /Approve shell \(write risk\)\? \[y\/N\]/);
});

test("createReadlineApprovalPrompt returns needs-approval when the user types 'n' on the TTY", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompt = createReadlineApprovalPrompt({ input, output });

  const promise = prompt({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  setImmediate(() => input.write("n\n"));

  const result = await promise;

  assert.equal(result.action, "needs-approval");
  assert.match(result.reason, /declined at TTY prompt for shell/);
});

test("createReadlineApprovalPrompt treats an empty line as fail-closed (needs-approval)", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  const prompt = createReadlineApprovalPrompt({ input, output });

  const promise = prompt({
    tool: shellTool,
    input: { command: "node" },
    decision: baseDecision,
  });

  setImmediate(() => input.write("\n"));

  const result = await promise;

  assert.equal(result.action, "needs-approval");
  assert.match(result.reason, /declined at TTY prompt for shell/);
});
