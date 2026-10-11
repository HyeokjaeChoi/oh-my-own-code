// Fixed existing-file read provenance. No IO runs at import or factory time.
import * as actualIO from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import { fail } from "../workbench-errors.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
} from "../renderer/shared/workspace-file/index.mjs";
import { observeWorkspaceFileBytes } from "./workbench-file-edit.mjs";
import { isWorkspaceRootGuard } from "./workspace-root-authority.mjs";

const resources = new WeakMap();
const need = (condition) => {
  if (!condition) fail("INVALID_REQUEST");
};
function capture(input, required, optional = []) {
  need(input !== null && typeof input === "object" && !types.isProxy(input));
  need(Object.getPrototypeOf(input) === Object.prototype);
  const copy = {};
  for (const key of Reflect.ownKeys(input)) {
    need(typeof key === "string" && [...required, ...optional].includes(key));
    const field = Object.getOwnPropertyDescriptor(input, key);
    need(field.enumerable && Object.hasOwn(field, "value"));
    copy[key] = field.value;
  }
  need(required.every((key) => Object.hasOwn(copy, key)));
  return Object.freeze(copy);
}
function synchronousFunction(value) {
  return (
    typeof value === "function" &&
    !types.isProxy(value) &&
    !types.isAsyncFunction(value) &&
    !types.isGeneratorFunction(value)
  );
}

export function createNativeWorkspaceFileRead(
  workspace,
  relativePath,
  options,
) {
  const source = capture(workspace, ["id", "path"]);
  const settings = capture(options, ["checkRoot", "check"], ["io"]);
  need(
    typeof source.id === "string" &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(source.id) &&
      validWorkspaceFileRoot(source.path) &&
      isAbsolute(source.path) &&
      normalize(source.path) === source.path &&
      workspaceFilePathReason(relativePath) !== "invalid_path" &&
      isWorkspaceRootGuard(settings.checkRoot) &&
      synchronousFunction(settings.check),
  );
  // Explicit injection is never production proof, even if it names actualIO.
  const injected = Object.hasOwn(settings, "io");
  const io = injected
    ? capture(settings.io, ["lstat", "realpath", "open"])
    : actualIO;
  need(
    ["lstat", "realpath", "open"].every(
      (key) => typeof io[key] === "function" && !types.isProxy(io[key]),
    ),
  );
  let cancelled = false;
  let exited = false;
  let pending = 0;
  const handles = [];
  let finish;
  const completion = new Promise((resolve) => {
    finish = resolve;
  });
  function publish() {
    if (!exited || pending !== 0) return;
    finish(
      Object.freeze({
        complete:
          !injected &&
          handles.every((entry) => entry.closed && entry.original.fd === -1),
        handleCount: handles.length,
      }),
    );
  }
  function requireActive() {
    if (cancelled) {
      throw Object.assign(new Error("native_permission_file_io_cancelled"), {
        appCode: "UNAVAILABLE",
      });
    }
  }
  function check() {
    requireActive();
    const value = settings.check();
    // A synchronous authority callback must not defer its decision.
    if (types.isPromise(value)) {
      value.catch(() => {});
      fail("INVALID_REQUEST");
    }
    need(
      value === undefined ||
        value === null ||
        (typeof value !== "object" && typeof value !== "function"),
    );
    requireActive();
  }
  async function track(action, cleanup = false) {
    if (!cleanup) requireActive();
    pending++;
    try {
      return await action();
    } finally {
      pending--;
      publish();
    }
  }
  const privateIO = Object.freeze({
    lstat: (...args) => track(() => io.lstat(...args)),
    realpath: (...args) => track(() => io.realpath(...args)),
    open: (...args) =>
      track(async () => {
        const original = await io.open(...args);
        const entry = { original, closed: false };
        handles.push(entry);
        // Only the fixed primitive sees this facade. Retain originals privately.
        return Object.freeze({
          read: (...readArgs) => track(() => original.read(...readArgs)),
          stat: (...statArgs) => track(() => original.stat(...statArgs)),
          close: () =>
            track(async () => {
              await original.close();
              entry.closed = original.fd === -1;
            }, true),
        });
      }),
  });
  const resource = Object.freeze(Object.create(null));
  const state = { completion, claimed: false, started: false };
  resources.set(resource, state);
  // Reserve/bind the observer in the current turn, before any first open.
  const result = Promise.resolve().then(() => {
    state.started = true;
    need(state.claimed);
    return observeWorkspaceFileBytes(source, relativePath, {
      checkRoot: settings.checkRoot,
      check,
      io: privateIO,
    });
  });
  const exit = () => {
    exited = true;
    publish();
  };
  result.then(exit, exit);
  return Object.freeze({
    resource,
    result,
    cancel() {
      cancelled = true;
    },
  });
}

// Deliberately not async: forged and proxy tokens throw synchronously.
export function observeNativeWorkspaceFileRead(resource) {
  const state = resources.get(resource);
  need(state !== undefined && !state.claimed && !state.started);
  state.claimed = true;
  return state.completion;
}
