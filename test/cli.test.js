import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
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
