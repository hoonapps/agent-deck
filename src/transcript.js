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
  }

  event(source, message) {
    const time = new Date().toISOString();
    appendFileSync(this.path, `\n## ${time} ${source}\n\n${fence(message)}\n`);
  }

  input(target, message) {
    this.event(`input -> ${target}`, message);
  }

  output(source, message) {
    if (!message.trim()) return;
    this.event(`output <- ${source}`, message);
  }
}

function fence(value) {
  const text = String(value).replace(/\n+$/g, "");
  return `\`\`\`text\n${text}\n\`\`\`\n`;
}
