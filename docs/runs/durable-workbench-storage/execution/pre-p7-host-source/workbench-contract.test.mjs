import test from "node:test";
import assert from "node:assert/strict";
import {
  validateRequest,
  portableName,
  policyMatches,
  BASELINE_POLICY,
} from "./workbench-contract.mjs";
test("closed requests reject extra fields, cross-selection, malformed values and bulk permissions", () => {
  for (const value of [
    null,
    [],
    { type: "toString" },
    { type: "snapshot", sessionId: "s" },
    { type: "workspace.import", path: "/tmp" },
    {
      type: "message.send",
      workspaceId: "w",
      sessionId: "s",
      requestId: "r",
      text: " ",
    },
    {
      type: "permission.respond",
      workspaceId: "w",
      sessionId: "s",
      requestId: "r",
      decision: "always",
    },
  ])
    assert.throws(() => validateRequest(value));
  assert.deepEqual(validateRequest({ type: "snapshot" }), { type: "snapshot" });
});
test("portable folder names and exact ask policy", () => {
  for (const name of [
    "..",
    "a/b",
    "a\\b",
    "CON.txt",
    "LPT1",
    "trailing.",
    " name",
    "a:",
    "\0",
  ])
    assert.equal(portableName(name), false, name);
  assert.equal(portableName("ordinary-project"), true);
  assert.equal(policyMatches(BASELINE_POLICY), true);
  assert.equal(
    policyMatches([
      ...BASELINE_POLICY,
      { action: "*", resource: "*", effect: "allow" },
    ]),
    false,
  );
  assert.equal(policyMatches(undefined), false);
});
