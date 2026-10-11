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
  if (type.startsWith("file.")) return "files";
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
}) {
  const epoch = randomUUID();
  const service = new AbortController();
  const tasks = new Map();
  const subscribers = new Map();
  const ledger = new Map();
  const sdkLanes = new Set();
  let mutation;
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
    if (effect) owner.markEffect();
    if (primary && owner.kind === "mutation") owner.finalizing = true;
    sdkLanes.add(lane);
    owner.sdkActive = true;
    const signal =
      owner.kind === "mutation" && owner.effectStarted && owner.signal.aborted
        ? service.signal
        : owner.signal;
    const actual = Promise.resolve()
      .then(() => {
        owner.check();
        return fn(...args, { signal });
      })
      .finally(() => {
        owner.sdkActive = false;
        sdkLanes.delete(lane);
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
        owner: scope(kind),
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
      task.actual = execution.run(task.owner, async () => {
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
      });
    }
    return promise;
  }
  function rejectRecord(record, code) {
    record.admission = "rejected";
    record.effect = "none";
    record.result = { kind: "rejected", code };
    record.revision = revision();
    return { ...failure(code), receipt: redactReceipt(record) };
  }
  function mutate(envelope) {
    const { operationId, operation } = envelope;
    const hash = digest({
      ...operation,
      expectedRevision: envelope.expectedRevision ?? null,
    });
    const old = ledger.get(operationId);
    if (old)
      return Promise.resolve(
        old.digest === hash
          ? {
              ok: true,
              value: { status: "duplicate" },
              receipt: redactReceipt(old),
            }
          : failure("DUPLICATE_CONFLICT"),
      );
    if (ledger.size >= 2048) return Promise.resolve(failure("LIMIT_REACHED"));
    const record = {
      runtimeEpoch: epoch,
      operationId,
      type: operation.type,
      workspaceId: operation.workspaceId,
      sessionId: operation.sessionId,
      digest: hash,
      admission: "admitted",
      delivery: "pending",
      effect: "none",
      revision: revision(),
      evidence: [],
    };
    ledger.set(operationId, record);
    if (mutation) return Promise.resolve(rejectRecord(record, "BUSY"));
    if (
      envelope.expectedRevision !== undefined &&
      envelope.expectedRevision !== revision()
    )
      return Promise.resolve(rejectRecord(record, "STALE_REVISION"));
    const owner = scope("mutation", record);
    mutation = owner;
    let resolve;
    let settled = false;
    const response = new Promise((r) => {
      resolve = r;
    });
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
        record.revision = revision();
        finishResponse({
          ...failure("UNKNOWN_OUTCOME"),
          receipt: redactReceipt(record),
        });
      } else finishResponse(rejectRecord(record, "READ_TIMEOUT"));
    };
    const timer = setTimeout(expire, deadlineMs);
    service.signal.addEventListener("abort", expire, { once: true });
    execution.run(owner, async () => {
      try {
        await waitForReady(ready(), owner.signal);
        owner.check();
        if (
          envelope.expectedRevision !== undefined &&
          envelope.expectedRevision !== revision()
        )
          fail("STALE_REVISION");
        const result = await execute(operation);
        owner.check();
        if (!service.signal.aborted)
          projectReceipt(record, operation, result, owner.effectStarted);
        finishResponse({ ...result, receipt: redactReceipt(record) });
      } catch (error) {
        if (!owner.effectStarted)
          finishResponse(rejectRecord(record, errorResult(error).code));
        else {
          record.delivery = "unknown";
          record.effect = "unknown";
          record.revision = revision();
          finishResponse({
            ...errorResult(error),
            receipt: redactReceipt(record),
          });
        }
      } finally {
        clearTimeout(timer);
        service.signal.removeEventListener("abort", expire);
        if (mutation === owner) mutation = undefined;
      }
    });
    return response;
  }
  return {
    epoch,
    sdk,
    lookup,
    handle(value, sender) {
      try {
        if (typeof sender !== "string" || !sender || sender.length > 256)
          fail("INVALID_REQUEST");
        if (service.signal.aborted) fail("UNAVAILABLE");
        const envelope = validateEnvelope(value);
        if (
          envelope.runtimeEpoch !== undefined &&
          envelope.runtimeEpoch !== epoch
        )
          fail("STALE_EPOCH");
        return READ_TYPES.includes(envelope.operation.type)
          ? read(envelope, sender)
          : mutate(envelope);
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
    startup(fn) {
      const owner = scope("startup");
      const timer = setTimeout(() => owner.controller.abort(), deadlineMs);
      return execution.run(owner, fn).finally(() => clearTimeout(timer));
    },
    // Explicit service-only fixture adapter; main/preload never export it.
    trusted(fn) {
      const owner = scope("trusted");
      const timer = setTimeout(() => owner.controller.abort(), deadlineMs);
      return execution.run(owner, fn).finally(() => clearTimeout(timer));
    },
  };
}
