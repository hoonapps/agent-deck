#!/usr/bin/env node

import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { createApp } from "../src/app.js";
import { findExecutable, loadConfig } from "../src/config.js";

const args = process.argv.slice(2);

function printHelp() {
  console.log(`agent-deck

Local TUI workspace for coordinating Codex, Claude, shell, git, and tests.

Usage:
  agent-deck [--config agent-deck.config.json] [--session name]
  agent-deck doctor
  agent-deck init

Shortcuts:
  F1/F2/...     Select agent target
  F8           Refresh git diff
  F10          Run configured test command
  Ctrl+X       Stop selected agent
  Ctrl+C       Quit

Composer commands:
  /all <msg>              Send a message to every running agent
  /to <agent> <msg>       Send a message to one agent
  /focus <agent>          Change active target
  /diff                   Refresh git diff panel
  /test [command]         Run test command in the activity panel
  /restart <agent>        Restart one agent process
  /clear <agent|all>      Clear output
  /help                   Show command help
`);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

async function doctor() {
  const config = loadConfig({ configPath: valueAfter("--config"), cwd: process.cwd() });
  console.log(`Workspace: ${config.workspace}`);
  console.log(`Transcript dir: ${config.transcriptDir}`);
  console.log("");
  for (const agent of config.agents) {
    const found = await findExecutable(agent.command);
    console.log(`${found ? "✓" : "✕"} ${agent.id}: ${agent.command}${found ? ` (${found})` : " (not found)"}`);
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
        agents: [
          { id: "codex", name: "Codex", command: "codex", args: [] },
          { id: "claude", name: "Claude", command: "claude", args: [] }
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
} else if (args[0] === "init") {
  initConfig();
} else {
  const config = loadConfig({
    configPath: valueAfter("--config"),
    sessionName: valueAfter("--session"),
    cwd: process.cwd()
  });
  createApp(config).start();
}
