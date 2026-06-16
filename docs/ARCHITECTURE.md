# Architecture Notes

Agent Deck is a local terminal application. It does not proxy model APIs and it
does not store provider credentials. Each agent is an existing CLI process that
runs in the selected workspace.

## Components

| Component | File | Responsibility |
| --- | --- | --- |
| CLI entrypoint | `bin/agent-deck.js` | Parse launch commands, create default config, run `doctor`, start the TUI. |
| Config loader | `src/config.js` | Discover config files, normalize agents, apply model overrides, validate routing. |
| TUI app | `src/app.js` | Render panes, route messages, run tests/git commands, coordinate transcript/history. |
| Agent process | `src/agent.js` | Spawn turn-mode child processes or interactive PTYs. Clean provider output. |
| Transcript | `src/transcript.js` | Write Markdown session logs and build shared context snippets. |
| Git/test helpers | `src/git.js` | Run shell commands in the workspace and summarize output. |

## Message Flow

1. The user types into the composer.
2. `parseComposerCommand` classifies the input as a command or plain note.
3. `/co`, `/cl`, `/to`, and `/all` resolve to configured agent ids or aliases.
4. If `shareHistory` is enabled, recent transcript context is prepended.
5. `AgentProcess.writeLine` sends the message to the agent.
6. Agent output is appended to the pane and transcript.
7. The history panel is rebuilt from recent transcript entries.

Plain text only goes to an agent after the user enters an active chat route. This
prevents accidental prompts from being sent at startup.

## Turn Mode vs Interactive Mode

Turn mode launches a fresh child process for each message:

```text
message -> child stdin -> stdout/stderr -> cleaned answer
```

This is good for readable panes, deterministic transcripts, and short review
turns.

Interactive mode keeps a PTY process running:

```text
message -> pty write -> provider-native terminal output
```

This is useful when a provider CLI has stateful interactive behavior, but it is
noisier and more dependent on terminal UI changes.

## Shared History

Agent Deck writes every session to Markdown under `.agent-deck/sessions`.
When `shareHistory` is enabled, recent transcript entries are injected into the
next routed agent turn:

```text
Agent Deck shared conversation history follows...

[time] input -> codex
...

Current message for Claude:
...
```

This lets a second agent join a conversation without manual copy/paste. The
tradeoff is token cost, controlled by `maxHistoryChars`.

## Safety Boundaries

Agent Deck runs locally with the permissions of the current shell. It does not
sandbox agent CLIs. Treat each configured agent command as trusted executable
code.

Recommended defaults:

- Start from `mode: "turn"` for cleaner logs.
- Keep `shareHistory` on for collaboration, but lower `maxHistoryChars` for
  expensive models.
- Use per-repository config instead of one global config.
- Run `agent-deck doctor` before a session.
- Keep secrets in the provider CLI's normal auth store, not in
  `agent-deck.config.json`.
