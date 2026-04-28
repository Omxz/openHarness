import { spawn } from "node:child_process";

export async function runVerifier(verifier, { workspace }) {
  if (!verifier) {
    return {
      skipped: true,
      exitCode: 0,
      stdout: "",
      stderr: "",
    };
  }

  return await new Promise((resolve, reject) => {
    const child = spawn(verifier.command, verifier.args ?? [], {
      cwd: workspace,
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
      resolve({
        command: verifier.command,
        args: verifier.args ?? [],
        exitCode,
        stdout,
        stderr,
      });
    });
  });
}
