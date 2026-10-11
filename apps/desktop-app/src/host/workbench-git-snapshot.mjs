// Checked private Git snapshots. All Git commands use app-owned roots.
import { constants } from "node:fs";
import { join, dirname, resolve, isAbsolute, normalize } from "node:path";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import {
  validGitCommitAuthor,
  validGitCommitBranch,
  GIT_COMMIT_REFLOG_REASON,
} from "../renderer/shared/git-commit/index.mjs";
import {
  validGitBranch,
  validGitOid,
} from "../renderer/shared/git-review/index.mjs";
import {
  validWorkspaceFilePath,
  workspaceFileContentFits,
} from "../renderer/shared/workspace-file/index.mjs";
const GIT = "/Library/Developer/CommandLineTools/usr/bin/git";
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const identity = (s) => [s.dev, s.ino].map(String).join(":");
const signature = (s) =>
  [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs]
    .map(String)
    .join(":");
const regular = (s) => s.isFile() && !s.isSymbolicLink() && s.nlink === 1n;
const absent = (e) => ["ENOENT", "ENOTDIR"].includes(e?.code);
const inside = (parent, child) =>
  child === parent || child.startsWith(parent === "/" ? "/" : parent + "/");
class Refusal extends Error {}
const refuse = (reason) => {
  throw new Refusal(reason);
};
const decode = (buffer, reason = "unsupported_repository") => {
  try {
    return new globalThis.TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(buffer);
  } catch {
    refuse(reason);
  }
};
const data = (v) =>
  v &&
  Object.getPrototypeOf(v) === Object.prototype &&
  Reflect.ownKeys(v).every(
    (k) =>
      typeof k === "string" &&
      Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
  );

