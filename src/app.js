import blessed from "blessed";
import { AgentProcess } from "./agent.js";
import { parseComposerCommand } from "./config.js";
import { gitSummary, runCommand } from "./git.js";
import { Transcript } from "./transcript.js";

const HELP_TEXT = `Commands:
/all <message>          send to every agent
/to <agent> <message>   send to one agent
/focus <agent>          change active target
/diff                   refresh git diff
/test [command]         run tests
/restart <agent>        restart an agent
/clear <agent|all>      clear output
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
    this.selectedIndex = 0;
    this.activityLines = [];
  }

  start() {
    this.screen = blessed.screen({
      smartCSR: true,
      fullUnicode: true,
      title: this.config.title
    });

    this.createLayout();
    this.bindKeys();
    this.startAgents();
    this.refreshGit();
    this.log(`Session transcript: ${this.transcript.path}`);
    this.log("Use F1/F2 to target an agent, /all to broadcast, F8 for diff, F10 for tests.");
    this.input.focus();
    this.render();
  }

  createLayout() {
    this.header = blessed.box({
      top: 0,
      left: 0,
      width: "100%",
      height: 1,
      tags: true,
      style: { fg: "white", bg: "blue" }
    });
    this.screen.append(this.header);

    const gridHeight = Math.max(14, Math.floor((this.screen.height || 40) * 0.62));
    this.grid = blessed.layout({
      top: 1,
      left: 0,
      width: "100%",
      height: gridHeight,
      layout: "grid"
    });
    this.screen.append(this.grid);

    for (const agent of this.config.agents) {
      const box = blessed.box({
        label: ` ${agent.name} `,
        width: `${100 / this.config.agents.length}%`,
        height: "100%",
        border: "line",
        scrollable: true,
        alwaysScroll: true,
        tags: false,
        keys: true,
        vi: true,
        mouse: true,
        scrollbar: { ch: " ", track: { bg: "black" }, style: { bg: "cyan" } },
        style: {
          border: { fg: "gray" },
          focus: { border: { fg: "cyan" } }
        }
      });
      this.grid.append(box);
      this.boxes.set(agent.id, box);
    }

    const bottomTop = 1 + gridHeight;
    this.diffBox = blessed.box({
      top: bottomTop,
      left: 0,
      width: "50%",
      bottom: 3,
      label: " Git ",
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      tags: false,
      mouse: true,
      style: { border: { fg: "gray" } }
    });
    this.screen.append(this.diffBox);

    this.activityBox = blessed.box({
      top: bottomTop,
      left: "50%",
      width: "50%",
      bottom: 3,
      label: " Activity ",
      border: "line",
      scrollable: true,
      alwaysScroll: true,
      tags: false,
      mouse: true,
      style: { border: { fg: "gray" } }
    });
    this.screen.append(this.activityBox);

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
      style: { border: { fg: "cyan" } }
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
    this.screen.key(["f8"], () => this.refreshGit());
    this.screen.key(["f10"], () => this.runTest());
    this.screen.key(["C-x"], () => {
      const selected = this.selectedAgent();
      if (selected) {
        this.agentProcess(selected.id)?.stop();
        this.log(`Stopped ${selected.id}`);
      }
    });

    this.config.agents.forEach((agent, index) => {
      this.screen.key(`f${index + 1}`, () => this.selectAgent(index));
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
      process.on("exit", ({ code, signal }) => {
        this.appendAgentOutput(agent.id, `\n[agent-deck] exited code=${code} signal=${signal || ""}\n`);
        this.log(`${agent.name} exited (${code ?? signal ?? "unknown"})`);
      });
      if (agent.autoStart) process.start();
    }
    this.selectAgent(0);
  }

  handleInput(value) {
    if (!value.trim()) return;
    const command = parseComposerCommand(value);

    if (command.type === "send") {
      this.sendToSelected(command.message);
    } else if (command.type === "send-all") {
      this.sendAll(command.message);
    } else if (command.type === "send-to") {
      this.sendTo(command.target, command.message);
    } else if (command.type === "focus") {
      this.selectAgentById(command.target);
    } else if (command.type === "diff") {
      this.refreshGit();
    } else if (command.type === "test") {
      this.runTest(command.command);
    } else if (command.type === "restart") {
      this.restart(command.target);
    } else if (command.type === "clear") {
      this.clear(command.target);
    } else if (command.type === "help") {
      this.log(HELP_TEXT);
    } else if (command.type === "quit") {
      this.shutdown();
    } else {
      this.log(`Unknown command: /${command.command}. Try /help.`);
    }
  }

  sendToSelected(message) {
    const agent = this.selectedAgent();
    if (!agent) return;
    this.sendTo(agent.id, message);
  }

  sendTo(target, message) {
    if (!target || !message) {
      this.log("Usage: /to <agent> <message>");
      return;
    }
    const agent = this.findAgent(target);
    if (!agent) {
      this.log(`No agent named ${target}`);
      return;
    }
    this.agentProcess(agent.id)?.writeLine(message);
    this.transcript.input(agent.id, message);
    this.log(`Sent to ${agent.name}`);
  }

  sendAll(message) {
    if (!message) {
      this.log("Usage: /all <message>");
      return;
    }
    for (const agent of this.config.agents) {
      this.agentProcess(agent.id)?.writeLine(message);
    }
    this.transcript.input("all", message);
    this.log("Broadcast sent to all agents");
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

  clear(target) {
    if (target === "all") {
      for (const box of this.boxes.values()) box.setContent("");
      this.log("Cleared all agent panes");
      return;
    }
    const agent = target === "current" ? this.selectedAgent() : this.findAgent(target);
    if (!agent) {
      this.log("Usage: /clear <agent|all>");
      return;
    }
    this.boxes.get(agent.id)?.setContent("");
    this.log(`Cleared ${agent.name}`);
  }

  async refreshGit() {
    this.diffBox?.setContent("Loading git status...");
    this.render();
    this.diffBox?.setContent(await gitSummary(this.config.workspace));
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
  }

  appendAgentOutput(agentId, data) {
    const box = this.boxes.get(agentId);
    if (!box) return;
    box.pushLine(data.replace(/\n$/g, ""));
    box.setScrollPerc(100);
    this.transcript.output(agentId, data);
    this.render();
  }

  log(message) {
    const line = `[${new Date().toLocaleTimeString()}] ${message}`;
    this.activityLines.push(line);
    this.activityLines = this.activityLines.slice(-300);
    this.activityBox?.setContent(this.activityLines.join("\n"));
    this.activityBox?.setScrollPerc(100);
    this.render();
  }

  selectAgent(index) {
    if (index < 0 || index >= this.config.agents.length) return;
    this.selectedIndex = index;
    this.updateHeader();
    for (const [agentId, box] of this.boxes.entries()) {
      const selected = this.selectedAgent()?.id === agentId;
      box.style.border.fg = selected ? "cyan" : "gray";
    }
    this.render();
  }

  selectAgentById(id) {
    const index = this.config.agents.findIndex((agent) => agent.id === id);
    if (index === -1) {
      this.log(`No agent named ${id}`);
      return;
    }
    this.selectAgent(index);
  }

  selectedAgent() {
    return this.config.agents[this.selectedIndex];
  }

  findAgent(id) {
    return this.config.agents.find((agent) => agent.id === id || agent.name.toLowerCase() === String(id).toLowerCase());
  }

  agentProcess(id) {
    return this.agents.get(id);
  }

  updateHeader() {
    const agent = this.selectedAgent();
    const keys = this.config.agents.map((item, index) => `F${index + 1}:${item.id}`).join(" ");
    this.header.setContent(` ${this.config.title} | target: ${agent?.id || "none"} | ${keys} | F8 diff | F10 test | Ctrl+C quit `);
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
    this.screen?.render();
  }

  shutdown() {
    for (const process of this.agents.values()) process.stop();
    this.screen.destroy();
  }
}
