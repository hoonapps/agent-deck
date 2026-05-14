# Agent Deck

Agent Deck is a local TUI workspace for coordinating multiple AI coding agents from one terminal. It runs existing CLIs such as Codex and Claude side by side, routes prompts to one or all agents, keeps a Markdown transcript, and shows git/test context in the same screen.

## Why

AI coding agents are useful, but real workflows often need a human to copy context between separate terminals. Agent Deck keeps those agent channels, git state, test output, and session notes in one local workspace.

## Features

- Run multiple interactive CLI agents in panes
- Send a prompt to the selected agent, a named agent, or every agent
- Keep a timestamped Markdown transcript under `.agent-deck/sessions`
- Show `git status --short` and `git diff --stat` in a live context panel
- Run the configured test command without leaving the TUI
- Configure agents per repository with `agent-deck.config.json`

## Install

```bash
npm install
npm link
agent-deck doctor
```

For local development without linking:

```bash
npm start
```

## Usage

Start Agent Deck inside the repository you want the agents to work on:

```bash
agent-deck
```

Use a custom session name:

```bash
agent-deck --session login-refactor
```

Create a repo-local config:

```bash
agent-deck init
```

## Shortcuts

| Key | Action |
| --- | --- |
| `F1`, `F2`, ... | Select an agent target |
| `F8` | Refresh git diff panel |
| `F10` | Run configured test command |
| `Ctrl+X` | Stop selected agent process |
| `Ctrl+C` | Quit |

## Composer Commands

| Command | Action |
| --- | --- |
| `/all <message>` | Send to every running agent |
| `/to <agent> <message>` | Send to one agent |
| `/focus <agent>` | Change active target |
| `/diff` | Refresh git panel |
| `/test [command]` | Run test command |
| `/restart <agent>` | Restart one agent process |
| `/clear <agent\|all>` | Clear output panes |
| `/help` | Show help |
| `/quit` | Exit |

Plain text is sent to the currently selected agent.

## Configuration

`agent-deck.config.json`:

```json
{
  "title": "Agent Deck",
  "testCommand": "npm test",
  "agents": [
    {
      "id": "codex",
      "name": "Codex",
      "command": "codex",
      "args": []
    },
    {
      "id": "claude",
      "name": "Claude",
      "command": "claude",
      "args": []
    }
  ]
}
```

Each agent runs in the current workspace by default. You can set `cwd`, `env`, `args`, and `autoStart: false` per agent.

## Development

```bash
npm install
npm test
npm run lint
```

## Status

This is an early working release. It is intentionally local-first and wraps the CLIs you already use instead of proxying model APIs.
