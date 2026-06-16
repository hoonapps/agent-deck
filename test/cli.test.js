import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const bin = new URL("../bin/agent-deck.js", import.meta.url).pathname;

test("agent-deck validate checks config without opening the TUI", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-cli-"));
  const configPath = join(dir, "agent-deck.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      agents: [{ id: "echo", command: "node", args: ["-e", "process.exit(0)"] }]
    })
  );

  const output = execFileSync(process.execPath, [bin, "validate", "--config", configPath], {
    cwd: dir,
    encoding: "utf8"
  });

  assert.match(output, /config ok/);
  assert.match(output, /Agents: echo/);
});

test("agent-deck validate fails on invalid config", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-cli-"));
  const configPath = join(dir, "agent-deck.config.json");
  writeFileSync(configPath, JSON.stringify({ agents: [] }));

  assert.throws(
    () =>
      execFileSync(process.execPath, [bin, "validate", "--config", configPath], {
        cwd: dir,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"]
      }),
    /Configuration must define at least one agent/
  );
});

test("agent-deck blog creates a blog draft from a transcript", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-cli-"));
  const transcriptPath = join(dir, "session.md");
  const outPath = join(dir, "post.md");
  writeFileSync(
    transcriptPath,
    `# Agent Deck Session

- Started: 2026-06-16T00:00:00.000Z
- Workspace: ${dir}

## 2026-06-16T00:01:00.000Z input -> codex

\`\`\`text
블로그 초안 만들어줘
\`\`\`
`
  );

  const output = execFileSync(process.execPath, [bin, "blog", transcriptPath, "--out", outPath, "--title", "Agent Deck 기록"], {
    cwd: dir,
    encoding: "utf8"
  });

  assert.match(output, /Created/);
  assert.equal(existsSync(outPath), true);
  assert.match(readFileSync(outPath, "utf8"), /Agent Deck 기록/);
});
