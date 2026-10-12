// Pure decision logic for the startup crash reconciler of unsettled bootstrap
// (Native create) tasks. No IO, no journal, no authority: the live ledger reads
// Native and re-runs this same decision when the registry asks it to verify a
// `task_reconciled` record, so the record cannot be forged by a caller.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import {
  bootstrapBaselinePermissions,
  bootstrapMetadataDigest,
  bootstrapTaskProof,
} from "./native-permission-bootstrap-digest.mjs";

const SUPPORTED_TYPES = [
  "session.create",
  "workspace.create",
  "workspace.import",
];
const HANDOFF_STATES = ["armed", "consumed", "completed", "revoked"];
const hold = { outcome: "hold" };

// Handoff trail class of an unsettled create task, or undefined when the
// journal shape is anything but the one this reconciler understands.
export function reconcilableHandoff(task) {
  const handoffs = task?.handoffs;
  if (!Array.isArray(handoffs) || handoffs.length > 1) return undefined;
  if (!handoffs.length) return "none";
  return HANDOFF_STATES.includes(handoffs[0].state)
    ? handoffs[0].state
    : undefined;
}

// Exactly what a fresh bootstrap create had to produce, from journal data only.
export function reconcileExpectation(operation, task) {
  const reservation = operation?.reservation;
  const handoff = reconcilableHandoff(task);
  if (
    !reservation ||
    !operation.identity ||
    !SUPPORTED_TYPES.includes(operation.identity.type) ||
    operation.terminal ||
    task?.identity?.originKind !== "bootstrap" ||
    task.binding?.step !== "native.create" ||
    !["prepared", "bound"].includes(task.phase) ||
    (Object.hasOwn(task.identity, "nativeSessionId") &&
      (task.identity.nativeSessionId !== reservation.plannedNativeSessionId ||
        task.identity.appSessionId !== reservation.appSessionId)) ||
    typeof reservation.plannedNativeSessionId !== "string" ||
    typeof reservation.appSessionId !== "string" ||
    !reservation.workspace?.workspaceId ||
    typeof reservation.workspace.canonicalPath !== "string" ||
    handoff === undefined
  )
    return undefined;
  return {
    handoff,
    nativeSessionId: reservation.plannedNativeSessionId,
    appSessionId: reservation.appSessionId,
    workspaceId: reservation.workspace.workspaceId,
    canonicalPath: reservation.workspace.canonicalPath,
    projectId: task.identity.projectId,
    taskScopeId: task.identity.taskScopeId,
    metadata: {
      operationId: operation.identity.operationId,
      originalRuntimeEpoch: operation.identity.runtimeEpoch,
      appSessionId: reservation.appSessionId,
      workspaceId: reservation.workspace.workspaceId,
      digest: operation.identity.digest,
    },
  };
}

// Detached, closed copy of what Native answered. Anything unexpected is
// returned as `unreadable`, which the decision always holds.
export function observeSession(info) {
  try {
    const permissions = JSON.parse(
      permissionCanonicalJSON(info?.permissions ?? null),
    );
    return JSON.parse(
      permissionCanonicalJSON({
        status: "found",
        id: info?.id,
        projectID: info?.projectID,
        directory: info?.location?.directory,
        metadata: info?.metadata ?? null,
        permissions,
        parentID: info?.parentID ?? null,
        fork: info?.fork ?? null,
        title: typeof info?.title === "string" ? info.title : "",
      }),
    );
  } catch {
    return { status: "unreadable" };
  }
}
export const ABSENT_OBSERVATION = Object.freeze({ status: "absent" });

export const observationDigest = (original, nativeSessionId, observation) =>
  createHash("sha256")
    .update("omoc.native.bootstrap.reconcile.v1\n", "utf8")
    .update(
      permissionCanonicalJSON({
        original: {
          runtimeEpoch: original.runtimeEpoch,
          operationId: original.operationId,
        },
        nativeSessionId,
        observation,
      }),
      "utf8",
    )
    .digest("hex");

const exactSession = (expectation, observed) => {
  try {
    return (
      observed.status === "found" &&
      observed.id === expectation.nativeSessionId &&
      observed.projectID === expectation.projectId &&
      observed.directory === expectation.canonicalPath &&
      observed.parentID === null &&
      observed.fork === null &&
      isDeepStrictEqual(observed.metadata, expectation.metadata) &&
      bootstrapBaselinePermissions(observed.permissions)
    );
  } catch {
    return false;
  }
};

// Never guesses: only a typed absence of the planned id proves no effect, and
// only an exact match proves the created session. Everything else holds.
export function decideReconciliation(operation, task, observation) {
  const expectation = reconcileExpectation(operation, task);
  if (!expectation) return hold;
  const { handoff } = expectation;
  if (observation?.status === "absent") {
    // A consumed handoff means Native was already told to create: absence is
    // then contradictory, not proof.
    if (
      !["none", "armed", "revoked"].includes(handoff) ||
      Object.hasOwn(task.identity, "nativeSessionId")
    )
      return hold;
    return {
      outcome: "no_effect",
      proofDigest: bootstrapTaskProof({
        outcome: "no_effect",
        taskScopeId: expectation.taskScopeId,
      }),
      bootstrap: {},
    };
  }
  // A never-armed or revoked trail cannot explain a session under this id.
  if (
    !exactSession(expectation, observation) ||
    !["armed", "consumed", "completed"].includes(handoff)
  )
    return hold;
  const title = observation.title.slice(0, 256) || "Untitled session";
  return {
    outcome: "settled",
    proofDigest: bootstrapTaskProof({
      outcome: "settled",
      taskScopeId: expectation.taskScopeId,
      appSessionId: expectation.appSessionId,
      nativeSessionId: expectation.nativeSessionId,
    }),
    bootstrap: {
      appSessionId: expectation.appSessionId,
      nativeSessionId: expectation.nativeSessionId,
      metadataDigest: bootstrapMetadataDigest(expectation.metadata),
      title,
    },
  };
}
