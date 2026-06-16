# Architecture Notes

Agent Deck is a local terminal application. It does not proxy model APIs and it
does not store provider credentials. Each agent is an existing CLI process that
runs in the selected workspace.

## Components

| Component | File | Responsibility |
| --- | --- | --- |
| CLI entrypoint | `bin/agent-deck.js` | Parse launch commands, create default config, run `doctor`, generate blog drafts, start the TUI. |
| Config loader | `src/config.js` | Discover config files, normalize agents, apply model overrides, validate routing. |
| TUI app | `src/app.js` | Render the terminal cockpit, route messages, run tests/git commands, coordinate transcript/history. |
| Agent process | `src/agent.js` | Spawn turn-mode child processes or interactive PTYs. Clean provider output. |
| Transcript | `src/transcript.js` | Write Markdown session logs and build shared context snippets. |
| Blog draft helper | `src/blog.js` | Convert a transcript into a Korean post draft with counts, recent turns, and a cleanup checklist. |
| Git/test helpers | `src/git.js` | Run shell commands in the workspace and summarize output. |

## Message Flow

1. The user types into the composer.
2. `parseComposerCommand` classifies the input as a command or plain note.
3. `/co`, `/cl`, `/to`, and `/all` resolve to configured agent ids or aliases.
4. If `shareHistory` is enabled, recent transcript context is prepended.
5. `AgentProcess.writeLine` sends the message to the agent.
6. Agent output is appended to the pane and transcript.
7. The history panel is rebuilt from recent transcript entries.

Agent processes also emit status updates. The TUI uses those updates to show
state in the header and pane labels, and `/status` prints a fuller table with
turn count, last duration, and exit information.

The visual layout is intentionally dense: top agent panes, lower History and
Activity panels, a fixed command hint bar, and a bottom composer. Pane border
colors follow runtime state so a stalled or failed agent is visible without
opening logs.

Plain text only goes to an agent after the user enters an active chat route. This
prevents accidental prompts from being sent at startup.

## Turn Mode vs Interactive Mode

Turn mode launches a fresh child process for each message:

```text
message -> child stdin -> stdout/stderr -> cleaned answer
```

This is good for readable panes, deterministic transcripts, and short review
turns. Turn mode supports `turnTimeoutMs`, which kills long-running child
processes and marks the agent state as `timeout`.

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

## Transcript Controls, Export, and Blog Drafts

The transcript is the raw log. Recording can be paused with `/record off` and
resumed with `/record on`. `/redact-last` removes the most recent transcript
record and rewrites the file, which is useful before sharing session notes.

`/export [name]` writes a compact Markdown export next to the raw log. The
export records counts for user prompts, agent outputs, and test events, then
includes recent context. It is intended for handoff notes and decision logs.

`agent-deck blog <transcript.md>` runs outside the TUI and writes a Korean blog
draft from the transcript. It keeps the raw record separate from the publishable
post so the developer can edit conclusions and remove private details before
publishing.

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
