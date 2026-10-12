// Private inert journal data. These validators NEVER issue live authority.
import { createHash } from "node:crypto";
import { permissionCanonicalJSON } from "../permission-control-canonical.mjs";

export const TASK_FEATURE = "native_task_lifetime_v1";
export const PERMISSION_RECONCILIATION_FEATURE = "permission_reconciliation_v1";
export const TASK_LIMITS = Object.freeze({
  roots: 2048,
  unsettled: 256,
  inputs: 1024,
  history: 8192,
  handoffs: 1024,
  armedPerLaunch: 32,
  messageBytes: 16 * 1024,
});
export const TASK_NATIVE_STEPS = Object.freeze([
  "native.agent.register",
  "native.agent.remove",
  "native.skill.register",
  "native.skill.remove",
  "native.skill.apply",
  "native.mcp.add",
  "native.mcp.connect",
  "native.mcp.disconnect",
  "native.mcp.remove",
  "native.instructions.put",
  "native.instructions.remove",
  "native.create",
  "native.fork",
  "native.remove",
  "native.rename",
  "native.pin",
  "native.archive",
  "native.metadata",
  "native.send",
  "native.command",
  "native.inbox.cancel",
  "native.interrupt",
  "native.permission",
  "native.policy",
  "native.policy.before_selection",
  "native.policy.after_selection",
  "native.agent",
  "native.model",
  "native.permission.hold",
  "native.permission.interrupt",
  "native.permission.cancel_pending",
  "native.permission.policy",
  "native.permission.grant",
  "native.permission.reply",
  "native.permission.revoke",
  "native.permission.activate",
]);
const kinds = new Set([
  "task.prepare",
  "task.input",
  "task.input-transition",
  "task.bootstrap-binding",
  "task.handoff",
  "task.observe",
  "task_proof",
  "task.settle",
  "task_reconciled",
]);
export const isTaskRecord = (kind) => kinds.has(kind);
function need(ok, code = "identity_conflict") {
  if (!ok) {
    const error = new Error(code);
    error.code = code;
    throw error;
  }
}
const uint = (v) => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
const uuid = (v) =>
  typeof v === "string" &&
  /^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(
    v,
  );
const same = (a, b) =>
  permissionCanonicalJSON(a) === permissionCanonicalJSON(b);
