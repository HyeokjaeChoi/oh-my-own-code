// Fixed descriptor-reader lifetime. Claim before the first microtask/physical IO.
// This is only file IO completion, never a Native tool/task/policy grant.
import { types } from "node:util";
import { createNativeDescriptorReadKernel } from "./native-descriptor-read.mjs";
import { isWorkspaceRootGuard } from "./workspace-root-authority.mjs";
import {
  validWorkspaceFileRoot,
  validWorkspaceFilePath,
} from "../renderer/shared/workspace-file/index.mjs";
import { isAbsolute, normalize, relative, join } from "node:path";

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
  const entry = {
    state,
    completion,
    source,
    filesIssued: false,
    check: settings.check,
  };
  resources.set(resource, entry);
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
  entry.ready = ready;
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
// Pure live-task recheck at an async consumer's disclosure boundary. This does
// not observe paths, close descriptors or supply physical-settlement proof.
export function assertNativeDescriptorReadCurrent(resource) {
  const entry = resources.get(resource);
  need(
    entry &&
      entry.state.claimed &&
      !entry.state.revoked &&
      !entry.state.shuttingDown,
  );
  const result = entry.check();
  if (types.isPromise(result)) result.catch(() => {});
  need(
    result === null ||
      (typeof result !== "object" && typeof result !== "function"),
  );
  need(!entry.state.revoked && !entry.state.shuttingDown);
}
export function observeNativeDescriptorRead(resource) {
  const entry = resources.get(resource);
  need(entry && !entry.state.claimed && !entry.state.started);
  entry.state.claimed = true;
  return entry.completion;
}

// Private Read consumer seam, not a general EnvironmentFiles driver or grant.
// It can only wrap this module's already claimed original resource once.
export function createNativeDescriptorFiles(resource) {
  const entry = resources.get(resource);
  need(entry && entry.state.claimed && !entry.filesIssued);
  const live = () => need(!entry.state.revoked && !entry.state.shuttingDown);
  live();
  entry.filesIssued = true;
  const identities = new Map(),
    paths = new Set();
  let busy = false,
    calls = 0,
    requestedBytes = 0,
    rowsRead = 0;
  function target(absolute) {
    need(
      typeof absolute === "string" &&
        isAbsolute(absolute) &&
        normalize(absolute) === absolute,
    );
    const path = relative(entry.source.path, absolute);
    need(
      (path === "" || validWorkspaceFilePath(path)) &&
        join(entry.source.path, path) === absolute,
    );
    return path;
  }
  function range(input) {
    if (input === undefined)
      return Object.freeze({ offset: 0, length: 20 * 1024 * 1024 });
    need(input && typeof input === "object" && !types.isProxy(input));
    const keys = Reflect.ownKeys(input);
    need(keys.every((key) => key === "offset" || key === "length"));
    const row = capture(input, keys);
    const offset = Object.hasOwn(row, "offset") ? row.offset : 0;
    const length = Object.hasOwn(row, "length") ? row.length : 20 * 1024 * 1024;
    need(
      Number.isSafeInteger(offset) &&
        offset >= 0 &&
        Number.isSafeInteger(length) &&
        length >= 1 &&
        length <= 20 * 1024 * 1024,
    );
    return Object.freeze({ offset, length });
  }
  async function invoke(method, absolute, input) {
    live();
    need(!busy);
    // Detach caller data before ready can yield. Native never supplies identity.
    const path = target(absolute);
    const page = method === "read" ? range(input) : undefined;
    const whole =
      method === "read" &&
      (input === undefined || !Object.hasOwn(input, "length"));
    need(calls < 256 && (paths.has(path) || paths.size < 256));
    if (page) need(requestedBytes + page.length <= 32 * 1024 * 1024);
    calls++;
    paths.add(path);
    if (page) requestedBytes += page.length;
    busy = true;
    let bytes;
    try {
      const access = await entry.ready;
      live();
      if (method === "list") {
        const rows = access.list(path);
        live();
        rowsRead += rows.length;
        need(rowsRead <= 8192);
        return rows;
      }
      const identity = identities.get(path);
      const result = access.read(path, {
        ...page,
        ...(identity === undefined ? {} : { identity }),
      });
      bytes = result.bytes;
      live();
      // An absent Native range means whole content. Never report a partial
      // bounded buffer as the complete larger file.
      if (whole) need(result.info.size <= 20 * 1024 * 1024);
      if (identity === undefined) identities.set(path, result.identity);
      return Object.freeze({ bytes, info: result.info });
    } catch (error) {
      bytes?.fill(0);
      throw error;
    } finally {
      busy = false;
    }
  }
  return Object.freeze({
    read: (absolute, page) => invoke("read", absolute, page),
    list: (absolute) => invoke("list", absolute),
  });
}
