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
  assert.deepEqual(config.providers.ollama, {
    type: "ollama",
    id: "ollama",
    baseUrl: "http://127.0.0.1:11434",
    model: "llama3.2",
  });
  assert.deepEqual(config.workers["codex-worker"], {
    type: "codex-worker",
    id: "codex-worker",
    command: "codex",
    args: [
      "exec",
      "--json",
      "--color",
      "never",
      "--sandbox",
      "workspace-write",
      "--skip-git-repo-check",
    ],
  });
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

test("loadConfig reads explicit Ollama config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-ollama-config-"));
  const configPath = join(dir, "openharness.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: "ollama",
        privacyMode: "local-only",
        providers: {
          ollama: {
            baseUrl: "http://localhost:11435",
            model: "qwen2.5-coder:7b",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const config = await loadConfig(configPath, { env: {} });

  assert.equal(config.provider, "ollama");
  assert.equal(config.privacyMode, "local-only");
  assert.deepEqual(config.providers.ollama, {
    type: "ollama",
    id: "ollama",
    baseUrl: "http://localhost:11435",
    model: "qwen2.5-coder:7b",
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

test("loadConfig reads explicit Codex worker config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "openharness-codex-config-"));
  const configPath = join(dir, "openharness.json");
  await writeFile(
    configPath,
    JSON.stringify(
      {
        provider: "codex-worker",
        workers: {
          "codex-worker": {
            command: "/usr/local/bin/codex",
            args: ["exec", "--json", "--sandbox", "read-only"],
            model: "gpt-5.4",
            profile: "work",
          },
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const config = await loadConfig(configPath, { env: {} });

  assert.equal(config.provider, "codex-worker");
  assert.deepEqual(config.workers["codex-worker"], {
    type: "codex-worker",
    id: "codex-worker",
    command: "/usr/local/bin/codex",
    args: ["exec", "--json", "--sandbox", "read-only"],
    model: "gpt-5.4",
    profile: "work",
  });
});
