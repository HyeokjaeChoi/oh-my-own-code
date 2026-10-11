import assert from "node:assert/strict";
import * as fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { spawnSync } from "node:child_process";
import { createGitIndexKernel } from "./git-index-kernel.mjs";
import {
  gitIndexBackupId,
  validateGitIndexKernelResult,
  GIT_INDEX_KERNEL_LIMITS,
} from "./git-index-contract.mjs";
import {
  GIT_ABSENT_INDEX_DIGEST,
  GIT_INDEX_FEATURE,
} from "../renderer/shared/git-index/index.mjs";

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
function index(entries, format) {
  const width = format === "sha1" ? 20 : 32,
    header = Buffer.alloc(12);
  header.write("DIRC");
  header.writeUInt32BE(2, 4);
  header.writeUInt32BE(entries.length, 8);
  const records = [...entries]
    .sort((a, b) => Buffer.compare(Buffer.from(a.path), Buffer.from(b.path)))
    .map((e) => {
      const name = Buffer.from(e.path + "\0"),
        b = Buffer.alloc(Math.ceil((42 + width + name.length) / 8) * 8);
      b.writeUInt32BE(e.mode ?? 0o100644, 24);
      Buffer.from(e.oid, "hex").copy(b, 40);
      b.writeUInt16BE(Math.min(name.length - 1, 4095), 40 + width);
      name.copy(b, 42 + width);
      return b;
    });
  const body = Buffer.concat([header, ...records]);
  return Buffer.concat([body, createHash(format).update(body).digest()]);
}
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
    absent = false,
    unborn = false,
    action = "stage",
    linked = false,
    binary = false,
    existingObject = false,
    deletion = false,
    addition = false,
  } = {},
) {
  const home = join(base, name);
  fs.mkdirSync(home, { mode: 0o700 });
  const root = join(home, "workspace"),
    artifact = join(home, "artifact"),
    envHome = join(home, "home");
  for (const p of [root, artifact, envHome]) fs.mkdirSync(p, { mode: 0o700 });
  const env = {
    PATH: "/usr/bin:/bin",
    HOME: envHome,
    XDG_CONFIG_HOME: envHome,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_TERMINAL_PROMPT: "0",
    LC_ALL: "C",
  };
  const command = (args) => {
    const p = spawnSync(git, args, {
      cwd: root,
      env,
      encoding: "utf8",
      timeout: 5000,
    });
    assert.equal(p.error, undefined);
    assert.equal(p.status, 0, p.stderr);
    return p.stdout;
  };
  command([
    "init",
    "--quiet",
    `--object-format=${format}`,
    "--initial-branch=main",
  ]);
  let gitDirectory = join(root, ".git"),
    common = gitDirectory;
  const old = loose("blob", Buffer.from("old\n"), format),
    next = loose(
      "blob",
      binary
        ? Buffer.from(Array.from({ length: 131073 }, (_, i) => i % 256))
        : Buffer.from("new\n"),
      format,
    );
  const other = loose("blob", Buffer.from("nonselected\n"), format),
    protectedBlob = loose("blob", Buffer.from("synthetic protected\n"), format);
  const store = (o) =>
    write(join(common, "objects", o.oid.slice(0, 2), o.oid.slice(2)), o.bytes);
  for (const o of [old, other, protectedBlob]) store(o);
  let head = null;
  if (!unborn) {
    const tree = loose(
      "tree",
      Buffer.concat([
        Buffer.from("100644 selected.bin\0"),
        Buffer.from(old.oid, "hex"),
      ]),
      format,
    );
    store(tree);
    const commit = loose(
      "commit",
      Buffer.from(
        `tree ${tree.oid}\nauthor Synthetic <synthetic@example.invalid> 1 +0000\ncommitter Synthetic <synthetic@example.invalid> 1 +0000\n\nfixture\n`,
      ),
      format,
    );
    store(commit);
    head = commit.oid;
    write(join(common, "refs/heads/main"), head + "\n");
  }
  if (linked) {
    const metadata = join(home, "metadata");
    fs.renameSync(common, metadata);
    common = metadata;
    gitDirectory = join(common, "worktrees/fixture");
    fs.mkdirSync(gitDirectory, { recursive: true, mode: 0o700 });
    write(join(root, ".git"), `gitdir: ${gitDirectory}\n`);
    write(join(gitDirectory, "gitdir"), join(root, ".git") + "\n");
    write(join(gitDirectory, "commondir"), "../..\n");
    write(join(gitDirectory, "HEAD"), "ref: refs/heads/main\n");
    write(join(common, "worktrees/other/HEAD"), "ref: refs/heads/main\n");
    write(
      join(common, "worktrees/other/sentinel"),
      "other worktree sentinel\n",
    );
  }
  const beforeEntries = absent
    ? []
    : [
        { path: "selected.bin", oid: action === "stage" ? old.oid : next.oid },
        { path: "other.txt", oid: other.oid },
        { path: ".env", oid: protectedBlob.oid },
      ];
  if (action === "unstage" || existingObject) store(next);
  if (addition)
    beforeEntries.splice(
      beforeEntries.findIndex((e) => e.path === "selected.bin"),
      1,
    );
  const afterEntries = [
    ...beforeEntries.filter((e) => e.path !== "selected.bin"),
    ...((action === "unstage" && unborn) || deletion
      ? []
      : [
          {
            path: "selected.bin",
            oid: action === "stage" ? next.oid : old.oid,
          },
        ]),
  ];
  const original = absent ? null : index(beforeEntries, format),
    proposal = index(afterEntries, format);
  if (original) write(join(gitDirectory, "index"), original, 0o640);
  write(join(root, "selected.bin"), next.bytes);
  write(join(root, "other.txt"), "worktree sentinel\n");
  write(join(root, ".env"), "synthetic protected\n");
  const request = {
    runtimeEpoch: "kernel-epoch",
    operationId: name,
    workspaceId: "synthetic",
    workspacePath: root,
    digest: "a".repeat(64),
    target: {
      action,
      paths: ["selected.bin"],
      previewDigest: "b".repeat(64),
      headOid: head,
      indexExists: !absent,
      indexDigest: original ? hash(original) : GIT_ABSENT_INDEX_DIGEST,
      nextIndexDigest: hash(proposal),
      objectFormat: format,
    },
    artifact: {
      root: artifact,
      ...(({ dev, ino }) => ({ dev, ino }))(inode(artifact)),
      manifest: { path: "manifest.json", bytes: 1, digest: "c".repeat(64) },
    },
  };
  const objectRecords = action === "stage" && !deletion ? [next] : [];
  const manifest = {
    schemaVersion: 1,
    feature: GIT_INDEX_FEATURE,
    runtimeEpoch: request.runtimeEpoch,
    operationId: name,
    workspaceId: request.workspaceId,
    workspacePath: root,
    digest: request.digest,
    target: request.target,
    layout: {
      root: inode(root),
      gitDirectory: inode(gitDirectory),
      commonDirectory: inode(common),
    },
    source: snapshot(
      [root, gitDirectory, common],
      [
        join(common, "packed-refs"),
        ...(head ? [] : [join(common, "refs/heads/main")]),
        ...(absent ? [join(gitDirectory, "index")] : []),
      ],
    ),
    proposal: {
      path: "proposal.index",
      bytes: proposal.length,
      digest: hash(proposal),
    },
    objects: objectRecords.map((o) => ({
      oid: o.oid,
      rawBytes: o.rawBytes,
      path: `objects/${o.oid.slice(0, 2)}/${o.oid.slice(2)}`,
      bytes: o.bytes.length,
      digest: hash(o.bytes),
    })),
  };
  write(join(artifact, "proposal.index"), proposal);
  for (const o of objectRecords)
    write(
      join(artifact, `objects/${o.oid.slice(0, 2)}/${o.oid.slice(2)}`),
      o.bytes,
    );
  const save = () => {
    const bytes = Buffer.from(JSON.stringify(manifest));
    write(join(artifact, "manifest.json"), bytes);
    request.artifact.manifest = {
      path: "manifest.json",
      bytes: bytes.length,
      digest: hash(bytes),
    };
  };
  save();
  const backup = gitIndexBackupId(request.runtimeEpoch, name),
    indexPath = join(gitDirectory, "index"),
    lockPath = join(gitDirectory, "index.lock"),
    backupPath = join(gitDirectory, backup);
  return {
    root,
    common,
    gitDirectory,
    artifact,
    request,
    manifest,
    save,
    proposal,
    original,
    indexPath,
    lockPath,
    backupPath,
    backup,
    next,
    old,
    command,
  };
}
async function fixtures(base) {
  const evidence = [],
    run = async (name, action) => {
      try {
        const verification = await action();
        evidence.push({ name, status: "pass", verification });
      } catch (e) {
        evidence.push({ name, status: "fail", error: e.stack });
        fs.writeFileSync(
          join(base, "report.json"),
          JSON.stringify({ base, evidence }, null, 2),
        );
        throw e;
      }
    };
  const terminal = (r) => {
    validateGitIndexKernelResult(r);
    return r;
  };
  for (const format of ["sha1", "sha256"]) {
    for (const variant of [
      "present",
      "absent",
      "unborn-existing",
      "linked",
      "binary",
      "unstage",
      "unborn-unstage",
      "add",
      "delete",
      "existing-object",
    ])
      await run(`${format}-${variant}`, async () => {
        const f = setup(base, `${format}-${variant}`, {
          format,
          absent: variant === "absent",
          unborn: ["absent", "unborn-existing", "unborn-unstage"].includes(
            variant,
          ),
          linked: variant === "linked",
          binary: variant === "binary",
          existingObject: variant === "existing-object",
          deletion: variant === "delete",
          addition: variant === "add",
          action: variant.includes("unstage") ? "unstage" : "stage",
        });
        const before = f.manifest.source.files.filter(
          (x) => x.path !== f.indexPath,
        );
        const k = await createGitIndexKernel();
        try {
          const p = terminal(await k.prepare(f.request));
          assert.equal(p.status, "prepared", JSON.stringify(p));
          assert.match(p.token, /^[a-f0-9]{64}$/u);
          const r = terminal(await k.publish({ token: p.token }));
          assert.deepEqual(r, {
            status: "applied",
            indexDigest: hash(f.proposal),
            backupId: f.original ? f.backup : null,
          });
          assert.deepEqual(await k.publish({ token: p.token }), r);
          assert.deepEqual(fs.readFileSync(f.indexPath), f.proposal);
          assert.equal(fs.existsSync(f.lockPath), false);
          assert.equal(fs.existsSync(f.backupPath), Boolean(f.original));
          if (f.original) {
            assert.deepEqual(fs.readFileSync(f.backupPath), f.original);
            assert.equal(fs.statSync(f.indexPath).mode & 0o777, 0o640);
          }
          for (const b of before) {
            assert.equal(hash(fs.readFileSync(b.path)), b.digest);
            assert.equal(
              sig(fs.lstatSync(b.path, { bigint: true })),
              b.signature,
            );
          }
          const after = before.map((b) => ({
            path: b.path,
            signature: sig(fs.lstatSync(b.path, { bigint: true })),
            digest: hash(fs.readFileSync(b.path)),
          }));
          const worktree = (records) =>
            records.filter(
              (b) =>
                b.path.startsWith(f.root + "/") &&
                b.path !== join(f.root, ".git") &&
                !b.path.startsWith(join(f.root, ".git") + "/"),
            );
          const headPath = join(f.gitDirectory, "HEAD");
          return {
            indexBefore: f.request.target.indexDigest,
            indexAfter: hash(fs.readFileSync(f.indexPath)),
            backupDigest: f.original
              ? hash(fs.readFileSync(f.backupPath))
              : null,
            headBefore: before.find((b) => b.path === headPath).digest,
            headAfter: hash(fs.readFileSync(headPath)),
            sourceBefore: hash(JSON.stringify(before)),
            sourceAfter: hash(JSON.stringify(after)),
            worktreeBefore: hash(JSON.stringify(worktree(before))),
            worktreeAfter: hash(JSON.stringify(worktree(after))),
          };
        } finally {
          await k.close();
        }
      });
  }
  for (const scenario of [
    "foreign-lock",
    "backup-collision",
    "readonly",
    "index-symlink",
    "index-hardlink",
    "artifact-symlink",
    "artifact-hardlink",
    "invalid-checksum",
    "nonselected-change",
    "cache-only",
    "raw-body-length",
    "inflate-bomb",
    "nonselected-omission",
    "listing-omission",
    "bomb-total",
    "extra-artifact",
    "source-omission",
    "existing-object-conflict",
  ])
    await run(scenario, async () => {
      const f = setup(base, scenario);
      let expected;
      if (scenario === "foreign-lock") {
        write(f.lockPath, "FOREIGN");
        expected = "lock_conflict";
      }
      if (scenario === "backup-collision") write(f.backupPath, "FOREIGN");
      if (scenario === "readonly") fs.chmodSync(f.indexPath, 0o400);
      if (scenario === "index-symlink") {
        fs.renameSync(f.indexPath, join(f.root, "victim"));
        fs.symlinkSync(join(f.root, "victim"), f.indexPath);
      }
      if (scenario === "index-hardlink")
        fs.linkSync(f.indexPath, join(f.root, "victim"));
      if (scenario === "artifact-symlink") {
        fs.renameSync(
          join(f.artifact, "proposal.index"),
          join(f.artifact, "saved"),
        );
        fs.symlinkSync("saved", join(f.artifact, "proposal.index"));
      }
      if (scenario === "artifact-hardlink")
        fs.linkSync(
          join(f.artifact, "proposal.index"),
          join(f.artifact, "alias"),
        );
      if (
        ["invalid-checksum", "nonselected-change", "cache-only"].includes(
          scenario,
        )
      ) {
        let bytes;
        if (scenario === "invalid-checksum") {
          bytes = Buffer.from(f.proposal);
          bytes[12] ^= 1;
        }
        if (scenario === "nonselected-change")
          bytes = index(
            [
              { path: "selected.bin", oid: f.next.oid },
              { path: "other.txt", oid: f.next.oid },
              { path: ".env", oid: f.old.oid },
            ],
            "sha1",
          );
        if (scenario === "cache-only") bytes = f.original;
        write(join(f.artifact, "proposal.index"), bytes);
        f.manifest.proposal.bytes = bytes.length;
        f.manifest.proposal.digest = hash(bytes);
        f.request.target.nextIndexDigest = hash(bytes);
        f.manifest.target = f.request.target;
        f.save();
      }
      if (scenario === "inflate-bomb") {
        const record = f.manifest.objects[0];
        const bytes = deflateSync(
          Buffer.concat([
            Buffer.from("blob 4\0"),
            Buffer.alloc(4 * 1024 * 1024),
          ]),
        );
        write(join(f.artifact, record.path), bytes);
        record.bytes = bytes.length;
        record.digest = hash(bytes);
        f.save();
        expected = "object_conflict";
      }
      if (scenario === "nonselected-omission") {
        f.manifest.source.files = f.manifest.source.files.filter(
          (x) => x.path !== join(f.root, "other.txt"),
        );
        f.save();
        expected = "invalid_request";
      }
      if (scenario === "listing-omission") {
        f.manifest.source.listings = f.manifest.source.listings.filter(
          (x) => x.path !== f.gitDirectory,
        );
        f.save();
        expected = "invalid_request";
      }
      if (scenario === "raw-body-length") {
        f.manifest.objects[0].rawBytes++;
        f.save();
      }
      if (scenario === "bomb-total") {
        expected = "invalid_request";
        f.manifest.objects[0].rawBytes = GIT_INDEX_KERNEL_LIMITS.artifactBytes;
        // A second unique structurally valid record exceeds the separate raw budget.
        const o = {
          ...f.manifest.objects[0],
          oid: "f".repeat(40),
          path: `objects/ff/${"f".repeat(38)}`,
        };
        f.manifest.objects.push(o);
        write(join(f.artifact, o.path), f.next.bytes);
        f.save();
      }
      if (scenario === "extra-artifact")
        write(join(f.artifact, "unexpected"), "must refuse");
      if (scenario === "source-omission") {
        f.manifest.source.files = f.manifest.source.files.filter(
          (x) => x.path !== join(f.gitDirectory, "HEAD"),
        );
        f.save();
      }
      if (scenario === "existing-object-conflict") {
        write(
          join(
            f.common,
            "objects",
            f.next.oid.slice(0, 2),
            f.next.oid.slice(2),
          ),
          "collision",
        );
        f.manifest.source = snapshot(
          [f.root, f.gitDirectory, f.common],
          f.manifest.source.missing,
        );
        f.save();
        expected = "object_conflict";
      }
      if (["foreign-lock", "backup-collision"].includes(scenario)) {
        f.manifest.source = snapshot(
          [f.root, f.gitDirectory, f.common],
          f.manifest.source.missing,
        );
        f.save();
      }
      const before = fs.readFileSync(f.indexPath);
      const k = await createGitIndexKernel();
      try {
        const r = terminal(await k.prepare(f.request));
        assert.equal(r.status, "unknown", JSON.stringify(r));
        if (expected) assert.equal(r.reason, expected);
        if (scenario === "bomb-total")
          assert.equal(fs.existsSync(f.lockPath), false);
        assert.deepEqual(fs.readFileSync(f.indexPath), before);
      } finally {
        await k.close();
      }
      if (scenario === "foreign-lock")
        assert.equal(fs.readFileSync(f.lockPath, "utf8"), "FOREIGN");
      if (scenario === "backup-collision")
        assert.equal(fs.readFileSync(f.backupPath, "utf8"), "FOREIGN");
    });
  for (const race of [
    "worktree",
    "HEAD",
    "root",
    "lock",
    "artifact",
    "index",
    "common",
    "post-HEAD",
    "post-worktree",
    "partial-object",
  ])
    await run(`race-${race}`, async () => {
      const f = setup(base, `race-${race}`);
      let armed = false,
        fired = false;
      const k = await createGitIndexKernel({
        check() {
          if (!armed || fired) return;
          const published =
            fs.existsSync(f.indexPath) &&
            hash(fs.readFileSync(f.indexPath)) === hash(f.proposal);
          if (
            (race.startsWith("post-") && !published) ||
            (race === "partial-object" &&
              !fs.existsSync(
                join(
                  f.common,
                  "objects",
                  f.next.oid.slice(0, 2),
                  f.next.oid.slice(2),
                ),
              ))
          )
            return;
          fired = true;
          if (
            race === "worktree" ||
            race === "post-worktree" ||
            race === "partial-object"
          )
            write(join(f.root, "other.txt"), "external race\n");
          if (race === "HEAD" || race === "post-HEAD")
            write(join(f.gitDirectory, "HEAD"), "ref: refs/heads/changed\n");
          if (race === "root") fs.renameSync(f.root, f.root + "-moved");
          if (race === "lock") {
            fs.renameSync(f.lockPath, f.lockPath + "-owned");
            write(f.lockPath, "FOREIGN");
          }
          if (race === "index")
            write(f.indexPath, "external index replacement");
          if (race === "common") {
            fs.renameSync(
              join(f.common, "objects"),
              join(f.common, "objects-moved"),
            );
            fs.mkdirSync(join(f.common, "objects"), { mode: 0o700 });
          }
          if (race === "artifact")
            write(join(f.artifact, "proposal.index"), "changed");
        },
      });
      try {
        if (race === "partial-object") armed = true;
        const p = await k.prepare(f.request);
        if (race === "partial-object") {
          assert.equal(p.status, "unknown");
          assert.equal(fired, true);
          assert.deepEqual(fs.readFileSync(f.indexPath), f.original);
          assert.equal(
            fs.existsSync(
              join(
                f.common,
                "objects",
                f.next.oid.slice(0, 2),
                f.next.oid.slice(2),
              ),
            ),
            true,
          );
        } else {
          assert.equal(p.status, "prepared", JSON.stringify(p));
          armed = true;
          const r = terminal(await k.publish({ token: p.token }));
          assert.equal(r.status, "unknown");
          assert.equal(fired, true);
          assert.deepEqual(await k.publish({ token: p.token }), r);
          if (race.startsWith("post-")) {
            assert.deepEqual(fs.readFileSync(f.indexPath), f.proposal);
            assert.deepEqual(fs.readFileSync(f.backupPath), f.original);
          }
          if (race === "lock")
            assert.equal(fs.readFileSync(f.lockPath, "utf8"), "FOREIGN");
        }
      } finally {
        await k.close();
      }
    });
  await run("abort-retains-objects", async () => {
    const f = setup(base, "abort-retains-objects"),
      k = await createGitIndexKernel();
    try {
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.deepEqual(await k.abort({ token: p.token }), {
        status: "aborted",
      });
      assert.deepEqual(fs.readFileSync(f.indexPath), f.original);
      assert.equal(fs.existsSync(f.lockPath), false);
      assert.equal(fs.existsSync(f.backupPath), false);
      assert.equal(
        fs.existsSync(
          join(
            f.common,
            "objects",
            f.next.oid.slice(0, 2),
            f.next.oid.slice(2),
          ),
        ),
        true,
      );
      assert.deepEqual(await k.publish({ token: p.token }), {
        status: "aborted",
      });
    } finally {
      await k.close();
    }
  });
  await run("check-failure-and-reentry", async () => {
    const f = setup(base, "check-failure-and-reentry");
    let k,
      armed = false;
    const reentry = [];
    k = await createGitIndexKernel({
      check() {
        if (!armed) return;
        armed = false;
        reentry.push(
          k.prepare(f.request),
          k.publish({ token: "0".repeat(64) }),
          k.close().then(
            () => "closed",
            (e) => e.message,
          ),
        );
      },
    });
    try {
      armed = true;
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      const r = await Promise.all(reentry);
      assert.deepEqual(r, [
        { status: "unknown", reason: "invalid_request" },
        { status: "unknown", reason: "invalid_request" },
        "invalid_request",
      ]);
      assert.equal((await k.publish({ token: p.token })).status, "applied");
    } finally {
      await k.close();
    }
    const f2 = setup(base, "check-failure"),
      k2 = await createGitIndexKernel({
        check() {
          throw new Error("private callback data");
        },
      });
    try {
      assert.deepEqual(await k2.prepare(f2.request), {
        status: "unknown",
        reason: "path_changed",
      });
      assert.equal(fs.existsSync(f2.lockPath), false);
    } finally {
      await k2.close();
    }
  });
  await run("deadline-and-close", async () => {
    const f = setup(base, "deadline-and-close"),
      k = await createGitIndexKernel({ timeoutMs: 1500 });
    const p = await k.prepare(f.request);
    assert.equal(p.status, "prepared", JSON.stringify(p));
    await new Promise((r) => setTimeout(r, 1600));
    assert.deepEqual(await k.publish({ token: p.token }), {
      status: "unknown",
      reason: "deadline",
    });
    assert.deepEqual(fs.readFileSync(f.indexPath), f.original);
    assert.equal(fs.existsSync(f.lockPath), true);
    assert.equal(fs.existsSync(f.backupPath), true);
    await k.close();
    await k.close();
    assert.deepEqual(await k.prepare(f.request), {
      status: "unknown",
      reason: "invalid_request",
    });
  });
  await run("closed-requests-and-busy", async () => {
    const f = setup(base, "closed-requests-and-busy"),
      k = await createGitIndexKernel();
    try {
      for (const r of [null, { ...f.request, io: {} }])
        assert.deepEqual(await k.prepare(r), {
          status: "unknown",
          reason: "invalid_request",
        });
      const p = await k.prepare(f.request);
      assert.equal(p.status, "prepared", JSON.stringify(p));
      assert.deepEqual(await k.prepare(f.request), {
        status: "unknown",
        reason: "invalid_request",
      });
      for (const r of [{ token: "0".repeat(64) }, { token: p.token, extra: 1 }])
        assert.deepEqual(await k.publish(r), {
          status: "unknown",
          reason: "invalid_request",
        });
      assert.equal((await k.publish({ token: p.token })).status, "applied");
    } finally {
      await k.close();
    }
  });
  fs.writeFileSync(
    join(base, "report.json"),
    JSON.stringify(
      { base, runtime: globalThis.Bun.version, evidence },
      null,
      2,
    ),
  );
  return evidence.length;
}
if (process.argv[2] === "--synthetic-fixture") {
  const count = await fixtures(process.argv[3]);
  process.stdout.write(JSON.stringify({ passed: count }) + "\n");
} else {
  const { test } = await import("node:test");
  test("Node import is inert and factory refuses unsupported runtime", async () => {
    assert.deepEqual(Object.keys(await import("./git-index-kernel.mjs")), [
      "createGitIndexKernel",
    ]);
    await assert.rejects(createGitIndexKernel(), {
      message: "unsupported_runtime",
    });
  });
  test("factory options are closed data with a fixed maximum deadline", async () => {
    for (const options of [
      null,
      { io: {} },
      { timeoutMs: 10001 },
      { timeoutMs: 0 },
      { check: 3 },
    ])
      await assert.rejects(createGitIndexKernel(options), {
        message: "invalid_request",
      });
    let touched = false;
    await assert.rejects(
      createGitIndexKernel({
        get check() {
          touched = true;
          return undefined;
        },
      }),
      { message: "invalid_request" },
    );
    assert.equal(touched, false);
  });
  test(
    "manifest-pinned bundled Bun publishes only within owned synthetic namespaces",
    { timeout: 60000 },
    () => {
      assert.equal(process.platform, "darwin");
      assert.equal(process.arch, "arm64");
      const resource = join(
          repo,
          "apps/desktop-app/dist/resources/opencode/event-host/darwin-arm64",
        ),
        manifest = JSON.parse(
          fs.readFileSync(join(resource, "manifest.json"), "utf8"),
        );
      const bun = join(resource, "runtime/bun"),
        entry = manifest.entries.find((e) => e.path === "runtime/bun"),
        beforeBun = hash(fs.readFileSync(bun));
      assert.equal(manifest.bunVersion, "1.4.2");
      assert.equal(entry.sha256, beforeBun);
      assert.equal(entry.size, fs.statSync(bun).size);
      assert.equal(fs.lstatSync(bun).nlink, 1);
      assert.equal(fs.realpathSync(bun), bun);
      const v = spawnSync(git, ["--version"], {
        encoding: "utf8",
        timeout: 5000,
      });
      assert.equal(v.status, 0);
      assert.match(v.stdout, /^git version 2\.50\.1 /u);
      const base = fs.realpathSync(
        fs.mkdtempSync(join(tmpdir(), "omoc-git-index-kernel-")),
      );
      const child = spawnSync(
        bun,
        [fileURLToPath(import.meta.url), "--synthetic-fixture", base],
        {
          encoding: "utf8",
          timeout: 55000,
          env: { PATH: "/usr/bin:/bin", HOME: base, LC_ALL: "C" },
        },
      );
      // Retain every namespace and report; no deletion on timeout or unknown exit.
      process.stdout.write(`Synthetic evidence: ${base}/report.json\n`);
      assert.equal(hash(fs.readFileSync(bun)), beforeBun);
      assert.equal(child.error, undefined, String(child.error));
      assert.equal(child.signal, null);
      assert.equal(child.status, 0, child.stderr + child.stdout);
      const report = JSON.parse(
        fs.readFileSync(join(base, "report.json"), "utf8"),
      );
      assert.equal(report.runtime, "1.4.2");
      assert.ok(report.evidence.length >= 40);
      assert.ok(report.evidence.every((e) => e.status === "pass"));
      for (const e of report.evidence.filter((e) => e.verification)) {
        assert.equal(e.verification.sourceBefore, e.verification.sourceAfter);
        assert.equal(e.verification.headBefore, e.verification.headAfter);
        assert.equal(
          e.verification.worktreeBefore,
          e.verification.worktreeAfter,
        );
      }
      report.runtimeBinary = {
        path: bun,
        before: beforeBun,
        after: hash(fs.readFileSync(bun)),
      };
      report.manifestDigest = hash(
        fs.readFileSync(join(resource, "manifest.json")),
      );
      report.process = { exitCode: child.status, signal: child.signal };
      report.ownedSources = [
        "git-metadata-kernel.mjs",
        "git-index-kernel.mjs",
        "git-index-kernel.test.mjs",
      ].map((name) => {
        const path = join(here, name),
          bytes = fs.readFileSync(path);
        return { path, bytes: bytes.length, sha256: hash(bytes) };
      });
      fs.writeFileSync(
        join(base, "report.json"),
        JSON.stringify(report, null, 2),
      );
    },
  );
}
