// Private commit manager over the reader's one observation/snapshot authority.
import { join, dirname } from "node:path";
import { randomBytes, createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { fail } from "../workbench-contract.mjs";
import {
  GIT_COMMIT_LIMITS,
  GIT_COMMIT_ABSENT_DIGEST,
  GIT_COMMIT_REFLOG_REASON,
  canonicalGitCommitMessage,
  validateGitCommitRequest,
  gitCommitTargetFromApply,
  validateGitCommitPreview,
  validateGitCommitMutationResult,
} from "../renderer/shared/git-commit/index.mjs";
import {
  validateGitCommitKernelRequest,
  validateGitCommitArtifactManifest,
  gitCommitExpectedBackups,
  GIT_COMMIT_STATE_MARKERS,
  GIT_COMMIT_KERNEL_LIMITS,
} from "./git-commit-contract.mjs";
import {
  Sources,
  hash,
  decode,
  refuse,
  observe,
  execute,
  treeEntry,
} from "./workbench-git-snapshot.mjs";
const same = (a, b) =>
  a === null || b === null ? a === b : a.mode === b.mode && a.oid === b.oid;
const semantic = (e) => (e ? { mode: e.mode, oid: e.oid } : null);
const unavailable = (workspace, reason) => ({
  workspaceId: workspace.id,
  workspacePath: workspace.path,
  status: "unavailable",
  reason,
});
export function createWorkbenchGitCommitManager(authority) {
  const { run, validateScope, now, limits, getObservation, retireWorkspace } =
    authority;
  const previews = new Map();
  function scope(workspace, s) {
    validateScope(workspace, s);
    if (!Number.isSafeInteger(s.revision) || s.revision < 0)
      fail("INVALID_REQUEST");
    if (!s.trusted) fail("UNAVAILABLE");
  }
  function matches(record, workspace, s) {
    return (
      record.sender === s.sender &&
      record.epoch === s.runtimeEpoch &&
      record.workspaceId === workspace.id &&
      record.root === workspace.path &&
      record.trusted === s.trusted &&
      record.trustRevision === s.trustRevision
    );
  }
  function admitted(workspace, request, s) {
    scope(workspace, s);
    validateGitCommitRequest(request);
    if (
      request.type !== "git.commit.apply" ||
      request.workspaceId !== workspace.id
    )
      fail("INVALID_REQUEST");
    const p = previews.get(request.previewId);
    if (
      !p ||
      !matches(p, workspace, s) ||
      p.revision !== s.revision ||
      p.used ||
      now() - p.created >= GIT_COMMIT_LIMITS.previewMs ||
      !isDeepStrictEqual(p.target, gitCommitTargetFromApply(request))
    )
      fail("FILE_CHANGED");
    return p;
  }
  async function originalBytes(ctx, path, cap) {
    try {
      return await ctx.sources.read(path, cap, true);
    } catch (e) {
      if (e.code !== "ENOENT") throw e;
      await ctx.sources.requireMissing(path);
      return null;
    }
  }
  async function proposal(ctx, workspace, request, original, identity) {
    const observed = await observe(ctx, workspace);
    if (
      observed.fingerprint !== original.fingerprint ||
      ctx.executable !== original.executable
    ) {
      original.invalidated = true;
      refuse("stale_observation");
    }
    const s = ctx.sources,
      format = observed.repository.objectFormat,
      git = ctx.layout.gitDirectory,
      common = ctx.layout.commonDirectory;
    for (const name of GIT_COMMIT_STATE_MARKERS)
      await s.requireMissing(join(git, name), "unsupported_commit_state");
    const index = observed.index;
    if (index.length > GIT_COMMIT_LIMITS.treeEntries) refuse("too_large");
    if (
      index.some(
        (e) => e.stage !== 0 || ![0o100644, 0o100755].includes(e.mode),
      ) ||
      new Set(index.map((e) => e.path)).size !== index.length
    )
      refuse("unsupported_commit");
    const entries = [];
    for (const row of observed.files.filter((x) => x.index !== "none")) {
      const before = semantic(
        await treeEntry(ctx, observed.repository.head, row.path),
      );
      const after = semantic(index.find((e) => e.path === row.path));
      if (!same(before, after)) entries.push({ path: row.path, before, after });
    }
    entries.sort((a, b) =>
      Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)),
    );
    if (!entries.length) refuse("no_changes");
    if (
      entries.length > GIT_COMMIT_LIMITS.paths ||
      entries.reduce((n, x) => n + Buffer.byteLength(x.path), 0) >
        GIT_COMMIT_LIMITS.pathBytes
    )
      refuse("too_large");
    const commitIdentity = identity ?? {
      author: globalThis.structuredClone(request.author),
      timestamp: Math.floor(Date.now() / 1000),
      canonicalMessage: canonicalGitCommitMessage(request.message),
    };
    ctx.commitIdentity = commitIdentity;
    const ident = `${commitIdentity.author.name} <${commitIdentity.author.email}> ${commitIdentity.timestamp} +0000`;
    for (const kind of ["commit-author", "commit-committer"])
      if (decode(await execute(ctx, kind)) !== ident + "\n")
        refuse("identity_changed");
    // Determine original immutable OID presence BEFORE private write-tree/commit-tree.
    const present = new Set();
    for (const path of s.files.keys()) {
      const prefix = join(common, "objects") + "/";
      if (path.startsWith(prefix)) {
        const name = path.slice(prefix.length);
        if (/^[a-f0-9]{2}\/[a-f0-9]+$/.test(name))
          present.add(name.replace("/", ""));
        if (/^pack\/pack-[a-f0-9]+\.idx$/.test(name)) {
          const b = await s.read(path, ctx.limits.objectBytes),
            width = format === "sha1" ? 20 : 32;
          if (
            b.length < 1032 + width * 2 ||
            b.readUInt32BE(0) !== 0xff744f63 ||
            b.readUInt32BE(4) !== 2
          )
            refuse("unsupported_repository");
          const count = b.readUInt32BE(1028);
          if (
            count > ctx.limits.objectBytes / width ||
            1032 + count * width > b.length - width * 2
          )
            refuse("unsupported_repository");
          for (let i = 0; i < count; i++)
            present.add(
              b
                .subarray(1032 + i * width, 1032 + (i + 1) * width)
                .toString("hex"),
            );
        }
      }
    }
    const treeOid = decode(await execute(ctx, "commit-tree")).trim();
    const header = `tree ${treeOid}\n${observed.repository.head ? `parent ${observed.repository.head}\n` : ""}author ${ident}\ncommitter ${ident}\n\n`;
    const body = Buffer.from(header + commitIdentity.canonicalMessage);
    const expectedOid = hashObject("commit", body, format);
    const commitOid = decode(
      await execute(
        ctx,
        "commit-create",
        [treeOid, observed.repository.head],
        Buffer.from(commitIdentity.canonicalMessage),
      ),
    ).trim();
    if (
      commitOid !== expectedOid ||
      !(
        await execute(
          ctx,
          "commit-object",
          ["commit", commitOid],
          null,
          ctx.limits.objectBytes,
        )
      ).equals(body)
    )
      refuse("identity_changed");
    if (observed.repository.head) {
      const parent = await execute(
        ctx,
        "commit-object",
        ["commit", observed.repository.head],
        null,
        ctx.limits.objectBytes,
      );
      if (decode(parent).split("\n", 1)[0] === `tree ${treeOid}`)
        refuse("no_changes");
    }
    const objects = [],
      seen = new Set();
    async function tree(oid) {
      if (seen.has(oid)) return;
      seen.add(oid);
      const raw = await execute(
        ctx,
        "commit-object",
        ["tree", oid],
        null,
        ctx.limits.objectBytes,
      );
      if (hashObject("tree", raw, format) !== oid) refuse("read_failed");
      objects.push(object("tree", oid, raw, !present.has(oid)));
      const width = format === "sha1" ? 20 : 32;
      let at = 0;
      while (at < raw.length) {
        const end = raw.indexOf(0, at);
        if (end < 0 || end + 1 + width > raw.length) refuse("read_failed");
        const entry = raw.subarray(at, end).toString("utf8"),
          next = raw.subarray(end + 1, end + 1 + width).toString("hex");
        if (entry.startsWith("40000 ")) await tree(next);
        at = end + 1 + width;
      }
    }
    await tree(treeOid);
    objects.push(object("commit", commitOid, body, !present.has(commitOid)));
    if (
      objects.reduce((n, x) => n + x.rawBytes + x.bytes.length, 0) >
      ctx.limits.objectBytes
    )
      refuse("too_large");
    const headBytes = await s.read(join(git, "HEAD"), ctx.limits.metadataBytes);
    const branch = observed.repository.branch;
    const refPath = branch
      ? join(common, "refs/heads", branch)
      : join(git, "HEAD");
    const refBytes = branch
      ? await originalBytes(ctx, refPath, ctx.limits.metadataBytes)
      : headBytes;
    const reference = {
      kind: branch ? "branch" : "head",
      name: branch ? `refs/heads/${branch}` : null,
      exists: refBytes !== null,
      digest: refBytes === null ? GIT_COMMIT_ABSENT_DIGEST : hash(refBytes),
      nextDigest: hash(Buffer.from(commitOid + "\n")),
    };
    const logs = [],
      logFiles = [];
    for (const [role, path, privatePath] of [
      ["head_log", join(git, "logs/HEAD"), join(ctx.git, "logs/HEAD")],
      ...(branch
        ? [
            [
              "branch_log",
              join(common, "logs/refs/heads", branch),
              join(ctx.git, "logs/refs/heads", branch),
            ],
          ]
        : []),
    ]) {
      const old = await originalBytes(ctx, path, ctx.limits.indexBytes);
      if (old && old.length && old.at(-1) !== 10) refuse("unsupported_commit");
      if (old !== null) {
        await ctx.io.mkdir(dirname(privatePath), {
          recursive: true,
          mode: 0o700,
        });
        await ctx.io.writeFile(privatePath, old, { flag: "wx", mode: 0o600 });
      }
      if (old !== null || observed.logPolicy !== "false")
        logFiles.push({ role, path, privatePath, old });
    }
    await execute(ctx, "commit-reference", [
      commitOid,
      observed.repository.head ?? "0".repeat(format === "sha1" ? 40 : 64),
    ]);
    for (const f of logFiles) {
      const bytes = await ctx.io.readFile(f.privatePath);
      const expected = Buffer.concat([
        f.old ?? Buffer.alloc(0),
        Buffer.from(
          `${observed.repository.head ?? "0".repeat(format === "sha1" ? 40 : 64)} ${commitOid} ${ident}\t${GIT_COMMIT_REFLOG_REASON}\n`,
        ),
      ]);
      if (!bytes.equals(expected)) refuse("identity_changed");
      logs.push({
        role: f.role,
        exists: f.old !== null,
        digest: f.old === null ? GIT_COMMIT_ABSENT_DIGEST : hash(f.old),
        nextDigest: hash(bytes),
        nextBytes: bytes.length,
      });
      f.bytes = bytes;
    }
    const publicationParents = new Set([git, common]);
    for (const { path } of [{ path: refPath }, ...logFiles]) {
      const root = path.startsWith(git + "/") ? git : common;
      for (let parent = dirname(path); ; parent = dirname(parent)) {
        if (s.dirs.has(parent)) publicationParents.add(parent);
        if (parent === root) break;
      }
    }
    for (const path of publicationParents) await s.list(path);
    const fullEntries = index
      .map(({ path, mode, oid }) => ({ path, mode, oid }))
      .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
    const target = {
      objectFormat: format,
      previewDigest: "0".repeat(64),
      indexDigest: s.manifest.get(`file:${join(git, "index")}`)?.[1],
      headOid: observed.repository.head,
      treeOid,
      treeDigest: hash(
        JSON.stringify(fullEntries.map((x) => [x.path, x.mode, x.oid])),
      ),
      commitOid,
      commitBodyDigest: hash(body),
      reference,
      logs,
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
        commitIdentity,
        entries,
        s.digest(),
        ctx.executable,
        layout,
      ]),
    );
    await s.verify();
    return {
      target,
      entries,
      fullEntries,
      objects,
      body,
      logFiles,
      referenceBytes: Buffer.from(commitOid + "\n"),
      identity: commitIdentity,
      layout,
      source: s.authorityManifest(ctx.layout),
    };
  }
  function hashObject(type, body, format) {
    return createHash(format)
      .update(Buffer.from(`${type} ${body.length}\0`))
      .update(body)
      .digest("hex");
  }
  function object(type, oid, body, install) {
    return {
      type,
      oid,
      rawBytes: body.length,
      bytes: deflateSync(
        Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]),
      ),
      install,
    };
  }
  async function artifact(ctx, workspace, request, s, built) {
    const root = join(ctx.home, "artifact");
    await ctx.io.mkdir(root, { mode: 0o700 });
    const write = async (path, bytes) => {
      await ctx.io.writeFile(join(root, path), bytes, {
        flag: "wx",
        mode: 0o600,
      });
      return { path, bytes: bytes.length, digest: hash(bytes) };
    };
    const commit = await write("commit.body", built.body),
      reference = await write("proposal.reference", built.referenceBytes),
      logs = [],
      objects = [];
    for (const f of built.logFiles)
      logs.push({
        role: f.role,
        proposal: await write(`proposal.${f.role}`, f.bytes),
      });
    for (const o of built.objects) {
      await ctx.io.mkdir(join(root, "objects", o.oid.slice(0, 2)), {
        recursive: true,
        mode: 0o700,
      });
      objects.push({
        oid: o.oid,
        type: o.type,
        rawBytes: o.rawBytes,
        install: o.install,
        ...(await write(
          `objects/${o.oid.slice(0, 2)}/${o.oid.slice(2)}`,
          o.bytes,
        )),
      });
    }
    const original = {
      runtimeEpoch: s.runtimeEpoch,
      operationId: request.requestId,
      workspaceId: workspace.id,
      workspacePath: workspace.path,
      digest: s.operationDigest,
      target: built.target,
    };
    const manifest = {
      schemaVersion: 1,
      feature: "git_commit_mutation_v1",
      ...original,
      layout: built.layout,
      source: built.source,
      author: built.identity.author,
      timestamp: built.identity.timestamp,
      canonicalMessage: built.identity.canonicalMessage,
      entries: built.fullEntries,
      commit,
      reference,
      logs,
      objects,
    };
    const bytes = Buffer.from(JSON.stringify(manifest)),
      st = await ctx.io.lstat(root, { bigint: true });
    const operation = {
      ...original,
      artifact: {
        root,
        dev: String(st.dev),
        ino: String(st.ino),
        manifest: {
          path: "manifest.json",
          bytes: bytes.length,
          digest: hash(bytes),
        },
      },
    };
    validateGitCommitKernelRequest(operation);
    validateGitCommitArtifactManifest(manifest, operation);
    if (
      ctx.copyBytes +
        bytes.length +
        commit.bytes +
        reference.bytes +
        logs.reduce((n, x) => n + x.proposal.bytes, 0) +
        objects.reduce((n, x) => n + x.bytes, 0) >
        limits.objectBytes ||
      ctx.copyFiles + objects.length + logs.length + 3 > limits.objectFiles
    )
      refuse("too_large");
    await write("manifest.json", bytes);
    await ctx.sources.verify();
    return operation;
  }
  const manager = {
    async preview(workspace, request, s = {}) {
      scope(workspace, s);
      validateGitCommitRequest(request);
      if (
        request.type !== "git.commit.preview.read" ||
        request.workspaceId !== workspace.id
      )
        fail("INVALID_REQUEST");
      const original = getObservation(request.observationId);
      if (!original || !matches(original, workspace, s))
        fail("INVALID_REQUEST");
      if (original.invalidated)
        return unavailable(workspace, "stale_observation");
      if (now() - original.created >= limits.observationMs)
        return unavailable(workspace, "expired_observation");
      return run(
        workspace,
        s,
        { workspaceId: workspace.id, workspacePath: workspace.path },
        async (ctx) => {
          const built = await proposal(ctx, workspace, request, original),
            previewId = randomBytes(32).toString("hex");
          const value = {
            workspaceId: workspace.id,
            workspacePath: workspace.path,
            status: "available",
            previewId,
            ...built.target,
            entries: built.entries,
            author: built.identity.author,
            timestamp: built.identity.timestamp,
            canonicalMessage: built.identity.canonicalMessage,
          };
          validateGitCommitPreview({
            ...value,
            runtimeEpoch: s.runtimeEpoch,
            revision: s.revision,
          });
          const record = {
            sender: s.sender,
            epoch: s.runtimeEpoch,
            workspaceId: workspace.id,
            root: workspace.path,
            trusted: s.trusted,
            trustRevision: s.trustRevision,
            revision: s.revision,
            created: now(),
            used: false,
            target: globalThis.structuredClone(built.target),
            value: globalThis.structuredClone(value),
            original: { ...original },
            identity: globalThis.structuredClone(built.identity),
          };
          previews.set(previewId, record);
          const local = [...previews].filter(
            ([, p]) => p.workspaceId === workspace.id,
          );
          while (local.length > GIT_COMMIT_LIMITS.previewsPerWorkspace)
            previews.delete(local.shift()[0]);
          while (previews.size > GIT_COMMIT_LIMITS.previews)
            previews.delete(previews.keys().next().value);
          return value;
        },
        validateGitCommitPreview,
        false,
        true,
      );
    },
    previewForApply(workspace, request, s = {}) {
      return globalThis.structuredClone(admitted(workspace, request, s).value);
    },
    async apply(workspace, request, s = {}, publisher) {
      const p = admitted(workspace, request, s);
      if (
        typeof publisher !== "function" ||
        typeof s.operationDigest !== "string" ||
        !/^[a-f0-9]{64}$/u.test(s.operationDigest)
      )
        fail("INVALID_REQUEST");
      p.used = true;
      previews.delete(request.previewId);
      let dispatched = false;
      const result = await run(
        workspace,
        s,
        { requestId: request.requestId },
        async (ctx) => {
          const built = await proposal(
            ctx,
            workspace,
            request,
            p.original,
            p.identity,
          );
          if (!isDeepStrictEqual(built.target, p.target))
            refuse("stale_preview");
          const operation = await artifact(ctx, workspace, request, s, built);
          ctx.check();
          dispatched = true;
          ctx.retain = true;
          const publicationStarted = ctx.now();
          const result = await publisher(operation);
          const publicationElapsed = ctx.now() - publicationStarted;
          if (
            !Number.isFinite(publicationElapsed) ||
            publicationElapsed < 0 ||
            publicationElapsed >= GIT_COMMIT_KERNEL_LIMITS.deadlineMs
          )
            fail("READ_TIMEOUT");
          // Charge only read work to the read budget. The typed publisher has
          // its own fixed bound; caller scope and cancellation still apply.
          ctx.deadline += publicationElapsed;
          ctx.check();
          const expectedBackups = gitCommitExpectedBackups(
            built.target,
            s.runtimeEpoch,
            request.requestId,
          );
          if (
            result?.status !== "committed" ||
            result.commitOid !== built.target.commitOid ||
            result.treeOid !== built.target.treeOid ||
            result.referenceDigest !== built.target.reference.nextDigest ||
            !isDeepStrictEqual(
              result.logDigests,
              built.target.logs.map((x) => ({
                role: x.role,
                digest: x.nextDigest,
              })),
            ) ||
            !isDeepStrictEqual(result.backups, expectedBackups)
          )
            return { requestId: request.requestId, status: "unknown" };
          const after = new Sources(ctx);
          try {
            const path =
              built.target.reference.kind === "head"
                ? join(ctx.layout.gitDirectory, "HEAD")
                : join(ctx.layout.commonDirectory, built.target.reference.name);
            if (
              !(await after.read(path, limits.metadataBytes)).equals(
                built.referenceBytes,
              )
            )
              return { requestId: request.requestId, status: "unknown" };
            for (const f of built.logFiles)
              if (
                !(await after.read(f.path, limits.indexBytes)).equals(f.bytes)
              )
                return { requestId: request.requestId, status: "unknown" };
            for (const marker of GIT_COMMIT_STATE_MARKERS)
              await after.requireMissing(
                join(ctx.layout.gitDirectory, marker),
                "unsupported_commit_state",
              );
            const index = await after.read(
              join(ctx.layout.gitDirectory, "index"),
              limits.indexBytes,
            );
            if (hash(index) !== built.target.indexDigest)
              return { requestId: request.requestId, status: "unknown" };
            await after.verify();
            ctx.check();
            ctx.publicationVerified = true;
            ctx.retain = false;
            return {
              requestId: request.requestId,
              status: "committed",
              commitOid: result.commitOid,
              treeOid: result.treeOid,
              referenceDigest: result.referenceDigest,
              logDigests: result.logDigests,
              backups: result.backups,
            };
          } finally {
            await after.close();
          }
        },
        (value) =>
          validateGitCommitMutationResult(
            Object.fromEntries(
              Object.entries(value).filter(
                ([k]) => !["runtimeEpoch", "revision"].includes(k),
              ),
            ),
          ),
        true,
        true,
      ).catch((error) => {
        if (dispatched)
          return { requestId: request.requestId, status: "unknown" };
        throw error;
      });
      retireWorkspace(workspace.id);
      if (result.status === "unavailable") {
        if (dispatched)
          return { requestId: request.requestId, status: "unknown" };
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
