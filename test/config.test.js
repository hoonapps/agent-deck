import test from "node:test";
import assert from "node:assert/strict";
import { cleanTurnOutput, shellCommand } from "../src/agent.js";
import { normalizeAgent, parseComposerCommand, parseModelOverrides, runtimeSetAgentModel } from "../src/config.js";

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
    "--model",
    "gpt-5.3-codex",
    "-"
  ]);
});

test("normalizeAgent prefers configured aliases for display routing", () => {
  assert.deepEqual(normalizeAgent({ id: "echo-a", aliases: ["ea"], command: "node" }, "/tmp/work", 0).aliases, [
    "ea",
    "ec",
    "echo-a"
  ]);
});

test("parseModelOverrides maps agent ids to models", () => {
  assert.deepEqual(parseModelOverrides(["codex=gpt-5.3-codex,claude=sonnet"]), {
    codex: "gpt-5.3-codex",
    claude: "sonnet"
  });
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
