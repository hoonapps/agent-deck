import { readFileSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";
import { parseTranscriptEntries } from "./transcript-tools.js";

export { parseTranscriptEntries };

export function buildBlogDraftFromTranscript(markdown, { title, sourcePath } = {}) {
  const entries = parseTranscriptEntries(markdown);
  const prompts = entries.filter((entry) => entry.source.startsWith("input -> "));
  const outputs = entries.filter((entry) => entry.source.startsWith("output <- "));
  const tests = entries.filter((entry) => entry.source === "test");
  const safeTitle = title || titleFromPath(sourcePath) || "Agent Deck 작업 기록";

  return [
    "---",
    `title: "${escapeTitle(safeTitle)}"`,
    "categories: [Projects, AI]",
    "tags: [agent-deck, ai, agent, workflow]",
    "---",
    "",
    `이 글은 Agent Deck transcript에서 생성한 초안이다.${sourcePath ? ` 원본 파일: \`${sourcePath}\`.` : ""}`,
    "",
    "## 요약",
    "",
    `- 사용자 요청: ${prompts.length}개`,
    `- Agent 응답: ${outputs.length}개`,
    `- 테스트/검증 이벤트: ${tests.length}개`,
    "",
    "## 작업 흐름",
    "",
    ...entries.slice(-20).flatMap(formatDraftEntry),
    "",
    "## 정리할 것",
    "",
    "- 실제로 반영된 변경",
    "- 검증 명령과 결과",
    "- 남은 리스크",
    "- 다음 작업",
    ""
  ].join("\n");
}

export function writeBlogDraft({ transcriptPath, outPath, title } = {}) {
  const source = resolve(transcriptPath);
  const markdown = readFileSync(source, "utf8");
  const draft = buildBlogDraftFromTranscript(markdown, { title, sourcePath: source });
  const target = resolve(outPath || `${source.replace(/\.md$/, "")}-blog-draft.md`);
  writeFileSync(target, draft, "utf8");
  return target;
}

function formatDraftEntry(entry) {
  const heading = entry.source.startsWith("input ->")
    ? "요청"
    : entry.source.startsWith("output <-")
      ? "응답"
      : entry.source;
  return [
    `### ${heading}`,
    "",
    `- 시간: ${entry.time}`,
    `- 출처: \`${entry.source}\``,
    "",
    "```text",
    truncate(entry.message, 1200),
    "```",
    ""
  ];
}

function titleFromPath(path) {
  if (!path) return "";
  return basename(path, ".md").replace(/[-_]+/g, " ");
}

function escapeTitle(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function truncate(value, max) {
  const text = String(value);
  if (text.length <= max) return text;
  return `${text.slice(0, max - 15)}\n...[truncated]`;
}
