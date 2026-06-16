import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";

export class Transcript {
  constructor({ dir, sessionName, config }) {
    mkdirSync(dir, { recursive: true });
    this.path = join(dir, `${sessionName}.md`);
    this.startedAt = new Date();
    writeFileSync(
      this.path,
      `# Agent Deck Session\n\n- Started: ${this.startedAt.toISOString()}\n- Workspace: ${config.workspace}\n\n`
    );
    this.entries = [];
    this.hasUserInput = false;
  }

  event(source, message, { includeInContext = true } = {}) {
    const time = new Date().toISOString();
    const text = String(message).replace(/\n+$/g, "");
    appendFileSync(this.path, `\n## ${time} ${source}\n\n${fence(text)}\n`);
    if (includeInContext) {
      this.entries.push({ time, source, message: text });
      this.entries = this.entries.slice(-300);
    }
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
