import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { URL } from "node:url";
import { buildReplay, extractReviewFindings, listTranscriptFiles, parseTranscriptEntries } from "./transcript-tools.js";

export function createDashboardServer({ transcriptDir, title = "Agent Deck Dashboard" }) {
  const root = resolve(transcriptDir);
  return createServer((request, response) => {
    try {
      const url = new URL(request.url || "/", "http://agent-deck.local");
      if (url.pathname === "/api/sessions") {
        sendJson(response, sessionList(root));
        return;
      }
      if (url.pathname === "/api/session") {
        sendJson(response, sessionDetails(root, url.searchParams.get("file")));
        return;
      }
      if (url.pathname === "/") {
        sendHtml(response, renderDashboard({ title, root, selectedName: url.searchParams.get("session") }));
        return;
      }
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Not found");
    } catch (error) {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    }
  });
}

export function startDashboard({ transcriptDir, title, host = "127.0.0.1", port = 4545 } = {}) {
  const server = createDashboardServer({ transcriptDir, title });
  return new Promise((resolveStart, reject) => {
    server.once("error", reject);
    server.listen(Number(port), host, () => {
      server.off("error", reject);
      const address = server.address();
      const actualPort = typeof address === "object" && address ? address.port : port;
      resolveStart({ server, url: `http://${host}:${actualPort}/` });
    });
  });
}

export function dashboardModel({ transcriptDir, selectedName } = {}) {
  const root = resolve(transcriptDir);
  const sessions = sessionList(root);
  const selected = selectSession(sessions, selectedName);
  return {
    transcriptDir: root,
    sessions,
    selected: selected ? sessionDetails(root, selected.name) : null
  };
}

function renderDashboard({ title, root, selectedName }) {
  const model = dashboardModel({ transcriptDir: root, selectedName });
  const selected = model.selected;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>${dashboardCss()}</style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Agent Deck</p>
        <h1>${escapeHtml(title)}</h1>
      </div>
      <div class="meta">
        <span>${model.sessions.length} sessions</span>
        <span>${escapeHtml(model.transcriptDir)}</span>
      </div>
    </header>
    <section class="layout">
      <aside class="sessions" aria-label="Sessions">
        <h2>Sessions</h2>
        ${renderSessionLinks(model.sessions, selected?.name)}
      </aside>
      <section class="detail" aria-label="Session detail">
        ${selected ? renderSessionDetail(selected) : "<p class=\"empty\">No transcript files found.</p>"}
      </section>
    </section>
  </main>
</body>
</html>`;
}

function renderSessionLinks(sessions, selectedName) {
  if (sessions.length === 0) return "<p class=\"empty\">No sessions yet.</p>";
  return sessions
    .map((session) => {
      const active = session.name === selectedName ? " active" : "";
      return `<a class="session${active}" href="/?session=${encodeURIComponent(session.name)}">
        <strong>${escapeHtml(session.name)}</strong>
        <span>${escapeHtml(session.modifiedAt)} · ${session.size} bytes</span>
      </a>`;
    })
    .join("");
}

function renderSessionDetail(session) {
  return `
    <div class="detail-header">
      <div>
        <p class="eyebrow">Selected Session</p>
        <h2>${escapeHtml(session.name)}</h2>
      </div>
      <div class="stats">
        <span><strong>${session.counts.inputs}</strong> prompts</span>
        <span><strong>${session.counts.outputs}</strong> outputs</span>
        <span><strong>${session.findings.length}</strong> findings</span>
      </div>
    </div>
    <div class="panes">
      <section>
        <h3>Replay</h3>
        <pre>${escapeHtml(session.replay)}</pre>
      </section>
      <section>
        <h3>Findings</h3>
        ${renderFindings(session.findings)}
      </section>
    </div>
  `;
}

function renderFindings(findings) {
  if (findings.length === 0) return "<p class=\"empty\">No review findings extracted.</p>";
  const rows = findings
    .map(
      (finding) => `<tr>
        <td>${finding.id}</td>
        <td><span class="severity ${escapeHtml(finding.severity)}">${escapeHtml(finding.severity)}</span></td>
        <td>${escapeHtml(finding.agent)}</td>
        <td>${escapeHtml(finding.location || "-")}</td>
        <td>${escapeHtml(finding.summary)}</td>
      </tr>`
    )
    .join("");
  return `<table>
    <thead><tr><th>#</th><th>Severity</th><th>Agent</th><th>Location</th><th>Summary</th></tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function sessionList(root) {
  return listTranscriptFiles(root).map((file) => ({
    name: file.name,
    size: file.size,
    modifiedAt: file.modifiedAt.toISOString()
  }));
}

