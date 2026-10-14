import { forkTargetAdmission } from "./conversation-context-branch-storage.mjs";
import {
  isInboxCancel,
  inboxTargetAdmission,
} from "./conversation-context-storage.mjs";
import {
  isGitBranchRestoreApply,
  gitBranchRestoreTargetAdmission,
} from "./workbench-git-branch-restore-storage.mjs";
import {
  isGitCommitApply,
  gitCommitTargetAdmission,
} from "./workbench-git-commit-storage.mjs";
import {
  isGitIndexApply,
  gitIndexTargetAdmission,
} from "./workbench-git-index-storage.mjs";
import { isFileSave, fileTargetAdmission } from "./workbench-file-storage.mjs";
import {
  isAgentSave,
  agentRuntimeAdmission,
} from "./workbench-agent-storage.mjs";
import { agentRuntimeStep } from "../renderer/shared/configuration-draft/agent-runtime.mjs";
import {
  skillRuntimeAdmission,
  skillRuntimeStep,
} from "./workbench-skill-runtime-storage.mjs";
import { isSkillSave } from "./workbench-skill-storage.mjs";
import { AsyncLocalStorage } from "node:async_hooks";
import { performance } from "node:perf_hooks";
import { createHash, randomUUID } from "node:crypto";
import {
  fail,
  failure,
  ERRORS,
  READ_TYPES,
  validateEnvelope,
  validateCancel,
} from "../workbench-contract.mjs";
import { redactReceipt } from "./workbench-receipts.mjs";
import { mcpNativeName, mcpStep } from "./workbench-mcp.mjs";

const execution = new AsyncLocalStorage();
export const currentScope = () => execution.getStore();
const digest = (value) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(value)
          .sort()
          .map((k) => [k, value[k]]),
      ),
    )
    .digest("hex");
const errorResult = (error) =>
  failure(
    Object.hasOwn(ERRORS, error?.appCode) ? error.appCode : "RUNTIME_ERROR",
  );
