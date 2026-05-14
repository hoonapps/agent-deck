# Agent Deck

Agent Deck is a local TUI workspace for coordinating multiple AI coding agents from one terminal. It runs existing CLIs such as Codex and Claude side by side, routes prompts by chat command, keeps a Markdown transcript, and can inject recent shared history into the next agent turn.

## Why

AI coding agents are useful, but real workflows often need a human to copy context between separate terminals. Agent Deck keeps those agent channels, test output, and shared session history in one local workspace.

## Features

- Run multiple agent chats in one fixed-screen TUI
- Default to clean turn mode so panes show only `You:` and the agent answer, not provider prompts or terminal status text
- Enter an agent chat with `/co` or `/cl`, then send plain messages there
- Send a prompt to one named agent or every agent
- Keep a timestamped Markdown transcript under `.agent-deck/sessions`
- Show recent shared history in a live context panel
- Optionally inject recent history into each routed message so another agent can join midstream
- Run the configured test command without leaving the TUI
- Set each agent model through config, environment variables, short launch flags, or `/set-model`
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

Most users should save model defaults in `agent-deck.config.json` with `agent-deck init`. For one-off overrides, use either the generic flag or the short flags:

```bash
agent-deck --model codex=gpt-5.3-codex --model claude=sonnet
agent-deck --codex-model gpt-5.3-codex --claude-model sonnet
```

Create a repo-local config:

```bash
agent-deck init
```

## Shortcuts

| Key | Action |
| --- | --- |
| `F8` | Refresh history panel |
| `F10` | Run configured test command |
| `Ctrl+X` | Stop active agent process |
| `Ctrl+C` | Quit |

## Composer Commands

| Command | Action |
| --- | --- |
| `/co [message]` | Enter Codex chat or send to Codex |
| `/cl [message]` | Enter Claude chat or send to Claude |
| `/all <message>` | Send to every running agent |
| `/to <agent> <message>` | Send to one agent and enter that chat |
| `/git` | Show git status in Activity |
| `/history` | Refresh history panel |
| `/test [command]` | Run test command |
| `/restart <agent>` | Restart one agent process |
| `/clear <agent\|all>` | Clear output panes |
| `/models` | Show current agent models |
| `/set-model <agent> <model>` | Set a model and restart that agent |
| `/exit-chat` | Leave the active agent chat |
| `/help` | Show help |
| `/quit` | Exit |

Plain text is sent to the active agent chat. There is no active chat at startup, so accidental text is not sent anywhere until you route with `/co`, `/cl`, or `/to`.

By default Agent Deck uses clean turn mode. Codex is called through `codex exec`, and Claude is called through `claude --print`, so provider UI noise is not rendered into the pane. If you want the raw interactive CLI instead, set `mode: "interactive"` for that agent.

## Configuration

`agent-deck.config.json`:

```json
{
  "title": "Agent Deck",
  "testCommand": "npm test",
  "shareHistory": true,
  "maxHistoryChars": 6000,
  "agents": [
    {
      "id": "codex",
      "aliases": ["co"],
      "name": "Codex",
      "command": "codex",
      "mode": "turn",
      "model": "gpt-5.3-codex",
      "args": []
    },
    {
      "id": "claude",
      "aliases": ["cl"],
      "name": "Claude",
      "command": "claude",
      "mode": "turn",
      "model": "sonnet",
      "args": []
    }
  ]
}
```

Each agent runs in the current workspace by default. You can set `cwd`, `env`, `args`, `mode`, `model`, `modelArg`, `aliases`, `bracketedPaste`, and `autoStart: false` per agent.

Model precedence is:

```text
CLI flag > config model > AGENT_DECK_<AGENT>_MODEL > provider default
```

Useful environment variables:

```bash
export AGENT_DECK_CODEX_MODEL=gpt-5.3-codex
export AGENT_DECK_CLAUDE_MODEL=sonnet
```

Change a running agent from inside the TUI:

```text
/models
/set-model codex gpt-5.3-codex
/set-model claude sonnet
```

For clean turn mode, leave `args` empty and Agent Deck will use the right default:

```text
codex exec --color never -
claude --print --output-format text
```

To use raw interactive CLI behavior, set `mode: "interactive"` and keep the native CLI command in `args`:

```json
{
  "id": "codex",
  "command": "codex",
  "mode": "interactive",
  "args": ["resume", "--last"],
  "model": "gpt-5.3-codex"
}
```

```json
{
  "id": "claude",
  "command": "claude",
  "mode": "interactive",
  "args": ["--resume"],
  "model": "sonnet"
}
```

## Development

```bash
npm install
npm test
npm run lint
```

## Status

This is an early working release. It is intentionally local-first and wraps the CLIs you already use instead of proxying model APIs.
