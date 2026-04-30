import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeConfig } from "../src/config.mjs";
import { buildProviderRegistry } from "../src/provider-registry.mjs";

test("buildProviderRegistry exposes runnable providers without leaking API keys", async () => {
  const config = normalizeConfig(
    {
      provider: "claude-worker",
      privacyMode: "local-only",
      providers: {
        "openai-compatible": {
          model: "gpt-test",
          apiKey: "secret-key",
        },
        ollama: {
          model: "qwen2.5-coder",
        },
      },
    },
    { env: {} },
  );

  const registry = await buildProviderRegistry({
    config,
    workerHealth: async () => ({
      codex: {
        available: true,
        command: "codex",
        detail: "codex-cli 0.126.0",
      },
      claude: {
        available: true,
        authenticated: false,
        command: "claude",
        detail: "claude 2.1.121",
        authDetail: "not logged in",
      },
    }),
  });

  assert.equal(registry.defaultProvider, "claude-worker");
  assert.deepEqual(
    registry.providers.map((provider) => provider.id),
    ["scripted", "ollama", "openai-compatible", "codex-worker", "claude-worker"],
  );

  const openai = registry.providers.find((provider) => provider.id === "openai-compatible");
  assert.equal(openai.kind, "api");
  assert.equal(openai.model, "gpt-test");
  assert.equal(openai.configured, true);
  assert.equal(openai.readiness.state, "ready");
  assert.equal("apiKey" in openai, false);

  const codex = registry.providers.find((provider) => provider.id === "codex-worker");
  assert.equal(codex.kind, "subscription-worker");
  assert.equal(codex.readiness.state, "ready");
  assert.equal(codex.readiness.detail, "codex-cli 0.126.0");

  const claude = registry.providers.find((provider) => provider.id === "claude-worker");
  assert.equal(claude.kind, "subscription-worker");
  assert.equal(claude.readiness.state, "auth-required");
  assert.equal(claude.readiness.detail, "not logged in");
});

test("buildProviderRegistry marks API providers as needing configuration without credentials", async () => {
  const registry = await buildProviderRegistry({
    config: normalizeConfig({}, { env: {} }),
    workerHealth: async () => ({
      codex: { available: false, command: "codex", detail: "not found" },
      claude: { available: false, command: "claude", detail: "not found" },
    }),
  });

  const openai = registry.providers.find((provider) => provider.id === "openai-compatible");
  assert.equal(openai.configured, false);
  assert.equal(openai.readiness.state, "needs-config");
  assert.match(openai.readiness.detail, /API key/);

  const ollama = registry.providers.find((provider) => provider.id === "ollama");
  assert.equal(ollama.kind, "local");
  assert.equal(ollama.readiness.state, "configured");
});
