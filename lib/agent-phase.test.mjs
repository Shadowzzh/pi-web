import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { deriveAgentPhase } = await jiti.import("./agent-phase.ts");

test("a running tool wins over the streaming flag", () => {
  assert.deepEqual(
    deriveAgentPhase({
      isStreaming: true,
      isPromptRunning: true,
      activeTools: [{ id: "call_1", name: "bash" }],
    }),
    { kind: "running_tools", tools: [{ id: "call_1", name: "bash" }] },
  );
});

test("keeps the latest progress of a running tool", () => {
  assert.deepEqual(
    deriveAgentPhase({ isStreaming: true, activeTools: [{ id: "call_1", name: "bash", progress: "rg -l foo" }] }),
    { kind: "running_tools", tools: [{ id: "call_1", name: "bash", progress: "rg -l foo" }] },
  );
});

test("streaming without a running tool waits for the model", () => {
  assert.deepEqual(deriveAgentPhase({ isStreaming: true, activeTools: [] }), { kind: "waiting_model" });
  assert.deepEqual(deriveAgentPhase({ isStreaming: true }), { kind: "waiting_model" });
});

test("a prompt without streaming reports a running command", () => {
  assert.deepEqual(deriveAgentPhase({ isPromptRunning: true }), { kind: "running_command" });
});

test("an idle session reports nothing, even with stale active tools", () => {
  assert.equal(deriveAgentPhase({ isStreaming: false, isPromptRunning: false, activeTools: [{ id: "call_1", name: "bash" }] }), null);
  assert.equal(deriveAgentPhase(undefined), null);
});
