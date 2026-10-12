import test from "node:test";
import assert from "node:assert/strict";
import { compileModeRules, validPermissionMode } from "./permission-mode.mjs";
import { BASELINE_POLICY } from "./renderer/shared/configuration-draft/policy.mjs";

// Effect of the whole-tool rule (resource "*"); path-scoped re-denies are
// asserted separately.
const eff = (rules, action) =>
  rules.findLast(
    (r) => r.resource === "*" && (r.action === action || r.action === "*"),
  )?.effect;
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
test("legacy 3-rule baseline and legacy mode rules stay accepted as stricter", async () => {
  const { LEGACY_BASELINE_POLICY, policyMatches } = await import(
    "./renderer/shared/configuration-draft/policy.mjs"
  );
  const { legacyModeRules } = await import("./permission-mode.mjs");
  const { matchesOrderedPermissionRules } = await import(
    "./permission-policy-compiler.mjs"
  );
  assert.equal(policyMatches(BASELINE_POLICY), true);
  assert.equal(
    policyMatches(LEGACY_BASELINE_POLICY.map((r) => ({ ...r }))),
    true,
  );
  assert.equal(policyMatches([...BASELINE_POLICY].reverse()), false);
  assert.equal(
    policyMatches([
      ...LEGACY_BASELINE_POLICY.slice(0, 2),
      { action: "subagent", resource: "*", effect: "allow" },
    ]),
    false,
  );
  assert.deepEqual(legacyModeRules("ask"), LEGACY_BASELINE_POLICY);
  for (const mode of ["ask", "scoped_edit", "read_plan"]) {
    const legacy = legacyModeRules(mode);
    assert.equal(eff(legacy, "subagent"), "deny");
    assert.equal(
      matchesOrderedPermissionRules(legacy, compileModeRules(mode)),
      false,
    );
  }
});

test("broad read allow does not override .env ask", () => {
  for (const mode of ["scoped_edit", "read_plan"]) {
    const r = compileModeRules(mode);
    const read = r.findIndex((x) => x.action === "read" && x.resource === "*");
    assert.deepEqual(
      r.slice(read + 1, read + 4).map((x) => [x.resource, x.effect]),
      [
        ["*.env", "ask"],
        ["*.env.*", "ask"],
        ["*.env.example", "allow"],
      ],
    );
  }
});

test("scoped_edit re-denies VCS metadata writes right after the edit allow", () => {
  const r = compileModeRules("scoped_edit");
  const at = r.findIndex((x) => x.action === "edit" && x.effect === "allow");
  const denies = r.slice(at + 1, at + 9);
  assert.deepEqual(
    denies.map((x) => [x.action, x.resource, x.effect]),
    [".git", ".hg"].flatMap((n) =>
      [n, `${n}/*`, `*/${n}`, `*/${n}/*`].map((p) => ["edit", p, "deny"]),
    ),
  );
  // Last matching rule wins (opencode wildcard semantics): simulate it.
  const match = (path) =>
    r.findLast(
      (x) =>
        x.action === "edit" &&
        new RegExp(
          "^" +
            x.resource
              .replace(/[.+^${}()|[\]\\]/gu, "\\$&")
              .replace(/\*/gu, ".*") +
            "$",
          "s",
        ).test(path),
    ).effect;
  for (const denied of [
    ".git/hooks/pre-commit",
    "sub/.git/config",
    ".hg/hgrc",
    ".git",
  ])
    assert.equal(match(denied), "deny");
  for (const allowed of ["src/a.ts", ".gitignore", "docs/.github/x"])
    assert.equal(match(allowed), "allow");
  // read_plan already denies edits; ask is exactly the baseline.
  assert.equal(
    compileModeRules("read_plan").some((x) => x.resource.includes(".git")),
    false,
  );
});
