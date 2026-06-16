import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
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

const secondTranscript = `# Agent Deck Session

- Started: 2026-06-16T00:10:00.000Z
- Workspace: /tmp/work

## 2026-06-16T00:11:00.000Z input -> review -> codex

\`\`\`text
다시 리뷰해줘
\`\`\`

## 2026-06-16T00:12:00.000Z output <- codex

\`\`\`text
AGENT_DECK_FINDINGS_JSON
[
  {
    "severity": "high",
    "location": "src/app.js:12",
    "summary": "실패 상태 누락이 다른 경로에서도 반복됨",
    "evidence": "error branch"
  },
  {
    "severity": "low",
    "location": "docs/README.md:8",
    "summary": "문서 예제가 오래됨",
    "evidence": "old command"
  }
]
END_AGENT_DECK_FINDINGS_JSON
\`\`\`
`;

test("dashboardModel summarizes sessions, replay, and findings", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeSessionFile(dir, "review.md", sampleTranscript, "2026-06-15T00:00:00.000Z");
  writeSessionFile(dir, "follow-up.md", secondTranscript, "2026-06-16T00:00:00.000Z");

  const model = dashboardModel({ transcriptDir: dir, selectedName: "review.md" });

  assert.equal(model.sessions.length, 2);
  assert.equal(model.selected.name, "review.md");
  assert.equal(model.selected.counts.inputs, 1);
  assert.equal(model.selected.counts.outputs, 2);
  assert.equal(model.selected.allFindings.length, 2);
  assert.equal(model.selected.findings.length, 2);
  assert.equal(model.selected.status, "draft");
  assert.equal(model.selected.findings[0].status, "open");
  assert.match(model.selected.findings[0].key, /^[a-f0-9]{12}$/);
  assert.equal(model.inbox.count, 2);
  assert.equal(model.inbox.findings[0].status, "open");
  assert.equal(model.trends.total, 4);
  assert.equal(model.trends.locations[0].label, "src/app.js:12");
  assert.equal(model.trends.locations[0].count, 2);
  assert.equal(model.trends.locations[0].high, 2);
  assert.equal(model.trends.locations[0].sessions, 2);
  assert.equal(model.trends.severities.find((item) => item.label === "high")?.count, 2);
  assert.equal(model.trends.scannedSessions, 2);
  assert.equal(model.trends.windowSessions, 2);
  assert.equal(model.trends.filters.status, "all");
  assert.equal(model.trends.filters.window, "all");
  assert.match(model.selected.replay, /YOU -> review -> claude/);

  const filtered = dashboardModel({ transcriptDir: dir, selectedName: "review.md", filters: { severity: "high", agent: "claude" } });
  assert.equal(filtered.selected.findings.length, 1);
  assert.equal(filtered.selected.findings[0].location, "src/app.js:12");
  assert.equal(filtered.trends.total, 1);
  assert.equal(filtered.trends.filters.severity, "high");
  assert.equal(filtered.trends.filters.agent, "claude");
  assert.equal(filtered.trends.agents[0].label, "claude");

  const recent = dashboardModel({ transcriptDir: dir, selectedName: "review.md", filters: { window: "recent:1" } });
  assert.equal(recent.trends.total, 2);
  assert.equal(recent.trends.sessions, 1);
  assert.equal(recent.trends.scannedSessions, 2);
  assert.equal(recent.trends.windowSessions, 1);
  assert.equal(recent.trends.filters.window, "recent:1");
  assert.equal(recent.trends.agents[0].label, "codex");
});

