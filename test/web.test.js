import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
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

## 2026-06-16T00:03:00.000Z output <- codex

\`\`\`text
- Missing test: test/web.test.js에 export 케이스가 없음
\`\`\`
`;

test("dashboardModel summarizes sessions, replay, and findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeFileSync(join(dir, "review.md"), sampleTranscript);

  const model = dashboardModel({ transcriptDir: dir, selectedName: "review.md" });

  assert.equal(model.sessions.length, 1);
  assert.equal(model.selected.name, "review.md");
  assert.equal(model.selected.counts.inputs, 1);
  assert.equal(model.selected.counts.outputs, 2);
  assert.equal(model.selected.allFindings.length, 2);
  assert.equal(model.selected.findings.length, 2);
  assert.equal(model.selected.status, "draft");
  assert.equal(model.selected.findings[0].status, "open");
  assert.match(model.selected.findings[0].key, /^[a-f0-9]{12}$/);
  assert.match(model.selected.replay, /YOU -> review -> claude/);

  const filtered = dashboardModel({ transcriptDir: dir, selectedName: "review.md", filters: { severity: "high", agent: "claude" } });
  assert.equal(filtered.selected.findings.length, 1);
  assert.equal(filtered.selected.findings[0].location, "src/app.js:12");
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
    assert.match(html, /class="status draft"/);
    assert.match(html, /class="finding-status open active"/);

    const sessions = await fetchJson(new URL("/api/sessions", url));
    assert.equal(sessions[0].name, "review.md");
    assert.equal(sessions[0].status, "draft");

    const session = await fetchJson(new URL("/api/session?file=..%2Freview.md", url));
    assert.equal(session.name, "review.md");
    assert.equal(session.findings.length, 2);
    assert.equal(session.status, "draft");
    assert.equal(session.findings[0].status, "open");
    assert.match(session.findings[0].key, /^[a-f0-9]{12}$/);
    assert.equal("markdown" in session, false);
    assert.equal("path" in session, false);

    const filtered = await fetchJson(new URL("/api/session?file=review.md&severity=medium&agent=codex", url));
    assert.equal(filtered.findings.length, 1);
    assert.match(filtered.findings[0].summary, /Missing test/);

    const findings = await fetchText(new URL("/export/findings?file=review.md&severity=high", url));
    assert.match(findings, /Agent Deck Review Findings/);
    assert.match(findings, /src\/app\.js:12/);
    assert.doesNotMatch(findings, /Missing test/);

    const blog = await fetchText(new URL("/export/blog?file=review.md", url));
    assert.match(blog, /내가 보낸 요청: 1개/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dashboard persists finding status markers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeFileSync(join(dir, "review.md"), sampleTranscript);

  const { server, url } = await startDashboard({ transcriptDir: dir, title: "Agent Deck Web", port: 0 });
  try {
    const session = await fetchJson(new URL("/api/session?file=review.md", url));
    const target = session.findings[0];
    const updated = await postJson(new URL("/api/finding-state", url), {
      file: "../review.md",
      finding: target.key,
      status: "fixed"
    });

    assert.equal(updated.key, target.key);
    assert.equal(updated.status, "fixed");
    assert.match(updated.statusUpdatedAt, /^20/);

    const stateFile = readFileSync(join(dir, ".agent-deck-session-state.json"), "utf8");
    assert.match(stateFile, /"findings"/);
    assert.match(stateFile, /"fixed"/);

    const fixed = await fetchJson(new URL("/api/session?file=review.md&status=fixed", url));
    assert.equal(fixed.findings.length, 1);
    assert.equal(fixed.findings[0].key, target.key);

    const open = await fetchJson(new URL("/api/session?file=review.md&status=open", url));
    assert.equal(open.findings.length, 1);
    assert.notEqual(open.findings[0].key, target.key);

    const fixedExport = await fetchText(new URL("/export/findings?file=review.md&status=fixed", url));
    assert.match(fixedExport, /src\/app\.js:12/);
    assert.doesNotMatch(fixedExport, /Missing test/);

    const html = await fetchText(new URL("/?session=review.md&status=fixed", url));
    assert.match(html, /class="finding-status fixed active"/);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("dashboard persists publish status markers", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeFileSync(join(dir, "review.md"), sampleTranscript);

  const { server, url } = await startDashboard({ transcriptDir: dir, title: "Agent Deck Web", port: 0 });
  try {
    const updated = await postJson(new URL("/api/session-state", url), {
      file: "../review.md",
      status: "published"
    });

    assert.equal(updated.name, "review.md");
    assert.equal(updated.status, "published");
    assert.match(updated.statusUpdatedAt, /^20/);
    assert.equal("updatedAt" in updated, false);

    const stateFile = readFileSync(join(dir, ".agent-deck-session-state.json"), "utf8");
    assert.match(stateFile, /"review.md"/);
    assert.match(stateFile, /"published"/);

    const session = await fetchJson(new URL("/api/session?file=review.md", url));
    assert.equal(session.status, "published");

    const sessions = await fetchJson(new URL("/api/sessions", url));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].status, "published");

    const html = await fetchText(new URL("/?session=review.md", url));
    assert.match(html, /class="status published"/);
    assert.match(html, /class="marker published active"/);
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

async function postJson(url, payload) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  assert.equal(response.status, 200);
  return response.json();
}
