import { createServer } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { URL } from "node:url";
import { buildBlogDraftFromTranscript } from "./blog.js";
import { buildReplay, extractReviewFindings, formatFindingsMarkdown, listTranscriptFiles, parseTranscriptEntries } from "./transcript-tools.js";

const SESSION_STATE_FILE = ".agent-deck-session-state.json";
const SESSION_STATUSES = ["draft", "published", "deferred"];

export function createDashboardServer({ transcriptDir, title = "Agent Deck Dashboard" }) {
  const root = resolve(transcriptDir);
  return createServer((request, response) => {
    handleDashboardRequest({ request, response, root, title }).catch((error) => {
      response.writeHead(500, { "content-type": "text/plain; charset=utf-8" });
      response.end(error.message);
    });
  });
}

async function handleDashboardRequest({ request, response, root, title }) {
  const url = new URL(request.url || "/", "http://agent-deck.local");
  if (url.pathname === "/api/sessions") {
    sendJson(response, sessionList(root));
    return;
  }
  if (url.pathname === "/api/session") {
    sendJson(response, publicSessionDetails(sessionDetails(root, url.searchParams.get("file"), filtersFromParams(url.searchParams))));
    return;
  }
  if (url.pathname === "/api/session-state" && request.method === "POST") {
    const payload = JSON.parse(await readRequestBody(request));
    sendJson(response, updateSessionStatus(root, payload.file, payload.status));
    return;
  }
  if (url.pathname === "/session-state" && request.method === "POST") {
    const form = new URLSearchParams(await readRequestBody(request));
    const session = updateSessionStatus(root, form.get("file"), form.get("status"));
    redirect(response, `/?${queryString({ session: session.name, severity: form.get("severity"), agent: form.get("agent") })}`);
    return;
  }
  if (url.pathname === "/export/findings") {
    const session = sessionDetails(root, url.searchParams.get("file"), filtersFromParams(url.searchParams));
    sendMarkdown(response, `${session?.name || "session"}-findings.md`, session ? formatFindingsMarkdown(session.findings, { sourcePath: session.path }) : "");
    return;
  }
  if (url.pathname === "/export/blog") {
    const session = sessionDetails(root, url.searchParams.get("file"));
    sendMarkdown(response, `${session?.name || "session"}-blog-draft.md`, session ? buildBlogDraftFromTranscript(session.markdown, { title: titleFromSession(session.name), sourcePath: session.path }) : "");
    return;
  }
  if (url.pathname === "/") {
    sendHtml(response, renderDashboard({ title, root, selectedName: url.searchParams.get("session"), filters: filtersFromParams(url.searchParams) }));
    return;
  }
  response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
  response.end("Not found");
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

export function dashboardModel({ transcriptDir, selectedName, filters = {} } = {}) {
  const root = resolve(transcriptDir);
  const sessions = sessionList(root);
  const selected = selectSession(sessions, selectedName);
  return {
    transcriptDir: root,
    sessions,
    selected: selected ? sessionDetails(root, selected.name, filters) : null,
    filters: normalizeFilters(filters)
  };
}

function renderDashboard({ title, root, selectedName, filters }) {
  const model = dashboardModel({ transcriptDir: root, selectedName, filters });
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
        ${renderSessionLinks(model.sessions, selected?.name, model.filters)}
      </aside>
      <section class="detail" aria-label="Session detail">
        ${selected ? renderSessionDetail(selected) : "<p class=\"empty\">No transcript files found.</p>"}
      </section>
    </section>
  </main>
</body>
</html>`;
}

function renderSessionLinks(sessions, selectedName, filters) {
  if (sessions.length === 0) return "<p class=\"empty\">No sessions yet.</p>";
  return sessions
    .map((session) => {
      const active = session.name === selectedName ? " active" : "";
      return `<a class="session${active}" href="/?${queryString({ ...filters, session: session.name })}">
        <strong>${escapeHtml(session.name)}</strong>
        <span>${escapeHtml(session.modifiedAt)} · ${session.size} bytes</span>
        <span class="status ${escapeHtml(session.status)}">${escapeHtml(session.status)}</span>
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
        <span class="status ${escapeHtml(session.status)}">${escapeHtml(session.status)}</span>
        <span><strong>${session.counts.inputs}</strong> prompts</span>
        <span><strong>${session.counts.outputs}</strong> outputs</span>
        <span><strong>${session.findings.length}</strong>/<strong>${session.allFindings.length}</strong> findings</span>
      </div>
    </div>
    <div class="actions">
      ${renderFilters(session)}
      ${renderStatusForm(session)}
      <div class="downloads">
        <a href="/export/findings?${queryString({ file: session.name, severity: session.filters.severity, agent: session.filters.agent })}">Download findings</a>
        <a href="/export/blog?${queryString({ file: session.name })}">Download blog draft</a>
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

function renderFilters(session) {
  return `<form class="filters" method="get" action="/">
    <input type="hidden" name="session" value="${escapeHtml(session.name)}">
    <label>Severity
      <select name="severity">
        ${renderOptions(["all", ...session.filterOptions.severities], session.filters.severity)}
      </select>
    </label>
    <label>Agent
      <select name="agent">
        ${renderOptions(["all", ...session.filterOptions.agents], session.filters.agent)}
      </select>
    </label>
    <button type="submit">Apply</button>
    <a href="/?session=${encodeURIComponent(session.name)}">Reset</a>
  </form>`;
}

function renderStatusForm(session) {
  return `<form class="markers" method="post" action="/session-state">
    <input type="hidden" name="file" value="${escapeHtml(session.name)}">
    <input type="hidden" name="severity" value="${escapeHtml(session.filters.severity)}">
    <input type="hidden" name="agent" value="${escapeHtml(session.filters.agent)}">
    <span>Session</span>
    ${SESSION_STATUSES.map(
      (status) =>
        `<button type="submit" name="status" value="${status}" class="marker ${status}${session.status === status ? " active" : ""}">${status}</button>`
    ).join("")}
  </form>`;
}

function renderOptions(values, selected) {
  return values
    .map((value) => `<option value="${escapeHtml(value)}"${value === selected ? " selected" : ""}>${escapeHtml(value)}</option>`)
    .join("");
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
  const state = readSessionState(root);
  return listTranscriptFiles(root).map((file) => ({
    name: file.name,
    size: file.size,
    modifiedAt: file.modifiedAt.toISOString(),
    status: state[file.name]?.status || "draft",
    statusUpdatedAt: state[file.name]?.updatedAt || ""
  }));
}

function sessionDetails(root, requestedName, filters = {}) {
  const sessions = sessionList(root);
  const selected = selectSession(sessions, requestedName);
  if (!selected) return null;
  const safeName = basename(selected.name);
  const path = resolve(root, safeName);
  const markdown = readFileSync(path, "utf8");
  const entries = parseTranscriptEntries(markdown);
  const allFindings = extractReviewFindings(entries);
  const normalizedFilters = normalizeFilters(filters);
  const findings = filterFindings(allFindings, normalizedFilters);
  return {
    ...selected,
    path,
    markdown,
    counts: {
      inputs: entries.filter((entry) => entry.source.startsWith("input -> ")).length,
      outputs: entries.filter((entry) => entry.source.startsWith("output <- ")).length,
      tests: entries.filter((entry) => entry.source === "test").length
    },
    replay: buildReplay(markdown, { limit: 80 }),
    allFindings,
    findings,
    filters: normalizedFilters,
    filterOptions: {
      severities: uniqueSorted(allFindings.map((finding) => finding.severity)),
      agents: uniqueSorted(allFindings.map((finding) => finding.agent))
    }
  };
}

function publicSessionDetails(session) {
  if (!session) return null;
  const { path: _path, markdown: _markdown, ...publicSession } = session;
  return publicSession;
}

function updateSessionStatus(root, requestedName, requestedStatus) {
  const safeName = basename(requestedName || "");
  const status = normalizeSessionStatus(requestedStatus);
  const sessions = sessionList(root);
  const selected = sessions.find((session) => session.name === safeName);
  if (!selected) throw new Error("Unknown session");
  const state = readSessionState(root);
  state[selected.name] = {
    status,
    updatedAt: new Date().toISOString()
  };
  writeSessionState(root, state);
  return { ...selected, status, statusUpdatedAt: state[selected.name].updatedAt };
}

function readSessionState(root) {
  const path = join(root, SESSION_STATE_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed)
        .map(([name, value]) => [basename(name), normalizeSessionState(value)])
        .filter(([, value]) => value)
    );
  } catch {
    return {};
  }
}

