import test from "node:test";
import assert from "node:assert/strict";
import { compileModeRules, validPermissionMode } from "./permission-mode.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";

const eff = (rules, action) =>
  rules.findLast((r) => r.action === action || r.action === "*")?.effect;
test("ask mode is exactly the baseline", () => {
  assert.deepEqual(compileModeRules("ask"), BASELINE_POLICY);
  assert.deepEqual(compileModeRules(), BASELINE_POLICY);
});
test("scoped_edit allows read/edit only; shell and network denied", () => {
  const r = compileModeRules("scoped_edit");
  assert.equal(eff(r, "read"), "allow");
  assert.equal(eff(r, "edit"), "allow");
  assert.equal(eff(r, "shell"), "deny");
  assert.equal(eff(r, "webfetch"), "deny");
});
test("read_plan allows read only", () => {
  const r = compileModeRules("read_plan");
  assert.equal(eff(r, "read"), "allow");
  assert.equal(eff(r, "grep"), "allow");
  assert.equal(eff(r, "edit"), "deny");
  assert.equal(eff(r, "shell"), "deny");
});
test("unknown tools ask; explicit deny floor is last in every mode", () => {
  for (const mode of ["ask", "scoped_edit", "read_plan"]) {
    const r = compileModeRules(mode);
    assert.equal(r[0].effect, "ask");
    assert.equal(eff(r, "some_new_tool"), "ask");
    assert.deepEqual(r.slice(-1), BASELINE_POLICY.slice(1));
    assert.equal(eff(r, "external_directory"), "deny");
  }
});
test("subagent is not in the deny floor; it follows the mode", () => {
  assert.equal(
    BASELINE_POLICY.some((r) => r.action === "subagent"),
    false,
  );
  assert.equal(eff(compileModeRules("ask"), "subagent"), "ask");
  assert.equal(eff(compileModeRules("scoped_edit"), "subagent"), "allow");
  assert.equal(eff(compileModeRules("read_plan"), "subagent"), "allow");
  for (const mode of ["ask", "scoped_edit", "read_plan"])
    assert.equal(eff(compileModeRules(mode), "external_directory"), "deny");
});
test("invalid mode rejected", () => {
  assert.equal(validPermissionMode("custom"), false);
  assert.throws(() => compileModeRules("custom"));
});
