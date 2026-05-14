import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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
    const context = this.recentContext(maxChars);
    return [`Transcript file: ${this.path}`, "", context || "(No conversation history yet.)"].join("\n");
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