function writeSessionState(root, state) {
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, SESSION_STATE_FILE), `${JSON.stringify(state, null, 2)}\n`, "utf8");
}

function normalizeSessionState(value) {
  if (!value || typeof value !== "object") return null;
  return {
    status: normalizeSessionStatus(value.status),
    updatedAt: String(value.updatedAt || "")
  };
}

function normalizeSessionStatus(value) {
  const status = String(value || "draft").toLowerCase().trim();
  return SESSION_STATUSES.includes(status) ? status : "draft";
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

function sendMarkdown(response, filename, value) {
  response.writeHead(200, {
    "content-type": "text/markdown; charset=utf-8",
    "content-disposition": `attachment; filename="${basename(filename)}"`
  });
  response.end(value || "");
}

function redirect(response, location) {
  response.writeHead(303, { location });
  response.end("");
}

function readRequestBody(request, maxBytes = 64 * 1024) {
  return new Promise((resolveBody, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
      if (body.length > maxBytes) {
        reject(new Error("Request body too large"));
        request.destroy();
      }
    });
    request.on("end", () => resolveBody(body));
    request.on("error", reject);
  });
}

function filtersFromParams(params) {
  return {
    severity: params.get("severity") || "all",
    agent: params.get("agent") || "all"
  };
}

function normalizeFilters(filters = {}) {
  return {
    severity: filters.severity || "all",
    agent: filters.agent || "all"
  };
}

