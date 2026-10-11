import test from "node:test";
import assert from "node:assert/strict";
import {
  skillRuntimeAdmission,
  validSkillRuntimeResult,
  validateSkillRuntimeAdmission,
  validateSkillRuntimeDispatch,
  validateSkillRuntimeCompletion,
  SKILL_RUNTIME_FEATURE,
} from "./workbench-skill-runtime-storage.mjs";
import { nativeSkillRegistrationId } from "../native-skills-protocol.mjs";

const h = (v) => v.repeat(64);
const identity = {
  runtimeEpoch: "epoch",
  operationId: "register",
  workspaceId: "ws",
  type: "configuration.skill.register",
  digest: h("a"),
};
const target = {
  sourceName: "review",
  nativeId: nativeSkillRegistrationId({ ...identity, sourceName: "review" }),
  digest: h("b"),
  nativeDigest: h("c"),
  bodyDigest: h("d"),
  registrationRuntimeEpoch: "epoch",
  registrationOperationId: "register",
};
const admission = {
  sourceName: target.sourceName,
  nativeId: target.nativeId,
  digest: target.digest,
  version: h("e"),
  directoryVersion: h("f"),
};
const dispatch = {
  runtimeEpoch: "epoch",
  operationId: "register",
  step: "native.skill.register",
  skillRuntime: target,
};
const receipt = {
  ...identity,
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 1,
  evidence: [],
  result: {
    kind: "skill_registered",
    workspaceId: "ws",
    ...target,
    version: admission.version,
    directoryVersion: admission.directoryVersion,
  },
};
delete receipt.digest;
const operation = {
  identity,
  skillRuntime: admission,
  dispatches: [dispatch],
  receipt,
  terminal: true,
};
const operations = new Map([
  [JSON.stringify(["epoch", "register"]), operation],
]);
const sessions = new Map([
  [
    "session",
    { workspaceId: "ws", lifecycleState: "active", nativeSessionId: "native" },
  ],
]);
const delta = { workspaces: [], sessions: [], tombstones: [] };
const features = [SKILL_RUNTIME_FEATURE];

test("Skill admission computes exact original Native ID and refuses source/version/field/key drift", () => {
  const request = {
    type: identity.type,
    requestId: identity.operationId,
    workspaceId: "ws",
    sourceName: "review",
    digest: target.digest,
    version: admission.version,
    directoryVersion: admission.directoryVersion,
  };
  assert.deepEqual(skillRuntimeAdmission(identity, request), admission);
  assert.throws(() =>
    skillRuntimeAdmission(identity, { ...request, requestId: "other" }),
  );
  for (const changed of [
    { ...admission, sourceName: "other" },
    { ...admission, nativeId: `omoc-skill-${h("0")}` },
    { ...admission, version: "bad" },
    { ...admission, directoryVersion: "bad" },
    { ...admission, body: "PRIVATE" },
    { ...admission, path: "/PRIVATE" },
    { ...admission, nonce: "PRIVATE" },
    Object.create(admission),
  ])
    assert.throws(() =>
      validateSkillRuntimeAdmission({ identity, skillRuntime: changed }),
    );
  assert.throws(() =>
    validateSkillRuntimeAdmission({
      identity: { ...identity, sessionId: "session" },
      skillRuntime: admission,
    }),
  );
});

test("Skill register completion requires exact flushed target/file versions and zero topology", () => {
  assert.equal(validSkillRuntimeResult(receipt), true);
  validateSkillRuntimeCompletion(
    operation,
    { receipt, delta },
    features,
    sessions,
    operations,
  );
  for (const field of [
    "sourceName",
    "nativeId",
    "digest",
    "nativeDigest",
    "bodyDigest",
    "registrationRuntimeEpoch",
    "registrationOperationId",
    "version",
    "directoryVersion",
  ])
    assert.throws(() =>
      validateSkillRuntimeCompletion(
        operation,
        {
          receipt: {
            ...receipt,
            result: {
              ...receipt.result,
              [field]:
                field.includes("igest") || field.includes("ersion")
                  ? h("0")
                  : "other",
            },
          },
          delta,
        },
        features,
        sessions,
        operations,
      ),
    );
  assert.throws(() =>
    validateSkillRuntimeCompletion(
      { ...operation, dispatches: [] },
      { receipt, delta },
      features,
      sessions,
      operations,
    ),
  );
  assert.throws(() =>
    validateSkillRuntimeCompletion(
      operation,
      { receipt, delta },
      [],
      sessions,
      operations,
    ),
  );
  assert.throws(() =>
    validateSkillRuntimeCompletion(
      operation,
      {
        receipt,
        delta: { ...delta, tombstones: [{ kind: "workspace", id: "ws" }] },
      },
      features,
      sessions,
      operations,
    ),
  );
});

