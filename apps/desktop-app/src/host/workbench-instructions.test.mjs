import test from "node:test";
import assert from "node:assert/strict";
import {
  INSTRUCTION_KEY,
  instructionDigest,
  observeInstructions,
  validInstructionRegistration,
  verifiedInheritance,
} from "./workbench-instructions.mjs";
const text = "\uFEFFFollow local rules.\n";
const registration = {
  state: "registered",
  key: INSTRUCTION_KEY,
  digest: instructionDigest(text),
  sourceVersion: "a".repeat(64),
  origin: "direct",
};
test("bounded closed entry projection refuses takeover and never returns Native text", () => {
  const entries = [
    { key: INSTRUCTION_KEY, value: text },
    { key: "other", value: "private unrelated value" },
  ];
  assert.deepEqual(observeInstructions(entries), {
    status: "unavailable",
    reason: "ownership_conflict",
  });
  const observed = observeInstructions(entries, registration);
  assert.equal(observed.status, "registered");
  assert.equal(observed.origin, "direct");
  assert.ok(!JSON.stringify(observed).includes(text));
  assert.ok(!JSON.stringify(observed).includes("private"));
  for (const bad of [
    null,
    { data: entries },
    Array(65).fill(entries[1]),
    [entries[0], entries[0]],
    [{ key: INSTRUCTION_KEY, value: "\ud800" }],
    [{ key: INSTRUCTION_KEY, value: "x".repeat(32769) }],
  ])
    assert.equal(
      observeInstructions(bad, registration).reason,
      "unsupported_entries",
    );
});
test("canonical baseline preserves full origin independent of metadata insertion order", () => {
  const entries = [{ key: INSTRUCTION_KEY, value: text }];
  const reordered = Object.fromEntries(Object.entries(registration).reverse());
  assert.equal(
    observeInstructions(entries, registration).version,
    observeInstructions(entries, reordered).version,
  );
  const fork = {
    ...registration,
    origin: "fork",
    inheritedFromSessionId: "parent",
  };
  assert.notEqual(
    observeInstructions(entries, fork).version,
    observeInstructions(entries, registration).version,
  );
  assert.equal(
    observeInstructions(entries, fork).inheritedFromSessionId,
    "parent",
  );
  assert.equal(
    validInstructionRegistration({
      ...registration,
      inheritedFromSessionId: "parent",
    }),
    false,
  );
  assert.equal(
    validInstructionRegistration({
      ...fork,
      inheritedFromSessionId: undefined,
    }),
    false,
  );
  assert.equal(
    validInstructionRegistration({
      state: "absent",
      key: INSTRUCTION_KEY,
      origin: "direct",
    }),
    false,
  );
});
test("owned drift is observable and missing is distinct from unobserved ownership", () => {
  assert.equal(observeInstructions([], registration).status, "changed");
  assert.equal(
    observeInstructions(
      [{ key: INSTRUCTION_KEY, value: "changed" }],
      registration,
    ).status,
    "changed",
  );
  assert.equal(observeInstructions([]).status, "missing");
  assert.notEqual(
    observeInstructions([]).version,
    observeInstructions([], { state: "absent", key: INSTRUCTION_KEY }).version,
  );
  assert.equal(
    observeInstructions([{ key: INSTRUCTION_KEY, value: "" }], {
      ...registration,
      digest: instructionDigest(""),
    }).status,
    "registered",
  );
});
test("pending_verification is a fork-only inheritance claim that never observes as registered", () => {
  const pending = {
    ...registration,
    state: "pending_verification",
    origin: "fork",
    inheritedFromSessionId: "parent",
  };
  assert.equal(validInstructionRegistration(pending), true);
  assert.equal(
    validInstructionRegistration({ ...pending, origin: "direct" }),
    false,
  );
  const entries = [{ key: INSTRUCTION_KEY, value: text }];
  assert.equal(observeInstructions(entries, pending).status, "changed");
  assert.equal(
    observeInstructions(entries, verifiedInheritance(pending)).status,
    "registered",
  );
});
