import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { appendEvent, createEvent } from "../src/audit-log.mjs";
import { startApiServer } from "../src/server.mjs";

test("API server exposes health and run list endpoints", async () => {
  const logPath = await createLog([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "inspect README",
      providerId: "scripted",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "system", "task.done", {
      status: "done",
    }),
  ]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const health = await getJson(`${api.url}/api/health`);
    const runs = await getJson(`${api.url}/api/runs`);

    assert.equal(health.status, "ok");
    assert.equal(health.readOnly, false);
    assert.equal(health.capabilities.createRuns, true);
    assert.equal(health.capabilities.cancelRuns, true);
    assert.equal(health.capabilities.approvalDecisions, true);
    assert.equal(health.logPath, logPath);
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].runId, "run-1");
    assert.equal(runs.runs[0].goal, "inspect README");
  } finally {
    await api.close();
  }
});

test("API server reports worker readiness at GET /api/health/workers", async () => {
  const logPath = await createLog([]);
  let calls = 0;
  const fakeWorkerHealth = async () => {
    calls += 1;
    return {
      codex: { available: true, command: "codex", detail: "codex 0.5.0" },
      claude: {
        available: true,
        command: "claude",
        detail: "claude 1.2.0",
        authenticated: false,
        authDetail: "not logged in",
      },
    };
  };

  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    workerHealth: fakeWorkerHealth,
  });

  try {
    const body = await getJson(`${api.url}/api/health/workers`);

    assert.equal(calls, 1);
    assert.deepEqual(body.codex, {
      available: true,
      command: "codex",
      detail: "codex 0.5.0",
    });
    assert.equal(body.claude.available, true);
    assert.equal(body.claude.authenticated, false);
    assert.equal(body.claude.authDetail, "not logged in");
  } finally {
    await api.close();
  }
});

test("API server exposes the provider registry at GET /api/providers", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    workerHealth: async () => ({
      codex: { available: true, command: "codex", detail: "codex ready" },
      claude: {
        available: true,
        authenticated: true,
        command: "claude",
        detail: "claude ready",
        authDetail: "logged in via claude.ai",
      },
    }),
  });

  try {
    const body = await getJson(`${api.url}/api/providers`);

    assert.equal(body.defaultProvider, "scripted");
    assert.ok(body.providers.some((provider) => provider.id === "scripted"));
    assert.ok(body.providers.some((provider) => provider.id === "codex-worker"));
    assert.equal(
      body.providers.find((provider) => provider.id === "claude-worker").readiness.state,
      "ready",
    );
  } finally {
    await api.close();
  }
});

test("API server starts a scripted run from POST /api/runs", async () => {
  const logPath = await createLog([]);
  const workspace = await mkdtemp(join(tmpdir(), "openharness-api-workspace-"));
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    workspace,
    eventStreamPollMs: 10,
  });

  try {
    const created = await fetch(`${api.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        goal: "Inspect the API-created run path.",
        provider: "scripted",
        privacyMode: "local-only",
      }),
    });

    assert.equal(created.status, 202);
    assert.match(created.headers.get("location"), /^\/api\/runs\//);
    const body = await created.json();
    assert.equal(body.run.status, "running");
    assert.equal(body.run.providerId, "cli:scripted");
    assert.match(body.run.runId, /^[0-9a-f-]{36}$/);

    const run = await waitForRun(api.url, body.run.runId, "done");
    assert.equal(run.goal, "Inspect the API-created run path.");
    assert.equal(run.providerId, "cli:scripted");
    assert.equal(
      run.final,
      "Scripted provider received: Inspect the API-created run path.",
    );
    assert.equal(run.status, "done");
  } finally {
    await api.close();
  }
});

test("API server validates run creation requests", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const emptyGoal = await fetch(`${api.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "  ", provider: "scripted" }),
    });
    const unsupportedProvider = await fetch(`${api.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ goal: "go", provider: "made-up-provider" }),
    });
    const invalidJson = await fetch(`${api.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{",
    });

    assert.equal(emptyGoal.status, 400);
    assert.deepEqual(await emptyGoal.json(), {
      error: { code: "invalid_request", message: "goal must be a non-empty string" },
    });
    assert.equal(unsupportedProvider.status, 400);
    assert.deepEqual(await unsupportedProvider.json(), {
      error: {
        code: "invalid_request",
        message: 'Unsupported run provider "made-up-provider"',
      },
    });
    assert.equal(invalidJson.status, 400);
    assert.deepEqual(await invalidJson.json(), {
      error: { code: "invalid_json", message: "Request body must be valid JSON" },
    });
  } finally {
    await api.close();
  }
});

