import { test } from "node:test";
import assert from "node:assert/strict";

import { createRun } from "../web/src/lib/api.js";

test("createRun posts a new task and returns created run metadata", async () => {
  const requests = [];
  const run = await createRun(
    {
      goal: "Inspect README",
      provider: "scripted",
      privacyMode: "local-only",
    },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({
          status: 202,
          body: {
            run: {
              runId: "run-1",
              status: "running",
              providerId: "cli:scripted",
            },
          },
        });
      },
    },
  );

  assert.deepEqual(run, {
    runId: "run-1",
    status: "running",
    providerId: "cli:scripted",
  });
  assert.equal(requests[0].url, "/api/runs");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].init.body), {
    goal: "Inspect README",
    provider: "scripted",
    privacyMode: "local-only",
  });
});

test("createRun surfaces API error messages", async () => {
  await assert.rejects(
    () =>
      createRun(
        { goal: "", provider: "scripted" },
        {
          fetchImpl: async () =>
            response({
              status: 400,
              body: {
                error: {
                  code: "invalid_request",
                  message: "goal must be a non-empty string",
                },
              },
            }),
        },
      ),
    /goal must be a non-empty string/,
  );
});

function response({ status, body }) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}
