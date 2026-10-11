import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  validateGitIndexKernelRequest,
  validateGitIndexArtifactManifest,
  gitIndexBackupId,
} from "./git-index-contract.mjs";
const hex = "a".repeat(64);
export const target = {
  action: "stage",
  paths: ["a.txt"],
  previewDigest: hex,
  headOid: null,
  indexExists: true,
  indexDigest: hex,
  nextIndexDigest: hex,
  objectFormat: "sha1",
};
const signature = "1:2:33188:1:12:13:14";
const dir = (path) => ({ path, dev: "1", ino: "2" });
const ref = (path) => ({ path, bytes: 12, digest: hex });
const artifact = {
  root: "/SYNTHETIC/artifact",
  dev: "1",
  ino: "3",
  manifest: ref("manifest.json"),
};
const request = () => ({
  runtimeEpoch: "epoch",
  operationId: "operation",
  workspaceId: "workspace",
  workspacePath: "/SYNTHETIC/work",
  digest: hex,
  target: globalThis.structuredClone(target),
  artifact: globalThis.structuredClone(artifact),
});
const manifest = () => ({
  schemaVersion: 1,
  feature: "git_index_mutation_v1",
  runtimeEpoch: "epoch",
  operationId: "operation",
  workspaceId: "workspace",
  workspacePath: "/SYNTHETIC/work",
  digest: hex,
  target: globalThis.structuredClone(target),
  layout: {
    root: dir("/SYNTHETIC/work"),
    gitDirectory: dir("/SYNTHETIC/work/.git"),
    commonDirectory: dir("/SYNTHETIC/work/.git"),
  },
  source: {
    directories: [dir("/SYNTHETIC/work")],
    files: [{ path: "/SYNTHETIC/work/a.txt", signature, digest: hex }],
    listings: [{ path: "/SYNTHETIC/work", names: [".git", "a.txt"] }],
    missing: ["/SYNTHETIC/work/.git/index.lock"],
  },
  proposal: ref("proposal.index"),
  objects: [
    {
      oid: "b".repeat(40),
      rawBytes: 8,
      ...ref("objects/bb/" + "b".repeat(38)),
    },
  ],
});
const invalid = (fn) => assert.throws(fn, { appCode: "INVALID_REQUEST" });
test("private index artifact closes wire authority without inline source", () => {
  const r = request();
  assert.equal(validateGitIndexKernelRequest(r), r);
  for (const extra of [
    { text: "bytes" },
    { token: "invented" },
    { sessionId: "session" },
  ])
    invalid(() => validateGitIndexKernelRequest({ ...r, ...extra }));
  invalid(() =>
    validateGitIndexKernelRequest({
      ...r,
      artifact: {
        ...r.artifact,
        manifest: { ...r.artifact.manifest, path: "../escape" },
      },
    }),
  );
  invalid(() =>
    validateGitIndexKernelRequest({
      ...r,
      artifact: { ...r.artifact, root: "/SYNTHETIC/work/.git/tmp" },
    }),
  );
  invalid(() =>
    validateGitIndexKernelRequest({
      ...r,
      artifact: {
        ...r.artifact,
        manifest: { ...r.artifact.manifest, bytes: 16777217 },
      },
    }),
  );
  let reads = 0;
  const getter = { ...r };
  Object.defineProperty(getter, "artifact", {
    get() {
      reads++;
      return r.artifact;
    },
    enumerable: true,
  });
  invalid(() => validateGitIndexKernelRequest(getter));
  assert.equal(reads, 0);
});
test("private index manifest binds original key complete proposal and source metadata", () => {
  const r = request(),
    m = manifest();
  assert.equal(validateGitIndexArtifactManifest(m, r), m);
  for (const change of [
    { operationId: "other" },
    { digest: "b".repeat(64) },
    { target: { ...m.target, nextIndexDigest: "b".repeat(64) } },
    { proposal: { ...m.proposal, digest: "b".repeat(64) } },
  ])
    invalid(() => validateGitIndexArtifactManifest({ ...m, ...change }, r));
  invalid(() =>
    validateGitIndexArtifactManifest(
      {
        ...m,
        source: { ...m.source, files: [...m.source.files, ...m.source.files] },
      },
      r,
    ),
  );
  invalid(() =>
    validateGitIndexArtifactManifest(
      {
        ...m,
        source: {
          ...m.source,
          listings: [{ path: "/SYNTHETIC/work", names: ["a.txt", ".git"] }],
        },
      },
      r,
    ),
  );
  invalid(() =>
    validateGitIndexArtifactManifest(
      { ...m, objects: [{ ...m.objects[0], oid: "b".repeat(64) }] },
      r,
    ),
  );
  invalid(() =>
    validateGitIndexArtifactManifest(
      { ...m, proposal: { ...m.proposal, path: m.objects[0].path } },
      r,
    ),
  );
  invalid(() =>
    validateGitIndexArtifactManifest(
      { ...m, source: { ...m.source, missing: [artifact.root] } },
      r,
    ),
  );
});
test("private index backup is deterministic original key and absent index has no backup", () => {
  const expected = `.omoc-git-index-${createHash("sha256")
    .update(JSON.stringify(["epoch", "operation"]))
    .digest("hex")}.backup`;
  assert.equal(gitIndexBackupId("epoch", "operation"), expected);
  assert.notEqual(gitIndexBackupId("new-epoch", "operation"), expected);
  invalid(() => gitIndexBackupId("epoch", "../operation"));
});
