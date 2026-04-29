import { randomUUID } from "node:crypto";

import { createApprovalManager } from "./approval-manager.mjs";
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
  approvalManager = createApprovalManager(),
} = {}) {
  if (!logPath) {
    throw new Error("createRunManager requires logPath");
  }

  const activeRuns = new Map();
  const controllers = new Map();
  const pendingApprovalIds = new Map();
  const cancellations = new Map();

  function cleanup(runId) {
    controllers.delete(runId);
    pendingApprovalIds.delete(runId);
    cancellations.delete(runId);
  }

  return {
    approvalManager,
    startRun(input = {}) {
      const request = normalizeRunRequest(input, config);
      const runId = randomUUID();
      const provider = createProvider(request.provider, config, request.goal);
      const controller = new AbortController();
      controllers.set(runId, controller);

      activeRuns.set(runId, {
        runId,
        status: "running",
        goal: request.goal,
        providerId: provider.id,
      });

      const wrappedApprove = async (context) => {
        pendingApprovalIds.set(runId, context.approvalId);
        try {
          return await approvalManager.approveToolUse(context);
        } finally {
          pendingApprovalIds.delete(runId);
        }
      };

      const promise = runTask({
        taskId: runId,
        goal: request.goal,
        workspace,
        logPath,
        privacyMode: request.privacyMode,
        provider,
        tools,
        verifier,
        approveToolUse: wrappedApprove,
        signal: controller.signal,
      })
        .then((result) => {
          activeRuns.set(runId, {
            runId,
            status: result.status,
            goal: request.goal,
            providerId: result.providerId,
          });
          cleanup(runId);
          return result;
        })
        .catch(async (error) => {
          if (cancellations.has(runId) || controller.signal.aborted) {
            activeRuns.set(runId, {
              runId,
              status: "cancelled",
              goal: request.goal,
              providerId: provider.id,
              reason: cancellations.get(runId) ?? "cancelled",
            });
            await appendEvent(
              logPath,
              createEvent({
                taskId: runId,
                actor: "system",
                type: "task.cancelled",
                data: {
                  reason: cancellations.get(runId) ?? "cancelled",
                },
              }),
            );
            cleanup(runId);
            return;
          }

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
          cleanup(runId);
        });

      return {
        runId,
        status: "running",
        providerId: provider.id,
        promise,
      };
    },
    cancelRun(runId, options = {}) {
      const active = activeRuns.get(runId);
      const controller = controllers.get(runId);
      if (!active || !controller) {
        return { ok: false, code: "not_found" };
      }

      const reason =
        typeof options.reason === "string" && options.reason.trim()
          ? options.reason.trim()
          : "cancelled";
      cancellations.set(runId, reason);

      const approvalId = pendingApprovalIds.get(runId);
      if (approvalId && approvalManager.cancel) {
        approvalManager.cancel(approvalId, { reason });
      }

      controller.abort(reason);

      const updated = {
        ...active,
        status: "cancelled",
        reason,
      };
      activeRuns.set(runId, updated);

      return {
        ok: true,
        summary: {
          runId,
          status: "cancelled",
          goal: active.goal,
          providerId: active.providerId,
          reason,
        },
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
