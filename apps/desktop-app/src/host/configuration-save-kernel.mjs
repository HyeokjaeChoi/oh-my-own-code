import { openDarwinDescriptorFFI } from "./darwin-descriptor-ffi.mjs";
// Private, descriptor-only Darwin adapter. Importing this module does no IO.
import * as fs from "node:fs";
import { join, isAbsolute, normalize } from "node:path";
import { randomBytes } from "node:crypto";
import {
  isWorkspaceRootGuard,
  assertWorkspaceRootGuard,
} from "./workspace-root-authority.mjs";
import { performance } from "node:perf_hooks";
import {
  configurationFileVersion,
  configurationBackupId,
  configurationSkillDirectoryVersion,
  configurationWorkspaceFileDirectoryVersion,
} from "./configuration-file-observation.mjs";
import {
  validSkillSourceName,
  skillFileContentFits,
  skillFileWriteFits,
} from "../renderer/shared/configuration-draft/skill.mjs";
import {
  validAgentSourceName,
  agentFileContentFits,
  agentFileWriteFits,
} from "../renderer/shared/configuration-draft/agent.mjs";
import { configurationFileWriteFits } from "../renderer/shared/configuration-draft/validation.mjs";

import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
  workspaceFileWriteFits,
  WORKSPACE_FILE_LIMITS,
} from "../renderer/shared/workspace-file/index.mjs";

