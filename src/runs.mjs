import { readEvents } from "./audit-log.mjs";
import { formatEvents } from "./log-viewer.mjs";

export async function listRuns(logPath) {
  const events = await readRunEvents(logPath);
  return buildRuns(events).map(toRunSummary);
}

export async function getRun(logPath, runId) {
  const events = await readRunEvents(logPath);
  return buildRuns(events).find((run) => run.runId === runId) ?? null;
}

export function buildRuns(events) {
  const grouped = new Map();

  for (const event of events) {
    if (!event.taskId) {
      continue;
    }

    const runEvents = grouped.get(event.taskId) ?? [];
    runEvents.push(event);
    grouped.set(event.taskId, runEvents);
  }

  return [...grouped.entries()]
    .map(([runId, runEvents]) => summarizeRun(runId, runEvents))
    .sort((left, right) => compareTimestamps(right.createdAt, left.createdAt));
}

export function formatRunList(runs) {
  if (runs.length === 0) {
    return "No runs found.\n";
  }

  const lines = [
    "Run ID                               Status   Provider/Worker       Events  Created                  Goal",
    "------------------------------------ -------- --------------------- ------- ------------------------ ----",
    ...runs.map((run) =>
      [
        pad(run.runId, 36),
        pad(run.status, 8),
        pad(run.providerId ?? run.workerId ?? "-", 21),
        pad(String(run.eventCount), 7),
        pad(run.createdAt ?? "-", 24),
        run.goal ?? "-",
      ].join(" "),
    ),
  ];

  return `${lines.join("\n")}\n`;
}

export function formatRunDetail(run) {
  const provider = run.providerId ?? run.workerId ?? "-";
  const lines = [
    `Run ${run.runId}`,
    `status: ${run.status}`,
    `goal: ${run.goal ?? "-"}`,
    `provider: ${provider}`,
    `created: ${run.createdAt ?? "-"}`,
    `completed: ${run.completedAt ?? "-"}`,
    `durationMs: ${run.durationMs ?? "-"}`,
    `verification: ${run.verification?.exitCode ?? "none"}`,
  ];

  if (run.final) {
    lines.push("", "Final", run.final);
  }

  lines.push("", "Events", ...formatEvents(run.events));
  return `${lines.join("\n")}\n`;
}

function summarizeRun(runId, events) {
  const orderedEvents = [...events].sort((left, right) =>
    compareTimestamps(left.timestamp, right.timestamp),
  );
  const created = orderedEvents.find((event) => event.type === "task.created");
  const completed = orderedEvents.find((event) => event.type === "task.done");
  const verification = lastEventOfType(orderedEvents, "verification.finished");
  const modelFinal = [...orderedEvents]
    .reverse()
    .find(
      (event) =>
        event.type === "model.response" && event.data?.response?.type === "final",
    );
  const workerFinal = lastEventOfType(orderedEvents, "worker.finished");
  const providerId =
    created?.data?.providerId ??
    lastValue(orderedEvents, (event) => event.data?.providerId) ??
    null;
  const workerId =
    created?.data?.workerId ??
    lastValue(orderedEvents, (event) => event.data?.workerId) ??
    null;
  const createdAt = created?.timestamp ?? orderedEvents[0]?.timestamp ?? null;
  const completedAt = completed?.timestamp ?? null;
  const pending = derivePendingApproval(orderedEvents);

  return {
    runId,
    goal: created?.data?.goal ?? null,
    providerId,
    workerId,
    status: completed?.data?.status ?? "running",
    createdAt,
    completedAt,
    durationMs: calculateDurationMs(createdAt, completedAt),
    final:
      modelFinal?.data?.response?.content ??
      workerFinal?.data?.result?.output ??
      workerFinal?.data?.result?.stdout ??
      null,
    verification: verification?.data?.result ?? null,
    pendingApproval: pending.pending,
    pendingApprovalTool: pending.toolName,
    pendingApprovalId: pending.approvalId,
    eventCount: orderedEvents.length,
    events: orderedEvents,
  };
}

function derivePendingApproval(events) {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type !== "approval.requested") {
      continue;
    }

    const toolName = event.data?.toolName ?? null;
    const approvalId = event.data?.approvalId ?? null;
    const decided = events
      .slice(index + 1)
      .find(
        (later) =>
          later.type === "approval.decided" &&
          (approvalId
            ? later.data?.approvalId === approvalId
            : toolName
              ? later.data?.toolName === toolName
              : true),
      );

    if (!decided) {
      return { pending: true, toolName, approvalId };
    }
  }

  return { pending: false, toolName: null, approvalId: null };
}

function toRunSummary(run) {
  const { events, ...summary } = run;
  return summary;
}

async function readRunEvents(logPath) {
  try {
    return await readEvents(logPath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }

    throw error;
  }
}

function lastEventOfType(events, type) {
  return [...events].reverse().find((event) => event.type === type);
}

function lastValue(events, pickValue) {
  for (const event of [...events].reverse()) {
    const value = pickValue(event);
    if (value !== undefined && value !== null) {
      return value;
    }
  }

  return null;
}

function calculateDurationMs(createdAt, completedAt) {
  if (!createdAt || !completedAt) {
    return null;
  }

  return new Date(completedAt).getTime() - new Date(createdAt).getTime();
}

function compareTimestamps(left, right) {
  return new Date(left ?? 0).getTime() - new Date(right ?? 0).getTime();
}

function pad(value, width) {
  return value.length >= width ? value : `${value}${" ".repeat(width - value.length)}`;
}
