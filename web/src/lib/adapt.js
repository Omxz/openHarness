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
    pendingApprovalId: pending.approvalId,
    pendingApprovalDetails: pending.details,
    events,
  };
}

export function adaptRuns(runs) {
  return (runs ?? []).map(adaptRun);
}

// Returns "active" | "needs-you" | "recent" for a single run.
//
// This is the load-bearing product decision in the redesign — what counts as
// "happening right now" versus "needs human action" versus "history." The
// current rules are a sensible default; refine them based on how operators
// actually use the dashboard:
//   - Should runs that finished <30s ago linger in `active` so users see the
//     completion before the row drops to `recent`?
//   - Should `failed` go to `needs-you` (because someone should investigate)
//     or `recent` (because nothing they can do)?
//   - Are there other states (e.g. retrying) we should fold in?
export function attentionBucket(run) {
  if (!run) return "recent";
  if (run.pendingApproval) return "needs-you";
  if (run.status === "running") return "active";
  if (run.status === "blocked") return "needs-you";
  return "recent";
}

export function groupRunsByAttention(runs) {
  const groups = { active: [], "needs-you": [], recent: [] };
  for (const run of runs ?? []) {
    groups[attentionBucket(run)].push(run);
  }
  return groups;
}

export function attentionCounts(runs) {
  const groups = groupRunsByAttention(runs);
  return {
    active: groups.active.length,
    needsYou: groups["needs-you"].length,
    recent: groups.recent.length,
  };
}

// Returns the data needed to render the pending-approval indicator, or null
// when nothing is awaiting a decision.
export function pendingApprovalIndicator(run) {
  if (!run?.pendingApproval) return null;
  const tool = run.pendingApprovalTool ?? "tool";
  return {
    label: "pending approval",
    tool,
    detail: `awaiting decision for ${tool}`,
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
  const details = derivePendingApprovalDetails(events);

  if (typeof run.pendingApproval === "boolean") {
    return {
      pending: run.pendingApproval,
      toolName: run.pendingApprovalTool ?? null,
      approvalId: run.pendingApprovalId ?? details?.approvalId ?? null,
      details,
    };
  }

  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== "approval.requested") continue;
    const approvalId = ev.data?.approvalId ?? null;
    const toolName = ev.data?.toolName ?? null;
    const decided = events
      .slice(i + 1)
      .find(
        (later) =>
          later?.type === "approval.decided" &&
          (approvalId
            ? later.data?.approvalId === approvalId
            : toolName
              ? later.data?.toolName === toolName
              : true),
      );
    if (!decided) {
      return { pending: true, toolName, approvalId, details };
    }
  }
  return { pending: false, toolName: null, approvalId: null, details: null };
}

function derivePendingApprovalDetails(events) {
  for (let i = events.length - 1; i >= 0; i -= 1) {
    const ev = events[i];
    if (ev?.type !== "approval.requested") continue;
    const approvalId = ev.data?.approvalId ?? null;
    const toolName = ev.data?.toolName ?? null;
    const decided = events
      .slice(i + 1)
      .find(
        (later) =>
          later?.type === "approval.decided" &&
          (approvalId
            ? later.data?.approvalId === approvalId
            : toolName
              ? later.data?.toolName === toolName
              : true),
      );
    if (decided) continue;
    return {
      approvalId,
      toolName,
      risk: ev.data?.risk ?? null,
      reason: ev.data?.reason ?? null,
      input: ev.data?.input ?? null,
    };
  }
  return null;
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
