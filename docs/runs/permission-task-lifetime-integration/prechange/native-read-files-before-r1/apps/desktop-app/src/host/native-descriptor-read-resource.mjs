// Fixed descriptor-reader lifetime. Claim before the first microtask/physical IO.
// This is only file IO completion, never a Native tool/task/policy grant.
import { types } from "node:util";
import { createNativeDescriptorReadKernel } from "./native-descriptor-read.mjs";
import { isWorkspaceRootGuard } from "./workspace-root-authority.mjs";
import { validWorkspaceFileRoot } from "../renderer/shared/workspace-file/index.mjs";
import { isAbsolute, normalize } from "node:path";

const resources = new WeakMap();
const need = (condition) => {
  if (!condition) throw new Error("native_permission_file_io_unverified");
};
function capture(value, fields) {
  need(value && typeof value === "object" && !types.isProxy(value));
  need(Object.getPrototypeOf(value) === Object.prototype);
  const keys = Reflect.ownKeys(value);
  need(
    keys.length === fields.length && fields.every((key) => keys.includes(key)),
  );
  const result = {};
  for (const key of fields) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    need(field.enumerable && Object.hasOwn(field, "value"));
    result[key] = field.value;
  }
  return Object.freeze(result);
}

export function createNativeDescriptorRead(workspace, options) {
  const source = capture(workspace, ["id", "path"]);
  const settings = capture(options, ["checkRoot", "check"]);
  need(
    typeof source.id === "string" &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(source.id) &&
      validWorkspaceFileRoot(source.path) &&
      isAbsolute(source.path) &&
      normalize(source.path) === source.path,
  );
  need(
    isWorkspaceRootGuard(settings.checkRoot) &&
      typeof settings.check === "function" &&
      !types.isProxy(settings.check) &&
      !types.isAsyncFunction(settings.check) &&
      !types.isGeneratorFunction(settings.check),
  );
  const resource = Object.freeze(Object.create(null));
  let finish;
  const completion = new Promise((resolve) => {
    finish = resolve;
  });
  const state = {
    claimed: false,
    started: false,
    revoked: false,
    original: undefined,
    active: 0,
    shuttingDown: false,
    closeAttempted: false,
    closeVerified: false,
    published: false,
    factoryExited: false,
  };
  resources.set(resource, { state, completion });
  function publish() {
    if (
      state.published ||
      !state.shuttingDown ||
      !state.factoryExited ||
      state.active !== 0
    )
      return;
    state.published = true;
    finish(Object.freeze({ complete: state.closeVerified }));
  }
  function revoke() {
    state.revoked = true;
    state.shuttingDown = true;
    if (state.original && !state.closeAttempted) {
      state.closeAttempted = true;
      try {
        state.original.close();
        state.closeVerified = true;
      } catch {
        state.closeVerified = false;
      }
    }
    publish();
  }
  const ready = Promise.resolve().then(async () => {
    state.started = true;
    need(state.claimed);
    if (state.revoked) {
      // No factory call, library or descriptor existed on this branch.
      state.closeVerified = true;
      throw new Error("native_permission_file_io_cancelled");
    }
    const original = await createNativeDescriptorReadKernel(source, {
      checkRoot: settings.checkRoot,
      check() {
        need(!state.revoked);
        const result = settings.check();
        if (types.isPromise(result)) result.catch(() => {});
        need(!state.revoked);
        return result;
      },
    });
    state.original = original;
    if (state.revoked) {
      revoke();
      throw new Error("native_permission_file_io_cancelled");
    }
    function invoke(method, args) {
      need(!state.revoked && !state.shuttingDown);
      state.active++;
      try {
        return original[method](...args);
      } finally {
        state.active--;
        if (state.shuttingDown && state.active === 0) {
          // Reentrant cancellation can close the root before the original
          // read's temporary-FD finally runs. Recheck its sticky close state
          // only after that real call returns; a late close failure is final.
          try {
            original.close();
          } catch {
            state.closeVerified = false;
          }
        }
        publish();
      }
    }
    return Object.freeze({
      read(path, page) {
        return invoke("read", [path, page]);
      },
      list(path) {
        return invoke("list", [path]);
      },
      close() {
        revoke();
        return completion;
      },
    });
  });
  // Factory errors are conservatively unverified: error strings/properties do
  // not prove whether constructor cleanup closed every original descriptor.
  ready.then(
    () => {
      state.factoryExited = true;
      publish();
    },
    () => {
      state.factoryExited = true;
      state.shuttingDown = true;
      state.revoked = true;
      publish();
    },
  );
  return Object.freeze({
    resource,
    ready,
    cancel: revoke,
    close() {
      revoke();
      return completion;
    },
  });
}

export function isNativeDescriptorReadResource(resource) {
  return resources.has(resource);
}
export function observeNativeDescriptorRead(resource) {
  const entry = resources.get(resource);
  need(entry && !entry.state.claimed && !entry.state.started);
  entry.state.claimed = true;
  return entry.completion;
}
