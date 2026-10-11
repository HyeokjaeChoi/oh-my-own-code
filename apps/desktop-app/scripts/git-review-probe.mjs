// Synthetic acceptance probe. Never run Git against the source checkout or a
// user repository. Reports contain bounded categories, hashes and booleans only.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import * as syncIO from "node:fs";
import { join, resolve, dirname } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { createWorkbenchGitReader } from "../src/host/workbench-git.mjs";
import {
  GIT_REVIEW_LIMITS,
  validateGitReviewObservation,
  validateGitDiffObservation,
} from "../src/renderer/shared/git-review/index.mjs";

const GIT = "/Library/Developer/CommandLineTools/usr/bin/git";
const digest = (b) => createHash("sha256").update(b).digest("hex");
const scope = () => ({
  runtimeEpoch: "synthetic-git-probe",
  sender: {},
  trusted: false,
  trustRevision: 0,
  check() {},
});
const publicReview = (v) =>
  validateGitReviewObservation({
    runtimeEpoch: "synthetic-git-probe",
    revision: 0,
    ...v,
  });
const publicDiff = (v) =>
  validateGitDiffObservation({
    runtimeEpoch: "synthetic-git-probe",
    revision: 0,
    ...v,
  });
const request = (w, o, path, mode, baseRef) => ({
  type: "git.diff.read",
  workspaceId: w.id,
  observationId: o.observationId,
  path,
  mode,
  ...(mode === "base" ? { baseRef } : {}),
});
const envFor = (home) => ({
  HOME: home,
  XDG_CONFIG_HOME: home,
  PATH: dirname(GIT),
  LC_ALL: "C",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_SYSTEM: "/dev/null",
  GIT_TERMINAL_PROMPT: "0",
  GIT_AUTHOR_NAME: "Synthetic",
  GIT_AUTHOR_EMAIL: "synthetic@example.invalid",
  GIT_COMMITTER_NAME: "Synthetic",
  GIT_COMMITTER_EMAIL: "synthetic@example.invalid",
  GIT_OPTIONAL_LOCKS: "0",
});

