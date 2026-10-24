import assert from "node:assert/strict";
import test from "node:test";
import { nextAgent } from "./renderer/widgets/conversation/agent-cycle.ts";

test("Shift+Tab mode order: default, each agent in catalog order, back to default", () => {
  const ids = ["build", "plan", "general"];
  assert.equal(nextAgent("", ids), "build");
  assert.equal(nextAgent("build", ids), "plan");
  assert.equal(nextAgent("plan", ids), "general");
  assert.equal(nextAgent("general", ids), "");
  // An agent that left the catalog restarts at the default.
  assert.equal(nextAgent("gone", ids), "");
  assert.equal(nextAgent("", []), "");
});
