import { test } from "node:test";
import assert from "node:assert/strict";

import {
  approveApproval,
  cancelRun,
  createRun,
  denyApproval,
  fetchApprovals,
  fetchProviderRegistry,
} from "../web/src/lib/api.js";

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

test("fetchApprovals returns the approvals array from /api/approvals", async () => {
  const requests = [];
  const approvals = await fetchApprovals({
    fetchImpl: async (url) => {
      requests.push(url);
      return response({
        status: 200,
        body: {
          approvals: [
            { approvalId: "a-1", runId: "run-1", toolName: "shell", risk: "write" },
          ],
        },
      });
    },
  });

  assert.equal(requests[0], "/api/approvals");
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].approvalId, "a-1");
});

test("fetchApprovals returns an empty array when the body has no approvals key", async () => {
  const approvals = await fetchApprovals({
    fetchImpl: async () => response({ status: 200, body: {} }),
  });
  assert.deepEqual(approvals, []);
});

test("fetchProviderRegistry returns the provider registry from /api/providers", async () => {
  const requests = [];
  const registry = await fetchProviderRegistry({
    fetchImpl: async (url) => {
      requests.push(url);
      return response({
        status: 200,
        body: {
          defaultProvider: "codex-worker",
          providers: [
            {
              id: "codex-worker",
              label: "Codex",
              readiness: { state: "ready", detail: "codex-cli" },
            },
          ],
        },
      });
    },
  });

  assert.equal(requests[0], "/api/providers");
  assert.equal(registry.defaultProvider, "codex-worker");
  assert.equal(registry.providers[0].id, "codex-worker");
});

test("approveApproval POSTs to the approve route with a JSON reason", async () => {
  const requests = [];
  const result = await approveApproval(
    "abc 123",
    { reason: "looks good" },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({
          status: 200,
          body: { approval: { approvalId: "abc 123" } },
        });
      },
    },
  );

  assert.equal(requests[0].url, "/api/approvals/abc%20123/approve");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].init.body), { reason: "looks good" });
  assert.equal(result.approvalId, "abc 123");
});

test("denyApproval POSTs to the deny route and surfaces API errors", async () => {
  const requests = [];
  const result = await denyApproval(
    "a-2",
    { reason: "no" },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({
          status: 200,
          body: { approval: { approvalId: "a-2" } },
        });
      },
    },
  );

  assert.equal(requests[0].url, "/api/approvals/a-2/deny");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(JSON.parse(requests[0].init.body), { reason: "no" });
  assert.equal(result.approvalId, "a-2");
});

test("approveApproval surfaces API error messages", async () => {
  await assert.rejects(
    () =>
      approveApproval(
        "missing",
        {},
        {
          fetchImpl: async () =>
            response({
              status: 404,
              body: {
                error: { code: "not_found", message: "Approval not found: missing" },
              },
            }),
        },
      ),
    /Approval not found: missing/,
  );
});

test("approveApproval omits a body when no reason is supplied", async () => {
  const requests = [];
  await approveApproval(
    "a-3",
    undefined,
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({ status: 200, body: { approval: { approvalId: "a-3" } } });
      },
    },
  );

  assert.deepEqual(JSON.parse(requests[0].init.body), {});
});

test("cancelRun POSTs to the cancel route and returns the cancelled run", async () => {
  const requests = [];
  const result = await cancelRun(
    "run 7",
    { reason: "stop now" },
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({
          status: 200,
          body: { run: { runId: "run 7", status: "cancelled" } },
        });
      },
    },
  );

  assert.equal(requests[0].url, "/api/runs/run%207/cancel");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(requests[0].init.headers["content-type"], "application/json");
  assert.deepEqual(JSON.parse(requests[0].init.body), { reason: "stop now" });
  assert.equal(result.runId, "run 7");
  assert.equal(result.status, "cancelled");
});

test("cancelRun omits a body when no reason is supplied", async () => {
  const requests = [];
  await cancelRun(
    "run-1",
    undefined,
    {
      fetchImpl: async (url, init) => {
        requests.push({ url, init });
        return response({ status: 200, body: { run: { runId: "run-1", status: "cancelled" } } });
      },
    },
  );

  assert.deepEqual(JSON.parse(requests[0].init.body), {});
});

test("cancelRun surfaces API error messages", async () => {
  await assert.rejects(
    () =>
      cancelRun(
        "missing",
        {},
        {
          fetchImpl: async () =>
            response({
              status: 404,
              body: { error: { code: "not_found", message: "Run not found: missing" } },
            }),
        },
      ),
    /Run not found: missing/,
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
