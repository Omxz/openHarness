import { test } from "node:test";
import assert from "node:assert/strict";

import { createApprovalManager } from "../src/approval-manager.mjs";

const baseDecision = {
  action: "needs-approval",
  toolName: "shell",
  risk: "write",
  reason: "write risk requires approval",
};

function buildContext(overrides = {}) {
  return {
    approvalId: "approval-1",
    runId: "run-1",
    task: { id: "run-1", goal: "do work" },
    tool: { name: "shell", risk: "write" },
    input: { command: "node", args: ["--version"] },
    auditInput: { command: "node", args: ["--version"] },
    decision: baseDecision,
    ...overrides,
  };
}

test("createApprovalManager registers a pending approval and lists it with safe metadata", async () => {
  const manager = createApprovalManager();
  const pending = manager.request(buildContext());

  const list = manager.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].approvalId, "approval-1");
  assert.equal(list[0].runId, "run-1");
  assert.equal(list[0].toolName, "shell");
  assert.equal(list[0].risk, "write");
  assert.equal(list[0].reason, "write risk requires approval");
  assert.equal(list[0].goal, "do work");
  assert.deepEqual(list[0].input, { command: "node", args: ["--version"] });
  assert.ok(typeof list[0].requestedAt === "string");
  assert.ok(pending.promise instanceof Promise);
});

test("approve resolves the pending promise with an allow decision and clears the entry", async () => {
  const manager = createApprovalManager();
  const pending = manager.request(buildContext());

  const result = manager.approve("approval-1", { reason: "dashboard approved" });
  assert.equal(result.ok, true);

  const decision = await pending.promise;
  assert.equal(decision.action, "allow");
  assert.equal(decision.reason, "dashboard approved");
  assert.equal(decision.approvalId, "approval-1");
  assert.equal(manager.list().length, 0);
});

test("approve uses a default reason when none is supplied", async () => {
  const manager = createApprovalManager();
  const pending = manager.request(buildContext());

  manager.approve("approval-1");
  const decision = await pending.promise;
  assert.equal(decision.action, "allow");
  assert.match(decision.reason, /dashboard/i);
});

test("deny resolves the pending promise with a deny decision and clears the entry", async () => {
  const manager = createApprovalManager();
  const pending = manager.request(buildContext());

  const result = manager.deny("approval-1", { reason: "looks risky" });
  assert.equal(result.ok, true);

  const decision = await pending.promise;
  assert.equal(decision.action, "deny");
  assert.equal(decision.reason, "looks risky");
  assert.equal(decision.approvalId, "approval-1");
  assert.equal(manager.list().length, 0);
});

test("approve and deny return ok=false with not_found when the approvalId is unknown", () => {
  const manager = createApprovalManager();

  const approveMissing = manager.approve("nope");
  const denyMissing = manager.deny("nope");

  assert.equal(approveMissing.ok, false);
  assert.equal(approveMissing.code, "not_found");
  assert.equal(denyMissing.ok, false);
  assert.equal(denyMissing.code, "not_found");
});

test("a second approve for the same id is rejected as already_decided", async () => {
  const manager = createApprovalManager();
  const pending = manager.request(buildContext());

  manager.approve("approval-1");
  await pending.promise;
  const second = manager.approve("approval-1");

  assert.equal(second.ok, false);
  assert.equal(second.code, "not_found");
});

test("multiple pending approvals are tracked independently", async () => {
  const manager = createApprovalManager();
  const first = manager.request(buildContext({ approvalId: "a-1" }));
  const second = manager.request(
    buildContext({
      approvalId: "a-2",
      runId: "run-2",
      tool: { name: "writeFile", risk: "write" },
      decision: {
        action: "needs-approval",
        toolName: "writeFile",
        risk: "write",
        reason: "write risk requires approval",
      },
    }),
  );

  assert.equal(manager.list().length, 2);

  manager.deny("a-1", { reason: "no" });
  manager.approve("a-2");

  assert.equal((await first.promise).action, "deny");
  assert.equal((await second.promise).action, "allow");
  assert.equal(manager.list().length, 0);
});

test("createApprovalManager exposes approveToolUse, which routes through the manager", async () => {
  const manager = createApprovalManager();
  const decisionPromise = manager.approveToolUse({
    approvalId: "approval-1",
    task: { id: "run-1", goal: "work" },
    tool: { name: "shell", risk: "write" },
    input: { command: "node" },
    auditInput: { command: "node" },
    decision: baseDecision,
  });

  const list = manager.list();
  assert.equal(list.length, 1);
  assert.equal(list[0].approvalId, "approval-1");

  manager.approve("approval-1", { reason: "ok" });
  const decision = await decisionPromise;
  assert.equal(decision.action, "allow");
  assert.equal(decision.reason, "ok");
});
