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
    async runTask({ task, signal, onChunk } = {}) {
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
        signal,
        onStdout: onChunk ? (chunk) => onChunk({ stream: "stdout", chunk }) : undefined,
        onStderr: onChunk ? (chunk) => onChunk({ stream: "stderr", chunk }) : undefined,
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
    async runTask({ task, signal, onChunk } = {}) {
      const prompt = buildClaudePrompt(task);
      const finalArgs = [
        ...args,
        ...(model ? ["--model", model] : []),
        ...(permissionMode ? ["--permission-mode", permissionMode] : []),
        prompt,
      ];
      const result = await processRunner(command, finalArgs, {
        cwd: task.workspace,
        signal,
        onStdout: onChunk ? (chunk) => onChunk({ stream: "stdout", chunk }) : undefined,
        onStderr: onChunk ? (chunk) => onChunk({ stream: "stderr", chunk }) : undefined,
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

// Grace period after SIGTERM before escalating to SIGKILL. This is a real
// UX/safety trade-off:
//   - Too short: Codex/Claude CLIs lose their final flush and the audit log
//     misses the last few stdout chunks.
//   - Too long: a hung subprocess holds the run in "cancelling" state and
//     operators wait longer than expected after pressing Cancel.
// 2 seconds is a reasonable default for both CLIs. If your operators need
// faster cancellation feedback, drop to 500-1000ms; if your workers tend to
// produce large final outputs that take longer to flush, raise it.
const SUBPROCESS_GRACE_MS = 2000;

export function runProcess(
  command,
  args,
  { cwd, input, signal, onStdout, onStderr } = {},
) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error(signal.reason ?? "aborted");
      err.name = "AbortError";
      return reject(err);
    }

    const child = spawn(command, args, {
      cwd,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let aborted = false;
    let killTimer;

    child.stdout.on("data", (chunk) => {
      const text = chunk.toString();
      stdout += text;
      if (onStdout) {
        try {
          onStdout(text);
        } catch {
          // Streaming callbacks are best-effort: we never let an observer
          // throw take down the subprocess collection path.
        }
      }
    });
    child.stderr.on("data", (chunk) => {
      const text = chunk.toString();
      stderr += text;
      if (onStderr) {
        try {
          onStderr(text);
        } catch {
          // See onStdout note above.
        }
      }
    });
    child.on("error", (error) => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      if (killTimer) clearTimeout(killTimer);
      reject(error);
    });

    let onAbort;
    if (signal) {
      onAbort = () => {
        aborted = true;
        if (child.exitCode !== null || child.killed) return;
        child.kill("SIGTERM");
        killTimer = setTimeout(() => {
          if (child.exitCode === null && !child.killed) {
            child.kill("SIGKILL");
          }
        }, SUBPROCESS_GRACE_MS);
        killTimer.unref?.();
      };
      signal.addEventListener("abort", onAbort, { once: true });
    }

    child.on("close", (exitCode) => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      if (killTimer) clearTimeout(killTimer);
      if (aborted) {
        const err = new Error(signal?.reason ?? "aborted");
        err.name = "AbortError";
        err.partialStdout = stdout;
        err.partialStderr = stderr;
        return reject(err);
      }
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

export function createWorker(providerName, config) {
  if (providerName === "codex-worker") {
    return createCodexWorkerProvider(config?.workers?.["codex-worker"] ?? {});
  }
  if (providerName === "claude-worker") {
    return createClaudeWorkerProvider(config?.workers?.["claude-worker"] ?? {});
  }
  throw new Error(`Unsupported worker "${providerName}"`);
}

export function isWorkerProvider(providerName) {
  return providerName === "codex-worker" || providerName === "claude-worker";
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
