import blessed from "blessed";
import { AgentProcess } from "./agent.js";
import { parseComposerCommand, runtimeSetAgentModel } from "./config.js";
import { gitSummary, runCommand } from "./git.js";
import { Transcript } from "./transcript.js";

const THEME = {
  bg: "black",
  headerBg: "black",
  panelBg: "black",
  accent: "cyan",
  muted: "gray",
  text: "white",
  status: {
    idle: "green",
    running: "yellow",
    failed: "red",
    timeout: "red",
    stopped: "gray",
    unknown: "gray"
  }
};

const HELP_TEXT = `Commands:
/co [message]           enter Codex chat or send to Codex
/cl [message]           enter Claude chat or send to Claude
/all <message>          send to every agent
/to <agent> <message>   send to one agent and enter that chat
/git                    show git status in Activity
/history                refresh History panel
/test [command]         run tests
/status                 show agent status
/review <message>       send a review prompt to reviewer agents
/export [name]          export a session summary
/timeout <agent> <ms>   set an agent turn timeout
/record <on|off>        pause or resume transcript recording
/redact-last            remove the last transcript record
/restart <agent>        restart an agent
/clear <agent|all>      clear output
/models                 list current agent models
/set-model <agent> <model>
                        set an agent model and restart it
/exit-chat              leave the current agent chat
/quit                   exit`;

export function createApp(config) {
  return new AgentDeckApp(config);
}

class AgentDeckApp {
  constructor(config) {
    this.config = config;
    this.transcript = new Transcript({
      dir: config.transcriptDir,
      sessionName: config.sessionName,
      config
    });
    this.agents = new Map();
    this.boxes = new Map();
    this.activeAgentId = null;
    this.activityLines = [];
    this.agentStatuses = new Map();
  }

