import test from "node:test";
import assert from "node:assert/strict";
import { formatLogLine, formatPaneTitle, formatStatusBadge, panePosition } from "../src/app.js";

test("panePosition keeps one or two agents in one row", () => {
  assert.deepEqual(panePosition(0, 1), { top: "0%", left: "0%", width: "100%", height: "100%" });
  assert.deepEqual(panePosition(1, 2), { top: "0%", left: "50%", width: "50%", height: "100%" });
});

test("panePosition lays out three or more agents in two columns", () => {
  assert.deepEqual(panePosition(2, 3), { top: "50%", left: "0%", width: "50%", height: "50%" });
  assert.deepEqual(panePosition(3, 4), { top: "50%", left: "50%", width: "50%", height: "50%" });
});

test("terminal formatting helpers produce compact labels", () => {
  assert.equal(formatStatusBadge("running"), "RUNNING");
  assert.equal(formatStatusBadge("unknown-state"), "UNKNOWN");
  assert.equal(formatPaneTitle({ label: "Codex [gpt-5.3-codex]" }, { state: "idle" }, true), " > Codex [gpt-5.3-codex] | IDLE ");
  assert.equal(formatLogLine("Started", new Date("2026-06-16T12:00:00Z")).endsWith(" | Started"), true);
});
