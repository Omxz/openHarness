import { readdir, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";

export const readFileTool = {
  name: "readFile",
  risk: "read",
  async run(input, context) {
    context.policy.assertToolAllowed(readFileTool);
    const filePath = context.policy.resolveWorkspacePath(input.path);
    return {
      path: input.path,
      content: await readFile(filePath, "utf8"),
    };
  },
};

export const listFilesTool = {
  name: "listFiles",
  risk: "read",
  async run(input, context) {
    context.policy.assertToolAllowed(listFilesTool);
    const dirPath = context.policy.resolveWorkspacePath(input.path ?? ".");
    const entries = await readdir(dirPath);
    return {
      path: input.path ?? ".",
      entries: entries.sort(),
    };
  },
};

export const shellTool = {
  name: "shell",
  risk: "write",
  async run(input, context) {
    context.policy.assertToolAllowed(shellTool);

    return await new Promise((resolvePromise, reject) => {
      const child = spawn(input.command, input.args ?? [], {
        cwd: context.workspace,
        shell: false,
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
        resolvePromise({
          command: input.command,
          args: input.args ?? [],
          exitCode,
          stdout,
          stderr,
        });
      });
    });
  },
};

export function createDefaultTools() {
  return {
    [readFileTool.name]: readFileTool,
    [listFilesTool.name]: listFilesTool,
    [shellTool.name]: shellTool,
  };
}
