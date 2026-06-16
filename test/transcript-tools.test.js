import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  buildFindingsMarkdown,
  buildReplay,
  extractReviewFindings,
  formatSessionList,
  listTranscriptFiles,
  parseTranscriptEntries
} from "../src/transcript-tools.js";

const reviewTranscript = `# Agent Deck Session

- Started: 2026-06-16T00:00:00.000Z
- Workspace: /tmp/work

## 2026-06-16T00:01:00.000Z input -> review -> codex,claude

\`\`\`text
현재 diff에서 blocking issue만 찾아줘
\`\`\`

## 2026-06-16T00:02:00.000Z output <- claude

\`\`\`text
- Blocking: src/app.js:42에서 빈 target을 검증하지 않아 command가 깨질 수 있음
- Missing test: test/app.test.js에 findings export 케이스가 없음
\`\`\`
`;

test("buildReplay formats a compact transcript timeline", () => {
  const replay = buildReplay(reviewTranscript, { limit: 2 });

  assert.match(replay, /YOU -> review -> codex,claude/);
  assert.match(replay, /CLAUDE/);
  assert.match(replay, /blocking issue/);
});

test("extractReviewFindings turns review output into table rows", () => {
  const findings = extractReviewFindings(parseTranscriptEntries(reviewTranscript));

  assert.equal(findings.length, 2);
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].location, "src/app.js:42");
  assert.equal(findings[1].severity, "medium");
});

test("extractReviewFindings prefers structured JSON blocks", () => {
  const transcript = `# Agent Deck Session

## 2026-06-16T00:01:00.000Z input -> review -> codex

\`\`\`text
리뷰 findings를 구조화해서 뽑아줘
\`\`\`

## 2026-06-16T00:02:00.000Z output <- codex

\`\`\`text
- Blocking: 이 문장은 fallback으로 중복 추출되면 안 됨

AGENT_DECK_FINDINGS_JSON
[
  {
    "severity": "blocker",
    "file": "src/web.js",
    "line": 44,
    "summary": "dashboard export가 선택한 필터를 무시한다",
    "evidence": "severity=high 요청에서도 medium finding이 포함된다"
  }
]
END_AGENT_DECK_FINDINGS_JSON
\`\`\`
`;

  const findings = extractReviewFindings(parseTranscriptEntries(transcript));

  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "high");
  assert.equal(findings[0].agent, "codex");
  assert.equal(findings[0].location, "src/web.js:44");
  assert.match(findings[0].summary, /필터를 무시/);
  assert.match(findings[0].evidence, /severity=high/);
});

test("buildFindingsMarkdown writes a Markdown findings table", () => {
  const markdown = buildFindingsMarkdown(reviewTranscript, { sourcePath: "/tmp/session.md" });

  assert.match(markdown, /Agent Deck Review Findings/);
  assert.match(markdown, /src\/app.js:42/);
  assert.match(markdown, /Findings: 2/);
});

test("listTranscriptFiles returns newest transcript files first", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-sessions-"));
  writeFileSync(join(dir, "a.md"), "# A");
  writeFileSync(join(dir, "b.txt"), "ignore");
  writeFileSync(join(dir, "c.md"), "# C");

  const files = listTranscriptFiles(dir);

  assert.equal(files.length, 2);
  assert.match(formatSessionList(files), /\.md/);
  assert.deepEqual(listTranscriptFiles(join(dir, "missing")), []);
});
