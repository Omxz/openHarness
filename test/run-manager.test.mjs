import { createServer } from "node:http";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { readEvents } from "../src/audit-log.mjs";
import { normalizeConfig } from "../src/config.mjs";
import { createRunManager } from "../src/run-manager.mjs";

test("createRunManager pauses API-started runs for dashboard approval and resumes after approve", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-run-manager-"));
  const logPath = join(workspace, "events.jsonl");
  const fakeProvider = await startFakeOpenAICompatibleProvider([
    {
      type: "tool_call",
      toolName: "shell",
      input: { command: "node", args: ["--version"] },
    },
    {
      type: "final",
      content: "approved shell command completed",
    },
  ]);

  try {
    const manager = createRunManager({
      workspace,
      logPath,
      config: normalizeConfig({
        provider: "openai-compatible",
        providers: {
          "openai-compatible": {
            baseUrl: fakeProvider.url,
            model: "fake-model",
          },
        },
      }),
      verifier: { command: "node", args: ["--version"] },
    });

    const run = manager.startRun({
      goal: "check node version",
      provider: "openai-compatible",
      privacyMode: "local-only",
    });

    const pending = await waitForPendingApproval(manager);
    assert.equal(pending.runId, run.runId);
    assert.equal(pending.toolName, "shell");
    assert.equal(pending.risk, "write");
    assert.deepEqual(pending.input, { command: "node", args: ["--version"] });

    manager.approvalManager.approve(pending.approvalId, {
      reason: "integration test approval",
    });

    const result = await run.promise;
    assert.equal(result.status, "done");
    assert.equal(result.final, "approved shell command completed");

    const events = await readEvents(logPath);
    const requested = events.find((event) => event.type === "approval.requested");
    const decided = events.find((event) => event.type === "approval.decided");
    assert.equal(requested.data.approvalId, pending.approvalId);
    assert.equal(decided.data.approvalId, pending.approvalId);
    assert.equal(decided.data.action, "allow");
    assert.equal(decided.data.reason, "integration test approval");
    assert.ok(events.some((event) => event.type === "tool.finished"));
    assert.ok(events.some((event) => event.type === "task.done"));
  } finally {
    await fakeProvider.close();
  }
});

async function waitForPendingApproval(manager, { attempts = 50 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const [pending] = manager.approvalManager.list();
    if (pending) {
      return pending;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }

  throw new Error("Timed out waiting for pending approval");
}

async function startFakeOpenAICompatibleProvider(responses) {
  const remaining = [...responses];
  const server = createServer(async (request, response) => {
    if (request.method !== "POST" || request.url !== "/chat/completions") {
      response.writeHead(404, { "content-type": "application/json" });
      response.end("{}");
      return;
    }

    await consume(request);
    const modelResponse = remaining.shift();
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify(modelResponse),
            },
          },
        ],
      }),
    );
  });

  await listen(server);
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => close(server),
  };
}

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}

async function consume(stream) {
  for await (const _chunk of stream) {
    // Drain the request body so the fake server behaves like a real provider.
  }
}
