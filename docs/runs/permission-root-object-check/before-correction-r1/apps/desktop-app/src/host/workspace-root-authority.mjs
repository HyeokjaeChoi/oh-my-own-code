// Private retained directory identity. This does not authorize a tool, mode or IO.
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import { validWireId } from "../workbench-contract.mjs";
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

export async function createWorkspaceRootAuthority(workspace, options = {}) {
  const { id, path } = capture(workspace, ["id", "path"]);
  const settings = capture(options, [], ["check", "io"]);
  const { check = () => {}, io = actualIO } = settings;
  need(
    validWireId(id) &&
      validWorkspaceFileRoot(path) &&
      isAbsolute(path) &&
      normalize(path) === path,
  );
  need(typeof check === "function" && io && !types.isProxy(io));
  need(
    ["lstat", "realpath", "open"].every((key) => typeof io[key] === "function"),
  );
  need(
    [constants.O_NOFOLLOW, constants.O_DIRECTORY, constants.O_NONBLOCK].every(
      (flag) => Number.isInteger(flag) && flag !== 0,
    ),
  );
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
    if (handle) await handle.close();
    throw error;
  }
  let closed = false,
    closing;
  const dev = String(pinned.dev),
    ino = String(pinned.ino);
  const assertOpened = (input) => {
    const value = capture(input, [
      "workspaceId",
      "workspacePath",
      "dev",
      "ino",
    ]);
    need(
      !closed &&
        value.workspaceId === id &&
        value.workspacePath === path &&
        value.dev === dev &&
        value.ino === ino,
    );
    return true;
  };
  const close = () => {
    if (!closed) {
      closed = true;
      closing = Promise.resolve().then(() => handle.close());
    }
    return closing;
  };
  return Object.freeze({ assertOpened, close });
}