// All original reads hold checked descriptors, with ancestry checks around IO.
// No raw input bytes survive the request; the manifest contains only digests.
class Sources {
  constructor(ctx) {
    this.ctx = ctx;
    this.io = ctx.io;
    this.dirs = new Map();
    this.files = new Map();
    this.listings = new Map();
    this.missing = new Set();
    this.handles = [];
    this.manifest = new Map();
  }
  async stable() {
    this.ctx.check();
    for (const [path, entry] of this.dirs) {
      const named = await this.io.lstat(path, { bigint: true });
      const held = await entry.handle.stat({ bigint: true });
      if (
        !named.isDirectory() ||
        named.isSymbolicLink() ||
        identity(named) !== entry.id ||
        identity(held) !== entry.id ||
        (await this.io.realpath(path)) !== path
      )
        refuse("path_changed");
    }
    this.ctx.check();
  }
  async directory(path) {
    if (this.dirs.has(path)) return this.dirs.get(path).handle;
    if (!isAbsolute(path) || normalize(path) !== path) refuse("path_denied");
    if (dirname(path) !== path) await this.directory(dirname(path));
    await this.stable();
    let before;
    try {
      before = await this.io.lstat(path, { bigint: true });
    } catch (e) {
      if (absent(e)) {
        this.missing.add(path);
        this.manifest.set(`missing:${path}`, "absent");
      }
      throw e;
    }
    if (
      !before.isDirectory() ||
      before.isSymbolicLink() ||
      (await this.io.realpath(path)) !== path
    )
      refuse("path_denied");
    const handle = await this.io.open(
      path,
      constants.O_RDONLY |
        constants.O_NOFOLLOW |
        constants.O_DIRECTORY |
        constants.O_NONBLOCK,
    );
    this.handles.push(handle);
    const held = await handle.stat({ bigint: true });
    if (!held.isDirectory() || identity(before) !== identity(held))
      refuse("path_changed");
    this.dirs.set(path, { handle, id: identity(held) });
    this.manifest.set(`directory:${path}`, identity(held));
    await this.stable();
    return handle;
  }
  async read(path, cap, optional = false, consume) {
    await this.directory(dirname(path));
    await this.stable();
    let before;
    try {
      before = await this.io.lstat(path, { bigint: true });
    } catch (e) {
      if (!optional || !absent(e)) throw e;
      this.missing.add(path);
      this.manifest.set(`missing:${path}`, "absent");
      return null;
    }
    if (!regular(before) || (await this.io.realpath(path)) !== path)
      refuse("path_denied");
    if (before.size > BigInt(cap)) refuse("too_large");
    const handle = await this.io.open(
      path,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    this.handles.push(handle);
    const held = await handle.stat({ bigint: true });
    if (!regular(held) || signature(before) !== signature(held))
      refuse("metadata_changed");
    const digest = createHash("sha256");
    let offset = 0;
    const chunks = [];
    while (offset < Number(held.size)) {
      this.ctx.check();
      await this.stable();
      const buffer = Buffer.alloc(
        Math.min(this.ctx.limits.copyChunkBytes, Number(held.size) - offset),
      );
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
      if (!bytesRead || bytesRead > buffer.length) refuse("metadata_changed");
      const chunk = buffer.subarray(0, bytesRead);
      digest.update(chunk);
      if (consume) await consume(chunk, offset);
      else chunks.push(chunk);
      offset += bytesRead;
    }
    const extra = Buffer.alloc(1);
    if ((await handle.read(extra, 0, 1, offset)).bytesRead)
      refuse("metadata_changed");
    const final = signature(await handle.stat({ bigint: true }));
    if (
      final !== signature(held) ||
      signature(await this.io.lstat(path, { bigint: true })) !== final
    )
      refuse("metadata_changed");
    this.files.set(path, { handle, sig: final, mode: Number(held.mode) });
    this.manifest.set(`file:${path}`, [final, digest.digest("hex")]);
    await this.stable();
    return consume ? offset : Buffer.concat(chunks, offset);
  }
  async requireMissing(path, reason = "metadata_changed") {
    // Do not open in-progress Git state. ENOTDIR is an error, not absence.
    try {
      await this.directory(dirname(path));
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
    }
    await this.stable();
    try {
      await this.io.lstat(path);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      this.missing.add(path);
      this.manifest.set(`missing:${path}`, "absent");
      await this.stable();
      return;
    }
    refuse(reason);
  }
  async list(path) {
    await this.directory(path);
    await this.stable();
    const names = (await this.io.readdir(path)).sort();
    if (names.length > this.ctx.limits.objectFiles) refuse("too_large");
    this.listings.set(path, JSON.stringify(names));
    this.manifest.set(`listing:${path}`, hash(JSON.stringify(names)));
    await this.stable();
    return names;
  }
  async verify() {
    await this.stable();
    for (const [path, e] of this.files) {
      this.ctx.check();
      if (
        signature(await e.handle.stat({ bigint: true })) !== e.sig ||
        signature(await this.io.lstat(path, { bigint: true })) !== e.sig
      )
        refuse("metadata_changed");
    }
    for (const [path, names] of this.listings)
      if (JSON.stringify((await this.io.readdir(path)).sort()) !== names)
        refuse("metadata_changed");
    for (const path of this.missing) {
      try {
        await this.io.lstat(path);
      } catch (e) {
        if (absent(e)) continue;
        throw e;
      }
      refuse("metadata_changed");
    }
    await this.stable();
  }
  digest() {
    return hash(
      JSON.stringify([...this.manifest].sort(([a], [b]) => a.localeCompare(b))),
    );
  }
  authorityManifest(layout) {
    const roots = [layout.root, layout.gitDirectory, layout.commonDirectory];
    const belongs = (path) => roots.some((root) => inside(root, path));
    return {
      directories: [...this.dirs]
        .filter(
          ([path]) => belongs(path) || roots.some((root) => inside(path, root)),
        )
        .map(([path, e]) => {
          const [dev, ino] = e.id.split(":");
          return { path, dev, ino };
        }),
      files: [...this.files]
        .filter(([path]) => belongs(path))
        .map(([path, e]) => ({
          path,
          signature: e.sig,
          digest: this.manifest.get(`file:${path}`)[1],
        })),
      listings: [...this.listings]
        .filter(([path]) => belongs(path))
        .map(([path, names]) => ({ path, names: JSON.parse(names) })),
      missing: [...this.missing].filter(belongs),
    };
  }
  async close() {
    let error;
    for (const h of this.handles.toReversed()) {
      try {
        await h.close();
      } catch (e) {
        error ??= e;
      }
    }
    if (error) throw error;
  }
}

async function trustedExecutable(io) {
  const parts = GIT.split("/").filter(Boolean);
  let path = "/";
  const records = [];
  for (const part of ["", ...parts]) {
    if (part) path = join(path, part);
    const s = await io.lstat(path, { bigint: true });
    if (
      s.uid !== 0n ||
      (s.mode & 0o022n) !== 0n ||
      s.isSymbolicLink() ||
      (path === GIT ? !regular(s) : !s.isDirectory())
    )
      refuse("git_unavailable");
    records.push([path, signature(s)]);
  }
  const h = await io.open(GIT, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const before = await h.stat({ bigint: true });
    const digest = createHash("sha256");
    const b = Buffer.alloc(1048576);
    let offset = 0;
    for (;;) {
      const { bytesRead } = await h.read(b, 0, b.length, offset);
      if (!bytesRead) break;
      digest.update(b.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (
      signature(before) !== signature(await h.stat({ bigint: true })) ||
      signature(before) !== records.at(-1)[1]
    )
      refuse("git_unavailable");
    return hash(JSON.stringify([records, digest.digest("hex")]));
  } finally {
    await h.close();
  }
}

async function removeOwnedNamespace(io, path, expected) {
  const named = await io.lstat(path, { bigint: true });
  if (
    !named.isDirectory() ||
    named.isSymbolicLink() ||
    identity(named) !== expected ||
    (await io.realpath(path)) !== path
  )
    refuse("process_unverified");
  await io.rm(path, { recursive: true, force: false });
}

function cleanEnvironment(home) {
  return {
    HOME: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    TMPDIR: home,
    PATH: dirname(GIT),
    LC_ALL: "C",
    LANG: "C",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_SYSTEM: "/dev/null",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_OPTIONAL_LOCKS: "0",
    GIT_NO_REPLACE_OBJECTS: "1",
    GIT_NO_LAZY_FETCH: "1",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    GIT_LITERAL_PATHSPECS: "1",
  };
}
const PATCH_FLAGS = [
  "--no-ext-diff",
  "--no-textconv",
  "--no-renames",
  "--ignore-submodules=all",
  "--no-color",
  "--src-prefix=a/",
  "--dst-prefix=b/",
  "--unified=3",
];
// Only this module assembles argv. No caller-provided command/revision expression.
function command(ctx, kind, args) {
  const prefix = [`--git-dir=${ctx.git}`, `--work-tree=${ctx.worktree}`];
  if (kind.startsWith("branch-")) {
    if (!ctx.branchRestore) refuse("read_failed");
    if (["branch-create", "branch-select", "branch-format"].includes(kind)) {
      if (args.length !== 1 || !validGitCommitBranch(args[0]))
        refuse("read_failed");
      const name = args[0].slice(11);
      if (kind === "branch-format")
        return [...prefix, "check-ref-format", "--branch", name];
      if (kind === "branch-create")
        return [...prefix, "branch", "--", name, "HEAD"];
      return [...prefix, "switch", "--no-overwrite-ignore", "--", name];
    }
    if (kind === "branch-object") {
      if (
        args.length !== 2 ||
        !["blob", "tree", "commit"].includes(args[0]) ||
        !validGitOid(args[1])
      )
        refuse("read_failed");
      return [...prefix, "cat-file", args[0], args[1]];
    }
    if (kind === "branch-restore") {
      if (
        args.length !== 2 ||
        !["index", "head"].includes(args[0]) ||
        !Array.isArray(args[1]) ||
        !args[1].length ||
        args[1].some((p) => !validWorkspaceFilePath(p))
      )
        refuse("read_failed");
      return [
        ...prefix,
        "restore",
        ...(args[0] === "head" ? ["--source=HEAD"] : []),
        "--worktree",
        "--",
        ...args[1],
      ];
    }
    refuse("read_failed");
  }
  switch (kind) {
    case "version":
      return ["--version"];
    case "config":
      return ["config", "--file", "-", "--no-includes", "--null", "--list"];
    case "status":
      return [
        ...prefix,
        "status",
        "--porcelain=v1",
        "-z",
        "--untracked-files=all",
        "--ignore-submodules=all",
        "--no-renames",
      ];
    case "candidates":
      return [
        ...prefix,
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
      ];
    case "attributes":
      return [...prefix, "check-attr", ...args, "--all", "-z", "--stdin"];
    case "tree":
      return [...prefix, "ls-tree", "-z", args[0], "--", args[1]];
    case "index-hash":
      return [
        ...prefix,
        "hash-object",
        "-w",
        `--path=${args[0]}`,
        "--",
        join(ctx.worktree, args[0]),
      ];
    case "commit-tree":
      return [...prefix, "write-tree"];
    case "commit-create":
      return [
        ...prefix,
        "commit-tree",
        "--no-gpg-sign",
        args[0],
        ...(args[1] ? ["-p", args[1]] : []),
      ];
    case "commit-author":
      return [...prefix, "var", "GIT_AUTHOR_IDENT"];
    case "commit-committer":
      return [...prefix, "var", "GIT_COMMITTER_IDENT"];
    case "commit-object":
      return [...prefix, "cat-file", args[0], args[1]];
    case "commit-reference":
      return [
        ...prefix,
        "update-ref",
        "-m",
        GIT_COMMIT_REFLOG_REASON,
        "HEAD",
        args[0],
        args[1],
      ];
    case "blob-size":
      return [...prefix, "cat-file", "-s", args[0]];
    case "blob":
      return [...prefix, "cat-file", "blob", args[0]];
    case "staged":
      return [
        ...prefix,
        "diff",
        ...PATCH_FLAGS,
        "--cached",
        ...(args[0] ? [args[0]] : []),
        "--",
        args[1],
      ];
    case "unstaged":
      return [...prefix, "diff", ...PATCH_FLAGS, "--", args[0]];
    case "base":
      return [...prefix, "diff", ...PATCH_FLAGS, args[0], "--", args[1]];
    default:
      refuse("read_failed");
  }
}

// Resolve only on close (or spawn failure), never on kill() success or a timer.
async function execute(
  ctx,
  kind,
  args = [],
  stdin = null,
  cap = ctx.limits.childStdoutBytes,
) {
  ctx.check();
  await ctx.sources.verify();
  if ((await trustedExecutable(ctx.io)) !== ctx.executable)
    refuse("git_unavailable");
  ctx.check();
  const argv = command(ctx, kind, args);
  const env = cleanEnvironment(ctx.home);
  if (kind.startsWith("commit-")) {
    const ident = ctx.commitIdentity;
    if (
      !ctx.commit ||
      !validGitCommitAuthor(ident?.author) ||
      !Number.isSafeInteger(ident.timestamp) ||
      ident.timestamp < 0
    )
      refuse("identity_changed");
    Object.assign(env, {
      GIT_AUTHOR_NAME: ident.author.name,
      GIT_AUTHOR_EMAIL: ident.author.email,
      GIT_COMMITTER_NAME: ident.author.name,
      GIT_COMMITTER_EMAIL: ident.author.email,
      GIT_AUTHOR_DATE: `@${ident.timestamp} +0000`,
      GIT_COMMITTER_DATE: `@${ident.timestamp} +0000`,
    });
  }
  if (["branch-create", "branch-select"].includes(kind)) {
    const ident = ctx.branchIdentity;
    if (
      !ctx.branchRestore ||
      !validGitCommitAuthor(ident?.author) ||
      !Number.isSafeInteger(ident.timestamp) ||
      ident.timestamp < 0
    )
      refuse("identity_changed");
    Object.assign(env, {
      GIT_AUTHOR_NAME: ident.author.name,
      GIT_AUTHOR_EMAIL: ident.author.email,
      GIT_COMMITTER_NAME: ident.author.name,
      GIT_COMMITTER_EMAIL: ident.author.email,
      GIT_AUTHOR_DATE: `@${ident.timestamp} +0000`,
      GIT_COMMITTER_DATE: `@${ident.timestamp} +0000`,
    });
  }
  let child;
  try {
    child = ctx.spawn(GIT, argv, {
      // hash-object resolves --path attributes against its cwd, unlike the
      // checked read commands. Use only the app-owned copied worktree.
      cwd: kind === "index-hash" ? ctx.worktree : ctx.home,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch {
    refuse("read_failed");
  }
  ctx.children.add(child);
  ctx.event({ type: "spawn", kind, phase: ctx.phase, pid: child.pid ?? null });
  let output = [],
    size = 0,
    stderrSize = 0,
    stopped,
    closed = false,
    killTimer,
    exitTimer;
  let resolveClose;
  const settlement = new Promise((r) => {
    resolveClose = r;
  });
  const stop = (error) => {
    if (stopped || closed) return;
    stopped = error;
    ctx.event({
      type: "signal",
      kind,
      signal: "SIGTERM",
      pid: child.pid ?? null,
    });
    try {
      child.kill("SIGTERM");
    } catch {
      /* Exit remains unproved. */
    }
    killTimer = setTimeout(() => {
      ctx.event({
        type: "signal",
        kind,
        signal: "SIGKILL",
        pid: child.pid ?? null,
      });
      try {
        child.kill("SIGKILL");
      } catch {
        /* Keep namespace. */
      }
    }, ctx.limits.termMs);
    exitTimer = setTimeout(
      () => resolveClose({ unverified: true }),
      ctx.limits.exitMs,
    );
  };
  ctx.stopChildren.set(child, stop);
  child.stdout.on("data", (chunk) => {
    size += chunk.length;
    ctx.stdout += chunk.length;
    if (size > cap || ctx.stdout > ctx.limits.stdoutBytes) {
      output = [];
      stop(new Refusal("too_large"));
    } else if (!stopped) output.push(chunk);
  });
  child.stderr.on("data", (chunk) => {
    stderrSize += chunk.length;
    ctx.stderr += chunk.length;
    // Private parser diagnostics, URLs and headers never leave this callback.
    if (
      stderrSize > ctx.limits.stderrBytes ||
      ctx.stderr > ctx.limits.stderrBytes
    )
      stop(new Refusal("too_large"));
  });
  child.once("error", () => {
    stop(new Refusal("read_failed"));
  });
  child.once("close", (code, signal) => {
    closed = true;
    clearTimeout(killTimer);
    clearTimeout(exitTimer);
    ctx.children.delete(child);
    ctx.stopChildren.delete(child);
    ctx.event({
      type: "exit",
      kind,
      phase: ctx.phase,
      code,
      signal,
      pid: child.pid ?? null,
    });
    resolveClose({ code, signal });
  });
  child.stdin.on("error", () => {
    /* EPIPE is adjudicated by exact child exit. */
  });
  const timeout = setTimeout(
    () =>
      stop(
        Object.assign(new Error("READ_TIMEOUT"), { appCode: "READ_TIMEOUT" }),
      ),
    Math.min(ctx.limits.childMs, Math.max(1, ctx.deadline - ctx.now())),
  );
  const abort = () =>
    stop(Object.assign(new Error("STALE_EPOCH"), { appCode: "STALE_EPOCH" }));
  ctx.controller.signal.addEventListener("abort", abort, { once: true });
  if (ctx.controller.signal.aborted) abort();
  child.stdin.end(stdin ?? undefined);
  const result = await settlement;
  clearTimeout(timeout);
  ctx.controller.signal.removeEventListener("abort", abort);
  if (result.unverified) {
    clearTimeout(killTimer);
    ctx.unverified = true;
    // Exit timer never proves closure. Keep exact child handle and namespace.
    refuse("process_unverified");
  }
  if ((await trustedExecutable(ctx.io)) !== ctx.executable)
    refuse("git_unavailable");
  if (stopped) throw stopped;
  await ctx.sources.verify();
  ctx.check();
  if (
    result.signal !== null ||
    !(
      result.code === 0 ||
      (["pair", "addition"].includes(kind) && result.code === 1)
    )
  )
    refuse(kind === "config" ? "unsupported_configuration" : "read_failed");
  return Buffer.concat(output, size);
}

function interpretConfig(bytes) {
  const values = new Map();
  for (const item of decode(bytes, "unsupported_configuration")
    .split("\0")
    .slice(0, -1)) {
    const at = item.indexOf("\n");
    const key = (at < 0 ? item : item.slice(0, at)).toLowerCase();
    const value = at < 0 ? "true" : item.slice(at + 1);
    if (!key || values.has(key)) refuse("unsupported_configuration");
    values.set(key, value);
  }
  if (bytes.length && bytes.at(-1) !== 0) refuse("unsupported_configuration");
  return values;
}
const boolean = (v) => {
  if (["true", "yes", "on", "1"].includes(v.toLowerCase())) return "true";
  if (["false", "no", "off", "0", ""].includes(v.toLowerCase())) return "false";
  refuse("unsupported_configuration");
};
function minimalConfig(values, root, gitDirectory, commit = false) {
  const objectFormat = values.get("extensions.objectformat") ?? "sha1";
  const version = values.get("core.repositoryformatversion") ?? "0";
  if (
    !["0", "1"].includes(version) ||
    !["sha1", "sha256"].includes(objectFormat) ||
    (objectFormat === "sha256" && version !== "1")
  )
    refuse("unsupported_repository");
  const out = [
    "[core]",
    `repositoryformatversion = ${objectFormat === "sha256" ? 1 : 0}`,
    "bare = false",
    "hooksPath = /dev/null",
    "fsmonitor = false",
    "attributesFile = /dev/null",
    "autocrlf = false",
    "eol = lf",
  ];
  for (const [key, value] of values) {
    if (
      /^(include\.|includeif\.|filter\.|merge\.)/.test(key) ||
      /^diff\.[^.]+\./.test(key) ||
      [
        "core.excludesfile",
        "core.attributesfile",
        "core.sparsecheckout",
        "core.sparsecheckoutcone",
        "extensions.partialclone",
        "extensions.refstorage",
      ].includes(key) ||
      /^remote\..*\.promisor$/.test(key)
    )
      refuse("unsupported_configuration");
    if (
      key.startsWith("extensions.") &&
      !["extensions.objectformat", "extensions.worktreeconfig"].includes(key)
    )
      refuse("unsupported_repository");
    if (key === "core.bare" && boolean(value) !== "false")
      refuse("unsupported_repository");
    if (key === "core.autocrlf" && boolean(value) !== "false")
      refuse("unsupported_configuration");
    if (key === "core.eol" && !["lf", "native"].includes(value))
      refuse("unsupported_configuration");
    if (key === "core.worktree" && resolve(gitDirectory, value) !== root)
      refuse("not_repository_root");
  }
  for (const [key, fallback] of [
    ["filemode", "true"],
    ["ignorecase", "false"],
    ["precomposeunicode", "false"],
    ["symlinks", "true"],
  ])
    out.push(
      `${key} = ${values.has(`core.${key}`) ? boolean(values.get(`core.${key}`)) : fallback}`,
    );
  let logPolicy = "true";
  if (commit) {
    if (values.has("core.logallrefupdates")) {
      const value = values.get("core.logallrefupdates");
      logPolicy = value === "always" ? "always" : boolean(value);
    }
    out.push(`logAllRefUpdates = ${logPolicy}`);
  }
  out.push("[gc]", "auto = 0", "[maintenance]", "auto = false");
  if (objectFormat === "sha256")
    out.push("[extensions]", "objectFormat = sha256");
  return {
    objectFormat,
    logPolicy,
    fileMode:
      !values.has("core.filemode") ||
      boolean(values.get("core.filemode")) === "true",
    config: out.join("\n") + "\n",
  };
}

function inspectIndex(bytes, format, limits) {
  if (!bytes) return { bytes: null, entries: [] };
  const oidBytes = format === "sha1" ? 20 : 32;
  if (
    bytes.length < 12 + oidBytes ||
    bytes.toString("ascii", 0, 4) !== "DIRC" ||
    ![2, 3].includes(bytes.readUInt32BE(4))
  )
    refuse("unsupported_repository");
  const expected = createHash(format)
    .update(bytes.subarray(0, -oidBytes))
    .digest();
  if (!expected.equals(bytes.subarray(-oidBytes)))
    refuse("unsupported_repository");
  const count = bytes.readUInt32BE(8);
  if (count > limits.candidates * 3) refuse("too_large");
  let at = 12;
  const entries = [];
  for (let n = 0; n < count; n++) {
    const start = at;
    if (at + 42 + oidBytes > bytes.length - oidBytes)
      refuse("unsupported_repository");
    const mode = bytes.readUInt32BE(at + 24);
    const oid = bytes.subarray(at + 40, at + 40 + oidBytes).toString("hex");
    const flags = bytes.readUInt16BE(at + 40 + oidBytes);
    if (flags & 0x8000) refuse("unsupported_repository");
    at += 42 + oidBytes;
    if (flags & 0x4000) {
      if (bytes.readUInt32BE(4) !== 3 || at + 2 > bytes.length - oidBytes)
        refuse("unsupported_repository");
      const extended = bytes.readUInt16BE(at);
      at += 2;
      if (extended !== 0) refuse("unsupported_repository");
    }
    const end = bytes.indexOf(0, at);
    if (end < at || end >= bytes.length - oidBytes)
      refuse("unsupported_repository");
    const path = decode(bytes.subarray(at, end));
    if (!validWorkspaceFilePath(path) || path.split("/").includes(".git"))
      refuse("unsupported_repository");
    if (![0o100644, 0o100755, 0o120000].includes(mode))
      refuse("unsupported_repository");
    at = start + Math.ceil((end + 1 - start) / 8) * 8;
    if (at > bytes.length - oidBytes) refuse("unsupported_repository");
    entries.push({ path, mode, oid, stage: (flags >> 12) & 3 });
  }
  const endEntries = at;
  while (at < bytes.length - oidBytes) {
    if (at + 8 > bytes.length - oidBytes) refuse("unsupported_repository");
    const ext = bytes.toString("ascii", at, at + 4);
    const size = bytes.readUInt32BE(at + 4);
    if (
      !/^[A-Z][A-Za-z0-9]{3}$/.test(ext) ||
      ["link", "sdir"].includes(ext) ||
      at + 8 + size > bytes.length - oidBytes
    )
      refuse("unsupported_repository");
    at += 8 + size;
  }
  const body = bytes.subarray(0, endEntries);
  return {
    entries,
    bytes: Buffer.concat([body, createHash(format).update(body).digest()]),
  };
}

function comparisonIndex(entries, format) {
  const oidBytes = format === "sha1" ? 20 : 32;
  const header = Buffer.alloc(12);
  header.write("DIRC");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(entries.length, 8);
  const records = [...entries]
    .sort(
      (a, b) =>
        Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)) ||
        a.stage - b.stage,
    )
    .map((e) => {
      const name = Buffer.from(e.path + "\0");
      const record = Buffer.alloc(
        Math.ceil((42 + oidBytes + name.length) / 8) * 8,
      );
      record.writeUInt32BE(e.mode, 24);
      Buffer.from(e.oid, "hex").copy(record, 40);
      record.writeUInt16BE(
        (e.stage << 12) | Math.min(name.length - 1, 0xfff),
        40 + oidBytes,
      );
      name.copy(record, 42 + oidBytes);
      return record;
    });
  // Zero stat cache forces real content rehash of the copied worktree.
  const body = Buffer.concat([header, ...records]);
  return Buffer.concat([body, createHash(format).update(body).digest()]);
}
async function writeComparisonIndex(ctx, entries, format, initial = false) {
  const bytes = comparisonIndex(entries, format);
  if (
    bytes.length > ctx.limits.indexBytes ||
    ctx.copyBytes + bytes.length > ctx.limits.objectBytes
  )
    refuse("too_large");
  if (initial && ++ctx.copyFiles > ctx.limits.objectFiles) refuse("too_large");
  ctx.copyBytes += bytes.length;
  await ctx.io.writeFile(join(ctx.git, "index"), bytes, {
    mode: 0o600,
    flag: initial ? "wx" : "w",
  });
}
async function emptyBlob(ctx, format) {
  const body = Buffer.from("blob 0\0"),
    oid = createHash(format).update(body).digest("hex"),
    bytes = deflateSync(body);
  const folder = join(ctx.git, "objects", oid.slice(0, 2)),
    target = join(folder, oid.slice(2));
  await ctx.io.mkdir(folder, { recursive: true, mode: 0o700 });
  try {
    await ctx.io.lstat(target);
  } catch (e) {
    if (!absent(e)) throw e;
    if (
      ++ctx.copyFiles > ctx.limits.objectFiles ||
      ctx.copyBytes + bytes.length > ctx.limits.objectBytes
    )
      refuse("too_large");
    ctx.copyBytes += bytes.length;
    await ctx.io.writeFile(target, bytes, { mode: 0o600, flag: "wx" });
  }
  return { oid, mode: 0o100644, stage: 0 };
}

// Before touching registered workspace metadata, prove the installed builtins
// on generated, known-byte SHA1/SHA256 inputs inside this owned namespace.
async function capabilityPreflight(ctx) {
  const savedGit = ctx.git,
    savedWorktree = ctx.worktree,
    savedIdentity = ctx.commitIdentity,
    savedBranchIdentity = ctx.branchIdentity;
  try {
    for (const format of ["sha1", "sha256"]) {
      const home = join(ctx.home, `capability-${format}`);
      await ctx.io.mkdir(home, { mode: 0o700 });
      ctx.git = join(home, "git");
      ctx.worktree = join(home, "worktree");
      for (const p of [
        ctx.git,
        ctx.worktree,
        join(ctx.git, "objects"),
        join(ctx.git, "refs"),
        join(ctx.git, "refs/heads"),
      ])
        await ctx.io.mkdir(p, { mode: 0o700 });
      await ctx.io.writeFile(
        join(ctx.git, "config"),
        `[core]\nrepositoryformatversion = ${format === "sha1" ? 0 : 1}\nbare = false\nfsmonitor = false\nhooksPath = /dev/null\nattributesFile = /dev/null\nautocrlf = false\n[gc]\nauto = 0\n${format === "sha256" ? "[extensions]\nobjectFormat = sha256\n" : ""}`,
        { mode: 0o600, flag: "wx" },
      );
      const object = async (type, content) => {
        const body = Buffer.concat([
          Buffer.from(`${type} ${content.length}\0`),
          content,
        ]);
        const oid = createHash(format).update(body).digest("hex"),
          bytes = deflateSync(body);
        if (
          ++ctx.copyFiles > ctx.limits.objectFiles ||
          ctx.copyBytes + bytes.length > ctx.limits.objectBytes
        )
          refuse("too_large");
        ctx.copyBytes += bytes.length;
        const folder = join(ctx.git, "objects", oid.slice(0, 2));
        await ctx.io.mkdir(folder, { recursive: true, mode: 0o700 });
        await ctx.io.writeFile(join(folder, oid.slice(2)), bytes, {
          mode: 0o600,
          flag: "wx",
        });
        return oid;
      };
      const old = await object("blob", Buffer.from("old\n"));
      const tree = await object(
        "tree",
        Buffer.concat([
          Buffer.from("100644 probe.txt\0"),
          Buffer.from(old, "hex"),
        ]),
      );
      const tip = await object(
        "commit",
        Buffer.from(
          `tree ${tree}\nauthor Synthetic <synthetic@example.invalid> 1 +0000\ncommitter Synthetic <synthetic@example.invalid> 1 +0000\n\ncapability\n`,
        ),
      );
      await ctx.io.writeFile(join(ctx.git, "HEAD"), "ref: refs/heads/main\n", {
        mode: 0o600,
        flag: "wx",
      });
      await ctx.io.writeFile(join(ctx.git, "refs/heads/main"), tip + "\n", {
        mode: 0o600,
        flag: "wx",
      });
      await writeComparisonIndex(
        ctx,
        [{ path: "probe.txt", mode: 0o100644, oid: old, stage: 0 }],
        format,
        true,
      );
      await ctx.io.writeFile(join(ctx.worktree, "probe.txt"), "new\n", {
        mode: 0o600,
        flag: "wx",
      });
      ctx.copyFiles++;
      ctx.copyBytes += 4;
      const expect = (b, text) => {
        if (decode(b) !== text) refuse("git_unavailable");
      };
      // The include target exists but must not be read by the stdin builtin.
      const include = join(home, "included");
      await ctx.io.writeFile(include, "[omoc_capability]\nforbidden = true\n", {
        mode: 0o600,
        flag: "wx",
      });
      const parsed = interpretConfig(
        await execute(
          ctx,
          "config",
          [],
          Buffer.from(`[include]\npath = ${include}\n[core]\nbare = false\n`),
        ),
      );
      if (
        parsed.get("core.bare") !== "false" ||
        parsed.has("omoc_capability.forbidden")
      )
        refuse("git_unavailable");
      parsed.clear();
      expect(await execute(ctx, "candidates"), "probe.txt\0");
      expect(
        await execute(ctx, "attributes", [], Buffer.from("probe.txt\0")),
        "",
      );
      expect(
        await execute(
          ctx,
          "attributes",
          ["--cached"],
          Buffer.from("probe.txt\0"),
        ),
        "",
      );
      expect(
        await execute(
          ctx,
          "attributes",
          [`--source=${tip}`],
          Buffer.from("probe.txt\0"),
        ),
        "",
      );
      expect(
        await execute(ctx, "tree", [tip, "probe.txt"]),
        `100644 blob ${old}\tprobe.txt\0`,
      );
      expect(await execute(ctx, "blob-size", [old]), "4\n");
      expect(await execute(ctx, "blob", [old]), "old\n");
      expect(await execute(ctx, "status"), " M probe.txt\0");
      for (const [kind, args] of [
        ["unstaged", ["probe.txt"]],
        ["base", [tip, "probe.txt"]],
      ]) {
        if (!decode(await execute(ctx, kind, args)).includes("-old\n+new\n"))
          refuse("git_unavailable");
      }
      expect(await execute(ctx, "staged", [tip, "probe.txt"]), "");
      if (ctx.commit) {
        ctx.commitIdentity = {
          author: { name: "Synthetic", email: "synthetic@example.invalid" },
          timestamp: 2,
        };
        const ident = "Synthetic <synthetic@example.invalid> 2 +0000";
        expect(await execute(ctx, "commit-author"), ident + "\n");
        expect(await execute(ctx, "commit-committer"), ident + "\n");
        expect(await execute(ctx, "commit-tree"), tree + "\n");
        const message = Buffer.from("capability commit\r\n"),
          body = Buffer.concat([
            Buffer.from(
              `tree ${tree}\nparent ${tip}\nauthor ${ident}\ncommitter ${ident}\n\n`,
            ),
            message,
          ]);
        const next = createHash(format)
          .update(Buffer.from(`commit ${body.length}\0`))
          .update(body)
          .digest("hex");
        expect(
          await execute(ctx, "commit-create", [tree, tip], message),
          next + "\n",
        );
        if (
          !(await execute(ctx, "commit-object", ["commit", next])).equals(body)
        )
          refuse("git_unavailable");
        expect(await execute(ctx, "commit-reference", [next, tip]), "");
        const line = Buffer.from(
          `${tip} ${next} ${ident}\t${GIT_COMMIT_REFLOG_REASON}\n`,
        );
        for (const name of ["logs/HEAD", "logs/refs/heads/main"])
          if (!(await ctx.io.readFile(join(ctx.git, name))).equals(line))
            refuse("git_unavailable");
      }
      if (ctx.branchRestore) {
        ctx.branchIdentity = {
          author: { name: "Synthetic", email: "synthetic@example.invalid" },
          timestamp: 2,
        };
        expect(await execute(ctx, "branch-object", ["blob", old]), "old\n");
        expect(
          await execute(ctx, "branch-restore", ["index", ["probe.txt"]]),
          "",
        );
        expect(await ctx.io.readFile(join(ctx.worktree, "probe.txt")), "old\n");
        await ctx.io.writeFile(join(ctx.worktree, "probe.txt"), "new\n");
        expect(
          await execute(ctx, "branch-restore", ["head", ["probe.txt"]]),
          "",
        );
        expect(await ctx.io.readFile(join(ctx.worktree, "probe.txt")), "old\n");
        expect(
          await execute(ctx, "branch-format", ["refs/heads/capability-target"]),
          "capability-target\n",
        );
        expect(
          await execute(ctx, "branch-create", ["refs/heads/capability-target"]),
          "",
        );
        expect(
          await ctx.io.readFile(join(ctx.git, "refs/heads/capability-target")),
          tip + "\n",
        );
        expect(
          await ctx.io.readFile(
            join(ctx.git, "logs/refs/heads/capability-target"),
          ),
          `${"0".repeat(tip.length)} ${tip} Synthetic <synthetic@example.invalid> 2 +0000\tbranch: Created from HEAD\n`,
        );
        expect(
          await execute(ctx, "branch-select", ["refs/heads/capability-target"]),
          "",
        );
        expect(
          await ctx.io.readFile(join(ctx.git, "HEAD")),
          "ref: refs/heads/capability-target\n",
        );
        expect(
          await ctx.io.readFile(join(ctx.git, "logs/HEAD")),
          `${tip} ${tip} Synthetic <synthetic@example.invalid> 2 +0000\tcheckout: moving from main to capability-target\n`,
        );
      }
    }
  } catch (e) {
    if (
      e instanceof Refusal &&
      !["too_large", "process_unverified", "git_unavailable"].includes(
        e.message,
      )
    )
      refuse("git_unavailable");
    throw e;
  } finally {
    ctx.git = savedGit;
    ctx.worktree = savedWorktree;
    ctx.commitIdentity = savedIdentity;
    ctx.branchIdentity = savedBranchIdentity;
  }
}

async function snapshotLayout(ctx, workspace) {
  const s = ctx.sources,
    root = workspace.path;
  await s.directory(root);
  let gitDirectory = join(root, ".git");
  let marker;
  try {
    marker = await ctx.io.lstat(gitDirectory, { bigint: true });
  } catch (e) {
    if (absent(e)) refuse("not_repository");
    throw e;
  }
  if (regular(marker)) {
    const text = decode(await s.read(gitDirectory, ctx.limits.metadataBytes));
    if (!/^gitdir: [^\r\n\0]+\n?$/.test(text)) refuse("unsupported_repository");
    gitDirectory = resolve(root, text.slice(8).trimEnd());
  } else if (!marker.isDirectory() || marker.isSymbolicLink())
    refuse("path_denied");
  await s.directory(gitDirectory);
  const commondir = await s.read(
    join(gitDirectory, "commondir"),
    ctx.limits.metadataBytes,
    true,
  );
  const commonDirectory = commondir
    ? resolve(gitDirectory, decode(commondir).trimEnd())
    : gitDirectory;
  await s.directory(commonDirectory);
  // Raw Git metadata must never enter the copied current-source tree.
  for (const metadataRoot of [gitDirectory, commonDirectory]) {
    if (
      inside(metadataRoot, root) ||
      (inside(root, metadataRoot) && !inside(join(root, ".git"), metadataRoot))
    )
      refuse("unsupported_repository");
  }
  if (commondir) {
    if (
      dirname(dirname(gitDirectory)) !== commonDirectory ||
      dirname(gitDirectory) !== join(commonDirectory, "worktrees")
    )
      refuse("unsupported_repository");
    const back = await s.read(
      join(gitDirectory, "gitdir"),
      ctx.limits.metadataBytes,
    );
    if (resolve(gitDirectory, decode(back).trimEnd()) !== join(root, ".git"))
      refuse("not_repository_root");
  }
  return { root, gitDirectory, commonDirectory };
}

async function snapshot(ctx) {
  const s = ctx.sources;
  const { root, gitDirectory, commonDirectory } = ctx.layout;
  let metadata = 0;
  const meta = async (path, optional = true) => {
    const b = await s.read(path, ctx.limits.metadataBytes - metadata, optional);
    metadata += b?.length ?? 0;
    return b;
  };
  for (const path of [
    join(commonDirectory, "shallow"),
    join(commonDirectory, "info/grafts"),
    join(commonDirectory, "objects/info/alternates"),
    join(commonDirectory, "objects/info/http-alternates"),
  ]) {
    // Missing parents are valid absence; existing parents are checked first.
    try {
      const b = await meta(path);
      if (b !== null) refuse("unsupported_repository");
    } catch (e) {
      if (!absent(e)) throw e;
    }
  }
  const raw = await meta(join(commonDirectory, "config"), false);
  let values = interpretConfig(await execute(ctx, "config", [], raw));
  const local = await meta(join(gitDirectory, "config.worktree"));
  if (local) {
    if (
      !values.has("extensions.worktreeconfig") ||
      boolean(values.get("extensions.worktreeconfig")) !== "true"
    )
      refuse("unsupported_configuration");
    const extra = interpretConfig(await execute(ctx, "config", [], local));
    values = new Map([...values, ...extra]);
  }
  const semantics = minimalConfig(
    values,
    root,
    gitDirectory,
    ctx.commit || ctx.branchRestore,
  );
  values.clear();
  await ctx.io.mkdir(ctx.git, { mode: 0o700 });
  await ctx.io.mkdir(join(ctx.git, "objects"), { mode: 0o700 });
  await ctx.io.mkdir(join(ctx.git, "refs"), { mode: 0o700 });
  await ctx.io.mkdir(join(ctx.git, "info"), { mode: 0o700 });
  await ctx.io.writeFile(join(ctx.git, "config"), semantics.config, {
    mode: 0o600,
    flag: "wx",
  });
  const format = semantics.objectFormat;
  const index = inspectIndex(
    await s.read(join(gitDirectory, "index"), ctx.limits.indexBytes, true),
    format,
    ctx.limits,
  );
  if (index.bytes) await writeComparisonIndex(ctx, index.entries, format, true);
  const headBytes = await meta(join(gitDirectory, "HEAD"), false);
  const headText = decode(headBytes).trimEnd();
  let branch = null,
    head = null;
  if (headText.startsWith("ref: refs/heads/")) {
    branch = headText.slice(16);
    if (!validGitBranch(branch)) refuse("unsupported_repository");
  } else if (validGitOid(headText, format)) head = headText;
  else refuse("unsupported_repository");
  const refs = new Map();
  let refCount = 0;
  const packed = await meta(join(commonDirectory, "packed-refs"));
  if (packed)
    for (const line of decode(packed).split("\n")) {
      if (!line || line.startsWith("#")) continue;
      if (line.startsWith("^")) {
        if (!validGitOid(line.slice(1), format))
          refuse("unsupported_repository");
        continue;
      }
      const [oid, name, extra] = line.split(" ");
      if (
        extra !== undefined ||
        !validGitOid(oid, format) ||
        !/^refs\/(heads|tags|remotes)\//.test(name) ||
        !validGitBranch(name.slice(5))
      )
        refuse("unsupported_repository");
      if (++refCount > ctx.limits.refs) refuse("too_large");
      refs.set(name, oid);
    }
  async function copyRefs(path, prefix = "refs", depth = 0) {
    if (depth > ctx.limits.refDepth) refuse("too_large");
    for (const name of await s.list(path)) {
      if (
        !validGitBranch(name) ||
        (prefix === "refs" && !["heads", "tags", "remotes"].includes(name))
      )
        refuse("unsupported_repository");
      const target = join(path, name),
        key = `${prefix}/${name}`;
      const st = await ctx.io.lstat(target, { bigint: true });
      if (st.isDirectory() && !st.isSymbolicLink())
        await copyRefs(target, key, depth + 1);
      else {
        if (++refCount > ctx.limits.refs) refuse("too_large");
        const oid = decode(await meta(target, false)).trimEnd();
        if (!validGitOid(oid, format)) refuse("unsupported_repository");
        refs.set(key, oid);
      }
    }
  }
  await copyRefs(join(commonDirectory, "refs"));
  const branches = [...refs]
    .filter(([name]) => name.startsWith("refs/heads/"))
    .map(([name, oid]) => ({ name: name.slice(11), oid }))
    .sort((a, b) => a.name.localeCompare(b.name));
  if (branches.length > ctx.limits.branches) refuse("too_large");
  if (branch) head = refs.get(`refs/heads/${branch}`) ?? null;
  for (const [name, oid] of refs) {
    await ctx.io.mkdir(dirname(join(ctx.git, name)), {
      recursive: true,
      mode: 0o700,
    });
    await ctx.io.writeFile(join(ctx.git, name), oid + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  }
  await ctx.io.writeFile(join(ctx.git, "HEAD"), headBytes, {
    mode: 0o600,
    flag: "wx",
  });
  for (const name of ["exclude", "attributes"]) {
    const path = join(commonDirectory, "info", name);
    let b;
    try {
      b = await meta(path);
    } catch (e) {
      if (!absent(e)) throw e;
    }
    if (b)
      await ctx.io.writeFile(join(ctx.git, "info", name), b, {
        flag: "wx",
        mode: 0o600,
      });
  }

  const objects = join(commonDirectory, "objects");
  for (const name of await s.list(objects)) {
    if (name === "info") {
      if ((await s.list(join(objects, name))).length)
        refuse("unsupported_repository");
      continue;
    }
    if (name !== "pack" && !/^[a-f0-9]{2}$/.test(name))
      refuse("unsupported_repository");
    const folder = join(objects, name),
      names = await s.list(folder);
    if (name === "pack")
      for (const leaf of names) {
        if (
          !new RegExp(
            `^pack-[a-f0-9]{${format === "sha1" ? 40 : 64}}\\.(pack|idx|rev)$`,
          ).test(leaf) ||
          !names.includes(leaf.replace(/\.[^.]+$/, ".pack")) ||
          !names.includes(leaf.replace(/\.[^.]+$/, ".idx"))
        )
          refuse("unsupported_repository");
      }
    await ctx.io.mkdir(join(ctx.git, "objects", name), { mode: 0o700 });
    for (const leaf of names) {
      if (
        name !== "pack" &&
        !new RegExp(`^[a-f0-9]{${format === "sha1" ? 38 : 62}}$`).test(leaf)
      )
        refuse("unsupported_repository");
      if (++ctx.copyFiles > ctx.limits.objectFiles) refuse("too_large");
      const output = await ctx.io.open(
        join(ctx.git, "objects", name, leaf),
        "wx",
        0o600,
      );
      try {
        ctx.copyBytes += await s.read(
          join(folder, leaf),
          ctx.limits.objectBytes - ctx.copyBytes,
          false,
          async (chunk, offset) => {
            let at = 0;
            while (at < chunk.length) {
              const r = await output.write(
                chunk,
                at,
                chunk.length - at,
                offset + at,
              );
              if (!r.bytesWritten) refuse("read_failed");
              at += r.bytesWritten;
            }
          },
        );
      } finally {
        await output.close();
      }
    }
  }
  // Complete bounded private tree, including ignored/protected ordinary files.
  // Top-level metadata was proven disjoint BEFORE any current-source copy.
  await ctx.io.mkdir(ctx.worktree, { mode: 0o700 });
  let walked = 0;
  async function worktree(path, rel = "", depth = 0) {
    if (depth > ctx.limits.refDepth) refuse("too_large");
    const names = await s.list(path);
    if (
      walked +
        names.filter((name) => name.toLowerCase() !== ".git" || rel).length >
      ctx.limits.candidates
    )
      refuse("too_large");
    for (const name of names) {
      if (name.toLowerCase() === ".git") {
        if (!rel) continue;
        refuse("unsupported_repository");
      }
      if (++walked > ctx.limits.candidates) refuse("too_large");
      const child = rel ? `${rel}/${name}` : name;
      if (!validWorkspaceFilePath(child)) refuse("unsupported_repository");
      const target = join(path, name),
        outputPath = join(ctx.worktree, child);
      const st = await ctx.io.lstat(target, { bigint: true });
      if (st.isDirectory() && !st.isSymbolicLink()) {
        await ctx.io.mkdir(outputPath, { mode: 0o700 });
        await worktree(target, child, depth + 1);
      } else {
        if (!regular(st)) refuse("path_denied");
        if (++ctx.copyFiles > ctx.limits.objectFiles) refuse("too_large");
        const output = await ctx.io.open(outputPath, "wx", 0o600);
        try {
          ctx.copyBytes += await s.read(
            target,
            ctx.limits.objectBytes - ctx.copyBytes,
            false,
            async (chunk, offset) => {
              let at = 0;
              while (at < chunk.length) {
                const r = await output.write(
                  chunk,
                  at,
                  chunk.length - at,
                  offset + at,
                );
                if (!r.bytesWritten) refuse("read_failed");
                at += r.bytesWritten;
              }
            },
          );
          await output.chmod(0o600 | (s.files.get(target).mode & 0o100));
        } finally {
          await output.close();
        }
      }
    }
  }
  await worktree(root);
  await s.verify();
  const repository = {
    worktreePath: root,
    gitDirectory,
    commonDirectory,
    objectFormat: format,
    head,
    branch,
  };
  await s.verify();
  return {
    repository,
    branches,
    index: index.entries,
    fileMode: semantics.fileMode,
    logPolicy: semantics.logPolicy,
  };
}

const states = {
  " ": "none",
  A: "added",
  M: "modified",
  D: "deleted",
  T: "type_changed",
  U: "unmerged",
};
function statusRows(bytes, limits) {
  if (bytes.length && bytes.at(-1) !== 0) refuse("read_failed");
  const rows = [];
  for (const line of decode(bytes).split("\0").slice(0, -1)) {
    if (
      line.length < 4 ||
      line[2] !== " " ||
      !validWorkspaceFilePath(line.slice(3))
    )
      refuse("unsupported_repository");
    const [x, y] = line;
    const path = line.slice(3);
    if (x === "?" && y === "?")
      rows.push({ path, index: "none", worktree: "none", kind: "untracked" });
    else {
      const conflict = ["DD", "AU", "UD", "UA", "DU", "AA", "UU"].includes(
        x + y,
      );
      if (!conflict && (states[x] === undefined || states[y] === undefined))
        refuse("unsupported_repository");
      rows.push({
        path,
        index: conflict ? "unmerged" : states[x],
        worktree: conflict ? "unmerged" : states[y],
        kind: conflict ? "conflict" : "tracked",
      });
    }
    if (rows.length > limits.files) refuse("too_large");
  }
  return rows.sort((a, b) => a.path.localeCompare(b.path));
}
async function checkedAttributes(ctx, paths, args = []) {
  if (!paths.length) return new Map();
  const result = await execute(
    ctx,
    "attributes",
    args,
    Buffer.from(paths.join("\0") + "\0"),
  );
  const fields = decode(result, "unsupported_configuration").split("\0");
  if (fields.pop() !== "" || fields.length % 3)
    refuse("unsupported_configuration");
  const candidates = new Set(paths);
  const identities = new Map(paths.map((path) => [path, false]));
  for (let i = 0; i < fields.length; i += 3) {
    const [path, attribute, value] = fields.slice(i, i + 3);
    if (!candidates.has(path)) refuse("unsupported_configuration");
    if (value === "unspecified") continue;
    if (attribute === "ident" && ["set", "unset"].includes(value))
      identities.set(path, value === "set");
    if (attribute === "text" && ["set", "unset", "auto"].includes(value))
      continue;
    if (attribute === "eol" && value === "lf") continue;
    if (
      ["ident", "binary", "diff"].includes(attribute) &&
      ["set", "unset"].includes(value)
    )
      continue;
    // Even unknown/macro conversions are refused rather than guessed.
    refuse("unsupported_configuration");
  }
  return identities;
}
async function observe(ctx) {
  const snap = await snapshot(ctx);
  const paths = decode(await execute(ctx, "candidates")).split("\0");
  if (paths.pop() !== "") refuse("read_failed");
  const candidates = [...new Set(paths)];
  if (candidates.length > ctx.limits.candidates) refuse("too_large");
  if (candidates.some((p) => !validWorkspaceFilePath(p)))
    refuse("unsupported_repository");
  await checkedAttributes(ctx, candidates);
  await checkedAttributes(ctx, candidates, ["--cached"]);
  if (snap.repository.head)
    await checkedAttributes(ctx, candidates, [
      `--source=${snap.repository.head}`,
    ]);
  const files = statusRows(await execute(ctx, "status"), ctx.limits);
  await ctx.sources.verify();
  // Per-file content digest of status-listed files, reusing the digests the
  // snapshot already took of every worktree file (regular files only, no
  // symlinks, bounded by the snapshot's own file/byte caps). Plan files are
  // excluded: plan edits are tracked by planSha.
  const contentDigest = hash(
    JSON.stringify(
      files
        .filter((f) => !f.path.startsWith(".omoc/plans/"))
        .map((f) => [
          f.path,
          ctx.sources.manifest.get(
            `file:${join(ctx.layout.root, f.path)}`,
          )?.[1] ?? "absent",
        ]),
    ),
  );
  return {
    ...snap,
    files,
    contentDigest,
    fingerprint: ctx.sources.digest(),
  };
}

async function treeEntry(ctx, oid, path) {
  if (!oid) return null;
  const b = await execute(ctx, "tree", [oid, path]);
  if (!b.length) return null;
  const text = decode(b);
  const match = /^(100644|100755|120000) blob ([a-f0-9]+)\t([^\0]+)\0$/.exec(
    text,
  );
  if (!match || match[3] !== path || !validGitOid(match[2]))
    refuse("path_denied");
  return { mode: Number.parseInt(match[1], 8), oid: match[2], path };
}
async function blob(ctx, entry) {
  if (!entry) return Buffer.alloc(0);
  if (![0o100644, 0o100755].includes(entry.mode)) refuse("path_denied");
  const size = decode(await execute(ctx, "blob-size", [entry.oid])).trim();
  if (!/^\d+$/.test(size)) refuse("read_failed");
  if (Number(size) > ctx.limits.sourceBytes) refuse("too_large");
  const bytes = await execute(
    ctx,
    "blob",
    [entry.oid],
    null,
    ctx.limits.sourceBytes + 1,
  );
  if (bytes.length !== Number(size)) refuse("read_failed");
  if (!workspaceFileContentFits(decode(bytes, "binary"))) refuse("binary");
  return bytes;
}

export {
  Sources,
  Refusal,
  refuse,
  hash,
  identity,
  signature,
  regular,
  absent,
  inside,
  data,
  decode,
  trustedExecutable,
  removeOwnedNamespace,
  execute,
  capabilityPreflight,
  snapshotLayout,
  observe,
  treeEntry,
  checkedAttributes,
  statusRows,
  comparisonIndex,
  blob,
  emptyBlob,
  writeComparisonIndex,
  inspectIndex,
};
