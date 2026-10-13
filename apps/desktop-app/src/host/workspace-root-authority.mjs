// Private retained directory identity. This does not authorize a tool, mode or IO.
import { pinnedOpenFlags } from "../platform-paths.mjs";
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import { validWorkspaceFileRoot } from "../renderer/shared/workspace-file/index.mjs";

const fail = () => {
  throw new Error("native_permission_root_unverified");
};
const need = (condition) => {
  if (!condition) fail();
};
function capture(value, required, optional = []) {
  need(value && typeof value === "object" && !types.isProxy(value));
  need(Object.getPrototypeOf(value) === Object.prototype);
  const result = {};
  const fields = [...required, ...optional];
  need(required.every((key) => Object.hasOwn(value, key)));
  for (const key of Reflect.ownKeys(value)) {
    need(typeof key === "string" && fields.includes(key));
    const field = Object.getOwnPropertyDescriptor(value, key);
    need(field.enumerable && Object.hasOwn(field, "value"));
    result[key] = field.value;
  }
  return result;
}
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const directory = (stat) => stat.isDirectory() && !stat.isSymbolicLink();
const guards = new WeakMap();
// Cleanup facts come only from this acquisition path, never error properties.
// Reused error objects are ambiguous and permanently lose this proof.
const acquisitionFailures = new WeakMap();
const noteFailure = (error) => {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  )
    return;
  const previous = acquisitionFailures.get(error);
  if (previous) {
    previous.reused = true;
    return previous;
  }
  const state = { closed: false, reused: false };
  acquisitionFailures.set(error, state);
  return state;
};
export function workspaceRootFailureClosed(error) {
  const state = acquisitionFailures.get(error);
  return state?.closed === true && state.reused === false;
}

export function isWorkspaceRootGuard(guard) {
  return typeof guard === "function" && guards.has(guard);
}

// A trusted physical adapter can report an observed root identity failure.
// Revocation is pure and permanent; it neither closes the retained FD nor
// supplies physical-settlement proof. Only the owning close() does that IO.
export function invalidateWorkspaceRootGuard(guard) {
  need(isWorkspaceRootGuard(guard));
  guards.get(guard).revoked = true;
}

// Inspect only our private state. Never invoke the supplied function, even if
// it resembles a guard. This must stay pure after the last ordinary check().
export function assertWorkspaceRootGuard(guard, input) {
  need(isWorkspaceRootGuard(guard));
  const owner = guards.get(guard);
  const value = capture(input, ["workspaceId", "workspacePath", "dev", "ino"]);
  need(
    !owner.closed &&
      !owner.revoked &&
      value.workspaceId === owner.id &&
      value.workspacePath === owner.path &&
      value.dev === owner.dev &&
      value.ino === owner.ino,
  );
  return true;
}

export async function createWorkspaceRootAuthority(workspace, options = {}) {
  const { id, path } = capture(workspace, ["id", "path"]);
  const settings = capture(options, [], ["check", "io"]);
  const { check = () => {}, io = actualIO } = settings;
  need(
    typeof id === "string" &&
      /^[A-Za-z0-9_.:-]{1,128}$/.test(id) &&
      validWorkspaceFileRoot(path) &&
      isAbsolute(path) &&
      normalize(path) === path,
  );
  need(typeof check === "function" && io && !types.isProxy(io));
  need(
    ["lstat", "realpath", "open"].every((key) => typeof io[key] === "function"),
  );
  need(pinnedOpenFlags().supported);
  let handle, pinned;
  const checked = async (action) => {
    check();
    const value = await action();
    check();
    return value;
  };
  try {
    const before = await checked(() => io.lstat(path, { bigint: true }));
    need(directory(before));
    need((await checked(() => io.realpath(path))) === path);
    // Retain the actual handle before a reentrant check can reject acquisition.
    await checked(async () => {
      handle = await io.open(
        path,
        constants.O_RDONLY |
          constants.O_NOFOLLOW |
          constants.O_DIRECTORY |
          constants.O_NONBLOCK,
      );
    });
    pinned = await checked(() => handle.stat({ bigint: true }));
    const after = await checked(() => io.lstat(path, { bigint: true }));
    need(
      directory(pinned) &&
        directory(after) &&
        same(before, pinned) &&
        same(pinned, after),
    );
    need((await checked(() => io.realpath(path))) === path);
  } catch (error) {
    const failure = noteFailure(error);
    try {
      if (handle) await handle.close();
    } catch (closeError) {
      noteFailure(closeError);
      throw closeError;
    }
    if (failure) failure.closed = true;
    throw error;
  }
  let closing;
  const dev = String(pinned.dev),
    ino = String(pinned.ino);
  const state = { id, path, dev, ino, closed: false, revoked: false };
  const assertOpened = (input) => assertWorkspaceRootGuard(assertOpened, input);
  guards.set(assertOpened, state);
  const requireCurrent = () => need(!state.closed && !state.revoked);
  const currentIO = async (action) => {
    requireCurrent();
    const value = await action();
    requireCurrent();
    return value;
  };
  const inspectIdentity = async () => {
    const held = await currentIO(() => handle.stat({ bigint: true }));
    need(directory(held) && same(pinned, held));
    const named = await currentIO(() => io.lstat(path, { bigint: true }));
    need(directory(named) && same(pinned, named));
    need((await currentIO(() => io.realpath(path))) === path);
    requireCurrent();
  };
  // Recheck actual identity on both sides of the existing authority callback.
  // A failed observation is permanent; restoring the name cannot revive it.
  const assertCurrent = async () => {
    try {
      requireCurrent();
      check();
      requireCurrent();
      await inspectIdentity();
      requireCurrent();
      check();
      requireCurrent();
      await inspectIdentity();
      requireCurrent();
      return true;
    } catch (error) {
      state.revoked = true;
      throw error;
    }
  };
  const close = () => {
    if (!state.closed) {
      state.closed = true;
      closing = Promise.resolve().then(() => handle.close());
    }
    return closing;
  };
  return Object.freeze({ assertOpened, assertCurrent, close });
}
