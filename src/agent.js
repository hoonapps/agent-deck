import EventEmitter from "node:events";
import stripAnsi from "strip-ansi";
import pty from "node-pty";

export class AgentProcess extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.pty = null;
    this.started = false;
  }

  start() {
    if (this.started) return;
    this.started = true;
    try {
      const spawn = shellSpawn(this.agent.command, this.agent.args);
      this.pty = pty.spawn(spawn.command, spawn.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 24,
        cwd: this.agent.cwd,
        env: { ...process.env, ...this.agent.env, TERM: "xterm-256color" }
      });
    } catch (error) {
      this.started = false;
      this.emit("data", `Failed to start ${this.agent.command}: ${error.message}\n`);
      this.emit("exit", { code: 1, signal: null });
      return;
    }

    this.pty.onData((data) => {
      this.emit("raw", data);
      this.emit("data", cleanTerminalOutput(data));
    });
    this.pty.onExit((event) => {
      this.started = false;
      this.emit("exit", event);
    });
  }

  writeLine(text) {
    if (!this.pty || !this.started) {
      this.emit("data", "\n[agent-deck] process is not running. Use /restart to start it again.\n");
      return;
    }
    this.pty.write(`${text}\r`);
  }

  writeRaw(input) {
    if (this.pty && this.started) this.pty.write(input);
  }

  resize(cols, rows) {
    if (!this.pty || !this.started) return;
    this.pty.resize(Math.max(20, cols), Math.max(5, rows));
  }

  stop() {
    if (!this.pty) return;
    this.pty.kill();
    this.pty = null;
    this.started = false;
  }

  restart() {
    this.stop();
    this.start();
  }
}

export function cleanTerminalOutput(data) {
  return stripAnsi(String(data))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0007/g, "");
}

export function shellSpawn(command, args = []) {
  if (process.platform === "win32") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", shellCommand(command, args)]
    };
  }

  return {
    command: process.env.SHELL || "/bin/sh",
    args: ["-lc", `exec ${shellCommand(command, args)}`]
  };
}

export function shellCommand(command, args = []) {
  return [command, ...args].map(shellQuote).join(" ");
}

function shellQuote(value) {
  const text = String(value);
  if (/^[A-Za-z0-9_./:=@%+-]+$/.test(text)) return text;
  return `'${text.replace(/'/g, "'\\''")}'`;
}
