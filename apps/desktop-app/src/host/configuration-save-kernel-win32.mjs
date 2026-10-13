// Windows save kernel for workspace files and configuration sources. Same
// request/response contract as the darwin descriptor kernel in
// configuration-save-kernel.mjs; this one has no openat / fd-relative rename /
// RENAME_SWAP / xattr / ACL primitives, so:
//
//  * identity: every directory component and file is proven by lstat -> open ->
//    fstat -> lstat comparison (dev/ino/size/mtime/ctime) and realpath equality;
//    symlinks and junctions (lstat reports both as symbolic links) are refused;
//  * stage: created exclusively (O_CREAT|O_EXCL) next to the target as
//    `.omoc-configuration-<hash>.<kind>.backup`;
//  * publish replaces the target atomically without a window where it is absent:
//      existing target:  stage -> hold (link+unlink)  ;  link(target, backup)  ;
//                        rename(hold, target)  [MoveFileEx replace]
//      missing target:   link(stage, target) (fails if it appeared)  ;  unlink(stage)
//    leaving the ORIGINAL content at the backup name, exactly like the darwin swap;
//  * metadata: a read-only original is refused (path_denied); alternate data
//    streams, explicit ACEs and file attributes cannot be read from Node and are
//    NOT carried over to the new file (documented trade-off, see
//    docs/engineering/windows-verification.md). Content, line endings and the
//    mtime-bound version protocol are unchanged.
// The one residual race is the instant between the final identity check of the
// target and the replacing rename (no compare-and-swap rename exists on NTFS); a
// concurrent writer in that instant loses its change, but the replaced content is
// kept at the backup name and the verification afterwards fails closed.
import * as nodeFs from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { performance } from "node:perf_hooks";
import { assertWorkspaceRootGuard } from "./workspace-root-authority.mjs";
import {
  configurationFileVersion,
  configurationBackupId,
  configurationSkillDirectoryVersion,
  configurationWorkspaceFileDirectoryVersion,
} from "./configuration-file-observation.mjs";
import {
  skillFileContentFits,
  skillFileWriteFits,
} from "../renderer/shared/configuration-draft/skill.mjs";
import {
  agentFileContentFits,
  agentFileWriteFits,
} from "../renderer/shared/configuration-draft/agent.mjs";
import { configurationFileWriteFits } from "../renderer/shared/configuration-draft/validation.mjs";
import {
  workspaceFileWriteFits,
  WORKSPACE_FILE_LIMITS,
} from "../renderer/shared/workspace-file/index.mjs";
import {
  HEX,
  LIMIT,
  chainBound,
  closed,
  identity,
  refuse,
  requestFits,
  sameFile,
  sameMetadata,
  unknown,
} from "./configuration-save-shared.mjs";
import { isWindowsShortAlias } from "../platform-paths.mjs";

const TRANSIENT = new Set(["EPERM", "EBUSY", "EACCES"]);

