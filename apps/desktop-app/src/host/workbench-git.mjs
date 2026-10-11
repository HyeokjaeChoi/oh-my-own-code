// Main owns registry, trust and atomic response clocks.
import { constants } from "node:fs";
import * as actualIO from "node:fs/promises";
import { spawn as actualSpawn } from "node:child_process";
import { join, isAbsolute, normalize } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import { fail } from "../workbench-contract.mjs";
import { readWorkspaceFile } from "./workbench-file-edit.mjs";
import {
  GIT_REVIEW_LIMITS as LIMITS,
  validateGitReviewRequest,
  validateGitReviewObservation,
  validateGitDiffObservation,
} from "../renderer/shared/git-review/index.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
  workspaceFileContentFits,
} from "../renderer/shared/workspace-file/index.mjs";
import { createWorkbenchGitIndexManager } from "./workbench-git-index.mjs";
import { createWorkbenchGitCommitManager } from "./workbench-git-commit.mjs";
import { createWorkbenchGitBranchRestoreManager } from "./workbench-git-branch-restore.mjs";
import {
  Sources,
  Refusal,
  refuse,
  hash,
  identity,
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
  blob,
  emptyBlob,
  writeComparisonIndex,
} from "./workbench-git-snapshot.mjs";
/**
 * Defaults use real IO/spawn and the fixed CLT executable. Optional private test
 * adapters: io, spawn, now, platform, tempRoot, limits (lower only), onEvent.
 * Adapter/injected observations are not actual runtime safety evidence.
 */
