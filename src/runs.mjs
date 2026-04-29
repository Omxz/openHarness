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
  const cancelled = orderedEvents.find((event) => event.type === "task.cancelled");
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
  const completedAt = cancelled?.timestamp ?? completed?.timestamp ?? null;
  const pending = derivePendingApproval(orderedEvents);
  const status = cancelled
    ? "cancelled"
    : completed?.data?.status ?? "running";
  const partial = derivePartialWorkerOutput(orderedEvents);

  return {
    runId,
    goal: created?.data?.goal ?? null,
    providerId,
    workerId,
    status,
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
    partialStdout: partial.stdout,
    partialStderr: partial.stderr,
    partialStdoutTruncated: partial.stdoutTruncated,
    partialStderrTruncated: partial.stderrTruncated,
    eventCount: orderedEvents.length,
    events: orderedEvents,
  };
}

// Per-stream aggregation cap. Unbounded growth is risky for long-running
// workers that page huge JSON streams; once the cap is hit we stop appending
// further chunks but mark the stream truncated so the UI can warn the user.
// The full output is still recorded inside the worker.finished event.
const PARTIAL_OUTPUT_CAP_BYTES = 64 * 1024;

function derivePartialWorkerOutput(events) {
  let stdout = "";
  let stderr = "";
  let stdoutTruncated = false;
  let stderrTruncated = false;

  for (const event of events) {
    if (event.type !== "worker.output") continue;
    const stream = event.data?.stream;
    const chunk = typeof event.data?.chunk === "string" ? event.data.chunk : "";
    if (!chunk) continue;

    if (stream === "stdout") {
      if (stdout.length >= PARTIAL_OUTPUT_CAP_BYTES) {
        stdoutTruncated = true;
        continue;
      }
      const remaining = PARTIAL_OUTPUT_CAP_BYTES - stdout.length;
      if (chunk.length > remaining) {
        stdout += chunk.slice(0, remaining);
        stdoutTruncated = true;
      } else {
        stdout += chunk;
      }
    } else if (stream === "stderr") {
      if (stderr.length >= PARTIAL_OUTPUT_CAP_BYTES) {
        stderrTruncated = true;
        continue;
      }
      const remaining = PARTIAL_OUTPUT_CAP_BYTES - stderr.length;
      if (chunk.length > remaining) {
        stderr += chunk.slice(0, remaining);
        stderrTruncated = true;
      } else {
        stderr += chunk;
      }
    }
  }

  return { stdout, stderr, stdoutTruncated, stderrTruncated };
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
