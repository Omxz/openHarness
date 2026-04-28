#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, normalizeConfig } from "../src/config.mjs";
import { runTask } from "../src/kernel.mjs";
import {
  createOpenAICompatibleProvider,
  createScriptedProvider,
} from "../src/providers.mjs";
import { createDefaultTools } from "../src/tools.mjs";

const HELP = `Usage: harness <command>

Commands:
  demo                         Run a local scripted harness task
  run <goal> [--config path]   Run a goal through a configured provider
  --help                       Show this help text

Options:
  --provider <name>            Override config provider: scripted, openai-compatible
  --config <path>              Load OpenHarness JSON config
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

if (command === "run") {
  const parsed = parseRunArgs(process.argv.slice(3));
  const config = parsed.configPath
    ? await loadConfig(parsed.configPath)
    : normalizeConfig({});
  const providerName = parsed.provider ?? config.provider;
  const provider = createProvider(providerName, config, parsed.goal);
  const workspace = process.cwd();
  const logPath = join(workspace, ".openharness-events.jsonl");

  const result = await runTask({
    goal: parsed.goal,
    workspace,
    logPath,
    privacyMode: config.privacyMode,
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

function parseRunArgs(args) {
  const options = {};
  const goalParts = [];

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--provider") {
      options.provider = args[index + 1];
      index += 1;
    } else if (value === "--config") {
      options.configPath = args[index + 1];
      index += 1;
    } else {
      goalParts.push(value);
    }
  }

  const goal = goalParts.join(" ").trim();
  if (!goal) {
    process.stderr.write("Missing goal for run command\n\n");
    process.stderr.write(HELP);
    process.exit(1);
  }

  return { ...options, goal };
}

function createProvider(providerName, config, goal) {
  if (providerName === "scripted") {
    return createScriptedProvider({
      id: "cli:scripted",
      responses: [
        {
          type: "final",
          content: `Scripted provider received: ${goal}`,
        },
      ],
    });
  }

  if (providerName === "openai-compatible") {
    return createOpenAICompatibleProvider(config.providers["openai-compatible"]);
  }

  throw new Error(`Unsupported provider "${providerName}"`);
}