test("startDashboard serves HTML and JSON APIs", async () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-web-"));
  writeSessionFile(dir, "review.md", sampleTranscript, "2026-06-15T00:00:00.000Z");
  writeSessionFile(dir, "follow-up.md", secondTranscript, "2026-06-16T00:00:00.000Z");

  const { server, url } = await startDashboard({ transcriptDir: dir, title: "Agent Deck Web", port: 0 });
  try {
    const html = await fetchText(url);
    assert.match(html, /Agent Deck Web/);
    assert.match(html, /review\.md/);
    assert.match(html, /src\/app\.js:12/);
    assert.match(html, /class="status draft"/);
    assert.match(html, /class="finding-status open active"/);
    assert.match(html, /Review Inbox/);
    assert.match(html, /2 open high findings/);
    assert.match(html, /Review Trends/);
    assert.match(html, /4 findings across 2 sessions/);
    assert.match(html, /Apply trend/);
    assert.match(html, /Reset trend/);
    assert.match(html, /Download trend/);

    const sessions = await fetchJson(new URL("/api/sessions", url));
    assert.equal(sessions.length, 2);
    assert.equal(sessions.find((session) => session.name === "review.md")?.status, "draft");

    const session = await fetchJson(new URL("/api/session?file=..%2Freview.md", url));
    assert.equal(session.name, "review.md");
    assert.equal(session.findings.length, 2);
    assert.equal(session.status, "draft");
    assert.equal(session.findings[0].status, "open");
    assert.match(session.findings[0].key, /^[a-f0-9]{12}$/);
    assert.equal("markdown" in session, false);
    assert.equal("path" in session, false);

    const inbox = await fetchJson(new URL("/api/inbox", url));
    assert.equal(inbox.count, 2);
    assert.equal(inbox.findings[0].severity, "high");
    assert.equal(inbox.findings[0].status, "open");

    const trends = await fetchJson(new URL("/api/trends", url));
    assert.equal(trends.total, 4);
    assert.equal(trends.scannedSessions, 2);
    assert.equal(trends.windowSessions, 2);
    assert.equal(trends.locations[0].label, "src/app.js:12");
    assert.equal(trends.locations[0].open, 2);
    assert.equal(trends.locations[0].sessions, 2);
    assert.equal(trends.agents.find((item) => item.label === "codex")?.count, 3);

    const codexOpenTrends = await fetchJson(new URL("/api/trends?agent=codex&status=open", url));
    assert.equal(codexOpenTrends.total, 3);
    assert.equal(codexOpenTrends.sessions, 2);
    assert.equal(codexOpenTrends.filters.agent, "codex");
    assert.equal(codexOpenTrends.filters.status, "open");
    assert.equal(codexOpenTrends.agents.length, 1);
    assert.equal(codexOpenTrends.agents[0].label, "codex");

    const recentTrends = await fetchJson(new URL("/api/trends?window=recent:1", url));
    assert.equal(recentTrends.total, 2);
    assert.equal(recentTrends.sessions, 1);
    assert.equal(recentTrends.windowSessions, 1);
    assert.equal(recentTrends.filters.window, "recent:1");

    const sinceTrends = await fetchJson(new URL("/api/trends?window=since:2026-06-16", url));
    assert.equal(sinceTrends.total, 2);
    assert.equal(sinceTrends.sessions, 1);
    assert.equal(sinceTrends.filters.window, "since:2026-06-16");

    const filteredHtml = await fetchText(new URL("/?session=review.md&agent=codex&status=open", url));
    assert.match(filteredHtml, /3 findings across 2 sessions/);
    assert.match(filteredHtml, /<option value="codex" selected>codex<\/option>/);
    assert.match(filteredHtml, /<option value="open" selected>open<\/option>/);

    const windowHtml = await fetchText(new URL("/?session=review.md&window=recent:5", url));
    assert.match(windowHtml, /<option value="recent:5" selected>recent:5<\/option>/);

    const trendExport = await fetchText(new URL("/export/trends?window=recent:1", url));
    assert.match(trendExport, /Agent Deck Review Trends/);
    assert.match(trendExport, /- Findings: 2/);
    assert.match(trendExport, /- Window sessions: 1/);
    assert.match(trendExport, /window=recent:1/);
    assert.match(trendExport, /\| src\/app\.js:12 \| 1 \| 1 \| 1 \| 1 \|/);
    assert.doesNotMatch(trendExport, /test\/web\.test\.js/);

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

    const inbox = await fetchJson(new URL("/api/inbox", url));
    assert.equal(inbox.count, 0);

    const openTrends = await fetchJson(new URL("/api/trends?status=open", url));
    assert.equal(openTrends.total, 1);
    assert.equal(openTrends.statuses[0].label, "open");
    assert.equal(openTrends.locations[0].label, "test/web.test.js");

    const fixedTrends = await fetchJson(new URL("/api/trends?status=fixed", url));
    assert.equal(fixedTrends.total, 1);
    assert.equal(fixedTrends.statuses[0].label, "fixed");
    assert.equal(fixedTrends.locations[0].label, "src/app.js:12");

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

function writeSessionFile(dir, name, content, modifiedAt) {
  const path = join(dir, name);
  writeFileSync(path, content);
  const time = new Date(modifiedAt);
  utimesSync(path, time, time);
}