export function createWorkbenchGitAccess(options = {}) {
  if (
    !data(options) ||
    Reflect.ownKeys(options).some(
      (k) =>
        ![
          "io",
          "spawn",
          "now",
          "platform",
          "tempRoot",
          "limits",
          "onEvent",
        ].includes(k),
    )
  )
    fail("INVALID_REQUEST");
  const {
    io = actualIO,
    spawn = actualSpawn,
    now = () => globalThis.performance.now(),
    platform = process.platform,
    tempRoot = tmpdir(),
    onEvent = () => {},
  } = options;
  const limits = { ...LIMITS };
  if (options.limits)
    for (const [key, value] of Object.entries(options.limits)) {
      if (
        !Object.hasOwn(limits, key) ||
        !Number.isSafeInteger(value) ||
        value < 1 ||
        value > limits[key]
      )
        fail("INVALID_REQUEST");
      limits[key] = value;
    }
  if (
    typeof spawn !== "function" ||
    typeof now !== "function" ||
    typeof onEvent !== "function" ||
    !isAbsolute(tempRoot)
  )
    fail("INVALID_REQUEST");
  const observations = new Map(),
    active = new Map(),
    disabled = new Set();
  let closed = false;
  const event = (e) => {
    try {
      onEvent(Object.freeze(e));
    } catch {
      /* Diagnostics never change safety decisions. */
    }
  };
  const retire = (id) => observations.delete(id);
  const validateScope = (workspace, scope) => {
    if (
      !data(workspace) ||
      Object.keys(workspace).some((k) => !["id", "path"].includes(k)) ||
      !data(scope) ||
      typeof scope.runtimeEpoch !== "string" ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(scope.runtimeEpoch) ||
      scope.sender === undefined ||
      typeof scope.trusted !== "boolean" ||
      !Number.isSafeInteger(scope.trustRevision) ||
      scope.trustRevision < 0 ||
      typeof (scope.check ?? (() => {})) !== "function" ||
      !validWorkspaceFileRoot(workspace.path) ||
      normalize(workspace.path) !== workspace.path
    )
      fail("INVALID_REQUEST");
    validateGitReviewRequest({
      type: "git.review.read",
      workspaceId: workspace.id,
    });
    scope.check?.();
    if (closed || scope.signal?.aborted) fail("STALE_EPOCH");
  };
  async function run(
    workspace,
    scope,
    base,
    task,
    validator,
    mutable = false,
    commit = false,
    branchRestore = false,
  ) {
    validateScope(workspace, scope);
    const unavailable = (reason) => ({
      ...base,
      status: "unavailable",
      reason,
    });
    if (disabled.has(workspace.id)) return unavailable("process_unverified");
    if (
      platform !== "darwin" ||
      !constants.O_NOFOLLOW ||
      !constants.O_DIRECTORY
    )
      return unavailable("platform_unavailable");
    if (active.has(workspace.id) || active.size >= 2) fail("READ_BUSY");
    const controller = new AbortController();
    const ctx = {
      io,
      spawn,
      now,
      limits,
      controller,
      children: new Set(),
      stopChildren: new Map(),
      stdout: 0,
      stderr: 0,
      unverified: false,
      deadline: now() + limits.deadlineMs,
      home: null,
      phase: "capability",
      copyBytes: 0,
      copyFiles: 0,
      event,
      mutable,
      commit,
      branchRestore,
      retain: false,
      publicationVerified: false,
    };
    ctx.check = () => {
      scope.check?.();
      if (controller.signal.aborted || closed) fail("STALE_EPOCH");
      if (now() >= ctx.deadline) fail("READ_TIMEOUT");
    };
    ctx.sources = new Sources(ctx);
    const cancel = () => controller.abort();
    scope.signal?.addEventListener("abort", cancel, { once: true });
    let resolveDone;
    const done = new Promise((r) => {
      resolveDone = r;
    });
    active.set(workspace.id, { sender: scope.sender, controller, done });
    let response, error, homeIdentity;
    try {
      ctx.check();
      const parent = await io.realpath(tempRoot);
      await ctx.sources.directory(workspace.path);
      if (inside(workspace.path, parent)) refuse("path_denied");
      ctx.layout = await snapshotLayout(ctx, workspace);
      for (const source of [
        ctx.layout.gitDirectory,
        ctx.layout.commonDirectory,
      ])
        if (inside(source, parent)) refuse("path_denied");
      await ctx.sources.directory(parent);
      await ctx.sources.verify();
      ctx.executable = await trustedExecutable(io);
      ctx.check();
      ctx.home = await io.mkdtemp(join(parent, "omoc-git-read-"));
      await io.chmod(ctx.home, 0o700);
      homeIdentity = identity(await io.lstat(ctx.home, { bigint: true }));
      ctx.git = join(ctx.home, "git");
      ctx.worktree = join(ctx.home, "worktree");
      event({ type: "namespace", path: ctx.home });
      const version = decode(await execute(ctx, "version")).trim();
      if (
        !(
          version === "git version 2.50.1 (Apple Git-155)" ||
          /^git version 2\.54\.\d+(?:\s.*)?$/.test(version)
        )
      )
        refuse("git_unavailable");
      ctx.phase = "capability";
      await capabilityPreflight(ctx);
      ctx.phase = "observe";
      response = await task(ctx);
      ctx.check();
      if (!ctx.publicationVerified) await ctx.sources.verify();
      const publicValue = {
        runtimeEpoch: scope.runtimeEpoch,
        revision: 0,
        ...response,
      };
      if (Buffer.byteLength(JSON.stringify(publicValue)) > limits.dtoBytes)
        refuse("too_large");
      try {
        validator(publicValue);
      } catch {
        refuse("read_failed");
      }
    } catch (e) {
      error = e;
    } finally {
      scope.signal?.removeEventListener("abort", cancel);
      if (ctx.children.size) {
        for (const stop of ctx.stopChildren.values())
          stop(new Refusal("read_failed"));
        ctx.unverified = true;
      }
      try {
        await ctx.sources.close();
      } catch {
        ctx.unverified = true;
      }
      if (ctx.unverified) {
        disabled.add(workspace.id);
        event({
          type: "retained",
          path: ctx.home,
          reason: "process_unverified",
        });
        error = new Refusal("process_unverified");
      } else if (ctx.retain) {
        event({
          type: "retained",
          path: ctx.home,
          reason: branchRestore
            ? "unknown_branch_restore_publication"
            : commit
              ? "unknown_commit_publication"
              : "unknown_index_publication",
        });
      } else if (ctx.home) {
        try {
          await removeOwnedNamespace(io, ctx.home, homeIdentity);
          event({ type: "removed", path: ctx.home });
        } catch {
          disabled.add(workspace.id);
          error = new Refusal("process_unverified");
          event({
            type: "retained",
            path: ctx.home,
            reason: "process_unverified",
          });
        }
      }
      if (!ctx.unverified && !disabled.has(workspace.id))
        active.delete(workspace.id);
      resolveDone();
    }
    if (error?.appCode) throw error;
    if (error)
      return unavailable(
        error instanceof Refusal
          ? error.message
          : absent(error)
            ? "metadata_changed"
            : "read_failed",
      );
    return response;
  }
  const reader = {
    async review(workspace, scope = {}) {
      const authority = {
        trusted: scope.trusted,
        trustRevision: scope.trustRevision,
      };
      const base = {
        workspaceId: workspace?.id,
        workspacePath: workspace?.path,
      };
      return run(
        workspace,
        scope,
        base,
        async (ctx) => {
          const observed = await observe(ctx, workspace);
          const observationId = hash(
            JSON.stringify([
              randomBytes(32).toString("hex"),
              scope.runtimeEpoch,
              workspace,
              ctx.executable,
              observed.fingerprint,
            ]),
          );
          const response = {
            ...base,
            status: "available",
            observationId,
            repository: observed.repository,
            branches: observed.branches,
            files: observed.files,
            contentDigest: observed.contentDigest,
          };
          validateGitReviewObservation({
            runtimeEpoch: scope.runtimeEpoch,
            revision: 0,
            ...response,
          });
          // Metadata only: never retain indexes, object/config/file/patch buffers.
          observations.set(observationId, {
            sender: scope.sender,
            epoch: scope.runtimeEpoch,
            workspaceId: workspace.id,
            root: workspace.path,
            ...authority,
            fingerprint: observed.fingerprint,
            executable: ctx.executable,
            created: now(),
            branches: observed.branches.map((b) => ({ ...b })),
            invalidated: false,
          });
          const local = [...observations].filter(
            ([, o]) => o.workspaceId === workspace.id,
          );
          while (local.length > limits.observationsPerWorkspace)
            retire(local.shift()[0]);
          while (observations.size > limits.observations)
            retire(observations.keys().next().value);
          return response;
        },
        validateGitReviewObservation,
      );
    },
    async diff(workspace, request, scope = {}) {
      validateScope(workspace, scope);
      validateGitReviewRequest(request);
      if (
        request.type !== "git.diff.read" ||
        request.workspaceId !== workspace.id
      )
        fail("INVALID_REQUEST");
      const original = observations.get(request.observationId);
      if (
        !original ||
        original.sender !== scope.sender ||
        original.epoch !== scope.runtimeEpoch ||
        original.workspaceId !== workspace.id ||
        original.root !== workspace.path
      )
        fail("INVALID_REQUEST");
      const selectedBase =
        request.mode === "base"
          ? original.branches.find((b) => b.name === request.baseRef)
          : null;
      if (request.mode === "base" && !selectedBase) fail("INVALID_REQUEST");
      const base = {
        workspaceId: workspace.id,
        workspacePath: workspace.path,
        observationId: request.observationId,
        mode: request.mode,
        path: request.path,
        ...(selectedBase
          ? { baseRef: selectedBase.name, baseOid: selectedBase.oid }
          : {}),
      };
      const unavailable = (reason) => ({
        ...base,
        status: "unavailable",
        reason,
      });
      if (now() - original.created >= limits.observationMs)
        return unavailable("expired_observation");
      if (
        original.trusted !== scope.trusted ||
        original.trustRevision !== scope.trustRevision
      )
        original.invalidated = true;
      if (original.invalidated) return unavailable("stale_observation");
      if (workspaceFilePathReason(request.path))
        return unavailable("protected_source");
      const result = await run(
        workspace,
        scope,
        base,
        async (ctx) => {
          const observed = await observe(ctx, workspace);
          if (
            observed.fingerprint !== original.fingerprint ||
            ctx.executable !== original.executable
          ) {
            original.invalidated = true;
            return unavailable("stale_observation");
          }
          const row = observed.files.find((r) => r.path === request.path);
          const entries = observed.index.filter((e) => e.path === request.path);
          if (row?.kind === "conflict" || entries.some((e) => e.stage !== 0))
            return unavailable("conflict");
          const indexEntry = entries[0] ?? null;
          if (request.mode === "staged" && (!row || row.index === "none"))
            return unavailable("not_staged");
          await checkedAttributes(
            ctx,
            [request.path],
            selectedBase ? [`--source=${selectedBase.oid}`] : [],
          );
          const oldEntry =
            request.mode === "staged"
              ? await treeEntry(ctx, observed.repository.head, request.path)
              : selectedBase
                ? await treeEntry(ctx, selectedBase.oid, request.path)
                : indexEntry;
          const oldBytes = await blob(ctx, oldEntry);
          const indexBytes = await blob(ctx, indexEntry);
          // Guard even staged detail's current path, but permit a real deletion.
          const current = await readWorkspaceFile(
            { id: workspace.id, path: ctx.worktree },
            request.path,
            { io, check: ctx.check },
          );
          if (
            current.status !== "available" &&
            !["missing_file", "path_missing"].includes(current.reason)
          )
            return unavailable(
              current.reason === "unsupported_content"
                ? "binary"
                : current.reason === "file_changed"
                  ? "path_changed"
                  : current.reason,
            );
          const currentBytes =
            current.status === "available"
              ? Buffer.from(current.content)
              : Buffer.alloc(0);
          if (currentBytes.length > limits.sourceBytes)
            return unavailable("too_large");
          let patch;
          if (request.mode === "staged")
            patch = await execute(
              ctx,
              "staged",
              [observed.repository.head, request.path],
              null,
              limits.patchBytes + 1,
            );
          else if (!indexEntry) {
            if (!oldEntry && current.status !== "available")
              return unavailable("missing_file");
            const baseline =
              oldEntry ??
              (await emptyBlob(ctx, observed.repository.objectFormat));
            // Preserve every original attribute/index entry. Only the selected
            // comparison baseline is generated; original fingerprint stays intact.
            await writeComparisonIndex(
              ctx,
              [
                ...observed.index.filter((e) => e.path !== request.path),
                { ...baseline, path: request.path, stage: 0 },
              ],
              observed.repository.objectFormat,
              !(await io.lstat(join(ctx.git, "index")).then(
                () => true,
                () => false,
              )),
            );
            patch = await execute(
              ctx,
              "unstaged",
              [request.path],
              null,
              limits.patchBytes + 1,
            );
          } else
            patch = await execute(
              ctx,
              selectedBase ? "base" : "unstaged",
              selectedBase ? [selectedBase.oid, request.path] : [request.path],
              null,
              limits.patchBytes + 1,
            );
          const after = await readWorkspaceFile(
            { id: workspace.id, path: ctx.worktree },
            request.path,
            {
              io,
              check: ctx.check,
            },
          );
          if (
            after.status !== current.status ||
            after.version !== current.version ||
            after.reason !== current.reason
          ) {
            original.invalidated = true;
            return unavailable("stale_observation");
          }
          const text = decode(patch, "binary");
          if (text.startsWith("Binary files ") || /\nBinary files /.test(text))
            return unavailable("binary");
          if (
            patch.length > limits.patchBytes ||
            !workspaceFileContentFits(text) ||
            (text ? text.split("\n").length - Number(text.endsWith("\n")) : 0) >
              limits.patchLines ||
            (text.match(/^@@ /gm)?.length ?? 0) > limits.patchHunks
          )
            return unavailable("too_large");
          await ctx.sources.verify();
          return {
            ...base,
            status: "available",
            patch: text,
            sourceDigest: hash(
              JSON.stringify([
                request.observationId,
                request.mode,
                request.path,
                oldEntry,
                indexEntry,
                hash(oldBytes),
                hash(indexBytes),
                hash(currentBytes),
                ctx.sources.files.get(join(workspace.path, request.path))
                  ?.sig ?? null,
                ctx.sources.files.get(join(workspace.path, request.path))
                  ?.mode ?? null,
              ]),
            ),
          };
        },
        validateGitDiffObservation,
      );
      if (
        ["stale_observation", "path_changed", "metadata_changed"].includes(
          result.reason,
        )
      )
        original.invalidated = true;
      return result;
    },
    closeSender(sender) {
      indexManager.retireSender(sender);
      commitManager.retireSender(sender);
      branchRestoreManager.retireSender(sender);
      for (const [id, o] of observations) if (o.sender === sender) retire(id);
      for (const a of active.values())
        if (a.sender === sender) a.controller.abort();
    },
    async close() {
      closed = true;
      observations.clear();
      indexManager.retireAll();
      commitManager.retireAll();
      branchRestoreManager.retireAll();
      const reads = [...active.values()];
      for (const a of reads) a.controller.abort();
      await Promise.allSettled(reads.map((a) => a.done));
    },
  };
  const authority = {
    run,
    validateScope,
    now,
    limits,
    getObservation: (id) => observations.get(id),
    retireWorkspace: (workspaceId) => {
      for (const [id, o] of observations)
        if (o.workspaceId === workspaceId) retire(id);
    },
    closeSender: (sender) => reader.closeSender(sender),
    close: () => reader.close(),
  };
  const indexManager = createWorkbenchGitIndexManager(authority);
  const commitManager = createWorkbenchGitCommitManager(authority);
  const branchRestoreManager =
    createWorkbenchGitBranchRestoreManager(authority);
  return { reader, indexManager, commitManager, branchRestoreManager };
}

export function createWorkbenchGitReader(options = {}) {
  return createWorkbenchGitAccess(options).reader;
}
