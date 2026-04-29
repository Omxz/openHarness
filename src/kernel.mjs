import { randomUUID } from "node:crypto";
import { appendEvent, createEvent } from "./audit-log.mjs";
import { createPolicy } from "./policy.mjs";
import { runVerifier } from "./verifier.mjs";

export async function runTask({
  taskId = randomUUID(),
  goal,
  workspace,
  logPath,
  privacyMode = "ask-before-api",
  provider,
  tools,
  verifier,
  approvals,
  approveToolUse = defaultApproveToolUse,
  signal,
}) {
  const task = {
    id: taskId,
    goal,
    workspace,
    privacyMode,
    status: "running",
  };
  const policy = createPolicy({ workspace, approvals });
  const transcript = [{ role: "user", content: goal }];

  await log(logPath, {
    taskId: task.id,
    actor: "user",
    type: "task.created",
    data: { goal, workspace, privacyMode, providerId: provider.id },
  });

  if (signal?.aborted) {
    return finishCancelled({ logPath, taskId: task.id, providerId: provider.id, signal });
  }

  for (let step = 0; step < 8; step += 1) {
    let modelResponse;
    try {
      modelResponse = await provider.complete({ task, transcript, tools, signal });
    } catch (error) {
      if (signal?.aborted) {
        return finishCancelled({
          logPath,
          taskId: task.id,
          providerId: provider.id,
          signal,
        });
      }
      throw error;
    }

    if (signal?.aborted) {
      return finishCancelled({
        logPath,
        taskId: task.id,
        providerId: provider.id,
        signal,
      });
    }

    if (modelResponse.type === "final") {
      await log(logPath, {
        taskId: task.id,
        actor: "model",
        type: "model.response",
        data: { providerId: provider.id, response: modelResponse },
      });

      if (signal?.aborted) {
        return finishCancelled({
          logPath,
          taskId: task.id,
          providerId: provider.id,
          signal,
        });
      }

      const verification = await runVerifier(verifier, { workspace });
      await log(logPath, {
        taskId: task.id,
        actor: "system",
        type: "verification.finished",
        data: { result: verification },
      });

      const status = verification.exitCode === 0 ? "done" : "blocked";
      await log(logPath, {
        taskId: task.id,
        actor: "system",
        type: "task.done",
        data: { status },
      });

      return {
        taskId: task.id,
        status,
        providerId: provider.id,
        final: modelResponse.content,
        verification,
      };
    }

    if (modelResponse.type !== "tool_call") {
      await log(logPath, {
        taskId: task.id,
        actor: "model",
        type: "model.response",
        data: { providerId: provider.id, response: modelResponse },
      });
      throw new Error(`Unsupported model response type "${modelResponse.type}"`);
    }

    const tool = tools[modelResponse.toolName];
    if (!tool) {
      throw new Error(`Unknown tool "${modelResponse.toolName}"`);
    }

    const auditInput = auditToolInput(tool, modelResponse.input);
    await log(logPath, {
      taskId: task.id,
      actor: "model",
      type: "model.response",
      data: {
        providerId: provider.id,
        response: {
          ...modelResponse,
          input: auditInput,
        },
      },
    });

    const initialDecision = policy.decideToolUse(tool, modelResponse.input);
    let approvalDecision;
    let approvalId = null;
    if (initialDecision.action === "needs-approval") {
      approvalId = randomUUID();
      await log(logPath, {
        taskId: task.id,
        actor: "system",
        type: "approval.requested",
        data: {
          approvalId,
          toolName: tool.name,
          risk: tool.risk,
          reason: initialDecision.reason,
          input: auditInput,
        },
      });
      approvalDecision = await approveToolUse({
        task,
        tool,
        input: modelResponse.input,
        auditInput,
        decision: initialDecision,
        approvalId,
      });
    } else {
      approvalDecision = initialDecision;
    }
    policy.recordApproval(approvalDecision);
    await log(logPath, {
      taskId: task.id,
      actor: "system",
      type: "approval.decided",
      data: approvalId ? { ...approvalDecision, approvalId } : approvalDecision,
    });

    if (approvalDecision.action === "cancelled") {
      return finishCancelled({
        logPath,
        taskId: task.id,
        providerId: provider.id,
        signal,
        reason: approvalDecision.reason,
      });
    }

    if (signal?.aborted) {
      return finishCancelled({
        logPath,
        taskId: task.id,
        providerId: provider.id,
        signal,
      });
    }

    if (approvalDecision.action !== "allow") {
      if (approvalDecision.action === "deny") {
        throw new Error(`Tool "${tool.name}" with ${tool.risk} risk is denied`);
      }

      throw new Error(`Tool "${tool.name}" with ${tool.risk} risk requires approval`);
    }

    await log(logPath, {
      taskId: task.id,
      actor: "system",
      type: "tool.started",
      data: { toolName: tool.name, input: auditInput },
    });

    const result = await tool.run(modelResponse.input, { task, workspace, policy });
    await log(logPath, {
      taskId: task.id,
      actor: "tool",
      type: "tool.finished",
      data: { toolName: tool.name, result },
    });

    transcript.push({
      role: "tool",
      name: tool.name,
      content: JSON.stringify(result),
    });
  }

  throw new Error("Task exceeded maximum orchestration steps");
}

