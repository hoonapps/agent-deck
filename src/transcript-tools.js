import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

export function parseTranscriptEntries(markdown) {
  const entries = [];
  const pattern = /^## ([^\n]+?) ([^\n]+)\n\n(`{3,})text\n([\s\S]*?)\n\3/gm;
  for (const match of markdown.matchAll(pattern)) {
    entries.push({
      time: match[1],
      source: match[2],
      message: match[4].trim()
    });
  }
  return entries;
}

export function listTranscriptFiles(dir) {
  const root = resolve(dir);
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .filter((name) => name.endsWith(".md"))
    .map((name) => {
      const path = join(root, name);
      const stat = statSync(path);
      return { name, path, size: stat.size, modifiedAt: stat.mtime };
    })
    .sort((a, b) => b.modifiedAt.getTime() - a.modifiedAt.getTime());
}

export function formatSessionList(files) {
  if (files.length === 0) return "No transcript files found.";
  return files
    .map((file) => `${file.modifiedAt.toISOString()}  ${String(file.size).padStart(7)}  ${file.name}`)
    .join("\n");
}

export function buildReplay(markdown, { limit = 40 } = {}) {
  const entries = parseTranscriptEntries(markdown);
  const visible = entries.slice(-positiveLimit(limit));
  if (visible.length === 0) return "No transcript entries found.";
  return visible
    .map((entry) => {
      const label = replayLabel(entry.source).padEnd(16);
      return `${entry.time}  ${label}  ${oneLine(entry.message, 180)}`;
    })
    .join("\n");
}

export function buildReplayFromFile(path, options = {}) {
  return buildReplay(readFileSync(resolve(path), "utf8"), options);
}

export function extractReviewFindings(entries) {
  const findings = [];
  let reviewOpen = false;
  let currentRequest = "";

  for (const entry of entries) {
    if (entry.source.startsWith("input -> ")) {
      reviewOpen = isReviewSource(entry.source) || entry.message.trim().startsWith("/review");
      currentRequest = reviewOpen ? entry.message : "";
      continue;
    }
    if (!reviewOpen || !entry.source.startsWith("output <- ")) continue;
    findings.push(...extractFindingsFromOutput(entry, currentRequest));
  }

  return findings.map((finding, index) => ({ id: index + 1, ...finding }));
}

export function buildFindingsMarkdown(markdown, { sourcePath } = {}) {
  const entries = parseTranscriptEntries(markdown);
  const findings = extractReviewFindings(entries);
  return formatFindingsMarkdown(findings, { sourcePath });
}

export function writeFindingsReport({ transcriptPath, outPath } = {}) {
  const source = resolve(transcriptPath);
  const report = buildFindingsMarkdown(readFileSync(source, "utf8"), { sourcePath: source });
  const target = resolve(outPath || `${source.replace(/\.md$/, "")}-findings.md`);
  writeFileSync(target, report, "utf8");
  return target;
}

export function formatFindingsMarkdown(findings, { sourcePath } = {}) {
  const rows = findings.length
    ? findings.map((finding) =>
        [
          finding.id,
          finding.severity,
          escapeCell(finding.agent),
          escapeCell(finding.location || "-"),
          escapeCell(finding.summary),
          escapeCell(finding.evidence || "-")
        ].join(" | ")
      )
    : ["- | - | - | - | No review findings extracted. | -"];

  return [
    "# Agent Deck Review Findings",
    "",
    sourcePath ? `- Source transcript: ${sourcePath}` : "",
    `- Generated: ${new Date().toISOString()}`,
    `- Findings: ${findings.length}`,
    "",
    "| # | Severity | Agent | Location | Summary | Evidence |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows.map((row) => `| ${row} |`),
    ""
  ]
    .filter((line, index) => index !== 2 || line)
    .join("\n");
}

function extractFindingsFromOutput(entry, request) {
  const agent = entry.source.replace(/^output <- /, "");
  const structured = extractStructuredFindings(entry.message, { agent, request });
  if (structured.length) return structured;

  const lines = entry.message
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const candidates = lines
    .filter((line) => looksLikeFinding(line))
    .map((line) => findingFromLine(line, { agent, request }));

  if (candidates.length) return candidates;
  return [
    {
      severity: inferSeverity(entry.message),
      agent,
      location: findLocation(entry.message),
      summary: oneLine(entry.message, 220),
      evidence: request ? `review: ${oneLine(request, 120)}` : ""
    }
  ];
}

