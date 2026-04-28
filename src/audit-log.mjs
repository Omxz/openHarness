import { appendFile, readFile } from "node:fs/promises";

export function createEvent({ taskId, actor, type, data }) {
  return {
    taskId,
    timestamp: new Date().toISOString(),
    actor,
    type,
    data,
  };
}

export async function appendEvent(logPath, event) {
  await appendFile(logPath, `${JSON.stringify(event)}\n`, "utf8");
}

export async function readEvents(logPath) {
  const raw = await readFile(logPath, "utf8");
  return raw
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}
