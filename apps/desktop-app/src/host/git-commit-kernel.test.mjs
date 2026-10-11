import assert from "node:assert/strict";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createGitCommitKernel } from "./git-commit-kernel.mjs";
import { createGitMetadataKernel } from "./git-metadata-kernel.mjs";
import {
  GIT_COMMIT_STATE_MARKERS,
  gitCommitExpectedBackups,
} from "./git-commit-contract.mjs";
import {
  GIT_COMMIT_FEATURE,
  GIT_COMMIT_ABSENT_DIGEST,
  GIT_COMMIT_REFLOG_REASON,
} from "../renderer/shared/git-commit/index.mjs";
const here = dirname(fileURLToPath(import.meta.url)),
  repo = resolve(here, "../../../..");
const hash = (b, format = "sha256") =>
  createHash(format).update(b).digest("hex");
const sig = (s) =>
  [s.dev, s.ino, s.mode, s.nlink, s.size, s.mtimeNs, s.ctimeNs].join(":");
const git = "/Library/Developer/CommandLineTools/usr/bin/git";
const write = (p, b, mode = 0o600) => {
  fs.mkdirSync(dirname(p), { recursive: true, mode: 0o700 });
  fs.writeFileSync(p, b, { mode });
};
const inode = (p) => {
  const s = fs.lstatSync(p, { bigint: true });
  return { path: p, dev: String(s.dev), ino: String(s.ino) };
};
function loose(type, bytes, format) {
  const raw = Buffer.concat([Buffer.from(`${type} ${bytes.length}\0`), bytes]);
  return {
    oid: hash(raw, format),
    bytes: deflateSync(raw),
    rawBytes: bytes.length,
  };
}
function snapshot(roots, missing = []) {
  const directories = new Map(),
    files = new Map(),
    listings = new Map();
  function ancestor(p) {
    if (directories.has(p)) return;
    if (dirname(p) !== p) ancestor(dirname(p));
    directories.set(p, inode(p));
  }
  function walk(p) {
    ancestor(p);
    const names = fs.readdirSync(p).sort();
    listings.set(p, { path: p, names });
    for (const name of names) {
      const child = join(p, name),
        s = fs.lstatSync(child, { bigint: true });
      if (s.isDirectory()) walk(child);
      else {
        assert.equal(s.isFile(), true);
        files.set(child, {
          path: child,
          signature: sig(s),
          digest: hash(fs.readFileSync(child)),
        });
      }
    }
  }
  for (const root of new Set(roots)) walk(root);
  return {
    directories: [...directories.values()],
    files: [...files.values()],
    listings: [...listings.values()],
    missing: [...new Set(missing)],
  };
}