test("API server rejects cross-origin run creation", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const response = await fetch(`${api.url}/api/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: JSON.stringify({ goal: "go", provider: "scripted" }),
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "forbidden_origin",
        message: "Cross-origin run creation is not allowed",
      },
    });
  } finally {
    await api.close();
  }
});

test("API server allows same-origin run creation", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const response = await fetch(`${api.url}/api/runs`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: JSON.stringify({ goal: "same origin", provider: "scripted" }),
    });

    assert.equal(response.status, 202);
  } finally {
    await api.close();
  }
});

test("API server exposes one run with its event timeline", async () => {
  const logPath = await createLog([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "inspect README",
      workerId: "codex-worker",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "worker", "worker.finished", {
      workerId: "codex-worker",
      result: { exitCode: 0, output: "README summary" },
    }),
  ]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const body = await getJson(`${api.url}/api/runs/run-1`);

    assert.equal(body.run.runId, "run-1");
    assert.equal(body.run.workerId, "codex-worker");
    assert.equal(body.run.final, "README summary");
    assert.equal(body.run.events.length, 2);
  } finally {
    await api.close();
  }
});

test("API server includes a retry plan for blocked runs", async () => {
  const logPath = await createLog([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "retry me",
      workerId: "codex-worker",
      privacyMode: "ask-before-api",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "worker", "worker.finished", {
      workerId: "codex-worker",
      result: { exitCode: 1, output: "Usage limit reached." },
    }),
    event("run-1", "2026-04-28T10:00:02.000Z", "system", "task.done", {
      status: "blocked",
    }),
  ]);
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    workerHealth: async () => ({
      codex: { available: true, detail: "codex ready" },
      claude: { available: true, authenticated: true, authDetail: "claude ready" },
    }),
  });

  try {
    const body = await getJson(`${api.url}/api/runs/run-1`);

    assert.equal(body.run.retryPlan.available, true);
    assert.equal(body.run.retryPlan.providerId, "claude-worker");
    assert.equal(body.run.retryPlan.retryOfRunId, "run-1");
  } finally {
    await api.close();
  }
});

test("API server retries a blocked run with the routed provider", async () => {
  const logPath = await createLog([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "retry me",
      workerId: "codex-worker",
      privacyMode: "ask-before-api",
    }),
    event("run-1", "2026-04-28T10:00:01.000Z", "worker", "worker.finished", {
      workerId: "codex-worker",
      result: { exitCode: 1, output: "Usage limit reached." },
    }),
    event("run-1", "2026-04-28T10:00:02.000Z", "system", "task.done", {
      status: "blocked",
    }),
  ]);
  const calls = [];
  const runManager = {
    approvalManager: { list: () => [] },
    startRun(input) {
      calls.push(input);
      return {
        runId: "retry-1",
        status: "running",
        providerId: input.provider,
        retryOfRunId: input.retryOfRunId,
      };
    },
    getActiveRuns() {
      return [];
    },
  };
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
    workerHealth: async () => ({
      codex: { available: true, detail: "codex ready" },
      claude: { available: true, authenticated: true, authDetail: "claude ready" },
    }),
  });

  try {
    const response = await fetch(`${api.url}/api/runs/run-1/retry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: "{}",
    });

    assert.equal(response.status, 202);
    assert.equal(response.headers.get("location"), "/api/runs/retry-1");
    const body = await response.json();
    assert.equal(body.run.runId, "retry-1");
    assert.equal(body.run.retryOfRunId, "run-1");
    assert.deepEqual(calls[0], {
      goal: "retry me",
      provider: "claude-worker",
      privacyMode: "ask-before-api",
      retryOfRunId: "run-1",
    });
  } finally {
    await api.close();
  }
});