export async function runWorkerTask({
  taskId = randomUUID(),
  goal,
  workspace,
  logPath,
  privacyMode = "ask-before-api",
  worker,
  verifier,
  signal,
}) {
  const task = {
    id: taskId,
    goal,
    workspace,
    privacyMode,
    status: "running",
  };

  await log(logPath, {
    taskId: task.id,
    actor: "user",
    type: "task.created",
    data: { goal, workspace, privacyMode, workerId: worker.id },
  });

  if (signal?.aborted) {
    await log(logPath, {
      taskId: task.id,
      actor: "system",
      type: "worker.cancelled",
      data: {
        workerId: worker.id,
        reason: signal.reason ?? "aborted-before-spawn",
        stage: "before-spawn",
      },
    });
    return cancelledResult(task, worker);
  }

  await log(logPath, {
    taskId: task.id,
    actor: "system",
    type: "worker.started",
    data: { workerId: worker.id },
  });

  let workerResult;
  try {
    workerResult = await worker.runTask({ task, signal });
  } catch (error) {
    if (error?.name === "AbortError" || signal?.aborted) {
      await log(logPath, {
        taskId: task.id,
        actor: "system",
        type: "worker.cancelled",
        data: {
          workerId: worker.id,
          reason: error?.message ?? signal?.reason ?? "aborted",
          stage: "during-run",
          partialStdout: error?.partialStdout ?? null,
          partialStderr: error?.partialStderr ?? null,
        },
      });
      return cancelledResult(task, worker);
    }
    throw error;
  }

  await log(logPath, {
    taskId: task.id,
    actor: "worker",
    type: "worker.finished",
    data: { workerId: worker.id, result: workerResult },
  });

  const verification = await runVerifier(verifier, { workspace });
  await log(logPath, {
    taskId: task.id,
    actor: "system",
    type: "verification.finished",
    data: { result: verification },
  });

  const status =
    workerResult.exitCode === 0 && verification.exitCode === 0 ? "done" : "blocked";
  await log(logPath, {
    taskId: task.id,
    actor: "system",
    type: "task.done",
    data: { status },
  });

  return {
    taskId: task.id,
    status,
    workerId: worker.id,
    final: workerResult.output,
    worker: workerResult,
    verification,
  };
}

function cancelledResult(task, worker) {
  return {
    taskId: task.id,
    status: "cancelled",
    workerId: worker.id,
    final: null,
    worker: null,
    verification: null,
  };
}

async function log(logPath, event) {
  await appendEvent(logPath, createEvent(event));
}

async function defaultApproveToolUse({ decision }) {
  return decision;
}

function auditToolInput(tool, input) {
  if (typeof tool.auditInput === "function") {
    return tool.auditInput(input);
  }

  return input;
}

async function finishCancelled({ logPath, taskId, providerId, signal, reason }) {
  const cancelReason = reason ?? cancelReasonFromSignal(signal);
  await log(logPath, {
    taskId,
    actor: "system",
    type: "task.cancelled",
    data: { reason: cancelReason },
  });
  return {
    taskId,
    status: "cancelled",
    providerId,
    reason: cancelReason,
  };
}

function cancelReasonFromSignal(signal) {
  if (!signal?.aborted) return "cancelled";
  const reason = signal.reason;
  if (typeof reason === "string") return reason;
  if (reason && typeof reason.message === "string") return reason.message;
  return "cancelled";
}
