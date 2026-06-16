# Roadmap

Agent Deck is early, local-first infrastructure for coordinating coding agents.
This roadmap keeps the direction practical.

## Near Term

- Stronger CLI argument parsing with clear errors for unknown flags.
- CI examples that run `agent-deck validate` before starting a session.
- Better keyboard focus movement for three or more agent panes.
- Confirmation prompts for destructive transcript actions.
- Richer agent health display with timestamps and last stderr snippet.

## Agent Runtime

- Per-agent timeout presets and quick toggles.
- Optional command allowlists for test/git commands.
- Structured turn events in the transcript.
- Safer cancellation for long-running child processes.
- Provider-specific output cleaners behind explicit adapters.

## Collaboration

- Named task lanes such as `review`, `implement`, `research`.
- Route presets beyond review: implement, test, research, and architecture lanes.
- Session replay mode for reading a transcript inside the TUI, beyond CLI replay.
- Lightweight handoff summaries between agents.
- Blog draft refinement for publish-ready Chirpy posts with screenshots.
- Trend export snapshots for standups and changelog notes.

## Packaging

- Publish-ready npm package metadata.
- Installation docs for macOS, Linux, and Windows terminals.
- Screenshots or asciinema demo of the polished terminal cockpit.
- Example configs for Codex-only, Claude-only, and mixed local model setups.

## Product Principle

Agent Deck should stay small and inspectable. The core value is not replacing
agent CLIs; it is giving a developer one reliable cockpit for routing work,
tracking shared context, and keeping the session reproducible.
