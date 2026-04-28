import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

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
        pathFromRoot === ".." ||
        pathFromRoot.startsWith(`..${sep}`) ||
        isAbsolute(pathFromRoot);

      if (isOutside) {
        throw new Error(`Path "${inputPath}" is outside the workspace`);
      }

      return candidate;
    },
    async resolveWritablePath(inputPath, { createDirs = false } = {}) {
      validateWritableInputPath(inputPath);

      const candidate = this.resolveWorkspacePath(inputPath);
      const parentPath = dirname(candidate);
      const rootRealPath = await realpath(root);

      await assertWritableParent({
        root,
        rootRealPath,
        parentPath,
        inputPath,
        createDirs,
      });
      await assertWritableTarget(candidate, inputPath);

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

function validateWritableInputPath(inputPath) {
  if (typeof inputPath !== "string" || inputPath.trim() === "") {
    throw new Error("writeFile path must be a non-empty string");
  }

  if (isAbsolute(inputPath)) {
    throw new Error(`Path "${inputPath}" is absolute; absolute paths are not allowed`);
  }

  const parts = inputPath.split(/[\\/]+/).filter(Boolean);
  const lastPart = parts.at(-1);
  if (!lastPart || lastPart === "." || lastPart === "..") {
    throw new Error(`Path "${inputPath}" does not name a writable file`);
  }
}

async function assertWritableParent({
  root,
  rootRealPath,
  parentPath,
  inputPath,
  createDirs,
}) {
  const parentFromRoot = relative(root, parentPath);
  const parentParts = parentFromRoot ? parentFromRoot.split(sep).filter(Boolean) : [];
  let current = root;

  for (const part of parentParts) {
    current = resolve(current, part);
    let entry;
    try {
      entry = await lstat(current);
    } catch (error) {
      if (error.code === "ENOENT") {
        if (createDirs) {
          return;
        }
        throw new Error(`writeFile parent directory does not exist for "${inputPath}"`);
      }
      throw error;
    }

    if (entry.isSymbolicLink()) {
      const realCurrent = await realpath(current);
      assertInsideRoot(rootRealPath, realCurrent, inputPath);
      const target = await stat(realCurrent);
      if (!target.isDirectory()) {
        throw new Error(`Path "${inputPath}" parent is not a directory`);
      }
      continue;
    }

    if (!entry.isDirectory()) {
      throw new Error(`Path "${inputPath}" parent is not a directory`);
    }
  }
}

async function assertWritableTarget(candidate, inputPath) {
  let entry;
  try {
    entry = await lstat(candidate);
  } catch (error) {
    if (error.code === "ENOENT") {
      return;
    }
    throw error;
  }

  if (!entry.isFile()) {
    throw new Error(`Path "${inputPath}" is not a regular file`);
  }
}

function assertInsideRoot(rootRealPath, candidateRealPath, inputPath) {
  const pathFromRoot = relative(rootRealPath, candidateRealPath);
  const isOutside =
    pathFromRoot === ".." ||
    pathFromRoot.startsWith(`..${sep}`) ||
    isAbsolute(pathFromRoot);

  if (isOutside) {
    throw new Error(`Path "${inputPath}" is outside the workspace`);
  }
}
