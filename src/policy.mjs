import { resolve, relative } from "node:path";

export function createPolicy({ workspace, approvals = {} }) {
  const root = resolve(workspace);

  return {
    workspace: root,
    approvals: { ...approvals },
    assertToolAllowed(tool) {
      if (tool.risk === "read") {
        return;
      }

      if (tool.name === "shell" && approvals.shell === true) {
        return;
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
