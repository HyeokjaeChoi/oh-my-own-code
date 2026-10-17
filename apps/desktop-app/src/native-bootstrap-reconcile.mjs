// Pure decision logic for the startup crash reconciler of unsettled bootstrap
// (Native create) tasks. No IO, no journal, no authority: the live ledger reads
// Native and re-runs this same decision when the registry asks it to verify a
// `task_reconciled` record, so the record cannot be forged by a caller.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalInstructionRegistration } from "./host/workbench-instructions.mjs";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import {
  bootstrapBaselinePermissions,
  bootstrapForkPermissions,
  bootstrapMetadataDigest,
  bootstrapParentDigest,
  bootstrapTaskProof,
} from "./native-permission-bootstrap-digest.mjs";

const CREATE_TYPES = ["session.create", "workspace.create", "workspace.import"];
const FORK = "session.fork";
const WORKSPACE_TYPES = ["workspace.create", "workspace.import"];
const HANDOFF_STATES = ["armed", "consumed", "completed", "revoked"];
const hold = { outcome: "hold" };
// Journal timestamps (Main's Date.now) and Native's `time.created` come from
// the same host wall clock. A child created before the durable arm is not this
// operation's; one inside the skew window before it is ambiguous and holds.
// The tolerance only ever widens "hold", never makes a pre-arm child eligible.
const ARM_SKEW_MS = 5000;

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

// Exactly what a fresh bootstrap create/fork had to produce, from journal data
// only. A fork has no planned child id: it is found by its parent (below).
export function reconcileExpectation(operation, task) {
  const reservation = operation?.reservation;
  const handoff = reconcilableHandoff(task);
  const type = operation?.identity?.type;
  const fork = type === FORK;
  if (
    !reservation ||
    !operation.identity ||
    ![...CREATE_TYPES, FORK].includes(type) ||
    operation.terminal ||
    task?.identity?.originKind !== "bootstrap" ||
    task.binding?.step !== (fork ? "native.fork" : "native.create") ||
    !["prepared", "bound"].includes(task.phase) ||
    typeof reservation.appSessionId !== "string" ||
    !reservation.workspace?.workspaceId ||
    typeof reservation.workspace.canonicalPath !== "string" ||
    handoff === undefined
  )
    return undefined;
  const bound = Object.hasOwn(task.identity, "nativeSessionId");
  if (bound && task.identity.appSessionId !== reservation.appSessionId)
    return undefined;
  const armedAt = task.handoffs?.[0]?.armedAt;
  const common = {
    handoff,
    armedAt: Number.isSafeInteger(armedAt) && armedAt >= 0 ? armedAt : null,
    appSessionId: reservation.appSessionId,
    workspaceId: reservation.workspace.workspaceId,
    canonicalPath: reservation.workspace.canonicalPath,
    projectId: task.identity.projectId,
    taskScopeId: task.identity.taskScopeId,
  };
  if (fork) {
    const dispatched = (operation.dispatches ?? []).filter(
      (entry) => entry.step === "native.fork",
    );
    if (
      reservation.plannedNativeSessionId !== undefined ||
      dispatched.length !== 1 ||
      typeof dispatched[0].nativeSessionId !== "string" ||
      typeof operation.identity.sessionId !== "string" ||
      typeof task.binding.parentIdentityDigest !== "string" ||
      (bound && typeof task.identity.nativeSessionId !== "string")
    )
      return undefined;
    return {
      ...common,
      kind: "fork",
      nativeSessionId: bound ? task.identity.nativeSessionId : null,
      parentNativeSessionId: dispatched[0].nativeSessionId,
      parentAppSessionId: operation.identity.sessionId,
      parentIdentityDigest: task.binding.parentIdentityDigest,
      before: operation.forkTarget?.beforeMessageId ?? null,
    };
  }
  if (
    typeof reservation.plannedNativeSessionId !== "string" ||
    (bound &&
      task.identity.nativeSessionId !== reservation.plannedNativeSessionId)
  )
    return undefined;
  return {
    ...common,
    kind: "create",
    nativeSessionId: reservation.plannedNativeSessionId,
    workspaceType: WORKSPACE_TYPES.includes(type),
    metadata: {
      operationId: operation.identity.operationId,
      originalRuntimeEpoch: operation.identity.runtimeEpoch,
      appSessionId: reservation.appSessionId,
      workspaceId: reservation.workspace.workspaceId,
      digest: operation.identity.digest,
    },
  };
}