  start() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      dockBorders: true,
      title: this.config.title
    });
    this.screen.program.alternateBuffer();
    this.screen.program.hideCursor();

    this.createLayout();
    this.bindKeys();
    this.startAgents();
    this.refreshHistory();
    this.log(`Session transcript: ${this.transcript.path}`);
    this.log("Use /co or /cl to enter an agent chat. Clean mode shows only your message and the answer.");
    this.input.focus();
    this.render();
  }

  createLayout() {
    const headerHeight = 2;
    this.header = blessed.box({
      top: 0,
      left: 0,
      width: "100%",
      height: headerHeight,
      tags: true,
      style: { fg: THEME.text, bg: THEME.headerBg }
    });
    this.screen.append(this.header);

    const screenHeight = this.screen.height || 40;
    const bottomPanelHeight = Math.min(6, Math.max(4, Math.floor(screenHeight * 0.12)));
    const gridHeight = Math.max(14, screenHeight - bottomPanelHeight - headerHeight - 4);
    this.grid = blessed.box({
      top: headerHeight,
      left: 0,
      width: "100%",
      height: gridHeight
    });
    this.screen.append(this.grid);

    for (const agent of this.config.agents) {
      const position = panePosition(this.config.agents.indexOf(agent), this.config.agents.length);
      const box = blessed.box({
        label: formatPaneTitle(agent, { state: "idle" }),
        top: position.top,
        left: position.left,
        width: position.width,
        height: position.height,
        border: "line",
        scrollable: true,
        alwaysScroll: true,
        tags: false,
        keys: true,
        vi: true,
        mouse: true,
        scrollbar: { ch: " ", track: { bg: "black" }, style: { bg: "cyan" } },
        style: {
          fg: THEME.text,
          bg: THEME.panelBg,
          border: { fg: THEME.muted },
          focus: { border: { fg: THEME.accent } },
          scrollbar: { bg: THEME.accent }
        }
      });
      this.grid.append(box);
      this.boxes.set(agent.id, box);
    }

    const bottomTop = headerHeight + gridHeight;
    this.historyBox = blessed.box({
      top: bottomTop,
      left: 0,
      width: "50%",
      bottom: 4,
      label: " Context History ",
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      tags: true,
      mouse: true,
      style: {
        fg: THEME.text,
        bg: THEME.panelBg,
        border: { fg: THEME.muted },
        scrollbar: { bg: THEME.accent }
      }
    });
    this.screen.append(this.historyBox);

    this.activityBox = blessed.box({
      top: bottomTop,
      left: "50%",
      width: "50%",
      bottom: 4,
      label: " Run Log ",
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      tags: false,
      mouse: true,
      style: {
        fg: THEME.text,
        bg: THEME.panelBg,
        border: { fg: THEME.muted },
        scrollbar: { bg: THEME.accent }
      }
    });
    this.screen.append(this.activityBox);

    this.statusBar = blessed.box({
      bottom: 3,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { fg: THEME.text, bg: THEME.headerBg }
    });
    this.screen.append(this.statusBar);

    this.input = blessed.textbox({
      bottom: 0,
      left: 0,
      width: "100%",
      height: 3,
      label: " Message ",
      border: "line",
      inputOnFocus: true,
      keys: true,
      mouse: true,
      style: {
        fg: THEME.text,
        bg: THEME.bg,
        border: { fg: THEME.accent },
        focus: { border: { fg: "green" } }
      }
    });
    this.screen.append(this.input);

    this.input.on("submit", (value) => {
      this.handleInput(value || "");
      this.input.clearValue();
      this.input.focus();
      this.render();
    });
  }

  bindKeys() {
    this.screen.key(["C-c"], () => this.shutdown());
    this.screen.key(["f8"], () => this.refreshHistory());
    this.screen.key(["f10"], () => this.runTest());
    this.screen.key(["C-x"], () => {
      const selected = this.activeAgent();
      if (selected) {
        this.agentProcess(selected.id)?.stop();
        this.log(`Stopped ${selected.id}`);
      }
    });

    this.screen.on("resize", () => {
      this.resizeAgents();
      this.render();
    });
  }

  startAgents() {
    for (const agent of this.config.agents) {
      const process = new AgentProcess(agent);
      this.agents.set(agent.id, process);
      process.on("data", (data) => this.appendAgentOutput(agent.id, data));
      process.on("status", (status) => {
        this.agentStatuses.set(agent.id, status);
        this.updateAgentLabel(agent.id);
        this.render();
      });
      process.on("turn-start", () => this.appendAgentMeta(agent.id, "Working..."));
      process.on("turn-exit", ({ code, durationMs, timedOut }) => {
        const status = timedOut ? "timeout" : code === 0 ? "done" : `failed (${code})`;
        this.appendAgentMeta(agent.id, `Worked for ${formatDuration(durationMs)} - ${status}`);
      });
      process.on("error-output", (message) => this.log(`${agent.name}: ${message}`));
      process.on("exit", ({ code, signal }) => {
        this.log(`${agent.name} exited (${code ?? signal ?? "unknown"})`);
      });
      if (agent.autoStart) process.start();
    }
    this.updateActiveAgent(null);
  }

  handleInput(value) {
    if (!value.trim()) return;
    const directRoute = this.parseAgentRoute(value);
    if (directRoute) {
      this.updateActiveAgent(directRoute.agent.id);
      if (directRoute.message) {
        this.sendTo(directRoute.agent.id, directRoute.message, { enterChat: true });
      } else {
        this.log(`Entered ${directRoute.agent.name} chat. Plain messages now go to ${directRoute.agent.id}.`);
      }
      return;
    }

    const command = parseComposerCommand(value);

    if (command.type === "note") {
      this.sendToActive(command.message);
    } else if (command.type === "send-all") {
      this.sendAll(command.message);
    } else if (command.type === "send-to") {
      this.sendTo(command.target, command.message, { enterChat: true });
    } else if (command.type === "git") {
      this.showGit();
    } else if (command.type === "history") {
      this.refreshHistory();
    } else if (command.type === "test") {
      this.runTest(command.command);
    } else if (command.type === "status") {
      this.showStatus();
    } else if (command.type === "review") {
      this.review(command.message);
    } else if (command.type === "export") {
      this.exportSession(command.name);
    } else if (command.type === "timeout") {
      this.setTimeout(command.target, command.value);
    } else if (command.type === "record") {
      this.setRecording(command.value);
    } else if (command.type === "redact-last") {
      this.redactLast();
    } else if (command.type === "restart") {
      this.restart(command.target);
    } else if (command.type === "clear") {
      this.clear(command.target);
    } else if (command.type === "models") {
      this.listModels();
    } else if (command.type === "set-model") {
      this.setModel(command.target, command.model);
    } else if (command.type === "exit-chat") {
      this.updateActiveAgent(null);
      this.log("Left agent chat. Use /co or /cl to route messages.");
    } else if (command.type === "help") {
      this.log(HELP_TEXT);
    } else if (command.type === "quit") {
      this.shutdown();
    } else {
      this.handleUnknownSlash(value, command.command);
    }
  }

  sendToActive(message) {
    const agent = this.activeAgent();
    if (!agent) {
      this.log("No active agent chat. Use /co, /cl, or /to <agent> <message>.");
      return;
    }
    this.sendTo(agent.id, message);
  }

  sendTo(target, message, { enterChat = false } = {}) {
    if (!target || !message) {
      this.log("Usage: /to <agent> <message>");
      return;
    }
    const agent = this.findAgent(target);
    if (!agent) {
      this.log(`No agent named ${target}`);
      return;
    }
    if (enterChat) this.updateActiveAgent(agent.id);
    const outbound = this.buildAgentMessage(agent, message);
    this.appendUserMessage(agent.id, message);
    this.agentProcess(agent.id)?.writeLine(outbound);
    this.transcript.input(agent.id, message);
    this.refreshHistory();
    this.log(`Sent to ${agent.name}`);
  }

  sendAll(message) {
    if (!message) {
      this.log("Usage: /all <message>");
      return;
    }
    for (const agent of this.config.agents) {
      this.appendUserMessage(agent.id, message);
      this.agentProcess(agent.id)?.writeLine(this.buildAgentMessage(agent, message));
    }
    this.transcript.input("all", message);
    this.refreshHistory();
    this.log("Broadcast sent to all agents");
  }

  review(message) {
    if (!message) {
      this.log("Usage: /review <message>");
      return;
    }
    const targets = this.reviewAgents();
    if (targets.length === 0) {
      this.log("No review agents configured or available.");
      return;
    }
    const prompt = [
      this.config.rolePresets.reviewer || "Review the current work and report actionable findings.",
      "",
      "Review request:",
      message,
      "",
      "Return findings first. Include file paths, line numbers, test gaps, and a short verdict."
    ].join("\n");
    for (const agent of targets) {
      this.appendUserMessage(agent.id, `/review ${message}`);
      this.agentProcess(agent.id)?.writeLine(this.buildAgentMessage(agent, prompt));
    }
    this.transcript.input(`review -> ${targets.map((agent) => agent.id).join(",")}`, message);
    this.refreshHistory();
    this.log(`Review sent to ${targets.map((agent) => agent.name).join(", ")}`);
  }

  restart(target) {
    const agent = this.findAgent(target);
    if (!agent) {
      this.log(`Usage: /restart <agent>`);
      return;
    }
    this.agentProcess(agent.id)?.restart();
    this.log(`Restarted ${agent.name}`);
  }

  setModel(target, model) {
    const agent = this.findAgent(target);
    if (!agent || !model) {
      this.log("Usage: /set-model <agent> <model>");
      return;
    }
    runtimeSetAgentModel(agent, model);
    this.updateAgentLabel(agent.id);
    this.agentProcess(agent.id)?.restart();
    this.log(`Set ${agent.name} model to ${agent.model}. Restarted ${agent.id}.`);
    this.render();
  }

  listModels() {
    const rows = this.config.agents.map((agent) => {
      const aliases = agent.aliases.map((alias) => `/${alias}`).join(", ");
      return `${agent.id.padEnd(10)} ${agent.model || "(default)"}  ${aliases}`;
    });
    this.log(`Models:\n${rows.join("\n")}`);
  }

  showStatus() {
    const rows = this.config.agents.map((agent) => {
      const status = this.agentStatus(agent.id);
      const exit = status.lastExitCode ?? status.lastSignal ?? "-";
      const duration = status.lastDurationMs == null ? "-" : formatDuration(status.lastDurationMs);
      return `${agent.id.padEnd(10)} ${status.state.padEnd(8)} turns=${String(status.turns).padEnd(3)} last=${exit} duration=${duration}`;
    });
    this.log(`Status:\n${rows.join("\n")}`);
  }

  exportSession(name) {
    const path = this.transcript.exportSummary({ name: name || "summary" });
    this.transcript.event("export", path, { includeInContext: false });
    this.log(`Exported session summary: ${path}`);
  }

  setTimeout(target, value) {
    const agent = this.findAgent(target);
    const timeoutMs = Number(value);
    if (!agent || !Number.isInteger(timeoutMs) || timeoutMs < 0) {
      this.log("Usage: /timeout <agent> <ms>");
      return;
    }
    agent.turnTimeoutMs = timeoutMs;
    this.agentProcess(agent.id).agent.turnTimeoutMs = timeoutMs;
    this.log(`Set ${agent.name} timeout to ${timeoutMs}ms.`);
  }

  setRecording(value) {
    const normalized = String(value || "").toLowerCase();
    if (!["on", "off", "pause", "resume"].includes(normalized)) {
      this.log("Usage: /record <on|off>");
      return;
    }
    const enabled = normalized === "on" || normalized === "resume";
    this.transcript.setRecording(enabled);
    this.refreshHistory();
    this.log(`Transcript recording ${enabled ? "resumed" : "paused"}.`);
  }

  redactLast() {
    const removed = this.transcript.redactLast();
    this.refreshHistory();
    this.log(removed ? `Redacted last transcript record: ${removed.source}` : "No transcript record to redact.");
  }

  clear(target) {
    if (target === "all") {
      for (const box of this.boxes.values()) box.setContent("");
      this.log("Cleared all agent panes");
      return;
    }
    const agent = target === "current" ? this.activeAgent() : this.findAgent(target);
    if (!agent) {
      this.log("Usage: /clear <agent|all>");
      return;
    }
    this.boxes.get(agent.id)?.setContent("");
    this.log(`Cleared ${agent.name}`);
  }

  refreshHistory() {
    this.historyBox?.setContent(this.transcript.panelText(this.config.maxHistoryChars));
    this.render();
  }

  async showGit() {
    this.log("Loading git status...");
    this.log(await gitSummary(this.config.workspace));
    this.render();
  }

  async runTest(command = this.config.testCommand) {
    if (!command) {
      this.log("No test command configured.");
      return;
    }
    this.log(`Running: ${command}`);
    const result = await runCommand(command, this.config.workspace);
    this.log(`${command} ${result.ok ? "passed" : `failed (${result.code})`}\n${result.output || "(no output)"}`);
    this.transcript.event("test", `$ ${command}\n${result.output}`);
    this.refreshHistory();
  }

  appendAgentOutput(agentId, data) {
    const box = this.boxes.get(agentId);
    if (!box) return;
    const agent = this.findAgent(agentId);
    const text = data.replace(/\n$/g, "");
    box.pushLine(formatPaneMessage(agent?.name || agentId, text));
    box.pushLine("");
    box.setScrollPerc(100);
    this.transcript.output(agentId, data);
    this.refreshHistory();
    this.render();
  }

  appendAgentMeta(agentId, message) {
    const box = this.boxes.get(agentId);
    if (!box) return;
    box.pushLine(`[${message}]`);
    box.pushLine("");
    box.setScrollPerc(100);
    this.render();
  }

  appendUserMessage(agentId, message) {
    const box = this.boxes.get(agentId);
    if (!box) return;
    box.pushLine(formatPaneMessage("You", message));
    box.pushLine("");
    box.setScrollPerc(100);
    this.render();
  }

  log(message) {
    const line = formatLogLine(message);
    this.activityLines.push(line);
    this.activityLines = this.activityLines.slice(-300);
    this.activityBox?.setContent(this.activityLines.join("\n"));
    this.activityBox?.setScrollPerc(100);
    this.render();
  }

  updateActiveAgent(agentId) {
    this.activeAgentId = agentId;
    this.updateHeader();
    this.updateComposerLabel();
    for (const [agentId, box] of this.boxes.entries()) {
      this.updateAgentLabel(agentId);
      const selected = this.activeAgentId === agentId;
      box.style.border.fg = selected ? THEME.accent : this.statusColor(this.agentStatus(agentId).state);
    }
    this.render();
  }

  activeAgent() {
    return this.findAgent(this.activeAgentId);
  }

  findAgent(id) {
    if (!id) return null;
    const value = String(id).toLowerCase();
    return this.config.agents.find(
      (agent) => agent.id === value || agent.name.toLowerCase() === value || agent.aliases.includes(value)
    );
  }

  agentProcess(id) {
    return this.agents.get(id);
  }

  agentStatus(id) {
    return this.agentProcess(id)?.status() || {
      id,
      state: "unknown",
      turns: 0,
      lastExitCode: null,
      lastSignal: null,
      lastDurationMs: null
    };
  }

  reviewAgents() {
    const configured = this.config.reviewAgents
      .map((id) => this.findAgent(id))
      .filter(Boolean);
    if (configured.length) return configured;
    return this.config.agents.filter((agent) => agent.role === "reviewer" || agent.id === "claude" || agent.id === "codex");
  }

  updateAgentLabel(agentId) {
    const agent = this.findAgent(agentId);
    const box = this.boxes.get(agentId);
    if (!agent || !box) return;
    const status = this.agentStatus(agentId);
    box.setLabel(formatPaneTitle(agent, status, this.activeAgentId === agentId));
    if (this.activeAgentId !== agentId) box.style.border.fg = this.statusColor(status.state);
  }

  updateHeader() {
    const agent = this.activeAgent();
    const routes = this.config.agents.map((item) => `/${item.aliases[0] || item.id}`).join(" ");
    const statuses = this.config.agents
      .map((item) => {
        const state = this.agentStatus(item.id).state;
        return `{${this.statusColor(state)}-fg}${item.id}:${formatStatusBadge(state)}{/${this.statusColor(state)}-fg}`;
      })
      .join(" ");
    const active = agent ? `${agent.id}${agent.model ? `:${agent.model}` : ""}` : "none";
    const recording = this.transcript.recording ? "{green-fg}record:on{/green-fg}" : "{yellow-fg}record:paused{/yellow-fg}";
    this.header.setContent(
      ` {bold}${this.config.title}{/bold}  {gray-fg}|{/gray-fg} active:{cyan-fg}${active}{/cyan-fg}  {gray-fg}|{/gray-fg} ${recording}\n` +
        ` ${statuses}  {gray-fg}| routes ${routes} | F10 test | Ctrl+C quit{/gray-fg}`
    );
  }

  updateStatusBar() {
    const parts = [
      "{cyan-fg}/co{/cyan-fg} {magenta-fg}/cl{/magenta-fg} /to",
      "{yellow-fg}/review{/yellow-fg} {green-fg}/test{/green-fg} /status",
      "{blue-fg}/export{/blue-fg} /timeout",
      "{gray-fg}/record{/gray-fg} /redact",
      "{white-fg}F8 history{/white-fg}",
      "{red-fg}Ctrl+C quit{/red-fg}"
    ];
    this.statusBar?.setContent(` ${parts.join("  {gray-fg}|{/gray-fg}  ")} `);
  }

  updateComposerLabel() {
    const agent = this.activeAgent();
    const target = agent ? ` -> ${agent.id}` : " (/co /cl /to)";
    this.input?.setLabel(` Message${target} `);
  }

  statusColor(state) {
    return THEME.status[state] || THEME.status.unknown;
  }

  parseAgentRoute(value) {
    const match = value.trim().match(/^\/([^\s]+)(?:\s+([\s\S]*))?$/);
    if (!match) return null;
    const agent = this.findAgent(match[1]);
    if (!agent) return null;
    return { agent, message: match[2] || "" };
  }

  handleUnknownSlash(raw, command) {
    const agent = this.activeAgent();
    if (agent) {
      this.sendTo(agent.id, raw);
      return;
    }
    this.log(`Unknown Agent Deck command: /${command}. Use /co or /cl first to send agent slash commands.`);
  }

  buildAgentMessage(agent, message) {
    const rolePrompt = agent.role ? this.config.rolePresets[agent.role] : "";
    const parts = [];
    if (rolePrompt) {
      parts.push("Agent Deck role preset:", rolePrompt, "");
    }
    if (!this.config.shareHistory) {
      parts.push(message);
      return parts.join("\n");
    }
    const context = this.transcript.recentContext(this.config.maxHistoryChars);
    if (!context) {
      parts.push(message);
      return parts.join("\n");
    }
    parts.push(
      "Agent Deck shared conversation history follows. Use it as context for this turn. Do not summarize it unless asked.",
      "",
      context,
      "",
      `Current message for ${agent.name}:`,
      message
    );
    return parts.join("\n");
  }

  resizeAgents() {
    for (const agent of this.config.agents) {
      const box = this.boxes.get(agent.id);
      const process = this.agentProcess(agent.id);
      if (!box || !process) continue;
      process.resize(box.width - 2, box.height - 2);
    }
  }

  render() {
    this.updateHeader();
    this.updateStatusBar();
    this.screen?.render();
  }

  shutdown() {
    for (const process of this.agents.values()) process.stop();
    this.screen.program.showCursor();
    this.screen.program.normalBuffer();
    this.screen.destroy();
  }
}

function formatPaneMessage(label, message) {
  const text = String(message).trim();
  const heading = label === "You" ? "YOU" : String(label).toUpperCase();
  if (!text) return `[${heading}]`;
  return `[${heading}]\n${text}`;
}

function formatDuration(ms = 0) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}

export function formatStatusBadge(state = "unknown") {
  return String(state || "unknown").toUpperCase().slice(0, 7);
}

export function formatPaneTitle(agent, status = {}, active = false) {
  const marker = active ? ">" : " ";
  return ` ${marker} ${agent.label} | ${formatStatusBadge(status.state)} `;
}

export function formatLogLine(message, now = new Date()) {
  return `${now.toLocaleTimeString()} | ${message}`;
}

export function panePosition(index, count) {
  const cols = count <= 2 ? count : 2;
  const rows = Math.ceil(count / cols);
  const col = index % cols;
  const row = Math.floor(index / cols);
  return {
    top: `${(row * 100) / rows}%`,
    left: `${(col * 100) / cols}%`,
    width: `${100 / cols}%`,
    height: `${100 / rows}%`
  };
}