// Metadata budgets stay fixed; only ordinary file content receives 64KiB.
const LIMIT = 32768;
const sourceFile = (kind) => ["skill", "agent"].includes(kind);
const chainBound = (kind) => sourceFile(kind) || kind === "file";
const HEX = /^[a-f0-9]{64}$/;
const key = (v, max = 128) =>
  typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`).test(v);
const closed = (v, required, optional = []) => {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(v);
  return (
    required.every((k) => keys.includes(k)) &&
    keys.every(
      (k) =>
        [...required, ...optional].includes(k) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
    )
  );
};
class KernelFailure extends Error {}
const refuse = (reason) => {
  throw new KernelFailure(reason);
};
const unknown = (e, task) => ({
  status: "unknown",
  reason:
    e instanceof KernelFailure
      ? e.message
      : chainBound(task?.request.kind) && ["EACCES", "EPERM"].includes(e?.code)
        ? "path_denied"
        : chainBound(task?.request.kind) &&
            ["ENOENT", "ENOTDIR"].includes(e?.code)
          ? "path_missing"
          : "io_failed",
});
const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
const sameFile = (a, b, renamed = false) =>
  identity(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  (renamed || a.ctimeNs === b.ctimeNs);
const sameMetadata = (a, b) =>
  a.mode === b.mode &&
  a.entries.length === b.entries.length &&
  a.entries.every(
    ([name, value], i) =>
      name.equals(b.entries[i][0]) && value.equals(b.entries[i][1]),
  );

export async function createConfigurationSaveKernel(options = {}) {
  let check, checkRoot, timeoutMs;
  try {
    if (!closed(options, [], ["check", "checkRoot", "timeoutMs"]))
      refuse("invalid_request");
    // Read own descriptors rather than executing a Proxy's get trap.
    const data = Object.fromEntries(
      Reflect.ownKeys(options).map((k) => [
        k,
        Object.getOwnPropertyDescriptor(options, k).value,
      ]),
    );
    ({ check = () => {}, checkRoot, timeoutMs = 10000 } = data);
    if (
      typeof check !== "function" ||
      (Object.hasOwn(data, "checkRoot") && !isWorkspaceRootGuard(checkRoot)) ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > 10000
    )
      refuse("invalid_request");
  } catch {
    refuse("invalid_request");
  }
  if (
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    globalThis.Bun?.version !== "1.4.2" ||
    !["O_NOFOLLOW", "O_NONBLOCK", "O_DIRECTORY"].every(
      (k) => Number.isInteger(fs.constants[k]) && fs.constants[k] !== 0,
    )
  )
    refuse("unsupported_runtime");
  let library, ptr, toArrayBuffer;
  try {
    ({ library, ptr, toArrayBuffer } = await openDarwinDescriptorFFI());
  } catch {
    refuse("unsupported_runtime");
  }
  // Darwin public fcntl.h O_CLOEXEC; Node/Bun do not export this constant.
  const c = { ...fs.constants, O_CLOEXEC: 0x1000000 };
  const readFlags = c.O_RDONLY | c.O_NOFOLLOW | c.O_NONBLOCK | c.O_CLOEXEC;
  const native = library.symbols;
  // Allocate before syscalls: Bun FFI view creation can change native errno.
  const errnoCell = new Int32Array(toArrayBuffer(native.__error(), 0, 4));
  const errno = () => errnoCell[0];
  const cstring = (v) => Buffer.from(`${v}\0`);
  const stat = (fd) => fs.fstatSync(fd, { bigint: true });
  let active = null,
    last = null,
    stopped = false,
    entered = false;

  function release(task) {
    if (!task) return;
    clearTimeout(task.timer);
    let failed = false;
    for (const name of ["stageFD", "sourceFD", "rootFD"]) {
      const fd = task[name];
      task[name] = undefined;
      if (fd === undefined) continue;
      try {
        fs.closeSync(fd);
      } catch {
        failed = true;
      }
    }
    for (const entry of (task.chain ?? []).slice(1).toReversed()) {
      try {
        fs.closeSync(entry.fd);
      } catch {
        failed = true;
      }
    }
    task.chain = [];
    if (failed) refuse("io_failed");
  }
  function openAt(
    task,
    name,
    flags,
    mode = 0,
    parentFD = task.parentFD ?? task.rootFD,
  ) {
    const nb = cstring(name);
    const fd = native.openat(parentFD, ptr(nb), flags, 0, 0, 0, 0, 0, mode);
    return { fd, error: fd < 0 ? errno() : 0 };
  }
  function chainIdentity(task) {
    return task.chain.map((entry) => [
      entry.path,
      String(entry.stat.dev),
      String(entry.stat.ino),
    ]);
  }
  function assertRoot(task) {
    const held = stat(task.rootFD);
    if (!held.isDirectory() || !identity(task.root, held))
      refuse("file_changed");
    assertWorkspaceRootGuard(
      checkRoot,
      Object.freeze({
        workspaceId: task.request.workspaceId,
        workspacePath: task.request.workspacePath,
        dev: String(held.dev),
        ino: String(held.ino),
      }),
    );
  }

  function rootStable(task) {
    try {
      if (checkRoot) {
        check();
        // Read factory-owned state directly after the last reentrant check.
        // No caller-supplied root callback runs before descriptor/path checks.
        assertRoot(task);
      }
      for (const entry of task.chain) {
        const named = fs.lstatSync(entry.path, { bigint: true });
        const held = stat(entry.fd);
        if (
          !named.isDirectory() ||
          !held.isDirectory() ||
          named.isSymbolicLink() ||
          named.dev !== task.root.dev ||
          !identity(entry.stat, named) ||
          !identity(entry.stat, held) ||
          fs.realpathSync(entry.path) !== entry.path
        )
          refuse("file_changed");
      }
      return stat(task.rootFD);
    } catch (e) {
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes(e?.code))
        refuse("file_changed");
      throw e;
    }
  }
  function metadata(fd, s) {
    if (
      !s.isFile() ||
      s.nlink !== 1n ||
      s.uid !== BigInt(process.getuid()) ||
      s.gid !== BigInt(process.getgid()) ||
      (s.mode & 0o7111n) !== 0n
    )
      refuse("unsupported_metadata");
    const acl = native.acl_get_fd_np(fd, 0x100);
    const aclError = errno();
    if (acl) {
      native.acl_free(acl);
      refuse("unsupported_metadata");
    }
    if (aclError !== 2) refuse("unsupported_metadata");
    const attrs = Buffer.alloc(24),
      flags = Buffer.alloc(8);
    attrs.writeUInt16LE(5, 0);
    attrs.writeUInt32LE(0x40000, 4);
    if (
      native.fgetattrlist(fd, ptr(attrs), ptr(flags), 8, 0) !== 0 ||
      flags.readUInt32LE(0) !== 8 ||
      flags.readUInt32LE(4) !== 0
    )
      refuse("unsupported_metadata");

    // Fixed capacity even if an external writer grows attributes during a read.
    const names = Buffer.alloc(LIMIT);
    const count = Number(native.flistxattr(fd, ptr(names), LIMIT, 0));
    if (!Number.isInteger(count) || count < 0 || count > LIMIT)
      refuse("unsupported_metadata");
    const entries = [];
    let start = 0,
      total = count;
    for (let i = 0; i < count; i++) {
      if (names[i] !== 0) continue;
      if (i === start || entries.length === 32) refuse("unsupported_metadata");
      const name = Buffer.from(names.subarray(start, i + 1));
      start = i + 1;
      const value = Buffer.alloc(Math.max(1, LIMIT - total));
      const size = Number(
        native.fgetxattr(fd, ptr(name), ptr(value), value.length, 0, 0),
      );
      if (!Number.isInteger(size) || size < 0 || size > LIMIT - total)
        refuse("unsupported_metadata");
      total += size;
      entries.push([name, Buffer.from(value.subarray(0, size))]);
    }
    if (start !== count) refuse("unsupported_metadata");
    entries.sort((a, b) => Buffer.compare(a[0], b[0]));
    for (let i = 1; i < entries.length; i++)
      if (entries[i - 1][0].equals(entries[i][0]))
        refuse("unsupported_metadata");
    return { mode: Number(s.mode & 0o777n), entries };
  }
  function observe(fd, kind, staged = false) {
    const before = stat(fd);
    const meta = metadata(fd, before);
    const limit = kind === "file" ? WORKSPACE_FILE_LIMITS.bytes : LIMIT;
    if (before.size > BigInt(limit)) refuse("unsupported_content");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = fs.readSync(fd, buffer, length, buffer.length - length, length);
      if (!Number.isInteger(n) || n < 0 || n > buffer.length - length)
        refuse("io_failed");
      if (!n) break;
      length += n;
    }
    if (length > limit) refuse("unsupported_content");
    const bytes = Buffer.from(buffer.subarray(0, length));
    let text;
    try {
      text = new globalThis.TextDecoder("utf-8", {
        fatal: true,
        ignoreBOM: true,
      }).decode(bytes);
    } catch {
      refuse("unsupported_content");
    }
    if (
      !(kind === "file"
        ? workspaceFileWriteFits(text)
        : kind === "skill"
          ? staged
            ? skillFileWriteFits(text)
            : skillFileContentFits(text)
          : kind === "agent"
            ? staged
              ? agentFileWriteFits(text)
              : agentFileContentFits(text)
            : configurationFileWriteFits(kind, text))
    )
      refuse("unsupported_content");
    const afterMeta = metadata(fd, stat(fd));
    const after = stat(fd);
    if (
      !sameFile(before, after) ||
      BigInt(length) !== after.size ||
      !sameMetadata(meta, afterMeta)
    )
      refuse("file_changed");
    return { stat: after, bytes, meta };
  }
  function namedObservation(task, name) {
    const { fd } = openAt(task, name, readFlags);
    if (fd < 0) refuse("file_changed");
    try {
      return observe(fd, task.request.kind);
    } finally {
      fs.closeSync(fd);
    }
  }
  function matches(expected, actual, renamed = false) {
    if (
      !sameFile(expected.stat, actual.stat, renamed) ||
      !expected.bytes.equals(actual.bytes) ||
      !sameMetadata(expected.meta, actual.meta)
    )
      refuse("file_changed");
  }
  function missing(task) {
    const { fd, error } = openAt(task, task.target, readFlags);
    if (fd >= 0) {
      fs.closeSync(fd);
      refuse("file_changed");
    }
    if (error !== 2) refuse("file_changed");
  }
  function verify(task, published = false) {
    rootStable(task);
    matches(
      task.stage,
      observe(task.stageFD, task.request.kind, true),
      published,
    );
    matches(
      task.stage,
      namedObservation(task, published ? task.target : task.backup),
      published,
    );
    if (task.source) {
      matches(
        task.source,
        observe(task.sourceFD, task.request.kind),
        published,
      );
      matches(
        task.source,
        namedObservation(task, published ? task.backup : task.target),
        published,
      );
    } else if (!published) missing(task);
    rootStable(task);
  }
  function requestFits(r) {
    if (
      !closed(
        r,
        [
          "runtimeEpoch",
          "operationId",
          "workspaceId",
          "workspacePath",
          "kind",
          "text",
          "expectation",
        ],
        r?.kind === "file"
          ? ["version", "path", "directoryVersion"]
          : sourceFile(r?.kind)
            ? ["version", "sourceName", "directoryVersion"]
            : ["version"],
      )
    )
      return false;
    return (
      key(r.runtimeEpoch) &&
      key(r.operationId) &&
      key(r.workspaceId, 256) &&
      typeof r.workspacePath === "string" &&
      r.workspacePath.length <= 4096 &&
      isAbsolute(r.workspacePath) &&
      normalize(r.workspacePath) === r.workspacePath &&
      !Array.from(r.workspacePath).some((ch) => {
        const code = ch.charCodeAt(0);
        return code < 32 || (code >= 127 && code <= 159);
      }) &&
      ["instructions", "mcp", "skill", "agent", "file"].includes(r.kind) &&
      (r.kind === "file"
        ? key(r.workspaceId) &&
          validWorkspaceFileRoot(r.workspacePath) &&
          workspaceFilePathReason(r.path) === undefined &&
          workspaceFileWriteFits(r.text) &&
          r.expectation === "version" &&
          typeof r.directoryVersion === "string" &&
          HEX.test(r.directoryVersion)
        : sourceFile(r.kind)
          ? (r.kind === "skill" ? validSkillSourceName : validAgentSourceName)(
              r.sourceName,
            ) &&
            typeof r.directoryVersion === "string" &&
            HEX.test(r.directoryVersion) &&
            (r.kind === "skill" ? skillFileWriteFits : agentFileWriteFits)(
              r.text,
            )
          : configurationFileWriteFits(r.kind, r.text)) &&
      ((r.expectation === "missing" && !Object.hasOwn(r, "version")) ||
        (r.expectation === "version" &&
          typeof r.version === "string" &&
          HEX.test(r.version)))
    );
  }
  function admit() {
    if (stopped) refuse("closed");
    if (entered) refuse("busy");
  }
  function tokenTask(r) {
    if (
      !closed(r, ["token"]) ||
      typeof r.token !== "string" ||
      !HEX.test(r.token)
    )
      refuse("invalid_request");
    if (!active || active.token !== r.token)
      refuse(
        last?.token === r.token && last.reason === "expired"
          ? "expired"
          : "invalid_token",
      );
    const task = active;
    // Consume before any publication check/syscall. Keep only one terminal token.
    active = null;
    last = { token: task.token, reason: "invalid_token" };
    clearTimeout(task.timer);
    return task;
  }
  function prepare(request) {
    let task,
      response,
      acquired = false;
    try {
      admit();
      if (active) refuse("busy");
      if (
        !closed(
          request,
          [
            "runtimeEpoch",
            "operationId",
            "workspaceId",
            "workspacePath",
            "kind",
            "text",
            "expectation",
          ],
          ["version", "sourceName", "directoryVersion", "path"],
        )
      )
        refuse("invalid_request");
      request = Object.fromEntries(
        Reflect.ownKeys(request).map((k) => [
          k,
          Object.getOwnPropertyDescriptor(request, k).value,
        ]),
      );
      if (!requestFits(request)) refuse("invalid_request");
      entered = true;
      acquired = true;
      check();
      task = { request: { ...request } };
      task.target =
        request.kind === "file"
          ? request.path.split("/").at(-1)
          : request.kind === "skill"
            ? "SKILL.md"
            : request.kind === "agent"
              ? `${request.sourceName}.md`
              : request.kind === "instructions"
                ? "AGENTS.md"
                : "opencode.json";
      task.backup = configurationBackupId(
        request.runtimeEpoch,
        request.operationId,
        request.kind,
      );
      const root = fs.lstatSync(request.workspacePath, { bigint: true });
      if (
        !root.isDirectory() ||
        fs.realpathSync(request.workspacePath) !== request.workspacePath
      )
        refuse("path_denied");
      task.rootFD = fs.openSync(
        request.workspacePath,
        readFlags | c.O_DIRECTORY,
      );
      task.root = stat(task.rootFD);
      if (!identity(root, task.root)) refuse("file_changed");
      task.chain = [
        { path: request.workspacePath, stat: task.root, fd: task.rootFD },
      ];
      task.parentFD = task.rootFD;
      task.parentPath = request.workspacePath;
      rootStable(task);
      if (chainBound(request.kind)) {
        for (const component of request.kind === "file"
          ? request.path.split("/").slice(0, -1)
          : request.kind === "skill"
            ? [".opencode", "skills", request.sourceName]
            : [".opencode", "agents"]) {
          rootStable(task);
          const path = join(task.parentPath, component);
          let named;
          try {
            named = fs.lstatSync(path, { bigint: true });
          } catch (e) {
            if (["ENOENT", "ENOTDIR"].includes(e?.code)) refuse("path_missing");
            throw e;
          }
          if (
            !named.isDirectory() ||
            named.isSymbolicLink() ||
            named.dev !== task.root.dev ||
            fs.realpathSync(path) !== path
          )
            refuse("path_denied");
          const { fd, error } = openAt(
            task,
            component,
            readFlags | c.O_DIRECTORY,
          );
          if (fd < 0)
            refuse(
              error === 2 || error === 20 ? "file_changed" : "path_denied",
            );
          // Retain before any fstat/recheck so every failure closes the acquired FD.
          const entry = { path, stat: named, fd };
          task.chain.push(entry);
          const held = stat(fd);
          if (
            !held.isDirectory() ||
            !identity(named, held) ||
            held.dev !== task.root.dev
          )
            refuse("file_changed");
          task.parentFD = fd;
          task.parentPath = path;
          rootStable(task);
        }
        if (
          (request.kind === "file"
            ? configurationWorkspaceFileDirectoryVersion
            : configurationSkillDirectoryVersion)(
            request,
            chainIdentity(task),
          ) !== request.directoryVersion
        )
          refuse("file_changed");
      }
      if (request.expectation === "missing") missing(task);
      else {
        const { fd, error } = openAt(task, task.target, readFlags);
        if (fd < 0)
          refuse(
            request.kind === "file" && [2, 20].includes(error)
              ? "path_missing"
              : "path_denied",
          );
        task.sourceFD = fd;
        if (request.kind === "file" && stat(fd).dev !== task.root.dev)
          refuse("path_denied");
        task.source = observe(fd, request.kind);
        matches(task.source, namedObservation(task, task.target));
        const base = {
          ...request,
          path:
            task.request.kind === "file"
              ? task.request.path
              : join(task.parentPath, task.target),
        };
        // Reader uses the root observation BEFORE our own stage changes its times.
        if (
          configurationFileVersion(
            base,
            task.root,
            task.source.stat,
            task.source.bytes,
            chainBound(request.kind) ? chainIdentity(task) : undefined,
          ) !== request.version
        )
          refuse("file_changed");
      }
      const beforeStage = rootStable(task);
      if (
        beforeStage.mtimeNs !== task.root.mtimeNs ||
        beforeStage.ctimeNs !== task.root.ctimeNs
      )
        refuse("file_changed");
      check();
      if (checkRoot || chainBound(request.kind)) rootStable(task);
      if (request.kind === "file") {
        // DS-01: prove original write permission through the held parent before
        // creating any stage. No write, O_CREAT or O_TRUNC on the original.
        const { fd } = openAt(
          task,
          task.target,
          c.O_RDWR | c.O_NOFOLLOW | c.O_NONBLOCK | c.O_CLOEXEC,
        );
        if (fd < 0) refuse("path_denied");
        try {
          matches(task.source, observe(fd, request.kind));
          rootStable(task);
          matches(task.source, namedObservation(task, task.target));
        } finally {
          fs.closeSync(fd);
        }
        rootStable(task);
      }
      const created = openAt(
        task,
        task.backup,
        c.O_RDWR |
          c.O_CREAT |
          c.O_EXCL |
          c.O_NOFOLLOW |
          c.O_NONBLOCK |
          c.O_CLOEXEC,
        0o600,
      );
      if (created.fd < 0)
        refuse(created.error === 17 ? "stage_collision" : "io_failed");
      task.stageFD = created.fd;
      if ((stat(task.stageFD).mode & 0o7777n) !== 0o600n)
        refuse("unsupported_metadata");
      const inherited = metadata(task.stageFD, stat(task.stageFD));
      const bytes = Buffer.from(request.text, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        const n = fs.writeSync(
          task.stageFD,
          bytes,
          offset,
          bytes.length - offset,
          offset,
        );
        if (!Number.isInteger(n) || n <= 0 || n > bytes.length - offset)
          refuse("io_failed");
        offset += n;
      }
      if (task.source) {
        // Only known, bounded, opaque entries on the held stage FD are removed.
        for (const [name] of inherited.entries)
          if (native.fremovexattr(task.stageFD, ptr(name), 0) !== 0)
            refuse("unsupported_metadata");
        for (const [name, value] of task.source.meta.entries) {
          const data = value.length ? value : Buffer.alloc(1);
          if (
            native.fsetxattr(
              task.stageFD,
              ptr(name),
              ptr(data),
              value.length,
              0,
              0,
            ) !== 0
          )
            refuse("unsupported_metadata");
        }
      }
      fs.fchmodSync(task.stageFD, task.source?.meta.mode ?? 0o600);
      task.stage = observe(task.stageFD, request.kind, true);
      if (
        !task.stage.bytes.equals(bytes) ||
        (task.source && !sameMetadata(task.stage.meta, task.source.meta))
      )
        refuse("file_changed");
      fs.fsyncSync(task.stageFD);
      fs.fsyncSync(task.parentFD);
      verify(task);
      check();
      if (checkRoot) rootStable(task);
      task.token = randomBytes(32).toString("hex");
      task.deadline = performance.now() + timeoutMs;
      task.timer = setTimeout(() => {
        if (active !== task) return;
        active = null;
        last = { token: task.token, reason: "expired" };
        try {
          release(task);
        } catch {
          last.reason = "io_failed";
        }
      }, timeoutMs);
      // The parent owns lifetime; this timer must not keep an abandoned process alive.
      task.timer.unref();
      active = task;
      response = { status: "staged", token: task.token };
    } catch (e) {
      response = unknown(e, task);
    } finally {
      if (task && active !== task) {
        try {
          release(task);
        } catch (e) {
          response = unknown(e, task);
        }
      }
      if (acquired) entered = false;
    }
    return response;
  }
  function publish(request) {
    let task, response;
    try {
      admit();
      task = tokenTask(request);
      entered = true;
      if (performance.now() >= task.deadline) {
        last.reason = "expired";
        refuse("expired");
      }
      check();
      verify(task);
      check();
      if (performance.now() >= task.deadline) {
        last.reason = "expired";
        refuse("expired");
      }
      if (checkRoot || chainBound(task.request.kind)) rootStable(task);
      const from = cstring(task.backup),
        to = cstring(task.target);
      if (
        native.renameatx_np(
          task.parentFD,
          ptr(from),
          task.parentFD,
          ptr(to),
          task.source ? 2 : 4,
        ) !== 0
      )
        refuse(errno() === 17 ? "file_changed" : "io_failed");
      fs.fsyncSync(task.stageFD);
      fs.fsyncSync(task.parentFD);
      verify(task, true);
      check();
      verify(task, true);
      const finalRoot = rootStable(task);
      const finalFile = observe(task.stageFD, task.request.kind, true);
      matches(task.stage, finalFile, true);
      matches(finalFile, namedObservation(task, task.target));
      const endRoot = rootStable(task);
      if (
        endRoot.mtimeNs !== finalRoot.mtimeNs ||
        endRoot.ctimeNs !== finalRoot.ctimeNs
      )
        refuse("file_changed");
      const base = {
        ...task.request,
        path:
          task.request.kind === "file"
            ? task.request.path
            : join(task.parentPath, task.target),
      };
      response = {
        status: "saved",
        version: configurationFileVersion(
          base,
          finalRoot,
          finalFile.stat,
          finalFile.bytes,
          chainBound(task.request.kind) ? chainIdentity(task) : undefined,
        ),
        ...(task.source ? { backupId: task.backup } : {}),
      };
    } catch (e) {
      response = unknown(e, task);
    } finally {
      try {
        release(task);
      } catch (e) {
        response = unknown(e, task);
      }
      if (task) entered = false;
    }
    return response;
  }
  function abort(request) {
    let task, response;
    try {
      admit();
      task = tokenTask(request);
      if (performance.now() >= task.deadline) {
        last.reason = "expired";
        refuse("expired");
      }
      response = { status: "aborted" };
    } catch (e) {
      response = unknown(e, task);
    } finally {
      try {
        release(task);
      } catch (e) {
        response = unknown(e, task);
      }
    }
    return response;
  }
  function close() {
    if (stopped) return;
    // Guard against a reentrant Host check callback closing live descriptors.
    if (entered) refuse("busy");
    stopped = true;
    const task = active;
    active = null;
    let failed = false;
    try {
      release(task);
    } catch {
      failed = true;
    }
    try {
      library.close();
    } catch {
      failed = true;
    }
    if (failed) refuse("io_failed");
  }
  return Object.freeze({ prepare, publish, abort, close });
}
