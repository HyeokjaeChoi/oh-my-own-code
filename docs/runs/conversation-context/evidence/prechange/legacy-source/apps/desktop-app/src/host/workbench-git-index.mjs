// Private index manager over the reader's one observation/snapshot authority.
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { inflateSync } from "node:zlib";
import { isDeepStrictEqual } from "node:util";
import { fail } from "../workbench-contract.mjs";
import {
  GIT_INDEX_LIMITS,
  GIT_ABSENT_INDEX_DIGEST,
  validateGitIndexRequest,
  gitIndexTargetFromApply,
  validateGitIndexPreview,
  validateGitIndexMutationResult,
} from "../renderer/shared/git-index/index.mjs";
import {
  validateGitIndexKernelRequest,
  validateGitIndexArtifactManifest,
  gitIndexBackupId,
} from "./git-index-contract.mjs";
import {
  Sources,
  absent,
  hash,
  decode,
  refuse,
  observe,
  execute,
  treeEntry,
  checkedAttributes,
  comparisonIndex,
  inspectIndex,
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
export function createWorkbenchGitIndexManager(authority) {
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
    validateGitIndexRequest(request);
    if (
      request.type !== "git.index.apply" ||
      request.workspaceId !== workspace.id
    )
      fail("INVALID_REQUEST");
    const p = previews.get(request.previewId);
    if (
      !p ||
      !matches(p, workspace, s) ||
      p.revision !== s.revision ||
      p.used ||
      now() - p.created >= GIT_INDEX_LIMITS.previewMs ||
      !isDeepStrictEqual(p.target, gitIndexTargetFromApply(request))
    )
      fail("FILE_CHANGED");
    return p;
  }
  async function proposal(ctx, workspace, request, original) {
    const observed = await observe(ctx, workspace);
    if (
      observed.fingerprint !== original.fingerprint ||
      ctx.executable !== original.executable
    ) {
      original.invalidated = true;
      refuse("stale_observation");
    }
    const format = observed.repository.objectFormat,
      index = observed.index;
    if (
      index.some(
        (e) => e.stage !== 0 || ![0o100644, 0o100755].includes(e.mode),
      ) ||
      new Set(index.map((e) => e.path)).size !== index.length
    )
      refuse("unsupported_index_mutation");
    await checkedAttributes(ctx, request.paths);
    await checkedAttributes(ctx, request.paths, ["--cached"]);
    if (observed.repository.head)
      await checkedAttributes(ctx, request.paths, [
        `--source=${observed.repository.head}`,
      ]);
    const next = new Map(index.map((e) => [e.path, { ...e }]));
    const entries = [],
      objects = [];
    for (const path of request.paths) {
      ctx.check();
      const before = semantic(next.get(path));
      let after;
      if (request.action === "unstage")
        after = semantic(await treeEntry(ctx, observed.repository.head, path));
      else {
        const source = ctx.sources.files.get(join(workspace.path, path));
        if (!source) {
          if (!before) refuse("missing_file");
          after = null;
        } else {
          const row = observed.files.find((e) => e.path === path);
          if (!before && !row) refuse("unsupported_index_mutation");
          const oid = decode(
            await execute(ctx, "index-hash", [path], null, 128),
          ).trim();
          if (
            !new RegExp(`^[a-f0-9]{${format === "sha1" ? 40 : 64}}$`, "u").test(
              oid,
            )
          )
            refuse("read_failed");
          after = {
            mode: observed.fileMode
              ? source.mode & 0o100
                ? 0o100755
                : 0o100644
              : (before?.mode ?? 0o100644),
            oid,
          };
          const originalObject = join(
            ctx.layout.commonDirectory,
            "objects",
            oid.slice(0, 2),
            oid.slice(2),
          );
          if (!ctx.sources.files.has(originalObject)) {
            const objectPath = join(
              ctx.git,
              "objects",
              oid.slice(0, 2),
              oid.slice(2),
            );
            let st;
            try {
              st = await ctx.io.lstat(objectPath, { bigint: true });
            } catch (e) {
              if (!absent(e)) throw e;
            }
            // No loose private object means the exact OID was already in copied packs.
            if (st) {
              if (
                !st.isFile() ||
                st.isSymbolicLink() ||
                st.nlink !== 1n ||
                st.size > BigInt(limits.objectBytes)
              )
                refuse("path_denied");
              const bytes = await ctx.io.readFile(objectPath);
              const raw = inflateSync(bytes, {
                maxOutputLength: limits.objectBytes,
              });
              const at = raw.indexOf(0);
              const header = raw.subarray(0, at).toString("ascii"),
                body = raw.subarray(at + 1);
              if (at < 0 || header !== `blob ${body.length}`)
                refuse("read_failed");
              objects.push({ oid, bytes, rawBytes: body.length });
            }
          }
        }
      }
      if (after && ![0o100644, 0o100755].includes(after.mode))
        refuse("unsupported_index_mutation");
      entries.push({ path, before, after });
      if (after) next.set(path, { path, ...after, stage: 0 });
      else next.delete(path);
    }
    if (!entries.some((e) => !same(e.before, e.after))) refuse("no_changes");
    const bytes = comparisonIndex([...next.values()], format);
    if (
      bytes.length > limits.indexBytes ||
      ctx.copyBytes +
        bytes.length +
        objects.reduce((n, x) => n + x.bytes.length, 0) >
        limits.objectBytes
    )
      refuse("too_large");
    for (const path of new Set([
      ctx.layout.gitDirectory,
      ctx.layout.commonDirectory,
    ]))
      await ctx.sources.list(path);
    // The reader's complete refs listing proves absence, while the kernel also
    // requires an explicit missing record for the symbolic HEAD target.
    const head = decode(
      await ctx.sources.read(
        join(ctx.layout.gitDirectory, "HEAD"),
        limits.metadataBytes,
      ),
    ).trimEnd();
    if (head.startsWith("ref: refs/heads/"))
      await ctx.sources.read(
        join(ctx.layout.commonDirectory, head.slice(5)),
        limits.metadataBytes,
        true,
      );
    const indexPath = join(ctx.layout.gitDirectory, "index"),
      indexRecord = ctx.sources.manifest.get(`file:${indexPath}`);
    const target = {
      action: request.action,
      paths: [...request.paths],
      previewDigest: "0".repeat(64),
      headOid: observed.repository.head,
      indexExists: !!indexRecord,
      indexDigest: indexRecord ? indexRecord[1] : GIT_ABSENT_INDEX_DIGEST,
      nextIndexDigest: hash(bytes),
      objectFormat: format,
    };
    const layout = Object.fromEntries(
      Object.entries(ctx.layout).map(([key, path]) => {
        const [dev, ino] = ctx.sources.dirs.get(path).id.split(":");
        return [key, { path, dev, ino }];
      }),
    );
    target.previewDigest = hash(
      JSON.stringify([
        target,
        entries,
        ctx.sources.digest(),
        ctx.executable,
        layout,
      ]),
    );
    await ctx.sources.verify();
    return {
      target,
      entries,
      bytes,
      objects,
      layout,
      source: ctx.sources.authorityManifest(ctx.layout),
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
    const proposal = await write("proposal.index", built.bytes),
      objects = [];
    for (const object of built.objects) {
      if (objects.some((x) => x.oid === object.oid)) continue;
      await ctx.io.mkdir(join(root, "objects", object.oid.slice(0, 2)), {
        recursive: true,
        mode: 0o700,
      });
      objects.push({
        oid: object.oid,
        rawBytes: object.rawBytes,
        ...(await write(
          `objects/${object.oid.slice(0, 2)}/${object.oid.slice(2)}`,
          object.bytes,
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
      feature: "git_index_mutation_v1",
      ...original,
      layout: built.layout,
      source: built.source,
      proposal,
      objects,
    };
    const bytes = Buffer.from(JSON.stringify(manifest));
    const st = await ctx.io.lstat(root, { bigint: true });
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
    validateGitIndexKernelRequest(operation);
    validateGitIndexArtifactManifest(manifest, operation);
    if (
      ctx.copyBytes +
        proposal.bytes +
        objects.reduce((n, x) => n + x.bytes, 0) +
        bytes.length >
        limits.objectBytes ||
      ctx.copyFiles + objects.length + 2 > limits.objectFiles
    )
      refuse("too_large");
    await write("manifest.json", bytes);
    await ctx.sources.verify();
    return operation;
  }
  const manager = {
    async preview(workspace, request, s = {}) {
      scope(workspace, s);
      validateGitIndexRequest(request);
      if (
        request.type !== "git.index.preview.read" ||
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
          };
          validateGitIndexPreview({
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
          };
          previews.set(previewId, record);
          const local = [...previews].filter(
            ([, p]) => p.workspaceId === workspace.id,
          );
          while (local.length > GIT_INDEX_LIMITS.previewsPerWorkspace)
            previews.delete(local.shift()[0]);
          while (previews.size > GIT_INDEX_LIMITS.previews)
            previews.delete(previews.keys().next().value);
          return value;
        },
        validateGitIndexPreview,
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
          const built = await proposal(ctx, workspace, request, p.original);
          if (!isDeepStrictEqual(built.target, p.target))
            refuse("stale_preview");
          const operation = await artifact(ctx, workspace, request, s, built);
          ctx.check();
          dispatched = true;
          ctx.retain = true;
          const result = await publisher(operation);
          if (
            result?.status !== "applied" ||
            result.indexDigest !== built.target.nextIndexDigest ||
            result.backupId !==
              (built.target.indexExists
                ? gitIndexBackupId(s.runtimeEpoch, request.requestId)
                : null)
          )
            return { requestId: request.requestId, status: "unknown" };
          const after = new Sources(ctx);
          try {
            const bytes = await after.read(
              join(ctx.layout.gitDirectory, "index"),
              limits.indexBytes,
            );
            const parsed = inspectIndex(
                bytes,
                built.target.objectFormat,
                limits,
              ),
              expected = inspectIndex(
                built.bytes,
                built.target.objectFormat,
                limits,
              );
            if (
              hash(bytes) !== built.target.nextIndexDigest ||
              !isDeepStrictEqual(parsed.entries, expected.entries)
            )
              return { requestId: request.requestId, status: "unknown" };
            await after.verify();
            ctx.check();
            ctx.publicationVerified = true;
            ctx.retain = false;
            return {
              requestId: request.requestId,
              status: "applied",
              indexDigest: result.indexDigest,
              backupId: result.backupId,
            };
          } finally {
            await after.close();
          }
        },
        (value) =>
          validateGitIndexMutationResult(
            Object.fromEntries(
              Object.entries(value).filter(
                ([k]) => !["runtimeEpoch", "revision"].includes(k),
              ),
            ),
          ),
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
