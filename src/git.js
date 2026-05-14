import { exec } from "node:child_process";

export function runCommand(command, cwd) {
  return new Promise((resolve) => {
    exec(command, { cwd, maxBuffer: 1024 * 1024 }, (error, stdout, stderr) => {
      resolve({
        ok: !error,
        code: error?.code ?? 0,
        output: `${stdout || ""}${stderr || ""}`.trimEnd()
      });
    });
  });
}

export async function gitSummary(cwd) {
  const [status, diff] = await Promise.all([
    runCommand("git status --short", cwd),
    runCommand("git diff --stat", cwd)
  ]);

  if (!status.ok) {
    return "Not a git repository yet.";
  }

  const statusText = status.output || "Working tree clean.";
  const diffText = diff.output ? `\n\n${diff.output}` : "";
  return `${statusText}${diffText}`;
}
