import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export class Transcript {
  constructor({ dir, sessionName, config }) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${sessionName}.md`);
    this.startedAt = new Date();
    this.workspace = config.workspace;
    this.records = [];
    this.entries = [];
    this.hasUserInput = false;
    this.recording = true;
    this.rewriteFile();
  }

  event(source, message, { includeInContext = true, force = false } = {}) {
    if (!this.recording && !force) return false;
    const time = new Date().toISOString();
    const text = String(message).replace(/\n+$/g, "");
    const record = { time, source, message: text, includeInContext };
    this.records.push(record);
    appendFileSync(this.path, formatRecord(record));
    this.rebuildEntries();
    return true;
  }

  setRecording(enabled) {
    this.recording = Boolean(enabled);
    this.event("recording", this.recording ? "resumed" : "paused", { includeInContext: false, force: true });
    return this.recording;
  }

  redactLast() {
    if (this.records.length === 0) return null;
    const removed = this.records.pop();
    this.rebuildEntries();
    this.rewriteFile();
    return removed;
  }

  input(target, message) {
    this.hasUserInput = true;
    this.event(`input -> ${target}`, message);
  }

  output(source, message) {
    if (!message.trim()) return;
    this.event(`output <- ${source}`, message, { includeInContext: this.hasUserInput });
  }

  recentContext(maxChars = 6000) {
    return fitToMaxChars(
      this.entries
        .map((entry) => `[${entry.time}] ${entry.source}\n${truncate(entry.message, 1400)}`)
        .join("\n\n"),
      maxChars
    );
  }

  panelText(maxChars = 5000) {
    const context = fitToMaxChars(this.entries.map(formatPanelEntry).join("\n\n"), maxChars);
    return [`{gray-fg}Transcript file: ${escapeTags(this.path)}{/gray-fg}`, "", context || "(No conversation history yet.)"].join("\n");
  }

  exportSummary({ name = "summary", maxChars = 12000 } = {}) {
    const safeName = String(name)
      .trim()
      .replace(/[^a-zA-Z0-9_.-]+/g, "-")
      .replace(/^-+|-+$/g, "") || "summary";
    const path = join(this.dir(), `${this.sessionBaseName()}-${safeName}.md`);
    const inputs = this.entries.filter((entry) => entry.source.startsWith("input -> "));
    const outputs = this.entries.filter((entry) => entry.source.startsWith("output <- "));
    const tests = this.entries.filter((entry) => entry.source === "test");
    const body = [
      "# Agent Deck Session Export",
      "",
      `- Source transcript: ${this.path}`,
      `- Exported: ${new Date().toISOString()}`,
      `- User prompts: ${inputs.length}`,
      `- Agent outputs: ${outputs.length}`,
      `- Test events: ${tests.length}`,
      "",
      "## Recent Context",
      "",
      fitToMaxChars(this.entries.map(formatExportEntry).join("\n\n"), maxChars) || "(No entries yet.)",
      ""
    ].join("\n");
    writeFileSync(path, body, "utf8");
    return path;
  }

  sessionBaseName() {
    return basename(this.path, ".md");
  }

  dir() {
    return dirname(this.path);
  }

  rewriteFile() {
    writeFileSync(
      this.path,
      [
        "# Agent Deck Session",
        "",
        `- Started: ${this.startedAt.toISOString()}`,
        `- Workspace: ${this.workspace}`,
        "",
        ...this.records.map((record) => formatRecord(record).trimEnd()),
        ""
      ].join("\n"),
      "utf8"
    );
  }

  rebuildEntries() {
    this.entries = this.records
      .filter((record) => record.includeInContext)
      .map(({ time, source, message }) => ({ time, source, message }))
      .slice(-300);
    this.hasUserInput = this.entries.some((entry) => entry.source.startsWith("input -> "));
  }
}

function formatRecord(record) {
  return `\n## ${record.time} ${record.source}\n\n${fence(record.message)}\n`;
}

function fence(value) {
  const text = String(value).replace(/\n+$/g, "");
  return `\`\`\`text\n${text}\n\`\`\`\n`;
}

function truncate(value, maxChars) {
  const text = String(value);
  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars - 14)}\n...[truncated]`;
}

function fitToMaxChars(value, maxChars) {
  const text = String(value);
  if (text.length <= maxChars) return text;
  return `...[earlier history truncated]\n${text.slice(text.length - maxChars)}`;
}

function formatPanelEntry(entry) {
  const { label, color } = panelLabel(entry.source);
  return [
    "{gray-fg}--------------------------------{/gray-fg}",
    `{${color}-fg}${label}{/${color}-fg}`,
    escapeTags(truncate(entry.message, 900))
  ].join("\n");
}

function formatExportEntry(entry) {
  return [`### ${entry.time} ${entry.source}`, "", fence(truncate(entry.message, 2400)).trim()].join("\n");
}

function panelLabel(source) {
  if (source.startsWith("input -> ")) {
    return { label: `YOU -> ${source.replace("input -> ", "").toUpperCase()}`, color: "cyan" };
  }
  const agent = source.replace(/^output <- /, "").toUpperCase();
  if (agent.includes("CODEX")) return { label: "CODEX", color: "green" };
  if (agent.includes("CLAUDE")) return { label: "CLAUDE", color: "magenta" };
  return { label: agent, color: "yellow" };
}

function escapeTags(value) {
  return String(value).replace(/[{}]/g, "");
}