function filterFindings(findings, filters) {
  return findings.filter((finding) => {
    const severityOk = filters.severity === "all" || finding.severity === filters.severity;
    const agentOk = filters.agent === "all" || finding.agent === filters.agent;
    return severityOk && agentOk;
  });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value && value !== "all") search.set(key, value);
  }
  return search.toString();
}

function titleFromSession(name) {
  return basename(name || "session", ".md").replace(/[-_]+/g, " ");
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
    :root { color-scheme: dark; --bg: #101114; --panel: #171a1f; --line: #2b3139; --text: #f4f7fb; --muted: #9aa7b5; --accent: #38d5c8; --blue: #5ca8ff; --warn: #f5c451; --bad: #ff6b73; --ok: #60d394; --quiet: #778294; }
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
    .actions { display: flex; justify-content: space-between; gap: 14px; align-items: center; flex-wrap: wrap; border-bottom: 1px solid var(--line); padding: 14px 0; }
    .filters, .downloads, .markers { display: flex; gap: 10px; align-items: center; flex-wrap: wrap; }
    label { display: flex; gap: 6px; align-items: center; color: var(--muted); }
    select, button, .downloads a, .filters a { border: 1px solid var(--line); background: #11151a; color: var(--text); padding: 7px 9px; text-decoration: none; font: inherit; }
    button { cursor: pointer; }
    .downloads a { color: var(--accent); }
    .markers span { color: var(--muted); }
    .marker.active { border-color: var(--accent); color: var(--accent); }
    .status { display: inline-flex; width: fit-content; border: 1px solid var(--line); padding: 3px 7px; color: var(--quiet); text-transform: uppercase; letter-spacing: .05em; font-size: 11px; font-weight: 700; }
    .status.published { color: var(--ok); }
    .status.deferred { color: var(--warn); }
    .marker.published.active { color: var(--ok); border-color: var(--ok); }
    .marker.deferred.active { color: var(--warn); border-color: var(--warn); }
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
