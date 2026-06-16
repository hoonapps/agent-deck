# Workflow Playbook

These workflows are the practical reason Agent Deck exists: one human can route
work between multiple coding agents without juggling separate terminals.

## 1. Review With Two Agents

Use Codex for implementation review and Claude for a second opinion:

```text
/co Review the current diff. Focus on correctness and tests.
/cl Read the same diff and look for product or UX risks.
/review Inspect the current diff and list blocking issues first.
/git
/test
/status
```

Because `shareHistory` is enabled by default, the second agent receives recent
conversation context automatically.

## 2. Implementation Then Critique

Use one agent to make progress and another to challenge it:

```text
/co Implement the narrowest fix for the failing test.
/test
/cl Review the changed files and point out regressions.
/export implementation-review
/co Apply only the review items that are clearly correct.
```

The human still decides which review items to apply. Agent Deck coordinates the
conversation; it does not replace review judgment.

## 3. Backend Deep-Dive Session

For architecture or backend work:

```text
/co Map the current request flow and identify transaction boundaries.
/cl Challenge the design from observability, retries, and data consistency.
/all Propose the smallest next experiment we can verify locally.
```

This pattern works well when designing queues, outbox flows, RAG pipelines, or
agent runtimes.

## 4. Safe Demo Without Provider CLIs

Use the included echo agents to verify the TUI and transcript flow:

```bash
agent-deck --config examples/demo.config.json --session demo
```

Then type:

```text
/ea hello
/eb summarize the previous message
/history
/status
```

This is useful for checking terminal compatibility before configuring real
agents. It also lets you check the status-colored panes and command hint bar
without installing provider CLIs.

For real Codex and Claude sessions, run preflight first or let the normal launch
do it:

```bash
agent-deck setup --select-models
agent-deck --select-models
```

If both providers are already logged in, preflight only prints the status and
continues. If one is missing, it offers to run `codex login` or
`claude auth login` before the TUI starts.

## 5. Current Stable Terminal Flow

The current verified path for local use is:

```bash
cd /Users/kimyanghoon/Desktop/dev/agent-deck
agent-deck setup --config examples/agent-deck.config.json
agent-deck --config examples/agent-deck.config.json --select-models
```

At the model prompt:

- Press `Enter` to keep the current model or provider default.
- Type `default` to force the provider default.
- Choose one of the listed numbers.
- Type a custom model name only when the provider account supports it.

Invalid numeric choices are rejected and the prompt is shown again. This avoids
accidentally setting a model named `99` or another typo.

Inside the TUI, start with:

```text
/co hello
/cl hello
/review Check the current diff for blocking issues.
/status
```

If the terminal input ever shows escape-looking text, quit with `Ctrl+C`, run
`reset`, and start Agent Deck again. The current TUI disables mouse tracking on
startup and shutdown, but `reset` recovers a terminal session left in a bad mode
by an older run or another terminal app.

## 6. Session Hygiene

Before a real session:

```bash
agent-deck doctor
git status --short
```

During a session:

```text
/git
/test
/models
/status
/timeout codex 120000
/record off
/record on
/export decisions
/findings review-table
```

After a session:

- Read the transcript under `.agent-deck/sessions`.
- List and replay previous sessions when deciding what to publish:

```bash
agent-deck sessions
agent-deck replay .agent-deck/sessions/session.md --limit 40
```

- Extract review output into a table when a session contains critique:

```bash
agent-deck findings .agent-deck/sessions/session.md --out findings.md
```

Structured `AGENT_DECK_FINDINGS_JSON` blocks are preferred over plain-text
review parsing, so downloaded findings stay stable even when an agent writes a
long explanation around them.

- Open the dashboard when a session needs visual inspection:

```bash
agent-deck web --port 4545
```

Use the dashboard filters to narrow findings by severity, agent, or status,
then download the filtered findings table or a blog draft from the selected
session.
Mark sessions as `published` after they become posts, or `deferred` when they
should stay in the archive but not enter the current publishing queue.
Mark individual findings as `accepted`, `fixed`, or `ignored` as review items
move through implementation.
Use the Review Inbox at the top of the dashboard to keep open high-severity
findings visible across sessions.
Use Review Trends to spot repeated locations, noisy agents, and status buildup
before opening individual sessions. Apply severity, agent, or status filters
when the trend needs to focus on unresolved work. Use the window selector for
recent sessions or today's review slice. Download a trend snapshot when the
current review state should be pasted into a standup note or changelog.

- Generate a first blog draft when the session is worth publishing:

```bash
agent-deck blog .agent-deck/sessions/session.md --out draft.md --title "Agent Deck 작업 기록"
```

- Edit the generated draft for claims, code links, and screenshots.
- Commit code changes separately from transcript files.
- Keep `.agent-deck/` ignored unless you intentionally want to publish a session
  log.
