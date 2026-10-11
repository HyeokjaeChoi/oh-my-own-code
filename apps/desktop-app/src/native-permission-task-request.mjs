// Main-process request correlation only. This capability is NOT journal proof.
// The sole writer issues it after actual durable dispatch and child arm ACK.
import { AsyncLocalStorage } from "node:async_hooks";
import { types } from "node:util";

export const NATIVE_TASK_HANDOFF_HEADER = "x-omoc-task-handoff";
const reject = () => {
  throw new Error("native_permission_task_request_invalid");
};
const uuid = (value) => {
  if (
    typeof value !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
      value,
    )
  )
    reject();
};
export function createNativeTaskRequestContext() {
  const storage = new AsyncLocalStorage();
  const handles = new WeakMap();
  const ids = new Set();
  let closed = false;
  const open = () => {
    if (closed) reject();
  };
  const assertCurrent = () => {
    open();
    const entry = storage.getStore();
    if (entry && !entry.active) reject();
  };
  const issue = (handoffId) => {
    open();
    uuid(handoffId);
    if (ids.has(handoffId) || ids.size >= 8192) reject();
    ids.add(handoffId);
    const handle = Object.freeze(Object.create(null));
    handles.set(handle, { handoffId, used: false, active: false });
    return handle;
  };
  const invoke = (handle, call) => {
    open();
    if (
      !handle ||
      typeof handle !== "object" ||
      types.isProxy(handle) ||
      typeof call !== "function"
    )
      reject();
    const entry = handles.get(handle);
    if (!entry || entry.used || storage.getStore()) reject();
    entry.used = true;
    entry.active = true;
    let actual;
    try {
      actual = storage.run(entry, call);
    } catch (error) {
      entry.active = false;
      throw error;
    }
    return Promise.resolve(actual).finally(() => {
      entry.active = false;
    });
  };
  const wrapFetch = (fetch) => {
    if (typeof fetch !== "function") reject();
    return (request, init) => {
      assertCurrent();
      // Copy headers. Never modify the SDK's Request or its authentication.
      const headers = new globalThis.Headers(
        request instanceof globalThis.Request ? request.headers : undefined,
      );
      if (init?.headers)
        new globalThis.Headers(init.headers).forEach((value, key) =>
          headers.set(key, value),
        );
      if (headers.has(NATIVE_TASK_HANDOFF_HEADER)) reject();
      const entry = storage.getStore();
      if (entry && !entry.active) reject();
      if (entry) headers.set(NATIVE_TASK_HANDOFF_HEADER, entry.handoffId);
      return fetch(request, { ...init, headers, redirect: "error" });
    };
  };
  const close = () => {
    // Do not disable ALS: outstanding calls must retain their own correlation,
    // but no later fetch or newly issued invocation may pass after revocation.
    closed = true;
  };
  return Object.freeze({ issue, invoke, wrapFetch, assertCurrent, close });
}
