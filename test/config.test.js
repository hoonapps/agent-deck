import test from "node:test";
import assert from "node:assert/strict";
import { shellCommand } from "../src/agent.js";
import { normalizeAgent, parseComposerCommand } from "../src/config.js";

test("parseComposerCommand sends plain text to selected target", () => {
  assert.deepEqual(parseComposerCommand("review this diff"), {
    type: "send",
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
  assert.deepEqual(parseComposerCommand("/diff"), { type: "diff" });
  assert.deepEqual(parseComposerCommand("/test npm run lint"), {
    type: "test",
    command: "npm run lint"
  });
  assert.deepEqual(parseComposerCommand("/clear all"), {
    type: "clear",
    target: "all"
  });
});

test("normalizeAgent creates stable ids and cwd", () => {
  assert.deepEqual(normalizeAgent({ name: "Claude Code", command: "claude" }, "/tmp/work", 0), {
    id: "claude-code",
    name: "Claude Code",
    command: "claude",
    args: [],
    cwd: "/tmp/work",
    env: {},
    autoStart: true
  });
});

test("shellCommand preserves arguments with spaces and quotes", () => {
  assert.equal(shellCommand("node", ["-e", "console.log('hello world')"]), "node -e 'console.log('\\''hello world'\\'')'");
});
