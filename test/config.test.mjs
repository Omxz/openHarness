import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { loadConfig, normalizeConfig } from "../src/config.mjs";

test("normalizeConfig provides safe defaults without API keys", () => {
  const config = normalizeConfig({}, { env: {} });

  assert.equal(config.provider, "scripted");
  assert.equal(config.privacyMode, "ask-before-api");
  assert.equal(config.providers["openai-compatible"].type, "openai-compatible");
  assert.equal(config.providers["openai-compatible"].baseUrl, "https://api.openai.com/v1");
  assert.equal(config.providers["openai-compatible"].model, "gpt-4.1-mini");
  assert.equal(config.providers["openai-compatible"].apiKey, undefined);
});

test("loadConfig reads JSON config and resolves provider API keys from env", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-config-"));
  const configPath = join(dir, "openharness.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: "openai-compatible",
        privacyMode: "api-allowed",
        providers: {
          "openai-compatible": {
            baseUrl: "http://127.0.0.1:9999/v1",
            model: "test-model",
            apiKeyEnv: "TEST_OPENAI_KEY",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const config = await loadConfig(configPath, {
    env: { TEST_OPENAI_KEY: "secret-key" },
  });

  assert.equal(config.provider, "openai-compatible");
  assert.equal(config.privacyMode, "api-allowed");
  assert.deepEqual(config.providers["openai-compatible"], {
    type: "openai-compatible",
    id: "openai-compatible",
    baseUrl: "http://127.0.0.1:9999/v1",
    model: "test-model",
    apiKeyEnv: "TEST_OPENAI_KEY",
    apiKey: "secret-key",
  });
});

test("normalizeConfig lets explicit provider config override environment defaults", () => {
  const config = normalizeConfig(
    {
      providers: {
        "openai-compatible": {
          baseUrl: "http://local.test/v1",
          model: "explicit-model",
          apiKey: "explicit-key",
        },
      },
    },
    {
      env: {
        OPENAI_API_KEY: "env-key",
        OPENHARNESS_OPENAI_MODEL: "env-model",
      },
    },
  );

  assert.equal(config.providers["openai-compatible"].baseUrl, "http://local.test/v1");
  assert.equal(config.providers["openai-compatible"].model, "explicit-model");
  assert.equal(config.providers["openai-compatible"].apiKey, "explicit-key");
});
