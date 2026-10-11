import test from "node:test";
import assert from "node:assert/strict";
import {
  validSkillRuntimeObservation,
  validSkillRuntimeMutation,
  skillRuntimeIdPayload,
} from "./renderer/shared/configuration-draft/skill-runtime.mjs";
import { validateRequest } from "./workbench-contract.mjs";
const hex = "a".repeat(64);
test("Native Skills closed public read and mutation inputs", () => {
  const read = {
    type: "configuration.skill.runtime.read",
    workspaceId: "w",
    sessionId: "s",
    sourceName: "one",
  };
  assert.deepEqual(validateRequest(read), read);
  assert.throws(() => validateRequest({ ...read, nonce: hex }));
  const register = {
    type: "configuration.skill.register",
    workspaceId: "w",
    requestId: "op",
    sourceName: "one",
    observationId: "observation",
    version: hex,
    directoryVersion: hex,
    digest: hex,
  };
  assert.deepEqual(validateRequest(register), register);
  for (const patch of [
    { digest: "bad" },
    { sourceName: "../bad" },
    { text: "body" },
  ])
    assert.throws(() => validateRequest({ ...register, ...patch }));
  for (const type of [
    "configuration.skill.remove",
    "configuration.skill.apply",
  ]) {
    const input = {
      type,
      workspaceId: "w",
      requestId: "op",
      nativeId: `omoc-skill-${hex}`,
      observationId: "observation",
      ...(type.endsWith("apply") && { sessionId: "s" }),
    };
    assert.deepEqual(validateRequest(input), input);
    assert.throws(() =>
      validateRequest({ ...input, registrationRuntimeEpoch: "foreign" }),
    );
  }
});
test("Native Skills observed shapes reject authority and correlation defects", () => {
  const value = {
    workspaceId: "w",
    workspacePath: "/synthetic/w",
    runtimeEpoch: "epoch",
    status: "observed",
    observationId: "observation",
    owned: [],
    unowned: [],
  };
  assert.equal(validSkillRuntimeObservation(value), true);
  for (const patch of [
    { nonce: hex },
    { owned: [{}] },
    { unowned: [{ nativeId: "x", name: "N", ownership: "current_runtime" }] },
    { session: { sessionId: "s", status: "observed", messages: [{}] } },
    {
      file: {
        sourceName: "one",
        status: "available",
        version: hex,
        directoryVersion: hex,
        digest: "bad",
      },
    },
  ])
    assert.equal(validSkillRuntimeObservation({ ...value, ...patch }), false);
  assert.equal(
    validSkillRuntimeObservation({
      ...value,
      session: { sessionId: "s", status: "observed", messages: [] },
      file: {
        sourceName: "one",
        status: "available",
        version: hex,
        directoryVersion: hex,
        digest: hex,
      },
    }),
    true,
  );
  assert.equal(
    validSkillRuntimeMutation({ requestId: "op", status: "unknown" }),
    true,
  );
  assert.equal(
    validSkillRuntimeMutation({
      requestId: "op",
      status: "unknown",
      nativeId: "pretend",
    }),
    false,
  );
  assert.equal(
    skillRuntimeIdPayload({
      runtimeEpoch: "epoch",
      workspaceId: "w",
      sourceName: "one",
      operationId: "op",
    }),
    JSON.stringify(["epoch", "w", "one", "op"]),
  );
});

test("Native Skills observations reject sparse and accessor array slots", () => {
  const base = {
    workspaceId: "w",
    workspacePath: "/synthetic/w",
    runtimeEpoch: "epoch",
    status: "observed",
    observationId: "obs",
    owned: [],
    unowned: [],
  };
  for (const field of ["owned", "unowned", "messages"]) {
    const sparse = Array(1);
    const value =
      field === "messages"
        ? {
            ...base,
            session: { sessionId: "s", status: "observed", messages: sparse },
          }
        : { ...base, [field]: sparse };
    assert.equal(validSkillRuntimeObservation(value), false, field);
  }
  let reads = 0;
  const unowned = [];
  Object.defineProperty(unowned, "0", {
    get() {
      reads++;
      return { nativeId: "foreign", name: "Foreign" };
    },
    enumerable: true,
  });
  assert.equal(validSkillRuntimeObservation({ ...base, unowned }), false);
  assert.equal(reads, 0);
});
