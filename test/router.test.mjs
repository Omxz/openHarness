import { test } from "node:test";
import assert from "node:assert/strict";

import { buildRetryPlan } from "../src/router.mjs";

test("buildRetryPlan reroutes a usage-limited worker to another ready worker", () => {
  const plan = buildRetryPlan({
    run: blockedRun({
      workerId: "codex-worker",
      privacyMode: "ask-before-api",
      supervision: { category: "usage-limit" },
    }),
    providerRegistry: registry([
      worker("codex-worker", "Codex", "ready"),
      worker("claude-worker", "Claude", "ready"),
      provider("ollama", "Ollama", "local", "configured", ["local-only"]),
    ]),
  });

  assert.equal(plan.available, true);
  assert.equal(plan.providerId, "claude-worker");
  assert.equal(plan.providerLabel, "Claude");
  assert.equal(plan.privacyMode, "ask-before-api");
  assert.equal(plan.reason, "codex-worker hit a usage limit; retry with Claude");
});

test("buildRetryPlan preserves local-only privacy and chooses a compatible local provider", () => {
  const plan = buildRetryPlan({
    run: blockedRun({
      workerId: "codex-worker",
      privacyMode: "local-only",
      supervision: { category: "worker-exit" },
    }),
    providerRegistry: registry([
      worker("claude-worker", "Claude", "ready"),
      provider("ollama", "Ollama", "local", "configured", ["local-only"]),
    ]),
  });

  assert.equal(plan.available, true);
  assert.equal(plan.providerId, "ollama");
  assert.equal(plan.privacyMode, "local-only");
});

test("buildRetryPlan rejects explicit providers that are not compatible", () => {
  const plan = buildRetryPlan({
    requestedProvider: "claude-worker",
    run: blockedRun({
      workerId: "codex-worker",
      privacyMode: "local-only",
      supervision: { category: "usage-limit" },
    }),
    providerRegistry: registry([
      worker("claude-worker", "Claude", "ready"),
    ]),
  });

  assert.equal(plan.available, false);
  assert.equal(plan.code, "provider_not_eligible");
  assert.match(plan.reason, /not eligible/);
});

test("buildRetryPlan refuses completed runs", () => {
  const plan = buildRetryPlan({
    run: { runId: "run-1", status: "done", goal: "finished" },
    providerRegistry: registry([worker("claude-worker", "Claude", "ready")]),
  });

  assert.equal(plan.available, false);
  assert.equal(plan.code, "run_not_retryable");
});

function blockedRun(overrides = {}) {
  return {
    runId: "run-1",
    goal: "Inspect README",
    status: "blocked",
    privacyMode: "ask-before-api",
    ...overrides,
  };
}

function registry(providers) {
  return {
    defaultProvider: "codex-worker",
    privacyMode: "ask-before-api",
    providers,
  };
}

function worker(id, label, state) {
  return provider(id, label, "subscription-worker", state, ["ask-before-api"]);
}

function provider(id, label, kind, readinessState, privacyModes) {
  return {
    id,
    label,
    kind,
    runnable: true,
    configured: true,
    privacyModes,
    readiness: { state: readinessState, detail: readinessState },
  };
}
