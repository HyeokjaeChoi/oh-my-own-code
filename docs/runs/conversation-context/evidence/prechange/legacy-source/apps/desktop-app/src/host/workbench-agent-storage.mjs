// Closed durable Agent authority. No file bodies, paths, Native state or replay.
import {
  AGENT_RUNTIME_FEATURE,
  agentRuntimeStep,
  validAgentNativeId,
  validAgentRuntimeMutation,
} from "../renderer/shared/configuration-draft/agent-runtime.mjs";
import { validAgentSourceName } from "../renderer/shared/configuration-draft/agent.mjs";
import { nativeAgentRegistrationId } from "../native-agents-protocol.mjs";
export const AGENT_FEATURE = AGENT_RUNTIME_FEATURE;
export const AGENT_RUNTIME_DISPATCH_FIELDS = Object.freeze([
  "sourceName",
  "nativeId",
  "digest",
  "nativeDigest",
  "registrationRuntimeEpoch",
  "registrationOperationId",
  "systemDigest",
]);
export const AGENT_RUNTIME_RESULT_FIELDS = Object.freeze({
  agent_registered: [
    ...AGENT_RUNTIME_DISPATCH_FIELDS,
    "version",
    "directoryVersion",
    "defaultAgentId",
  ],
  agent_removed: [...AGENT_RUNTIME_DISPATCH_FIELDS, "defaultAgentId"],
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
const register = (type) => type === "configuration.agent.register";
const kind = (type) =>
  ({
    "configuration.agent.register": "agent_registered",
    "configuration.agent.remove": "agent_removed",
  })[type];
const registrationId = (identity, target) =>
  nativeAgentRegistrationId({
    runtimeEpoch: target.registrationRuntimeEpoch,
    operationId: target.registrationOperationId,
    workspaceId: identity.workspaceId,
    sourceName: target.sourceName,
  });
export function validateAgentRuntimeScope(identity) {
  if (!agentRuntimeStep(identity.type)) return;
  need(
    id(identity.workspaceId) && !Object.hasOwn(identity, "sessionId"),
    "invalid_record",
  );
}
// Called with the validated v2 original operation, never an observed row.
export function agentRuntimeAdmission(identity, operation) {
  need(
    agentRuntimeStep(identity.type) &&
      identity.type === operation.type &&
      identity.workspaceId === operation.workspaceId &&
      identity.sessionId === operation.sessionId &&
      identity.operationId === operation.requestId,
    "invalid_record",
  );
  const agentRuntime = register(identity.type)
    ? {
        sourceName: operation.sourceName,
        nativeId: nativeAgentRegistrationId({
          ...identity,
          sourceName: operation.sourceName,
        }),
        digest: operation.digest,
        version: operation.version,
        directoryVersion: operation.directoryVersion,
      }
    : { nativeId: operation.nativeId };
  validateAgentRuntimeAdmission({ identity, agentRuntime });
  return agentRuntime;
}
export function validateAgentRuntimeAdmission(value) {
  const { identity, agentRuntime } = value;
  if (!agentRuntimeStep(identity.type)) {
    need(!Object.hasOwn(value, "agentRuntime"), "invalid_record");
    return;
  }
  validateAgentRuntimeScope(identity);
  need(
    closed(
      agentRuntime,
      register(identity.type)
        ? ["sourceName", "nativeId", "digest", "version", "directoryVersion"]
        : ["nativeId"],
    ),
    "invalid_record",
  );
  need(validAgentNativeId(agentRuntime.nativeId), "invalid_record");
  if (register(identity.type))
    need(
      validAgentSourceName(agentRuntime.sourceName) &&
        ["digest", "version", "directoryVersion"].every((k) =>
          hex(agentRuntime[k]),
        ) &&
        agentRuntime.nativeId ===
          nativeAgentRegistrationId({
            ...identity,
            sourceName: agentRuntime.sourceName,
          }),
      "invalid_record",
    );
}
export function validateAgentRuntimeDispatchPayload(dispatch) {
  const isStep = ["native.agent.register", "native.agent.remove"].includes(
    dispatch.step,
  );
  if (!isStep) {
    need(!Object.hasOwn(dispatch, "agentRuntime"), "invalid_record");
    return;
  }
  const t = dispatch.agentRuntime;
  need(
    closed(t, AGENT_RUNTIME_DISPATCH_FIELDS) &&
      validAgentSourceName(t.sourceName) &&
      validAgentNativeId(t.nativeId) &&
      ["digest", "nativeDigest", "systemDigest"].every((k) => hex(t[k])) &&
      id(t.registrationRuntimeEpoch) &&
      id(t.registrationOperationId) &&
      !Object.hasOwn(dispatch, "nativeSessionId") &&
      !Object.hasOwn(dispatch, "nativeServerName"),
    "invalid_record",
  );
}
export function validAgentRuntimeResult(record) {
  const r = record.result;
  if (
    !r ||
    !agentRuntimeStep(record.type) ||
    !closed(r, [
      "kind",
      "workspaceId",
      ...AGENT_RUNTIME_RESULT_FIELDS[kind(record.type)],
    ])
  )
    return false;
  const { kind: _kind, workspaceId: _workspace, ...fields } = r;
  const status = {
    agent_registered: "registered_primary",
    agent_removed: "removed",
  }[r.kind];
  try {
    validateAgentRuntimeScope({
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
        validAgentRuntimeMutation({
          requestId: record.operationId,
          status,
          ...fields,
        }) &&
        r.nativeId === registrationId(record, r) &&
        (register(record.type)
          ? r.registrationRuntimeEpoch === record.runtimeEpoch &&
            r.registrationOperationId === record.operationId
          : r.registrationRuntimeEpoch === record.runtimeEpoch),
    );
  } catch {
    return false;
  }
}
export function validateAgentRuntimeReceipt(receipt) {
  if (!agentRuntimeStep(receipt.type)) return;
  validateAgentRuntimeScope(receipt);
  if (receipt.effect === "confirmed")
    need(validAgentRuntimeResult(receipt), "invalid_record");
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
// Exact original confirmed register receipt is mandatory for removal.
export function validateAgentRuntimeDispatch(
  operation,
  dispatch,
  sessions,
  operations,
) {
  const expected = agentRuntimeStep(operation.identity.type);
  if (
    !expected &&
    !dispatch.step.startsWith("native.agent.") &&
    !Object.hasOwn(dispatch, "agentRuntime")
  )
    return;
  validateAgentRuntimeDispatchPayload(dispatch);
  need(expected === dispatch.step);
  const { identity, agentRuntime: admitted } = operation;
  const target = dispatch.agentRuntime;
  need(
    admitted &&
      target.nativeId === admitted.nativeId &&
      target.nativeId === registrationId(identity, target),
  );
  need(operation.dispatches.every((d) => d.step === expected));
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
        original.identity.type === "configuration.agent.register" &&
        original.identity.workspaceId === identity.workspaceId &&
        validAgentRuntimeResult(original.receipt) &&
        AGENT_RUNTIME_DISPATCH_FIELDS.every(
          (k) => target[k] === original.receipt.result[k],
        ) &&
        ![...operations.values()].some(
          (entry) =>
            entry !== operation &&
            entry.terminal &&
            entry.identity.type === "configuration.agent.remove" &&
            entry.identity.workspaceId === identity.workspaceId &&
            validAgentRuntimeResult(entry.receipt) &&
            AGENT_RUNTIME_DISPATCH_FIELDS.every(
              (k) => entry.receipt.result[k] === target[k],
            ),
        ),
    );
  }
}
export function validateAgentRuntimeCompletion(
  operation,
  payload,
  features,
  sessions,
  operations,
) {
  // This check also runs for workspace removal, in live commits and journal replay.
  for (const tombstone of payload.delta.tombstones) {
    if (tombstone.kind !== "workspace") continue;
    need(
      ![...operations.values()].some(
        (registered) =>
          registered.terminal &&
          registered.identity.type === "configuration.agent.register" &&
          registered.identity.workspaceId === tombstone.id &&
          registered.identity.runtimeEpoch ===
            operation.identity.runtimeEpoch &&
          validAgentRuntimeResult(registered.receipt) &&
          ![...operations.values()].some(
            (removed) =>
              removed.terminal &&
              removed.identity.type === "configuration.agent.remove" &&
              removed.identity.workspaceId === tombstone.id &&
              validAgentRuntimeResult(removed.receipt) &&
              AGENT_RUNTIME_DISPATCH_FIELDS.every(
                (k) =>
                  removed.receipt.result[k] === registered.receipt.result[k],
              ),
          ),
      ),
    );
  }
  if (!agentRuntimeStep(operation.identity.type)) return;
  need(features.includes(AGENT_FEATURE), "unsupported_version");
  const { receipt, delta } = payload;
  need(
    !operation.reservation &&
      !operation.reserved &&
      delta.workspaces.length === 0 &&
      delta.sessions.length === 0 &&
      delta.tombstones.length === 0,
  );
  validateAgentRuntimeReceipt(receipt);
  if (receipt.effect !== "confirmed") return;
  need(operation.dispatches.length === 1);
  const dispatch = operation.dispatches[0];
  validateAgentRuntimeDispatch(operation, dispatch, sessions, operations);
  need(
    AGENT_RUNTIME_DISPATCH_FIELDS.every(
      (k) => receipt.result[k] === dispatch.agentRuntime[k],
    ),
  );
  if (register(operation.identity.type))
    need(
      ["version", "directoryVersion"].every(
        (k) => receipt.result[k] === operation.agentRuntime[k],
      ),
    );
}

import { configurationBackupId } from "./configuration-file-observation.mjs";

export const isAgentSave = (type) => type === "configuration.agent.save";
const wireId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const resourceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
export const agentBackupId = (runtimeEpoch, operationId) =>
  configurationBackupId(runtimeEpoch, operationId, "agent");
// Private admission authority is supplied separately; a result cannot bind itself.
export function validAgentSavedResult(record, sourceName) {
  const result = record.result;
  return !!(
    isAgentSave(record.type) &&
    wireId(record.runtimeEpoch) &&
    wireId(record.operationId) &&
    resourceId(record.workspaceId) &&
    record.sessionId === undefined &&
    record.admission === "dispatched" &&
    record.delivery === "accepted" &&
    record.effect === "confirmed" &&
    validAgentSourceName(sourceName) &&
    result &&
    Object.getPrototypeOf(result) === Object.prototype &&
    ["kind", "workspaceId", "sourceName", "version"].every((key) =>
      Object.hasOwn(result, key),
    ) &&
    Reflect.ownKeys(result).every(
      (key) =>
        ["kind", "workspaceId", "sourceName", "version", "backupId"].includes(
          key,
        ) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(result, key), "value"),
    ) &&
    result.kind === "agent_file_saved" &&
    result.workspaceId === record.workspaceId &&
    result.sourceName === sourceName &&
    typeof result.version === "string" &&
    /^[a-f0-9]{64}$/.test(result.version) &&
    (!Object.hasOwn(result, "backupId") ||
      result.backupId ===
        agentBackupId(record.runtimeEpoch, record.operationId))
  );
}
