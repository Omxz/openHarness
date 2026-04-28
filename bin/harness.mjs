#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runTask } from "../src/kernel.mjs";
import { createScriptedProvider } from "../src/providers.mjs";
import { createDefaultTools } from "../src/tools.mjs";

const HELP = `Usage: harness <command>

Commands:
  demo      Run a local scripted harness task
  --help    Show this help text
`;

const command = process.argv[2] ?? "--help";

if (command === "--help" || command === "-h") {
  process.stdout.write(HELP);
  process.exit(0);
}

if (command === "demo") {
  const workspace = await mkdtemp(join(tmpdir(), "open-harness-demo-"));
  const logPath = join(workspace, "events.jsonl");
  await writeFile(join(workspace, "brief.txt"), "Build the kernel first.\n", "utf8");

  const provider = createScriptedProvider({
    id: "demo:scripted",
    responses: [
      {
        type: "tool_call",
        toolName: "readFile",
        input: { path: "brief.txt" },
      },
      {
        type: "final",
        content: "Read brief.txt and confirmed: Build the kernel first.",
      },
    ],
  });

  const result = await runTask({
    goal: "summarize the brief",
    workspace,
    logPath,
    privacyMode: "local-only",
    provider,
    tools: createDefaultTools(),
    verifier: {
      command: "node",
      args: ["--version"],
    },
  });

  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`provider: ${result.providerId}\n`);
  process.stdout.write(`final: ${result.final}\n`);
  process.stdout.write(`event log: ${logPath}\n`);
  process.exit(result.status === "done" ? 0 : 1);
}

process.stderr.write(`Unknown command: ${command}\n\n${HELP}`);
process.exit(1);