function readClass(type) {
  if (type === "operation.lookup") return "lookup";
  if (type === "catalog.list") return "catalog";
  if (
    type === "permission.policy.read" ||
    type === "context.observe" ||
    type === "session.inbox" ||
    type === "git.branch.preview.read" ||
    type === "git.restore.preview.read" ||
    type === "git.commit.preview.read" ||
    type === "git.index.preview.read" ||
    type === "git.review.read" ||
    type === "git.diff.read" ||
    type.startsWith("file.") ||
    type === "configuration.read" ||
    type === "configuration.instructions.read" ||
    type === "configuration.mcp.read" ||
    type === "configuration.extensions.read" ||
    type === "configuration.agent.list" ||
    type === "configuration.agent.read" ||
    type === "configuration.agent.runtime.read" ||
    type === "configuration.skill.list" ||
    type === "configuration.skill.read" ||
    type === "configuration.skill.runtime.read"
  )
    return "files";
  return "snapshot";
}
// One ready settlement listener, with bounded removable active waiters.
const readyWaits = new WeakMap();
export function waitForReady(ready, signal) {
  let state = readyWaits.get(ready);
  if (!state) {
    state = { waiters: new Set(), settled: false };
    readyWaits.set(ready, state);
    const settle = (value, error) => {
      state.settled = true;
      state.value = value;
      state.error = error;
      for (const notify of [...state.waiters]) notify();
      state.waiters.clear();
    };
    ready.then(
      (value) => settle(value),
      (error) => settle(undefined, error),
    );
  }
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      state.waiters.delete(notify);
      signal.removeEventListener("abort", abort);
    };
    const abort = () => {
      cleanup();
      reject(Object.assign(new Error("deadline"), { appCode: "READ_TIMEOUT" }));
    };
    const notify = () => {
      cleanup();
      if (state.error !== undefined) reject(state.error);
      else resolve(state.value);
    };
    if (signal.aborted) return abort();
    if (state.settled) return notify();
    state.waiters.add(notify);
    signal.addEventListener("abort", abort, { once: true });
  });
}
export function createHostAdmission({
  execute,
  ready,
  revision,
  projectReceipt,
  deadlineMs = 10000,
  registry: getRegistry,
  runtimeEpoch,
  mutationAllowed = () => true,
  preflight,
}) {
  const epoch = runtimeEpoch ?? randomUUID();
  const service = new AbortController();
  const tasks = new Map();
  const subscribers = new Map();
  const ledger = new Map();
  const sdkLanes = new Set();
  const actuals = new Set();
  let quiescing = false;
  let mutation;
  // Register before invoking callbacks, including callbacks that reenter drain.
  // Caller deadlines can settle responses while these actuals still own work.
  function trackActual(fn) {
    const actual = Promise.resolve()
      .then(fn)
      .finally(() => actuals.delete(actual));
    actuals.add(actual);
    return actual;
  }
  function scope(kind, record) {
    const controller = new AbortController();
    const value = {
      kind,
      record,
      controller,
      signal: AbortSignal.any([service.signal, controller.signal]),
      deadline: performance.now() + deadlineMs,
      sdkActive: false,
      effectStarted: false,
    };
    value.check = () => {
      if (service.signal.aborted) fail("UNAVAILABLE");
      if (
        (value.signal.aborted || performance.now() >= value.deadline) &&
        !(kind === "mutation" && value.effectStarted)
      )
        fail("READ_TIMEOUT");
    };
    value.markEffect = () => {
      value.check();
      if (
        kind === "mutation" &&
        !value.finalizing &&
        (value.signal.aborted || performance.now() >= value.deadline)
      )
        fail("READ_TIMEOUT");
      if (record) {
        value.effectStarted = true;
        record.admission = "dispatched";
        record.effect = "pending";
      }
    };
    return value;
  }
  async function sdk(fn, args, effect = false, primary = false) {
    const owner = currentScope();
    if (!owner) fail("INVALID_REQUEST");
    owner.check();
    if (
      owner.kind === "mutation" &&
      !owner.finalizing &&
      (owner.signal.aborted || performance.now() >= owner.deadline)
    )
      fail("READ_TIMEOUT");
    const lane = ["startup", "mutation", "trusted"].includes(owner.kind)
      ? "shared"
      : owner.kind;
    if (sdkLanes.has(lane) || sdkLanes.size >= 4) fail("READ_BUSY");
    if (typeof fn !== "function") fail("UNAVAILABLE");
    // Keep the SDK lane reserved while durable dispatch is paused as well as
    // while the actual SDK promise is unsettled.

    if (primary && owner.kind === "mutation") owner.finalizing = true;
    sdkLanes.add(lane);
    owner.sdkActive = true;
    const signal =
      owner.kind === "mutation" && owner.effectStarted && owner.signal.aborted
        ? service.signal
        : owner.signal;
    const actual = trackActual(async () => {
      try {
        owner.check();
        if (effect) {
          await owner.beforeEffect?.(fn, args);
          owner.check();
          owner.markEffect();
        }
        return await fn(...args, { signal });
      } finally {
        owner.sdkActive = false;
        sdkLanes.delete(lane);
      }
    });
    // Fixture compatibility also keeps capacity until actual settlement.
    const result =
      owner.kind === "trusted"
        ? await waitForReady(actual, signal)
        : await actual;
    owner.check();
    return result;
  }

  function lookup(request) {
    const key = {
      runtimeEpoch: request.runtimeEpoch,
      operationId: request.operationId,
    };
    if (getRegistry?.()) return getRegistry().lookup(key);
    if (request.runtimeEpoch !== epoch)
      return { ...key, status: "wrong_epoch", effect: "unknown" };
    const record = ledger.get(request.operationId);
    return record
      ? { ...key, status: "found", receipt: redactReceipt(record) }
      : { ...key, status: "missing", effect: "unknown" };
  }
  function settleSubscriber(sub, result) {
    if (!subscribers.has(sub.key)) return;
    subscribers.delete(sub.key);
    sub.task.subs.delete(sub.key);
    clearTimeout(sub.timer);
    sub.resolve(result);
    if (!sub.task.subs.size) {
      sub.task.quarantined = true;
      sub.task.owner.controller.abort();
    }
  }
  function read(envelope, sender) {
    const kind = readClass(envelope.operation.type);
    const key = JSON.stringify([sender, epoch, envelope.readId]);
    const identity = JSON.stringify([
      sender,
      epoch,
      digest(envelope.operation),
    ]);
    const active = subscribers.get(key);
    if (active)
      return active.identity === identity
        ? active.promise
        : Promise.resolve(failure("INVALID_REQUEST"));
    let task = tasks.get(kind);
    if (
      task &&
      (task.identity !== identity ||
        task.quarantined ||
        task.owner.signal.aborted)
    )
      return Promise.resolve(failure("READ_BUSY"));
    if (task?.subs.size >= 8) return Promise.resolve(failure("READ_BUSY"));
    let start = false;
    if (!task) {
      task = {
        identity,
        owner: Object.assign(scope(kind), { sender }),
        subs: new Map(),
        quarantined: false,
      };
      tasks.set(kind, task);
      start = true;
    }
    let resolve;
    const promise = new Promise((r) => {
      resolve = r;
    });
    const sub = { key, sender, identity, task, promise, resolve };
    task.subs.set(key, sub);
    subscribers.set(key, sub);
    sub.timer = setTimeout(
      () => settleSubscriber(sub, failure("READ_TIMEOUT")),
      Math.max(0, task.owner.deadline - performance.now()),
    );
    if (start) {
      task.timer = setTimeout(
        () => {
          task.quarantined = true;
          task.owner.controller.abort();
          for (const item of [...task.subs.values()])
            settleSubscriber(item, failure("READ_TIMEOUT"));
        },
        Math.max(0, task.owner.deadline - performance.now()),
      );
      task.actual = trackActual(() =>
        execution.run(task.owner, async () => {
          try {
            await Promise.resolve();
            task.owner.check();
            const result =
              kind === "lookup"
                ? { ok: true, value: lookup(envelope.operation) }
                : await execute(envelope.operation);
            task.owner.check();
            for (const item of [...task.subs.values()])
              settleSubscriber(item, result);
          } catch (error) {
            for (const item of [...task.subs.values()])
              settleSubscriber(item, errorResult(error));
          } finally {
            clearTimeout(task.timer);
            tasks.delete(kind);
          }
        }),
      );
    }
    return promise;
  }
  // A replay of an operation that was rejected/failed without effect returns
  // that original failure; only true successes (and unknown outcomes, whose
  // receipt says so) answer "duplicate".
  function replay(receipt) {
    return receipt.admission === "rejected" &&
      receipt.result?.kind === "rejected"
      ? { ...failure(receipt.result.code), receipt }
      : { ok: true, value: { status: "duplicate" }, receipt };
  }
  function rejectRecord(record, code) {
    return trackActual(async () => {
      if (getRegistry) {
        const registry = getRegistry();
        if (!registry || registry.status().state !== "ready")
          return failure("UNAVAILABLE");
        try {
          const existing = registry.lookup({
            runtimeEpoch: record.runtimeEpoch,
            operationId: record.operationId,
          });
          if (existing.status === "found") {
            const result = await registry.complete({
              runtimeEpoch: record.runtimeEpoch,
              operationId: record.operationId,
              receipt: {
                ...redactReceipt(record),
                admission: "rejected",
                delivery: "pending",
                effect: "none",
                result: { kind: "rejected", code },
              },
              delta: { workspaces: [], sessions: [], tombstones: [] },
            });
            Object.assign(record, result.receipt);
          } else {
            const result = await registry.begin({
              ...identity(record),
              rejectionCode: code,
            });
            Object.assign(record, result.receipt);
          }
        } catch {
          return failure("UNAVAILABLE");
        }
      }

      record.admission = "rejected";
      record.effect = "none";
      record.result = { kind: "rejected", code };
      record.revision = revision();
      return { ...failure(code), receipt: redactReceipt(record) };
    });
  }
  function identity(record) {
    return {
      runtimeEpoch: record.runtimeEpoch,
      operationId: record.operationId,
      type: record.type,
      digest: record.digest,
      ...(record.workspaceId && { workspaceId: record.workspaceId }),
      ...(record.sessionId && { sessionId: record.sessionId }),
      ...(record.forkTarget && { forkTarget: record.forkTarget }),
      ...(isInboxCancel(record.type) && { inboxTarget: record.inboxTarget }),
      ...(isFileSave(record.type) && { fileTarget: record.fileTarget }),
      ...(isGitBranchRestoreApply(record.type) && {
        gitBranchRestoreTarget: record.gitBranchRestoreTarget,
        expectedRevision: record.expectedRevision,
      }),
      ...(isGitCommitApply(record.type) && {
        gitCommitTarget: record.gitCommitTarget,
        expectedRevision: record.expectedRevision,
      }),
      ...(isGitIndexApply(record.type) && {
        gitIndexTarget: record.gitIndexTarget,
        expectedRevision: record.expectedRevision,
      }),
      ...(isSkillSave(record.type) && {
        skillSourceName: record.skillSourceName,
      }),
      ...(record.skillRuntime && { skillRuntime: record.skillRuntime }),
      ...(isAgentSave(record.type) && {
        agentSourceName: record.agentSourceName,
      }),
      ...(record.agentRuntime && { agentRuntime: record.agentRuntime }),
      ...(record.nativeServerName && {
        nativeServerName: record.nativeServerName,
      }),
    };
  }
  function mutate(envelope, sender, preflightCode) {
    const { operationId } = envelope;
    // Validation already rejected accessors, extra keys and undefined fields.
    // Preserve the original Git request across readiness/flush pauses.
    const operation =
      envelope.operation.type === "session.fork" &&
      Object.hasOwn(envelope.operation, "before")
        ? Object.freeze({
            ...envelope.operation,
            before: envelope.operation.before,
          })
        : isGitBranchRestoreApply(envelope.operation.type) ||
            isGitCommitApply(envelope.operation.type)
          ? JSON.parse(JSON.stringify(envelope.operation))
          : envelope.operation;
    const forkTarget = forkTargetAdmission(operation);
    const hash = digest({
      ...operation,
      expectedRevision: envelope.expectedRevision ?? null,
    });
    const registry = getRegistry?.();
    if (!mutationAllowed()) return Promise.resolve(failure("UNAVAILABLE"));
    if (getRegistry && (!registry || registry.status().state !== "ready"))
      return Promise.resolve(failure("UNAVAILABLE"));
    if (
      (isGitBranchRestoreApply(operation.type) ||
        isGitCommitApply(operation.type) ||
        isGitIndexApply(operation.type) ||
        isInboxCancel(operation.type) ||
        isFileSave(operation.type) ||
        skillRuntimeStep(operation.type) ||
        agentRuntimeStep(operation.type) ||
        isAgentSave(operation.type)) &&
      !registry
    )
      return Promise.resolve(failure("UNAVAILABLE"));
    if (
      (isGitBranchRestoreApply(operation.type) ||
        isGitCommitApply(operation.type) ||
        isGitIndexApply(operation.type) ||
        isInboxCancel(operation.type) ||
        isFileSave(operation.type) ||
        skillRuntimeStep(operation.type) ||
        agentRuntimeStep(operation.type) ||
        isAgentSave(operation.type)) &&
      operation.requestId !== operationId
    )
      return Promise.resolve(failure("INVALID_REQUEST"));
    if (
      (isGitBranchRestoreApply(operation.type) ||
        isGitCommitApply(operation.type) ||
        isGitIndexApply(operation.type)) &&
      (!Number.isSafeInteger(envelope.expectedRevision) ||
        envelope.expectedRevision < 0)
    )
      return Promise.resolve(failure("INVALID_REQUEST"));
    const old = ledger.get(operationId);
    if (old && registry) {
      if (old.digest !== hash)
        return Promise.resolve(failure("DUPLICATE_CONFLICT"));
      const duplicate = () => {
        const durable = registry.lookup({ runtimeEpoch: epoch, operationId });
        return durable.status === "found"
          ? replay(durable.receipt)
          : failure("UNAVAILABLE");
      };
      return registry.lookup({ runtimeEpoch: epoch, operationId }).status ===
        "found"
        ? Promise.resolve(duplicate())
        : old.response.then(duplicate);
    }
    if (old)
      return Promise.resolve(
        old.digest === hash
          ? replay(redactReceipt(old))
          : failure("DUPLICATE_CONFLICT"),
      );
    if (ledger.size >= 2048) return Promise.resolve(failure("LIMIT_REACHED"));
    const admittedRevision = revision();
    // Injected readiness/registry/revision callbacks can reenter drain too.
    if (quiescing || service.signal.aborted)
      return Promise.resolve(failure("UNAVAILABLE"));
    const record = {
      runtimeEpoch: epoch,
      operationId,
      type: operation.type,
      ...(forkTarget && { forkTarget }),
      workspaceId: operation.workspaceId,
      ...(!isGitBranchRestoreApply(operation.type) &&
        !isGitCommitApply(operation.type) &&
        !isGitIndexApply(operation.type) && {
          sessionId: operation.sessionId,
        }),
      ...(isGitBranchRestoreApply(operation.type) && {
        gitBranchRestoreTarget: gitBranchRestoreTargetAdmission(operation),
        expectedRevision: envelope.expectedRevision,
      }),
      ...(isGitCommitApply(operation.type) && {
        gitCommitTarget: gitCommitTargetAdmission(operation),
        expectedRevision: envelope.expectedRevision,
      }),
      ...(isGitIndexApply(operation.type) && {
        gitIndexTarget: gitIndexTargetAdmission(operation),
        expectedRevision: envelope.expectedRevision,
      }),
      ...(isInboxCancel(operation.type) && {
        inboxTarget: inboxTargetAdmission(operation),
      }),
      ...(isFileSave(operation.type) && {
        fileTarget: fileTargetAdmission(operation),
      }),
      ...(isAgentSave(operation.type) && {
        agentSourceName: operation.sourceName,
      }),
      ...(agentRuntimeStep(operation.type) && {
        agentRuntime: agentRuntimeAdmission(
          {
            runtimeEpoch: epoch,
            operationId,
            type: operation.type,
            workspaceId: operation.workspaceId,
          },
          operation,
        ),
      }),
      ...(isSkillSave(operation.type) && {
        skillSourceName: operation.sourceName,
      }),
      ...(mcpStep(operation.type) && {
        nativeServerName: mcpNativeName(
          operation.workspaceId,
          operation.sourceName,
        ),
      }),
      ...(skillRuntimeStep(operation.type) && {
        skillRuntime: skillRuntimeAdmission(
          {
            runtimeEpoch: epoch,
            operationId,
            type: operation.type,
            workspaceId: operation.workspaceId,
            ...(operation.sessionId && { sessionId: operation.sessionId }),
          },
          operation,
        ),
      }),
      digest: hash,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: admittedRevision,
      evidence: [],
    };
    ledger.set(operationId, record);
    if (preflightCode) return rejectRecord(record, preflightCode);
    if (mutation) return Promise.resolve(rejectRecord(record, "BUSY"));
    if (
      envelope.expectedRevision !== undefined &&
      envelope.expectedRevision !== admittedRevision
    )
      return Promise.resolve(rejectRecord(record, "STALE_REVISION"));
    const owner = scope("mutation", record);
    owner.sender = sender;
    mutation = owner;
    let resolve;
    let settled = false;
    const response = new Promise((r) => {
      resolve = r;
    });
    record.response = response;
    const finishResponse = (result) => {
      if (!settled) {
        settled = true;
        resolve(result);
      }
    };
    const expire = () => {
      if (service.signal.aborted) clearTimeout(timer);
      owner.controller.abort();
      if (owner.effectStarted) {
        record.delivery = "unknown";
        record.effect = "unknown";
        if (
          [
            "inbox_cancel_requested",
            "git_commit_created",
            "git_index_updated",
            "file_saved",
            "configuration_saved",
            "agent_file_saved",
            "agent_registered",
            "agent_removed",
            "skill_file_saved",
            "skill_registered",
            "skill_removed",
            "skill_applied",
            "instruction_registered",
            "instruction_removed",
            "mcp_registered",
            "mcp_connection",
            "mcp_removed",
          ].includes(record.result?.kind)
        )
          delete record.result;
        record.revision = revision();
        finishResponse({
          ...failure("UNKNOWN_OUTCOME"),
          receipt: redactReceipt(record),
        });
      } else void rejectRecord(record, "READ_TIMEOUT").then(finishResponse);
    };
    const timer = setTimeout(expire, deadlineMs);
    service.signal.addEventListener("abort", expire, { once: true });
    owner.actual = trackActual(() =>
      execution.run(owner, async () => {
        try {
          if (registry) {
            const admission = await registry.begin({
              ...identity(record),
              ...(envelope.expectedRevision !== undefined && {
                expectedRevision: envelope.expectedRevision,
              }),
            });
            Object.assign(record, admission.receipt);
            if (admission.status !== "admitted") {
              finishResponse(
                admission.status === "duplicate"
                  ? replay(redactReceipt(record))
                  : {
                      ...failure(record.result.code),
                      receipt: redactReceipt(record),
                    },
              );
              return;
            }
          }
          await waitForReady(ready(), owner.signal);
          owner.check();
          if (
            !registry &&
            envelope.expectedRevision !== undefined &&
            envelope.expectedRevision !== revision()
          )
            fail("STALE_REVISION");
          let result = await execute(operation);
          owner.check();
          // A logical unknown stays unknown when the original actual call settles.
          // Keep the mutation lane until this settlement and durable completion.
          if (
            (record.forkTarget ||
              isGitBranchRestoreApply(operation.type) ||
              isGitCommitApply(operation.type) ||
              isInboxCancel(operation.type)) &&
            owner.effectStarted &&
            owner.signal.aborted
          )
            result = failure("UNKNOWN_OUTCOME");
          if (!service.signal.aborted)
            await projectReceipt(
              record,
              operation,
              result,
              owner.effectStarted,
            );
          finishResponse({ ...result, receipt: redactReceipt(record) });
        } catch (error) {
          if (!owner.effectStarted)
            finishResponse(
              await rejectRecord(
                record,
                registry && registry.status().state !== "ready"
                  ? "UNAVAILABLE"
                  : errorResult(error).code,
              ),
            );
          else {
            record.delivery = "unknown";
            record.effect = "unknown";
            if (
              [
                "inbox_cancel_requested",
                "git_commit_created",
                "git_index_updated",
                "file_saved",
                "configuration_saved",
                "agent_file_saved",
                "agent_registered",
                "agent_removed",
                "skill_file_saved",
                "skill_registered",
                "skill_removed",
                "skill_applied",
                "instruction_registered",
                "instruction_removed",
                "mcp_registered",
                "mcp_connection",
                "mcp_removed",
              ].includes(record.result?.kind)
            )
              delete record.result;
            record.revision = revision();
            if (registry) {
              const durable = registry.lookup({
                runtimeEpoch: epoch,
                operationId,
              });
              if (durable.status === "found")
                Object.assign(record, durable.receipt);
            }
            finishResponse({
              ...(registry?.status().state === "recovery_required"
                ? failure("UNAVAILABLE")
                : errorResult(error)),
              receipt: redactReceipt(record),
            });
          }
        } finally {
          clearTimeout(timer);
          service.signal.removeEventListener("abort", expire);
          if (mutation === owner) mutation = undefined;
        }
      }),
    );
    return response;
  }
  function internal(kind, fn) {
    if (quiescing || service.signal.aborted)
      return Promise.reject(
        Object.assign(new Error("unavailable"), { appCode: "UNAVAILABLE" }),
      );
    const owner = scope(kind);
    const timer = setTimeout(() => owner.controller.abort(), deadlineMs);
    return trackActual(async () => {
      try {
        return await execution.run(owner, fn);
      } finally {
        clearTimeout(timer);
      }
    });
  }
  return {
    epoch,
    // Internal app read authority only; never exported through preload or DTO.
    mutationActive: () => Boolean(mutation),
    sdk,
    lookup,
    handle(value, sender) {
      try {
        if (typeof sender !== "string" || !sender || sender.length > 256)
          fail("INVALID_REQUEST");
        if (quiescing || service.signal.aborted) fail("UNAVAILABLE");
        const envelope = validateEnvelope(value);
        if (
          envelope.runtimeEpoch !== undefined &&
          envelope.runtimeEpoch !== epoch
        )
          fail("STALE_EPOCH");
        if (READ_TYPES.includes(envelope.operation.type))
          return read(envelope, sender);
        // Separate, journaled prerequisites (e.g. policy re-apply) run before
        // this operation is admitted; a failure rejects it with effect none.
        if (
          !preflight ||
          mutation ||
          ledger.has(envelope.operationId) ||
          quiescing
        )
          return mutate(envelope, sender);
        return preflight(envelope.operation, sender).then(
          (code) => mutate(envelope, sender, code),
          () => mutate(envelope, sender, "POLICY_UNVERIFIED"),
        );
      } catch (error) {
        return Promise.resolve(errorResult(error));
      }
    },
    cancel(value, sender) {
      try {
        if (typeof sender !== "string" || !sender) fail("INVALID_REQUEST");
        const cancel = validateCancel(value);
        if (service.signal.aborted) fail("UNAVAILABLE");
        if (cancel.runtimeEpoch !== epoch) fail("STALE_EPOCH");
        const sub = subscribers.get(
          JSON.stringify([sender, epoch, cancel.readId]),
        );
        if (sub) settleSubscriber(sub, failure("CANCELLED"));
        return { ok: true, value: { status: sub ? "cancelled" : "missing" } };
      } catch (error) {
        return errorResult(error);
      }
    },
    closeSender(sender) {
      for (const sub of [...subscribers.values()])
        if (sub.sender === sender) settleSubscriber(sub, failure("CANCELLED"));
    },
    close() {
      service.abort();
      for (const sub of [...subscribers.values()])
        settleSubscriber(sub, failure("UNAVAILABLE"));
      for (const task of tasks.values()) {
        clearTimeout(task.timer);
        task.quarantined = true;
      }
    },
    async drain() {
      // This fence is synchronous. Do not abort or quarantine admitted work.
      quiescing = true;
      while (actuals.size) await Promise.allSettled([...actuals]);
    },
    startup(fn) {
      return internal("startup", fn);
    },
    // Explicit service-only fixture adapter; main/preload never export it.
    trusted(fn) {
      return internal("trusted", fn);
    },
  };
}