// Registry facts the decision depends on, recomputed from the registry's own
// state (never from a record): sessions Native may already legitimately hold,
// the fork parent's mapping, this operation's own partial mapping, and the
// workspace row a workspace-type no-effect resolution would register.
export function reconcileFacts(operation, state) {
  const sessions = [...(state?.sessions ?? [])];
  const reservation = operation?.reservation;
  const own = sessions.find(
    (row) => row.appSessionId === reservation?.appSessionId,
  );
  const parent = sessions.find(
    (row) => row.appSessionId === operation?.identity?.sessionId,
  );
  let registration = null;
  let invalidRegistration = false;
  try {
    registration = canonicalInstructionRegistration(
      parent?.instructionRegistration,
    );
  } catch {
    invalidRegistration = true;
  }
  const workspace = [...(state?.workspaces ?? [])].find(
    (row) => row.workspaceId === reservation?.workspace?.workspaceId,
  );
  return JSON.parse(
    permissionCanonicalJSON({
      workspace: workspace?.registrationState ?? null,
      own: own?.nativeSessionId ?? null,
      known: sessions
        .filter((row) => row !== own && row.nativeSessionId)
        .map((row) => row.nativeSessionId)
        .sort(),
      parent:
        parent && !invalidRegistration
          ? {
              nativeSessionId: parent.nativeSessionId ?? null,
              workspaceId: parent.workspaceId,
              registration,
              registered: registration?.state === "registered",
            }
          : null,
    }),
  );
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
        created: Number.isFinite(info?.time?.created)
          ? info.time.created
          : null,
      }),
    );
  } catch {
    return { status: "unreadable" };
  }
}
// The fork parent plus every Native session that names it as parent or fork
// source. Any unreadable row is kept as `unreadable`, which always holds.
export const observeFork = (parent, children) => ({
  status: "fork",
  parent: observeSession(parent),
  children: children.map(observeSession),
});
// Native sessions naming the parent as fork source that no registry mapping
// already explains and that are not plain subagents.
const forkChildren = (observation, facts) =>
  (observation?.children ?? []).filter(
    (child) =>
      child.status === "found" &&
      !facts?.known?.includes(child.id) &&
      (child.fork !== null || child.parentID !== observation.parent?.id),
  );
// Settle candidates: the above, minus (when the durable arm time is known)
// children created before it. The arm filter only ever narrows a settle
// choice; it never proves absence (see decideFork). `undefined` = cannot be
// told apart.
export function forkCandidates(expectation, observation, facts) {
  let found = forkChildren(observation, facts);
  const armed = expectation.armedAt;
  if (armed !== null) {
    if (
      found.some(
        (child) =>
          !Number.isFinite(child.created) ||
          (child.created < armed && child.created >= armed - ARM_SKEW_MS),
      )
    )
      return undefined;
    found = found.filter((child) => child.created >= armed);
  }
  return found;
}
export const ABSENT_OBSERVATION = Object.freeze({ status: "absent" });

export const observationDigest = (
  original,
  nativeSessionId,
  observation,
  facts,
) =>
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
        facts,
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

const noEffect = (expectation) => ({
  outcome: "no_effect",
  proofDigest: bootstrapTaskProof({
    outcome: "no_effect",
    taskScopeId: expectation.taskScopeId,
  }),
  bootstrap: {},
});
const NO_EFFECT_TRAILS = ["none", "armed", "revoked"];
const SETTLED_TRAILS = ["armed", "consumed", "completed"];

function exactFork(expectation, parent, child) {
  const source = child.fork;
  return (
    child.status === "found" &&
    typeof child.id === "string" &&
    child.id.length > 0 &&
    child.id !== parent.id &&
    (expectation.nativeSessionId === null ||
      child.id === expectation.nativeSessionId) &&
    child.projectID === parent.projectID &&
    child.directory === expectation.canonicalPath &&
    source?.sessionID === parent.id &&
    (expectation.before === null
      ? child.parentID === null || child.parentID === parent.id
      : (child.parentID === null || child.parentID === parent.id) &&
        source.boundary?.type === "before" &&
        source.boundary.messageID === expectation.before) &&
    isDeepStrictEqual(child.metadata, parent.metadata) &&
    bootstrapForkPermissions(child.permissions, parent.permissions)
  );
}