export const taskKey = (v) => JSON.stringify([v.runtimeEpoch, v.operationId]);
function detached(v) {
  try {
    return JSON.parse(permissionCanonicalJSON(v));
  } catch {
    need(false, "invalid_record");
  }
}
function exact(v, fields) {
  need(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Object.keys(v).length === fields.length &&
      fields.every((k) => Object.hasOwn(v, k)),
    "invalid_record",
  );
}
// The accepted permission schema r3 record has no task fields or revision.
// Main's separate recovery source must verify its live ticket before append.
export function validatePermissionReconciliationRecord(input) {
  const v = detached(input);
  exact(v, [
    "kind",
    "original",
    "runtimeEpoch",
    "scopeDigest",
    "generations",
    "currentStateDigest",
    "priorSettlementDigest",
  ]);
  exact(v.original, ["runtimeEpoch", "operationId"]);
  exact(v.generations, [
    "control",
    "inventory",
    "pending",
    "saved",
    "locations",
  ]);
  need(
    v.kind === "permission_reconciled" &&
      id(v.runtimeEpoch) &&
      id(v.original.runtimeEpoch) &&
      id(v.original.operationId) &&
      digest(v.scopeDigest) &&
      digest(v.currentStateDigest) &&
      digest(v.priorSettlementDigest) &&
      Object.values(v.generations).every((value) => uint(value) && value > 0),
    "invalid_record",
  );
  return v;
}
export function applyPermissionReconciliation(operation, input) {
  const v = validatePermissionReconciliationRecord(input);
  need(
    operation &&
      !operation.terminal &&
      operation.permissionTarget &&
      operation.identity.runtimeEpoch === v.original.runtimeEpoch &&
      operation.identity.operationId === v.original.operationId &&
      operation.permissionTarget.scopeDigest === v.scopeDigest,
  );
  need(
    Object.entries(operation.permissionTarget.generations).every(
      ([field, value]) => v.generations[field] >= value,
    ) && v.generations.control > operation.permissionTarget.generations.control,
  );
  need(
    !operation.permissionReconciled || same(operation.permissionReconciled, v),
  );
  operation.permissionReconciled = v;
  return v;
}
export function validateTaskIdentity(input) {
  const v = detached(input);
  const bootstrap = v.originKind === "bootstrap";
  const mutation = v.originKind === "mutation";
  const hasSession = mutation
    ? v.targetKind === "session"
    : !bootstrap ||
      Object.hasOwn(v, "appSessionId") ||
      Object.hasOwn(v, "nativeSessionId");
  if (mutation)
    need(["session", "workspace"].includes(v.targetKind), "invalid_record");
  exact(v, [
    "taskScopeId",
    "origin",
    "workspaceId",
    "projectId",
    "locationId",
    "modeGeneration",
    "inventoryGeneration",
    "originKind",
    ...(mutation ? ["targetKind"] : []),
    ...(hasSession ? ["appSessionId", "nativeSessionId"] : []),
  ]);
  exact(v.origin, ["runtimeEpoch", "operationId", "type", "digest"]);
  need(
    uuid(v.taskScopeId) &&
      uuid(v.locationId) &&
      ["prompt", "command", "bootstrap", "mutation"].includes(v.originKind),
    "invalid_record",
  );
  for (const field of [
    "workspaceId",
    "projectId",
    ...(hasSession ? ["appSessionId", "nativeSessionId"] : []),
  ])
    need(id(v[field]), "invalid_record");
  need(
    id(v.origin.runtimeEpoch) &&
      id(v.origin.operationId) &&
      id(v.origin.type) &&
      digest(v.origin.digest),
    "invalid_record",
  );
  need(
    uint(v.modeGeneration) &&
      v.modeGeneration > 0 &&
      uint(v.inventoryGeneration) &&
      v.inventoryGeneration > 0,
    "invalid_record",
  );
  return v;
}
export function validateTaskHandoffIdentity(input) {
  const v = detached(input);
  exact(v, ["handoffId", "step", "stageArgumentDigest"]);
  need(
    uuid(v.handoffId) &&
      TASK_NATIVE_STEPS.includes(v.step) &&
      digest(v.stageArgumentDigest),
    "invalid_record",
  );
  return v;
}
export function validateTaskBinding(input) {
  const v = detached(input);
  switch (v.kind) {
    case "prompt":
      exact(v, ["kind", "nativeSessionId", "inboxId", "inputDigest"]);
      need(
        id(v.nativeSessionId) && id(v.inboxId) && digest(v.inputDigest),
        "invalid_record",
      );
      break;
    case "command":
      exact(v, ["kind", "commandDigest"]);
      need(digest(v.commandDigest), "invalid_record");
      break;
    case "bootstrap":
      exact(v, ["kind", "step", "reservationDigest", "parentIdentityDigest"]);
      need(
        ["native.create", "native.fork"].includes(v.step) &&
          digest(v.reservationDigest) &&
          (digest(v.parentIdentityDigest) ||
            (v.step === "native.create" && v.parentIdentityDigest === null)),
        "invalid_record",
      );
      break;
    case "mutation":
      exact(v, [
        "kind",
        "targetKind",
        "step",
        "targetDigest",
        "stageArgumentDigest",
        "affectedSessionIds",
        "affectedProjectIds",
      ]);
      for (const field of ["affectedSessionIds", "affectedProjectIds"])
        need(
          Array.isArray(v[field]) &&
            v[field].length <= 256 &&
            v[field].every(id) &&
            new Set(v[field]).size === v[field].length,
          "invalid_record",
        );
      need(
        ["session", "workspace"].includes(v.targetKind) &&
          v.affectedProjectIds.length > 0 &&
          (v.targetKind === "workspace" || v.affectedSessionIds.length > 0),
        "invalid_record",
      );
      need(
        TASK_NATIVE_STEPS.includes(v.step) &&
          digest(v.targetDigest) &&
          digest(v.stageArgumentDigest),
        "invalid_record",
      );
      break;
    default:
      need(false, "invalid_record");
  }
  return v;
}
export function taskBindingDigest(binding) {
  return createHash("sha256")
    .update("omoc.permission.task.binding.v1\n")
    .update(permissionCanonicalJSON(validateTaskBinding(binding)))
    .digest("hex");
}
export function taskReservationDigest(reservation) {
  // Hash the complete persisted original reservation, never a caller subset.
  const value = detached(reservation);
  need(
    value && Object.getPrototypeOf(value) === Object.prototype,
    "invalid_record",
  );
  return createHash("sha256")
    .update("omoc.permission.task.reservation.v1\n")
    .update(permissionCanonicalJSON(value))
    .digest("hex");
}
export function validateTaskRecord(input) {
  const v = detached(input);
  const common = [
    "kind",
    "revision",
    "runtimeEpoch",
    "operationId",
    "taskScopeId",
    "sequence",
  ];
  need(
    isTaskRecord(v.kind) &&
      uint(v.revision) &&
      v.revision > 0 &&
      id(v.runtimeEpoch) &&
      id(v.operationId) &&
      uuid(v.taskScopeId) &&
      uint(v.sequence),
    "invalid_record",
  );
  let fields;
  switch (v.kind) {
    case "task.prepare":
      fields = ["identity", "binding"];
      validateTaskIdentity(v.identity);
      validateTaskBinding(v.binding);
      need(
        v.sequence === 0 &&
          v.identity.taskScopeId === v.taskScopeId &&
          v.identity.origin.runtimeEpoch === v.runtimeEpoch &&
          v.identity.origin.operationId === v.operationId &&
          v.binding.kind === v.identity.originKind,
        "invalid_record",
      );
      if (v.binding.kind === "mutation")
        need(
          v.identity.targetKind === v.binding.targetKind &&
            v.binding.affectedProjectIds.includes(v.identity.projectId) &&
            (v.identity.targetKind === "workspace" ||
              v.binding.affectedSessionIds.includes(
                v.identity.nativeSessionId,
              )),
          "invalid_record",
        );
      if (v.binding.kind === "bootstrap")
        need(!Object.hasOwn(v.identity, "nativeSessionId"), "invalid_record");
      if (v.binding.kind === "prompt")
        need(
          v.binding.nativeSessionId === v.identity.nativeSessionId,
          "invalid_record",
        );
      break;
    case "task.input":
      fields = [
        "nativeSessionId",
        "inboxId",
        "inputDigest",
        "source",
        "parentLeaseId",
        "state",
      ];
      need(
        id(v.nativeSessionId) &&
          id(v.inboxId) &&
          digest(v.inputDigest) &&
          ["prompt", "command_expansion", "synthetic_child"].includes(
            v.source,
          ) &&
          v.state === "pending" &&
          (v.source === "synthetic_child"
            ? id(v.parentLeaseId)
            : v.parentLeaseId === null),
        "invalid_record",
      );
      break;
    case "task.input-transition":
      fields = [
        "inboxId",
        "from",
        "to",
        "proofDigest",
        ...(v.to === "promoted" || v.from === "promoted"
          ? ["scopeId", "scopeVersion"]
          : []),
      ];
      need(
        id(v.inboxId) &&
          digest(v.proofDigest) &&
          ((v.from === "pending" && ["promoted", "cancelled"].includes(v.to)) ||
            (v.from === "promoted" && v.to === "settled")),
        "invalid_record",
      );
      if (fields.includes("scopeId"))
        need(
          id(v.scopeId) && uint(v.scopeVersion) && v.scopeVersion > 0,
          "invalid_record",
        );
      break;
    case "task.bootstrap-binding":
      fields = ["appSessionId", "nativeSessionId", "metadataDigest"];
      need(
        id(v.appSessionId) && id(v.nativeSessionId) && digest(v.metadataDigest),
        "invalid_record",
      );
      break;
    case "task.handoff":
      fields = [
        "handoffId",
        "step",
        "stageArgumentDigest",
        "state",
        "proofDigest",
      ];
      validateTaskHandoffIdentity({
        handoffId: v.handoffId,
        step: v.step,
        stageArgumentDigest: v.stageArgumentDigest,
      });
      need(
        ["armed", "consumed", "revoked", "completed"].includes(v.state) &&
          digest(v.proofDigest),
        "invalid_record",
      );
      break;
    case "task.observe":
      fields = [
        "phase",
        "launchId",
        ...(v.phase === "unverified"
          ? ["reason"]
          : v.phase === "bound"
            ? []
            : ["scopeId", "scopeVersion", "leaseId"]),
      ];
      need(
        id(v.launchId) &&
          ["bound", "running", "cancelling", "unverified"].includes(v.phase),
        "invalid_record",
      );
      if (v.phase === "unverified") need(id(v.reason), "invalid_record");
      if (["running", "cancelling"].includes(v.phase))
        need(
          id(v.scopeId) &&
            uint(v.scopeVersion) &&
            v.scopeVersion > 0 &&
            id(v.leaseId),
          "invalid_record",
        );
      break;
    case "task_proof":
      fields = ["proofDigest", "outcome", "lastActivitySequence"];
      need(uint(v.lastActivitySequence), "invalid_record");
      break;
    case "task.settle":
      fields = ["proofDigest", "outcome"];
      break;
    case "task_reconciled":
      fields = ["ticketDigest", "proofDigest", "outcome"];
      need(digest(v.ticketDigest), "invalid_record");
      break;
  }
  exact(v, [...common, ...fields]);
  if (["task_proof", "task.settle", "task_reconciled"].includes(v.kind))
    need(
      digest(v.proofDigest) && ["settled", "no_effect"].includes(v.outcome),
      "invalid_record",
    );
  need(
    Buffer.byteLength(permissionCanonicalJSON(v)) <= TASK_LIMITS.messageBytes,
    "invalid_record",
  );
  return v;
}
const activeInputs = (task) =>
  task.inputs.some((v) => ["pending", "promoted"].includes(v.state));
