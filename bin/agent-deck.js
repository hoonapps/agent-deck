#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createApp } from "../src/app.js";
import { writeBlogDraft } from "../src/blog.js";
import { findExecutable, loadConfig, parseModelOverrides } from "../src/config.js";

const args = process.argv.slice(2);

function printHelp() {
  console.log(`agent-deck

Local TUI workspace for coordinating Codex, Claude, shell, git, and tests.

Usage:
  agent-deck [--config agent-deck.config.json] [--session name]
             [--model codex=gpt-5.3-codex] [--codex-model gpt-5.3-codex] [--claude-model sonnet]
  agent-deck doctor
  agent-deck validate
  agent-deck blog <transcript.md> [--out draft.md] [--title "Post title"]
  agent-deck init

Shortcuts:
  F8           Refresh history panel
  F10          Run configured test command
  Ctrl+X       Stop selected agent
  Ctrl+C       Quit

Composer commands:
  /co [msg]               Enter Codex chat or send to Codex
  /cl [msg]               Enter Claude chat or send to Claude
  /all <msg>              Send a message to every running agent
  /to <agent> <msg>       Send a message to one agent and enter that chat
  /git                    Show git status in Activity
  /test [command]         Run test command in the activity panel
  /status                 Show agent state and last turn result
  /review <msg>           Send a review prompt to reviewer agents
  /export [name]          Export a Markdown session summary
  /timeout <agent> <ms>   Set a turn timeout while running
  /record <on|off>        Pause or resume transcript recording
  /redact-last            Remove the last transcript record
  /restart <agent>        Restart one agent process
  /clear <agent|all>      Clear output
  /models                 List current agent models
  /set-model <agent> <m>  Set a model and restart that agent
  /exit-chat              Leave the current agent chat
  /help                   Show command help

Default clean mode shows only your message and the final answer.
Set mode="interactive" in config if you want the raw provider TUI.
`);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function valuesAfter(flag) {
  const values = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === flag && args[index + 1]) values.push(args[index + 1]);
  }
  return values;
}

async function doctor() {
  const config = loadConfig({
    configPath: valueAfter("--config"),
    modelOverrides: cliModelOverrides(),
    cwd: process.cwd()
  });
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Transcript dir: ${config.transcriptDir}`);
  console.log("");
  for (const agent of config.agents) {
    const found = await findExecutable(agent.command);
    const model = agent.model ? ` model=${agent.model}` : "";
    console.log(`${found ? "✓" : "✕"} ${agent.id}: ${agent.command}${model}${found ? ` (${found})` : " (not found)"}`);
  }
  console.log("");
  console.log(`Test command: ${config.testCommand || "(none)"}`);
}

function initConfig() {
  const target = resolve(process.cwd(), "agent-deck.config.json");
  if (existsSync(target)) {
    console.error("agent-deck.config.json already exists");
    process.exitCode = 1;
    return;
  }
  writeFileSync(
    target,
    `${JSON.stringify(
      {
        title: "Agent Deck",
        testCommand: "npm test",
        shareHistory: true,
        maxHistoryChars: 6000,
        turnTimeoutMs: 300000,
        reviewAgents: ["codex", "claude"],
        rolePresets: {
          reviewer: "Find correctness, regression, test, and security issues first."
        },
        agents: [
          {
            id: "codex",
            aliases: ["co"],
            name: "Codex",
            command: "codex",
            mode: "turn",
            role: "implementer",
            model: "gpt-5.3-codex",
            args: []
          },
          {
            id: "claude",
            aliases: ["cl"],
            name: "Claude",
            command: "claude",
            mode: "turn",
            role: "reviewer",
            model: "sonnet",
            args: []
          }
        ]
      },
      null,
      2
    )}\n`
  );
  console.log(`Created ${target}`);
}

if (args.includes("-h") || args.includes("--help")) {
  printHelp();
} else if (args[0] === "doctor") {
  await doctor();
} else if (args[0] === "validate") {
  validateConfig();
} else if (args[0] === "blog") {
  blogDraft();
} else if (args[0] === "init") {
  initConfig();
} else {
  const config = loadConfig({
    configPath: valueAfter("--config"),
    sessionName: valueAfter("--session"),
    modelOverrides: cliModelOverrides(),
    cwd: process.cwd()
  });
  createApp(config).start();
}

function cliModelOverrides() {
  return {
    ...parseModelOverrides(valuesAfter("--model")),
    ...singleModelOverride("codex", "--codex-model"),
    ...singleModelOverride("claude", "--claude-model")
  };
}

function validateConfig() {
  const config = loadConfig({
    configPath: valueAfter("--config"),
    sessionName: valueAfter("--session"),
    modelOverrides: cliModelOverrides(),
    cwd: process.cwd()
  });
  console.log(`✓ config ok: ${config.configPath || "(defaults)"}`);
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Agents: ${config.agents.map((agent) => agent.id).join(", ")}`);
}

function blogDraft() {
  const transcriptPath = args[1];
  if (!transcriptPath) {
    console.error("Usage: agent-deck blog <transcript.md> [--out draft.md] [--title title]");
    process.exitCode = 1;
    return;
  }
  const outPath = valueAfter("--out");
  const title = valueAfter("--title");
  const target = writeBlogDraft({ transcriptPath, outPath, title });
  console.log(`Created ${target}`);
}

function singleModelOverride(agent, flag) {
  const model = valueAfter(flag);
  return model ? { [agent]: model } : {};
}
