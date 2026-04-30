import { normalizeConfig } from "./config.mjs";

export async function buildProviderRegistry({
  config = normalizeConfig({}),
  workerHealth = async () => ({}),
} = {}) {
  const health = await safeWorkerHealth(workerHealth, { config });

  const providers = [
    scriptedProvider(config),
    ollamaProvider(config),
    openAICompatibleProvider(config),
    codexWorkerProvider(config, health.codex),
    claudeWorkerProvider(config, health.claude),
  ];

  return {
    defaultProvider: providers.some((provider) => provider.id === config.provider)
      ? config.provider
      : "scripted",
    privacyMode: config.privacyMode,
    providers,
  };
}

function scriptedProvider(config) {
  return {
    id: "scripted",
    label: "Scripted",
    type: "scripted",
    kind: "built-in",
    configured: true,
    runnable: true,
    selected: config.provider === "scripted",
    privacyModes: ["local-only"],
    capabilities: {
      chat: true,
      toolCalling: true,
      delegatedTasks: false,
      subscriptionAuth: false,
    },
    readiness: {
      state: "ready",
      detail: "built-in smoke-test provider",
    },
  };
}

function ollamaProvider(config) {
  const provider = config.providers?.ollama ?? {};

  return {
    id: "ollama",
    label: "Ollama",
    type: "ollama",
    kind: "local",
    configured: true,
    runnable: true,
    selected: config.provider === "ollama",
    baseUrl: provider.baseUrl,
    model: provider.model,
    privacyModes: ["local-only"],
    capabilities: {
      chat: true,
      toolCalling: false,
      delegatedTasks: false,
      subscriptionAuth: false,
    },
    readiness: {
      state: "configured",
      detail: provider.model ? `${provider.model} at ${provider.baseUrl}` : provider.baseUrl,
    },
  };
}

function openAICompatibleProvider(config) {
  const provider = config.providers?.["openai-compatible"] ?? {};
  const requiresApiKey = provider.baseUrl?.startsWith("https://api.openai.com/");
  const configured = Boolean(provider.apiKey) || !requiresApiKey;

  return {
    id: "openai-compatible",
    label: "OpenAI-compatible",
    type: "openai-compatible",
    kind: "api",
    configured,
    runnable: true,
    selected: config.provider === "openai-compatible",
    baseUrl: provider.baseUrl,
    model: provider.model,
    apiKeyEnv: provider.apiKeyEnv,
    privacyModes: ["ask-before-api", "api-allowed"],
    capabilities: {
      chat: true,
      toolCalling: false,
      delegatedTasks: false,
      subscriptionAuth: false,
    },
    readiness: configured
      ? {
          state: "ready",
          detail: provider.model ? `${provider.model} at ${provider.baseUrl}` : provider.baseUrl,
        }
      : {
          state: "needs-config",
          detail: "API key required for the default OpenAI endpoint",
        },
  };
}

function codexWorkerProvider(config, health) {
  const worker = config.workers?.["codex-worker"] ?? {};

  return {
    id: "codex-worker",
    label: "Codex",
    type: "codex-worker",
    kind: "subscription-worker",
    configured: true,
    runnable: true,
    selected: config.provider === "codex-worker",
    command: worker.command,
    model: worker.model,
    privacyModes: ["ask-before-api"],
    capabilities: {
      chat: false,
      toolCalling: false,
      delegatedTasks: true,
      subscriptionAuth: true,
    },
    readiness: workerReadiness(health, {
      missing: "codex CLI not detected",
      ready: health?.detail ?? "codex CLI detected",
    }),
  };
}

function claudeWorkerProvider(config, health) {
  const worker = config.workers?.["claude-worker"] ?? {};

  return {
    id: "claude-worker",
    label: "Claude",
    type: "claude-worker",
    kind: "subscription-worker",
    configured: true,
    runnable: true,
    selected: config.provider === "claude-worker",
    command: worker.command,
    model: worker.model,
    privacyModes: ["ask-before-api"],
    capabilities: {
      chat: false,
      toolCalling: false,
      delegatedTasks: true,
      subscriptionAuth: true,
    },
    readiness: claudeReadiness(health),
  };
}

function workerReadiness(health, { missing, ready }) {
  if (!health) {
    return { state: "unknown", detail: "readiness not checked" };
  }
  if (!health.available) {
    return { state: "unavailable", detail: health.detail || missing };
  }
  return { state: "ready", detail: ready };
}

function claudeReadiness(health) {
  if (!health) {
    return { state: "unknown", detail: "readiness not checked" };
  }
  if (!health.available) {
    return { state: "unavailable", detail: health.detail || "claude CLI not detected" };
  }
  if (health.authenticated === false) {
    return { state: "auth-required", detail: health.authDetail || "claude not signed in" };
  }
  return { state: "ready", detail: health.authDetail || health.detail || "claude ready" };
}

async function safeWorkerHealth(workerHealth, input) {
  try {
    return await workerHealth(input);
  } catch (error) {
    return {
      codex: { available: false, detail: error.message },
      claude: { available: false, detail: error.message },
    };
  }
}
