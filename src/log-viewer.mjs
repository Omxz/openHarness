import { readEvents } from "./audit-log.mjs";

export async function formatLogFile(logPath) {
  const events = await readEvents(logPath);
  return `${formatEvents(events).join("\n")}\n`;
}

export function formatEvents(events) {
  return events.map((event) => {
    const details = formatDetails(event);
    return [
      event.timestamp,
      event.actor,
      event.type,
      details,
    ].filter(Boolean).join(" ");
  });
}

function formatDetails(event) {
  const data = event.data ?? {};

  if (event.type === "task.created") {
    return [
      data.goal ? `goal="${data.goal}"` : "",
      data.providerId ? `provider=${data.providerId}` : "",
      data.workerId ? `worker=${data.workerId}` : "",
    ].filter(Boolean).join(" ");
  }

  if (event.type === "task.done") {
    return data.status ? `status=${data.status}` : "";
  }

  if (event.type === "tool.started" || event.type === "tool.finished") {
    return [
      data.toolName ? `tool=${data.toolName}` : "",
      data.result?.exitCode !== undefined ? `exit=${data.result.exitCode}` : "",
    ].filter(Boolean).join(" ");
  }

  if (event.type === "worker.started" || event.type === "worker.finished") {
    return [
      data.workerId ? `worker=${data.workerId}` : "",
      data.result?.exitCode !== undefined ? `exit=${data.result.exitCode}` : "",
    ].filter(Boolean).join(" ");
  }

  if (event.type === "verification.finished") {
    return data.result?.exitCode !== undefined ? `exit=${data.result.exitCode}` : "";
  }

  if (event.type === "approval.decided") {
    return [
      data.toolName ? `tool=${data.toolName}` : "",
      data.action ? `action=${data.action}` : "",
    ].filter(Boolean).join(" ");
  }

  if (event.type === "model.response") {
    return data.providerId ? `provider=${data.providerId}` : "";
  }

  return "";
}
