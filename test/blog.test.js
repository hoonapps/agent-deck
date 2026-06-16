import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildBlogDraftFromTranscript, parseTranscriptEntries, writeBlogDraft } from "../src/blog.js";

const sampleTranscript = `# Agent Deck Session

- Started: 2026-06-16T00:00:00.000Z
- Workspace: /tmp/work

## 2026-06-16T00:01:00.000Z input -> codex

\`\`\`text
구현해줘
\`\`\`

## 2026-06-16T00:02:00.000Z output <- codex

\`\`\`text
구현 완료
\`\`\`

## 2026-06-16T00:03:00.000Z test

\`\`\`text
npm test
pass
\`\`\`
`;

test("parseTranscriptEntries extracts transcript records", () => {
  const entries = parseTranscriptEntries(sampleTranscript);
  assert.equal(entries.length, 3);
  assert.equal(entries[0].source, "input -> codex");
  assert.equal(entries[1].message, "구현 완료");
});

test("buildBlogDraftFromTranscript creates a Korean draft skeleton", () => {
  const draft = buildBlogDraftFromTranscript(sampleTranscript, { title: "작업 기록" });
  assert.match(draft, /title: "작업 기록"/);
  assert.match(draft, /사용자 요청: 1개/);
  assert.match(draft, /Agent 응답: 1개/);
  assert.match(draft, /테스트\/검증 이벤트: 1개/);
});

test("writeBlogDraft writes a draft file", () => {
  const dir = mkdtempSync(join(tmpdir(), "agent-deck-blog-"));
  const transcriptPath = join(dir, "session.md");
  const outPath = join(dir, "draft.md");
  writeFileSync(transcriptPath, sampleTranscript);

  const target = writeBlogDraft({ transcriptPath, outPath, title: "세션 정리" });
  const content = readFileSync(target, "utf8");

  assert.equal(target, outPath);
  assert.match(content, /세션 정리/);
  assert.match(content, /구현해줘/);
});
