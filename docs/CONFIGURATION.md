# Configuration Reference

Agent Deck reads `agent-deck.config.json` or `.agent-deck.json` from the current
workspace. You can also pass a file explicitly:

```bash
agent-deck --config ./examples/demo.config.json
```

Validate a config without opening the TUI:

```bash
agent-deck validate --config ./examples/demo.config.json
```

## Top-Level Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `title` | string | `Agent Deck` | Text shown in the TUI header. |
| `workspace` | string | current directory | Base directory for agents, tests, git, and transcripts. |
| `transcriptDir` | string | `.agent-deck/sessions` | Markdown transcript output directory. Relative paths resolve from `workspace`. |
| `sessionName` | string | timestamp | Transcript filename. CLI `--session` overrides this. |
| `testCommand` | string | `npm test` | Command run by `F10` or `/test`. |
| `shareHistory` | boolean | `true` | Inject recent shared transcript context into routed turns. |
| `maxHistoryChars` | positive integer | `6000` | Maximum history characters shown and injected. |
| `turnTimeoutMs` | non-negative integer | `300000` | Turn-mode timeout. Use `0` to disable. |
| `reviewAgents` | string[] | `[]` | Agent ids/aliases used by `/review`. Empty means reviewer-role agents, then Codex/Claude. |
| `rolePresets` | object | built-in presets | Role prompt text keyed by role id. |
| `agents` | array | Codex and Claude | Agent process definitions. Must contain at least one item. |

`maxHistoryChars` is validated at startup. Use a larger value when agents need
more shared context, and a smaller value when token cost matters.

## Agent Fields

| Field | Type | Default | Notes |
| --- | --- | --- | --- |
| `id` | string | normalized `name` | Stable route id. Used by `/to <agent>`. |
| `aliases` | string[] | provider defaults | Short commands such as `/co` or `/cl`. Must be unique across agents. |
| `name` | string | `id` | Display label. |
| `command` | string | required | Executable command, for example `codex`, `claude`, or `node`. |
| `mode` | `turn` or `interactive` | `turn` | `turn` runs one clean request per message. `interactive` keeps a PTY alive. |
| `args` | string[] | provider defaults | Native CLI args. In turn mode, empty Codex/Claude args receive clean defaults. |
| `model` | string | provider default | Optional model value. |
| `modelArg` | string or `false` | `--model` | Flag used when appending `model`. Set `false` to disable model arg injection. |
| `role` | string | unset | Role preset key injected before the agent turn. |
| `turnTimeoutMs` | non-negative integer | top-level value | Per-agent turn timeout. Use `0` to disable. |
| `cwd` | string | `workspace` | Per-agent working directory. |
| `env` | object | `{}` | Extra environment variables for the agent process. |
| `autoStart` | boolean | `true` | Start interactive agents when the TUI opens. |
| `bracketedPaste` | boolean | `true` | Use bracketed paste for multiline interactive input. |

Agent Deck rejects duplicate ids and duplicate aliases at startup. This keeps
commands like `/co`, `/cl`, and `/to backend` deterministic.

When `aliases` is provided, Agent Deck uses those aliases plus the full agent
`id`. It does not add an extra derived short alias, because that can create
surprising collisions such as `echo-a` and `echo-b` both deriving `ec`.

## Model Precedence

Model selection is resolved in this order:

```text
CLI flag > config model > AGENT_DECK_<AGENT>_MODEL > provider default
```

Examples:

```bash
agent-deck --model codex=gpt-5.3-codex,claude=sonnet
agent-deck --codex-model gpt-5.3-codex --claude-model sonnet
```

```bash
export AGENT_DECK_CODEX_MODEL=gpt-5.3-codex
export AGENT_DECK_CLAUDE_MODEL=sonnet
```

Inside the TUI:

```text
/models
/set-model codex gpt-5.3-codex
```

`/set-model` updates the current runtime config, restarts that agent, and updates
the pane label.

## Clean Turn Mode

Turn mode is the default because it keeps panes readable:

```text
You:
review this diff

Codex:
The risk is...
```

Default commands:

```text
codex exec --color never --skip-git-repo-check -
claude --print --output-format text
```

Use turn mode when you want transcript-friendly output, repeatable turns, and
less provider UI noise.

## Status, Timeout, Transcript, and Export

Use `/status` inside the TUI to inspect each agent:

```text
/status
```

The status output includes state, turn count, last exit code or signal, and last
duration.

Use `turnTimeoutMs` to stop long-running turn-mode agents:

```json
{
  "turnTimeoutMs": 300000,
  "agents": [
    { "id": "codex", "command": "codex", "turnTimeoutMs": 120000 }
  ]
}
```

Adjust the timeout during a session without editing config:

```text
/timeout codex 120000
```

Pause recording while discussing sensitive context, then resume when the session
is publishable again:

```text
/record off
/record on
```

Remove the most recent transcript record:

```text
/redact-last
```

Use `/export` to write a Markdown session summary next to the transcript:

```text
/export decisions
```

This creates a file such as:

```text
.agent-deck/sessions/2026-06-16T...-decisions.md
```

Use `/findings` after review turns to write a Markdown findings table:

```text
/findings review-table
```

Use CLI transcript tools outside the TUI:

```bash
agent-deck sessions
agent-deck replay .agent-deck/sessions/session.md --limit 40
agent-deck findings .agent-deck/sessions/session.md --out findings.md
```

Open the local dashboard when you want to inspect sessions in a browser:

```bash
agent-deck web --host 127.0.0.1 --port 4545
```

Use the CLI blog helper to turn a transcript into a Korean draft:

```bash
agent-deck blog .agent-deck/sessions/session.md --out draft.md --title "Agent Deck 작업 기록"
```

## Roles and Review

Roles are optional prompt presets. They are injected before the current message:

```json
{
  "reviewAgents": ["claude"],
  "rolePresets": {
    "reviewer": "Find correctness, regression, test, and security issues first."
  },
  "agents": [
    { "id": "claude", "command": "claude", "role": "reviewer" }
  ]
}
```

Use `/review` to send a reviewer prompt to configured review agents:

```text
/review inspect the current diff and list blocking issues
```

## Interactive Mode

Use interactive mode when you explicitly want the provider's native terminal UI:

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

Interactive mode is useful for long provider-native sessions, but it can render
more CLI status text into panes and transcripts.
