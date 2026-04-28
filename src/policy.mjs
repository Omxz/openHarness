import { resolve, relative } from "node:path";

export function createPolicy({ workspace, approvals = {} }) {
  const root = resolve(workspace);
  const approvalDecisions = new Map(
    Object.entries(approvals)
      .filter(([, approved]) => approved === true)
      .map(([toolName]) => [toolName, {
        action: "allow",
        reason: "pre-approved",
        toolName,
      }]),
  );

  return {
    workspace: root,
    approvals: { ...approvals },
    decideToolUse(tool, input = {}) {
      if (tool.risk === "read") {
        return decision("allow", "read tools are allowed", tool);
      }

      if (tool.risk === "destructive") {
        return decision("deny", "destructive tools are denied by default", tool);
      }

      const existing = approvalDecisions.get(tool.name);
      if (existing?.action === "allow") {
        return decision("allow", existing.reason, tool);
      }

      return decision(
        "needs-approval",
        `${tool.risk} risk requires approval`,
        tool,
      );
    },
    recordApproval({ toolName, action, reason }) {
      approvalDecisions.set(toolName, { action, reason, toolName });
    },
    assertToolAllowed(tool) {
      const toolDecision = this.decideToolUse(tool);
      if (toolDecision.action === "allow") {
        return;
      }

      if (toolDecision.action === "deny") {
        throw new Error(`Tool "${tool.name}" with ${tool.risk} risk is denied`);
      }

      throw new Error(`Tool "${tool.name}" with ${tool.risk} risk requires approval`);
    },
    resolveWorkspacePath(inputPath = ".") {
      const candidate = resolve(root, inputPath);
      const pathFromRoot = relative(root, candidate);
      const isOutside =
        pathFromRoot === ".." || pathFromRoot.startsWith(`..${"/"}`) || resolve(candidate) !== candidate;

      if (isOutside) {
        throw new Error(`Path "${inputPath}" is outside the workspace`);
      }

      return candidate;
    },
  };
}

function decision(action, reason, tool, extra = {}) {
  return {
    action,
    reason,
    toolName: tool.name,
    risk: tool.risk,
    ...extra,
  };
}
