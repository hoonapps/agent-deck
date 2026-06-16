import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import process from "node:process";
import { findExecutable, runtimeSetAgentModel } from "./config.js";

const PROVIDERS = {
  codex: {
    label: "Codex",
    statusArgs: ["login", "status"],
    loginArgs: ["login"],
    models: ["provider default", "gpt-5-codex", "gpt-5", "o3"]
  },
  claude: {
    label: "Claude",
    statusArgs: ["auth", "status"],
    loginArgs: ["auth", "login"],
    models: ["provider default", "sonnet", "opus", "fable"]
  }
};

export async function runPreflight({ config, selectModels = false, loginMissing = true, stdin = process.stdin, stdout = process.stdout } = {}) {
  if (!config?.agents?.length) return config;
  const interactive = Boolean(stdin.isTTY && stdout.isTTY);
  const rl = interactive ? createInterface({ input: stdin, output: stdout }) : null;

  try {
    stdout.write("Agent Deck preflight\n");
    for (const agent of config.agents) {
      await checkAgentPreflight({ agent, rl, interactive, loginMissing, stdout });
    }
    if (selectModels && interactive) {
      for (const agent of config.agents) {
        await selectAgentModel({ agent, rl, stdout });
      }
    } else if (selectModels) {
      stdout.write("Model selection needs an interactive terminal. Skipped.\n");
    }
    stdout.write("\n");
    return config;
  } finally {
    rl?.close();
  }
}

export async function checkAgentPreflight({ agent, rl, interactive, loginMissing, stdout = process.stdout }) {
  const provider = providerForAgent(agent);
  const executable = await findExecutable(agent.command);
  if (!executable) {
    stdout.write(`- ${agent.id}: command not found (${agent.command})\n`);
    return { ok: false, reason: "missing-command" };
  }
  if (!provider) {
    stdout.write(`- ${agent.id}: command found, no auth preflight adapter\n`);
    return { ok: true, reason: "no-adapter" };
  }

  const status = readAuthStatus(agent, provider);
  if (status.loggedIn) {
    stdout.write(`- ${agent.id}: ${provider.label} logged in\n`);
    return { ok: true, reason: "logged-in" };
  }

  stdout.write(`- ${agent.id}: ${provider.label} login required\n`);
  stdout.write(`  Run: ${agent.command} ${provider.loginArgs.join(" ")}\n`);
  if (!interactive || !loginMissing) {
    return { ok: false, reason: "login-required" };
  }

  const shouldLogin = await askYesNo(rl, `  Start ${provider.label} login now? [y/N] `);
  if (!shouldLogin) return { ok: false, reason: "login-skipped" };

  const result = spawnSync(agent.command, provider.loginArgs, {
    cwd: agent.cwd,
    env: { ...process.env, ...agent.env },
    stdio: "inherit"
  });
  if (result.status !== 0) {
    stdout.write(`  Login command exited with ${result.status ?? result.signal ?? "unknown"}.\n`);
    return { ok: false, reason: "login-failed" };
  }

  const after = readAuthStatus(agent, provider);
  stdout.write(after.loggedIn ? `  ${provider.label} login confirmed.\n` : `  ${provider.label} still looks logged out.\n`);
  return { ok: after.loggedIn, reason: after.loggedIn ? "login-confirmed" : "login-unconfirmed" };
}

export async function selectAgentModel({ agent, rl, stdout = process.stdout }) {
  const provider = providerForAgent(agent);
  const choices = modelChoices(agent, provider);
  stdout.write(`\n${agent.name} model\n`);
  choices.forEach((choice, index) => {
    const current = choice.value === (agent.model || "") ? " current" : "";
    stdout.write(`  ${index + 1}) ${choice.label}${current}\n`);
  });
  const model = await askModelSelection({ agent, choices, rl, stdout });
  runtimeSetAgentModel(agent, model || undefined);
  stdout.write(`  using ${agent.model || "provider default"}\n`);
  return agent;
}

export function providerForAgent(agent = {}) {
  const value = `${agent.id || ""} ${agent.command || ""}`.toLowerCase();
  if (value.includes("codex")) return PROVIDERS.codex;
  if (value.includes("claude")) return PROVIDERS.claude;
  return null;
}

export function readAuthStatus(agent, provider = providerForAgent(agent)) {
  if (!provider) return { loggedIn: true, output: "" };
  const result = spawnSync(agent.command, provider.statusArgs, {
    cwd: agent.cwd,
    env: { ...process.env, ...agent.env },
    encoding: "utf8",
    timeout: 15000
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();
  return parseAuthStatus(provider, result.status, output);
}

export function parseAuthStatus(provider, statusCode, output = "") {
  if (/not\s+logged\s+in|logged\s+out|unauthenticated/i.test(output)) {
    return { loggedIn: false, output };
  }
  if (provider === PROVIDERS.claude || provider?.label === "Claude") {
    try {
      const parsed = JSON.parse(output);
      return { loggedIn: Boolean(parsed.loggedIn), output };
    } catch {
      return { loggedIn: statusCode === 0 && /logged\s*in|authenticated/i.test(output), output };
    }
  }
  return { loggedIn: statusCode === 0 && /logged\s*in|authenticated|using chatgpt/i.test(output), output };
}

export function modelChoices(agent = {}, provider = providerForAgent(agent)) {
  const values = new Set([""]);
  if (agent.model) values.add(agent.model);
  for (const model of provider?.models || []) {
    values.add(model === "provider default" ? "" : model);
  }
  return [...values].map((value) => ({ value, label: value || "provider default" }));
}

export function resolveModelSelection(answer, choices = [], currentModel = "") {
  const value = String(answer || "").trim();
  if (!value) return { ok: true, model: currentModel || "", action: "keep" };
  if (/^(default|provider default)$/i.test(value)) return { ok: true, model: "", action: "default" };
  if (/^\d+$/.test(value)) {
    const choice = choices[Number(value) - 1];
    if (!choice) return { ok: false, message: `Choose a number from 1 to ${choices.length}, or type a model name.` };
    return { ok: true, model: choice.value, action: "choice" };
  }
  return { ok: true, model: value, action: "custom" };
}

async function askModelSelection({ agent, choices, rl, stdout }) {
  while (true) {
    const answer = await rl.question("Select number, 'default', or type custom model. Enter keeps current/default: ");
    const selection = resolveModelSelection(answer, choices, agent.model || "");
    if (selection.ok) {
      if (selection.action === "keep") stdout.write(`  keeping ${selection.model || "provider default"}\n`);
      return selection.model;
    }
    stdout.write(`  ${selection.message}\n`);
  }
}

async function askYesNo(rl, question) {
  const answer = (await rl.question(question)).trim().toLowerCase();
  return answer === "y" || answer === "yes";
}
