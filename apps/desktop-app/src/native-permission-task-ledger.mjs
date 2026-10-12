// Main-side live correlation owner for bootstrap (Native create/fork) tasks.
// In memory only: prepared results by original operation key, cleared on child
// failure/stop/exit. `verify` is the registry sole writer's private verifier; it
// returns true only for a record that matches this live child correlation. A
// digest, a held reply or a replayed disk record is never authority here.
import { isDeepStrictEqual } from "node:util";
import {
  taskArmRequest,
  taskPreparation,
} from "./native-permission-control-input.mjs";
import {
  bootstrapHandoffProof,
  bootstrapTaskProof,
} from "./native-permission-bootstrap-digest.mjs";
import { validateTaskHandoffIdentity } from "./host/workbench-task-storage.mjs";

const held = () => new Error("task_preparation_held");
const MAX_ENTRIES = 16;
const RETIRED_MS = 60_000;

export function createNativeTaskLedger({
  runtimeEpoch,
  isLive,
  channel,
  onUnconfirmed,
  now = () => Date.now(),
}) {
  const entries = new Map();
  const originKey = (value) =>
    JSON.stringify([value.runtimeEpoch, value.operationId]);
  const identityOf = (entry) => ({
    taskScopeId: entry.result.taskScopeId,
    origin: { ...entry.request.origin },
    workspaceId: entry.request.workspaceId,
    projectId: entry.result.projectId,
    locationId: entry.result.locationId,
    modeGeneration: entry.result.modeGeneration,
    inventoryGeneration: entry.result.inventoryGeneration,
    originKind: "bootstrap",
  });
  const handoffProof = (entry, state) =>
    bootstrapHandoffProof({
      handoffId: entry.plan.handoffId,
      step: entry.request.reservation.step,
      stageArgumentDigest: entry.plan.stageArgumentDigest,
      state,
    });
  const purge = () => {
    for (const [key, entry] of entries)
      if (
        ["revoked", "failed"].includes(entry.state) &&
        now() - entry.at > RETIRED_MS
      )
        entries.delete(key);
  };

  // `plan` is the bootstrap handoff Main intends to journal and arm. It never
  // reaches the child; it binds later journal facts to this correlation.
  async function prepare(input, plan) {
    const request = taskPreparation(input);
    if (request.origin.runtimeEpoch !== runtimeEpoch) throw held();
    const bootstrap = request.originKind === "bootstrap";
    if (!bootstrap && plan !== undefined) throw held();
    const handoff = bootstrap
      ? validateTaskHandoffIdentity({
          handoffId: plan?.handoffId,
          step: request.reservation.step,
          stageArgumentDigest: plan?.stageArgumentDigest,
        })
      : undefined;
    const key = originKey(request.origin);
    purge();
    if (
      bootstrap &&
      (entries.has(key) ||
        entries.size >= MAX_ENTRIES ||
        [...entries.values()].some(
          (entry) => entry.plan.handoffId === handoff.handoffId,
        ))
    )
      throw held();
    const result = await channel.prepare(request);
    if (result.status === "prepared") {
      if (
        !bootstrap ||
        !isLive() ||
        entries.has(key) ||
        entries.size >= MAX_ENTRIES
      ) {
        onUnconfirmed();
        throw held();
      }
      entries.set(key, {
        request,
        plan: { ...handoff },
        result: { ...result },
        state: "prepared",
        at: now(),
      });
    }
    return Object.freeze({ ...result });
  }

  // The child arms only after Main's durable original-intent records.
  async function arm(input) {
    const row = taskArmRequest(input);
    const key = originKey(row.originalKey);
    const entry = entries.get(key);
    if (
      !entry ||
      entry.state !== "prepared" ||
      !isLive() ||
      row.handoffId !== entry.plan.handoffId ||
      row.stageArgumentDigest !== entry.plan.stageArgumentDigest ||
      row.step !== entry.request.reservation.step ||
      row.originalDigest !== entry.request.origin.digest ||
      row.currentLaunchIdentity !== entry.result.launchId ||
      !isDeepStrictEqual(row.targetIdentity, identityOf(entry))
    )
      throw new Error("task_arm_held");
    const status = await channel.arm(row);
    if (entries.get(key) !== entry || !isLive())
      throw new Error("task_arm_held");
    if (status !== "ok") {
      entry.state = "failed";
      entry.at = now();
      throw new Error("task_arm_refused");
    }
    entry.state = "armed";
  }

  async function revoke(handoffId) {
    const entry = [...entries.values()].find(
      (item) => item.plan.handoffId === handoffId,
    );
    if (
      !entry ||
      !["prepared", "failed", "armed", "revoked"].includes(entry.state)
    )
      throw new Error("task_revoke_held");
    if (entry.state === "revoked") return;
    // Nothing was armed (never sent, or the child refused), or the child
    // holding it is gone (handoffs are in-memory and never restored).
    if (["prepared", "failed"].includes(entry.state) || !isLive()) {
      entry.state = "revoked";
      entry.at = now();
      return;
    }
    // A refusal (e.g. already consumed) leaves the outcome unknown: held.
    if ((await channel.revoke(handoffId)) !== "ok")
      throw new Error("task_revoke_refused");
    entry.state = "revoked";
    entry.at = now();
  }

  function verify(record, context) {
    try {
      if (!isLive()) return false;
      const key = originKey(record);
      const entry = entries.get(key);
      if (
        !entry ||
        record.taskScopeId !== entry.result.taskScopeId ||
        context?.runtimeEpoch !== runtimeEpoch
      )
        return false;
      const { request, plan, state } = entry;
      const task = context.task;
      const planned = (row) =>
        row.step === request.reservation.step &&
        row.stageArgumentDigest === plan.stageArgumentDigest &&
        row.handoffId === plan.handoffId &&
        row.proofDigest === handoffProof(entry, row.state);
      switch (record.kind) {
        case "task.prepare":
          return (
            state === "prepared" &&
            task === null &&
            isDeepStrictEqual(record.identity, identityOf(entry)) &&
            isDeepStrictEqual(record.binding, request.reservation)
          );
        case "task.observe":
          return (
            state === "prepared" &&
            record.phase === "bound" &&
            record.launchId === entry.result.launchId
          );
        case "task.handoff":
          return (
            planned(record) &&
            (record.state === "armed"
              ? state === "prepared"
              : record.state === "revoked"
                ? state === "revoked"
                : ["consumed", "completed"].includes(record.state) &&
                  state === "armed")
          );
        case "task.bootstrap-binding":
          return (
            state === "armed" &&
            record.appSessionId === request.appSessionId &&
            (request.reservation.step !== "native.create" ||
              (record.nativeSessionId === request.plannedNativeSessionId &&
                record.metadataDigest === request.metadataDigest))
          );
        case "task_proof":
        case "task.settle": {
          const bound = task?.identity?.nativeSessionId;
          const ok =
            record.outcome === "no_effect"
              ? state === "revoked" &&
                record.proofDigest ===
                  bootstrapTaskProof({
                    outcome: "no_effect",
                    taskScopeId: entry.result.taskScopeId,
                  })
              : record.outcome === "settled" &&
                state === "armed" &&
                typeof bound === "string" &&
                record.proofDigest ===
                  bootstrapTaskProof({
                    outcome: "settled",
                    taskScopeId: entry.result.taskScopeId,
                    appSessionId: task.identity.appSessionId,
                    nativeSessionId: bound,
                  });
          // The final record consumes the live correlation.
          if (ok && record.kind === "task.settle") entries.delete(key);
          return ok;
        }
        default:
          return false;
      }
    } catch {
      return false;
    }
  }

  return Object.freeze({
    prepare,
    arm,
    revoke,
    verify,
    clear: () => entries.clear(),
  });
}
