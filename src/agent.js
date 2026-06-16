import EventEmitter from "node:events";
import { spawn } from "node:child_process";
import stripAnsi from "strip-ansi";
import pty from "node-pty";

export class AgentProcess extends EventEmitter {
  constructor(agent) {
    super();
    this.agent = agent;
    this.pty = null;
    this.child = null;
    this.started = false;
    this.state = "idle";
    this.lastExitCode = null;
    this.lastSignal = null;
    this.lastDurationMs = null;
    this.lastStartedAt = null;
    this.turns = 0;
    this.turnTimer = null;
  }

  start() {
    if (this.started) return;
    this.started = true;
    if (this.agent.mode === "turn") {
      this.setState("idle");
      return;
    }
    try {
      const spawn = shellSpawn(this.agent.command, this.agent.args);
      this.pty = pty.spawn(spawn.command, spawn.args, {
        name: "xterm-256color",
        cols: 100,
        rows: 24,
        cwd: this.agent.cwd,
        env: { ...process.env, ...this.agent.env, TERM: "xterm-256color" }
      });
      this.setState("running");
    } catch (error) {
      this.started = false;
      this.setState("failed");
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
      this.lastExitCode = event.code ?? null;
      this.lastSignal = event.signal ?? null;
      this.setState(event.code === 0 ? "idle" : "failed");
      this.emit("exit", event);
    });
  }

  writeLine(text) {
    if (this.agent.mode === "turn") {
      this.runTurn(text);
      return;
    }
    if (!this.pty || !this.started) {
      this.emit("data", "\n[agent-deck] process is not running. Use /restart to start it again.\n");
      return;
    }
    const value = String(text);
    if (this.agent.bracketedPaste && value.includes("\n")) {
      this.pty.write(`\x1b[200~${value}\x1b[201~\r`);
    } else {
      this.pty.write(`${value}\r`);
    }
  }

  writeRaw(input) {
    if (this.pty && this.started) this.pty.write(input);
  }

  resize(cols, rows) {
    if (!this.pty || !this.started) return;
    this.pty.resize(Math.max(20, cols), Math.max(5, rows));
  }

  stop() {
    this.clearTurnTimer();
    if (this.child) {
      this.child.kill();
      this.child = null;
    }
    if (!this.pty) {
      this.started = false;
      this.setState("stopped");
      return;
    }
    this.pty.kill();
    this.pty = null;
    this.started = false;
    this.setState("stopped");
  }

  restart() {
    this.stop();
    this.start();
  }

  runTurn(text) {
    if (this.child) {
      this.emit("data", "[agent-deck] turn already running\n");
      return;
    }
    const startedAt = Date.now();
    this.started = true;
    this.lastStartedAt = startedAt;
    this.lastExitCode = null;
    this.lastSignal = null;
    this.lastDurationMs = null;
    this.turns += 1;
    this.setState("running");
    this.emit("turn-start", { startedAt });
    const child = spawn(this.agent.command, this.agent.args, {
      cwd: this.agent.cwd,
      env: { ...process.env, ...this.agent.env, TERM: "xterm-256color" },
      stdio: ["pipe", "pipe", "pipe"]
    });
    this.child = child;
    let timedOut = false;
    let stdout = "";
    let stderr = "";
    if (this.agent.turnTimeoutMs > 0) {
      this.turnTimer = setTimeout(() => {
        if (!this.child) return;
        timedOut = true;
        this.emit("data", `[agent-deck] turn timed out after ${formatDuration(this.agent.turnTimeoutMs)}\n`);
        this.child.kill();
      }, this.agent.turnTimeoutMs);
    }
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      this.clearTurnTimer();
      this.child = null;
      this.lastDurationMs = Date.now() - startedAt;
      this.lastExitCode = 1;
      this.setState("failed");
      this.emit("data", `Failed to start ${this.agent.command}: ${error.message}\n`);
      this.emit("exit", { code: 1, signal: null, durationMs: this.lastDurationMs });
    });
    child.on("close", (code, signal) => {
      this.clearTurnTimer();
      this.child = null;
      this.lastDurationMs = Date.now() - startedAt;
      this.lastExitCode = code;
      this.lastSignal = signal;
      const output = cleanTurnOutput(stdout || stderr);
      if (output) this.emit("data", output);
      if (timedOut) {
        this.setState("timeout");
        this.emit("error-output", `${this.agent.command} timed out after ${formatDuration(this.agent.turnTimeoutMs)}`);
      } else if (code !== 0) {
        this.setState("failed");
        this.emit("error-output", `${this.agent.command} exited code=${code} signal=${signal || ""}`);
      } else {
        this.setState("idle");
      }
      this.emit("turn-exit", { code, signal, durationMs: this.lastDurationMs, timedOut });
    });
    child.stdin.end(String(text));
  }

  status() {
    return {
      id: this.agent.id,
      state: this.state,
      turns: this.turns,
      lastExitCode: this.lastExitCode,
      lastSignal: this.lastSignal,
      lastDurationMs: this.lastDurationMs,
      lastStartedAt: this.lastStartedAt
    };
  }

  setState(state) {
    this.state = state;
    this.emit("status", this.status());
  }

  clearTurnTimer() {
    if (!this.turnTimer) return;
    clearTimeout(this.turnTimer);
    this.turnTimer = null;
  }
}

export function cleanTerminalOutput(data) {
  return stripAnsi(String(data))
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\u0007/g, "");
}

export function cleanTurnOutput(data) {
  const output = extractCodexAnswer(cleanTerminalOutput(data));
  return output
    .split("\n")
    .filter((line) => !isNoiseLine(line))
    .join("\n")
    .trim();
}

function extractCodexAnswer(data) {
  const lines = String(data).split("\n");
  const codexIndex = lines.lastIndexOf("codex");
  if (codexIndex === -1) return data;

  const endIndex = lines.findIndex((line, index) => index > codexIndex && line.trim() === "tokens used");
  const answer = lines.slice(codexIndex + 1, endIndex === -1 ? undefined : endIndex).join("\n").trim();
  return answer || data;
}

function isNoiseLine(line) {
  const text = line.trim();
  if (!text) return false;
  return (
    /^Working\b/i.test(text) ||
    /^Thinking\b/i.test(text) ||
    /^Honking\b/i.test(text) ||
    /^\* ?Churned\b/i.test(text) ||
    /^\* .+ tokens?\)/i.test(text) ||
    /^\[Pasted text/i.test(text) ||
    /^OpenAI Codex\b/i.test(text) ||
    /^[-]{5,}$/.test(text) ||
    /^(workdir|model|provider|approval|sandbox|reasoning effort|reasoning summaries|session id):\b/i.test(text) ||
    /^user$/i.test(text) ||
    /^tokens used$/i.test(text) ||
    /^[\d,]+$/.test(text) ||
    /^Tip: /i.test(text)
  );
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

function formatDuration(ms = 0) {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)}s`;
}
