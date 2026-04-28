import { access } from "node:fs/promises";
import { join } from "node:path";
import { loadConfig } from "./config.mjs";
import {
  detectClaudeAuth,
  detectClaudeWorker,
  detectCodexWorker,
} from "./workers.mjs";

export async function runDoctor({
  workspace = process.cwd(),
  configPath,
  logPath = join(workspace, ".openharness-events.jsonl"),
  env = process.env,
  nodeVersion = process.version,
  checkOllama = defaultCheckOllama,
  checkCodex = detectCodexWorker,
  checkClaude = detectClaudeWorker,
  checkClaudeAuth = detectClaudeAuth,
} = {}) {
  const checks = [];

  checks.push({
    name: "node",
    ok: majorVersion(nodeVersion) >= 20,
    detail: nodeVersion,
  });

  checks.push(await configCheck(configPath, env));
  checks.push({
    name: "openai-key",
    ok: Boolean(env.OPENAI_API_KEY || env.OPENHARNESS_OPENAI_API_KEY),
    detail: env.OPENAI_API_KEY || env.OPENHARNESS_OPENAI_API_KEY
      ? "OPENAI_API_KEY is set"
      : "OPENAI_API_KEY is not set",
  });

  const ollama = await checkOllama();
  checks.push({
    name: "ollama",
    ok: ollama.ok,
    detail: ollama.detail,
  });

  const codex = await checkCodex();
  checks.push({
    name: "codex",
    ok: codex.available,
    detail: codex.detail || `${codex.command} unavailable`,
  });

  const claude = await checkClaude();
  checks.push({
    name: "claude",
    ok: claude.available,
    detail: claude.detail || `${claude.command} unavailable`,
  });

  const claudeAuth = await checkClaudeAuth();
  checks.push({
    name: "claude-auth",
    ok: claudeAuth.available,
    detail: claudeAuth.detail || `${claudeAuth.command} auth unavailable`,
  });

  checks.push(await existsCheck("git", join(workspace, ".git")));
  checks.push(await existsCheck("audit-log", logPath));

  return checks;
}

export function formatDoctorReport(checks) {
  return [
    "OpenHarness doctor",
    ...checks.map((check) => {
      const label = check.ok ? "ok" : "warn";
      return `[${label}] ${check.name} ${check.detail}`;
    }),
  ].join("\n") + "\n";
}

async function configCheck(configPath, env) {
  if (!configPath) {
    return {
      name: "config",
      ok: true,
      detail: "using defaults",
    };
  }

  try {
    await loadConfig(configPath, { env });
    return {
      name: "config",
      ok: true,
      detail: `loaded ${configPath.split("/").at(-1)}`,
    };
  } catch (error) {
    return {
      name: "config",
      ok: false,
      detail: error.message,
    };
  }
}

async function existsCheck(name, path) {
  try {
    await access(path);
    return { name, ok: true, detail: path };
  } catch {
    return { name, ok: false, detail: `${path} not found` };
  }
}

async function defaultCheckOllama() {
  try {
    const response = await fetch("http://127.0.0.1:11434/api/tags");
    return {
      ok: response.ok,
      detail: response.ok ? "reachable at 127.0.0.1:11434" : `HTTP ${response.status}`,
    };
  } catch (error) {
    return {
      ok: false,
      detail: error.message,
    };
  }
}

function majorVersion(version) {
  return Number(version.replace(/^v/, "").split(".")[0]);
}
