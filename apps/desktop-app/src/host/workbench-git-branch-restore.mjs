// Branch/restore manager over the reader's single checked snapshot owner.
import { join, dirname, basename, isAbsolute, normalize } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fail } from "../workbench-contract.mjs";
import { validGitCommitBranch } from "../renderer/shared/git-commit/index.mjs";
import { validGitOid } from "../renderer/shared/git-review/index.mjs";
import { GIT_ABSENT_INDEX_DIGEST } from "../renderer/shared/git-index/index.mjs";
import {
  validWorkspaceFilePath,
  workspaceFilePathReason,
} from "../renderer/shared/workspace-file/index.mjs";
import {
  GIT_BRANCH_RESTORE_FEATURE,
  GIT_BRANCH_RESTORE_LIMITS as L,
  gitBranchRestoreMode,
  validateGitBranchRestoreRequest,
  gitBranchRestoreTargetFromApply,
  validateGitBranchRestorePreview,
  validateGitBranchRestoreMutationResult,
} from "../renderer/shared/git-branch-restore/index.mjs";
import {
  GIT_BRANCH_RESTORE_STATE_MARKERS,
  gitBranchRestoreBlob,
  gitBranchRestoreIdentityDigest,
  gitBranchRestoreOccupancyDigest,
  gitBranchRestoreExpectedBackups,
  validateGitBranchRestoreArtifactManifest,
  validateGitBranchRestoreKernelRequest,
  validateGitBranchRestoreKernelResult,
  GIT_BRANCH_RESTORE_KERNEL_LIMITS,
} from "./git-branch-restore-contract.mjs";
import {
  hash,
  decode,
  refuse,
  observe,
  execute,
  checkedAttributes,
  inspectIndex,
  comparisonIndex,
  statusRows,
} from "./workbench-git-snapshot.mjs";
const compare = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));
const entries = (xs) =>
  xs
    .map(({ path, mode, oid }) => ({ path, mode, oid }))
    .sort((a, b) => compare(a.path, b.path));
const sameEntry = (a, b) =>
  a === null || b === null ? a === b : a.mode === b.mode && a.oid === b.oid;
const sameState = (a, b) =>
  a === null || b === null
    ? a === b
    : a.mode === b.mode && a.bytes === b.bytes && a.digest === b.digest;
const unavailable = (w, reason) => ({
  workspaceId: w.id,
  workspacePath: w.path,
  status: "unavailable",
  reason,
});
const rawOid = (type, body, format) =>
  createHash(format)
    .update(Buffer.from(`${type} ${body.length}\0`))
    .update(body)
    .digest("hex");