for (const action of ["remove", "apply"]) {
  test(`Skill ${action} requires exact confirmed original register and admitted target`, () => {
    const scope = {
      ...identity,
      type: `configuration.skill.${action}`,
      operationId: action,
      ...(action === "apply" && { sessionId: "session" }),
    };
    const next = {
      identity: scope,
      skillRuntime: { nativeId: target.nativeId },
    };
    const intent = {
      ...dispatch,
      step: `native.skill.${action}`,
      operationId: action,
      ...(action === "apply" && { nativeSessionId: "native" }),
    };
    validateSkillRuntimeDispatch(next, intent, sessions, operations);
    for (const invalidOriginal of [
      undefined,
      { ...operation, terminal: false },
      { ...operation, receipt: { ...receipt, effect: "unknown" } },
      { ...operation, identity: { ...identity, workspaceId: "foreign" } },
    ]) {
      const refs = new Map(operations);
      refs.set(JSON.stringify(["epoch", "register"]), invalidOriginal);
      assert.throws(() =>
        validateSkillRuntimeDispatch(next, intent, sessions, refs),
      );
    }
    for (const field of ["digest", "nativeDigest", "bodyDigest"])
      assert.throws(() =>
        validateSkillRuntimeDispatch(
          next,
          { ...intent, skillRuntime: { ...target, [field]: h("0") } },
          sessions,
          operations,
        ),
      );
    assert.throws(() =>
      validateSkillRuntimeDispatch(
        { ...next, skillRuntime: { nativeId: `omoc-skill-${h("0")}` } },
        intent,
        sessions,
        operations,
      ),
    );
    if (action === "apply")
      assert.throws(() =>
        validateSkillRuntimeDispatch(
          next,
          { ...intent, nativeSessionId: "foreign" },
          sessions,
          operations,
        ),
      );
    else
      assert.throws(() =>
        validateSkillRuntimeDispatch(
          next,
          { ...intent, nativeSessionId: "native" },
          sessions,
          operations,
        ),
      );
  });
}

for (const action of ["remove", "apply"]) {
  test(`Skill ${action} completion binds exact dispatch and selected-session message proof`, () => {
    const scope = {
      ...identity,
      type: `configuration.skill.${action}`,
      operationId: action,
      ...(action === "apply" && { sessionId: "session" }),
    };
    const intent = {
      ...dispatch,
      operationId: action,
      step: `native.skill.${action}`,
      ...(action === "apply" && { nativeSessionId: "native" }),
    };
    const common = { ...target };
    if (action === "remove") delete common.bodyDigest;
    const confirmed = {
      ...receipt,
      operationId: action,
      type: scope.type,
      ...(action === "apply" && { sessionId: "session" }),
      result: {
        kind: action === "apply" ? "skill_applied" : "skill_removed",
        workspaceId: "ws",
        ...common,
        ...(action === "apply" && {
          sessionId: "session",
          nativeSessionId: "native",
          nativeMessageId: "message",
        }),
      },
    };
    const next = {
      identity: scope,
      skillRuntime: { nativeId: target.nativeId },
      dispatches: [intent],
    };
    validateSkillRuntimeCompletion(
      next,
      { receipt: confirmed, delta },
      features,
      sessions,
      operations,
    );
    for (const field of [
      "digest",
      "nativeDigest",
      ...(action === "apply"
        ? ["bodyDigest", "sessionId", "nativeSessionId", "nativeMessageId"]
        : []),
    ]) {
      const changed = {
        ...confirmed,
        result: {
          ...confirmed.result,
          [field]: field.includes("Digest") || field === "digest" ? h("0") : "",
        },
      };
      assert.throws(() =>
        validateSkillRuntimeCompletion(
          next,
          { receipt: changed, delta },
          features,
          sessions,
          operations,
        ),
      );
    }
    for (const changed of [
      { ...confirmed, admission: "admitted", effect: "none" },
      { ...confirmed, effect: "unknown" },
    ])
      assert.throws(() =>
        validateSkillRuntimeCompletion(
          next,
          { receipt: changed, delta },
          features,
          sessions,
          operations,
        ),
      );
  });
}