export function createWin32ConfigurationSaveKernel(
  { check, checkRoot, timeoutMs },
  io = nodeFs,
) {
  const C = io.constants;
  const stat = (fd) => io.fstatSync(fd, { bigint: true });
  const lstat = (path) => io.lstatSync(path, { bigint: true });
  let active = null,
    last = null,
    stopped = false,
    entered = false;

  // Bounded retry for antivirus/indexer sharing violations on rename/link/unlink.
  function retry(action) {
    for (let attempt = 1; ; attempt++) {
      try {
        return action();
      } catch (e) {
        if (attempt >= 5 || !TRANSIENT.has(e?.code)) throw e;
        const until = Date.now() + 20 * attempt;
        while (Date.now() < until);
      }
    }
  }
  function release(task) {
    if (!task) return;
    clearTimeout(task.timer);
    let failed = false;
    for (const name of ["stageFD", "sourceFD"]) {
      const fd = task[name];
      task[name] = undefined;
      if (fd === undefined) continue;
      try {
        io.closeSync(fd);
      } catch {
        failed = true;
      }
    }
    task.chain = [];
    if (failed) refuse("io_failed");
  }
  // Open a regular, single-link, non-symlink file by name and prove the handle
  // is that same file (lstat before == fstat after open).
  function openChecked(task, path, flags) {
    const before = lstat(path);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n)
      refuse("file_changed");
    const fd = io.openSync(path, flags);
    try {
      const held = stat(fd);
      if (!sameFile(before, held) || held.dev !== task.root.dev)
        refuse("file_changed");
    } catch (e) {
      io.closeSync(fd);
      throw e;
    }
    return fd;
  }
  const at = (task, name) => join(task.parentPath, name);
  function chainIdentity(task) {
    return task.chain.map((entry) => [
      entry.path,
      String(entry.stat.dev),
      String(entry.stat.ino),
    ]);
  }
  function assertRoot(task) {
    const held = lstat(task.chain[0].path);
    if (
      !held.isDirectory() ||
      held.isSymbolicLink() ||
      !identity(task.root, held)
    )
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
        assertRoot(task);
      }
      for (const entry of task.chain) {
        const named = lstat(entry.path);
        if (
          !named.isDirectory() ||
          named.isSymbolicLink() ||
          named.dev !== task.root.dev ||
          !identity(entry.stat, named) ||
          io.realpathSync(entry.path) !== entry.path
        )
          refuse("file_changed");
      }
      return lstat(task.chain[0].path);
    } catch (e) {
      if (["ENOENT", "ENOTDIR", "ELOOP"].includes(e?.code))
        refuse("file_changed");
      throw e;
    }
  }
  function metadata(s) {
    // Mode is synthetic on Windows: only the read-only attribute is visible.
    if (!s.isFile() || s.nlink !== 1n || (s.mode & 0o200n) === 0n)
      refuse("unsupported_metadata");
    return { mode: Number(s.mode & 0o777n), entries: [] };
  }
  function observe(fd, kind, staged = false) {
    const before = stat(fd);
    const meta = metadata(before);
    const limit = kind === "file" ? WORKSPACE_FILE_LIMITS.bytes : LIMIT;
    if (before.size > BigInt(limit)) refuse("unsupported_content");
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const n = io.readSync(fd, buffer, length, buffer.length - length, length);
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
    const afterMeta = metadata(stat(fd));
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
    const fd = openChecked(task, at(task, name), C.O_RDONLY);
    try {
      return observe(fd, task.request.kind);
    } finally {
      io.closeSync(fd);
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
    try {
      lstat(at(task, task.target));
    } catch (e) {
      if (e?.code === "ENOENT") return;
      refuse("file_changed");
    }
    refuse("file_changed");
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
      // NTFS resolves 8.3 aliases and ignores trailing dots; the shared name
      // validator already refuses those, short aliases are refused here.
      if (
        request.kind === "file" &&
        request.path.split("/").some((part) => isWindowsShortAlias(part))
      )
        refuse("invalid_request");
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
      task.hold = `${task.backup}.swap`;
      const root = lstat(request.workspacePath);
      if (
        !root.isDirectory() ||
        root.isSymbolicLink() ||
        io.realpathSync(request.workspacePath) !== request.workspacePath
      )
        refuse("path_denied");
      task.root = root;
      task.chain = [{ path: request.workspacePath, stat: root }];
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
            named = lstat(path);
          } catch (e) {
            if (["ENOENT", "ENOTDIR"].includes(e?.code)) refuse("path_missing");
            throw e;
          }
          if (
            !named.isDirectory() ||
            named.isSymbolicLink() ||
            named.dev !== task.root.dev ||
            io.realpathSync(path) !== path
          )
            refuse("path_denied");
          task.chain.push({ path, stat: named });
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
        let fd;
        try {
          fd = openChecked(task, at(task, task.target), C.O_RDONLY);
        } catch (e) {
          if (e?.code === "ENOENT" || e?.code === "ENOTDIR")
            refuse(request.kind === "file" ? "path_missing" : "path_denied");
          if (TRANSIENT.has(e?.code)) refuse("path_denied");
          throw e;
        }
        task.sourceFD = fd;
        task.source = observe(fd, request.kind);
        matches(task.source, namedObservation(task, task.target));
        const base = {
          ...request,
          path:
            task.request.kind === "file"
              ? task.request.path
              : join(task.parentPath, task.target),
        };
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
        // Prove write permission on the original before creating any stage: a
        // read-only attribute or a sharing lock refuses here (EPERM/EBUSY).
        let fd;
        try {
          fd = io.openSync(at(task, task.target), C.O_RDWR);
        } catch {
          refuse("path_denied");
        }
        try {
          if (!sameFile(task.source.stat, stat(fd))) refuse("file_changed");
          matches(task.source, observe(fd, request.kind));
          rootStable(task);
          matches(task.source, namedObservation(task, task.target));
        } finally {
          io.closeSync(fd);
        }
        rootStable(task);
      }
      let stageFD;
      try {
        stageFD = io.openSync(
          at(task, task.backup),
          C.O_RDWR | C.O_CREAT | C.O_EXCL,
          0o600,
        );
      } catch (e) {
        refuse(e?.code === "EEXIST" ? "stage_collision" : "io_failed");
      }
      task.stageFD = stageFD;
      const bytes = Buffer.from(request.text, "utf8");
      let offset = 0;
      while (offset < bytes.length) {
        const n = io.writeSync(
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
      task.stage = observe(task.stageFD, request.kind, true);
      if (!task.stage.bytes.equals(bytes)) refuse("file_changed");
      // A new file on NTFS is writable; a source with another mode already refused.
      io.fsyncSync(task.stageFD);
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
  // The only mutation of the user's tree after staging. See the header comment.
  function replace(task) {
    const backup = at(task, task.backup);
    const target = at(task, task.target);
    if (!task.source) {
      // Exclusive publish: link fails with EEXIST if the target appeared.
      try {
        retry(() => io.linkSync(backup, target));
      } catch (e) {
        refuse(e?.code === "EEXIST" ? "file_changed" : "io_failed");
      }
      retry(() => io.unlinkSync(backup));
      return;
    }
    const hold = at(task, task.hold);
    // a) move the stage out of the backup name (exclusive: link fails if occupied)
    try {
      retry(() => io.linkSync(backup, hold));
    } catch (e) {
      refuse(e?.code === "EEXIST" ? "stage_collision" : "io_failed");
    }
    retry(() => io.unlinkSync(backup));
    try {
      // b) the original gets a second name: the backup
      try {
        retry(() => io.linkSync(target, backup));
      } catch (e) {
        refuse(e?.code === "EEXIST" ? "file_changed" : "io_failed");
      }
      const linked = lstat(backup);
      const current = lstat(target);
      if (
        !identity(linked, task.source.stat) ||
        !identity(current, task.source.stat)
      )
        refuse("file_changed");
      // c) replace the target with the stage in one rename
      retry(() => io.renameSync(hold, target));
    } catch (e) {
      // Leave every inode in place: put the stage back under its first name if free.
      try {
        io.linkSync(hold, backup);
        io.unlinkSync(hold);
      } catch {
        /* the held stage stays under its .swap name for recovery */
      }
      throw e;
    }
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
      replace(task);
      io.fsyncSync(task.stageFD);
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
    if (entered) refuse("busy");
    stopped = true;
    const task = active;
    active = null;
    try {
      release(task);
    } catch {
      refuse("io_failed");
    }
  }
  return Object.freeze({ prepare, publish, abort, close });
}
