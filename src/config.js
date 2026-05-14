import { access, constants } from "node:fs/promises";
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import process from "node:process";

const DEFAULT_CONFIG_FILES = ["agent-deck.config.json", ".agent-deck.json"];

export function defaultConfig(cwd = process.cwd()) {
  return {
    title: "Agent Deck",
    workspace: cwd,
    transcriptDir: join(cwd, ".agent-deck", "sessions"),
    testCommand: "npm test",
    agents: [
      { id: "codex", name: "Codex", command: "codex", args: [], cwd },
      { id: "claude", name: "Claude", command: "claude", args: [], cwd }
    ]
  };
}

export function loadConfig({ configPath, sessionName, cwd = process.cwd() } = {}) {
  const defaults = defaultConfig(cwd);
  const discovered = configPath ? resolve(cwd, configPath) : findConfigFile(cwd);
  const userConfig = discovered ? readJson(discovered) : {};
  const workspace = resolve(cwd, userConfig.workspace || defaults.workspace);
  const transcriptDir = resolve(workspace, userConfig.transcriptDir || defaults.transcriptDir);
  const agents = (userConfig.agents || defaults.agents).map((agent, index) =>
    normalizeAgent(agent, workspace, index)
  );

  return {
    ...defaults,
    ...userConfig,
    configPath: discovered,
    workspace,
    transcriptDir,
    sessionName: sanitizeSessionName(sessionName || userConfig.sessionName || timestampName()),
    testCommand: userConfig.testCommand ?? defaults.testCommand,
    agents
  };
}

export function normalizeAgent(agent, workspace, index = 0) {
  if (!agent || typeof agent !== "object") {
    throw new Error(`Invalid agent at index ${index}`);
  }
  if (!agent.command || typeof agent.command !== "string") {
    throw new Error(`Agent ${agent.id || index} must define a command`);
  }
  const id = normalizeId(agent.id || agent.name || `agent-${index + 1}`);
  return {
    id,
    name: agent.name || id,
    command: agent.command,
    args: Array.isArray(agent.args) ? agent.args.map(String) : [],
    cwd: resolve(workspace, agent.cwd || "."),
    env: agent.env && typeof agent.env === "object" ? agent.env : {},
    autoStart: agent.autoStart !== false
  };
}

export function parseComposerCommand(input) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { type: "send", message: input };
  }

  const [command, ...rest] = splitArgs(trimmed.slice(1));
  const tail = rest.join(" ");
  switch ((command || "").toLowerCase()) {
    case "all":
      return { type: "send-all", message: tail };
    case "to":
      return { type: "send-to", target: rest[0], message: rest.slice(1).join(" ") };
    case "focus":
      return { type: "focus", target: rest[0] };
    case "diff":
      return { type: "diff" };
    case "test":
      return { type: "test", command: tail || undefined };
    case "restart":
      return { type: "restart", target: rest[0] };
    case "clear":
      return { type: "clear", target: rest[0] || "current" };
    case "help":
      return { type: "help" };
    case "quit":
    case "exit":
      return { type: "quit" };
    default:
      return { type: "unknown", command, raw: input };
  }
}

export async function findExecutable(command) {
  const candidates = executableCandidates(command);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Continue searching.
    }
  }
  return null;
}

function findConfigFile(cwd) {
  for (const name of DEFAULT_CONFIG_FILES) {
    const candidate = resolve(cwd, name);
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`Could not read ${path}: ${error.message}`);
  }
}

function executableCandidates(command) {
  if (command.includes("/") || isAbsolute(command)) {
    return [resolve(command)];
  }
  const pathValue = process.env.PATH || "";
  const names = process.platform === "win32" ? [command, `${command}.cmd`, `${command}.exe`] : [command];
  return pathValue.split(":").flatMap((dir) => names.map((name) => join(dir, name)));
}

function normalizeId(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function sanitizeSessionName(value) {
  return String(value)
    .trim()
    .replace(/[^a-zA-Z0-9_.-]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function timestampName() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}

function splitArgs(input) {
  return input.match(/(?:[^\s"]+|"[^"]*")+/g)?.map((part) => part.replace(/^"|"$/g, "")) || [];
}

export function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}