test("API server rejects cross-origin run retries", async () => {
  const logPath = await createLog([]);
  const calls = [];
  const runManager = {
    approvalManager: { list: () => [] },
    startRun(input) {
      calls.push(input);
      return { runId: "retry-1", status: "running", providerId: input.provider };
    },
    getActiveRuns() {
      return [];
    },
  };
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath, runManager });

  try {
    const response = await fetch(`${api.url}/api/runs/run-1/retry`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: "{}",
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "forbidden_origin",
        message: "Cross-origin run retries are not allowed",
      },
    });
    assert.equal(calls.length, 0);
  } finally {
    await api.close();
  }
});

test("API server returns stable JSON errors and rejects unsupported methods", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const missing = await fetch(`${api.url}/api/runs/missing`);
    const unknownApi = await fetch(`${api.url}/api/nope`);
    const writeAttempt = await fetch(`${api.url}/api/runs/run-1`, { method: "POST" });

    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: { code: "not_found", message: "Run not found: missing" },
    });
    assert.equal(unknownApi.status, 404);
    assert.deepEqual(await unknownApi.json(), {
      error: { code: "not_found", message: "Route not found: /api/nope" },
    });
    assert.equal(writeAttempt.status, 405);
    assert.deepEqual(await writeAttempt.json(), {
      error: {
        code: "method_not_allowed",
        message:
          "Only GET, POST /api/runs, POST /api/runs/:id/retry, POST /api/runs/:id/cancel, POST /api/approvals/:id/approve, POST /api/approvals/:id/deny, and OPTIONS are supported",
      },
    });
  } finally {
    await api.close();
  }
});

test("API server handles CORS preflight for local UI clients", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const response = await fetch(`${api.url}/api/runs`, { method: "OPTIONS" });

    assert.equal(response.status, 204);
    assert.equal(response.headers.get("access-control-allow-origin"), "*");
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, POST, OPTIONS");
  } finally {
    await api.close();
  }
});

