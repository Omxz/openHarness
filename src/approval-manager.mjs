export function createApprovalManager() {
  const pending = new Map();

  function summarize(entry) {
    return {
      approvalId: entry.approvalId,
      runId: entry.runId,
      goal: entry.goal,
      toolName: entry.toolName,
      risk: entry.risk,
      reason: entry.reason,
      input: entry.auditInput,
      requestedAt: entry.requestedAt,
    };
  }

  function request(context) {
    const approvalId = context.approvalId;
    if (!approvalId) {
      throw new Error("createApprovalManager.request requires an approvalId");
    }

    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });

    const decision = context.decision ?? {};
    const tool = context.tool ?? {};
    const entry = {
      approvalId,
      runId: context.task?.id ?? context.runId ?? null,
      goal: context.task?.goal ?? null,
      toolName: tool.name ?? decision.toolName ?? null,
      risk: tool.risk ?? decision.risk ?? null,
      reason: decision.reason ?? null,
      input: context.input ?? null,
      auditInput: context.auditInput ?? context.input ?? null,
      decision,
      requestedAt: new Date().toISOString(),
      resolve,
      settled: false,
    };

    pending.set(approvalId, entry);

    return { promise, summary: summarize(entry) };
  }

  function settle(approvalId, action, reason) {
    const entry = pending.get(approvalId);
    if (!entry || entry.settled) {
      return { ok: false, code: "not_found" };
    }

    entry.settled = true;
    pending.delete(approvalId);
    entry.resolve({
      ...entry.decision,
      action,
      reason,
      approvalId,
    });
    return { ok: true, summary: summarize(entry) };
  }

  return {
    request,
    approve(approvalId, { reason } = {}) {
      return settle(approvalId, "allow", reason ?? "approved from dashboard");
    },
    deny(approvalId, { reason } = {}) {
      return settle(approvalId, "deny", reason ?? "denied from dashboard");
    },
    list() {
      return [...pending.values()].map(summarize);
    },
    has(approvalId) {
      return pending.has(approvalId);
    },
    async approveToolUse(context) {
      const { promise } = request(context);
      return promise;
    },
  };
}