function setup(
  base,
  name,
  {
    format = "sha1",
    unborn = false,
    detached = false,
    linked = false,
    nested = false,
    packed = false,
    deletion = false,
    disabled = false,
    absentLogs = false,
    existingTree = false,
  } = {},
) {
  const home = join(base, name),
    root = join(home, "workspace"),
    artifact = join(home, "artifact"),
    privateRoot = join(home, "private");
  for (const p of [home, root, artifact, privateRoot])
    fs.mkdirSync(p, { mode: 0o700 });
  const author = {
      name: "합성  Test, Name",
      email: "synthetic@example.invalid",
    },
    timestamp = 1700000000,
    canonicalMessage = "synthetic commit\r\n";
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: home,
    XDG_CONFIG_HOME: home,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    LC_ALL: "C",
    GIT_AUTHOR_NAME: author.name,
    GIT_AUTHOR_EMAIL: author.email,
    GIT_COMMITTER_NAME: author.name,
    GIT_COMMITTER_EMAIL: author.email,
    GIT_AUTHOR_DATE: `@${timestamp} +0000`,
    GIT_COMMITTER_DATE: `@${timestamp} +0000`,
  };
  const command = (cwd, args, input) => {
    const r = spawnSync(git, args, { cwd, env, input, timeout: 5000 });
    assert.equal(r.error, undefined);
    assert.equal(r.status, 0, r.stderr.toString());
    return r.stdout;
  };
  command(root, [
    "init",
    "--template=",
    "-q",
    `--object-format=${format}`,
    "--initial-branch=main",
  ]);
  write(join(root, "old.txt"), "old\n");
  write(join(root, "dir/keep.txt"), "keep\n");
  command(root, ["add", "--all"]);
  if (!unborn)
    command(root, ["commit", "-q", "--no-gpg-sign", "-m", "fixture"]);
  let gitDirectory = join(root, ".git"),
    common = gitDirectory;
  if (packed && !unborn) command(root, ["gc", "--prune=now"]);
  const headOid = unborn
    ? null
    : command(root, ["rev-parse", "HEAD"]).toString().trim();
  if (detached) write(join(gitDirectory, "HEAD"), headOid + "\n");
  const branch = nested ? "refs/heads/feature/deep/topic" : "refs/heads/main";
  if (nested) write(join(gitDirectory, "HEAD"), `ref: ${branch}\n`);
  if (linked) {
    common = join(home, "metadata");
    fs.renameSync(gitDirectory, common);
    gitDirectory = join(common, "worktrees/fixture");
    fs.mkdirSync(gitDirectory, { recursive: true, mode: 0o700 });
    for (const leaf of ["HEAD", "index"])
      fs.copyFileSync(join(common, leaf), join(gitDirectory, leaf));
    write(join(root, ".git"), `gitdir: ${gitDirectory}\n`);
    write(join(gitDirectory, "gitdir"), join(root, ".git") + "\n");
    write(join(gitDirectory, "commondir"), "../..\n");
    write(join(common, "worktrees/other/HEAD"), "ref: refs/heads/main\n");
  }
  if (disabled) command(root, ["config", "core.logAllRefUpdates", "false"]);
  if (deletion) {
    command(root, ["rm", "-q", "-r", "--cached", "."]);
  } else {
    write(join(root, "old.txt"), "new\n");
    command(root, ["add", "old.txt"]);
    write(join(root, "old.txt"), "unstaged sentinel\n");
  }
  // Deleting logs here is fixture construction on exact owned files only.
  if (absentLogs)
    for (const p of [
      join(gitDirectory, "logs/HEAD"),
      join(common, "logs", branch),
    ])
      if (fs.existsSync(p)) fs.unlinkSync(p);
  const indexBytes = fs.readFileSync(join(gitDirectory, "index"));
  const entries = command(root, ["ls-files", "--stage", "-z"])
    .toString()
    .split("\0")
    .filter(Boolean)
    .map((line) => {
      const [info, path] = line.split("\t"),
        [mode, oid, stage] = info.split(" ");
      assert.equal(stage, "0");
      return { path, mode: parseInt(mode, 8), oid };
    })
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)));
  const pd = join(privateRoot, ".git");
  fs.cpSync(common, pd, { recursive: true });
  write(join(pd, "HEAD"), detached ? headOid + "\n" : `ref: ${branch}\n`);
  write(join(pd, "index"), indexBytes);
  if (linked) {
    const h = join(gitDirectory, "logs/HEAD");
    if (fs.existsSync(h)) write(join(pd, "logs/HEAD"), fs.readFileSync(h));
    else if (fs.existsSync(join(pd, "logs/HEAD")))
      fs.unlinkSync(join(pd, "logs/HEAD"));
  }
  const treeOid = command(privateRoot, ["write-tree"]).toString().trim();
  if (existingTree) {
    const raw = command(privateRoot, ["cat-file", "tree", treeOid]);
    const o = loose("tree", raw, format);
    write(join(common, "objects", o.oid.slice(0, 2), o.oid.slice(2)), o.bytes);
  }
  const commitOid = command(
    privateRoot,
    [
      "commit-tree",
      "--no-gpg-sign",
      treeOid,
      ...(headOid ? ["-p", headOid] : []),
    ],
    canonicalMessage,
  )
    .toString()
    .trim();
  const commitBody = command(privateRoot, ["cat-file", "commit", commitOid]);
  command(privateRoot, [
    "update-ref",
    "-m",
    GIT_COMMIT_REFLOG_REASON,
    "HEAD",
    commitOid,
    headOid ?? "0".repeat(format === "sha1" ? 40 : 64),
  ]);
  const refPath = detached ? join(gitDirectory, "HEAD") : join(common, branch),
    role = detached ? "head_ref" : "branch_ref";
  const oldRef = fs.existsSync(refPath) ? fs.readFileSync(refPath) : null,
    reference = Buffer.from(commitOid + "\n");
  const logs = [];
  for (const [role, path, privatePath] of [
    ["head_log", join(gitDirectory, "logs/HEAD"), join(pd, "logs/HEAD")],
    ...(!detached
      ? [["branch_log", join(common, "logs", branch), join(pd, "logs", branch)]]
      : []),
  ]) {
    if (!fs.existsSync(privatePath)) continue;
    const proposal = fs.readFileSync(privatePath),
      original = fs.existsSync(path) ? fs.readFileSync(path) : null;
    logs.push({ role, path, proposal, original });
  }
  const objects = [],
    seen = new Set();
  function proof(oid, type) {
    if (seen.has(oid)) return;
    seen.add(oid);
    const raw = command(privateRoot, ["cat-file", type, oid]),
      o = loose(type, raw, format);
    assert.equal(o.oid, oid);
    const exists =
      fs.existsSync(join(common, "objects", oid.slice(0, 2), oid.slice(2))) ||
      (packed &&
        command(root, ["cat-file", "--batch-check"], oid + "\n")
          .toString()
          .startsWith(oid + " " + type + " "));
    const path = `objects/${oid.slice(0, 2)}/${oid.slice(2)}`;
    write(join(artifact, path), o.bytes);
    objects.push({
      oid,
      type,
      rawBytes: o.rawBytes,
      path,
      bytes: o.bytes.length,
      digest: hash(o.bytes),
      install: !exists,
    });
    if (type === "tree")
      for (const line of command(privateRoot, ["ls-tree", "-z", oid])
        .toString()
        .split("\0")
        .filter(Boolean)) {
        const [mode, t, child] = line.split("\t")[0].split(" ");
        if (mode === "040000" && t === "tree") proof(child, "tree");
      }
  }
  proof(treeOid, "tree");
  proof(commitOid, "commit");
  const target = {
    objectFormat: format,
    previewDigest: "b".repeat(64),
    indexDigest: hash(indexBytes),
    headOid,
    treeOid,
    treeDigest: hash(
      JSON.stringify(entries.map((e) => [e.path, e.mode, e.oid])),
    ),
    commitOid,
    commitBodyDigest: hash(commitBody),
    reference: {
      kind: detached ? "head" : "branch",
      name: detached ? null : branch,
      exists: oldRef !== null,
      digest: oldRef ? hash(oldRef) : GIT_COMMIT_ABSENT_DIGEST,
      nextDigest: hash(reference),
    },
    logs: logs.map((x) => ({
      role: x.role,
      exists: x.original !== null,
      digest: x.original ? hash(x.original) : GIT_COMMIT_ABSENT_DIGEST,
      nextDigest: hash(x.proposal),
      nextBytes: x.proposal.length,
    })),
  };
  const missing = [
    ...GIT_COMMIT_STATE_MARKERS.map((n) => join(gitDirectory, n)),
    ...(!fs.existsSync(join(common, "packed-refs"))
      ? [join(common, "packed-refs")]
      : []),
  ];
  for (const p of [
    refPath,
    join(gitDirectory, "logs/HEAD"),
    ...(!detached ? [join(common, "logs", branch)] : []),
  ])
    if (!fs.existsSync(p)) {
      let a = p;
      while (!fs.existsSync(dirname(a))) a = dirname(a);
      missing.push(a);
      if (a !== p) missing.push(p);
    }
  const source = snapshot([root, common, gitDirectory], missing);
  const request = {
    runtimeEpoch: "commit-kernel-epoch",
    operationId: name,
    workspaceId: "synthetic",
    workspacePath: root,
    digest: "a".repeat(64),
    target,
    artifact: {
      root: artifact,
      ...(({ dev, ino }) => ({ dev, ino }))(inode(artifact)),
      manifest: { path: "manifest.json", bytes: 1, digest: "c".repeat(64) },
    },
  };
  const file = (path, bytes) => {
    write(join(artifact, path), bytes);
    return { path, bytes: bytes.length, digest: hash(bytes) };
  };
  const manifest = {
    schemaVersion: 1,
    feature: GIT_COMMIT_FEATURE,
    runtimeEpoch: request.runtimeEpoch,
    operationId: name,
    workspaceId: request.workspaceId,
    workspacePath: root,
    digest: request.digest,
    target,
    layout: {
      root: inode(root),
      gitDirectory: inode(gitDirectory),
      commonDirectory: inode(common),
    },
    source,
    author,
    timestamp,
    canonicalMessage,
    entries,
    commit: file("commit.body", commitBody),
    reference: file("proposal.reference", reference),
    logs: logs.map((x) => ({
      role: x.role,
      proposal: file(`proposal.${x.role}`, x.proposal),
    })),
    objects,
  };
  const save = () => {
    const b = Buffer.from(JSON.stringify(manifest));
    write(join(artifact, "manifest.json"), b);
    request.artifact.manifest = {
      path: "manifest.json",
      bytes: b.length,
      digest: hash(b),
    };
  };
  save();
  return {
    root,
    common,
    gitDirectory,
    artifact,
    request,
    manifest,
    save,
    refPath,
    role,
    logs,
    reference,
    indexBytes,
    headBytes: fs.readFileSync(join(gitDirectory, "HEAD")),
    command,
    commitBody,
  };
}
async function fixtures(base) {
  const evidence = [];
  const run = async (name, fn) => {
    if (process.argv[4] && !new RegExp(process.argv[4], "u").test(name)) return;
    try {
      await fn();
      evidence.push({ name, status: "pass" });
    } catch (e) {
      evidence.push({ name, status: "fail", error: e.stack });
      throw e;
    } finally {
      fs.writeFileSync(
        join(base, "report.json"),
        JSON.stringify(
          { base, runtime: globalThis.Bun.version, evidence },
          null,
          2,
        ),
      );
    }
  };
  for (const format of ["sha1", "sha256"])
    for (const variant of [
      "attached",
      "unborn",
      "nested",
      "detached",
      "linked",
      "packed",
      "deletion",
      "disabled-existing",
      "disabled-absent",
      "existing-tree",
    ]) {
      await run(`${format}-${variant}`, async () => {
        const f = setup(base, `${format}-${variant}`, {
          format,
          unborn: ["unborn", "nested"].includes(variant),
          nested: variant === "nested",
          detached: variant === "detached",
          linked: variant === "linked",
          packed: variant === "packed",
          deletion: variant === "deletion",
          disabled: variant.startsWith("disabled"),
          absentLogs: variant === "disabled-absent",
          existingTree: variant === "existing-tree",
        });
        const k = await createGitCommitKernel();
        try {
          const p = await k.prepare(f.request);
          assert.equal(p.status, "prepared", JSON.stringify(p));
          const r = await k.publish({ token: p.token });
          assert.equal(r.status, "committed", JSON.stringify(r));
          assert.deepEqual(
            r.backups,
            gitCommitExpectedBackups(
              f.request.target,
              f.request.runtimeEpoch,
              f.request.operationId,
            ),
          );
          assert.deepEqual(fs.readFileSync(f.refPath), f.reference);
          assert.deepEqual(
            fs.readFileSync(join(f.gitDirectory, "index")),
            f.indexBytes,
          );
          if (f.role === "branch_ref")
            assert.deepEqual(
              fs.readFileSync(join(f.gitDirectory, "HEAD")),
              f.headBytes,
            );
          for (const l of f.logs) {
            assert.deepEqual(fs.readFileSync(l.path), l.proposal);
            if (l.original) {
              const b = r.backups.find((x) => x.role === l.role).backupId;
              assert.deepEqual(
                fs.readFileSync(
                  join(l.role === "head_log" ? f.gitDirectory : f.common, b),
                ),
                l.original,
              );
            }
          }
        } finally {
          await k.close();
        }
      });
    }
  for (const marker of GIT_COMMIT_STATE_MARKERS)
    await run(`marker-${marker}`, async () => {
      const f = setup(base, `marker-${marker}`);
      write(join(f.gitDirectory, marker), "not read");
      const k = await createGitCommitKernel();
      try {
        assert.equal(
          (await k.prepare(f.request)).reason,
          "unsupported_commit_state",
        );
        assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
      } finally {
        await k.close();
      }
    });
  await run("readonly-index", async () => {
    const f = setup(base, "readonly-index");
    fs.chmodSync(join(f.gitDirectory, "index"), 0o400);
    f.manifest.source = snapshot([f.root], f.manifest.source.missing);
    f.save();
    const k = await createGitCommitKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal((await k.publish({ token: p.token })).status, "committed");
      assert.equal(
        Number(fs.statSync(join(f.gitDirectory, "index")).mode) & 0o777,
        0o400,
      );
    } finally {
      await k.close();
    }
  });

  const resnapshot = (f) => {
    f.manifest.source = snapshot(
      [f.root, f.common, f.gitDirectory],
      f.manifest.source.missing,
    );
    f.save();
  };
  const updateFile = (f, rec, b) => {
    write(join(f.artifact, rec.path), b);
    rec.bytes = b.length;
    rec.digest = hash(b);
  };
  const replaceCommit = (f, body) => {
    const old = f.manifest.objects.find((o) => o.type === "commit"),
      oldOid = old.oid,
      oldPath = join(f.artifact, old.path),
      o = loose("commit", body, f.request.target.objectFormat);
    fs.unlinkSync(oldPath);
    if (fs.readdirSync(dirname(oldPath)).length === 0)
      fs.rmdirSync(dirname(oldPath));
    Object.assign(old, {
      oid: o.oid,
      rawBytes: o.rawBytes,
      path: `objects/${o.oid.slice(0, 2)}/${o.oid.slice(2)}`,
      bytes: o.bytes.length,
      digest: hash(o.bytes),
    });
    write(join(f.artifact, old.path), o.bytes);
    updateFile(f, f.manifest.commit, body);
    f.request.target.commitOid = o.oid;
    f.request.target.commitBodyDigest = hash(body);
    const reference = Buffer.from(o.oid + "\n");
    updateFile(f, f.manifest.reference, reference);
    f.request.target.reference.nextDigest = hash(reference);
    for (const l of f.manifest.logs) {
      const b = Buffer.from(
        fs
          .readFileSync(join(f.artifact, l.proposal.path))
          .toString()
          .replace(oldOid, o.oid),
      );
      updateFile(f, l.proposal, b);
      const target = f.request.target.logs.find((x) => x.role === l.role);
      target.nextDigest = hash(b);
      target.nextBytes = b.length;
    }
  };
  for (const variant of [
    "false-author",
    "extra-header",
    "false-parent",
    "false-body",
    "false-index",
    "false-tree-digest",
    "false-tree-graph",
    "false-tree-mode",
    "false-timestamp",
    "false-ref",
    "false-log",
    "missing-proof",
    "extra-proof",
    "false-install",
    "false-raw-size",
    "false-object",
    "false-target",
    "false-backup",
    "missing-log-listing",
  ])
    await run(variant, async () => {
      const f = setup(base, variant);
      if (variant === "false-author")
        replaceCommit(
          f,
          Buffer.from(
            f.commitBody
              .toString()
              .replaceAll(f.manifest.author.name, "Other Synthetic"),
          ),
        );
      if (variant === "extra-header")
        replaceCommit(
          f,
          Buffer.from(
            f.commitBody.toString().replace("\n\n", "\nencoding UTF-8\n\n"),
          ),
        );
      if (variant === "false-parent")
        replaceCommit(
          f,
          Buffer.from(
            f.commitBody
              .toString()
              .replace(
                `parent ${f.request.target.headOid}`,
                `parent ${"1".repeat(40)}`,
              ),
          ),
        );
      if (variant === "false-body")
        replaceCommit(f, Buffer.from(f.commitBody.toString() + "different\n"));
      if (variant === "false-index") {
        f.manifest.entries[0].oid = "2".repeat(40);
        f.request.target.treeDigest = hash(
          JSON.stringify(
            f.manifest.entries.map((x) => [x.path, x.mode, x.oid]),
          ),
        );
      }

      if (variant === "false-tree-graph" || variant === "false-tree-mode") {
        const record = f.manifest.objects.find(
            (o) => o.oid === f.request.target.treeOid,
          ),
          oldOid = record.oid,
          oldPath = join(f.artifact, record.path);
        const body = Buffer.concat([
            Buffer.from(
              `${variant === "false-tree-mode" ? "120000" : "100644"} extra.txt\0`,
            ),
            Buffer.from(f.manifest.entries[0].oid, "hex"),
          ]),
          o = loose("tree", body, "sha1");
        fs.unlinkSync(oldPath);
        if (fs.readdirSync(dirname(oldPath)).length === 0)
          fs.rmdirSync(dirname(oldPath));
        Object.assign(record, {
          oid: o.oid,
          rawBytes: o.rawBytes,
          path: `objects/${o.oid.slice(0, 2)}/${o.oid.slice(2)}`,
          bytes: o.bytes.length,
          digest: hash(o.bytes),
          install: true,
        });
        write(join(f.artifact, record.path), o.bytes);
        f.request.target.treeOid = o.oid;
        replaceCommit(
          f,
          Buffer.from(f.commitBody.toString().replace(oldOid, o.oid)),
        );
      }
      if (variant === "false-timestamp") f.manifest.timestamp++;
      if (variant === "false-tree-digest")
        f.request.target.treeDigest = "d".repeat(64);
      if (variant === "false-ref") {
        const b = Buffer.from("1".repeat(40) + "\n");
        updateFile(f, f.manifest.reference, b);
        f.request.target.reference.nextDigest = hash(b);
      }
      if (variant === "false-log") {
        const l = f.manifest.logs[0],
          b = Buffer.from(
            fs
              .readFileSync(join(f.artifact, l.proposal.path))
              .toString()
              .replace(GIT_COMMIT_REFLOG_REASON, "different constant"),
          );
        updateFile(f, l.proposal, b);
        f.request.target.logs[0].nextDigest = hash(b);
        f.request.target.logs[0].nextBytes = b.length;
      }
      if (variant === "missing-proof") {
        const i = f.manifest.objects.findIndex(
          (o) => o.type === "tree" && o.oid !== f.request.target.treeOid,
        );
        const [removed] = f.manifest.objects.splice(i, 1);
        const path = join(f.artifact, removed.path);
        fs.unlinkSync(path);
        if (fs.readdirSync(dirname(path)).length === 0)
          fs.rmdirSync(dirname(path));
      }
      if (variant === "extra-proof") {
        const o = loose("tree", Buffer.alloc(0), "sha1"),
          path = `objects/${o.oid.slice(0, 2)}/${o.oid.slice(2)}`;
        write(join(f.artifact, path), o.bytes);
        f.manifest.objects.push({
          oid: o.oid,
          type: "tree",
          rawBytes: 0,
          path,
          bytes: o.bytes.length,
          digest: hash(o.bytes),
          install: true,
        });
      }
      if (variant === "false-install")
        f.manifest.objects.find((o) => o.install).install = false;
      if (variant === "false-raw-size") f.manifest.objects[0].rawBytes++;
      if (variant === "false-object") {
        const o = f.manifest.objects[0],
          b = Buffer.from("not compressed");
        write(join(f.artifact, o.path), b);
        o.bytes = b.length;
        o.digest = hash(b);
      }
      if (variant === "false-target")
        f.request.target.reference.digest = "d".repeat(64);
      if (variant === "false-backup")
        write(
          join(
            f.gitDirectory,
            gitCommitExpectedBackups(
              f.request.target,
              f.request.runtimeEpoch,
              f.request.operationId,
            )[0].backupId,
          ),
          "foreign backup",
        );
      if (variant === "missing-log-listing")
        f.manifest.source.listings = f.manifest.source.listings.filter(
          (x) => x.path !== dirname(f.logs[0].path),
        );
      f.save();
      const k = await createGitCommitKernel();
      try {
        const r = await k.prepare(f.request);
        assert.equal(r.status, "unknown", JSON.stringify(r));
        assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
        assert.deepEqual(
          fs.readFileSync(f.refPath),
          Buffer.from(f.request.target.headOid + "\n"),
        );
      } finally {
        await k.close();
      }
    });
  for (const kind of ["directory", "symlink"])
    await run(`marker-${kind}`, async () => {
      const f = setup(base, `marker-${kind}`);
      const p = join(f.gitDirectory, "MERGE_HEAD");
      if (kind === "directory") fs.mkdirSync(p, { mode: 0o700 });
      else fs.symlinkSync("missing-state", p);
      const k = await createGitCommitKernel();
      try {
        assert.equal(
          (await k.prepare(f.request)).reason,
          "unsupported_commit_state",
        );
        assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
      } finally {
        await k.close();
      }
    });
  await run("ORIG_HEAD-allowed", async () => {
    const f = setup(base, "ORIG_HEAD-allowed", {
      disabled: true,
      absentLogs: true,
    });
    write(join(f.gitDirectory, "ORIG_HEAD"), f.request.target.headOid + "\n");
    resnapshot(f);
    const k = await createGitCommitKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal((await k.abort({ token: p.token })).status, "aborted");
    } finally {
      await k.close();
    }
  });
  await run("linked-common-marker-is-distinct", async () => {
    const f = setup(base, "linked-common-marker-is-distinct", {
      linked: true,
      disabled: true,
      absentLogs: true,
    });
    write(join(f.common, "MERGE_HEAD"), f.request.target.headOid + "\n");
    resnapshot(f);
    const k = await createGitCommitKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal((await k.abort({ token: p.token })).status, "aborted");
    } finally {
      await k.close();
    }
  });
  await run("marker-after-prepare", async () => {
    const f = setup(base, "marker-after-prepare", {
        disabled: true,
        absentLogs: true,
      }),
      k = await createGitCommitKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      write(join(f.gitDirectory, "CHERRY_PICK_HEAD"), "foreign state");
      assert.equal(
        (await k.publish({ token: p.token })).reason,
        "unsupported_commit_state",
      );
      assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), true);
      assert.deepEqual(
        fs.readFileSync(f.refPath),
        Buffer.from(f.request.target.headOid + "\n"),
      );
    } finally {
      await k.close();
    }
  });
  await run("nested-lock-order-collision-retains", async () => {
    const f = setup(base, "nested-lock-order-collision-retains", {
      unborn: true,
      nested: true,
    });
    let injected = false;
    const k = await createGitCommitKernel({
      check() {
        if (fs.existsSync(join(f.common, "refs/heads/feature")))
          assert.ok(
            fs.existsSync(join(f.gitDirectory, "index.lock")) &&
              fs.existsSync(join(f.gitDirectory, "HEAD.lock")),
          );
        if (!injected && fs.existsSync(dirname(f.refPath))) {
          injected = true;
          write(f.refPath + ".lock", "foreign lock");
        }
      },
    });
    try {
      const r = await k.prepare(f.request);
      assert.equal(r.status, "unknown");
      assert.ok(injected);
      assert.ok(fs.existsSync(dirname(f.refPath)));
      assert.equal(
        fs.readFileSync(f.refPath + ".lock", "utf8"),
        "foreign lock",
      );
      assert.equal(fs.existsSync(join(f.gitDirectory, "logs")), false);
      for (const o of f.manifest.objects.filter((x) => x.install))
        assert.equal(fs.existsSync(join(f.common, o.path)), false);
      for (const x of gitCommitExpectedBackups(
        f.request.target,
        f.request.runtimeEpoch,
        f.request.operationId,
      ))
        if (x.backupId)
          assert.equal(fs.existsSync(join(f.common, x.backupId)), false);
    } finally {
      await k.close();
    }
  });
  for (const variant of ["index-lock", "head-lock", "branch-lock"])
    await run(variant, async () => {
      const f = setup(base, variant),
        p =
          variant === "index-lock"
            ? join(f.gitDirectory, "index.lock")
            : variant === "head-lock"
              ? join(f.gitDirectory, "HEAD.lock")
              : f.refPath + ".lock";
      write(p, "foreign lock");
      resnapshot(f);
      const k = await createGitCommitKernel();
      try {
        assert.equal((await k.prepare(f.request)).reason, "lock_conflict");
        assert.equal(fs.readFileSync(p, "utf8"), "foreign lock");
        for (const o of f.manifest.objects.filter((x) => x.install))
          assert.equal(fs.existsSync(join(f.common, o.path)), false);
      } finally {
        await k.close();
      }
    });
  for (const variant of [
    "readonly-ref",
    "unsafe-mode",
    "hardlink",
    "symlink",
    "acl",
  ])
    await run(variant, async () => {
      const f = setup(base, variant);
      if (variant === "readonly-ref") fs.chmodSync(f.refPath, 0o400);
      if (variant === "unsafe-mode") fs.chmodSync(f.refPath, 0o666);
      if (variant === "hardlink")
        fs.linkSync(f.refPath, join(dirname(f.root), "foreign-link"));
      if (variant === "symlink") {
        const b = fs.readFileSync(f.refPath);
        fs.unlinkSync(f.refPath);
        write(join(dirname(f.root), "symlink-target"), b);
        fs.symlinkSync(join(dirname(f.root), "symlink-target"), f.refPath);
      }
      if (variant === "acl") {
        const r = spawnSync("/bin/chmod", [
          "+a",
          "everyone allow read",
          f.refPath,
        ]);
        assert.equal(r.status, 0, r.stderr.toString());
      }
      if (variant !== "symlink") resnapshot(f);
      const k = await createGitCommitKernel();
      try {
        assert.equal((await k.prepare(f.request)).status, "unknown");
        assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
      } finally {
        await k.close();
      }
    });
  await run("target-xattrs-preserved", async () => {
    const f = setup(base, "target-xattrs-preserved", {
      disabled: true,
      absentLogs: true,
    });
    assert.equal(
      spawnSync("/usr/bin/xattr", [
        "-w",
        "user.omoc.synthetic",
        "synthetic-xattr",
        f.refPath,
      ]).status,
      0,
    );
    resnapshot(f);
    const k = await createGitCommitKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      const r = await k.publish({ token: p.token });
      assert.equal(r.status, "committed", JSON.stringify(r));
      assert.equal(
        spawnSync("/usr/bin/xattr", ["-p", "user.omoc.synthetic", f.refPath], {
          encoding: "utf8",
        }).stdout.trim(),
        "synthetic-xattr",
      );
    } finally {
      await k.close();
    }
  });
  await run("partial-log-publication-unknown-no-replay", async () => {
    const f = setup(base, "partial-log-publication-unknown-no-replay");
    let publishing = false,
      injected = false;
    const k = await createGitCommitKernel({
      check() {
        if (
          publishing &&
          !injected &&
          fs.readFileSync(f.logs[0].path).equals(f.logs[0].proposal)
        ) {
          injected = true;
          write(join(f.root, "old.txt"), "concurrent source");
        }
      },
    });
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      publishing = true;
      const r = await k.publish({ token: p.token });
      assert.equal(r.status, "unknown");
      assert.ok(injected);
      assert.deepEqual(fs.readFileSync(f.logs[0].path), f.logs[0].proposal);
      assert.deepEqual(
        fs.readFileSync(f.refPath),
        Buffer.from(f.request.target.headOid + "\n"),
      );
      assert.deepEqual(await k.publish({ token: p.token }), r);
      assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), true);
    } finally {
      await k.close();
    }
  });
  await run("cross-kind-active-and-cached-tokens", async () => {
    const f = setup(base, "cross-kind-active-and-cached-tokens", {
        disabled: true,
        absentLogs: true,
      }),
      k = await createGitMetadataKernel();
    try {
      const p = await k.commit.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.equal(
        (await k.index.publish({ token: p.token })).reason,
        "invalid_request",
      );
      assert.equal(
        (await k.index.abort({ token: p.token })).reason,
        "invalid_request",
      );
      assert.equal(
        (await k.index.prepare(f.request)).reason,
        "invalid_request",
      );
      assert.equal(
        (await k.commit.prepare(f.request)).reason,
        "invalid_request",
      );
      const terminal = await k.commit.abort({ token: p.token });
      assert.equal(terminal.status, "aborted");
      terminal.status = "committed";
      assert.equal(
        (await k.index.publish({ token: p.token })).reason,
        "invalid_request",
      );
      assert.equal(
        (await k.commit.publish({ token: p.token })).status,
        "aborted",
      );
    } finally {
      await k.close();
    }
  });
  await run("close-prepared-retains", async () => {
    const f = setup(base, "close-prepared-retains", {
        disabled: true,
        absentLogs: true,
      }),
      k = await createGitMetadataKernel();
    const p = await k.commit.prepare(f.request);
    assert.equal(p.status, "prepared", JSON.stringify(p));
    await k.index.close();
    assert.equal(
      (await k.commit.publish({ token: p.token })).reason,
      "invalid_request",
    );
    assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), true);
    await k.close();
  });
  await run("deadline-prepare-before-effects", async () => {
    const f = setup(base, "deadline-prepare-before-effects"),
      k = await createGitCommitKernel({ timeoutMs: 1 });
    try {
      assert.equal((await k.prepare(f.request)).reason, "deadline");
      assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
    } finally {
      await k.close();
    }
  });

  await run("malformed-original-log-prefix", async () => {
    const f = setup(base, "malformed-original-log-prefix"),
      l = f.logs[0],
      old = l.original.subarray(0, -1),
      b = Buffer.concat([old, l.proposal.subarray(l.original.length)]);
    write(l.path, old);
    updateFile(f, f.manifest.logs[0].proposal, b);
    Object.assign(f.request.target.logs[0], {
      digest: hash(old),
      nextDigest: hash(b),
      nextBytes: b.length,
    });
    resnapshot(f);
    const k = await createGitCommitKernel();
    try {
      const r = await k.prepare(f.request);
      assert.equal(r.status, "unknown");
      assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
    } finally {
      await k.close();
    }
  });
  for (const variant of [
    "worktree",
    "root",
    "HEAD",
    "index",
    "lock",
    "artifact",
    "backup",
    "object",
  ])
    await run(`commit-race-${variant}`, async () => {
      const f = setup(base, `commit-race-${variant}`, {
        disabled: true,
        absentLogs: true,
      });
      let armed = false,
        injected = false;
      const k = await createGitCommitKernel({
        check() {
          if (!armed || injected) return;
          injected = true;
          if (variant === "worktree")
            write(join(f.root, "old.txt"), "foreign worktree");
          if (variant === "root") fs.renameSync(f.root, f.root + "-moved");
          if (variant === "HEAD")
            write(join(f.gitDirectory, "HEAD"), "ref: refs/heads/foreign\n");
          if (variant === "index")
            write(join(f.gitDirectory, "index"), "foreign index");
          if (variant === "lock") {
            const p = join(f.gitDirectory, "index.lock");
            fs.renameSync(p, p + "-owned");
            write(p, "foreign lock");
          }
          if (variant === "artifact")
            write(join(f.artifact, "commit.body"), "foreign artifact");
          if (variant === "backup") {
            const b = gitCommitExpectedBackups(
              f.request.target,
              f.request.runtimeEpoch,
              f.request.operationId,
            )[0].backupId;
            write(join(f.common, b), "foreign backup");
          }
          if (variant === "object") {
            const o = f.manifest.objects.find((x) => x.install);
            write(join(f.common, o.path), "foreign object");
          }
        },
      });
      try {
        const p = await k.prepare(f.request);
        assert.equal(p.status, "prepared", JSON.stringify(p));
        armed = true;
        const r = await k.publish({ token: p.token });
        assert.equal(r.status, "unknown");
        assert.ok(injected);
        assert.deepEqual(await k.publish({ token: p.token }), r);
        if (variant !== "root")
          assert.deepEqual(
            fs.readFileSync(f.refPath),
            Buffer.from(f.request.target.headOid + "\n"),
          );
      } finally {
        await k.close();
      }
    });
  await run("packed-index-table-tamper", async () => {
    const f = setup(base, "packed-index-table-tamper", { packed: true }),
      entry = f.manifest.source.files.find((x) => x.path.endsWith(".idx")),
      b = fs.readFileSync(entry.path);
    const first = Buffer.from(b.subarray(1032, 1052));
    b.copy(b, 1032, 1052, 1072);
    first.copy(b, 1052);
    createHash("sha1")
      .update(b.subarray(0, -20))
      .digest()
      .copy(b, b.length - 20);
    fs.chmodSync(entry.path, 0o600);
    write(entry.path, b);
    resnapshot(f);
    const k = await createGitCommitKernel();
    try {
      assert.equal((await k.prepare(f.request)).reason, "object_conflict");
      assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), false);
    } finally {
      await k.close();
    }
  });
  await run("prepared-token-deadline-cache", async () => {
    const f = setup(base, "prepared-token-deadline-cache", {
        disabled: true,
        absentLogs: true,
      }),
      k = await createGitMetadataKernel({ timeoutMs: 5000 });
    try {
      const p = await k.commit.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      await new Promise((r) => setTimeout(r, 5100));
      assert.equal(
        (await k.commit.publish({ token: p.token })).reason,
        "deadline",
      );
      assert.equal(
        (await k.index.publish({ token: p.token })).reason,
        "invalid_request",
      );
      assert.equal(fs.existsSync(join(f.gitDirectory, "index.lock")), true);
    } finally {
      await k.close();
    }
  });

  await run("linked-readonly-worktrees-ancestor", async () => {
    const f = setup(base, "linked-readonly-worktrees-ancestor", {
        linked: true,
      }),
      p = join(f.common, "worktrees");
    assert.equal(
      spawnSync("/bin/chmod", ["+a", "everyone allow read", p]).status,
      0,
    );
    resnapshot(f);
    const k = await createGitCommitKernel();
    try {
      const prepared = await k.prepare(f.request);
      assert.equal(prepared.status, "prepared", JSON.stringify(prepared));
      assert.equal(
        (await k.abort({ token: prepared.token })).status,
        "aborted",
      );
    } finally {
      await k.close();
    }
  });
  return evidence.length;
}
if (process.argv[2] === "--synthetic-fixture") {
  const count = await fixtures(process.argv[3]);
  process.stdout.write(JSON.stringify({ passed: count }) + "\n");
} else {
  const { test } = await import("node:test");
  test("commit facade import is inert; unsupported runtime refuses", async () => {
    assert.deepEqual(Object.keys(await import("./git-commit-kernel.mjs")), [
      "createGitCommitKernel",
    ]);
    await assert.rejects(createGitCommitKernel(), {
      message: "unsupported_runtime",
    });
  });
  test("pinned Bun commit fixtures", { timeout: 600000 }, () => {
    const resource = join(
        repo,
        "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64",
      ),
      manifest = JSON.parse(fs.readFileSync(join(resource, "manifest.json"))),
      bun = join(resource, "runtime/bun"),
      entry = manifest.entries.find((e) => e.path === "runtime/bun"),
      before = hash(fs.readFileSync(bun));
    assert.equal(manifest.bunVersion, "1.4.2");
    assert.equal(entry.sha256, before);
    assert.equal(entry.size, fs.statSync(bun).size);
    assert.equal(fs.realpathSync(bun), bun);
    assert.equal(fs.lstatSync(bun).nlink, 1);
    const gitVersion = spawnSync(git, ["--version"], {
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(gitVersion.status, 0);
    assert.match(gitVersion.stdout, /^git version 2\.50\.1 /u);
    const names = [
      "git-metadata-kernel.mjs",
      "git-metadata-kernel.test.mjs",
      "git-index-kernel.mjs",
      "git-index-kernel.test.mjs",
      "git-commit-kernel.mjs",
      "git-commit-kernel.test.mjs",
    ];
    const sourcePins = () =>
      names.map((n) => {
        const path = join(here, n),
          b = fs.readFileSync(path);
        return { path, bytes: b.length, sha256: hash(b) };
      });
    const pinsBefore = sourcePins();
    const base = fs.realpathSync(
      fs.mkdtempSync(join(tmpdir(), "omoc-git-commit-kernel-")),
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
    assert.equal(hash(fs.readFileSync(bun)), before);
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0, child.stderr + child.stdout);
    const report = JSON.parse(fs.readFileSync(join(base, "report.json")));
    assert.ok(report.evidence.length >= 32);
    assert.ok(report.evidence.every((x) => x.status === "pass"));
    report.process = { exitCode: child.status, signal: child.signal };
    report.runtimeBinary = { path: bun, sha256: before };
    assert.deepEqual(
      sourcePins(),
      pinsBefore,
      "Source changed during the synthetic run",
    );
    report.ownedSources = pinsBefore;
    fs.writeFileSync(
      join(base, "report.json"),
      JSON.stringify(report, null, 2),
    );
  });
}
