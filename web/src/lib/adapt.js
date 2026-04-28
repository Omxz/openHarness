// Maps the backend Run summary (src/runs.mjs) into the shape the UI renders.
// Backend uses runId/createdAt/completedAt/providerId/workerId; the UI's
// templates were written against the design handoff names. This file is the
// single seam where those two vocabularies meet.

export function adaptRun(r) {
  if (!r) return null;
  const events = r.events ?? [];
  const pending = derivePendingApproval(r, events);
  return {
    id: r.runId,
    startedAt: r.createdAt,
    endedAt: r.completedAt,
    status: r.status,
    goal: r.goal,
    provider: r.providerId ?? r.workerId ?? null,
    model: deriveModel(events),
    config: null,
    eventCount: r.eventCount,
    durationMs: r.durationMs,
    exitCode: r.verification?.exitCode ?? null,
    reason: deriveReason(events, r.status),
    final: r.final,
    verification: r.verification ?? null,
    pendingApproval: pending.pending,
    pendingApprovalTool: pending.toolName,
    events,
  };
}

export function adaptRuns(runs) {
  return (runs ?? []).map(adaptRun);
}

// Returns the data needed to render the pending-approval indicator, or null
// when nothing is awaiting a decision. Read-only: the dashboard surfaces this
// signal but the user must approve from the CLI.
export function pendingApprovalIndicator(run) {
  if (!run?.pendingApproval) return null;
  const tool = run.pendingApprovalTool ?? "tool";
  return {
    label: "pending approval",
    tool,
    detail: `awaiting CLI decision for ${tool}`,
  };
}

function deriveModel(events) {
  for (const ev of events) {
    const m = ev?.data?.model ?? ev?.data?.response?.model;
    if (m) return m;
  }
  return null;
}

function derivePendingApproval(run, events) {
  if (typeof run.pendingApproval === "boolean") {
    return {
      pending: run.pendingApproval,
      toolName: run.pendingApprovalTool ?? null,
    };
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== "approval.requested") continue;
    const toolName = ev.data?.toolName ?? null;
    const decided = events
      .slice(i + 1)
      .find(
        (later) =>
          later?.type === "approval.decided" &&
          (toolName ? later.data?.toolName === toolName : true),
      );
    if (!decided) {
      return { pending: true, toolName };
    }
  }
  return { pending: false, toolName: null };
}

function deriveReason(events, status) {
  if (status !== "blocked" && status !== "failed") return null;
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === "approval.decided" && ev.data?.action === "needs-approval") {
      return `awaiting approval for ${ev.data.toolName ?? "tool"} (${ev.data.risk ?? "?"} risk)`;
    }
  }
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type === "task.done" && ev.data?.status === "blocked") {
      return ev.data?.reason ?? "task blocked";
    }
  }
  return null;
}
