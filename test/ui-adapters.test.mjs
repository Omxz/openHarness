import { test } from "node:test";
import assert from "node:assert/strict";

import { adaptRun } from "../web/src/lib/adapt.js";
import { summarize } from "../web/src/lib/events.js";

test("UI event summaries use backend approval decision field names", () => {
  const approval = {
    type: "approval.decided",
    data: {
      toolName: "shell",
      action: "needs-approval",
      risk: "write",
    },
  };

  assert.equal(summarize(approval), "shell -> needs-approval · write");
});

test("UI run adapter derives blocked reason from approval decisions", () => {
  const run = adaptRun({
    runId: "run-1",
    status: "blocked",
    goal: "check node",
    eventCount: 2,
    events: [
      {
        type: "approval.decided",
        data: {
          toolName: "shell",
          action: "needs-approval",
          risk: "write",
        },
      },
      {
        type: "task.done",
        data: { status: "blocked" },
      },
    ],
  });

  assert.equal(run.reason, "awaiting approval for shell (write risk)");
});
