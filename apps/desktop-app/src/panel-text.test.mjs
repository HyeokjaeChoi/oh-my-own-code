import test from "node:test";
import assert from "node:assert/strict";
import {
  parsePatch,
  relativeTime,
  splitMiddle,
} from "./renderer/shared/panel-text/index.mjs";

const patch = [
  "diff --git a/a.txt b/a.txt",
  "index 1..2 100644",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -3,3 +3,3 @@ ctx",
  " keep",
  "-old",
  "+new",
  " tail",
  "\\ No newline at end of file",
  "",
].join("\n");

test("parsePatch numbers lines and counts changes", () => {
  const { rows, added, removed } = parsePatch(patch);
  assert.equal(added, 1);
  assert.equal(removed, 1);
  assert.deepEqual(
    rows.map((r) => r.kind),
    [
      "meta",
      "meta",
      "meta",
      "meta",
      "hunk",
      "ctx",
      "del",
      "add",
      "ctx",
      "meta",
    ],
  );
  assert.deepEqual(
    rows
      .filter((r) => r.kind !== "meta" && r.kind !== "hunk")
      .map((r) => [r.oldNo, r.newNo]),
    [
      [3, 3],
      [4, undefined],
      [undefined, 4],
      [5, 5],
    ],
  );
});

test("header lines that look like changes stay meta before the first hunk", () => {
  const { added, removed } = parsePatch("--- a\n+++ b\n@@ -1 +1 @@\n-x\n+y\n");
  assert.equal(added, 1);
  assert.equal(removed, 1);
});

test("relativeTime buckets", () => {
  const now = 1_000_000_000;
  assert.equal(relativeTime(now - 5_000, now), "방금 전");
  assert.equal(relativeTime(now - 5 * 60_000, now), "5분 전");
  assert.equal(relativeTime(now - 3 * 3_600_000, now), "3시간 전");
  assert.equal(relativeTime(now - 2 * 86_400_000, now), "2일 전");
});

test("splitMiddle keeps the file name", () => {
  assert.deepEqual(splitMiddle("a/b/c.ts"), ["a/b/", "c.ts"]);
  assert.deepEqual(splitMiddle("name.ts"), ["", "name.ts"]);
  const [head, tail] = splitMiddle("d/" + "x".repeat(40) + ".ts");
  assert.equal(tail.length, 28);
  assert.equal(head + tail, "d/" + "x".repeat(40) + ".ts");
});