test("API server lists pending approvals and resolves an approve POST", async () => {
  const logPath = await createLog([]);
  const workspace = await mkdtemp(join(tmpdir(), "openharness-approval-api-"));
  const approvalManager = await import("../src/approval-manager.mjs").then((m) =>
    m.createApprovalManager(),
  );
  const decisionPromise = approvalManager.approveToolUse({
    approvalId: "a-1",
    task: { id: "run-1", goal: "do work" },
    tool: { name: "writeFile", risk: "write" },
    input: { path: "out.txt", content: "secret body" },
    auditInput: { path: "out.txt", bytesWritten: 11 },
    decision: {
      action: "needs-approval",
      toolName: "writeFile",
      risk: "write",
      reason: "write risk requires approval",
    },
  });

  const runManager = {
    approvalManager,
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
  };

  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    workspace,
    runManager,
  });

  try {
    const list = await getJson(`${api.url}/api/approvals`);
    assert.equal(list.approvals.length, 1);
    assert.equal(list.approvals[0].approvalId, "a-1");
    assert.equal(list.approvals[0].runId, "run-1");
    assert.equal(list.approvals[0].toolName, "writeFile");
    assert.equal(list.approvals[0].risk, "write");
    assert.deepEqual(list.approvals[0].input, {
      path: "out.txt",
      bytesWritten: 11,
    });
    assert.equal(JSON.stringify(list).includes("secret body"), false);

    const approve = await fetch(`${api.url}/api/approvals/a-1/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: JSON.stringify({ reason: "looks fine" }),
    });
    assert.equal(approve.status, 200);
    const body = await approve.json();
    assert.equal(body.approval.approvalId, "a-1");

    const decision = await decisionPromise;
    assert.equal(decision.action, "allow");
    assert.equal(decision.reason, "looks fine");

    const after = await getJson(`${api.url}/api/approvals`);
    assert.equal(after.approvals.length, 0);
  } finally {
    await api.close();
  }
});

test("API server resolves a deny POST with the supplied reason", async () => {
  const logPath = await createLog([]);
  const approvalManager = await import("../src/approval-manager.mjs").then((m) =>
    m.createApprovalManager(),
  );
  const decisionPromise = approvalManager.approveToolUse({
    approvalId: "a-2",
    task: { id: "run-2", goal: "do work" },
    tool: { name: "writeFile", risk: "write" },
    input: { path: "out.txt" },
    auditInput: { path: "out.txt", bytesWritten: 0 },
    decision: {
      action: "needs-approval",
      toolName: "writeFile",
      risk: "write",
      reason: "write risk requires approval",
    },
  });

  const runManager = {
    approvalManager,
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
  };

  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
  });

  try {
    const deny = await fetch(`${api.url}/api/approvals/a-2/deny`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: JSON.stringify({ reason: "no thank you" }),
    });
    assert.equal(deny.status, 200);

    const decision = await decisionPromise;
    assert.equal(decision.action, "deny");
    assert.equal(decision.reason, "no thank you");
  } finally {
    await api.close();
  }
});

test("API server returns 404 when approving an unknown approvalId", async () => {
  const logPath = await createLog([]);
  const approvalManager = await import("../src/approval-manager.mjs").then((m) =>
    m.createApprovalManager(),
  );
  const runManager = {
    approvalManager,
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
  };
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
  });

  try {
    const response = await fetch(`${api.url}/api/approvals/missing/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: "{}",
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "not_found", message: "Approval not found: missing" },
    });
  } finally {
    await api.close();
  }
});

test("API server rejects cross-origin approval reads and decisions", async () => {
  const logPath = await createLog([]);
  const approvalManager = await import("../src/approval-manager.mjs").then((m) =>
    m.createApprovalManager(),
  );
  approvalManager.approveToolUse({
    approvalId: "a-3",
    task: { id: "run-3", goal: "do work" },
    tool: { name: "shell", risk: "write" },
    input: { command: "node" },
    auditInput: { command: "node" },
    decision: {
      action: "needs-approval",
      toolName: "shell",
      risk: "write",
      reason: "write risk requires approval",
    },
  }).catch(() => {});

  const runManager = {
    approvalManager,
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
  };
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
  });

  try {
    const readResponse = await fetch(`${api.url}/api/approvals`, {
      headers: { origin: "http://evil.example" },
    });
    const response = await fetch(`${api.url}/api/approvals/a-3/approve`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: "{}",
    });
    const denyResponse = await fetch(`${api.url}/api/approvals/a-3/deny`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: "{}",
    });

    assert.equal(readResponse.status, 403);
    assert.deepEqual(await readResponse.json(), {
      error: {
        code: "forbidden_origin",
        message: "Cross-origin approval reads are not allowed",
      },
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "forbidden_origin",
        message: "Cross-origin approval decisions are not allowed",
      },
    });
    assert.equal(denyResponse.status, 403);

    assert.equal(approvalManager.list().length, 1);
  } finally {
    await api.close();
  }
});

