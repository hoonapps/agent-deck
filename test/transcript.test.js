import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Transcript } from "../src/transcript.js";

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
