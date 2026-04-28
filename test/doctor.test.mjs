import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import assert from "node:assert/strict";

import { formatDoctorReport, runDoctor } from "../src/doctor.mjs";

test("runDoctor reports local readiness checks", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "openharness-doctor-"));
  const configPath = join(workspace, "openharness.json");
  const logPath = join(workspace, ".openharness-events.jsonl");
  await mkdir(join(workspace, ".git"));
  await writeFile(
    configPath,
    JSON.stringify({
      provider: "ollama",
      providers: {
        ollama: { baseUrl: "http://ollama.test", model: "llama3.2" },
      },
    }),
    "utf8",
  );
  await writeFile(logPath, "", "utf8");

  const checks = await runDoctor({
    workspace,
    configPath,
    logPath,
    env: { OPENAI_API_KEY: "secret" },
    checkOllama: async () => ({ ok: true, detail: "reachable" }),
    checkCodex: async () => ({
      available: true,
      command: "codex",
      detail: "codex-cli 1.0.0",
    }),
    nodeVersion: "v20.19.0",
  });

  assert.deepEqual(checks.map((check) => [check.name, check.ok]), [
    ["node", true],
    ["config", true],
    ["openai-key", true],
    ["ollama", true],
    ["codex", true],
    ["git", true],
    ["audit-log", true],
  ]);
  assert.equal(checks[1].detail, "loaded openharness.json");
});

test("formatDoctorReport renders check statuses without exposing secrets", () => {
  const output = formatDoctorReport([
    { name: "node", ok: true, detail: "v20.19.0" },
    { name: "openai-key", ok: true, detail: "OPENAI_API_KEY is set" },
    { name: "ollama", ok: false, detail: "not reachable" },
  ]);

  assert.match(output, /\[ok\] node v20\.19\.0/);
  assert.match(output, /\[ok\] openai-key OPENAI_API_KEY is set/);
  assert.match(output, /\[warn\] ollama not reachable/);
  assert.doesNotMatch(output, /secret/);
});
