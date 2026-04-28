import { readFile } from "node:fs/promises";

const DEFAULT_OPENAI_BASE_URL = "https://api.openai.com/v1";
const DEFAULT_OPENAI_MODEL = "gpt-4.1-mini";
const DEFAULT_OLLAMA_BASE_URL = "http://127.0.0.1:11434";
const DEFAULT_OLLAMA_MODEL = "llama3.2";
const DEFAULT_CODEX_WORKER_ARGS = Object.freeze([
  "exec",
  "--json",
  "--color",
  "never",
  "--sandbox",
  "workspace-write",
  "--skip-git-repo-check",
]);

export async function loadConfig(configPath, { env = process.env } = {}) {
  const raw = JSON.parse(await readFile(configPath, "utf8"));
  return normalizeConfig(raw, { env });
}

export function normalizeConfig(raw = {}, { env = process.env } = {}) {
  const rawProviders = raw.providers ?? {};
  const rawWorkers = raw.workers ?? {};
  const openAI = normalizeOpenAICompatibleProvider(
    rawProviders["openai-compatible"] ?? {},
    env,
  );
  const ollama = normalizeOllamaProvider(rawProviders.ollama ?? {}, env);
  const codexWorker = normalizeCodexWorker(rawWorkers["codex-worker"] ?? {});

  return {
    provider: raw.provider ?? "scripted",
    privacyMode: raw.privacyMode ?? "ask-before-api",
    providers: {
      ...rawProviders,
      "openai-compatible": openAI,
      ollama,
    },
    workers: {
      ...rawWorkers,
      "codex-worker": codexWorker,
    },
  };
}

function normalizeOpenAICompatibleProvider(rawProvider, env) {
  const apiKeyEnv = rawProvider.apiKeyEnv;
  const envApiKey =
    (apiKeyEnv ? env[apiKeyEnv] : undefined) ??
    env.OPENHARNESS_OPENAI_API_KEY ??
    env.OPENAI_API_KEY;

  return {
    type: "openai-compatible",
    id: rawProvider.id ?? "openai-compatible",
    baseUrl:
      rawProvider.baseUrl ??
      env.OPENHARNESS_OPENAI_BASE_URL ??
      DEFAULT_OPENAI_BASE_URL,
    model:
      rawProvider.model ??
      env.OPENHARNESS_OPENAI_MODEL ??
      DEFAULT_OPENAI_MODEL,
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(rawProvider.apiKey ?? envApiKey
      ? { apiKey: rawProvider.apiKey ?? envApiKey }
      : {}),
  };
}

function normalizeOllamaProvider(rawProvider, env) {
  return {
    type: "ollama",
    id: rawProvider.id ?? "ollama",
    baseUrl:
      rawProvider.baseUrl ??
      env.OPENHARNESS_OLLAMA_BASE_URL ??
      DEFAULT_OLLAMA_BASE_URL,
    model:
      rawProvider.model ??
      env.OPENHARNESS_OLLAMA_MODEL ??
      DEFAULT_OLLAMA_MODEL,
  };
}

function normalizeCodexWorker(rawWorker) {
  return {
    type: "codex-worker",
    id: rawWorker.id ?? "codex-worker",
    command: rawWorker.command ?? "codex",
    args: rawWorker.args ?? [...DEFAULT_CODEX_WORKER_ARGS],
    ...(rawWorker.model ? { model: rawWorker.model } : {}),
    ...(rawWorker.profile ? { profile: rawWorker.profile } : {}),
  };
}