const openHandoffs = (task) =>
  task.handoffs.some((v) => ["armed", "consumed"].includes(v.state));
// A bootstrap task never runs. Its created session is proven by the completed
// bootstrap handoff plus the durable session binding, straight from `bound`.
const settledBootstrap = (task) =>
  task.identity.originKind === "bootstrap" &&
  task.phase === "bound" &&
  Object.hasOwn(task.identity, "nativeSessionId") &&
  task.handoffs.some((h) => h.state === "completed");
function uniqueInput(tasks, nativeSessionId, inboxId) {
  need(
    ![...tasks.values()].some((task) =>
      task.inputs.some(
        (v) => v.nativeSessionId === nativeSessionId && v.inboxId === inboxId,
      ),
    ),
  );
}
// Mutates only the caller's detached candidate map. Used by BOTH strict replay
// and the sole registry writer; no permissions or callbacks are created here.
export function applyTaskRecord(tasks, operation, input, sessions, workspaces) {
  const v = validateTaskRecord(input),
    key = taskKey(v),
    previous = tasks.get(key);
  need(operation && (v.kind === "task.prepare" || previous));
  const origin =
    v.kind === "task.prepare" ? v.identity.origin : previous.identity.origin;
  need(
    same(
      origin,
      Object.fromEntries(
        ["runtimeEpoch", "operationId", "type", "digest"].map((field) => [
          field,
          operation.identity[field],
        ]),
      ),
    ),
  );
  if (v.kind === "task.prepare") {
    need(
      !previous &&
        tasks.size < TASK_LIMITS.roots &&
        [...tasks.values()].filter((t) => t.phase !== "settled").length <
          TASK_LIMITS.unsettled,
      "retained_limit",
    );
    need(
      ![...tasks.values()].some(
        (t) => t.identity.taskScopeId === v.taskScopeId,
      ),
    );
    need(
      !operation.terminal &&
        operation.dispatches.length > 0 &&
        operation.receipt?.admission !== "rejected",
    );
    need(
      !operation.identity.workspaceId ||
        operation.identity.workspaceId === v.identity.workspaceId,
    );
    need(
      v.identity.originKind === "bootstrap" ||
        (v.identity.originKind === "mutation" &&
        v.identity.targetKind === "workspace"
          ? Object.hasOwn(operation.identity, "workspaceId") &&
            operation.identity.workspaceId === v.identity.workspaceId &&
            !Object.hasOwn(operation.identity, "sessionId")
          : operation.identity.sessionId === v.identity.appSessionId),
    );
    need(
      v.identity.originKind === "prompt"
        ? operation.identity.type === "message.send"
        : v.identity.originKind === "command"
          ? operation.identity.type === "command.run"
          : v.identity.originKind === "bootstrap"
            ? [
                "workspace.create",
                "workspace.import",
                "session.create",
                "session.fork",
              ].includes(operation.identity.type)
            : ![
                "message.send",
                "command.run",
                "workspace.create",
                "workspace.import",
                "session.create",
                "session.fork",
              ].includes(operation.identity.type),
    );
    if (v.identity.originKind === "mutation" && workspaces)
      need(workspaces.has(v.identity.workspaceId));
    if (v.identity.originKind === "bootstrap") {
      need(
        operation.reservation?.workspace.workspaceId ===
          v.identity.workspaceId &&
          operation.dispatches.some((d) => d.step === v.binding.step) &&
          v.binding.reservationDigest ===
            taskReservationDigest(operation.reservation),
      );
    } else if (
      !(
        v.identity.originKind === "mutation" &&
        v.identity.targetKind === "workspace"
      )
    ) {
      const session = sessions?.get(v.identity.appSessionId);
      need(
        session &&
          session.workspaceId === v.identity.workspaceId &&
          session.nativeSessionId === v.identity.nativeSessionId,
      );
    }
    if (v.binding.kind === "prompt")
      uniqueInput(tasks, v.binding.nativeSessionId, v.binding.inboxId);
    const task = {
      identity: v.identity,
      binding: v.binding,
      bindingDigest: taskBindingDigest(v.binding),
      phase: "prepared",
      sequence: 0,
      records: [v],
      inputs:
        v.binding.kind === "prompt"
          ? [
              {
                ...v.binding,
                source: "prompt",
                parentLeaseId: null,
                state: "pending",
              },
            ]
          : [],
      handoffs: [],
      proof: null,
      launchId: null,
    };
    tasks.set(key, task);
    return task;
  }
  need(
    previous &&
      previous.identity.taskScopeId === v.taskScopeId &&
      previous.phase !== "settled" &&
      v.sequence === previous.sequence + 1 &&
      previous.records.length < TASK_LIMITS.history,
  );
  const task = JSON.parse(JSON.stringify(previous));
  if (task.phase === "unverified")
    need(
      v.kind === "task_reconciled" ||
        (v.kind === "task.observe" && v.phase === "unverified"),
    );
  if (task.proof)
    need(
      v.kind === "task.settle" ||
        v.kind === "task_reconciled" ||
        (v.kind === "task.observe" && v.phase === "unverified"),
    );
  switch (v.kind) {
    case "task.input":
      need(
        task.identity.originKind !== "mutation" &&
          task.identity.nativeSessionId === v.nativeSessionId &&
          task.inputs.length < TASK_LIMITS.inputs,
      );
      need(
        v.source === "command_expansion"
          ? task.identity.originKind === "command"
          : v.source === "prompt"
            ? task.identity.originKind === "prompt"
            : task.records.some(
                (r) =>
                  r.kind === "task.observe" &&
                  ["running", "cancelling"].includes(r.phase) &&
                  r.leaseId === v.parentLeaseId,
              ),
      );
      uniqueInput(tasks, v.nativeSessionId, v.inboxId);
      task.inputs.push(v);
      break;
    case "task.input-transition": {
      const binding = task.inputs.find((i) => i.inboxId === v.inboxId);
      need(binding && binding.state === v.from);
      if (v.to === "promoted") need(["bound", "running"].includes(task.phase));
      if (v.from === "promoted")
        need(
          binding.scopeId === v.scopeId &&
            binding.scopeVersion === v.scopeVersion,
        );
      Object.assign(
        binding,
        { state: v.to },
        v.to === "promoted"
          ? { scopeId: v.scopeId, scopeVersion: v.scopeVersion }
          : {},
      );
      break;
    }
    case "task.bootstrap-binding":
      need(
        task.identity.originKind === "bootstrap" &&
          !Object.hasOwn(task.identity, "nativeSessionId") &&
          ["prepared", "bound"].includes(task.phase),
      );
      need(operation.reservation?.appSessionId === v.appSessionId);
      task.identity = {
        ...task.identity,
        appSessionId: v.appSessionId,
        nativeSessionId: v.nativeSessionId,
      };
      break;
    case "task.handoff": {
      need(task.phase !== "prepared" && task.launchId);
      const prior = task.handoffs.find((h) => h.handoffId === v.handoffId);
      if (!prior) {
        need(
          v.state === "armed" &&
            task.handoffs.length < TASK_LIMITS.handoffs &&
            ![...tasks.values()].some((t) =>
              t.handoffs.some((h) => h.handoffId === v.handoffId),
            ),
        );
        need(
          [...tasks.values()]
            .filter((t) => t.launchId === task.launchId)
            .flatMap((t) => t.handoffs)
            .filter((h) => h.state === "armed").length <
            TASK_LIMITS.armedPerLaunch,
          "retained_limit",
        );
        need(operation.dispatches.some((d) => d.step === v.step));
        if (task.binding.kind === "mutation")
          need(
            v.step === task.binding.step &&
              v.stageArgumentDigest === task.binding.stageArgumentDigest,
          );
        task.handoffs.push(v);
      } else {
        need(
          prior.step === v.step &&
            prior.stageArgumentDigest === v.stageArgumentDigest &&
            ((prior.state === "armed" &&
              ["consumed", "revoked"].includes(v.state)) ||
              (prior.state === "consumed" && v.state === "completed")),
        );
        Object.assign(prior, v);
      }
      break;
    }
    case "task.observe":
      need(task.launchId === null || task.launchId === v.launchId);
      if (v.phase === "bound")
        need(
          task.phase === "prepared" &&
            (Object.hasOwn(task.identity, "nativeSessionId") ||
              task.identity.originKind === "bootstrap" ||
              (task.identity.originKind === "mutation" &&
                task.identity.targetKind === "workspace")),
        );
      if (v.phase === "running") {
        // Workspace stage authority cannot manufacture a session-bound lease.
        need(
          !(
            task.identity.originKind === "mutation" &&
            task.identity.targetKind === "workspace"
          ),
        );
        need(["bound", "running"].includes(task.phase));
        if (["prompt", "command"].includes(task.identity.originKind))
          need(
            task.inputs.some(
              (binding) =>
                binding.state === "promoted" &&
                binding.scopeId === v.scopeId &&
                binding.scopeVersion === v.scopeVersion,
            ),
          );
      }
      if (v.phase === "cancelling") {
        need(["running", "cancelling"].includes(task.phase));
        need(
          task.records.some(
            (record) =>
              record.kind === "task.observe" &&
              record.phase === "running" &&
              record.scopeId === v.scopeId &&
              record.scopeVersion === v.scopeVersion &&
              record.leaseId === v.leaseId,
          ),
        );
      }
      task.phase = v.phase;
      task.launchId = v.launchId;
      break;
    case "task_proof":
      need(
        !task.proof &&
          !activeInputs(task) &&
          !openHandoffs(task) &&
          v.lastActivitySequence === task.sequence,
      );
      need(
        v.outcome === "no_effect"
          ? ["prepared", "bound"].includes(task.phase)
          : ["running", "cancelling"].includes(task.phase) ||
              settledBootstrap(task),
      );
      task.proof = v;
      break;
    case "task.settle":
    case "task_reconciled":
      need(
        task.proof &&
          task.proof.proofDigest === v.proofDigest &&
          task.proof.outcome === v.outcome &&
          !activeInputs(task) &&
          !openHandoffs(task),
      );
      if (v.kind === "task.settle")
        need(task.records.at(-1).kind === "task_proof");
      task.phase = "settled";
      break;
  }
  task.sequence = v.sequence;
  task.records.push(v);
  tasks.set(key, task);
  return task;
}