// This separate setup runner has explicit synthetic write commands. Production
// reader never calls it and has its own read-only, fixed-argv executor.
function setupRunner(root, home) {
  const allowed = new Set([
    "init",
    "add",
    "commit",
    "worktree",
    "rev-parse",
    "config",
    "update-index",
  ]);
  return (args, input) => {
    assert.ok(allowed.has(args[0]), "synthetic_setup_command_denied");
    assert.ok(root.startsWith(home + "/"), "synthetic_setup_root_denied");
    const p = spawnSync(GIT, args, {
      cwd: root,
      env: envFor(home),
      input,
      encoding: "utf8",
      timeout: 5000,
      maxBuffer: 1048576,
    });
    if (p.error || p.status !== 0)
      throw Object.assign(new Error("synthetic_setup_failed"), {
        probeReason: "synthetic_setup_failed",
        exit: p.status,
      });
    return p.stdout.trim(); // Only callers consume known OIDs/config setup data.
  };
}
async function repo(home, name, format = "sha1") {
  const path = join(home, name);
  await fs.mkdir(path, { mode: 0o700 });
  const run = setupRunner(path, home);
  run(["init", "-b", "main", `--object-format=${format}`]);
  await fs.writeFile(join(path, "a.txt"), "head\n");
  run(["add", "--", "a.txt"]);
  run(["commit", "-m", "synthetic-initial"]);
  return { workspace: { id: name, path }, path, run };
}
async function inventory(root) {
  const map = {};
  async function walk(path, rel = "", depth = 0) {
    assert.ok(depth <= 40, "synthetic_inventory_depth");
    for (const name of (await fs.readdir(path)).sort()) {
      const target = join(path, name),
        key = rel ? `${rel}/${name}` : name;
      const s = await fs.lstat(target, { bigint: true });
      if (s.isDirectory() && !s.isSymbolicLink()) {
        map[key + "/"] = [
          String(s.dev),
          String(s.ino),
          String(s.mode),
          String(s.nlink),
          String(s.mtimeNs),
          String(s.ctimeNs),
        ];
        await walk(target, key, depth + 1);
      } else if (s.isFile())
        map[key] = [
          String(s.dev),
          String(s.ino),
          String(s.mode),
          String(s.nlink),
          String(s.size),
          String(s.mtimeNs),
          String(s.ctimeNs),
          digest(await fs.readFile(target)),
        ];
      else
        map[key] = [
          s.isSymbolicLink() ? "symlink" : "nonregular",
          String(s.dev),
          String(s.ino),
        ];
      assert.ok(Object.keys(map).length <= 20000, "synthetic_inventory_bound");
    }
  }
  await walk(root);
  return map;
}
async function scanCanaries(root, canaries) {
  let bytes = 0,
    files = 0;
  async function walk(path) {
    for (const e of await fs.readdir(path, { withFileTypes: true })) {
      const target = join(path, e.name);
      if (e.isDirectory()) await walk(target);
      else if (e.isFile()) {
        const s = await fs.stat(target);
        bytes += s.size;
        files++;
        assert.ok(
          bytes <= GIT_REVIEW_LIMITS.objectBytes * 2 && files <= 20000,
          "canary_scan_bound",
        );
        const h = await fs.open(target, "r");
        let carry = Buffer.alloc(0);
        try {
          const b = Buffer.alloc(1048576);
          let offset = 0;
          for (;;) {
            const { bytesRead } = await h.read(b, 0, b.length, offset);
            if (!bytesRead) break;
            offset += bytesRead;
            const piece = Buffer.concat([carry, b.subarray(0, bytesRead)]);
            assert.equal(
              canaries.some((c) => piece.includes(Buffer.from(c))),
              false,
              "credential_canary_in_scratch",
            );
            carry = piece.subarray(Math.max(0, piece.length - 256));
          }
        } finally {
          await h.close();
        }
      } else throw new Error("unexpected_scratch_entry");
    }
  }
  await walk(root);
  return { files, bytes, absent: true };
}
function auditedIO(scratch, canaries, facts) {
  const check = (bytes) => {
    facts.checkedWrites++;
    assert.equal(
      canaries.some((c) => bytes.includes(Buffer.from(c))),
      false,
      "credential_canary_write",
    );
  };
  return {
    ...fs,
    async writeFile(path, bytes, options) {
      if (typeof path === "string" && path.startsWith(scratch + "/"))
        check(Buffer.from(bytes));
      return fs.writeFile(path, bytes, options);
    },
    async open(path, ...args) {
      const handle = await fs.open(path, ...args);
      if (typeof path !== "string" || !path.startsWith(scratch + "/"))
        return handle;
      let carry = Buffer.alloc(0);
      return new Proxy(handle, {
        get(target, key) {
          if (key === "write")
            return async (bytes, ...rest) => {
              const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes);
              const all = Buffer.concat([carry, b]);
              check(all);
              carry = all.subarray(Math.max(0, all.length - 256));
              return target.write(bytes, ...rest);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
  };
}
async function withReader(home, workspace, body, options = {}) {
  const scratch = join(home, "reader-scratch");
  await fs.mkdir(scratch, { recursive: true, mode: 0o700 });
  const events = [],
    before = await inventory(workspace.path);
  const reader = createWorkbenchGitReader({
    tempRoot: scratch,
    ...options,
    onEvent: (e) => {
      events.push(e);
      options.onEvent?.(e);
    },
  });
  try {
    const result = await body(reader, events);
    assert.deepEqual(
      await inventory(workspace.path),
      before,
      "production_reader_changed_original",
    );
    return result;
  } finally {
    await reader.close();
    assert.deepEqual(
      await inventory(workspace.path),
      before,
      "production_reader_changed_original_on_failure",
    );
  }
}
async function available(reader, workspace, s) {
  const observed = await reader.review(workspace, s);
  publicReview(observed);
  if (observed.status !== "available")
    throw Object.assign(new Error("reader_prerequisite_unavailable"), {
      probeReason: observed.reason,
    });
  return observed;
}
async function selected(reader, w, o, path, mode, s, baseRef) {
  const d = await reader.diff(w, request(w, o, path, mode, baseRef), s);
  publicDiff(d);
  return d;
}

async function executableCheckpoint(home) {
  const components = [];
  let current = "/";
  for (const part of ["", ...GIT.split("/").filter(Boolean)]) {
    if (part) current = join(current, part);
    const s = await fs.lstat(current, { bigint: true });
    assert.ok(
      s.uid === 0n && (s.mode & 0o022n) === 0n && !s.isSymbolicLink(),
      "fixed_executable_component_trust",
    );
    components.push({
      path: current,
      dev: String(s.dev),
      ino: String(s.ino),
      uid: String(s.uid),
      gid: String(s.gid),
      mode: Number(s.mode),
      size: String(s.size),
      mtimeNs: String(s.mtimeNs),
      ctimeNs: String(s.ctimeNs),
    });
  }
  const before = await fs.lstat(GIT, { bigint: true }),
    bytes = await fs.readFile(GIT),
    after = await fs.lstat(GIT, { bigint: true });
  assert.equal(
    String(before.ctimeNs),
    String(after.ctimeNs),
    "executable_drift",
  );
  assert.equal(String(before.ino), String(after.ino), "executable_drift");
  const p = spawnSync(GIT, ["--version"], {
    cwd: home,
    env: envFor(home),
    encoding: "utf8",
    timeout: 2000,
    maxBuffer: 8192,
  });
  assert.equal(p.status, 0, "fixed_version_probe_failed");
  const version = p.stdout.trim();
  assert.ok(
    version === "git version 2.50.1 (Apple Git-155)" ||
      /^git version 2\.54\.\d+(?:\s.*)?$/.test(version),
    "unsupported_fixed_version",
  );
  return { path: GIT, version, sha256: digest(bytes), components };
}
async function runProbe(out) {
  await fs.mkdir(dirname(out), { recursive: true });
  await fs.mkdir(out, { mode: 0o700 }); // Existing output is never overwritten.
  const home = await fs.realpath(await fs.mkdtemp(join(out, "synthetic-")));
  const report = {
    schemaVersion: 1,
    status: "running",
    syntheticRoot: home,
    runtime: { platform: process.platform, node: process.version },
    sourceHashes: {},
    results: [],
    limits: GIT_REVIEW_LIMITS,
    productionReaderSyntheticMatrixPassed: false,
    retainedSyntheticEvidence: true,
    independentCodeVerdict: "not performed",
    packagedGitAcceptance: "not performed",
  };
  const sources = [
    "../src/host/workbench-git.mjs",
    "../src/host/workbench-git.test.mjs",
    "./git-review-probe.mjs",
  ];
  for (const p of sources)
    report.sourceHashes[p] = digest(
      await fs.readFile(new URL(p, import.meta.url)),
    );
  report.executableBefore = await executableCheckpoint(home);
  const save = async () => {
    const text = JSON.stringify(report, null, 2) + "\n";
    assert.ok(Buffer.byteLength(text) <= 65536, "report_bound");
    await fs.writeFile(join(out, "report.json"), text, { mode: 0o600 });
  };
  async function check(
    id,
    fn,
    provenance = "actual production reader + fixed Git on synthetic input",
  ) {
    const row = { id, provenance, status: "running" };
    report.results.push(row);
    await save();
    try {
      row.facts = await fn();
      row.status = "pass";
    } catch (e) {
      row.status = "fail";
      row.reason =
        e.probeReason ??
        (e.appCode
          ? "transport_error"
          : e.code === "ERR_ASSERTION"
            ? "assertion_failed"
            : "probe_failed");
      if (e.appCode) row.appCode = e.appCode;
      if (Number.isInteger(e.exit)) row.exit = e.exit;
      throw e;
    } finally {
      await save();
    }
  }
  try {
    const primary = await repo(home, "primary"),
      w = primary.workspace;
    await check("fixed-executor-and-original-preservation", () =>
      withReader(home, w, async (r, events) => {
        const o = await available(r, w, scope());
        assert.equal(o.repository.worktreePath, w.path);
        assert.equal(
          events.filter((e) => e.type === "spawn").length,
          events.filter((e) => e.type === "exit").length,
        );
        assert.equal(
          events.some((e) => e.type === "retained"),
          false,
        );
        return {
          originalMetadataAndBytesUnchanged: true,
          fixedDirectExecutor: true,
          exactExitEvents: true,
        };
      }),
    );
    const base = join(home, "base"),
      sibling = join(home, "sibling");
    primary.run(["worktree", "add", "-b", "base", base]);
    primary.run(["worktree", "add", "-b", "sibling", sibling]);
    const baseRun = setupRunner(base, home);
    await fs.writeFile(join(base, "a.txt"), "base-tip\n");
    await fs.writeFile(join(base, "base-only.txt"), "base-only\n");
    baseRun(["add", "--", "a.txt", "base-only.txt"]);
    baseRun(["commit", "-m", "synthetic-base"]);
    const baseOid = baseRun(["rev-parse", "HEAD"]);
    await fs.writeFile(join(primary.path, "a.txt"), "current-head\n");
    primary.run(["add", "--", "a.txt"]);
    primary.run(["commit", "-m", "synthetic-diverged-head"]);
    await fs.writeFile(join(primary.path, "a.txt"), "index\n");
    primary.run(["add", "--", "a.txt"]);
    await fs.writeFile(join(primary.path, "a.txt"), "worktree\n");
    await fs.writeFile(join(primary.path, "base-only.txt"), "base-only\n");
    await fs.writeFile(join(sibling, "a.txt"), "sibling-worktree\n");
    await check("primary-and-two-linked-worktrees-direct-diverged-base", () =>
      withReader(home, w, async (r) => {
        const s = scope(),
          o = await available(r, w, s);
        assert.deepEqual(
          o.files.find((f) => f.path === "a.txt"),
          {
            path: "a.txt",
            index: "modified",
            worktree: "modified",
            kind: "tracked",
          },
        );
        const staged = await selected(r, w, o, "a.txt", "staged", s),
          unstaged = await selected(r, w, o, "a.txt", "unstaged", s),
          direct = await selected(r, w, o, "a.txt", "base", s, "base");
        assert.equal(staged.status, "available");
        assert.match(staged.patch, /-current-head\n\+index/);
        assert.equal(unstaged.status, "available");
        assert.match(unstaged.patch, /-index\n\+worktree/);
        assert.equal(direct.status, "available");
        assert.equal(direct.baseOid, baseOid);
        assert.match(direct.patch, /-base-tip\n\+worktree/);
        const equal = await selected(
          r,
          w,
          o,
          "base-only.txt",
          "base",
          s,
          "base",
        );
        assert.equal(equal.status, "available");
        assert.equal(equal.patch, "");
        assert.equal(
          (await selected(r, w, o, "base-only.txt", "staged", s)).reason,
          "not_staged",
        );
        for (const [id, path] of [
          ["base", base],
          ["sibling", sibling],
        ]) {
          const linked = await available(r, { id, path }, s);
          assert.equal(
            linked.repository.gitDirectory,
            join(primary.path, ".git/worktrees", id),
          );
          assert.equal(
            linked.repository.commonDirectory,
            join(primary.path, ".git"),
          );
          assert.equal(linked.repository.branch, id);
        }
        return {
          primaryPlusTwoLinked: true,
          separateXY: true,
          directTipNotMergeBase: true,
          untrackedBaseEqualEmpty: true,
        };
      }),
    );
    await fs.writeFile(
      join(primary.path, "base-only.txt"),
      "different-current\n",
    );
    await check("untracked-base-different", () =>
      withReader(home, w, async (r) => {
        const s = scope(),
          o = await available(r, w, s),
          d = await selected(r, w, o, "base-only.txt", "base", s, "base");
        assert.equal(d.status, "available");
        assert.match(d.patch, /-base-only\n\+different-current/);
        assert.equal(d.baseOid, baseOid);
        return { originalBaseBlobUsed: true };
      }),
    );
    const sha = await repo(home, "sha256", "sha256");
    await fs.writeFile(join(sha.path, "a.txt"), "sha256-worktree\n");
    await check("sha256-objects-index-refs", () =>
      withReader(home, sha.workspace, async (r) => {
        const s = scope(),
          o = await available(r, sha.workspace, s);
        assert.equal(o.repository.objectFormat, "sha256");
        assert.equal(o.repository.head.length, 64);
        const d = await selected(r, sha.workspace, o, "a.txt", "unstaged", s);
        assert.equal(d.status, "available");
        assert.match(d.patch, /-head\n\+sha256-worktree/);
        return { actualSha256: true };
      }),
    );
    const text = await repo(home, "text-attributes");
    await fs.writeFile(
      join(text.path, ".gitattributes"),
      "*.txt text eol=lf\n",
    );
    await fs.writeFile(join(text.path, ".gitignore"), "ignored.txt\r\n");
    text.run(["add", "--", ".gitattributes", ".gitignore"]);
    text.run(["commit", "-m", "synthetic-text-settings"]);
    await fs.writeFile(join(text.path, "a.txt"), "head\r\n");
    await fs.writeFile(join(text.path, "ignored.txt"), "ignored\n");
    await check("crlf-text-ignore-filemode", () =>
      withReader(home, text.workspace, async (r) => {
        const o = await available(r, text.workspace, scope());
        assert.equal(
          o.files.some((f) => ["a.txt", "ignored.txt"].includes(f.path)),
          false,
        );
        return { crlfNormalization: true, crlfIgnorePattern: true };
      }),
    );
    await fs.chmod(join(text.path, "a.txt"), 0o755);
    await check("filemode-change", () =>
      withReader(home, text.workspace, async (r) => {
        const o = await available(r, text.workspace, scope());
        assert.equal(
          o.files.find((f) => f.path === "a.txt").worktree,
          "modified",
        );
        return { executableModePreserved: true };
      }),
    );
    const norm = await repo(home, "native-normalization");
    await fs.writeFile(
      join(norm.path, ".gitattributes"),
      "*.txt text eol=lf ident\n",
    );
    norm.run(["add", "--", ".gitattributes"]);
    norm.run(["commit", "-m", "synthetic-attributes"]);
    const normBase = join(home, "normalization-base");
    norm.run(["worktree", "add", "-b", "normalization-base", normBase]);
    const normRun = setupRunner(normBase, home);
    await fs.writeFile(join(normBase, "base-only.txt"), "line\n$Id$\n");
    normRun(["add", "--", "base-only.txt"]);
    normRun(["commit", "-m", "synthetic-base-only-ident"]);
    await fs.writeFile(
      join(norm.path, "base-only.txt"),
      "line\r\n$Id: synthetic $\r\n",
    );
    await check("base-only-native-text-crlf-ident-equal", () =>
      withReader(home, norm.workspace, async (r) => {
        const s = scope(),
          o = await available(r, norm.workspace, s);
        const d = await selected(
          r,
          norm.workspace,
          o,
          "base-only.txt",
          "base",
          s,
          "normalization-base",
        );
        assert.equal(d.status, "available");
        assert.equal(d.patch, "");
        const u = await selected(
          r,
          norm.workspace,
          o,
          "base-only.txt",
          "unstaged",
          s,
        );
        assert.equal(u.status, "available");
        assert.match(u.patch, /\+line/);
        assert.equal(u.patch.includes("$Id: synthetic $"), false);
        return {
          realNativeNormalization: true,
          baseEqualEmpty: true,
          untrackedEmptyUsesNativeConversion: true,
        };
      }),
    );
    await fs.writeFile(
      join(norm.path, "base-only.txt"),
      "different\r\n$Id: synthetic $\r\n",
    );
    await check("base-only-native-text-crlf-ident-different", () =>
      withReader(home, norm.workspace, async (r) => {
        const s = scope(),
          o = await available(r, norm.workspace, s),
          d = await selected(
            r,
            norm.workspace,
            o,
            "base-only.txt",
            "base",
            s,
            "normalization-base",
          );
        assert.equal(d.status, "available");
        assert.match(d.patch, /-line\n\+different/);
        assert.equal(d.patch.includes("$Id: synthetic $"), false);
        return {
          originalAttributeIndexPreserved: true,
          realNativeNormalization: true,
        };
      }),
    );
    const special = await repo(home, "detail-refusals");
    await fs.writeFile(
      join(special.path, "binary.bin"),
      Buffer.from([0, 1, 255]),
    );
    await fs.writeFile(join(special.path, "large.txt"), "x".repeat(65537));
    await fs.writeFile(
      join(special.path, ".env"),
      "SYNTHETIC_PRIVATE_SOURCE\n",
    );
    await fs.writeFile(join(special.path, "-n.txt"), "literal-name\n");
    await check("binary-protected-oversize-literal-path", () =>
      withReader(home, special.workspace, async (r) => {
        const s = scope(),
          o = await available(r, special.workspace, s);
        for (const [path, reason] of [
          ["binary.bin", "binary"],
          ["large.txt", "too_large"],
          [".env", "protected_source"],
        ]) {
          const d = await selected(
            r,
            special.workspace,
            o,
            path,
            "unstaged",
            s,
          );
          assert.equal(d.reason, reason);
          assert.equal(Object.hasOwn(d, "patch"), false);
        }
        const literal = await selected(
          r,
          special.workspace,
          o,
          "-n.txt",
          "unstaged",
          s,
        );
        assert.equal(literal.status, "available");
        assert.match(literal.patch, /\+literal-name/);
        return { noUnavailablePatch: true, optionLookingNameLiteral: true };
      }),
    );
    const conflict = await repo(home, "conflict");
    const conflictOid = conflict.run(["rev-parse", "HEAD:a.txt"]);
    conflict.run(
      ["update-index", "--index-info"],
      `0 ${"0".repeat(40)}\ta.txt\n100644 ${conflictOid} 1\ta.txt\n100644 ${conflictOid} 2\ta.txt\n100644 ${conflictOid} 3\ta.txt\n`,
    );
    await check("actual-unmerged-index", () =>
      withReader(home, conflict.workspace, async (r) => {
        const s = scope(),
          o = await available(r, conflict.workspace, s);
        assert.equal(o.files.find((f) => f.path === "a.txt").kind, "conflict");
        assert.equal(
          (await selected(r, conflict.workspace, o, "a.txt", "unstaged", s))
            .reason,
          "conflict",
        );
        return { realThreeStageIndex: true, noResolvedPatch: true };
      }),
    );
    const rename = await repo(home, "rename-disabled");
    await fs.rename(
      join(rename.path, "a.txt"),
      join(rename.path, "renamed.txt"),
    );
    rename.run(["add", "-A", "--", "."]);
    await check("rename-is-separate-added-deleted", () =>
      withReader(home, rename.workspace, async (r) => {
        const o = await available(r, rename.workspace, scope());
        assert.equal(o.files.find((f) => f.path === "a.txt").index, "deleted");
        assert.equal(
          o.files.find((f) => f.path === "renamed.txt").index,
          "added",
        );
        return { separateAddedDeleted: true };
      }),
    );
    const detached = await repo(home, "detached");
    const detachedOid = detached.run(["rev-parse", "HEAD"]);
    await fs.writeFile(join(detached.path, ".git/HEAD"), detachedOid + "\n");
    await check("detached-head", () =>
      withReader(home, detached.workspace, async (r) => {
        const o = await available(r, detached.workspace, scope());
        assert.equal(o.repository.branch, null);
        assert.equal(o.repository.head, detachedOid);
        return { detachedExactOid: true };
      }),
    );
    const unbornPath = join(home, "unborn");
    await fs.mkdir(unbornPath);
    setupRunner(unbornPath, home)(["init", "-b", "main"]);
    await fs.writeFile(join(unbornPath, "new.txt"), "unborn\n");
    const unborn = { id: "unborn", path: unbornPath };
    await check("unborn-empty-index", () =>
      withReader(home, unborn, async (r) => {
        const s = scope(),
          o = await available(r, unborn, s);
        assert.equal(o.repository.head, null);
        const d = await selected(r, unborn, o, "new.txt", "unstaged", s);
        assert.equal(d.status, "available");
        assert.match(d.patch, /\+unborn/);
        return { unbornUntrackedEmptyComparison: true };
      }),
    );
    for (const kind of [
      "worktree-symlink",
      "worktree-hardlink",
      "metadata-symlink",
      "alternate",
      "nested-git",
      "nested-git-upper",
      "nested-git-mixed",
      "shallow",
      "split-index",
    ]) {
      const f = await repo(home, `reject-${kind}`);
      if (kind === "worktree-symlink")
        await fs.symlink(join(home, "not-followed"), join(f.path, "alias"));
      if (kind === "worktree-hardlink")
        await fs.link(join(f.path, "a.txt"), join(f.path, "hardlink"));
      if (kind === "metadata-symlink") {
        await fs.rename(join(f.path, ".git/HEAD"), join(home, "head-copy"));
        await fs.symlink(join(home, "head-copy"), join(f.path, ".git/HEAD"));
      }
      if (kind === "alternate")
        await fs.writeFile(
          join(f.path, ".git/objects/info/alternates"),
          "/synthetic/not-followed\n",
        );
      const nestedMarker = {
        "nested-git": ".git",
        "nested-git-upper": ".GIT",
        "nested-git-mixed": ".GiT",
      }[kind];
      const nestedCanary = `SYNTHETIC-NESTED-CONFIG-${kind}`;
      let nestedConfigWrites = 0;
      if (nestedMarker) {
        await fs.mkdir(join(f.path, "nested", nestedMarker), {
          recursive: true,
        });
        await fs.writeFile(
          join(f.path, "nested", nestedMarker, "config"),
          `[core]\nbare=false\n# ${nestedCanary}\n`,
        );
      }
      if (kind === "shallow")
        await fs.writeFile(
          join(f.path, ".git/shallow"),
          f.run(["rev-parse", "HEAD"]) + "\n",
        );
      if (kind === "split-index") f.run(["update-index", "--split-index"]);
      await check(`whole-observation-${kind}`, () =>
        withReader(
          home,
          f.workspace,
          async (r) => {
            const o = await r.review(f.workspace, scope());
            publicReview(o);
            assert.equal(o.status, "unavailable");
            assert.ok(
              ["unsupported_repository", "path_denied"].includes(o.reason),
            );
            assert.equal(Object.hasOwn(o, "files"), false);
            assert.equal(nestedConfigWrites, 0);
            return { wholeObservationRefused: true, nestedConfigWrites };
          },
          {
            io: {
              ...fs,
              async open(path, flags, mode) {
                const handle = await fs.open(path, flags, mode);
                if (flags === "wx") {
                  const write = handle.write.bind(handle);
                  handle.write = async (...args) => {
                    if (
                      Buffer.from(args[0]).includes(Buffer.from(nestedCanary))
                    )
                      nestedConfigWrites++;
                    return write(...args);
                  };
                }
                return handle;
              },
            },
          },
        ),
      );
    }
    for (const [name, limits, mutate] of [
      [
        "combined-bytes",
        { objectBytes: 2048 },
        async (f) =>
          fs.writeFile(join(f.path, "ignored.bin"), Buffer.alloc(4096)),
      ],
      ["combined-files", { objectFiles: 14 }, async () => {}],
      [
        "walk-includes-empty-directories",
        { candidates: 8 },
        async (f) => {
          for (let i = 0; i < 9; i++)
            await fs.mkdir(join(f.path, `empty-${i}`));
        },
      ],
      ["metadata-bytes", { metadataBytes: 16 }, async () => {}],
      ["aggregate-output", { stdoutBytes: 128 }, async () => {}],
    ]) {
      const f = await repo(home, `bound-${name}`);
      await mutate(f);
      await check(`limit-${name}`, () =>
        withReader(
          home,
          f.workspace,
          async (r) => {
            const o = await r.review(f.workspace, scope());
            assert.equal(o.reason, "too_large");
            assert.equal(Object.hasOwn(o, "files"), false);
            return { loweredSameProductionBound: limits, noPartialClean: true };
          },
          { limits },
        ),
      );
    }
    for (const kind of ["root", "index", "object", "current-file"]) {
      const f = await repo(home, `race-${kind}`),
        scratch = join(home, `race-scratch-${kind}`);
      await fs.mkdir(scratch);
      let injected = false;
      const candidates = (
        await fs.readdir(join(f.path, ".git/objects"))
      ).filter((n) => /^[a-f0-9]{2}$/.test(n));
      const fanout = candidates[0],
        objectPath = join(
          f.path,
          ".git/objects",
          fanout,
          (await fs.readdir(join(f.path, ".git/objects", fanout)))[0],
        );
      await check(
        `actual-source-substitution-${kind}`,
        async () => {
          const r = createWorkbenchGitReader({
            tempRoot: scratch,
            onEvent: (e) => {
              if (
                !injected &&
                e.type === "spawn" &&
                e.kind === "status" &&
                e.phase === "observe"
              ) {
                if (kind === "root") {
                  syncIO.renameSync(f.path, f.path + "-moved");
                  syncIO.mkdirSync(f.path);
                } else if (kind === "current-file")
                  syncIO.writeFileSync(join(f.path, "a.txt"), "race-changed\n");
                else {
                  const target =
                    kind === "index" ? join(f.path, ".git/index") : objectPath;
                  const bytes = syncIO.readFileSync(target);
                  syncIO.renameSync(
                    target,
                    join(home, `race-retained-${kind}`),
                  );
                  syncIO.writeFileSync(target, bytes);
                }
                injected = true;
              }
            },
          });
          try {
            const o = await r.review(f.workspace, scope());
            assert.equal(injected, true);
            assert.equal(o.status, "unavailable");
            assert.ok(["path_changed", "metadata_changed"].includes(o.reason));
            assert.equal(Object.hasOwn(o, "files"), false);
            return {
              actualFixtureMutationInjected: true,
              staleResultDiscarded: true,
              productionOriginalWriteClaim: false,
            };
          } finally {
            await r.close();
          }
        },
        "ACTUAL production reader; harness deliberately replaces owned synthetic source during child execution",
      );
    }
    for (const kind of [
      "fsmonitor",
      "hooks",
      "filter",
      "process",
      "textconv",
      "extdiff",
      "include",
      "attributes",
    ]) {
      const f = await repo(home, `canary-${kind}`),
        marker = join(home, `marker-${kind}`),
        helper = join(home, `helper-${kind}`);
      await fs.writeFile(
        helper,
        `#!/bin/sh\nprintf triggered > '${marker}'\ncat\n`,
        { mode: 0o700 },
      );
      if (kind === "fsmonitor") f.run(["config", "core.fsmonitor", helper]);
      if (kind === "hooks") {
        const hooks = join(home, "hooks");
        await fs.mkdir(hooks, { recursive: true });
        await fs.copyFile(helper, join(hooks, "post-index-change"));
        await fs.chmod(join(hooks, "post-index-change"), 0o700);
        f.run(["config", "core.hooksPath", hooks]);
      }
      if (["filter", "process"].includes(kind)) {
        f.run([
          "config",
          `filter.evil.${kind === "process" ? "process" : "clean"}`,
          helper,
        ]);
        await fs.writeFile(
          join(f.path, ".gitattributes"),
          "*.txt filter=evil\n",
        );
      }
      if (["textconv", "extdiff"].includes(kind)) {
        f.run([
          "config",
          kind === "textconv" ? "diff.evil.textconv" : "diff.external",
          helper,
        ]);
        if (kind === "textconv")
          await fs.writeFile(
            join(f.path, ".gitattributes"),
            "*.txt diff=evil\n",
          );
      }
      if (kind === "include") f.run(["config", "include.path", helper]);
      if (kind === "attributes")
        await fs.writeFile(
          join(f.path, ".gitattributes"),
          "*.txt working-tree-encoding=UTF-16\n",
        );
      await fs.writeFile(join(f.path, "a.txt"), "changed\n");
      await check(`no-helper-${kind}`, () =>
        withReader(home, f.workspace, async (r) => {
          const s = scope(),
            o = await r.review(f.workspace, s);
          publicReview(o);
          if (["fsmonitor", "hooks", "extdiff"].includes(kind)) {
            assert.equal(o.status, "available");
            const d = await selected(r, f.workspace, o, "a.txt", "unstaged", s);
            assert.equal(d.status, "available");
          } else {
            assert.equal(o.reason, "unsupported_configuration");
          }
          await assert.rejects(fs.stat(marker), { code: "ENOENT" });
          return {
            attemptedProductionPath: true,
            markerAbsent: true,
            originalUnchanged: true,
          };
        }),
      );
    }
    for (const mode of [
      "normal",
      "parsefailure",
      "timeout",
      "cancel",
      "injected-unproved",
      "controlled-host-crash",
    ]) {
      const f = await repo(home, `alias-${mode}`),
        token = randomBytes(24).toString("hex"),
        header = randomBytes(24).toString("hex");
      await fs.rename(join(f.path, ".git"), join(f.path, ".meta"));
      await fs.writeFile(join(f.path, ".git"), "gitdir: .meta\n");
      await fs.appendFile(
        join(f.path, ".meta/config"),
        `[remote "origin"]\nurl=https://synthetic:${token}@example.invalid/x\n[http]\nextraHeader=Authorization: Bearer ${header}\n${mode === "parsefailure" ? "[invalid\n" : ""}`,
      );
      const scratch = join(home, `alias-scratch-${mode}`);
      await fs.mkdir(scratch, { mode: 0o700 });
      try {
        await check(
          `metadata-overlap-credential-${mode}`,
          async () => {
            if (mode === "controlled-host-crash") {
              const p = spawn(
                process.execPath,
                [
                  fileURLToPath(import.meta.url),
                  "--crash-child",
                  f.path,
                  scratch,
                  "capability",
                ],
                { cwd: home, env: envFor(home), stdio: "ignore" },
              );
              const code = await new Promise((done, reject) => {
                p.once("error", reject);
                p.once("close", done);
              });
              assert.equal(code, 88);
              return {
                actualHostExit: 88,
                metadataGuardReached: true,
                crashTriggerNotReached: true,
                noGitChildStarted: true,
                scan: await scanCanaries(scratch, [token, header]),
              };
            }
            const controller = new AbortController(),
              events = [],
              facts = { checkedWrites: 0 };
            let intercepted = false,
              actualClosed = false,
              rawConfigStdin = false;
            const adapter = (exe, argv, options) => {
              const p = spawn(exe, argv, options);
              if (argv[0] !== "config") return p;
              const end = p.stdin.end.bind(p.stdin);
              p.stdin.end = (bytes, ...rest) => {
                if (bytes && Buffer.from(bytes).includes(Buffer.from(token)))
                  rawConfigStdin = true;
                return end(bytes, ...rest);
              };
              if (
                !intercepted &&
                ["timeout", "cancel", "injected-unproved"].includes(mode)
              ) {
                intercepted = true;
                if (mode === "injected-unproved") {
                  p.once("close", () => {
                    actualClosed = true;
                  });
                  const once = p.once.bind(p);
                  p.once = (type, callback) =>
                    type === "close" ? p : once(type, callback);
                } else {
                  p.kill("SIGSTOP");
                  if (mode === "cancel")
                    setTimeout(() => controller.abort(), 20);
                }
              }
              return p;
            };
            const before = await inventory(f.path),
              r = createWorkbenchGitReader({
                tempRoot: scratch,
                spawn: adapter,
                io: auditedIO(scratch, [token, header], facts),
                onEvent: (e) => events.push(e),
              });
            try {
              let value;
              try {
                value = await r.review(f.workspace, {
                  ...scope(),
                  signal: controller.signal,
                });
              } catch (e) {
                assert.ok(["READ_TIMEOUT", "STALE_EPOCH"].includes(e.appCode));
                value = { error: e.appCode };
              }
              assert.deepEqual(await inventory(f.path), before);
              assert.equal(rawConfigStdin, false);
              assert.equal(value.reason, "unsupported_repository");
              assert.equal(intercepted, false);
              assert.equal(events.length, 0);
              return {
                metadataGuardReached: true,
                wholeOverlapRefusal: true,
                lifecycleInjectionNotReached: true,
                noGitChildStarted: true,
                rawOriginalConfigNeverEnteredStdin: true,
                originalUnchanged: true,
                writeAudit: facts,
                scan: await scanCanaries(scratch, [token, header]),
                actualExitBehindInjectedUnproved: actualClosed,
              };
            } finally {
              await r.close();
            }
          },
          "ACTUAL .git -> .meta credential fixture refused before namespace/spawn; armed lifecycle injections never reached. Ordinary credential cases separately test runtime phases.",
        );
      } finally {
        await fs.rm(f.path, { recursive: true, force: true });
      }
    }
    // Credential lifecycle and controlled host crash are separate from ordinary
    // helper tests. Original synthetic inputs are removed after preservation
    // assertions; raw config never belongs to scratch or retained reports.
    for (const kind of [
      "normal",
      "parsefailure",
      "timeout",
      "cancel",
      "injected-unproved",
      "controlled-host-crash",
    ]) {
      const f = await repo(home, `credential-${kind}`),
        token = randomBytes(24).toString("hex"),
        header = randomBytes(24).toString("hex");
      await fs.appendFile(
        join(f.path, ".git/config"),
        `[remote "origin"]\nurl = https://synthetic:${token}@example.invalid/repo\n[http]\nextraHeader = Authorization: Bearer ${header}\n${kind === "parsefailure" ? "[invalid\n" : ""}`,
      );
      const scratch = join(home, `credential-scratch-${kind}`);
      await fs.mkdir(scratch, { mode: 0o700 });
      try {
        await check(
          `credential-${kind}`,
          async () => {
            if (kind === "controlled-host-crash") {
              const child = spawn(
                process.execPath,
                [
                  fileURLToPath(import.meta.url),
                  "--crash-child",
                  f.path,
                  scratch,
                ],
                { cwd: home, env: envFor(home), stdio: "ignore" },
              );
              const code = await new Promise((resolveExit, reject) => {
                child.once("error", reject);
                child.once("close", resolveExit);
              });
              assert.equal(code, 86);
              const scan = await scanCanaries(scratch, [token, header]);
              return {
                actualHostExit: 86,
                ownedGitSettlementProven: false,
                scratchRetained: true,
                scan,
              };
            }
            const events = [],
              controller = new AbortController();
            let intercepted = false,
              actualClosed = false;
            const adapter = (exe, argv, options) => {
              const child = spawn(exe, argv, options);
              if (
                ["timeout", "cancel", "injected-unproved"].includes(kind) &&
                argv[0] === "config"
              ) {
                let suppress = false;
                const callbacks = [];
                const originalOnce = child.once.bind(child);
                if (kind === "injected-unproved") {
                  child.on("close", (code, signal) => {
                    actualClosed = true;
                    if (!suppress)
                      for (const callback of callbacks) callback(code, signal);
                  });
                  child.once = (type, callback) => {
                    if (type === "close") {
                      callbacks.push(callback);
                      return child;
                    }
                    return originalOnce(type, callback);
                  };
                }
                const end = child.stdin.end.bind(child.stdin);
                child.stdin.end = (bytes, ...rest) => {
                  if (
                    !intercepted &&
                    bytes &&
                    Buffer.from(bytes).includes(Buffer.from(token))
                  ) {
                    intercepted = true;
                    suppress = kind === "injected-unproved";
                    if (!suppress) {
                      child.kill("SIGSTOP");
                      if (kind === "cancel")
                        setTimeout(() => controller.abort(), 20);
                    }
                  }
                  return end(bytes, ...rest);
                };
              }
              return child;
            };
            const writeFacts = { checkedWrites: 0 };
            const before = await inventory(f.path);
            const r = createWorkbenchGitReader({
              tempRoot: scratch,
              spawn: adapter,
              io: auditedIO(scratch, [token, header], writeFacts),
              onEvent: (e) => events.push(e),
            });
            try {
              let result;
              try {
                result = await r.review(f.workspace, {
                  ...scope(),
                  signal: controller.signal,
                });
              } catch (e) {
                assert.ok(["READ_TIMEOUT", "STALE_EPOCH"].includes(e.appCode));
                result = { error: e.appCode };
              }
              assert.deepEqual(await inventory(f.path), before);
              assert.equal(
                JSON.stringify(result).includes(token) ||
                  JSON.stringify(events).includes(token) ||
                  JSON.stringify(result).includes(header) ||
                  JSON.stringify(events).includes(header),
                false,
              );
              if (kind === "normal") assert.equal(result.status, "available");
              if (kind === "parsefailure")
                assert.equal(result.reason, "unsupported_configuration");
              if (kind === "injected-unproved") {
                assert.equal(result.reason, "process_unverified");
                assert.equal(actualClosed, true);
                assert.ok(events.some((e) => e.type === "retained"));
              } else {
                assert.equal(
                  events.filter((e) => e.type === "spawn").length,
                  events.filter((e) => e.type === "exit").length,
                );
              }
              const scan = await scanCanaries(scratch, [token, header]);
              return {
                originalPreserved: true,
                scan,
                writeAudit: writeFacts,
                rawConfigChildActuallyIntercepted: intercepted,
                injectedUnproved: kind === "injected-unproved",
                actualExitObservedBehindInjection: actualClosed,
                actualStoppedGit: ["timeout", "cancel"].includes(kind),
                exactExitCount: events.filter((e) => e.type === "exit").length,
              };
            } finally {
              await r.close();
            }
          },
          kind === "injected-unproved"
            ? "INJECTED missing close event; real child separately observed exited"
            : kind === "controlled-host-crash"
              ? "ACTUAL controlled synthetic Node host process exit; orphan Git settlement unclaimed"
              : "ACTUAL fixed Git process; timeout/cancel use explicit synthetic SIGSTOP scheduling injection",
        );
      } finally {
        await fs.rm(f.path, { recursive: true, force: true });
      }
    }
    report.productionReaderSyntheticMatrixPassed = true;
    report.status = "pass";
  } catch (e) {
    report.status = "fail";
    report.failure = {
      reason:
        e.probeReason ??
        (e.appCode
          ? "transport_error"
          : e.code === "ERR_ASSERTION"
            ? "assertion_failed"
            : "probe_failed"),
      ...(e.appCode ? { appCode: e.appCode } : {}),
    };
    process.exitCode = 1;
  } finally {
    report.sourceHashesAfter = {};
    for (const p of sources)
      report.sourceHashesAfter[p] = digest(
        await fs.readFile(new URL(p, import.meta.url)),
      );
    try {
      report.executableAfter = await executableCheckpoint(home);
      assert.deepEqual(
        report.sourceHashesAfter,
        report.sourceHashes,
        "source_drift",
      );
      assert.deepEqual(
        report.executableAfter,
        report.executableBefore,
        "executable_drift",
      );
      report.sourceAndExecutableStable = true;
    } catch {
      report.sourceAndExecutableStable = false;
      report.status = "fail";
      report.productionReaderSyntheticMatrixPassed = false;
      report.failure = { reason: "source_or_executable_drift" };
      process.exitCode = 1;
    }
    await save();
  }
  console.log(
    JSON.stringify({
      status: report.status,
      productionReaderSyntheticMatrixPassed:
        report.productionReaderSyntheticMatrixPassed,
      report: join(out, "report.json"),
      retainedSyntheticEvidence: home,
    }),
  );
}

if (
  process.argv[2] === "--crash-child" &&
  [5, 6].includes(process.argv.length)
) {
  const root = process.argv[3],
    tempRoot = process.argv[4];
  const phase = process.argv[5] ?? "observe";
  assert.ok(["observe", "capability"].includes(phase));
  const reader = createWorkbenchGitReader({
    tempRoot,
    onEvent: (e) => {
      if (e.type === "spawn" && e.kind === "config" && e.phase === phase)
        process.exit(86);
    },
  });
  const result = await reader.review(
    { id: "controlled-crash", path: root },
    scope(),
  );
  process.exit(result.reason === "unsupported_repository" ? 88 : 87);
} else {
  assert.equal(
    process.argv.length,
    4,
    "usage: git-review-probe.mjs --out <fresh synthetic output directory>",
  );
  assert.equal(process.argv[2], "--out");
  await runProbe(resolve(process.argv[3]));
}
