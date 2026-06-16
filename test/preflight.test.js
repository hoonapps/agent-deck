import test from "node:test";
import assert from "node:assert/strict";
import { modelChoices, parseAuthStatus, providerForAgent, resolveModelSelection } from "../src/preflight.js";

test("providerForAgent detects Codex and Claude adapters", () => {
  assert.equal(providerForAgent({ id: "codex", command: "codex" }).label, "Codex");
  assert.equal(providerForAgent({ id: "reviewer", command: "/usr/local/bin/claude" }).label, "Claude");
  assert.equal(providerForAgent({ id: "echo", command: "node" }), null);
});

test("parseAuthStatus handles provider-specific status output", () => {
  const codex = providerForAgent({ id: "codex", command: "codex" });
  const claude = providerForAgent({ id: "claude", command: "claude" });

  assert.equal(parseAuthStatus(codex, 0, "Logged in using ChatGPT").loggedIn, true);
  assert.equal(parseAuthStatus(codex, 0, "Not logged in").loggedIn, false);
  assert.equal(parseAuthStatus(codex, 1, "Not logged in").loggedIn, false);
  assert.equal(parseAuthStatus(claude, 0, JSON.stringify({ loggedIn: true })).loggedIn, true);
  assert.equal(parseAuthStatus(claude, 0, JSON.stringify({ loggedIn: false })).loggedIn, false);
});

test("modelChoices keeps provider default and configured model available", () => {
  const choices = modelChoices({ id: "codex", command: "codex", model: "custom-codex" });

  assert.deepEqual(choices.slice(0, 2), [
    { value: "", label: "provider default" },
    { value: "custom-codex", label: "custom-codex" }
  ]);
  assert.equal(choices.some((choice) => choice.value === "gpt-5-codex"), true);
});

test("resolveModelSelection handles default, choices, custom models, and bad numbers", () => {
  const choices = [
    { value: "", label: "provider default" },
    { value: "gpt-5-codex", label: "gpt-5-codex" }
  ];

  assert.deepEqual(resolveModelSelection("", choices, "current-model"), {
    ok: true,
    model: "current-model",
    action: "keep"
  });
  assert.deepEqual(resolveModelSelection("default", choices, "current-model"), {
    ok: true,
    model: "",
    action: "default"
  });
  assert.deepEqual(resolveModelSelection("2", choices, ""), {
    ok: true,
    model: "gpt-5-codex",
    action: "choice"
  });
  assert.deepEqual(resolveModelSelection("gpt-custom", choices, ""), {
    ok: true,
    model: "gpt-custom",
    action: "custom"
  });
  assert.equal(resolveModelSelection("99", choices, "").ok, false);
});
