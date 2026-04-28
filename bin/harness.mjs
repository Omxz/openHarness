#!/usr/bin/env node

import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadConfig, normalizeConfig } from "../src/config.mjs";
import { formatDoctorReport, runDoctor } from "../src/doctor.mjs";
import { runTask, runWorkerTask } from "../src/kernel.mjs";
import { formatLogFile } from "../src/log-viewer.mjs";
import {
  createOllamaProvider,
  createOpenAICompatibleProvider,
  createScriptedProvider,
} from "../src/providers.mjs";
import { formatRunDetail, formatRunList, getRun, listRuns } from "../src/runs.mjs";
import { createDefaultTools } from "../src/tools.mjs";
import { createCodexWorkerProvider } from "../src/workers.mjs";

const HELP = `Usage: harness <command>

Commands:
  doctor [--config path]       Check local OpenHarness readiness
  demo                         Run a local scripted harness task
  run <goal> [--config path]   Run a goal through a configured provider
  runs [--json] [--log path]   List runs from the audit log
  show <run-id> [--json]       Show one run and its event timeline
  log <path>                   Pretty-print a JSONL audit log
  --help                       Show this help text

Options:
  --provider <name>            Override config provider: scripted, openai-compatible, ollama, codex-worker
  --config <path>              Load OpenHarness JSON config
  --log <path>                 Read a specific JSONL audit log
  --json                       Emit machine-readable JSON
`;

const command = process.argv[2] ?? "--help";

if (command === "--help" || command === "-h") {
  process.stdout.write(HELP);
  process.exit(0);
}

if (command === "doctor") {
  const parsed = parseOptionArgs(process.argv.slice(3));
  const checks = await runDoctor({
    workspace: process.cwd(),
    configPath: parsed.configPath,
  });
  process.stdout.write(formatDoctorReport(checks));
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
  process.stdout.write(`run: ${result.taskId}\n`);
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
  const workspace = process.cwd();
  const logPath = join(workspace, ".openharness-events.jsonl");
  const verifier = {
    command: "node",
    args: ["--version"],
  };
  const result =
    providerName === "codex-worker"
      ? await runWorkerTask({
          goal: parsed.goal,
          workspace,
          logPath,
          privacyMode: config.privacyMode,
          worker: createWorker(providerName, config),
          verifier,
        })
      : await runTask({
          goal: parsed.goal,
          workspace,
          logPath,
          privacyMode: config.privacyMode,
          provider: createProvider(providerName, config, parsed.goal),
          tools: createDefaultTools(),
          verifier,
        });

  process.stdout.write(`status: ${result.status}\n`);
  process.stdout.write(`run: ${result.taskId}\n`);
  process.stdout.write(`provider: ${result.providerId ?? result.workerId}\n`);
  process.stdout.write(`final: ${result.final}\n`);
  process.stdout.write(`event log: ${logPath}\n`);
  process.exit(result.status === "done" ? 0 : 1);
}

if (command === "runs") {
  const parsed = parseLogViewArgs(process.argv.slice(3));
  const runs = await listRuns(parsed.logPath ?? defaultLogPath());

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ runs }, null, 2)}\n`);
  } else {
    process.stdout.write(formatRunList(runs));
  }

  process.exit(0);
}

if (command === "show") {
  const parsed = parseLogViewArgs(process.argv.slice(3));
  const runId = parsed.positionals[0];
  if (!runId) {
    process.stderr.write("Missing run id for show command\n\n");
    process.stderr.write(HELP);
    process.exit(1);
  }

  const run = await getRun(parsed.logPath ?? defaultLogPath(), runId);
  if (!run) {
    process.stderr.write(`Run not found: ${runId}\n`);
    process.exit(1);
  }

  if (parsed.json) {
    process.stdout.write(`${JSON.stringify({ run }, null, 2)}\n`);
  } else {
    process.stdout.write(formatRunDetail(run));
  }

  process.exit(0);
}

if (command === "log") {
  const logPath = process.argv[3];
  if (!logPath) {
    process.stderr.write("Missing log path\n\n");
    process.stderr.write(HELP);
    process.exit(1);
  }

  process.stdout.write(await formatLogFile(logPath));
  process.exit(0);
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

function parseOptionArgs(args) {
  const options = {};

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--config") {
      options.configPath = args[index + 1];
      index += 1;
    }
  }

  return options;
}

function parseLogViewArgs(args) {
  const options = { json: false, positionals: [] };

  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--log") {
      options.logPath = args[index + 1];
      index += 1;
    } else if (value === "--json") {
      options.json = true;
    } else {
      options.positionals.push(value);
    }
  }

  return options;
}

function defaultLogPath() {
  return join(process.cwd(), ".openharness-events.jsonl");
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

  if (providerName === "ollama") {
    return createOllamaProvider(config.providers.ollama);
  }

  throw new Error(`Unsupported provider "${providerName}"`);
}

function createWorker(providerName, config) {
  if (providerName === "codex-worker") {
    return createCodexWorkerProvider(config.workers["codex-worker"]);
  }

  throw new Error(`Unsupported worker "${providerName}"`);
}
