// Private metadata/file observation only. Importing this module does no IO.
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { join } from "node:path";
import { fail } from "../workbench-contract.mjs";
import { metadataPath } from "./workbench-configuration.mjs";
import {
  configurationFileVersion,
  configurationSkillDirectoryVersion,
} from "./configuration-file-observation.mjs";
import {
  validSkillSourceName,
  skillFileContentFits,
  SKILL_LIMITS,
} from "../renderer/shared/configuration-draft/skill.mjs";

import {
  validAgentSourceName,
  agentFileContentFits,
  AGENT_LIMITS,
} from "../renderer/shared/configuration-draft/agent.mjs";
const specifications = Object.freeze({
  skill: {
    directory: "skills",
    nested: true,
    valid: validSkillSourceName,
    fits: skillFileContentFits,
    limits: SKILL_LIMITS,
  },
  agent: {
    directory: "agents",
    nested: false,
    valid: validAgentSourceName,
    fits: agentFileContentFits,
    limits: AGENT_LIMITS,
  },
});
const flags = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const regular = (s) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n;
const sameFile = (a, b) =>
  identity(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  a.ctimeNs === b.ctimeNs;
class ObservationFailure extends Error {
  constructor(reason) {
    super(reason);
    this.reason = reason;
  }
}
const refuse = (reason) => {
  throw new ObservationFailure(reason);
};
const absent = (e) => !e?.appCode && ["ENOENT", "ENOTDIR"].includes(e?.code);
const dataObject = (v) =>
  v &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).every((k) =>
    Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
  );

