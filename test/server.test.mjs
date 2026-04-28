import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

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
    assert.equal(health.readOnly, true);
    assert.equal(health.logPath, logPath);
    assert.equal(runs.runs.length, 1);
    assert.equal(runs.runs[0].runId, "run-1");
    assert.equal(runs.runs[0].goal, "inspect README");
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

test("API server returns stable JSON errors and blocks writes", async () => {
  const logPath = await createLog([]);
  const api = await startApiServer({ host: "127.0.0.1", port: 0, logPath });

  try {
    const missing = await fetch(`${api.url}/api/runs/missing`);
    const writeAttempt = await fetch(`${api.url}/api/runs`, { method: "POST" });

    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), {
      error: { code: "not_found", message: "Run not found: missing" },
    });
    assert.equal(writeAttempt.status, 405);
    assert.deepEqual(await writeAttempt.json(), {
      error: { code: "method_not_allowed", message: "Only GET and OPTIONS are supported" },
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
    assert.equal(response.headers.get("access-control-allow-methods"), "GET, OPTIONS");
  } finally {
    await api.close();
  }
});

async function getJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
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
