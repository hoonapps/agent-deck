import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { dashboardModel, startDashboard } from "../src/web.js";

const sampleTranscript = `# Agent Deck Session

- Started: 2026-06-16T00:00:00.000Z
- Workspace: /tmp/work

## 2026-06-16T00:01:00.000Z input -> review -> claude

\`\`\`text
blocking issue 찾아줘
\`\`\`

## 2026-06-16T00:02:00.000Z output <- claude

\`\`\`text
- Blocking: src/app.js:12에서 실패 상태를 누락함
\`\`\`
`;

test("dashboardModel summarizes sessions, replay, and findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeFileSync(join(dir, "review.md"), sampleTranscript);

  const model = dashboardModel({ transcriptDir: dir, selectedName: "review.md" });

  assert.equal(model.sessions.length, 1);
  assert.equal(model.selected.name, "review.md");
  assert.equal(model.selected.counts.inputs, 1);
  assert.equal(model.selected.counts.outputs, 1);
  assert.equal(model.selected.findings.length, 1);
  assert.match(model.selected.replay, /YOU -> review -> claude/);
});

test("startDashboard serves HTML and JSON APIs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeFileSync(join(dir, "review.md"), sampleTranscript);

  const { server, url } = await startDashboard({ transcriptDir: dir, title: "Agent Deck Web", port: 0 });
  try {
    const html = await fetchText(url);
    assert.match(html, /Agent Deck Web/);
    assert.match(html, /review\.md/);
    assert.match(html, /src\/app\.js:12/);

    const sessions = await fetchJson(new URL("/api/sessions", url));
    assert.equal(sessions[0].name, "review.md");

    const session = await fetchJson(new URL("/api/session?file=..%2Freview.md", url));
    assert.equal(session.name, "review.md");
    assert.equal(session.findings.length, 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

async function fetchText(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.text();
}

async function fetchJson(url) {
  const response = await fetch(url);
  assert.equal(response.status, 200);
  return response.json();
}