function sessionDetails(root, requestedName) {
  const sessions = sessionList(root);
  const selected = selectSession(sessions, requestedName);
  if (!selected) return null;
  const safeName = basename(selected.name);
  const markdown = readFileSync(resolve(root, safeName), "utf8");
  const entries = parseTranscriptEntries(markdown);
  return {
    ...selected,
    counts: {
      inputs: entries.filter((entry) => entry.source.startsWith("input -> ")).length,
      outputs: entries.filter((entry) => entry.source.startsWith("output <- ")).length,
      tests: entries.filter((entry) => entry.source === "test").length
    },
    replay: buildReplay(markdown, { limit: 80 }),
    findings: extractReviewFindings(entries)
  };
}

function selectSession(sessions, requestedName) {
  if (sessions.length === 0) return null;
  const safeName = requestedName ? basename(requestedName) : "";
  return sessions.find((session) => session.name === safeName) || sessions[0];
}

function sendJson(response, value) {
  response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(value));
}

function sendHtml(response, value) {
  response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
  response.end(value);
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dashboardCss() {
  return `
    :root { color-scheme: dark; --bg: #101114; --panel: #171a1f; --line: #2b3139; --text: #f4f7fb; --muted: #9aa7b5; --accent: #38d5c8; --blue: #5ca8ff; --warn: #f5c451; --bad: #ff6b73; }
    * { box-sizing: border-box; }
    body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    .shell { max-width: 1440px; margin: 0 auto; padding: 24px; }
    .topbar, .detail-header { display: flex; align-items: flex-end; justify-content: space-between; gap: 20px; border-bottom: 1px solid var(--line); padding-bottom: 18px; }
    .eyebrow { margin: 0 0 4px; color: var(--accent); text-transform: uppercase; letter-spacing: .08em; font-size: 12px; font-weight: 700; }
    h1, h2, h3 { margin: 0; line-height: 1.1; }
    h1 { font-size: 28px; }
    h2 { font-size: 20px; }
    h3 { margin-bottom: 12px; color: var(--muted); font-size: 13px; text-transform: uppercase; letter-spacing: .06em; }
    .meta, .stats { display: flex; gap: 10px; flex-wrap: wrap; justify-content: flex-end; color: var(--muted); }
    .meta span, .stats span { border: 1px solid var(--line); background: var(--panel); padding: 6px 9px; }
    .layout { display: grid; grid-template-columns: minmax(240px, 340px) 1fr; gap: 18px; margin-top: 18px; min-height: calc(100vh - 120px); }
    .sessions, .detail, .panes section { border: 1px solid var(--line); background: var(--panel); }
    .sessions { padding: 16px; overflow: auto; }
    .session { display: block; color: var(--text); text-decoration: none; border: 1px solid transparent; padding: 10px; margin-top: 10px; background: #11151a; }
    .session.active { border-color: var(--accent); }
    .session span { display: block; color: var(--muted); font-size: 12px; margin-top: 3px; }
    .detail { padding: 18px; min-width: 0; }
    .panes { display: grid; grid-template-columns: minmax(0, 1fr); gap: 16px; margin-top: 18px; }
    .panes section { padding: 16px; overflow: auto; }
    pre { margin: 0; white-space: pre-wrap; word-break: break-word; color: #d8e3f0; font: 13px/1.55 ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border-bottom: 1px solid var(--line); padding: 9px 8px; text-align: left; vertical-align: top; }
    th { color: var(--muted); font-size: 12px; text-transform: uppercase; letter-spacing: .04em; }
    .severity { color: var(--blue); font-weight: 700; }
    .severity.high { color: var(--bad); }
    .severity.medium { color: var(--warn); }
    .empty { color: var(--muted); }
    @media (max-width: 860px) { .shell { padding: 14px; } .layout { grid-template-columns: 1fr; } .topbar, .detail-header { align-items: flex-start; flex-direction: column; } .meta, .stats { justify-content: flex-start; } }
  `;
}
