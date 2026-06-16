import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { cleanTurnOutput, shellCommand } from "../src/agent.js";
import {
  loadConfig,
  normalizeAgent,
  parseComposerCommand,
  parseModelOverrides,
  runtimeSetAgentModel,
  validateAgents
} from "../src/config.js";

test("parseComposerCommand treats plain text as a note for the active chat", () => {
  assert.deepEqual(parseComposerCommand("review this diff"), {
    type: "note",
    message: "review this diff"
  });
});

test("parseComposerCommand supports routing commands", () => {
  assert.deepEqual(parseComposerCommand("/all hello agents"), {
    type: "send-all",
    message: "hello agents"
  });
  assert.deepEqual(parseComposerCommand("/to codex check the tests"), {
    type: "send-to",
    target: "codex",
    message: "check the tests"
  });
});

test("parseComposerCommand supports utility commands", () => {
  assert.deepEqual(parseComposerCommand("/git"), { type: "git" });
  assert.deepEqual(parseComposerCommand("/history"), { type: "history" });
  assert.deepEqual(parseComposerCommand("/test npm run lint"), {
    type: "test",
    command: "npm run lint"
  });
  assert.deepEqual(parseComposerCommand("/clear all"), {
    type: "clear",
    target: "all"
  });
  assert.deepEqual(parseComposerCommand("/models"), { type: "models" });
  assert.deepEqual(parseComposerCommand("/set-model codex gpt-5.3-codex"), {
    type: "set-model",
    target: "codex",
    model: "gpt-5.3-codex"
  });
});

test("normalizeAgent creates stable ids and cwd", () => {
  assert.deepEqual(normalizeAgent({ name: "Claude Code", command: "claude" }, "/tmp/work", 0), {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    mode: "turn",
    args: ["--print", "--output-format", "text"],
    baseArgs: ["--print", "--output-format", "text"],
    model: undefined,
    modelArg: "--model",
    role: undefined,
    turnTimeoutMs: 0,
    bracketedPaste: true,
    aliases: ["cl", "claude-code"],
    label: "Claude Code",
    cwd: "/tmp/work",
    env: {},
    autoStart: true
  });
});

test("normalizeAgent appends model args without removing resume args", () => {
  assert.deepEqual(
    normalizeAgent({ id: "claude", command: "claude", model: "sonnet", args: ["--resume"] }, "/tmp/work", 0).args,
    ["--resume", "--model", "sonnet"]
  );
  assert.deepEqual(
    normalizeAgent({ id: "codex", command: "codex", model: "gpt-5.3-codex", args: ["resume", "--last"] }, "/tmp/work", 0).args,
    ["resume", "--last", "--model", "gpt-5.3-codex"]
  );
});

test("normalizeAgent inserts codex model before stdin prompt marker", () => {
  assert.deepEqual(normalizeAgent({ id: "codex", command: "codex", model: "gpt-5.3-codex" }, "/tmp/work", 0).args, [
    "exec",
    "--color",
    "never",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.3-codex",
    "-"
  ]);
});

test("normalizeAgent prefers configured aliases for display routing", () => {
  assert.deepEqual(normalizeAgent({ id: "echo-a", aliases: ["ea"], command: "node" }, "/tmp/work", 0).aliases, ["ea", "echo-a"]);
});

test("validateAgents rejects empty agent lists", () => {
  assert.throws(() => validateAgents([]), /at least one agent/);
});

test("validateAgents rejects duplicate ids and aliases", () => {
  assert.throws(
    () =>
      validateAgents([
        normalizeAgent({ id: "codex", command: "codex" }, "/tmp/work", 0),
        normalizeAgent({ id: "codex", command: "codex" }, "/tmp/work", 1)
      ]),
    /Duplicate agent id/
  );

  assert.throws(
    () =>
      validateAgents([
        normalizeAgent({ id: "alpha", aliases: ["agent"], command: "node" }, "/tmp/work", 0),
        normalizeAgent({ id: "beta", aliases: ["agent"], command: "node" }, "/tmp/work", 1)
      ]),
    /Alias "agent"/
  );
});

