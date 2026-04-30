const USAGE_LIMIT_PATTERN =
  /\b(usage[- ]limit|rate[- ]limit|quota exceeded|quota limit|too many requests|limit reached)\b/i;
const AUTH_PATTERN =
  /\b(not logged in|login required|log in|sign in|unauthorized|authentication required|auth required|invalid api key|missing api key)\b/i;

export function classifyWorkerResult({ workerId = "worker", result } = {}) {
  const exitCode = result?.exitCode;
  if (exitCode === 0) {
    return null;
  }

  const text = collectWorkerText(result);
  const base = {
    state: "blocked",
    workerId,
    exitCode: exitCode ?? null,
  };

  if (USAGE_LIMIT_PATTERN.test(text)) {
    return {
      ...base,
      category: "usage-limit",
      reason: `${workerId} hit a usage limit`,
      suggestedAction: "Wait for the reset window or reroute to another ready provider.",
    };
  }

  if (AUTH_PATTERN.test(text)) {
    return {
      ...base,
      category: "auth-required",
      reason: `${workerId} needs authentication`,
      suggestedAction: "Sign in to the worker CLI or choose another ready provider.",
    };
  }

  return {
    ...base,
    category: "worker-exit",
    reason:
      exitCode === undefined || exitCode === null
        ? `${workerId} exited without an exit code`
        : `${workerId} exited with code ${exitCode}`,
    suggestedAction: "Inspect the worker output, then rerun or choose another provider.",
  };
}

function collectWorkerText(result) {
  if (!result) return "";
  return [result.output, result.stdout, result.stderr]
    .filter((value) => typeof value === "string" && value.length > 0)
    .join("\n");
}
