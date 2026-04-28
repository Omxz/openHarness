import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

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

export const writeFileTool = {
  name: "writeFile",
  risk: "write",
  auditInput: auditWriteFileInput,
  async run(input, context) {
    context.policy.assertToolAllowed(writeFileTool);
    const normalized = normalizeWriteFileInput(input);
    const filePath = await context.policy.resolveWritablePath(normalized.path, {
      createDirs: normalized.createDirs,
    });

    if (normalized.createDirs) {
      await mkdir(dirname(filePath), { recursive: true });
    }

    const previous = await existingFileStats(filePath);
    if (previous && !normalized.overwrite) {
      throw new Error(
        `writeFile refused: "${normalized.path}" exists and overwrite=false`,
      );
    }

    const bytesWritten = Buffer.byteLength(normalized.content, normalized.encoding);
    const sha256 = createHash("sha256")
      .update(normalized.content, normalized.encoding)
      .digest("hex");

    await writeFile(filePath, normalized.content, {
      encoding: normalized.encoding,
      flag: normalized.overwrite ? "w" : "wx",
    });

    return {
      path: normalized.path,
      bytesWritten,
      created: !previous,
      overwritten: Boolean(previous),
      ...(previous && normalized.overwrite ? { previousBytes: previous.size } : {}),
      sha256,
    };
  },
};

export function createDefaultTools() {
  return {
    [readFileTool.name]: readFileTool,
    [listFilesTool.name]: listFilesTool,
    [shellTool.name]: shellTool,
    [writeFileTool.name]: writeFileTool,
  };
}

function normalizeWriteFileInput(input = {}) {
  if (typeof input.path !== "string" || input.path.trim() === "") {
    throw new Error("writeFile path must be a non-empty string");
  }
  if (typeof input.content !== "string") {
    throw new Error("writeFile content must be a string");
  }
  if (input.encoding !== undefined && input.encoding !== "utf8") {
    throw new Error('writeFile only supports encoding="utf8"');
  }
  if (input.overwrite !== undefined && typeof input.overwrite !== "boolean") {
    throw new Error("writeFile overwrite must be a boolean");
  }
  if (input.createDirs !== undefined && typeof input.createDirs !== "boolean") {
    throw new Error("writeFile createDirs must be a boolean");
  }

  return {
    path: input.path,
    content: input.content,
    encoding: "utf8",
    overwrite: input.overwrite === true,
    createDirs: input.createDirs === true,
  };
}

function auditWriteFileInput(input = {}) {
  const content = typeof input.content === "string" ? input.content : "";
  return {
    path: input.path,
    bytesWritten: Buffer.byteLength(content, "utf8"),
    overwrite: input.overwrite === true,
    createDirs: input.createDirs === true,
    encoding: input.encoding ?? "utf8",
  };
}

async function existingFileStats(filePath) {
  try {
    return await stat(filePath);
  } catch (error) {
    if (error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
