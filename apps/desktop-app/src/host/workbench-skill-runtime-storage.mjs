// Closed durable Skill authority. No file bodies, paths, Native state or replay.
import {
  SKILL_RUNTIME_FEATURE,
  skillRuntimeStep,
  validSkillNativeId,
  validSkillRuntimeMutation,
} from "../renderer/shared/configuration-draft/skill-runtime.mjs";
import { validSkillSourceName } from "../renderer/shared/configuration-draft/skill.mjs";
import { nativeSkillRegistrationId } from "../native-skills-protocol.mjs";
export { SKILL_RUNTIME_FEATURE, skillRuntimeStep };
export const SKILL_RUNTIME_DISPATCH_FIELDS = Object.freeze([
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
  "bodyDigest",
]);
export const SKILL_RUNTIME_RESULT_FIELDS = Object.freeze({
  skill_registered: [
    ...SKILL_RUNTIME_DISPATCH_FIELDS,
    "version",
    "directoryVersion",
  ],
  skill_removed: SKILL_RUNTIME_DISPATCH_FIELDS.filter(
    (k) => k !== "bodyDigest",
  ),
  skill_applied: [
    ...SKILL_RUNTIME_DISPATCH_FIELDS,
    "sessionId",
    "nativeSessionId",
    "nativeMessageId",
  ],
});
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const id = (v) => typeof v === "string" && /^[\w.:-]{1,256}$/u.test(v);
const closed = (v, keys) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      keys.every((k) => Object.hasOwn(v, k)) &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          keys.includes(k) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
const need = (ok, code = "identity_conflict") => {
  if (!ok) throw Object.assign(new Error(code), { code });
};
const register = (type) => type === "configuration.skill.register";
const apply = (type) => type === "configuration.skill.apply";
const kind = (type) =>
  ({
    "configuration.skill.register": "skill_registered",
    "configuration.skill.remove": "skill_removed",
    "configuration.skill.apply": "skill_applied",
  })[type];
const registrationId = (identity, target) =>
  nativeSkillRegistrationId({
    runtimeEpoch: target.registrationRuntimeEpoch,
    operationId: target.registrationOperationId,
    workspaceId: identity.workspaceId,
    sourceName: target.sourceName,
  });