export async function listConfigurationSourceFiles(
  kind,
  workspace,
  options = {},
) {
  return observe(kind, workspace, undefined, options);
}
export async function readConfigurationSourceFile(
  kind,
  workspace,
  sourceName,
  options = {},
) {
  if (
    !Object.hasOwn(specifications, kind) ||
    !specifications[kind].valid(sourceName)
  )
    fail("INVALID_REQUEST");
  return observe(kind, workspace, sourceName, options);
}
async function observe(kind, workspace, sourceName, options) {
  if (!Object.hasOwn(specifications, kind)) fail("INVALID_REQUEST");
  const spec = specifications[kind];
  if (
    !dataObject(options) ||
    Reflect.ownKeys(options).some((k) => !["check", "io"].includes(k)) ||
    !dataObject(workspace)
  )
    fail("INVALID_REQUEST");
  const { check = () => {}, io = actualIO } = options;
  const { id, path } = workspace;
  const listing = sourceName === undefined;
  if (
    typeof id !== "string" ||
    !/^[\w.:-]{1,256}$/.test(id) ||
    !metadataPath(path) ||
    typeof check !== "function" ||
    !io ||
    !["lstat", "realpath", "open", ...(listing ? ["opendir"] : [])].every(
      (k) => typeof io[k] === "function",
    )
  )
    fail("INVALID_REQUEST");
  const paths = [
    path,
    join(path, ".opencode"),
    join(path, ".opencode", spec.directory),
  ];
  if (!listing && spec.nested) paths.push(join(paths[2], sourceName));
  const base = {
    workspaceId: id,
    workspacePath: path,
    ...(!listing ? { sourceName } : {}),
    path: listing
      ? paths[2]
      : spec.nested
        ? join(paths[3], "SKILL.md")
        : join(paths[2], `${sourceName}.md`),
  };
  const result = (status, reason) => ({ ...base, status, reason });
  const chain = [],
    leaves = [],
    handles = [];
  let stream, failure, response;
  async function checked(action) {
    check();
    let value;
    try {
      value = await action();
    } catch (e) {
      check();
      throw e;
    }
    check();
    return value;
  }
  async function stable() {
    for (const entry of chain) {
      try {
        const held = await checked(() => entry.handle.stat({ bigint: true }));
        const named = await checked(() =>
          io.lstat(entry.path, { bigint: true }),
        );
        if (
          !held.isDirectory() ||
          !named.isDirectory() ||
          named.isSymbolicLink() ||
          !identity(entry.stat, held) ||
          !identity(entry.stat, named) ||
          (await checked(() => io.realpath(entry.path))) !== entry.path
        )
          refuse("file_changed");
      } catch (e) {
        if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
        throw e;
      }
    }
  }
  async function stableLeaves() {
    for (const entry of leaves) {
      try {
        const held = await checked(() => entry.handle.stat({ bigint: true }));
        const named = await checked(() =>
          io.lstat(entry.path, { bigint: true }),
        );
        if (
          !regular(held) ||
          !regular(named) ||
          !sameFile(entry.stat, held) ||
          !sameFile(entry.stat, named) ||
          (await checked(() => io.realpath(entry.path))) !== entry.path
        )
          refuse("file_changed");
      } catch (e) {
        if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
        throw e;
      }
    }
  }
  async function guarded(action) {
    await stable();
    await stableLeaves();
    let value, error;
    try {
      value = await checked(action);
    } catch (e) {
      error = e;
    }
    await stable();
    await stableLeaves();
    if (error) throw error;
    return value;
  }
  async function acquire(directory) {
    let before;
    try {
      before = await guarded(() => io.lstat(directory, { bigint: true }));
    } catch (e) {
      if (absent(e)) refuse("path_missing");
      throw e;
    }
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (chain.length && before.dev !== chain[0].stat.dev)
    )
      refuse("path_denied");
    if ((await guarded(() => io.realpath(directory))) !== directory)
      refuse("path_denied");
    let handle;
    try {
      await guarded(async () => {
        handle = await io.open(directory, flags | constants.O_DIRECTORY);
        handles.push(handle);
      });
    } catch (e) {
      if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
      throw e;
    }
    const held = await guarded(() => handle.stat({ bigint: true }));
    if (!held.isDirectory() || !identity(before, held)) refuse("file_changed");
    chain.push({ path: directory, stat: held, handle });
    await stable();
  }
  async function acquireLeaf(path) {
    let before;
    try {
      before = await guarded(() => io.lstat(path, { bigint: true }));
    } catch (e) {
      if (absent(e)) refuse("file_changed");
      throw e;
    }
    if (
      !regular(before) ||
      before.dev !== chain[0].stat.dev ||
      (await guarded(() => io.realpath(path))) !== path
    )
      refuse("path_denied");
    let handle;
    try {
      await guarded(async () => {
        handle = await io.open(path, flags);
        handles.push(handle);
      });
    } catch (e) {
      if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
      throw e;
    }
    const held = await guarded(() => handle.stat({ bigint: true }));
    if (!regular(held) || !sameFile(before, held)) refuse("file_changed");
    leaves.push({ path, stat: held, handle });
    await stableLeaves();
  }
  const identities = () =>
    chain.map((e) => [e.path, String(e.stat.dev), String(e.stat.ino)]);
  async function run() {
    if (
      ![
        constants.O_NOFOLLOW,
        constants.O_NONBLOCK,
        constants.O_DIRECTORY,
      ].every((f) => Number.isInteger(f) && f !== 0)
    )
      refuse("path_denied");
    for (const directory of paths) await acquire(directory);
    if (listing) {
      await guarded(async () => {
        stream = await io.opendir(base.path, { bufferSize: 1 });
      });
      const entries = [];
      let truncated = true;
      for (let count = 0; count < spec.limits.scan; count++) {
        const entry = await guarded(() => stream.read());
        if (!entry) {
          truncated = false;
          break;
        }
        const name = spec.nested
          ? entry.name
          : typeof entry.name === "string" && entry.name.endsWith(".md")
            ? entry.name.slice(0, -3)
            : undefined;
        if (!spec.valid(name)) continue;
        // Do not trust Dirent type. Retain canonical named/held row identity.
        try {
          if (spec.nested) await acquire(join(base.path, entry.name));
          else await acquireLeaf(join(base.path, entry.name));
        } catch (e) {
          if (e instanceof ObservationFailure && e.reason === "path_denied")
            continue;
          if (e instanceof ObservationFailure && e.reason === "path_missing")
            refuse("file_changed");
          throw e;
        }
        // Retain accepted child FDs through enumeration. The row budget bounds
        // these handles, and later iterations still recheck every accepted row.
        entries.push({
          sourceName: name,
          path: spec.nested
            ? join(base.path, entry.name, "SKILL.md")
            : join(base.path, entry.name),
        });
        if (entries.length === spec.limits.entries) break;
      }
      await stable();
      await stableLeaves();
      return { ...base, status: "available", entries, truncated };
    }
    const directoryVersion = configurationSkillDirectoryVersion(
      base,
      identities(),
    );
    let named;
    try {
      named = await guarded(() => io.lstat(base.path, { bigint: true }));
    } catch (e) {
      if (!absent(e)) throw e;
      try {
        await guarded(() => io.lstat(base.path, { bigint: true }));
      } catch (second) {
        if (absent(second))
          return { ...result("missing", "missing_file"), directoryVersion };
        throw second;
      }
      refuse("file_changed");
    }
    if (
      !regular(named) ||
      named.dev !== chain[0].stat.dev ||
      (await guarded(() => io.realpath(base.path))) !== base.path
    )
      refuse("path_denied");
    let file;
    try {
      await guarded(async () => {
        file = await io.open(base.path, flags);
        handles.push(file);
      });
    } catch (e) {
      if (absent(e) || e?.code === "ELOOP") refuse("file_changed");
      throw e;
    }
    const initial = await guarded(() => file.stat({ bigint: true }));
    if (!regular(initial) || !sameFile(initial, named)) refuse("file_changed");
    async function stableFile() {
      const held = await guarded(() => file.stat({ bigint: true }));
      let current;
      try {
        current = await guarded(() => io.lstat(base.path, { bigint: true }));
      } catch (e) {
        if (absent(e)) refuse("file_changed");
        throw e;
      }
      if (
        !regular(current) ||
        !regular(held) ||
        !sameFile(initial, held) ||
        !sameFile(initial, current) ||
        (await guarded(() => io.realpath(base.path))) !== base.path
      )
        refuse("file_changed");
    }
    await stableFile();
    if (initial.size > BigInt(spec.limits.bytes))
      return result("unavailable", "too_large");
    const buffer = Buffer.alloc(spec.limits.bytes + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await guarded(() =>
        file.read(buffer, length, buffer.length - length, length),
      );
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > buffer.length - length
      )
        refuse("file_changed");
      if (!bytesRead) break;
      length += bytesRead;
    }
    await stableFile();
    if (length > spec.limits.bytes) return result("unavailable", "too_large");
    if (BigInt(length) !== initial.size) refuse("file_changed");
    const bytes = buffer.subarray(0, length);
    let content;
    try {
      content = new globalThis.TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      return result("unsupported", "unsupported_content");
    }
    if (!spec.fits(content))
      return result("unsupported", "unsupported_content");
    return {
      ...base,
      status: "available",
      content,
      directoryVersion,
      version: configurationFileVersion(
        { ...base, kind },
        chain[0].stat,
        initial,
        bytes,
        identities(),
      ),
    };
  }
  try {
    response = await run();
  } catch (e) {
    failure = e;
  } finally {
    // Cleanup is unconditional, including after cancellation or failed checks.
    for (const handle of [stream, ...handles.toReversed()]) {
      if (!handle) continue;
      try {
        await handle.close();
        check();
      } catch (e) {
        if (!failure || (!failure?.appCode && e?.appCode)) failure = e;
      }
    }
  }
  if (failure?.appCode) throw failure;
  if (failure) {
    const reason =
      failure instanceof ObservationFailure ? failure.reason : "path_denied";
    return result(
      listing && reason === "path_missing" ? "missing" : "unavailable",
      reason,
    );
  }
  return response;
}