// A fork child is found by its parent: exactly one session Native holds that
// names the planned parent as fork source and that no registry mapping already
// explains. Nothing else (0 with a consumed trail, >1, any mismatch) settles.
function decideFork(expectation, observation, facts) {
  const { handoff } = expectation;
  const parent = observation?.parent;
  if (
    observation?.status !== "fork" ||
    parent?.status !== "found" ||
    !facts?.parent ||
    facts.parent.nativeSessionId !== parent.id ||
    facts.parent.workspaceId !== expectation.workspaceId ||
    parent.id !== expectation.parentNativeSessionId ||
    parent.projectID !== expectation.projectId ||
    parent.directory !== expectation.canonicalPath ||
    bootstrapParentDigest({
      id: parent.id,
      projectID: parent.projectID,
      directory: parent.directory,
    }) !== expectation.parentIdentityDigest ||
    observation.children.some((child) => child.status !== "found")
  )
    return hold;
  const candidates = forkCandidates(expectation, observation, facts);
  if (!candidates) return hold;
  if (!candidates.length) {
    // A consumed handoff, a bound id or a partial mapping all say Native was
    // told to fork: absence is then contradictory, not proof.
    // A child dropped only for predating the arm time may be this fork's if
    // the wall clock stepped back: it cannot prove absence either.
    if (
      !NO_EFFECT_TRAILS.includes(handoff) ||
      expectation.nativeSessionId !== null ||
      facts.own !== null ||
      forkChildren(observation, facts).some((child) =>
        exactFork(expectation, parent, child),
      )
    )
      return hold;
    return noEffect(expectation);
  }
  const [child] = candidates;
  if (
    candidates.length !== 1 ||
    !SETTLED_TRAILS.includes(handoff) ||
    // Without a durable arm time, an unbound fork is unprovable.
    (expectation.nativeSessionId === null && expectation.armedAt === null) ||
    (facts.own !== null && facts.own !== child.id) ||
    !exactFork(expectation, parent, child)
  )
    return hold;
  return {
    outcome: "settled",
    proofDigest: bootstrapTaskProof({
      outcome: "settled",
      taskScopeId: expectation.taskScopeId,
      appSessionId: expectation.appSessionId,
      nativeSessionId: child.id,
    }),
    bootstrap: {
      appSessionId: expectation.appSessionId,
      nativeSessionId: child.id,
      metadataDigest: bootstrapMetadataDigest(child.metadata),
      title: child.title.slice(0, 256) || "Untitled session",
    },
  };
}

// Never guesses: only a typed absence of the planned id proves no effect, and
// only an exact match proves the created session. Everything else holds.
export function decideReconciliation(operation, task, observation, facts) {
  const expectation = reconcileExpectation(operation, task);
  if (!expectation) return hold;
  try {
    return decideChecked(expectation, task, observation, facts);
  } catch {
    return hold;
  }
}
function decideChecked(expectation, task, observation, facts) {
  if (expectation.kind === "fork")
    return decideFork(expectation, observation, facts);
  const { handoff } = expectation;
  if (observation?.status === "absent") {
    // A consumed handoff means Native was already told to create: absence is
    // then contradictory, not proof.
    if (
      !NO_EFFECT_TRAILS.includes(handoff) ||
      Object.hasOwn(task.identity, "nativeSessionId") ||
      // The workspace's no-effect resolution registers its row: only a
      // still-reserved row (never an unavailable one) can be registered.
      (expectation.workspaceType && facts?.workspace !== "reserved") ||
      (facts?.own ?? null) !== null
    )
      return hold;
    return noEffect(expectation);
  }
  // A never-armed or revoked trail cannot explain a session under this id.
  if (
    !exactSession(expectation, observation) ||
    !SETTLED_TRAILS.includes(handoff)
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
