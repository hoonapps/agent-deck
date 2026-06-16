# Roadmap

Agent Deck is early, local-first infrastructure for coordinating coding agents.
This roadmap keeps the direction practical.

## Near Term

- Stronger CLI argument parsing with clear errors for unknown flags.
- CI examples that run `agent-deck validate` before starting a session.
- Configurable pane layouts for more than two agents.
- Better transcript controls: pause recording, redact last entry, export summary.
- Agent health display: running, idle, turn running, last exit code.

## Agent Runtime

- Per-agent timeout for turn mode.
- Optional command allowlists for test/git commands.
- Structured turn events in the transcript.
- Safer cancellation for long-running child processes.
- Provider-specific output cleaners behind explicit adapters.

## Collaboration

- Named task lanes such as `review`, `implement`, `research`.
- Route presets: send the same prompt to reviewer agents only.
- Session replay mode for reading a transcript in the TUI.
- Lightweight handoff summaries between agents.

## Packaging

- Publish-ready npm package metadata.
- Installation docs for macOS, Linux, and Windows terminals.
- Screenshots or asciinema demo.
- Example configs for Codex-only, Claude-only, and mixed local model setups.

## Product Principle

Agent Deck should stay small and inspectable. The core value is not replacing
agent CLIs; it is giving a developer one reliable cockpit for routing work,
tracking shared context, and keeping the session reproducible.
