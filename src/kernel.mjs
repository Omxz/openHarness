import { randomUUID } from "node:crypto";
import { appendEvent, createEvent } from "./audit-log.mjs";
import { createPolicy } from "./policy.mjs";
import { runVerifier } from "./verifier.mjs";

export async function runTask({
  goal,
  workspace,
  logPath,
  privacyMode = "ask-before-api",
  provider,
  tools,
  verifier,
  approvals,
}) {
  const task = {
    id: randomUUID(),
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

  for (let step = 0; step < 8; step += 1) {
    const modelResponse = await provider.complete({ task, transcript, tools });
    await log(logPath, {
      taskId: task.id,
      actor: "model",
      type: "model.response",
      data: { providerId: provider.id, response: modelResponse },
    });

    if (modelResponse.type === "final") {
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
      throw new Error(`Unsupported model response type "${modelResponse.type}"`);
    }

    const tool = tools[modelResponse.toolName];
    if (!tool) {
      throw new Error(`Unknown tool "${modelResponse.toolName}"`);
    }

    await log(logPath, {
      taskId: task.id,
      actor: "system",
      type: "tool.started",
      data: { toolName: tool.name, input: modelResponse.input },
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
  goal,
  workspace,
  logPath,
  privacyMode = "ask-before-api",
  worker,
  verifier,
}) {
  const task = {
    id: randomUUID(),
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
  await log(logPath, {
    taskId: task.id,
    actor: "system",
    type: "worker.started",
    data: { workerId: worker.id },
  });

  const workerResult = await worker.runTask({ task });
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

async function log(logPath, event) {
  await appendEvent(logPath, createEvent(event));
}