export function createWorkbenchGitBranchRestoreManager(authority) {
  const { run, validateScope, now, limits, getObservation, retireWorkspace } =
      authority,
    previews = new Map();
  function scope(w, s) {
    validateScope(w, s);
    if (!Number.isSafeInteger(s.revision) || s.revision < 0)
      fail("INVALID_REQUEST");
    if (!s.trusted) fail("UNAVAILABLE");
  }
  function matches(p, w, s) {
    return (
      p.sender === s.sender &&
      p.epoch === s.runtimeEpoch &&
      p.workspaceId === w.id &&
      p.root === w.path &&
      p.trusted === s.trusted &&
      p.trustRevision === s.trustRevision
    );
  }
  function admitted(w, r, s) {
    scope(w, s);
    validateGitBranchRestoreRequest(r);
    if (
      !["git.branch.apply", "git.restore.apply"].includes(r.type) ||
      r.workspaceId !== w.id
    )
      fail("INVALID_REQUEST");
    const p = previews.get(r.previewId);
    if (
      !p ||
      !matches(p, w, s) ||
      p.revision !== s.revision ||
      p.used ||
      now() - p.created >= L.previewMs ||
      !isDeepStrictEqual(p.target, gitBranchRestoreTargetFromApply(r))
    )
      fail("FILE_CHANGED");
    return p;
  }
  async function originalBytes(ctx, path, cap = ctx.limits.indexBytes) {
    try {
      return await ctx.sources.read(path, cap, true);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await ctx.sources.requireMissing(path);
      return null;
    }
  }
  async function occupancy(ctx, branch) {
    const { sources: s, layout } = ctx,
      common = layout.commonDirectory,
      format = ctx.objectFormat;
    const rows = [];
    async function record(git, linked) {
      const head = await s.read(join(git, "HEAD"), ctx.limits.metadataBytes),
        text = decode(head).replace(/\n$/u, "");
      let symbolic = null;
      if (text.startsWith("ref: ") && validGitCommitBranch(text.slice(5)))
        symbolic = text.slice(5);
      else if (!validGitOid(text, format)) refuse("unsupported_repository");
      let gitdir = null,
        commondir = null,
        locked = null;
      if (linked) {
        await s.list(git);
        gitdir = await s.read(join(git, "gitdir"), ctx.limits.metadataBytes);
        commondir = await s.read(
          join(git, "commondir"),
          ctx.limits.metadataBytes,
        );
        const back = decode(gitdir).replace(/\n$/u, "");
        if (
          !isAbsolute(back) ||
          normalize(back) !== back ||
          !back.endsWith("/.git") ||
          /[\r\n\0]/u.test(back) ||
          decode(commondir) !== "../..\n"
        )
          refuse("unsupported_repository");
        locked = await originalBytes(
          ctx,
          join(git, "locked"),
          ctx.limits.metadataBytes,
        );
      }
      if (branch && git !== layout.gitDirectory && symbolic === branch)
        refuse("branch_occupied");
      rows.push([
        git,
        hash(head),
        gitdir === null ? null : hash(gitdir),
        commondir === null ? null : hash(commondir),
        locked === null ? null : hash(locked),
      ]);
    }
    await record(common, false);
    const folder = join(common, "worktrees");
    let names;
    try {
      names = await s.list(folder);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await s.requireMissing(folder);
      names = [];
    }
    if (names.length > L.treeEntries) refuse("too_large");
    for (const name of names) {
      if (!validWorkspaceFilePath(name) || name.includes("/"))
        refuse("unsupported_repository");
      await record(join(folder, name), true);
    }
    rows.sort((a, b) => compare(a[0], b[0]));
    return gitBranchRestoreOccupancyDigest(rows);
  }
  async function proposal(ctx, w, r, original, identity) {
    const observed = await observe(ctx, w);
    if (
      observed.fingerprint !== original.fingerprint ||
      ctx.executable !== original.executable
    ) {
      original.invalidated = true;
      refuse("stale_observation");
    }
    const { repository } = observed,
      s = ctx.sources,
      format = repository.objectFormat,
      git = ctx.layout.gitDirectory,
      common = ctx.layout.commonDirectory;
    ctx.objectFormat = format;
    const action = r.type.startsWith("git.restore.") ? "restore" : r.action;
    const branch = action === "restore" ? null : r.branch,
      source = action === "restore" ? r.source : null;
    if (!repository.head) refuse("unsupported_branch_restore");
    for (const name of GIT_BRANCH_RESTORE_STATE_MARKERS)
      await s.requireMissing(
        join(git, name),
        "unsupported_branch_restore_state",
      );
    const currentEntries = entries(observed.index);
    if (
      currentEntries.length > L.treeEntries ||
      observed.index.some(
        (e) => e.stage !== 0 || ![0o100644, 0o100755].includes(e.mode),
      ) ||
      new Set(currentEntries.map((e) => e.path)).size !== currentEntries.length
    )
      refuse("unsupported_branch_restore");
    const currentBranch = repository.branch
      ? `refs/heads/${repository.branch}`
      : null;
    // Packed refs require explicit absence proof for each loose lookup too.
    // The kernel must independently establish loose-ref precedence.
    for (const name of new Set([currentBranch, branch].filter(Boolean)))
      await originalBytes(ctx, join(common, name), ctx.limits.metadataBytes);
    if (action === "select" && branch === currentBranch) refuse("no_changes");
    if (action !== "restore") await execute(ctx, "branch-format", [branch]);
    const occupancyDigest = await occupancy(ctx, branch);
    let nextHeadOid = repository.head;
    if (action === "create") {
      const name = branch.slice(11).toLowerCase();
      if (
        observed.branches.some((b) => {
          const existing = b.name.toLowerCase();
          return (
            name === existing ||
            name.startsWith(existing + "/") ||
            existing.startsWith(name + "/")
          );
        })
      )
        refuse("branch_conflict");
    } else if (action === "select") {
      const selected = observed.branches.find(
        (b) => `refs/heads/${b.name}` === branch,
      );
      if (!selected) refuse("branch_conflict");
      nextHeadOid = selected.oid;
      if (
        observed.files.some(
          (row) =>
            row.kind !== "untracked" &&
            (row.index !== "none" || row.worktree !== "none"),
        )
      )
        refuse("conflict");
    }
    const objects = new Map();
    async function object(type, oid) {
      if (objects.has(oid)) {
        const prior = objects.get(oid);
        if (prior.type !== type) refuse("read_failed");
        return prior.raw;
      }
      const raw = await execute(
        ctx,
        "branch-object",
        [type, oid],
        null,
        ctx.limits.objectBytes,
      );
      if (rawOid(type, raw, format) !== oid) refuse("read_failed");
      objects.set(oid, { type, oid, raw });
      if (
        [...objects.values()].reduce((n, x) => n + x.raw.length, 0) >
        ctx.limits.objectBytes
      )
        refuse("too_large");
      return raw;
    }
    async function commitTree(oid) {
      const raw = await object("commit", oid),
        line = decode(raw).split("\n", 1)[0];
      if (!line.startsWith("tree ") || !validGitOid(line.slice(5), format))
        refuse("unsupported_branch_restore");
      return line.slice(5);
    }
    async function treeEntries(root) {
      const out = [],
        width = format === "sha1" ? 20 : 32;
      async function walk(oid, prefix = "", depth = 0) {
        if (depth > 32) refuse("too_large");
        const raw = await object("tree", oid);
        let at = 0;
        while (at < raw.length) {
          ctx.check();
          const end = raw.indexOf(0, at);
          if (end < 0 || end + 1 + width > raw.length) refuse("read_failed");
          const header = decode(raw.subarray(at, end)),
            space = header.indexOf(" "),
            mode = header.slice(0, space),
            name = header.slice(space + 1),
            next = raw.subarray(end + 1, end + 1 + width).toString("hex");
          if (space < 1 || name.includes("/") || !validWorkspaceFilePath(name))
            refuse("unsupported_branch_restore");
          const path = prefix ? `${prefix}/${name}` : name;
          if (
            !validWorkspaceFilePath(path) ||
            path.split("/").some((x) => x.toLowerCase() === ".git")
          )
            refuse("unsupported_branch_restore");
          if (mode === "40000") await walk(next, path, depth + 1);
          else if (["100644", "100755"].includes(mode)) {
            out.push({ path, mode: Number.parseInt(mode, 8), oid: next });
            if (out.length > L.treeEntries) refuse("too_large");
          } else refuse("unsupported_branch_restore");
          at = end + 1 + width;
        }
      }
      await walk(root);
      out.sort((a, b) => compare(a.path, b.path));
      if (new Set(out.map((e) => e.path)).size !== out.length)
        refuse("read_failed");
      return out;
    }
    const currentTreeOid = await commitTree(repository.head),
      currentTree = await treeEntries(currentTreeOid);
    const treeOid =
      action === "select" ? await commitTree(nextHeadOid) : currentTreeOid;
    const desiredEntries =
      action === "select"
        ? await treeEntries(treeOid)
        : action === "restore" && source === "head"
          ? currentTree
          : currentEntries;
    if (action === "select" && !isDeepStrictEqual(currentEntries, currentTree))
      refuse("conflict");
    const oldMap = new Map(currentEntries.map((x) => [x.path, x])),
      newMap = new Map(desiredEntries.map((x) => [x.path, x]));
    const candidates =
      action === "create"
        ? []
        : action === "restore"
          ? [...r.paths]
          : [...new Set([...oldMap.keys(), ...newMap.keys()])].sort(compare);
    if (action === "restore")
      for (const path of candidates) {
        if (
          source === "index"
            ? !oldMap.has(path)
            : !oldMap.has(path) && !newMap.has(path)
        )
          refuse("missing_file");
      }
    // The kernel proves original cleanliness, selected before/after entries and
    // attribute policy independently from raw objects, including unchanged files.
    const proofPaths = new Set(candidates);
    for (const collection of [currentEntries, currentTree, desiredEntries])
      for (const entry of collection) {
        ctx.check();
        if (
          proofPaths.has(entry.path) ||
          basename(entry.path) === ".gitattributes" ||
          (action === "select" && collection === currentEntries)
        )
          await object("blob", entry.oid);
      }
    // Any existing destination without original tracked authority is a collision,
    // even when Git would accept byte-equal ignored/untracked content.
    if (action === "select")
      for (const path of candidates)
        if (
          !oldMap.has(path) &&
          newMap.has(path) &&
          (await originalBytes(ctx, join(w.path, path), L.fileBytes)) !== null
        )
          refuse("conflict");
    const identityRecord =
      action === "restore"
        ? null
        : (identity ?? {
            author: globalThis.structuredClone(r.author),
            timestamp: Math.floor(Date.now() / 1000),
          });
    ctx.branchIdentity = identityRecord;
    const metaBuilt = [];
    const logRole =
      action === "create"
        ? "branch_log"
        : action === "select"
          ? "head_log"
          : null;
    if (logRole) {
      const path =
          logRole === "branch_log"
            ? join(common, "logs", branch)
            : join(git, "logs/HEAD"),
        privatePath =
          logRole === "branch_log"
            ? join(ctx.git, "logs", branch)
            : join(ctx.git, "logs/HEAD");
      const old = await originalBytes(ctx, path);
      if (old?.length && old.at(-1) !== 10)
        refuse("unsupported_branch_restore");
      if (old !== null) {
        await ctx.io.mkdir(dirname(privatePath), {
          recursive: true,
          mode: 0o700,
        });
        await ctx.io.writeFile(privatePath, old, { flag: "wx", mode: 0o600 });
      }
      if (old !== null || observed.logPolicy !== "false")
        metaBuilt.push({ role: logRole, path, privatePath, old });
    }
    let refOld = null;
    if (action === "create") {
      refOld = await originalBytes(
        ctx,
        join(common, branch),
        ctx.limits.metadataBytes,
      );
      if (refOld !== null) refuse("branch_conflict");
    }
    if (action === "create") await execute(ctx, "branch-create", [branch]);
    else if (action === "select") await execute(ctx, "branch-select", [branch]);
    else await execute(ctx, "branch-restore", [source, candidates]);
    const paths = [],
      worktreeBuilt = [];
    const identities = await checkedAttributes(
      ctx,
      candidates,
      source === "index" ? ["--cached"] : [`--source=${nextHeadOid}`],
    );
    let affectedBytes = 0;
    for (const path of candidates) {
      const beforeEntry = oldMap.get(path) ?? null,
        afterEntry = newMap.get(path) ?? null;
      const old = await originalBytes(
          ctx,
          join(w.path, path),
          ctx.limits.objectBytes,
        ),
        sourceRecord = s.files.get(join(w.path, path));
      const before =
        old === null
          ? null
          : {
              bytes: old.length,
              digest: hash(old),
              mode: sourceRecord.mode & 0o777,
            };
      let next = null,
        after = null,
        ident = false;
      const privatePath = join(ctx.worktree, path);
      let st;
      try {
        st = await ctx.io.lstat(privatePath, { bigint: true });
      } catch (e) {
        if (e.code !== "ENOENT") throw e;
      }
      if (afterEntry) {
        if (!st || !st.isFile() || st.isSymbolicLink() || st.nlink !== 1n)
          refuse("unsupported_branch_restore");
        next = await ctx.io.readFile(privatePath);
        if (next.length > L.fileBytes) refuse("too_large");
        ident = identities.get(path) === true;
        // Unchanged native content requires no write/proof artifact. Changed mode
        // remains an effect even when Git object identity stays equal.
        const nextMode = gitBranchRestoreMode(
          before?.mode ?? null,
          afterEntry.mode === 0o100755,
        );
        after = { bytes: next.length, digest: hash(next), mode: nextMode };
        if (sameState(before, after) && sameEntry(beforeEntry, afterEntry))
          continue;
        if (
          ((Number(st.mode) & 0o100) !== 0) !==
          (afterEntry.mode === 0o100755)
        )
          refuse("unsupported_branch_restore");
        const raw = await object("blob", afterEntry.oid);
        if (
          !gitBranchRestoreBlob(raw, afterEntry.oid, format, ident).equals(next)
        )
          refuse("unsupported_configuration");
      } else if (st) {
        refuse("unsupported_branch_restore");
      }
      if (sameState(before, after)) continue;
      if (workspaceFilePathReason(path) !== undefined)
        refuse("protected_source");
      if ((before?.bytes ?? 0) > L.fileBytes) refuse("too_large");
      affectedBytes += (before?.bytes ?? 0) + (after?.bytes ?? 0);
      if (affectedBytes > L.affectedBytes) refuse("too_large");
      paths.push({
        path,
        before,
        after,
        beforeEntry: beforeEntry
          ? { mode: beforeEntry.mode, oid: beforeEntry.oid }
          : null,
        afterEntry: afterEntry
          ? { mode: afterEntry.mode, oid: afterEntry.oid }
          : null,
        ident,
      });
      worktreeBuilt.push({ path, bytes: next });
    }
    if (
      paths.length > L.paths ||
      paths.reduce((n, x) => n + Buffer.byteLength(x.path), 0) > L.pathBytes
    )
      refuse("too_large");
    if (action === "restore" && !paths.length) refuse("no_changes");
    const changed = new Set(paths.map((x) => x.path)),
      privateFiles = new Map();
    let walked = 0;
    async function walkPrivate(folder, prefix = "", depth = 0) {
      if (depth > 32) refuse("too_large");
      for (const name of await ctx.io.readdir(folder)) {
        if (++walked > ctx.limits.candidates) refuse("too_large");
        const rel = prefix ? `${prefix}/${name}` : name;
        if (!validWorkspaceFilePath(rel)) refuse("unsupported_branch_restore");
        const path = join(folder, name),
          st = await ctx.io.lstat(path, { bigint: true });
        if (st.isDirectory() && !st.isSymbolicLink())
          await walkPrivate(path, rel, depth + 1);
        else {
          if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1n)
            refuse("unsupported_branch_restore");
          privateFiles.set(rel, hash(await ctx.io.readFile(path)));
        }
      }
    }
    await walkPrivate(ctx.worktree);
    const originalFiles = new Map(
      [...s.files]
        .filter(
          ([p]) =>
            p.startsWith(w.path + "/") &&
            !p.startsWith(join(w.path, ".git") + "/") &&
            p !== join(w.path, ".git"),
        )
        .map(([p]) => [
          p.slice(w.path.length + 1),
          s.manifest.get(`file:${p}`)[1],
        ]),
    );
    for (const [path, digest] of originalFiles)
      if (!changed.has(path) && privateFiles.get(path) !== digest)
        refuse("unsupported_branch_restore");
    for (const [path] of privateFiles)
      if (!originalFiles.has(path) && !changed.has(path))
        refuse("unsupported_branch_restore");
    const metadata = [];
    if (action === "select") {
      const native = inspectIndex(
        await ctx.io.readFile(join(ctx.git, "index")),
        format,
        ctx.limits,
      ).entries;
      if (
        native.some((x) => x.stage !== 0) ||
        !isDeepStrictEqual(entries(native), desiredEntries)
      )
        refuse("unsupported_branch_restore");
      const proposal = comparisonIndex(native, format),
        old = await originalBytes(ctx, join(git, "index"));
      metadata.push({
        role: "index",
        before: old === null ? null : { bytes: old.length, digest: hash(old) },
        after: { bytes: proposal.length, digest: hash(proposal) },
      });
      metaBuilt.unshift({
        role: "index",
        path: join(git, "index"),
        bytes: proposal,
        old,
      });
      if (
        statusRows(await execute(ctx, "status"), ctx.limits).some(
          (x) =>
            x.kind !== "untracked" &&
            (x.index !== "none" || x.worktree !== "none"),
        )
      )
        refuse("unsupported_branch_restore");
    }
    for (const f of metaBuilt.filter((x) => x.role === logRole)) {
      const actual = await ctx.io.readFile(f.privatePath),
        ident = `${identityRecord.author.name} <${identityRecord.author.email}> ${identityRecord.timestamp} +0000`,
        reason =
          action === "create"
            ? "branch: Created from HEAD"
            : `checkout: moving from ${repository.branch ?? repository.head} to ${branch.slice(11)}`,
        oldOid =
          action === "create"
            ? "0".repeat(repository.head.length)
            : repository.head;
      const expected = Buffer.concat([
        f.old ?? Buffer.alloc(0),
        Buffer.from(`${oldOid} ${nextHeadOid} ${ident}\t${reason}\n`),
      ]);
      if (!actual.equals(expected)) refuse("identity_changed");
      f.bytes = actual;
      metadata.push({
        role: f.role,
        before:
          f.old === null ? null : { bytes: f.old.length, digest: hash(f.old) },
        after: { bytes: actual.length, digest: hash(actual) },
      });
    }
    const head = await s.read(join(git, "HEAD"), ctx.limits.metadataBytes);
    if (action !== "restore") {
      const role = action === "create" ? "branch_ref" : "head_ref",
        path = action === "create" ? join(common, branch) : join(git, "HEAD"),
        old = action === "create" ? refOld : head,
        expected = Buffer.from(
          action === "create" ? `${repository.head}\n` : `ref: ${branch}\n`,
        ),
        actual = await ctx.io.readFile(
          action === "create" ? join(ctx.git, branch) : join(ctx.git, "HEAD"),
        );
      if (!actual.equals(expected)) refuse("identity_changed");
      metaBuilt.push({ role, path, old, bytes: actual });
      metadata.push({
        role,
        before: old === null ? null : { bytes: old.length, digest: hash(old) },
        after: { bytes: actual.length, digest: hash(actual) },
      });
    }
    for (const f of [
      ...metaBuilt,
      ...worktreeBuilt.map((x) => ({ path: join(w.path, x.path) })),
    ]) {
      const root =
        f.path.startsWith(w.path + "/") &&
        !f.path.startsWith(join(w.path, ".git") + "/")
          ? w.path
          : f.path.startsWith(git + "/")
            ? git
            : common;
      for (let p = dirname(f.path); ; p = dirname(p)) {
        if (s.dirs.has(p)) await s.list(p);
        else await s.requireMissing(p);
        if (p === root) break;
        if (p === dirname(p)) refuse("path_denied");
      }
    }
    await s.list(git);
    if (common !== git) await s.list(common);
    const indexBytes = await originalBytes(ctx, join(git, "index"));
    const target = {
      action,
      objectFormat: format,
      previewDigest: "0".repeat(64),
      occupancyDigest,
      branch,
      source,
      currentBranch,
      headOid: repository.head,
      nextHeadOid,
      treeOid,
      headDigest: hash(head),
      indexExists: indexBytes !== null,
      indexDigest:
        indexBytes === null ? GIT_ABSENT_INDEX_DIGEST : hash(indexBytes),
      identityDigest:
        identityRecord === null
          ? null
          : gitBranchRestoreIdentityDigest(
              identityRecord.author,
              identityRecord.timestamp,
            ),
      timestamp: identityRecord?.timestamp ?? null,
      paths,
      metadata,
    };
    const layout = Object.fromEntries(
      Object.entries(ctx.layout).map(([key, path]) => {
        const [dev, ino] = s.dirs.get(path).id.split(":");
        return [key, { path, dev, ino }];
      }),
    );
    target.previewDigest = hash(
      JSON.stringify([
        target,
        s.digest(),
        ctx.executable,
        layout,
        currentEntries,
        desiredEntries,
      ]),
    );
    await s.verify();
    return {
      target,
      identity: identityRecord,
      currentEntries,
      desiredEntries,
      objects: [...objects.values()].sort((a, b) => compare(a.oid, b.oid)),
      worktree: worktreeBuilt,
      metadata: metaBuilt,
      layout,
      source: s.authorityManifest(ctx.layout),
    };
  }
  async function artifact(ctx, w, r, s, built) {
    const root = join(ctx.home, "artifact");
    await ctx.io.mkdir(root, { mode: 0o700 });
    let total = ctx.copyBytes,
      count = ctx.copyFiles;
    const write = async (path, bytes) => {
      total += bytes.length;
      if (total > limits.objectBytes || ++count > limits.objectFiles)
        refuse("too_large");
      await ctx.io.mkdir(dirname(join(root, path)), {
        recursive: true,
        mode: 0o700,
      });
      await ctx.io.writeFile(join(root, path), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      return { path, bytes: bytes.length, digest: hash(bytes) };
    };
    const worktree = [],
      metadata = [],
      objects = [];
    for (const [i, f] of built.worktree.entries())
      worktree.push({
        path: f.path,
        proposal:
          f.bytes === null ? null : await write(`worktree/${i}`, f.bytes),
      });
    for (const f of built.metadata)
      metadata.push({
        role: f.role,
        proposal: await write(`proposal.${f.role}`, f.bytes),
      });
    for (const o of built.objects)
      objects.push({
        oid: o.oid,
        type: o.type,
        rawBytes: o.raw.length,
        install: false,
        ...(await write(`objects/${o.oid}`, o.raw)),
      });
    const original = {
      runtimeEpoch: s.runtimeEpoch,
      operationId: r.requestId,
      workspaceId: w.id,
      workspacePath: w.path,
      digest: s.operationDigest,
      target: built.target,
    };
    const manifest = {
      schemaVersion: 1,
      feature: GIT_BRANCH_RESTORE_FEATURE,
      ...original,
      layout: built.layout,
      source: built.source,
      author: built.identity?.author ?? null,
      currentEntries: built.currentEntries,
      desiredEntries: built.desiredEntries,
      worktree,
      metadata,
      objects,
    };
    const raw = Buffer.from(JSON.stringify(manifest)),
      st = await ctx.io.lstat(root, { bigint: true }),
      operation = {
        ...original,
        artifact: {
          root,
          dev: String(st.dev),
          ino: String(st.ino),
          manifest: {
            path: "manifest.json",
            bytes: raw.length,
            digest: hash(raw),
          },
        },
      };
    validateGitBranchRestoreKernelRequest(operation);
    validateGitBranchRestoreArtifactManifest(manifest, operation);
    await write("manifest.json", raw);
    await ctx.sources.verify();
    return operation;
  }
  const manager = {
    async preview(w, r, s = {}) {
      scope(w, s);
      validateGitBranchRestoreRequest(r);
      if (
        !["git.branch.preview.read", "git.restore.preview.read"].includes(
          r.type,
        ) ||
        r.workspaceId !== w.id
      )
        fail("INVALID_REQUEST");
      const original = getObservation(r.observationId);
      if (!original || !matches(original, w, s)) fail("INVALID_REQUEST");
      if (original.invalidated) return unavailable(w, "stale_observation");
      if (now() - original.created >= limits.observationMs)
        return unavailable(w, "expired_observation");
      return run(
        w,
        s,
        { workspaceId: w.id, workspacePath: w.path },
        async (ctx) => {
          const built = await proposal(ctx, w, r, original),
            previewId = randomBytes(32).toString("hex"),
            value = {
              workspaceId: w.id,
              workspacePath: w.path,
              status: "available",
              previewId,
              ...built.target,
              author: built.identity?.author ?? null,
            };
          validateGitBranchRestorePreview({
            ...value,
            runtimeEpoch: s.runtimeEpoch,
            revision: s.revision,
          });
          previews.set(previewId, {
            sender: s.sender,
            epoch: s.runtimeEpoch,
            workspaceId: w.id,
            root: w.path,
            trusted: s.trusted,
            trustRevision: s.trustRevision,
            revision: s.revision,
            created: now(),
            used: false,
            request: globalThis.structuredClone(r),
            target: globalThis.structuredClone(built.target),
            value: globalThis.structuredClone(value),
            original: { ...original },
            identity: globalThis.structuredClone(built.identity),
          });
          const local = [...previews].filter(([, p]) => p.workspaceId === w.id);
          while (local.length > L.previewsPerWorkspace)
            previews.delete(local.shift()[0]);
          while (previews.size > L.previews)
            previews.delete(previews.keys().next().value);
          return value;
        },
        validateGitBranchRestorePreview,
        false,
        false,
        true,
      );
    },
    previewForApply(w, r, s = {}) {
      return globalThis.structuredClone(admitted(w, r, s).value);
    },
    async apply(w, r, s = {}, publisher) {
      const p = admitted(w, r, s);
      if (
        typeof publisher !== "function" ||
        typeof s.operationDigest !== "string" ||
        !/^[a-f0-9]{64}$/u.test(s.operationDigest)
      )
        fail("INVALID_REQUEST");
      p.used = true;
      previews.delete(r.previewId);
      let dispatched = false;
      const result = await run(
        w,
        s,
        { requestId: r.requestId },
        async (ctx) => {
          const built = await proposal(
            ctx,
            w,
            p.request,
            p.original,
            p.identity,
          );
          if (!isDeepStrictEqual(built.target, p.target))
            refuse("stale_preview");
          const operation = await artifact(ctx, w, r, s, built);
          ctx.check();
          dispatched = true;
          ctx.retain = true;
          const started = ctx.now(),
            result = validateGitBranchRestoreKernelResult(
              await publisher(operation),
            ),
            elapsed = ctx.now() - started;
          if (
            !Number.isFinite(elapsed) ||
            elapsed < 0 ||
            elapsed >= GIT_BRANCH_RESTORE_KERNEL_LIMITS.deadlineMs
          )
            fail("READ_TIMEOUT");
          ctx.deadline += elapsed;
          ctx.check();
          const expected = {
            status: "applied",
            action: built.target.action,
            previewDigest: built.target.previewDigest,
            paths: built.target.paths.map((x) => ({
              path: x.path,
              after: x.after,
            })),
            metadata: built.target.metadata.map((x) => ({
              role: x.role,
              digest: x.after.digest,
            })),
            backups: gitBranchRestoreExpectedBackups(
              built.target,
              s.runtimeEpoch,
              r.requestId,
            ),
          };
          if (!isDeepStrictEqual(result, expected))
            return { requestId: r.requestId, status: "unknown" };
          ctx.publicationVerified = true;
          ctx.retain = false;
          return { requestId: r.requestId, ...result };
        },
        (v) =>
          validateGitBranchRestoreMutationResult(
            Object.fromEntries(
              Object.entries(v).filter(
                ([k]) => !["runtimeEpoch", "revision"].includes(k),
              ),
            ),
          ),
        true,
        false,
        true,
      ).catch((e) => {
        if (dispatched) return { requestId: r.requestId, status: "unknown" };
        throw e;
      });
      retireWorkspace(w.id);
      if (result.status === "unavailable") {
        if (dispatched) return { requestId: r.requestId, status: "unknown" };
        fail("FILE_CHANGED");
      }
      return result;
    },
    retireSender(sender) {
      for (const [id, p] of previews)
        if (p.sender === sender) previews.delete(id);
    },
    retireAll() {
      previews.clear();
    },
    closeSender(sender) {
      authority.closeSender(sender);
    },
    close() {
      return authority.close();
    },
  };
  return manager;
}
