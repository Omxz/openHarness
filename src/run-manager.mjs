import { randomUUID } from "node:crypto";

import { appendEvent, createEvent } from "./audit-log.mjs";
import { normalizeConfig } from "./config.mjs";
import { runTask } from "./kernel.mjs";
import {
  createOllamaProvider,
  createOpenAICompatibleProvider,
  createScriptedProvider,
} from "./providers.mjs";
import { createDefaultTools } from "./tools.mjs";

const API_RUN_PROVIDERS = new Set(["scripted", "openai-compatible", "ollama"]);

export function createRunManager({
  workspace = process.cwd(),
  logPath,
  config = normalizeConfig({}),
  verifier = { command: "node", args: ["--version"] },
  tools = createDefaultTools(),
} = {}) {
  if (!logPath) {
    throw new Error("createRunManager requires logPath");
  }

  const activeRuns = new Map();

  return {
    startRun(input = {}) {
      const request = normalizeRunRequest(input, config);
      const runId = randomUUID();
      const provider = createProvider(request.provider, config, request.goal);

      activeRuns.set(runId, {
        runId,
        status: "running",
        goal: request.goal,
        providerId: provider.id,
      });

      const promise = runTask({
        taskId: runId,
        goal: request.goal,
        workspace,
        logPath,
        privacyMode: request.privacyMode,
        provider,
        tools,
        verifier,
      })
        .then((result) => {
          activeRuns.set(runId, {
            runId,
            status: result.status,
            goal: request.goal,
            providerId: result.providerId,
          });
          return result;
        })
        .catch(async (error) => {
          activeRuns.set(runId, {
            runId,
            status: "blocked",
            goal: request.goal,
            providerId: provider.id,
            error: error.message,
          });
          await appendEvent(
            logPath,
            createEvent({
              taskId: runId,
              actor: "system",
              type: "task.done",
              data: {
                status: "blocked",
                reason: error.message,
              },
            }),
          );
        });

      return {
        runId,
        status: "running",
        providerId: provider.id,
        promise,
      };
    },
    getActiveRuns() {
      return Array.from(activeRuns.values());
    },
  };
}

function normalizeRunRequest(input, config) {
  const goal = typeof input.goal === "string" ? input.goal.trim() : "";
  if (!goal) {
    throw requestError("goal must be a non-empty string");
  }

  const provider = input.provider ?? defaultApiProvider(config.provider);
  if (!API_RUN_PROVIDERS.has(provider)) {
    throw requestError(`Unsupported run provider "${provider}"`);
  }

  return {
    goal,
    provider,
    privacyMode:
      typeof input.privacyMode === "string" && input.privacyMode.trim()
        ? input.privacyMode.trim()
        : config.privacyMode,
  };
}

function defaultApiProvider(provider) {
  return API_RUN_PROVIDERS.has(provider) ? provider : "scripted";
}

function createProvider(providerName, config, goal) {
  if (providerName === "scripted") {
    return createScriptedProvider({
      id: "cli:scripted",
      responses: [
        {
          type: "final",
          content: `Scripted provider received: ${goal}`,
        },
      ],
    });
  }

  if (providerName === "openai-compatible") {
    return createOpenAICompatibleProvider(config.providers["openai-compatible"]);
  }

  if (providerName === "ollama") {
    return createOllamaProvider(config.providers.ollama);
  }

  throw requestError(`Unsupported run provider "${providerName}"`);
}

function requestError(message) {
  const error = new Error(message);
  error.code = "invalid_request";
  return error;
}
