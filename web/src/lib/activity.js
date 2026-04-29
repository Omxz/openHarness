const MAX_ACTIVITY_CARDS = 10;
const MAX_DETAIL_LENGTH = 180;

export function buildActivityCards(run) {
  const cards = [];
  const events = run?.events ?? [];

  for (const event of events) {
    if (event.type === "task.created") {
      cards.push(card(event, "task", "Task queued", event.data?.goal, "idle"));
    } else if (event.type === "worker.started") {
      cards.push(card(event, "worker", "Worker started", event.data?.workerId, "active"));
    } else if (event.type === "worker.output") {
      cards.push(...cardsFromWorkerOutput(event));
    } else if (event.type === "worker.finished") {
      const exitCode = event.data?.result?.exitCode;
      cards.push(
        card(
          event,
          "done",
          "Worker finished",
          exitCode == null ? event.data?.workerId : `exit ${exitCode}`,
          exitCode === 0 ? "ok" : "warn",
        ),
      );
    } else if (event.type === "verification.finished") {
      const exitCode = event.data?.result?.exitCode;
      cards.push(
        card(
          event,
          "verify",
          exitCode === 0 ? "Verification passed" : "Verification failed",
          exitCode == null ? null : `exit ${exitCode}`,
          exitCode === 0 ? "ok" : "warn",
        ),
      );
    } else if (event.type === "task.cancelled") {
      cards.push(card(event, "cancelled", "Run cancelled", event.data?.reason, "warn"));
    } else if (event.type === "task.done") {
      const status = event.data?.status ?? run?.status;
      cards.push(
        card(
          event,
          "done",
          status === "done" ? "Run completed" : "Run blocked",
          status,
          status === "done" ? "ok" : "warn",
        ),
      );
    }
  }

  return cards
    .slice(-MAX_ACTIVITY_CARDS)
    .map((activity, index) => ({ ...activity, id: `${activity.id}:${index}` }));
}

function cardsFromWorkerOutput(event) {
  const stream = event.data?.stream;
  const chunk = typeof event.data?.chunk === "string" ? event.data.chunk : "";
  if (!chunk) return [];

  const lines = chunk
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines.map((line) => {
    if (stream === "stderr") {
      return stderrCard(event, line);
    }

    const parsed = parseJsonLine(line);
    if (parsed) {
      return jsonActivityCard(event, parsed);
    }

    return card(event, "output", "Output", line, "idle");
  });
}

function stderrCard(event, line) {
  const clean = stripLogPrefix(line);
  const isError = /\berror\b/i.test(line);
  const isWarning = /\bwarn(?:ing)?\b/i.test(line);

  if (isError) {
    return card(event, "error", "Worker error", clean, "err");
  }
  if (isWarning) {
    return card(event, "warning", "Worker warning", clean, "warn");
  }
  return card(event, "stderr", "Worker stderr", clean, "warn");
}

function jsonActivityCard(event, payload) {
  const type = payload.type ?? payload.event ?? "event";
  const itemType = payload.item?.type ?? payload.data?.type ?? "";
  const command =
    payload.command ??
    payload.item?.command ??
    payload.data?.command ??
    payload.args?.join?.(" ");

  if (type === "thread.started") {
    return card(event, "session", "Session started", payload.thread_id, "idle");
  }
  if (type === "turn.started") {
    return card(event, "planning", "Planning", "worker is preparing a response", "active");
  }
  if (type === "error" || type.includes(".error")) {
    return card(event, "error", "Worker error", errorDetail(payload) ?? type, "err");
  }
  if (type === "turn.failed" || type.includes(".failed")) {
    return card(event, "error", "Turn failed", errorDetail(payload) ?? type, "err");
  }
  if (
    command ||
    type.includes("command") ||
    itemType.includes("command")
  ) {
    return card(event, "command", "Running command", command ?? type, "active");
  }
  if (type.includes("file") || itemType.includes("file")) {
    return card(event, "file", "Using files", type, "active");
  }
  if (type === "turn.completed" || type === "turn.finished") {
    return card(event, "done", "Turn finished", null, "ok");
  }

  return card(event, "event", "Worker event", type, "idle");
}

function card(event, kind, title, detail, tone) {
  return {
    id: `${event.timestamp ?? "event"}:${kind}:${title}:${String(detail ?? "")}`,
    kind,
    title,
    detail: clip(detail),
    tone,
    timestamp: event.timestamp ?? null,
  };
}

function parseJsonLine(line) {
  if (!line.startsWith("{") || !line.endsWith("}")) return null;
  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}

function stripLogPrefix(line) {
  return line.replace(
    /^\d{4}-\d{2}-\d{2}T[\d:.]+Z?\s+(?:WARN|WARNING|ERROR|INFO|DEBUG)\s+[\w:.-]+:\s*/i,
    "",
  );
}

function errorDetail(payload) {
  return textValue(
    payload.message ??
      payload.error?.message ??
      payload.error?.code ??
      payload.error?.type ??
      payload.error,
  );
}

function textValue(value) {
  if (value == null || value === "") return null;
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function clip(value) {
  if (value == null || value === "") return null;
  const text = String(value);
  return text.length > MAX_DETAIL_LENGTH
    ? `${text.slice(0, MAX_DETAIL_LENGTH - 1)}...`
    : text;
}
