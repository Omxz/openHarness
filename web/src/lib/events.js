// Categorize event for the timeline glyph/color, then summarize it as a one-line
// human caption. The backend emits these real types (see src/kernel.mjs):
//   task.created, task.done,
//   model.response,
//   tool.started, tool.finished,
//   approval.decided,
//   verification.finished,
//   worker.started, worker.finished,
//   provider.error (future).
// Payloads live under ev.data.*

export function eventKind(ev) {
  const t = ev.type ?? "";
  if (t.startsWith("task."))         return "task";
  if (t.startsWith("provider."))     return "provider";
  if (t.startsWith("worker."))       return "worker";
  if (t.startsWith("policy."))       return "policy";
  if (t.startsWith("approval."))     return "approval";
  if (t.startsWith("tool."))         return "tool";
  if (t.startsWith("model."))        return "model";
  if (t.startsWith("verification.")) return "verify";
  return "other";
}

export const KIND_GLYPH = {
  task: "▣",
  provider: "◆",
  worker: "◇",
  policy: "◈",
  approval: "✓",
  tool: "▸",
  model: "◷",
  verify: "⎔",
  other: "·",
};

// Draft summarizer. The plan flags this for your input — the field choices
// per event type are the dashboard's voice. The shape below is a working
// first pass against the real kernel events.
export function summarize(ev) {
  const d = ev?.data ?? {};
  switch (ev.type) {
    case "task.created":
      return d.goal ?? "(no goal)";
    case "task.done":
      return `status=${d.status ?? "?"}`;
    case "model.response": {
      const r = d.response ?? {};
      if (r.type === "final") return clip(r.content);
      if (r.type === "tool_call") return `→ ${r.toolName}`;
      return r.type ?? "—";
    }
    case "tool.started":
      return `${d.toolName ?? "?"} ${stringifyInput(d.input)}`;
    case "tool.finished": {
      const res = d.result ?? {};
      const bytes = res.bytes != null ? `  · ${res.bytes}B` : "";
      const exit = res.exitCode != null ? `  · exit ${res.exitCode}` : "";
      return `${d.toolName ?? "?"}${bytes}${exit}`;
    }
    case "approval.decided":
      return `${d.toolName ?? "?"} -> ${d.action ?? "?"}${d.risk ? ` · ${d.risk}` : ""}`;
    case "approval.requested":
      return `${d.toolName ?? "?"} pending${d.risk ? ` · ${d.risk}` : ""}`;
    case "verification.finished":
      return `exit ${d.result?.exitCode ?? "?"}`;
    case "worker.started":
      return d.workerId ?? "—";
    case "worker.finished": {
      const category = d.supervision?.category ? ` · ${d.supervision.category}` : "";
      return `${d.workerId ?? "?"}${category} · exit ${d.result?.exitCode ?? "?"}`;
    }
    case "worker.output":
      return `${d.stream ?? "stream"} · ${clip(d.chunk ?? "", 80)}`;
    case "provider.error":
      return `${d.code ?? "?"} ${d.message ?? ""}`;
    default:
      return clip(JSON.stringify(d));
  }
}

function clip(s, n = 120) {
  if (!s) return "—";
  return s.length > n ? s.slice(0, n) + "…" : s;
}

function stringifyInput(x) {
  if (x == null) return "";
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}
