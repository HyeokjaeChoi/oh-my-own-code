// Read-only workspace candidate. No Native persistence or execution permission.
//
// Git/Hg repositories are allowed (the workspace may be a repository root or
// inside one). The original refusal existed because Native's Project.resolve
// discovers VCS by spawning git/hg against repository-controlled config and
// derives a VCS-based project identity. This candidate never calls it: the
// project id is always SHA1("directory:"+canonicalDirectory) and the Location
// reports `vcs: undefined`, so every Native git/hg code path (VCS plugins,
// snapshots, worktree strategies) stays disabled. A `.git`/`.hg` entry is just
// a directory entry; root pinning, canonical-path and symlink identity checks
// below are unchanged. VCS metadata must still be protected from tool writes
// by permission rules (see permission-mode.mjs).
import { createHash } from "node:crypto";
import { lstatSync, realpathSync } from "node:fs";
import * as fs from "node:fs/promises";
import { dirname } from "node:path";
import { types } from "node:util";
import {
  createWorkspaceRootAuthority,
  assertWorkspaceRootGuard,
  workspaceRootFailureClosed,
} from "./workspace-root-authority.mjs";

const refuse = () => {
  throw new Error("native_bootstrap_workspace_unverified");
};
const need = (value) => {
  if (!value) refuse();
};
function capture(input, required, optional = []) {
  need(input && typeof input === "object" && !types.isProxy(input));
  need(Object.getPrototypeOf(input) === Object.prototype);
  const output = {};
  need(required.every((key) => Object.hasOwn(input, key)));
  for (const key of Reflect.ownKeys(input)) {
    need(typeof key === "string" && [...required, ...optional].includes(key));
    const field = Object.getOwnPropertyDescriptor(input, key);
    need(field.enumerable && Object.hasOwn(field, "value"));
    output[key] = field.value;
  }
  return output;
}
const fields = [
  "dev",
  "ino",
  "mode",
  "nlink",
  "uid",
  "gid",
  "size",
  "mtimeNs",
  "ctimeNs",
];
function directory(stat) {
  need(stat.isDirectory() && !stat.isSymbolicLink());
  // An unverifiable directory (including an inaccessible ancestor) is refused.
  need((stat.mode & 0o444n) !== 0n && (stat.mode & 0o111n) !== 0n);
  return stat;
}
const same = (left, right) => fields.every((key) => left[key] === right[key]);
// Retained authority follows the same checked directory object. Ordinary file
// changes alter size/nlink/timestamps without replacing that object. Every new
// observation still checks ALL fields before/after and in its final sweep;
// across observations retain identity, ownership and access mode, not a frozen
// directory listing. Canonical paths are always checked anew.
const sameIdentity = (left, right) =>
  ["dev", "ino", "mode", "uid", "gid"].every((key) => left[key] === right[key]);
// Facts belong to this factory invocation, never to caller error properties.
const failures = new WeakMap();
const noteFailure = (error) => {
  if (
    (typeof error !== "object" || error === null) &&
    typeof error !== "function"
  )
    return;
  const prior = failures.get(error);
  if (prior) {
    prior.reused = true;
    return prior;
  }
  const state = { closed: false, reused: false };
  failures.set(error, state);
  return state;
};
export function nativeBootstrapWorkspaceFailureClosed(error) {
  const state = failures.get(error);
  return state?.closed === true && state.reused === false;
}

export async function createNativeBootstrapWorkspace(workspace, options = {}) {
  const selected = capture(workspace, ["id", "path"]);
  const settings = capture(options, [], ["check"]);
  const { check = () => {} } = settings;
  need(typeof check === "function" && !types.isProxy(check));
  need(!types.isAsyncFunction(check) && !types.isGeneratorFunction(check));
  let root, row, observations, closing;
  let revoked = false;
  let rootStarted = false;
  const requireLive = () => need(!revoked);
  const checkNow = () => {
    requireLive();
    const result = check();
    // Do not inspect caller-owned thenables or run promise-returning checks.
    need(result === null || !["object", "function"].includes(typeof result));
    requireLive();
  };
  const checked = async (action) => {
    checkNow();
    let value;
    try {
      value = await action();
    } catch (error) {
      checkNow();
      throw error;
    }
    checkNow();
    return value;
  };
  const guard = () => {
    requireLive();
    assertWorkspaceRootGuard(root.assertOpened, row);
  };
  const observe = async () => {
    const chain = [];
    let path = selected.path;
    for (let depth = 0; depth < 64; depth++) {
      const before = directory(
        await checked(() => fs.lstat(path, { bigint: true })),
      );
      need((await checked(() => fs.realpath(path))) === path);
      const after = directory(
        await checked(() => fs.lstat(path, { bigint: true })),
      );
      need(same(before, after));
      chain.push({ path, stat: after });
      const parent = dirname(path);
      if (parent === path) return chain;
      path = parent;
    }
    refuse();
  };
  // No callbacks or awaits in the final sweep: the last caller check can close
  // the owner or change a marker. This is still an observation, not an atomic
  // namespace lock. External relocation after the sweep remains uncertain.
  const finalObservation = (chain) => {
    for (const { path, stat } of chain) {
      need(same(stat, directory(lstatSync(path, { bigint: true }))));
      need(realpathSync(path) === path);
      need(same(stat, directory(lstatSync(path, { bigint: true }))));
    }
    guard();
  };
  const close = () => {
    revoked = true; // Synchronous, irreversible, even if the FD close fails.
    closing ??= root.close();
    return closing;
  };
  const assertCurrent = async () => {
    try {
      requireLive();
      await checked(() => root.assertCurrent());
      const current = await checked(observe);
      need(current.length === observations.length);
      need(
        current.every(
          (item, i) =>
            item.path === observations[i].path &&
            sameIdentity(item.stat, observations[i].stat),
        ),
      );
      await checked(() => root.assertCurrent());
      finalObservation(current);
      return true;
    } catch (error) {
      revoked = true;
      throw error;
    }
  };
  try {
    // The actual root owner retains the FD before calling a rejecting check.
    // Do not wrap this acquisition: an outer post-await check must not discard
    // the newly returned owner before we retain it for mandatory cleanup.
    checkNow();
    rootStarted = true;
    root = await createWorkspaceRootAuthority(selected, { check: checkNow });
    checkNow();
    const stat = directory(
      await checked(() => fs.lstat(selected.path, { bigint: true })),
    );
    row = {
      workspaceId: selected.id,
      workspacePath: selected.path,
      dev: String(stat.dev),
      ino: String(stat.ino),
    };
    guard();
    observations = await checked(observe);
    await checked(() => root.assertCurrent());
    const projectId = createHash("sha1")
      .update(`directory:${selected.path}`)
      .digest("hex");
    const inspect = () => {
      guard();
      return {
        workspaceId: row.workspaceId,
        workspacePath: row.workspacePath,
        projectId,
        rootIdentity: { dev: row.dev, ino: row.ino },
      };
    };
    const owner = Object.freeze({ inspect, assertCurrent, close });
    finalObservation(observations);
    return owner;
  } catch (error) {
    revoked = true;
    // Cleanup is unconditional, with no authority callback. A close failure
    // escapes; it must never be reported as successful retained-FD cleanup.
    const failure = noteFailure(error);
    try {
      if (root) await close();
      else if (rootStarted && !workspaceRootFailureClosed(error)) throw error;
    } catch (closeError) {
      if (closeError !== error) noteFailure(closeError);
      throw closeError;
    }
    if (failure) failure.closed = true;
    throw error;
  }
}
