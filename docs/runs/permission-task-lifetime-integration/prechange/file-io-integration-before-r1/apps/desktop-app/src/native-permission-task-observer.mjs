import { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable, Writable } from "node:stream";
import { types } from "node:util";
import { Effect, Exit, Fiber } from "effect";
import { identifier, record } from "./native-permission-control-input.mjs";

// Capture Node's getters once. Public stream properties can be shadowed by
// caller accessors and an EventEmitter close event alone proves no settlement.
const nativeIO = [Readable, Writable].map((type) => ({
  type,
  stateKey: type === Readable ? "_readableState" : "_writableState",
  closed: Object.getOwnPropertyDescriptor(type.prototype, "closed").get,
  destroyed: Object.getOwnPropertyDescriptor(type.prototype, "destroyed").get,
  errored: Object.getOwnPropertyDescriptor(type.prototype, "errored").get,
}));
const resourceOwners = new WeakSet();
const fiberOwners = new WeakMap();
const reject = () => {
  throw new Error("native_permission_task_observer_invalid");
};
const opaque = () => Object.freeze(Object.create(null));
const object = (value) =>
  value !== null && typeof value === "object" && !types.isProxy(value);
const data = (value, key) => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, "value")) reject();
  return descriptor.value;
};
function checkLease(lease) {
  if (
    !object(lease) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(lease)) ||
    Reflect.ownKeys(lease).length !== 0
  )
    reject();
}
export function createNativeTaskObserver(input) {
  const { runtimeEpoch } = record(input, ["runtimeEpoch"]);
  identifier(runtimeEpoch);
  const leases = new Map();
  const slots = new WeakMap();
  const proofs = new WeakMap();
  let totalSlots = 0;
  let closed = false;
  const active = () => {
    if (closed) reject();
  };
  const entryFor = (lease) => {
    active();
    checkLease(lease);
    let entry = leases.get(lease);
    if (!entry) {
      if (leases.size >= 8192) reject();
      entry = { slots: [], fiber: undefined, taskDone: false };
      entry.taskWait = new Promise((resolve) => {
        entry.resolveTask = resolve;
      });
      leases.set(lease, entry);
    }
    return entry;
  };
  const finishSlot = (slot, complete) => {
    if (slot.done) return;
    slot.done = true;
    slot.complete = complete;
    slot.cleanup?.();
    slot.resolve();
  };
  const bind = (handle, resource, kind) => {
    active();
    const slot = object(handle) ? slots.get(handle) : undefined;
    if (
      !slot ||
      slot.kind !== kind ||
      slot.bound ||
      slot.done ||
      slot.entry.taskDone
    )
      reject();
    if (!object(resource) || resourceOwners.has(resource)) reject();
    let io;
    if (kind === "process") {
      if (!(resource instanceof ChildProcess)) reject();
      // A direct process that exited before binding has already lost evidence.
      if (
        data(resource, "exitCode") !== null ||
        data(resource, "signalCode") !== null ||
        data(resource, "_closesGot") !== 0
      ) {
        finishSlot(slot, false);
        reject();
      }
      data(resource, "_handle");
    } else {
      io = nativeIO.filter(({ type }) => resource instanceof type);
      if (io.length === 0) reject();
      for (const { stateKey } of io) {
        if (!object(data(resource, stateKey))) reject();
      }
      if (
        io.some(
          ({ closed, destroyed, errored }) =>
            closed.call(resource) ||
            destroyed.call(resource) ||
            errored.call(resource),
        )
      ) {
        // Lost pre-binding events are permanent, even if a caller retries with
        // a different resource. A reservation cannot be laundered into success.
        finishSlot(slot, false);
        reject();
      }
    }
    slot.bound = true;
    resourceOwners.add(resource);
    const onError = () => {
      slot.error = true;
    };
    const onClose = () =>
      finishSlot(
        slot,
        kind === "io" &&
          !slot.error &&
          io.every(
            ({ closed, errored }) =>
              closed.call(resource) === true && errored.call(resource) == null,
          ),
      );
    const onExit = () => {
      slot.exited = true;
    };
    slot.cleanup = () => {
      EventEmitter.prototype.removeListener.call(resource, "error", onError);
      EventEmitter.prototype.removeListener.call(resource, "close", onClose);
      if (kind === "process")
        EventEmitter.prototype.removeListener.call(resource, "exit", onExit);
    };
    EventEmitter.prototype.on.call(resource, "error", onError);
    EventEmitter.prototype.on.call(resource, "close", onClose);
    if (kind === "process")
      EventEmitter.prototype.on.call(resource, "exit", onExit);
  };
  // Sessionless original RPCs use these same concrete resource categories.
  // A mutation/workspace label cannot stand in for actual IO or process evidence.
  const allocateSlot = (entry, kind) => {
    if (kind !== "process" && kind !== "io") reject();
    if (entry.taskDone || totalSlots >= 8192 || entry.slots.length >= 32)
      reject();
    const handle = opaque();
    const slot = {
      entry,
      kind,
      bound: false,
      done: false,
      error: false,
      complete: false,
    };
    slot.wait = new Promise((resolve) => {
      slot.resolve = resolve;
    });
    slots.set(handle, slot);
    entry.slots.push(slot);
    totalSlots++;
    return handle;
  };
  return Object.freeze({
    // Invoke within the existing runtime task before its first effect. The
    // runtime supplies this identity; no caller object or copied fields do.
    capture(lease) {
      return Effect.withFiber((fiber) =>
        Effect.try({
          try: () => {
            const entry = entryFor(lease);
            if (
              entry.fiber ||
              (entry.captured && entry.captured !== fiber) ||
              (fiberOwners.has(fiber) && fiberOwners.get(fiber) !== entry)
            )
              reject();
            if (!entry.captured) {
              entry.captured = fiber;
              fiberOwners.set(fiber, entry);
              entry.removeTaskObserver = Object.getPrototypeOf(
                fiber,
              ).addObserver.call(fiber, (exit) => {
                entry.taskDone = true;
                entry.resolveTask(exit);
                for (const slot of entry.slots)
                  if (!slot.bound) finishSlot(slot, false);
              });
            }
            return fiber;
          },
          catch: (failure) => failure,
        }),
      );
    },
    reserve(lease, kind) {
      active();
      if (kind !== "process" && kind !== "io") reject();
      checkLease(lease);
      const previous = leases.get(lease);
      // Check capacity before allocating an entry, even on rejected requests.
      if (
        totalSlots >= 8192 ||
        previous?.captured ||
        previous?.fiber ||
        (previous?.slots.length ?? 0) >= 32
      )
        reject();
      return allocateSlot(entryFor(lease), kind);
    },
    // Dynamic IO is reserved only from its already captured concrete Fiber.
    // Outside callers and sibling Fibers cannot reserve after capture.
    reserveRunning(lease, kind) {
      return Effect.withFiber((fiber) =>
        Effect.sync(() => {
          active();
          checkLease(lease);
          const entry = leases.get(lease);
          if (
            !entry ||
            entry.captured !== fiber ||
            fiberOwners.get(fiber) !== entry
          )
            reject();
          return allocateSlot(entry, kind);
        }),
      );
    },
    bindProcess(slot, process) {
      bind(slot, process, "process");
    },
    bindIO(slot, stream) {
      bind(slot, stream, "io");
    },
    observe(lease, fiber) {
      active();
      if (arguments.length !== 2) reject();
      checkLease(lease);
      const previous = leases.get(lease);
      if (
        !object(fiber) ||
        !previous ||
        previous.captured !== fiber ||
        fiberOwners.get(fiber) !== previous
      )
        reject();
      if (previous?.fiber) {
        if (previous.fiber !== fiber) reject();
        return previous.effect;
      }
      const entry = entryFor(lease);
      entry.fiber = fiber;
      entry.effect = Effect.gen(function* () {
        const awaited = yield* Fiber.await(fiber);
        // A caller-written _exit field does not prove runtime/finalizer exit.
        const exit = (yield* Effect.promise(() => entry.taskWait)) ?? awaited;
        yield* Effect.promise(() =>
          Promise.all(entry.slots.map((slot) => slot.wait)),
        );
        if (!entry.proof) {
          entry.proof = opaque();
          const processCount = entry.slots.filter(
            (slot) => slot.kind === "process",
          ).length;
          proofs.set(entry.proof, {
            lease,
            facts: Object.freeze({
              runtimeEpoch,
              taskOutcome: Exit.isSuccess(exit) ? "success" : "failure",
              complete:
                !closed &&
                entry.taskDone &&
                processCount === 0 &&
                entry.slots.every((slot) => slot.complete),
              processCount,
              ioCount: entry.slots.length - processCount,
            }),
          });
        }
        return entry.proof;
      });
      return entry.effect;
    },
    proofFor(proof, lease) {
      active();
      if (!object(proof) || !object(lease)) reject();
      const stored = proofs.get(proof);
      if (!stored || stored.lease !== lease) reject();
      return stored.facts;
    },
    close() {
      if (closed) return;
      closed = true;
      for (const entry of leases.values()) {
        entry.removeTaskObserver?.();
        entry.resolveTask(undefined);
        for (const slot of entry.slots) finishSlot(slot, false);
      }
      leases.clear();
    },
  });
}