test("API server cancels a running run via POST /api/runs/:id/cancel", async () => {
  const logPath = await createLog([]);
  const cancelled = [];
  const runManager = {
    approvalManager: {
      list: () => [],
    },
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
    cancelRun(runId, options) {
      cancelled.push({ runId, options });
      return {
        ok: true,
        summary: {
          runId,
          status: "cancelled",
          reason: options?.reason ?? null,
        },
      };
    },
  };

  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
  });

  try {
    const response = await fetch(`${api.url}/api/runs/run-7/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: JSON.stringify({ reason: "user clicked cancel" }),
    });

    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.run.runId, "run-7");
    assert.equal(body.run.status, "cancelled");
    assert.equal(cancelled.length, 1);
    assert.equal(cancelled[0].runId, "run-7");
    assert.equal(cancelled[0].options.reason, "user clicked cancel");
  } finally {
    await api.close();
  }
});

test("API server returns 404 when cancelling an unknown run", async () => {
  const logPath = await createLog([]);
  const runManager = {
    approvalManager: { list: () => [] },
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
    cancelRun() {
      return { ok: false, code: "not_found" };
    },
  };
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
  });

  try {
    const response = await fetch(`${api.url}/api/runs/missing/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: api.url,
      },
      body: "{}",
    });

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      error: { code: "not_found", message: "Run not found: missing" },
    });
  } finally {
    await api.close();
  }
});

test("API server rejects cross-origin run cancellation", async () => {
  const logPath = await createLog([]);
  const calls = [];
  const runManager = {
    approvalManager: { list: () => [] },
    startRun() {
      throw new Error("not used");
    },
    getActiveRuns() {
      return [];
    },
    cancelRun(runId) {
      calls.push(runId);
      return { ok: true, summary: { runId, status: "cancelled" } };
    },
  };
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    runManager,
  });

  try {
    const response = await fetch(`${api.url}/api/runs/run-1/cancel`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        origin: "http://evil.example",
      },
      body: "{}",
    });

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      error: {
        code: "forbidden_origin",
        message: "Cross-origin run cancellation is not allowed",
      },
    });
    assert.equal(calls.length, 0);
  } finally {
    await api.close();
  }
});

test("API server returns build instructions when the UI bundle is missing", async () => {
  const logPath = await createLog([]);
  const missingDist = join(await mkdtemp(join(tmpdir(), "openharness-missing-ui-")), "dist");
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    uiDist: missingDist,
  });

  try {
    const response = await fetch(`${api.url}/`);

    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), {
      error: {
        code: "ui_not_built",
        message:
          "UI bundle not found. Build it with: npm --prefix web install && npm --prefix web run build",
      },
    });
  } finally {
    await api.close();
  }
});

test("API server serves built UI assets and keeps SPA fallback out of /api", async () => {
  const logPath = await createLog([]);
  const uiDist = await mkdtemp(join(tmpdir(), "openharness-ui-dist-"));
  await mkdir(join(uiDist, "assets"));
  await writeFile(join(uiDist, "index.html"), "<main>OpenHarness UI</main>", "utf8");
  await writeFile(join(uiDist, "assets", "app.js"), "console.log('ok');", "utf8");
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath, uiDist });

  try {
    const root = await fetch(`${api.url}/`);
    const fallback = await fetch(`${api.url}/runs/run-1`);
    const asset = await fetch(`${api.url}/assets/app.js`);
    const unknownApi = await fetch(`${api.url}/api/unknown`);

    assert.equal(root.status, 200);
    assert.equal(root.headers.get("content-type"), "text/html; charset=utf-8");
    assert.equal(await root.text(), "<main>OpenHarness UI</main>");
    assert.equal(fallback.status, 200);
    assert.equal(await fallback.text(), "<main>OpenHarness UI</main>");
    assert.equal(asset.status, 200);
    assert.equal(asset.headers.get("content-type"), "text/javascript; charset=utf-8");
    assert.equal(unknownApi.status, 404);
    assert.deepEqual(await unknownApi.json(), {
      error: { code: "not_found", message: "Route not found: /api/unknown" },
    });
  } finally {
    await api.close();
  }
});

