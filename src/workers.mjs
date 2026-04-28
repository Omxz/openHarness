import { spawn } from "node:child_process";

export function createCodexWorkerProvider({
  id = "codex-worker",
  command = "codex",
  args = [
    "exec",
    "--json",
    "--color",
    "never",
    "--sandbox",
    "workspace-write",
    "--skip-git-repo-check",
  ],
  model,
  profile,
  runProcess: processRunner = runProcess,
} = {}) {
  return {
    id,
    capabilities: {
      delegatedTasks: true,
      usesSubscriptionAuth: true,
      rawCompletion: false,
    },
    async runTask({ task }) {
      const prompt = buildCodexPrompt(task);
      const finalArgs = [
        ...args,
        ...(model ? ["-m", model] : []),
        ...(profile ? ["-p", profile] : []),
        "--cd",
        task.workspace,
        "-",
      ];
      const result = await processRunner(command, finalArgs, {
        cwd: task.workspace,
        input: prompt,
      });
      const output = (result.stdout || result.stderr || "").trim();

      return {
        workerId: id,
        command,
        args: finalArgs,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        output,
      };
    },
  };
}

export function createClaudeWorkerProvider({
  id = "claude-worker",
  command = "claude",
  args = ["-p", "--output-format", "text", "--permission-mode", "dontAsk"],
  model,
  permissionMode,
  runProcess: processRunner = runProcess,
} = {}) {
  return {
    id,
    capabilities: {
      delegatedTasks: true,
      usesSubscriptionAuth: true,
      rawCompletion: false,
    },
    async runTask({ task }) {
      const prompt = buildClaudePrompt(task);
      const finalArgs = [
        ...args,
        ...(model ? ["--model", model] : []),
        ...(permissionMode ? ["--permission-mode", permissionMode] : []),
        prompt,
      ];
      const result = await processRunner(command, finalArgs, {
        cwd: task.workspace,
      });
      const output = (result.stdout || result.stderr || "").trim();

      return {
        workerId: id,
        command,
        args: finalArgs,
        exitCode: result.exitCode,
        stdout: result.stdout,
        stderr: result.stderr,
        output,
      };
    },
  };
}

export async function detectCodexWorker({
  command = "codex",
  runProcess: processRunner = runProcess,
} = {}) {
  const result = await processRunner(command, ["--version"], { cwd: process.cwd() });
  const detail = (result.stdout || result.stderr || "").trim();

  return {
    available: result.exitCode === 0,
    command,
    detail,
  };
}

export async function detectClaudeWorker({
  command = "claude",
  runProcess: processRunner = runProcess,
} = {}) {
  const result = await processRunner(command, ["--version"], { cwd: process.cwd() });
  const detail = (result.stdout || result.stderr || "").trim();

  return {
    available: result.exitCode === 0,
    command,
    detail,
  };
}

export async function detectClaudeAuth({
  command = "claude",
  runProcess: processRunner = runProcess,
} = {}) {
  const result = await processRunner(command, ["auth", "status"], {
    cwd: process.cwd(),
  });
  const detail = (result.stdout || result.stderr || "").trim();
  const status = parseJson(detail);

  if (status?.loggedIn) {
    return {
      available: true,
      command,
      detail: `logged in via ${status.authMethod ?? "unknown auth"}`,
    };
  }

  return {
    available: false,
    command,
    detail: status ? "not logged in" : detail || `${command} auth status unavailable`,
  };
}

export function runProcess(command, args, { cwd, input } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (exitCode) => {
      resolve({
        exitCode,
        stdout,
        stderr,
      });
    });

    if (input) {
      child.stdin.write(input);
    }
    child.stdin.end();
  });
}

function buildCodexPrompt(task) {
  return [
    "OpenHarness delegated task",
    "",
    `Task id: ${task.id}`,
    `Goal: ${task.goal}`,
    `Workspace: ${task.workspace}`,
    `Privacy mode: ${task.privacyMode}`,
    "",
    "Work only inside the scoped workspace. Return a concise final summary of what happened.",
  ].join("\n");
}

function buildClaudePrompt(task) {
  return [
    "OpenHarness delegated task",
    "",
    `Task id: ${task.id}`,
    `Goal: ${task.goal}`,
    `Workspace: ${task.workspace}`,
    `Privacy mode: ${task.privacyMode}`,
    "",
    "Work only inside the scoped workspace. Return a concise final summary of what happened.",
  ].join("\n");
}

function parseJson(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
