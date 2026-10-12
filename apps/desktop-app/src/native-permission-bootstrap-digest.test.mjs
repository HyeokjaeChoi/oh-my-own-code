import test from "node:test";
import assert from "node:assert/strict";
import { BASELINE_POLICY } from "./workbench-contract.mjs";
import {
  bootstrapBaselinePermissions,
  bootstrapHandoffProof,
  bootstrapMetadataDigest,
  bootstrapParentDigest,
  bootstrapStageArguments,
  bootstrapStageDigest,
  bootstrapTaskProof,
} from "./native-permission-bootstrap-digest.mjs";

const create = () => ({
  id: "ses_planned",
  metadata: { operationId: "op", digest: "a".repeat(64) },
  title: "Workbench",
  location: { directory: "/work" },
  permissions: BASELINE_POLICY.map((rule) => ({ ...rule })),
});

test("create digest binds every Native input field and ignores key order and undefined", () => {
  const base = bootstrapStageDigest("native.create", create());
  const reordered = {
    permissions: create().permissions,
    location: { directory: "/work", workspaceID: undefined },
    title: "Workbench",
    metadata: { digest: "a".repeat(64), operationId: "op" },
    id: "ses_planned",
    parentID: undefined,
  };
  assert.equal(bootstrapStageDigest("native.create", reordered), base);
  for (const change of [
    (input) => (input.id = "ses_other"),
    (input) => (input.title = "Other"),
    (input) => (input.location.directory = "/elsewhere"),
    (input) => (input.metadata.digest = "b".repeat(64)),
    (input) => input.permissions.pop(),
    (input) => (input.permissions[1].effect = "allow"),
  ]) {
    const input = create();
    change(input);
    assert.notEqual(bootstrapStageDigest("native.create", input), base);
  }
});

test("create input refuses any extra defined Native field and weak shapes", () => {
  for (const extra of [
    { parentID: "ses_parent" },
    { agent: "build" },
    { model: { id: "m" } },
    { unknown: 1 },
  ])
    assert.throws(() =>
      bootstrapStageArguments("native.create", { ...create(), ...extra }),
    );
  assert.throws(() =>
    bootstrapStageArguments("native.create", {
      ...create(),
      location: { directory: "/work", workspaceID: "w" },
    }),
  );
  for (const key of ["id", "metadata", "title", "location", "permissions"]) {
    const input = create();
    delete input[key];
    assert.throws(() => bootstrapStageArguments("native.create", input), key);
  }
  assert.throws(() =>
    bootstrapStageArguments("native.create", {
      ...create(),
      get title() {
        return "getter";
      },
    }),
  );
  assert.throws(() =>
    bootstrapStageArguments("native.create", new Proxy(create(), {})),
  );
});

test("fork digest binds the parent and optional boundary; method steps never collide", () => {
  const plain = bootstrapStageDigest("native.fork", { sessionID: "ses_p" });
  assert.equal(
    bootstrapStageDigest("native.fork", {
      sessionID: "ses_p",
      before: undefined,
    }),
    plain,
  );
  assert.notEqual(
    bootstrapStageDigest("native.fork", { sessionID: "ses_p", before: "msg" }),
    plain,
  );
  assert.notEqual(
    bootstrapStageDigest("native.fork", { sessionID: "ses_q" }),
    plain,
  );
  assert.throws(() =>
    bootstrapStageDigest("native.fork", { sessionID: "ses_p", extra: 1 }),
  );
  assert.throws(() => bootstrapStageDigest("native.send", { sessionID: "x" }));
  assert.notEqual(
    bootstrapStageDigest("native.fork", { sessionID: "ses_p" }),
    bootstrapStageDigest("native.create", create()),
  );
});

test("parent, metadata and baseline helpers are exact", () => {
  const parent = { id: "ses_p", projectID: "project", directory: "/work" };
  const digest = bootstrapParentDigest(parent);
  for (const key of Object.keys(parent))
    assert.notEqual(bootstrapParentDigest({ ...parent, [key]: "x" }), digest);
  assert.throws(() => bootstrapParentDigest({ ...parent, extra: "x" }));
  assert.throws(() => bootstrapMetadataDigest(undefined));
  assert.throws(() => bootstrapMetadataDigest({ a: 1 }));
  assert.notEqual(
    bootstrapMetadataDigest({ a: "1" }),
    bootstrapMetadataDigest({ a: "2" }),
  );
  assert.equal(
    bootstrapBaselinePermissions(BASELINE_POLICY.map((r) => ({ ...r }))),
    true,
  );
  // Neither the legacy baseline, a reordered floor nor a missing floor passes.
  assert.equal(
    bootstrapBaselinePermissions([
      ...BASELINE_POLICY,
      { action: "subagent", resource: "*", effect: "deny" },
    ]),
    false,
  );
  assert.equal(
    bootstrapBaselinePermissions([...BASELINE_POLICY].reverse()),
    false,
  );
  assert.equal(bootstrapBaselinePermissions([BASELINE_POLICY[0]]), false);
  assert.equal(bootstrapBaselinePermissions(undefined), false);
});

test("proof digests separate states and outcomes", () => {
  const row = {
    handoffId: "5f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a11",
    step: "native.create",
    stageArgumentDigest: "1".repeat(64),
  };
  const states = ["armed", "consumed", "completed", "revoked"].map((state) =>
    bootstrapHandoffProof({ ...row, state }),
  );
  assert.equal(new Set(states).size, 4);
  const task = { taskScopeId: "5f1c2a40-1b7e-4c1a-8d33-0f5e5b9d3a12" };
  const settled = bootstrapTaskProof({
    ...task,
    outcome: "settled",
    appSessionId: "app",
    nativeSessionId: "ses",
  });
  assert.notEqual(
    settled,
    bootstrapTaskProof({ ...task, outcome: "no_effect" }),
  );
  assert.notEqual(
    settled,
    bootstrapTaskProof({
      ...task,
      outcome: "settled",
      appSessionId: "app",
      nativeSessionId: "other",
    }),
  );
});