test("loadConfig normalizes numeric config and rejects invalid history sizes", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-config-"));
  const configPath = join(dir, "agent-deck.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      maxHistoryChars: "12000",
      agents: [{ id: "echo", command: "node", args: ["-e", "process.exit(0)"] }]
    })
  );
  assert.equal(loadConfig({ configPath, cwd: dir }).maxHistoryChars, 12000);

  writeFileSync(
    configPath,
    JSON.stringify({
      maxHistoryChars: 0,
      agents: [{ id: "echo", command: "node", args: ["-e", "process.exit(0)"] }]
    })
  );
  assert.throws(() => loadConfig({ configPath, cwd: dir }), /maxHistoryChars must be a positive integer/);
});

test("parseModelOverrides maps agent ids to models", () => {
  assert.deepEqual(parseModelOverrides(["codex=gpt-5.3-codex,claude=sonnet"]), {
    codex: "gpt-5.3-codex",
    claude: "sonnet"
  });
});

test("parseComposerCommand supports status, review, and export commands", () => {
  assert.deepEqual(parseComposerCommand("/status"), { type: "status" });
  assert.deepEqual(parseComposerCommand("/review inspect the diff"), {
    type: "review",
    message: "inspect the diff"
  });
  assert.deepEqual(parseComposerCommand("/export decisions"), {
    type: "export",
    name: "decisions"
  });
});

test("loadConfig applies global and per-agent turn timeout values", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-config-"));
  const configPath = join(dir, "agent-deck.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      turnTimeoutMs: 9000,
      agents: [
        { id: "default-timeout", command: "node", args: ["-e", "process.exit(0)"] },
        { id: "custom-timeout", command: "node", turnTimeoutMs: 200, args: ["-e", "process.exit(0)"] }
      ]
    })
  );
  const config = loadConfig({ configPath, cwd: dir });
  assert.equal(config.turnTimeoutMs, 9000);
  assert.equal(config.agents[0].turnTimeoutMs, 9000);
  assert.equal(config.agents[1].turnTimeoutMs, 200);
});

test("loadConfig normalizes review agents and role presets", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-config-"));
  const configPath = join(dir, "agent-deck.config.json");
  writeFileSync(
    configPath,
    JSON.stringify({
      reviewAgents: ["Claude Reviewer"],
      rolePresets: { "Careful Reviewer": "Find regressions." },
      agents: [{ id: "Claude Reviewer", command: "node", role: "Careful Reviewer", args: ["-e", "process.exit(0)"] }]
    })
  );
  const config = loadConfig({ configPath, cwd: dir });
  assert.deepEqual(config.reviewAgents, ["claude-reviewer"]);
  assert.equal(config.agents[0].role, "careful-reviewer");
  assert.equal(config.rolePresets["careful-reviewer"], "Find regressions.");
});

test("runtimeSetAgentModel updates model args from base args", () => {
  const agent = normalizeAgent({ id: "codex", command: "codex", args: ["resume", "--last"] }, "/tmp/work", 0);
  runtimeSetAgentModel(agent, "gpt-5.3-codex");
  assert.equal(agent.label, "codex [gpt-5.3-codex]");
  assert.deepEqual(agent.args, ["resume", "--last", "--model", "gpt-5.3-codex"]);
});

test("shellCommand preserves arguments with spaces and quotes", () => {
  assert.equal(shellCommand("node", ["-e", "console.log('hello world')"]), "node -e 'console.log('\\''hello world'\\'')'");
});

test("cleanTurnOutput removes provider progress noise", () => {
  assert.equal(
    cleanTurnOutput("Working q\nThinking\n*Churned for 3s\n[Pasted text #2+306 lines]\n답변입니다\n* Honking... (3s · 5 tokens)\n"),
    "답변입니다"
  );
});

test("cleanTurnOutput extracts only the codex final answer", () => {
  assert.equal(
    cleanTurnOutput(`OpenAI Codex v0.130.0
--------
workdir: /Users/example
model: gpt-5.5
provider: openai
--------
user
하이
codex
하이. 무엇을 도와드릴까요?
tokens used
12,845
하이. 무엇을 도와드릴까요?`),
    "하이. 무엇을 도와드릴까요?"
  );
});
