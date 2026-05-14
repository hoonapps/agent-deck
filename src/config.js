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
    shareHistory: true,
    maxHistoryChars: 6000,
    testCommand: "npm test",
    agents: [
      { id: "codex", name: "Codex", command: "codex", args: [], cwd },
      { id: "claude", name: "Claude", command: "claude", args: [], cwd }
    ]
  };
}

export function loadConfig({ configPath, sessionName, modelOverrides = {}, cwd = process.cwd() } = {}) {
  const defaults = defaultConfig(cwd);
  const discovered = configPath ? resolve(cwd, configPath) : findConfigFile(cwd);
  const userConfig = discovered ? readJson(discovered) : {};
  const workspace = resolve(cwd, userConfig.workspace || defaults.workspace);
  const transcriptDir = resolve(workspace, userConfig.transcriptDir || defaults.transcriptDir);
  const agents = (userConfig.agents || defaults.agents).map((agent, index) => {
    const overrideId = normalizeId(agent.id || agent.name || `agent-${index + 1}`);
    return normalizeAgent({ ...agent, model: modelForAgent(agent, overrideId, modelOverrides) }, workspace, index);
  });

  return {
    ...defaults,
    ...userConfig,
    configPath: discovered,
    workspace,
    transcriptDir,
    sessionName: sanitizeSessionName(sessionName || userConfig.sessionName || timestampName()),
    shareHistory: userConfig.shareHistory ?? defaults.shareHistory,
    maxHistoryChars: userConfig.maxHistoryChars ?? defaults.maxHistoryChars,
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
  const model = typeof agent.model === "string" && agent.model.trim() ? agent.model.trim() : undefined;
  const rawArgs = Array.isArray(agent.args) ? agent.args.map(String) : [];
  const aliases = normalizeAliases(id, agent.aliases);
  return {
    id,
    name: agent.name || id,
    label: model ? `${agent.name || id} [${model}]` : agent.name || id,
    command: agent.command,
    args: argsWithModel(rawArgs, model, agent.modelArg),
    baseArgs: rawArgs,
    model,
    modelArg: agent.modelArg === false ? false : agent.modelArg || "--model",
    bracketedPaste: agent.bracketedPaste !== false,
    aliases,
    cwd: resolve(workspace, agent.cwd || "."),
    env: agent.env && typeof agent.env === "object" ? agent.env : {},
    autoStart: agent.autoStart !== false
  };
}

export function parseComposerCommand(input, agentIds = []) {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) {
    return { type: "note", message: input };
  }

  const [command, ...rest] = splitArgs(trimmed.slice(1));
  const tail = rest.join(" ");
  const normalizedCommand = (command || "").toLowerCase();
  if (agentIds.includes(normalizedCommand)) {
    return { type: "send-to", target: normalizedCommand, message: tail };
  }
  switch (normalizedCommand) {
    case "all":
      return { type: "send-all", message: tail };
    case "to":
      return { type: "send-to", target: rest[0], message: rest.slice(1).join(" ") };
    case "git":
      return { type: "git" };
    case "history":
      return { type: "history" };
    case "test":
      return { type: "test", command: tail || undefined };
    case "restart":
      return { type: "restart", target: rest[0] };
    case "clear":
      return { type: "clear", target: rest[0] || "current" };
    case "models":
      return { type: "models" };
    case "set-model":
    case "use-model":
      return { type: "set-model", target: rest[0], model: rest.slice(1).join(" ") };
    case "exit-chat":
    case "route-off":
      return { type: "exit-chat" };
    case "help":
      return { type: "help" };
    case "quit":
    case "exit":
      return { type: "quit" };
    default:
      return { type: "unknown", command, rest, raw: input };
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

function normalizeAliases(id, aliases = []) {
  const defaultAliases = id === "codex" ? ["co"] : id === "claude" ? ["cl"] : [id.slice(0, 2)];
  const preferred = aliases.length ? aliases : defaultAliases;
  return [...new Set([...preferred, ...defaultAliases, id].map(normalizeId).filter(Boolean))];
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

export function parseModelOverrides(values = []) {
  const overrides = {};
  for (const value of values) {
    for (const pair of String(value).split(",")) {
      const [agent, ...modelParts] = pair.split("=");
      const model = modelParts.join("=");
      if (agent?.trim() && model?.trim()) {
        overrides[normalizeId(agent)] = model.trim();
      }
    }
  }
  return overrides;
}

export function runtimeSetAgentModel(agent, model) {
  const normalizedModel = typeof model === "string" && model.trim() ? model.trim() : undefined;
  agent.model = normalizedModel;
  agent.args = argsWithModel(agent.baseArgs || [], normalizedModel, agent.modelArg);
  agent.label = normalizedModel ? `${agent.name} [${normalizedModel}]` : agent.name;
  return agent;
}

function argsWithModel(args, model, modelArg = "--model") {
  if (!model || modelArg === false || hasModelArg(args)) return args;
  return [...args, modelArg || "--model", model];
}

function hasModelArg(args) {
  return args.some((arg) => arg === "--model" || arg === "-m");
}

export function packageRoot() {
  return dirname(dirname(fileURLToPath(import.meta.url)));
}

function modelForAgent(agent, id, overrides) {
  if (Object.hasOwn(overrides, id)) return overrides[id];
  if (typeof agent.model === "string" && agent.model.trim()) return agent.model.trim();
  return process.env[modelEnvName(id)] || undefined;
}

function modelEnvName(id) {
  return `AGENT_DECK_${id.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_MODEL`;
}