export function validateSkillRuntimeScope(identity) {
  if (!skillRuntimeStep(identity.type)) return;
  need(
    id(identity.workspaceId) &&
      (apply(identity.type)
        ? id(identity.sessionId)
        : !Object.hasOwn(identity, "sessionId")),
    "invalid_record",
  );
}
// Called with the validated v2 original operation, never an observed row.
export function skillRuntimeAdmission(identity, operation) {
  need(
    skillRuntimeStep(identity.type) &&
      identity.type === operation.type &&
      identity.workspaceId === operation.workspaceId &&
      identity.sessionId === operation.sessionId &&
      identity.operationId === operation.requestId,
    "invalid_record",
  );
  const skillRuntime = register(identity.type)
    ? {
        sourceName: operation.sourceName,
        nativeId: nativeSkillRegistrationId({
          ...identity,
          sourceName: operation.sourceName,
        }),
        digest: operation.digest,
        version: operation.version,
        directoryVersion: operation.directoryVersion,
      }
    : { nativeId: operation.nativeId };
  validateSkillRuntimeAdmission({ identity, skillRuntime });
  return skillRuntime;
}
export function validateSkillRuntimeAdmission(value) {
  const { identity, skillRuntime } = value;
  if (!skillRuntimeStep(identity.type)) {
    need(!Object.hasOwn(value, "skillRuntime"), "invalid_record");
    return;
  }
  validateSkillRuntimeScope(identity);
  need(
    closed(
      skillRuntime,
      register(identity.type)
        ? ["sourceName", "nativeId", "digest", "version", "directoryVersion"]
        : ["nativeId"],
    ),
    "invalid_record",
  );
  need(validSkillNativeId(skillRuntime.nativeId), "invalid_record");
  if (register(identity.type))
    need(
      validSkillSourceName(skillRuntime.sourceName) &&
        ["digest", "version", "directoryVersion"].every((k) =>
          hex(skillRuntime[k]),
        ) &&
        skillRuntime.nativeId ===
          nativeSkillRegistrationId({
            ...identity,
            sourceName: skillRuntime.sourceName,
          }),
      "invalid_record",
    );
}
export function validateSkillRuntimeDispatchPayload(dispatch) {
  const isStep = [
    "native.skill.register",
    "native.skill.remove",
    "native.skill.apply",
  ].includes(dispatch.step);
  if (!isStep) {
    need(!Object.hasOwn(dispatch, "skillRuntime"), "invalid_record");
    return;
  }
  const t = dispatch.skillRuntime;
  need(
    closed(t, SKILL_RUNTIME_DISPATCH_FIELDS) &&
      validSkillSourceName(t.sourceName) &&
      validSkillNativeId(t.nativeId) &&
      ["digest", "nativeDigest", "bodyDigest"].every((k) => hex(t[k])) &&
      id(t.registrationRuntimeEpoch) &&
      id(t.registrationOperationId) &&
      (dispatch.step === "native.skill.apply"
        ? id(dispatch.nativeSessionId)
        : !Object.hasOwn(dispatch, "nativeSessionId")) &&
      !Object.hasOwn(dispatch, "nativeServerName"),
    "invalid_record",
  );
}
export function validSkillRuntimeResult(record) {
  const r = record.result;
  if (
    !r ||
    !skillRuntimeStep(record.type) ||
    !closed(r, [
      "kind",
      "workspaceId",
      ...SKILL_RUNTIME_RESULT_FIELDS[kind(record.type)],
    ])
  )
    return false;
  const { kind: _kind, workspaceId: _workspace, ...fields } = r;
  const status = {
    skill_registered: "registered_disabled",
    skill_removed: "removed",
    skill_applied: "applied",
  }[r.kind];
  try {
    validateSkillRuntimeScope({
      type: record.type,
      workspaceId: record.workspaceId,
      ...(record.sessionId !== undefined && { sessionId: record.sessionId }),
    });
    return Boolean(
      r.kind === kind(record.type) &&
        r.workspaceId === record.workspaceId &&
        record.admission === "dispatched" &&
        record.delivery === "accepted" &&
        record.effect === "confirmed" &&
        validSkillRuntimeMutation({
          requestId: record.operationId,
          status,
          ...fields,
        }) &&
        r.nativeId === registrationId(record, r) &&
        (register(record.type)
          ? r.registrationRuntimeEpoch === record.runtimeEpoch &&
            r.registrationOperationId === record.operationId
          : r.registrationRuntimeEpoch === record.runtimeEpoch) &&
        (!apply(record.type) || r.sessionId === record.sessionId),
    );
  } catch {
    return false;
  }
}
export function validateSkillRuntimeReceipt(receipt) {
  if (!skillRuntimeStep(receipt.type)) return;
  validateSkillRuntimeScope(receipt);
  if (receipt.effect === "confirmed")
    need(validSkillRuntimeResult(receipt), "invalid_record");
  else
    need(
      (receipt.result === undefined ||
        (receipt.result.kind === "rejected" &&
          receipt.admission === "rejected" &&
          receipt.effect === "none")) &&
        !(receipt.delivery === "accepted" && receipt.effect === "none"),
      "invalid_record",
    );
}
// Exact original confirmed register receipt is mandatory for remove/apply.
export function validateSkillRuntimeDispatch(
  operation,
  dispatch,
  sessions,
  operations,
) {
  const expected = skillRuntimeStep(operation.identity.type);
  if (
    !expected &&
    !dispatch.step.startsWith("native.skill.") &&
    !Object.hasOwn(dispatch, "skillRuntime")
  )
    return;
  validateSkillRuntimeDispatchPayload(dispatch);
  need(expected === dispatch.step);
  const { identity, skillRuntime: admitted } = operation;
  const target = dispatch.skillRuntime;
  need(
    admitted &&
      target.nativeId === admitted.nativeId &&
      target.nativeId === registrationId(identity, target),
  );
  if (register(identity.type)) {
    need(
      target.registrationRuntimeEpoch === identity.runtimeEpoch &&
        target.registrationOperationId === identity.operationId &&
        ["sourceName", "digest"].every((k) => target[k] === admitted[k]),
    );
  } else {
    const original = operations.get(
      JSON.stringify([
        target.registrationRuntimeEpoch,
        target.registrationOperationId,
      ]),
    );
    need(
      target.registrationRuntimeEpoch === identity.runtimeEpoch &&
        original?.terminal &&
        original.identity.type === "configuration.skill.register" &&
        original.identity.workspaceId === identity.workspaceId &&
        validSkillRuntimeResult(original.receipt) &&
        SKILL_RUNTIME_DISPATCH_FIELDS.every(
          (k) => target[k] === original.receipt.result[k],
        ),
    );
  }
  if (apply(identity.type)) {
    const mapped = sessions.get(identity.sessionId);
    need(
      mapped?.workspaceId === identity.workspaceId &&
        mapped.lifecycleState === "active" &&
        mapped.nativeSessionId === dispatch.nativeSessionId &&
        id(dispatch.nativeSessionId),
    );
  }
}
export function validateSkillRuntimeCompletion(
  operation,
  payload,
  features,
  sessions,
  operations,
) {
  if (!skillRuntimeStep(operation.identity.type)) return;
  need(features.includes(SKILL_RUNTIME_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need(
    !operation.reservation &&
      !operation.reserved &&
      delta.workspaces.length === 0 &&
      delta.sessions.length === 0 &&
      delta.tombstones.length === 0,
  );
  validateSkillRuntimeReceipt(receipt);
  if (receipt.effect !== "confirmed") return;
  need(operation.dispatches.length === 1);
  const dispatch = operation.dispatches[0];
  validateSkillRuntimeDispatch(operation, dispatch, sessions, operations);
  need(
    SKILL_RUNTIME_DISPATCH_FIELDS.filter(
      (k) => receipt.result.kind !== "skill_removed" || k !== "bodyDigest",
    ).every((k) => receipt.result[k] === dispatch.skillRuntime[k]),
  );
  if (register(operation.identity.type))
    need(
      ["version", "directoryVersion"].every(
        (k) => receipt.result[k] === operation.skillRuntime[k],
      ),
    );
  if (apply(operation.identity.type))
    need(receipt.result.nativeSessionId === dispatch.nativeSessionId);
}
