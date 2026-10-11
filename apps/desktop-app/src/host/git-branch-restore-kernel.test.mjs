import assert from "node:assert/strict";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createGitMetadataKernel } from "./git-metadata-kernel.mjs";
import { createGitBranchRestoreKernel } from "./git-branch-restore-kernel.mjs";
import {
  gitBranchRestoreBlob,
  gitBranchRestoreBackupId,
  gitBranchRestoreExpectedBackups,
  gitBranchRestoreIdentityDigest,
  gitBranchRestoreOccupancyDigest,
  GIT_BRANCH_RESTORE_STATE_MARKERS,
  validateGitBranchRestoreKernelRequest,
  validateGitBranchRestoreArtifactManifest,
} from "./git-branch-restore-contract.mjs";
import { gitBranchRestoreMode } from "../renderer/shared/git-branch-restore/index.mjs";
const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const hash = (b, format = "sha256") =>
  createHash(format).update(b).digest("hex");
const sig = (s) =>
  [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(":");
const inode = (path) => {
  const s = fs.lstatSync(path, { bigint: true });
  return { path, dev: String(s.dev), ino: String(s.ino) };
};
const write = (path, bytes, mode = 0o600) => {
  fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  fs.writeFileSync(path, bytes, { mode });
};
function index(entries, format) {
  const width = format === "sha1" ? 20 : 32,
    h = Buffer.alloc(12);
  h.write("DIRC");
  h.writeUInt32BE(2, 4);
  h.writeUInt32BE(entries.length, 8);
  const body = Buffer.concat([
    h,
    ...entries.map((e) => {
      const name = Buffer.from(e.path + "\0"),
        b = Buffer.alloc(Math.ceil((42 + width + name.length) / 8) * 8);
      b.writeUInt32BE(e.mode, 24);
      Buffer.from(e.oid, "hex").copy(b, 40);
      b.writeUInt16BE(name.length - 1, 40 + width);
      name.copy(b, 42 + width);
      return b;
    }),
  ]);
  return Buffer.concat([body, createHash(format).update(body).digest()]);
}
function snapshot(root, common, missing) {
  const dirs = new Map(),
    files = [],
    listings = [];
  function ancestor(path) {
    if (dirs.has(path)) return;
    if (dirname(path) !== path) ancestor(dirname(path));
    dirs.set(path, inode(path));
  }
  function walk(path) {
    ancestor(path);
    const names = fs.readdirSync(path).sort();
    listings.push({ path, names });
    for (const name of names) {
      const p = join(path, name);
      if (fs.lstatSync(p).isDirectory()) walk(p);
      else
        files.push({
          path: p,
          signature: sig(fs.lstatSync(p, { bigint: true })),
          digest: hash(fs.readFileSync(p)),
        });
    }
  }
  walk(root);
  if (!common.startsWith(root + "/")) walk(common);
  return {
    directories: [...dirs.values()],
    files,
    listings,
    missing: [...new Set(missing)],
  };
}
function setup(base, name, o = {}) {
  const home = join(base, name),
    root = join(home, "workspace"),
    artifact = join(home, "artifact");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });
  fs.mkdirSync(artifact, { mode: 0o700 });
  const common = o.linked ? join(home, "metadata") : join(root, ".git");
  fs.mkdirSync(common, { mode: 0o700 });
  const git = o.linked ? join(common, "worktrees/selected") : common;
  fs.mkdirSync(join(common, "objects"), { mode: 0o700 });
  fs.mkdirSync(join(common, "refs/heads"), { recursive: true, mode: 0o700 });
  if (o.linked) {
    fs.mkdirSync(git, { recursive: true, mode: 0o700 });
    write(join(root, ".git"), `gitdir: ${git}\n`);
    write(join(git, "gitdir"), join(root, ".git") + "\n");
    write(join(git, "commondir"), "../..\n");
  }
  const format = o.format ?? "sha1",
    action = o.action ?? "restore",
    source = action === "restore" ? (o.source ?? "index") : null;
  const author =
      action === "restore"
        ? null
        : { name: "Synthetic User", email: "synthetic@example.invalid" },
    timestamp = action === "restore" ? null : 1700000000;
  const proofs = new Map();
  const object = (type, body) => {
    body = Buffer.from(body);
    const full = Buffer.concat([Buffer.from(`${type} ${body.length}\0`), body]),
      oid = hash(full, format);
    proofs.set(oid, { type, body, full });
    write(
      join(common, "objects", oid.slice(0, 2), oid.slice(2)),
      deflateSync(full),
    );
    return oid;
  };
  const old = object("blob", o.raw ?? "old\n"),
    next = object("blob", o.next ?? "new\n"),
    keep = object("blob", "protected sentinel\n");
  const mode = o.gitMode ?? 0o100644;
  const paths = Array.from(
    { length: o.count ?? 1 },
    (_, i) =>
      o.fileName ??
      (o.nested
        ? `new/parents/file-${String(i).padStart(3, "0")}.txt`
        : `file-${String(i).padStart(3, "0")}.txt`),
  );
  const sort = (xs) =>
    xs.sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const oldEntries = sort([
    { path: ".env", mode: 0o100644, oid: keep },
    ...paths.map((path) => ({
      path,
      mode: o.oldGitMode ?? (action === "restore" ? mode : 0o100644),
      oid: old,
    })),
  ]);
  const desired = sort([
    { path: ".env", mode: 0o100644, oid: keep },
    ...(o.deletion
      ? []
      : paths.map((path) => ({
          path,
          mode,
          oid: action === "select" ? next : old,
        }))),
  ]);
  if (o.ident) {
    const attr = object("blob", "*.txt ident\n");
    oldEntries.push({ path: ".gitattributes", mode: 0o100644, oid: attr });
    desired.push({ path: ".gitattributes", mode: 0o100644, oid: attr });
    sort(oldEntries);
    sort(desired);
    write(join(root, ".gitattributes"), "*.txt ident\n");
  }
  function tree(entries) {
    const groups = new Map();
    for (const e of entries) {
      const at = e.path.indexOf("/");
      const name = at < 0 ? e.path : e.path.slice(0, at);
      if (at < 0) groups.set(name, e);
      else {
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push({ ...e, path: e.path.slice(at + 1) });
      }
    }
    const nodes = [...groups].map(([name, e]) =>
      Array.isArray(e)
        ? { name, mode: "40000", oid: tree(e) }
        : { name, mode: e.mode.toString(8), oid: e.oid },
    );
    nodes.sort((a, b) =>
      Buffer.compare(
        Buffer.from(a.name + (a.mode === "40000" ? "/" : "")),
        Buffer.from(b.name + (b.mode === "40000" ? "/" : "")),
      ),
    );
    return object(
      "tree",
      Buffer.concat(
        nodes.flatMap((e) => [
          Buffer.from(`${e.mode} ${e.name}\0`),
          Buffer.from(e.oid, "hex"),
        ]),
      ),
    );
  }
  const oldTree = tree(
      o.deletion && action === "restore" ? desired : oldEntries,
    ),
    newTree = tree(desired);
  const commit = (tree) =>
    object(
      "commit",
      `tree ${tree}\nauthor Synthetic <synthetic@example.invalid> 1 +0000\ncommitter Synthetic <synthetic@example.invalid> 1 +0000\n\nfixture\n`,
    );
  const head = commit(oldTree),
    nextHead = action === "select" ? commit(newTree) : head;
  write(
    join(common, "config"),
    `[core]\nrepositoryformatversion = ${format === "sha1" ? 0 : 1}\nbare = false\nautocrlf = false\neol = lf\nlogAllRefUpdates = ${o.disabled ? "false" : "true"}\n${o.fileModeFalse ? "filemode = false\n" : ""}${format === "sha256" ? "[extensions]\nobjectFormat = sha256\n" : ""}`,
  );
  write(join(common, "HEAD"), "ref: refs/heads/main\n");
  write(join(git, "HEAD"), o.detached ? head + "\n" : "ref: refs/heads/main\n");
  write(join(common, "refs/heads/main"), head + "\n");
  if (action === "select")
    write(join(common, "refs/heads/topic"), nextHead + "\n");
  write(join(git, "index"), index(oldEntries, format));
  write(join(root, ".env"), "protected sentinel\n");
  write(join(root, "untracked.bin"), Buffer.from([0, 1, 255]));
  fs.mkdirSync(join(root, "empty"), { mode: 0o700 });
  for (const path of paths)
    if (!o.absent)
      write(
        join(root, path),
        action === "select" || action === "create"
          ? gitBranchRestoreBlob(proofs.get(old).body, old, format, !!o.ident)
          : (o.dirty ?? "dirty\n"),
        o.oldMode ?? 0o600,
      );
  const state = (path, withMode = false) => {
    if (!fs.existsSync(path)) return null;
    const b = fs.readFileSync(path);
    return {
      bytes: b.length,
      digest: hash(b),
      ...(withMode ? { mode: fs.statSync(path).mode & 0o777 } : {}),
    };
  };
  const wt =
    action === "create"
      ? []
      : paths.map((path, i) => {
          const before = state(join(root, path), true),
            entry = desired.find((e) => e.path === path),
            afterEntry = entry ? { mode: entry.mode, oid: entry.oid } : null;
          const bytes = entry
            ? gitBranchRestoreBlob(
                proofs.get(entry.oid).body,
                entry.oid,
                format,
                !!o.ident,
              )
            : null;
          if (bytes) write(join(artifact, `worktree/${i}`), bytes);
          return {
            path,
            before,
            after: bytes
              ? {
                  bytes: bytes.length,
                  digest: hash(bytes),
                  mode: gitBranchRestoreMode(
                    before?.mode ?? null,
                    entry.mode === 0o100755,
                  ),
                }
              : null,
            beforeEntry: {
              mode: o.oldGitMode ?? (action === "restore" ? mode : 0o100644),
              oid: old,
            },
            afterEntry,
            ident: !!entry && !!o.ident,
          };
        });
  const branch = action === "restore" ? null : "refs/heads/topic";
  const logPath =
    action === "create" ? join(common, "logs", branch) : join(git, "logs/HEAD");
  if (o.existingLog) write(logPath, "synthetic-prefix\n");
  const proposals = [];
  if (action === "select")
    proposals.push(["index", join(git, "index"), index(desired, format)]);
  if (action !== "restore" && (!o.disabled || o.existingLog)) {
    const prefix = fs.existsSync(logPath)
      ? fs.readFileSync(logPath)
      : Buffer.alloc(0);
    const oldOid = action === "create" ? "0".repeat(head.length) : head;
    const reason =
      action === "create"
        ? "branch: Created from HEAD"
        : `checkout: moving from ${o.detached ? head : "main"} to topic`;
    proposals.push([
      action === "create" ? "branch_log" : "head_log",
      logPath,
      Buffer.concat([
        prefix,
        Buffer.from(
          `${oldOid} ${nextHead} ${author.name} <${author.email}> ${timestamp} +0000\t${reason}\n`,
        ),
      ]),
    ]);
  }
  if (action !== "restore")
    proposals.push([
      action === "create" ? "branch_ref" : "head_ref",
      action === "create" ? join(common, branch) : join(git, "HEAD"),
      Buffer.from(
        action === "create" ? head + "\n" : "ref: refs/heads/topic\n",
      ),
    ]);
  for (const [role, , bytes] of proposals)
    write(join(artifact, `proposal.${role}`), bytes);
  const occupancy = () => {
    const rows = [];
    for (const dir of [
      common,
      ...(fs.existsSync(join(common, "worktrees"))
        ? fs
            .readdirSync(join(common, "worktrees"))
            .map((n) => join(common, "worktrees", n))
        : []),
    ])
      rows.push([
        dir,
        hash(fs.readFileSync(join(dir, "HEAD"))),
        ...["gitdir", "commondir", "locked"].map((n) =>
          fs.existsSync(join(dir, n))
            ? hash(fs.readFileSync(join(dir, n)))
            : null,
        ),
      ]);
    return gitBranchRestoreOccupancyDigest(
      rows.sort((a, b) => Buffer.compare(Buffer.from(a[0]), Buffer.from(b[0]))),
    );
  };
  const target = {
    action,
    objectFormat: format,
    previewDigest: hash("preview"),
    occupancyDigest: occupancy(),
    branch,
    source,
    currentBranch: o.detached ? null : "refs/heads/main",
    headOid: head,
    nextHeadOid: nextHead,
    treeOid: action === "select" ? newTree : oldTree,
    headDigest: state(join(git, "HEAD")).digest,
    indexExists: true,
    indexDigest: state(join(git, "index")).digest,
    identityDigest: author
      ? gitBranchRestoreIdentityDigest(author, timestamp)
      : null,
    timestamp,
    paths: wt,
    metadata: proposals.map(([role, path, bytes]) => ({
      role,
      before: state(path),
      after: { bytes: bytes.length, digest: hash(bytes) },
    })),
  };
  const missing = [
    ...GIT_BRANCH_RESTORE_STATE_MARKERS.map((n) => join(git, n)),
    join(common, "packed-refs"),
    join(common, "worktrees"),
    join(git, "config.worktree"),
    join(common, "info"),
    join(common, "info/attributes"),
    join(common, "refs/heads/topic"),
  ];
  if (action !== "restore") missing.push(logPath);
  for (const p of [
    join(git, "index"),
    ...paths.map((p) => join(root, p)),
    ...proposals.map((p) => p[1]),
    ...(action !== "restore" ? [logPath] : []),
  ]) {
    let q = p;
    while (!fs.existsSync(q)) {
      missing.push(q);
      q = dirname(q);
    }
  }
  const request = {
    runtimeEpoch: "old-epoch",
    operationId: "same-key",
    workspaceId: "synthetic",
    workspacePath: root,
    digest: hash("source"),
    target,
    artifact: {
      root: artifact,
      ...Object.fromEntries(
        Object.entries(inode(artifact)).filter(([k]) => k !== "path"),
      ),
      manifest: { path: "manifest.json", bytes: 1, digest: hash("manifest") },
    },
  };
  const manifest = {
    schemaVersion: 1,
    feature: "git_branch_restore_mutation_v1",
    ...Object.fromEntries(
      Object.entries(request).filter(([k]) => k !== "artifact"),
    ),
    layout: {
      root: inode(root),
      gitDirectory: inode(git),
      commonDirectory: inode(common),
    },
    source: snapshot(
      root,
      common,
      missing.filter((p) => !fs.existsSync(p)),
    ),
    author,
    currentEntries: oldEntries,
    desiredEntries:
      action === "select" || source === "head" ? desired : oldEntries,
    worktree: wt.map((p, i) => ({
      path: p.path,
      proposal: p.after
        ? {
            path: `worktree/${i}`,
            bytes: p.after.bytes,
            digest: p.after.digest,
          }
        : null,
    })),
    metadata: proposals.map(([role, , b]) => ({
      role,
      proposal: { path: `proposal.${role}`, bytes: b.length, digest: hash(b) },
    })),
    objects: [...proofs].map(([oid, p]) => {
      write(join(artifact, "objects", oid), p.body);
      return {
        oid,
        type: p.type,
        rawBytes: p.body.length,
        path: `objects/${oid}`,
        bytes: p.body.length,
        digest: hash(p.body),
        install: false,
      };
    }),
  };
  const save = () => {
    manifest.target = request.target;
    const b = Buffer.from(JSON.stringify(manifest));
    write(join(artifact, "manifest.json"), b);
    request.artifact.manifest = {
      path: "manifest.json",
      bytes: b.length,
      digest: hash(b),
    };
    validateGitBranchRestoreKernelRequest(request);
    validateGitBranchRestoreArtifactManifest(manifest, request);
  };
  save();
  return {
    root,
    artifact,
    git,
    common,
    request,
    manifest,
    save,
    paths,
    occupancy,
  };
}
function unchanged(f, except = []) {
  return f.manifest.source.files
    .filter((x) => !except.includes(x.path))
    .map((x) => ({
      path: x.path,
      bytes: fs.readFileSync(x.path).toString("hex"),
      signature: sig(fs.lstatSync(x.path, { bigint: true })),
    }));
}
async function fixtures(base) {
  const evidence = [];
  const run = async (name, fn) => {
    if (process.argv[4] && name !== process.argv[4]) return;
    const at = performance.now();
    const observed = await fn();
    evidence.push({
      name,
      status: "pass",
      elapsedMs: performance.now() - at,
      ...(observed ? { observed } : {}),
    });
    fs.writeFileSync(
      join(base, "report.json"),
      JSON.stringify({ evidence }, null, 2),
    );
  };
  for (const action of ["create", "select", "restore"])
    for (const format of ["sha1", "sha256"])
      await run(`${action}-${format}`, async () => {
        const f = setup(base, `${action}-${format}`, { action, format });
        const allowed = [
          ...f.request.target.paths.map((x) => join(f.root, x.path)),
          ...f.request.target.metadata.map((m) =>
            m.role === "index"
              ? join(f.git, "index")
              : m.role === "head_ref"
                ? join(f.git, "HEAD")
                : m.role === "head_log"
                  ? join(f.git, "logs/HEAD")
                  : join(
                      f.common,
                      m.role === "branch_ref"
                        ? f.request.target.branch
                        : "logs/" + f.request.target.branch,
                    ),
          ),
        ];
        const before = unchanged(f, allowed);
        const k = await createGitBranchRestoreKernel();
        try {
          const p = await k.prepare(f.request);
          assert.equal(p.status, "prepared", JSON.stringify(p));
          const r = await k.publish({ token: p.token });
          assert.equal(r.status, "applied", JSON.stringify(r));
          assert.deepEqual(
            r.backups,
            gitBranchRestoreExpectedBackups(
              f.request.target,
              "old-epoch",
              "same-key",
            ),
          );
          assert.deepEqual(await k.publish({ token: p.token }), r);
          for (const x of f.request.target.paths) {
            const path = join(f.root, x.path);
            if (x.after) {
              assert.equal(hash(fs.readFileSync(path)), x.after.digest);
              assert.equal(fs.statSync(path).mode & 0o777, x.after.mode);
            } else assert.equal(fs.existsSync(path), false);
          }
          assert.deepEqual(unchanged(f, allowed), before);
        } finally {
          await k.close();
        }
      });
  const apply = async (name, options, inspect = () => {}) =>
    run(name, async () => {
      const f = setup(base, name, options),
        old = new Map(
          f.manifest.source.files.map((x) => [
            x.path,
            { ino: inode(x.path), bytes: fs.readFileSync(x.path) },
          ]),
        );
      const k = await createGitBranchRestoreKernel();
      try {
        const p = await k.prepare(f.request);
        assert.equal(p.status, "prepared", JSON.stringify(p));
        for (const leaf of ["index.lock", "HEAD.lock"])
          assert.equal(fs.existsSync(join(f.git, leaf)), true);
        const r = await k.publish({ token: p.token });
        assert.equal(r.status, "applied", JSON.stringify(r));
        for (const x of f.request.target.paths) {
          const path = join(f.root, x.path),
            backup = join(
              f.git,
              gitBranchRestoreBackupId(
                "old-epoch",
                "same-key",
                "worktree",
                x.path,
              ),
            );
          if (x.after) {
            assert.equal(hash(fs.readFileSync(path)), x.after.digest);
            assert.equal(fs.statSync(path).mode & 0o777, x.after.mode);
          } else assert.equal(fs.existsSync(path), false);
          if (x.before) {
            assert.equal(inode(backup).ino, old.get(path).ino.ino);
            assert.deepEqual(fs.readFileSync(backup), old.get(path).bytes);
          } else assert.equal(fs.existsSync(backup), false);
        }
        for (const leaf of ["index.lock", "HEAD.lock"])
          assert.equal(fs.existsSync(join(f.git, leaf)), false);
        inspect(f, r);
      } finally {
        await k.close();
      }
    });
  for (const [name, o] of [
    ["delete-head", { source: "head", deletion: true }],
    ["missing-tracked-new-parents", { nested: true, absent: true }],
    ["select-delete", { action: "select", deletion: true }],
    ["restore-head", { source: "head" }],
    ["select-detached", { action: "select", detached: true }],
    ["restore-linked", { linked: true }],
    ["create-linked", { action: "create", linked: true }],
    ["select-linked", { action: "select", linked: true }],
    [
      "ident-bom-crlf-binary",
      { ident: true, raw: Buffer.from("\ufeff$Id$\r\n\0tail\r\n") },
    ],
    ["mode-to-executable", { gitMode: 0o100755, oldMode: 0o640 }],
    ["mode-remove-executable", { gitMode: 0o100644, oldMode: 0o750 }],
    [
      "mode-filemode-false",
      { fileModeFalse: true, gitMode: 0o100755, oldMode: 0o640 },
    ],
    ["new-executable", { absent: true, gitMode: 0o100755 }],
    ["bulk-eight", { count: 8 }],
    ["log-policy-false-absent", { action: "create", disabled: true }],
    [
      "log-policy-false-existing",
      { action: "create", disabled: true, existingLog: true },
    ],
    [
      "select-log-policy-false-existing",
      { action: "select", disabled: true, existingLog: true },
    ],
  ])
    await apply(name, o);
  const refresh = (f) => {
    f.manifest.source = snapshot(
      f.root,
      f.common,
      f.manifest.source.missing.filter((p) => !fs.existsSync(p)),
    );
    f.save();
  };
  for (const action of ["create", "restore"])
    await run(`readonly-unchanged-${action}`, async () => {
      const f = setup(base, `readonly-unchanged-${action}`, { action });
      for (const name of ["index", "HEAD"])
        fs.chmodSync(join(f.git, name), 0o400);
      refresh(f);
      const before = unchanged(f, [...f.paths.map((p) => join(f.root, p))]);
      const k = await createGitBranchRestoreKernel();
      try {
        const p = await k.prepare(f.request);
        assert.equal(p.status, "prepared", JSON.stringify(p));
        assert.equal((await k.publish({ token: p.token })).status, "applied");
        assert.deepEqual(
          unchanged(
            f,
            f.paths.map((p) => join(f.root, p)),
          ),
          before,
        );
      } finally {
        await k.close();
      }
    });
  const refuse = async (name, options, change, reasons) =>
    run(name, async () => {
      const f = setup(base, name, options);
      change(f);
      const before = unchanged(f);
      const k = await createGitBranchRestoreKernel();
      try {
        const r = await k.prepare(f.request);
        assert.equal(r.status, "unknown", JSON.stringify(r));
        assert.ok(reasons.includes(r.reason), JSON.stringify(r));
        assert.deepEqual(unchanged(f), before);
      } finally {
        await k.close();
      }
    });
  for (const action of ["create", "select", "restore"])
    for (const marker of GIT_BRANCH_RESTORE_STATE_MARKERS)
      await refuse(
        `marker-${action}-${marker}`,
        { action },
        (f) => write(join(f.git, marker), "synthetic marker\n"),
        ["unsupported_branch_restore_state"],
      );
  await refuse(
    "dirty-select",
    { action: "select" },
    (f) => {
      write(join(f.root, f.paths[0]), "dirty\n");
      refresh(f);
    },
    ["unsupported_branch_restore"],
  );
  await refuse(
    "protected-tree-change",
    { action: "select" },
    (f) => {
      f.manifest.desiredEntries[0].oid = f.manifest.desiredEntries.at(-1).oid;
      f.save();
    },
    ["invalid_request"],
  );
  await refuse(
    "forged-ident",
    {},
    (f) => {
      f.request.target.paths[0].ident = true;
      f.save();
    },
    ["invalid_request"],
  );
  await refuse(
    "forged-raw-graph",
    {},
    (f) => {
      const x = f.manifest.objects.find((x) => x.type === "tree");
      const b = fs.readFileSync(join(f.artifact, x.path));
      b[0] ^= 1;
      write(join(f.artifact, x.path), b);
      x.digest = hash(b);
      f.save();
    },
    ["object_conflict"],
  );
  await refuse(
    "forged-reflog-reason",
    { action: "create" },
    (f) => {
      const x = f.manifest.metadata.find((x) => x.role === "branch_log"),
        b = Buffer.from(
          fs
            .readFileSync(join(f.artifact, x.proposal.path))
            .toString()
            .replace("Created", "Forged!"),
        );
      write(join(f.artifact, x.proposal.path), b);
      x.proposal.bytes = b.length;
      x.proposal.digest = hash(b);
      f.request.target.metadata[0].after = { bytes: b.length, digest: hash(b) };
      f.save();
    },
    ["invalid_request"],
  );
  for (const field of [
    "autocrlf = true",
    "eol = crlf",
    "attributesFile = /dev/null",
  ])
    await refuse(
      `unsupported-${field.split(" ")[0]}`,
      {},
      (f) => {
        fs.appendFileSync(join(f.common, "config"), field + "\n");
        refresh(f);
      },
      ["unsupported_branch_restore"],
    );
  await refuse(
    "unsupported-attributes",
    {},
    (f) => {
      write(join(f.root, ".gitattributes"), "*.txt eol=crlf\n");
      refresh(f);
    },
    ["unsupported_branch_restore"],
  );
  await refuse(
    "readonly-target",
    {},
    (f) => {
      fs.chmodSync(join(f.root, f.paths[0]), 0o400);
      f.request.target.paths[0].before.mode = 0o400;
      f.request.target.paths[0].after.mode = 0o400;
      refresh(f);
    },
    ["path_denied"],
  );
  await refuse(
    "foreign-index-lock",
    {},
    (f) => write(join(f.git, "index.lock"), "foreign\n"),
    ["metadata_changed", "lock_conflict"],
  );
  await refuse(
    "foreign-head-lock",
    {},
    (f) => {
      write(join(f.git, "HEAD.lock"), "foreign\n");
      refresh(f);
    },
    ["lock_conflict"],
  );
  await refuse(
    "foreign-backup",
    {},
    (f) => {
      write(
        join(
          f.git,
          gitBranchRestoreBackupId(
            "old-epoch",
            "same-key",
            "worktree",
            f.paths[0],
          ),
        ),
        "foreign\n",
      );
      refresh(f);
    },
    ["backup_conflict"],
  );
  await refuse(
    "occupied-unborn",
    { action: "create", linked: true },
    (f) => {
      write(join(f.common, "worktrees/other/HEAD"), "ref: refs/heads/topic\n");
      write(
        join(f.common, "worktrees/other/gitdir"),
        "/synthetic/not-opened/.git\n",
      );
      write(join(f.common, "worktrees/other/commondir"), "../..\n");
      f.request.target.occupancyDigest = f.occupancy();
      refresh(f);
    },
    ["branch_occupied"],
  );
  await refuse(
    "case-ref-collision",
    { action: "create" },
    (f) => {
      write(
        join(f.common, "refs/heads/Topic"),
        f.request.target.headOid + "\n",
      );
      refresh(f);
    },
    ["branch_conflict"],
  );
  await refuse(
    "ref-prefix-collision",
    { action: "create" },
    (f) => {
      write(
        join(f.common, "refs/heads/topic/child"),
        f.request.target.headOid + "\n",
      );
      refresh(f);
    },
    ["branch_conflict"],
  );
  await run("same-lane-wrong-kind-abort", async () => {
    const f = setup(base, "same-lane-wrong-kind-abort"),
      core = await createGitMetadataKernel();
    const before = unchanged(f);
    try {
      const p = await core.branchRestore.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal(
        (await core.index.publish({ token: p.token })).reason,
        "invalid_request",
      );
      assert.equal(
        (await core.commit.abort({ token: p.token })).reason,
        "invalid_request",
      );
      assert.equal(
        (await core.branchRestore.prepare(f.request)).reason,
        "invalid_request",
      );
      assert.equal(
        (await core.branchRestore.abort({ token: p.token })).status,
        "aborted",
      );
      assert.deepEqual(unchanged(f), before);
    } finally {
      await core.close();
    }
  });
  for (const action of ["create", "select", "restore"])
    await run(`marker-effect-${action}`, async () => {
      const f = setup(base, `marker-effect-${action}`, { action }),
        before = unchanged(f);
      let inserted = false;
      const k = await createGitBranchRestoreKernel({
        check() {
          if (!inserted && fs.existsSync(join(f.git, "index.lock"))) {
            inserted = true;
            write(join(f.git, "MERGE_HEAD"), "late marker\n");
          }
        },
      });
      try {
        const r = await k.prepare(f.request);
        assert.equal(inserted, true);
        assert.equal(r.reason, "unsupported_branch_restore_state");
        assert.deepEqual(unchanged(f), before);
        assert.equal(fs.existsSync(join(f.git, "index.lock")), true);
      } finally {
        await k.close();
      }
    });
  await run("partial-retains-no-replay", async () => {
    const f = setup(base, "partial-retains-no-replay", {
        action: "select",
        count: 2,
      }),
      head = fs.readFileSync(join(f.git, "HEAD")),
      ix = fs.readFileSync(join(f.git, "index"));
    let inserted = false;
    const k = await createGitBranchRestoreKernel({
      check() {
        if (
          !inserted &&
          hash(fs.readFileSync(join(f.root, f.paths[0]))) ===
            f.request.target.paths[0].after.digest
        ) {
          inserted = true;
          write(join(f.git, "MERGE_HEAD"), "late marker\n");
        }
      },
    });
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      const r = await k.publish({ token: p.token });
      assert.equal(r.reason, "unsupported_branch_restore_state");
      assert.equal(inserted, true);
      assert.deepEqual(await k.publish({ token: p.token }), r);
      assert.deepEqual(fs.readFileSync(join(f.git, "HEAD")), head);
      assert.deepEqual(fs.readFileSync(join(f.git, "index")), ix);
      assert.equal(
        hash(fs.readFileSync(join(f.root, f.paths[1]))),
        f.request.target.paths[1].before.digest,
      );
      assert.equal(
        inode(
          join(
            f.git,
            gitBranchRestoreBackupId(
              "old-epoch",
              "same-key",
              "worktree",
              f.paths[0],
            ),
          ),
        ).ino,
        f.manifest.source.files
          .find((x) => x.path === join(f.root, f.paths[0]))
          .signature.split(":")[1],
      );
    } finally {
      await k.close();
    }
  });
  await run("source-ABA-before-publish", async () => {
    const f = setup(base, "source-ABA-before-publish"),
      k = await createGitBranchRestoreKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared");
      const path = join(f.root, "untracked.bin"),
        b = fs.readFileSync(path);
      fs.writeFileSync(path, Buffer.from([9, 9, 9]));
      fs.writeFileSync(path, b);
      const r = await k.publish({ token: p.token });
      assert.equal(r.reason, "metadata_changed");
      assert.equal(
        hash(fs.readFileSync(join(f.root, f.paths[0]))),
        f.request.target.paths[0].before.digest,
      );
    } finally {
      await k.close();
    }
  });
  await run("artifact-replacement-before-publish", async () => {
    const f = setup(base, "artifact-replacement-before-publish"),
      k = await createGitBranchRestoreKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared");
      const path = join(f.artifact, "worktree/0"),
        b = fs.readFileSync(path);
      fs.renameSync(path, path + ".kept");
      write(path, b);
      assert.equal(
        (await k.publish({ token: p.token })).reason,
        "metadata_changed",
      );
    } finally {
      await k.close();
    }
  });
  await run("close-retains-prepared-artifacts", async () => {
    const f = setup(base, "close-retains-prepared-artifacts"),
      k = await createGitBranchRestoreKernel(),
      before = unchanged(f);
    const p = await k.prepare(f.request);
    assert.equal(p.status, "prepared");
    await k.close();
    assert.deepEqual(unchanged(f), before);
    assert.equal(fs.existsSync(join(f.git, "index.lock")), true);
    assert.equal((await k.publish({ token: p.token })).status, "unknown");
  });
  await run("lower-only-deadline", async () => {
    const f = setup(base, "lower-only-deadline"),
      k = await createGitBranchRestoreKernel({ timeoutMs: 1 });
    try {
      assert.equal((await k.prepare(f.request)).reason, "deadline");
    } finally {
      await k.close();
    }
  });
  await run("bulk-128-bounded", async () => {
    const f = setup(base, "bulk-128-bounded", { count: 128 }),
      k = await createGitBranchRestoreKernel(),
      before = unchanged(f);
    try {
      const p = await k.prepare(f.request);
      if (p.status === "prepared") {
        const r = await k.publish({ token: p.token });
        assert.ok(
          r.status === "applied" || r.reason === "deadline",
          JSON.stringify(r),
        );
        return {
          paths: 128,
          prepare: p.status,
          publish: r.status,
          reason: r.reason ?? null,
        };
      } else {
        assert.equal(p.reason, "deadline", JSON.stringify(p));
        assert.deepEqual(unchanged(f), before);
        return { paths: 128, prepare: p.status, reason: p.reason };
      }
    } finally {
      await k.close();
    }
  });
  await refuse(
    "hardlink-target",
    {},
    (f) => fs.linkSync(join(f.root, f.paths[0]), join(f.root, "hardlink.txt")),
    ["path_denied"],
  );
  await refuse(
    "symlink-target",
    {},
    (f) => {
      const path = join(f.root, f.paths[0]);
      fs.renameSync(path, path + ".kept");
      fs.symlinkSync(path + ".kept", path);
    },
    ["path_denied"],
  );
  await refuse(
    "omitted-source-file",
    {},
    (f) => {
      f.manifest.source.files = f.manifest.source.files.filter(
        (x) => x.path !== join(f.root, "untracked.bin"),
      );
      f.save();
    },
    ["invalid_request"],
  );
  await refuse(
    "omitted-affected-old-blob",
    { action: "select" },
    (f) => {
      const old = f.request.target.paths[0].beforeEntry.oid;
      f.manifest.objects = f.manifest.objects.filter((x) => x.oid !== old);
      fs.unlinkSync(join(f.artifact, "objects", old));
      f.save();
    },
    ["object_conflict"],
  );
  await run("xattr-preservation", async () => {
    const f = setup(base, "xattr-preservation"),
      path = join(f.root, f.paths[0]),
      key = "org.omoc.synthetic",
      value = "metadata-sentinel";
    const xattr = (args) => {
      const r = spawnSync("/usr/bin/xattr", args, {
        encoding: "utf8",
        env: { PATH: "/usr/bin:/bin", HOME: base },
      });
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trimEnd();
    };
    xattr(["-w", key, value, path]);
    refresh(f);
    const k = await createGitBranchRestoreKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal((await k.publish({ token: p.token })).status, "applied");
      assert.equal(xattr(["-p", key, path]), value);
      assert.equal(
        xattr([
          "-p",
          key,
          join(
            f.git,
            gitBranchRestoreBackupId(
              "old-epoch",
              "same-key",
              "worktree",
              f.paths[0],
            ),
          ),
        ]),
        value,
      );
    } finally {
      await k.close();
    }
  });
  await run("foreign-lock-replacement-retained", async () => {
    const f = setup(base, "foreign-lock-replacement-retained"),
      k = await createGitBranchRestoreKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared");
      const lock = join(f.git, "HEAD.lock");
      fs.renameSync(lock, lock + ".owned-kept");
      write(lock, "foreign lock\n");
      assert.equal((await k.publish({ token: p.token })).status, "unknown");
      assert.equal(fs.readFileSync(lock, "utf8"), "foreign lock\n");
    } finally {
      await k.close();
    }
  });
  // Inject the marker after each possible publication prefix. No target replay,
  // reverse rename or later HEAD/index effect is allowed after uncertainty.
  for (const action of ["create", "select", "restore"]) {
    const length = action === "create" ? 2 : action === "select" ? 5 : 2;
    for (let stop = 0; stop < length; stop++)
      await run(`partial-${action}-${stop}`, async () => {
        const f = setup(base, `partial-${action}-${stop}`, {
          action,
          count: 2,
        });
        const targets = [
          ...f.request.target.paths.map((x) => ({
            path: join(f.root, x.path),
            before: x.before,
            after: x.after,
          })),
          ...f.request.target.metadata.map((x) => ({
            path:
              x.role === "index"
                ? join(f.git, "index")
                : x.role === "head_ref"
                  ? join(f.git, "HEAD")
                  : x.role === "head_log"
                    ? join(f.git, "logs/HEAD")
                    : join(
                        f.common,
                        x.role === "branch_ref"
                          ? f.request.target.branch
                          : "logs/" + f.request.target.branch,
                      ),
            before: x.before,
            after: x.after,
          })),
        ];
        let inserted = false;
        const isAfter = (x) =>
          fs.existsSync(x.path)
            ? hash(fs.readFileSync(x.path)) === x.after?.digest
            : x.after === null;
        const k = await createGitBranchRestoreKernel({
          check() {
            if (!inserted && isAfter(targets[stop])) {
              inserted = true;
              write(join(f.git, "REVERT_HEAD"), "late state\n");
            }
          },
        });
        try {
          const p = await k.prepare(f.request);
          assert.equal(p.status, "prepared", JSON.stringify(p));
          const r = await k.publish({ token: p.token });
          assert.equal(inserted, true);
          assert.equal(r.reason, "unsupported_branch_restore_state");
          assert.deepEqual(await k.publish({ token: p.token }), r);
          for (let i = 0; i < targets.length; i++) {
            const x = targets[i],
              state = i <= stop ? x.after : x.before;
            if (state)
              assert.equal(hash(fs.readFileSync(x.path)), state.digest);
            else assert.equal(fs.existsSync(x.path), false);
          }
          assert.equal(fs.existsSync(join(f.git, "HEAD.lock")), true);
        } finally {
          await k.close();
        }
      });
  }
  await run("source-head-and-index-read-only-after-prepare", async () => {
    const f = setup(base, "source-head-and-index-read-only-after-prepare"),
      k = await createGitBranchRestoreKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared");
      fs.chmodSync(join(f.git, "index"), 0o400);
      assert.equal(
        (await k.publish({ token: p.token })).reason,
        "metadata_changed",
      );
    } finally {
      await k.close();
    }
  });
  await run("limits-remain-closed", async () => {
    const f = setup(base, "limits-remain-closed");
    const r = globalThis.structuredClone(f.request);
    r.target.paths = Array.from({ length: 129 }, () => r.target.paths[0]);
    assert.throws(() => validateGitBranchRestoreKernelRequest(r), {
      appCode: "INVALID_REQUEST",
    });
    await assert.rejects(createGitBranchRestoreKernel({ timeoutMs: 10001 }), {
      message: "invalid_request",
    });
  });
  for (const format of ["sha1", "sha256"])
    for (const action of ["create", "select", "restore"])
      await run(`manager-${format}-${action}`, async () => {
        const { createWorkbenchGitAccess } = await import(
          "./workbench-git.mjs"
        );
        const { GIT_BRANCH_RESTORE_TARGET_FIELDS } = await import(
          "../renderer/shared/git-branch-restore/index.mjs"
        );
        const home = join(base, `manager-${format}-${action}`),
          root = join(home, "workspace"),
          envHome = join(home, "home");
        fs.mkdirSync(root, { recursive: true, mode: 0o700 });
        fs.mkdirSync(envHome, { mode: 0o700 });
        const git = "/Library/Developer/CommandLineTools/usr/bin/git";
        const env = {
          HOME: envHome,
          XDG_CONFIG_HOME: envHome,
          PATH: "/usr/bin:/bin",
          LC_ALL: "C",
          GIT_CONFIG_NOSYSTEM: "1",
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_AUTHOR_NAME: "Synthetic",
          GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
          GIT_COMMITTER_NAME: "Synthetic",
          GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
          GIT_AUTHOR_DATE: "@1700000000 +0000",
          GIT_COMMITTER_DATE: "@1700000000 +0000",
        };
        const command = (args) => {
          const r = spawnSync(
            git,
            [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "commit.gpgSign=false",
              ...args,
            ],
            { cwd: root, env, encoding: "utf8", timeout: 5000 },
          );
          assert.equal(r.status, 0, r.stderr);
          return r.stdout;
        };
        command(["init", "-q", "-b", "main", `--object-format=${format}`]);
        write(join(root, "file.txt"), "old\n");
        write(join(root, "keep.txt"), "keep\n");
        command(["add", "--all"]);
        command(["commit", "-q", "-m", "fixture"]);
        command(["switch", "-q", "-c", "topic"]);
        write(join(root, "file.txt"), "new\n");
        command(["add", "--all"]);
        command(["commit", "-q", "-m", "next"]);
        command(["switch", "-q", "main"]);
        if (action === "restore") write(join(root, "file.txt"), "dirty\n");
        write(join(root, "untracked.bin"), Buffer.from([0, 255, 1]));
        const access = createWorkbenchGitAccess(),
          workspace = { id: "synthetic", path: root },
          scope = {
            runtimeEpoch: "old-epoch",
            sender: "synthetic",
            trusted: true,
            trustRevision: 0,
            revision: 0,
          },
          k = await createGitBranchRestoreKernel();
        try {
          const read = await access.reader.review(workspace, scope);
          assert.equal(read.status, "available", JSON.stringify(read));
          const req =
            action === "restore"
              ? {
                  type: "git.restore.preview.read",
                  workspaceId: workspace.id,
                  observationId: read.observationId,
                  source: "index",
                  paths: ["file.txt"],
                }
              : {
                  type: "git.branch.preview.read",
                  workspaceId: workspace.id,
                  observationId: read.observationId,
                  action,
                  branch:
                    action === "create"
                      ? "refs/heads/new-branch"
                      : "refs/heads/topic",
                  author: {
                    name: "Synthetic",
                    email: "synthetic@example.invalid",
                  },
                };
          const preview = await access.branchRestoreManager.preview(
            workspace,
            req,
            scope,
          );
          assert.equal(preview.status, "available", JSON.stringify(preview));
          const request = {
            type:
              action === "restore" ? "git.restore.apply" : "git.branch.apply",
            workspaceId: workspace.id,
            requestId: "same-key",
            previewId: preview.previewId,
            ...Object.fromEntries(
              GIT_BRANCH_RESTORE_TARGET_FIELDS.map((key) => [
                key,
                preview[key],
              ]),
            ),
          };
          let kernelResult;
          const result = await access.branchRestoreManager.apply(
            workspace,
            request,
            { ...scope, operationDigest: hash("manager operation") },
            async (operation) => {
              fs.writeFileSync(
                join(home, "operation.json"),
                JSON.stringify(operation, null, 2),
              );
              fs.copyFileSync(
                join(operation.artifact.root, "manifest.json"),
                join(home, "artifact-manifest.json"),
              );
              const p = await k.prepare(operation);
              fs.writeFileSync(
                join(home, "kernel-prepare.json"),
                JSON.stringify(p),
              );
              kernelResult =
                p.status === "prepared"
                  ? await k.publish({ token: p.token })
                  : p;
              fs.writeFileSync(
                join(home, "kernel-result.json"),
                JSON.stringify(kernelResult),
              );
              return kernelResult;
            },
          );
          assert.equal(
            result.status,
            "applied",
            JSON.stringify({ result, kernelResult }),
          );
          assert.equal(
            fs.readFileSync(join(root, "file.txt"), "utf8"),
            action === "select" ? "new\n" : "old\n",
          );
          assert.equal(
            fs.readFileSync(join(root, "keep.txt"), "utf8"),
            "keep\n",
          );
          assert.deepEqual(
            fs.readFileSync(join(root, "untracked.bin")),
            Buffer.from([0, 255, 1]),
          );
          return {
            action,
            format,
            kernelStatus: kernelResult.status,
            managerStatus: result.status,
          };
        } finally {
          await k.close();
          await access.branchRestoreManager.close();
          await access.reader.close();
        }
      });
  await run("wildmatch-bounded-pattern", async () => {
    const f = setup(base, "wildmatch-bounded-pattern", {
      fileName: "a".repeat(200) + ".txt",
    });
    assert.equal(f.paths[0], "a".repeat(200) + ".txt");
    write(join(f.root, ".gitattributes"), "*a".repeat(150) + "z ident\n");
    refresh(f);
    const k = await createGitBranchRestoreKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal((await k.publish({ token: p.token })).status, "applied");
    } finally {
      await k.close();
    }
  });
  return evidence.length;
}
if (process.argv[2] === "--synthetic-fixture") {
  await fixtures(process.argv[3]);
} else {
  const { test } = await import("node:test");
  test("branch restore facade is inert in Node", async () => {
    await assert.rejects(createGitBranchRestoreKernel(), {
      message: "unsupported_runtime",
    });
  });
  test(
    "manifest-pinned Bun branch restore descriptor fixtures",
    { timeout: 600000 },
    () => {
      const resource = join(
          repo,
          "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64",
        ),
        manifest = JSON.parse(fs.readFileSync(join(resource, "manifest.json"))),
        bun = join(resource, "runtime/bun"),
        entry = manifest.entries.find((x) => x.path === "runtime/bun"),
        binary = hash(fs.readFileSync(bun));
      assert.equal(manifest.bunVersion, "1.4.2");
      assert.equal(binary, entry.sha256);
      assert.equal(fs.statSync(bun).size, entry.size);
      assert.equal(fs.realpathSync(bun), bun);
      const names = [
          "git-metadata-kernel.mjs",
          "git-branch-restore-kernel.mjs",
          "git-branch-restore-kernel.test.mjs",
          "git-branch-restore-contract.mjs",
          "../renderer/shared/git-branch-restore/index.mjs",
        ],
        pins = () =>
          names.map((n) => ({
            path: resolve(here, n),
            bytes: fs.statSync(resolve(here, n)).size,
            sha256: hash(fs.readFileSync(resolve(here, n))),
          })),
        before = pins();
      const base = fs.realpathSync(
        fs.mkdtempSync(join(tmpdir(), "omoc-git-branch-restore-kernel-")),
      );
      const child = spawnSync(
        bun,
        [fileURLToPath(import.meta.url), "--synthetic-fixture", base],
        {
          encoding: "utf8",
          timeout: 590000,
          env: { PATH: "/usr/bin:/bin", HOME: base, LC_ALL: "C" },
        },
      );
      process.stdout.write(`Synthetic evidence: ${base}/report.json\n`);
      fs.writeFileSync(
        join(base, "execution.log"),
        child.stdout + child.stderr,
      );
      fs.writeFileSync(
        join(base, "execution.json"),
        JSON.stringify(
          {
            sources: before,
            runtimeBinary: { path: bun, sha256: binary },
            exitCode: child.status,
            signal: child.signal,
          },
          null,
          2,
        ),
      );
      assert.equal(hash(fs.readFileSync(bun)), binary);
      assert.equal(child.error, undefined);
      assert.equal(child.status, 0, child.stderr + child.stdout);
      assert.deepEqual(pins(), before);
      const report = JSON.parse(fs.readFileSync(join(base, "report.json")));
      report.sources = before;
      report.runtimeBinary = { path: bun, sha256: binary };
      report.process = { exitCode: child.status, signal: child.signal };
      fs.writeFileSync(
        join(base, "report.json"),
        JSON.stringify(report, null, 2),
      );
    },
  );
}