function findingFromLine(line, { agent, request }) {
  return {
    severity: inferSeverity(line),
    agent,
    location: findLocation(line),
    summary: cleanFindingLine(line),
    evidence: request ? `review: ${oneLine(request, 120)}` : ""
  };
}

function extractStructuredFindings(message, { agent, request }) {
  return structuredJsonBlocks(message)
    .flatMap((block) => parseFindingsJson(block, { agent, request }))
    .filter((finding) => finding.summary);
}

function structuredJsonBlocks(message) {
  const blocks = [];
  const markerPattern = /AGENT_DECK_FINDINGS_JSON\s*\n([\s\S]*?)\nEND_AGENT_DECK_FINDINGS_JSON/g;
  for (const match of String(message).matchAll(markerPattern)) blocks.push(match[1].trim());

  const fencePattern = /^(`{3,})(?:json\s+)?agent-deck-findings[^\n]*\n([\s\S]*?)\n\1$/gm;
  for (const match of String(message).matchAll(fencePattern)) blocks.push(match[2].trim());

  return blocks;
}

function parseFindingsJson(block, { agent, request }) {
  try {
    const parsed = JSON.parse(block);
    const rows = Array.isArray(parsed) ? parsed : parsed?.findings;
    if (!Array.isArray(rows)) return [];
    return rows.map((row) => normalizeStructuredFinding(row, { agent, request })).filter(Boolean);
  } catch {
    return [];
  }
}

function normalizeStructuredFinding(row, { agent, request }) {
  if (!row || typeof row !== "object") return null;
  const summary = oneLine(row.summary || row.title || row.message || "", 240);
  if (!summary) return null;
  const evidence = oneLine(row.evidence || row.reason || row.details || "", 240);
  return {
    severity: normalizeSeverity(row.severity),
    agent: oneLine(row.agent || agent, 80),
    location: oneLine(row.location || formatStructuredLocation(row), 120),
    summary,
    evidence: evidence || (request ? `review: ${oneLine(request, 120)}` : "")
  };
}

function formatStructuredLocation(row) {
  const file = row.file || row.path;
  if (!file) return "";
  return row.line ? `${file}:${row.line}` : String(file);
}

function isReviewSource(source) {
  return source.startsWith("input -> review ->") || source === "input -> review";
}

function looksLikeFinding(line) {
  return (
    /^[-*]\s+/.test(line) ||
    /^\d+[.)]\s+/.test(line) ||
    /\b(blocker|blocking|bug|risk|regression|missing|fail|security|issue|error|broken)\b/i.test(line) ||
    findLocation(line)
  );
}

function cleanFindingLine(line) {
  return oneLine(line.replace(/^[-*]\s+/, "").replace(/^\d+[.)]\s+/, ""), 240);
}

function inferSeverity(text) {
  if (/\b(blocker|blocking|critical|security|data loss|crash)\b/i.test(text)) return "high";
  if (/\b(regression|bug|broken|fail|error|missing test)\b/i.test(text)) return "medium";
  if (/\b(nit|minor|style)\b/i.test(text)) return "low";
  return "info";
}

function normalizeSeverity(value) {
  const severity = String(value || "").toLowerCase().trim();
  if (["high", "medium", "low", "info"].includes(severity)) return severity;
  if (["blocker", "blocking", "critical"].includes(severity)) return "high";
  if (["major", "bug", "regression"].includes(severity)) return "medium";
  if (["minor", "nit"].includes(severity)) return "low";
  return "info";
}

function findLocation(text) {
  const match = String(text).match(/([\w./-]+\.(?:js|ts|jsx|tsx|md|json|py|go|java|kt|rb|yml|yaml|css|scss|sh))(?::(\d+))?/);
  if (!match) return "";
  return match[2] ? `${match[1]}:${match[2]}` : match[1];
}

function replayLabel(source) {
  if (source.startsWith("input -> ")) return `YOU -> ${source.replace("input -> ", "")}`;
  if (source.startsWith("output <- ")) return source.replace("output <- ", "").toUpperCase();
  return source.toUpperCase();
}

function oneLine(value, max) {
  const text = String(value).replace(/\s+/g, " ").trim();
  if (text.length <= max) return text;
  return `${text.slice(0, max - 1)}…`;
}

function positiveLimit(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 40;
}

function escapeCell(value) {
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
