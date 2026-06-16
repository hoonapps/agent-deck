import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Transcript } from "../src/transcript.js";
import { parseTranscriptEntries } from "../src/transcript-tools.js";

test("Transcript exports a session summary", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-transcript-"));
  const transcript = new Transcript({
    dir,
    sessionName: "demo-session",
    config: { workspace: "/tmp/work" }
  });

  transcript.input("codex", "review this diff");
  transcript.output("codex", "looks good");
  transcript.event("test", "$ npm test\npass");

  const path = transcript.exportSummary({ name: "decisions" });
  const content = readFileSync(path, "utf8");

  assert.equal(existsSync(path), true);
  assert.match(path, /demo-session-decisions\.md$/);
  assert.match(content, /Agent Deck Session Export/);
  assert.match(content, /User prompts: 1/);
  assert.match(content, /Agent outputs: 1/);
  assert.match(content, /Test events: 1/);
  assert.match(content, /review this diff/);
});

test("Transcript can pause recording and redact the last record", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-transcript-"));
  const transcript = new Transcript({
    dir,
    sessionName: "redact-session",
    config: { workspace: "/tmp/work" }
  });

  transcript.input("codex", "keep this");
  transcript.setRecording(false);
  transcript.output("codex", "do not persist");
  transcript.setRecording(true);
  transcript.output("codex", "remove this");

  assert.equal(transcript.entries.some((entry) => entry.message.includes("do not persist")), false);
  const removed = transcript.redactLast();
  const content = readFileSync(transcript.path, "utf8");

  assert.equal(removed.message, "remove this");
  assert.match(content, /keep this/);
  assert.doesNotMatch(content, /do not persist/);
  assert.doesNotMatch(content, /remove this/);
});

test("Transcript exports review findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-transcript-"));
  const transcript = new Transcript({
    dir,
    sessionName: "findings-session",
    config: { workspace: "/tmp/work" }
  });

  transcript.input("review -> codex", "find blocking issues");
  transcript.output("codex", "- Blocking: src/app.js:10 can throw without validation");

  const result = transcript.exportFindings({ name: "review" });
  const content = readFileSync(result.path, "utf8");

  assert.equal(result.count, 1);
  assert.match(result.path, /findings-session-review\.md$/);
  assert.match(content, /src\/app.js:10/);
});

test("Transcript preserves agent output that contains Markdown fences", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-transcript-"));
  const transcript = new Transcript({
    dir,
    sessionName: "fenced-session",
    config: { workspace: "/tmp/work" }
  });

  transcript.output("codex", "```js\nconsole.log('nested fence');\n```");

  const content = readFileSync(transcript.path, "utf8");
  const entries = parseTranscriptEntries(content);

  assert.match(content, /````text/);
  assert.equal(entries.length, 1);
  assert.match(entries[0].message, /nested fence/);
});
