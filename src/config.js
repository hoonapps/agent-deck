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
    turnTimeoutMs: 300000,
    testCommand: "npm test",
    reviewAgents: [],
    rolePresets: defaultRolePresets(),
    agents: [
      { id: "codex", name: "Codex", command: "codex", mode: "turn", args: defaultCodexTurnArgs(), cwd },
      { id: "claude", name: "Claude", command: "claude", mode: "turn", args: ["--print", "--output-format", "text"], cwd }
    ]
  };
}

export function loadConfig({ configPath, sessionName, modelOverrides = {}, cwd = process.cwd() } = {}) {
  const defaults = defaultConfig(cwd);
  const discovered = configPath ? resolve(cwd, configPath) : findConfigFile(cwd);
  const userConfig = discovered ? readJson(discovered) : {};
  const workspace = resolve(cwd, userConfig.workspace || defaults.workspace);
  const transcriptDir = resolve(workspace, userConfig.transcriptDir || defaults.transcriptDir);
  const turnTimeoutMs = nonNegativeInteger(userConfig.turnTimeoutMs ?? defaults.turnTimeoutMs, "turnTimeoutMs");
  const rolePresets = normalizeRolePresets({ ...defaults.rolePresets, ...(userConfig.rolePresets || {}) });
  const agents = (userConfig.agents || defaults.agents).map((agent, index) => {
    const overrideId = normalizeId(agent.id || agent.name || `agent-${index + 1}`);
    return normalizeAgent(
      { ...agent, model: modelForAgent(agent, overrideId, modelOverrides) },
      workspace,
      index,
      { turnTimeoutMs }
    );
  });
  validateAgents(agents);

  return {
    ...defaults,
    ...userConfig,
    configPath: discovered,
    workspace,
    transcriptDir,
    sessionName: sanitizeSessionName(sessionName || userConfig.sessionName || timestampName()),
    shareHistory: userConfig.shareHistory ?? defaults.shareHistory,
    maxHistoryChars: positiveInteger(userConfig.maxHistoryChars ?? defaults.maxHistoryChars, "maxHistoryChars"),
    turnTimeoutMs,
    testCommand: userConfig.testCommand ?? defaults.testCommand,
    reviewAgents: normalizeReviewAgents(userConfig.reviewAgents || defaults.reviewAgents),
    rolePresets,
    agents
  };
}

export function normalizeAgent(agent, workspace, index = 0, defaults = {}) {
  if (!agent || typeof agent !== "object") {
    throw new Error(`Invalid agent at index ${index}`);
  }
  if (!agent.command || typeof agent.command !== "string") {
    throw new Error(`Agent ${agent.id || index} must define a command`);
  }
  const id = normalizeId(agent.id || agent.name || `agent-${index + 1}`);
  if (!id) {
    throw new Error(`Agent at index ${index} must have a non-empty id or name`);
  }
  const model = typeof agent.model === "string" && agent.model.trim() ? agent.model.trim() : undefined;
  const mode = agent.mode === "interactive" ? "interactive" : "turn";
  const rawArgs = normalizedArgs(agent, id, mode);
  const aliases = normalizeAliases(id, agent.aliases);
  return {
    id,
    name: agent.name || id,
    label: model ? `${agent.name || id} [${model}]` : agent.name || id,
    command: agent.command,
    mode,
    args: argsWithModel(rawArgs, model, agent.modelArg),
    baseArgs: rawArgs,
    model,
    modelArg: agent.modelArg === false ? false : agent.modelArg || "--model",
    role: typeof agent.role === "string" && agent.role.trim() ? normalizeId(agent.role) : undefined,
    turnTimeoutMs: nonNegativeInteger(agent.turnTimeoutMs ?? defaults.turnTimeoutMs ?? 0, `Agent ${id} turnTimeoutMs`),
    bracketedPaste: agent.bracketedPaste !== false,
    aliases,
    cwd: resolve(workspace, agent.cwd || "."),
    env: agent.env && typeof agent.env === "object" ? agent.env : {},
    autoStart: agent.autoStart !== false
  };
}

export function validateAgents(agents) {
  if (!Array.isArray(agents) || agents.length === 0) {
    throw new Error("Configuration must define at least one agent");
  }

  const ids = new Set();
  const aliases = new Map();
  for (const agent of agents) {
    if (ids.has(agent.id)) {
      throw new Error(`Duplicate agent id "${agent.id}"`);
    }
    ids.add(agent.id);

    for (const alias of agent.aliases) {
      const owner = aliases.get(alias);
      if (owner && owner !== agent.id) {
        throw new Error(`Alias "${alias}" is used by both "${owner}" and "${agent.id}"`);
      }
      aliases.set(alias, agent.id);
    }
  }
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
    case "status":
      return { type: "status" };
    case "review":
      return { type: "review", message: tail };
    case "export":
      return { type: "export", name: tail || undefined };
    case "findings":
      return { type: "findings", name: tail || undefined };
    case "timeout":
      return { type: "timeout", target: rest[0], value: rest[1] };
    case "record":
      return { type: "record", value: rest[0] };
    case "redact-last":
    case "redact":
      return { type: "redact-last" };
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
  return [...new Set([...preferred, id].map(normalizeId).filter(Boolean))];
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

function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return parsed;
}

function nonNegativeInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return parsed;
}

function normalizeReviewAgents(values = []) {
  if (!Array.isArray(values)) return [];
  return values.map(normalizeId).filter(Boolean);
}

function normalizeRolePresets(presets = {}) {
  const normalized = {};
  for (const [key, value] of Object.entries(presets)) {
    const id = normalizeId(key);
    if (id && typeof value === "string" && value.trim()) normalized[id] = value.trim();
  }
  return normalized;
}

function defaultRolePresets() {
  return {
    implementer: "You are the implementer. Make the smallest correct code change, keep tests focused, and avoid unrelated refactors.",
    reviewer: "You are the reviewer. Prioritize correctness, regressions, missing tests, security, and maintainability. Lead with actionable findings.",
    tester: "You are the tester. Identify verification gaps, edge cases, and the fastest commands that prove the change works.",
    architect: "You are the architect. Focus on system boundaries, operational risk, data flow, and long-term maintainability."
  };
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
  const marker = args.lastIndexOf("-");
  const modelArgs = [modelArg || "--model", model];
  if (marker >= 0) return [...args.slice(0, marker), ...modelArgs, ...args.slice(marker)];
  return [...args, ...modelArgs];
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

function normalizedArgs(agent, id, mode) {
  const args = Array.isArray(agent.args) ? agent.args.map(String) : [];
  if (mode !== "turn" || args.length > 0) return args;
  if (id === "codex" || agent.command === "codex") return defaultCodexTurnArgs();
  if (id === "claude" || agent.command === "claude") return ["--print", "--output-format", "text"];
  return args;
}

function defaultCodexTurnArgs() {
  return ["exec", "--color", "never", "--skip-git-repo-check", "-"];
}
