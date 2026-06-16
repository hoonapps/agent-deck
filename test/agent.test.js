import test from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { AgentProcess } from "../src/agent.js";

test("AgentProcess records successful turn status", async () => {
  const agent = new AgentProcess({
    id: "echo",
    command: process.execPath,
    args: ["-e", "process.stdin.pipe(process.stdout)"],
    cwd: process.cwd(),
    env: {},
    mode: "turn",
    turnTimeoutMs: 1000
  });

  const outputs = [];
  agent.on("data", (data) => outputs.push(data));
  agent.writeLine("hello");
  const [{ code, durationMs }] = await once(agent, "turn-exit");

  assert.equal(code, 0);
  assert.match(outputs.join("\n"), /hello/);
  assert.equal(agent.status().state, "idle");
  assert.equal(agent.status().turns, 1);
  assert.equal(typeof durationMs, "number");
});

test("AgentProcess times out long running turn", async () => {
  const agent = new AgentProcess({
    id: "slow",
    command: process.execPath,
    args: ["-e", "setTimeout(() => console.log('late'), 1000)"],
    cwd: process.cwd(),
    env: {},
    mode: "turn",
    turnTimeoutMs: 50
  });

  agent.writeLine("hello");
  const [{ timedOut }] = await once(agent, "turn-exit");

  assert.equal(timedOut, true);
  assert.equal(agent.status().state, "timeout");
  assert.equal(agent.status().turns, 1);
});

test("AgentProcess stop updates turn-mode status immediately", () => {
  const agent = new AgentProcess({
    id: "slow",
    command: process.execPath,
    args: ["-e", "setTimeout(() => console.log('late'), 1000)"],
    cwd: process.cwd(),
    env: {},
    mode: "turn",
    turnTimeoutMs: 0
  });

  agent.writeLine("hello");
  agent.stop();

  assert.equal(agent.status().state, "stopped");
});
