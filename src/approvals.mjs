import { createInterface } from "node:readline";

export function parseToolList(input) {
  if (input === undefined || input === null) {
    return [];
  }

  return String(input)
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export function decideFromAnswer(answer, { tool, decision }) {
  const normalized = String(answer ?? "").trim().toLowerCase();

  if (normalized === "y" || normalized === "yes") {
    return {
      ...decision,
      action: "allow",
      reason: `approved at TTY prompt for ${tool.name}`,
    };
  }

  if (normalized === "" || normalized === "n" || normalized === "no") {
    return {
      ...decision,
      action: "needs-approval",
      reason: `declined at TTY prompt for ${tool.name}`,
    };
  }

  return {
    ...decision,
    action: "needs-approval",
    reason: `unrecognized response "${answer}" for ${tool.name}; fail-closed`,
  };
}

export function formatApprovalQuestion({ tool, decision }) {
  const risk = tool.risk ?? decision?.risk ?? "?";
  return `Approve ${tool.name} (${risk} risk)? [y/N] `;
}

export function createReadlineApprovalPrompt({
  input = process.stdin,
  output = process.stdout,
} = {}) {
  return async function readlineApprovalPrompt({ tool, input: toolInput, decision }) {
    const rl = createInterface({ input, output });
    try {
      const question = formatApprovalQuestion({ tool, decision, input: toolInput });
      const answer = await new Promise((resolve, reject) => {
        rl.question(question, resolve);
        rl.once("error", reject);
      });
      return decideFromAnswer(answer, { tool, decision });
    } catch (error) {
      return {
        ...decision,
        action: "needs-approval",
        reason: `TTY prompt failed for ${tool.name}: ${error.message}`,
      };
    } finally {
      rl.close();
    }
  };
}

export function createCliApprovalGate({
  autoApprove = [],
  deny = [],
  interactive = false,
  isTty = false,
  prompt,
} = {}) {
  if (interactive && !isTty) {
    throw new Error(
      "--approve requires a TTY; use --auto-approve <tools> for non-interactive runs",
    );
  }

  const autoApproveSet = new Set(autoApprove);
  const denySet = new Set(deny);

  return async function approveToolUse({ tool, input, decision }) {
    if (denySet.has(tool.name)) {
      return {
        ...decision,
        action: "deny",
        reason: "denied by --deny",
      };
    }

    if (autoApproveSet.has(tool.name)) {
      return {
        ...decision,
        action: "allow",
        reason: "auto-approved by --auto-approve",
      };
    }

    if (interactive && typeof prompt === "function") {
      return prompt({ tool, input, decision });
    }

    return decision;
  };
}