test("API server streams appended audit events over SSE", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    eventStreamPollMs: 10,
  });
  const controller = new AbortController();

  try {
    const response = await fetch(`${api.url}/api/events/stream`, {
      signal: controller.signal,
    });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/event-stream/);

    const reader = createSseReader(response.body.getReader());
    const ready = await reader.next("openharness.ready");
    assert.deepEqual(ready.data, {
      logPath,
      replay: false,
    });

    await appendEvent(
      logPath,
      createEvent({
        taskId: "run-1",
        actor: "user",
        type: "task.created",
        data: { goal: "stream me", providerId: "scripted" },
      }),
    );

    const streamed = await reader.next("openharness.event");
    assert.equal(streamed.data.taskId, "run-1");
    assert.equal(streamed.data.type, "task.created");
    assert.equal(streamed.data.data.goal, "stream me");
  } finally {
    controller.abort();
    await api.close();
  }
});

test("API server can replay existing audit events over SSE", async () => {
  const logPath = await createLog([
    event("run-1", "2026-04-28T10:00:00.000Z", "user", "task.created", {
      goal: "existing event",
      providerId: "scripted",
    }),
  ]);
  const api = await startApiServer({
    host: "127.0.0.1",
    port: 0,
    logPath,
    eventStreamPollMs: 10,
  });
  const controller = new AbortController();

  try {
    const response = await fetch(`${api.url}/api/events/stream?replay=1`, {
      signal: controller.signal,
    });
    const reader = createSseReader(response.body.getReader());
    const ready = await reader.next("openharness.ready");
    const streamed = await reader.next("openharness.event");

    assert.equal(ready.data.replay, true);
    assert.equal(streamed.data.taskId, "run-1");
    assert.equal(streamed.data.data.goal, "existing event");
  } finally {
    controller.abort();
    await api.close();
  }
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}

async function waitForRun(baseUrl, runId, status, { attempts = 30 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const response = await fetch(`${baseUrl}/api/runs/${encodeURIComponent(runId)}`);
    if (response.status === 200) {
      const body = await response.json();
      if (body.run?.status === status) {
        return body.run;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error(`Timed out waiting for run ${runId} to reach ${status}`);
}

async function createLog(events) {
  const dir = await mkdtemp(join(tmpdir(), "openharness-api-"));
  const logPath = join(dir, "events.jsonl");
  await writeFile(
    logPath,
    events.length === 0
      ? ""
      : `${events.map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    "utf8",
  );
  return logPath;
}

function event(taskId, timestamp, actor, type, data) {
  return { taskId, timestamp, actor, type, data };
}

function createSseReader(reader) {
  const decoder = new TextDecoder();
  let buffer = "";

  return {
    async next(expectedEvent) {
      const deadline = Date.now() + 1500;

      while (Date.now() < deadline) {
        const separator = buffer.indexOf("\n\n");
        if (separator >= 0) {
          const raw = buffer.slice(0, separator);
          buffer = buffer.slice(separator + 2);
          const parsed = parseSse(raw);
          if (!expectedEvent || parsed.event === expectedEvent) {
            return parsed;
          }
          continue;
        }

        const chunk = await readWithTimeout(reader, deadline - Date.now());
        buffer += decoder.decode(chunk, { stream: true });
      }

      throw new Error(`Timed out waiting for SSE event ${expectedEvent}`);
    },
  };
}

async function readWithTimeout(reader, timeoutMs) {
  const timeout = new Promise((_, reject) => {
    setTimeout(() => reject(new Error("Timed out reading SSE stream")), timeoutMs);
  });
  const result = await Promise.race([reader.read(), timeout]);
  if (result.done) {
    throw new Error("SSE stream closed");
  }
  return result.value;
}

function parseSse(raw) {
  const event = { event: "message", data: "" };
  for (const line of raw.split("\n")) {
    if (line.startsWith("event: ")) {
      event.event = line.slice("event: ".length);
    } else if (line.startsWith("data: ")) {
      event.data += line.slice("data: ".length);
    }
  }
  return {
    event: event.event,
    data: event.data ? JSON.parse(event.data) : null,
  };
}
