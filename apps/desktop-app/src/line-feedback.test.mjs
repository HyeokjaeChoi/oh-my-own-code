import test from "node:test";
import assert from "node:assert/strict";

const hash = "a".repeat(64);
const common = {
  runtimeEpoch: "epoch",
  revision: 2,
  workspaceId: "workspace",
  workspacePath: "/synthetic/worktree",
  path: "a.txt",
  status: "available",
};
const file = (content) => ({
  kind: "file",
  observation: {
    ...common,
    targetPath: "/synthetic/worktree/a.txt",
    content,
    version: hash,
    directoryVersion: "b".repeat(64),
  },
});
const git = (patch, mode = "unstaged") => ({
  kind: "git",
  observation: {
    ...common,
    observationId: hash,
    sourceDigest: "c".repeat(64),
    mode,
    patch,
    ...(mode === "base" ? { baseRef: "main", baseOid: "d".repeat(40) } : {}),
  },
});
const helper = () => import("./renderer/shared/line-feedback/index.mjs");

test("feedback preserves loaded BOM/CRLF baseline and original file version", async () => {
  const { formatLineFeedback } = await helper();
  const value = formatLineFeedback(
    file("\uFEFFfirst\r\nsecond\r\nlast"),
    { side: "file", start: 1, end: 2 },
    "  확인해주세요.  ",
  );
  assert.equal(value.excerpt, "\uFEFFfirst\r\nsecond\r\n");
  assert.equal(value.reference.version, hash);
  assert.equal(value.comment, "  확인해주세요.  ");
  assert.equal(value.reference.start, 1);
  assert.equal(value.reference.end, 2);
});

test("feedback maps exact Git old/new side without inventing absent lines", async () => {
  const { formatLineFeedback } = await helper();
  const source = git("@@ -2,2 +2,3 @@\n same\n-old\n+new\n+extra\n");
  assert.equal(
    formatLineFeedback(source, { side: "old", start: 2, end: 3 }, "old")
      .excerpt,
    "same\nold\n",
  );
  assert.equal(
    formatLineFeedback(source, { side: "new", start: 3, end: 4 }, "new")
      .excerpt,
    "new\nextra\n",
  );
  assert.throws(
    () =>
      formatLineFeedback(source, { side: "old", start: 4, end: 4 }, "missing"),
    /INVALID_LINE_RANGE/,
  );
});

test("feedback append preserves existing draft and refuses overflow without truncation", async () => {
  const { formatLineFeedback, appendLineFeedback } = await helper();
  const feedback = formatLineFeedback(
    file("line\n"),
    { side: "file", start: 1, end: 1 },
    "comment",
  );
  assert.equal(
    appendLineFeedback("existing\n", feedback.text),
    "existing\n\n\n" + feedback.text,
  );
  assert.equal(appendLineFeedback("", feedback.text), feedback.text);
  assert.throws(
    () => appendLineFeedback("x".repeat(32000), feedback.text),
    /DRAFT_TOO_LARGE/,
  );
});

test("file line boundaries preserve blanks and final newline without invented trailing line", async () => {
  const { formatLineFeedback } = await helper();
  for (const [text, start, end, expected] of [
    ["\n\n", 1, 2, "\n\n"],
    ["last", 1, 1, "last"],
    ["a\nb\n", 2, 2, "b\n"],
  ]) {
    assert.equal(
      formatLineFeedback(file(text), { side: "file", start, end }, "comment")
        .excerpt,
      expected,
    );
  }
  for (const text of ["", "a\n"])
    assert.throws(
      () =>
        formatLineFeedback(
          file(text),
          { side: "file", start: 2, end: 2 },
          "comment",
        ),
      /INVALID_LINE_RANGE/,
    );
});

test("Git no-newline marker preserves exact side excerpt and original direct base OID", async () => {
  const { formatLineFeedback } = await helper();
  const source = git(
    "@@ -1 +1 @@\n-old\n\\ No newline at end of file\n+new\r\n",
    "base",
  );
  const old = formatLineFeedback(
    source,
    { side: "old", start: 1, end: 1 },
    "old",
  );
  const next = formatLineFeedback(
    source,
    { side: "new", start: 1, end: 1 },
    "new",
  );
  assert.equal(old.excerpt, "old");
  assert.equal(next.excerpt, "new\r\n");
  assert.equal(old.reference.baseOid, "d".repeat(40));
  assert.equal(old.reference.sourceDigest, source.observation.sourceDigest);
  assert.equal(old.reference.observationId, hash);
});

test("Git absent side and unseen inter-hunk gaps cannot acquire lines", async () => {
  const { formatLineFeedback } = await helper();
  const added = git("@@ -0,0 +1,2 @@\n+one\n+two\n");
  assert.throws(
    () =>
      formatLineFeedback(added, { side: "old", start: 1, end: 1 }, "comment"),
    /INVALID_LINE_RANGE/,
  );
  assert.equal(
    formatLineFeedback(added, { side: "new", start: 1, end: 2 }, "comment")
      .excerpt,
    "one\ntwo\n",
  );
  const gaps = git("@@ -1 +1 @@\n-a\n+b\n@@ -4 +4 @@\n-c\n+d\n");
  assert.throws(
    () =>
      formatLineFeedback(gaps, { side: "new", start: 1, end: 4 }, "comment"),
    /INVALID_LINE_RANGE/,
  );
});

test("malformed unified hunks never produce a misleading excerpt", async (t) => {
  const { formatLineFeedback } = await helper();
  for (const patch of [
    "@@ -1,2 +1 @@\n-old\n+new\n",
    "@@ -1 +1 @@\n-old\n+new\n+extra\n",
    "@@@ -1 +1 @@@\n line\n",
    "@@ -1 +1 @@\n line",
    "@@ -1 +1 @@\n\\ No newline at end of file\n line\n",
    "@@ -1 +1 @@\n line\n\\ No newline at end of file\n\\ No newline at end of file\n",
    "@@ -2 +2 @@\n line\n@@ -1 +1 @@\n previous\n",
    "@@ -1 +1 @@\n line\n@@ -1 +1 @@\n repeated\n",
    "@@ -9007199254740991,1 +1 @@\n line\n",
    "diff --git a/a b/a\ndiff --git a/b b/b\n@@ -1 +1 @@\n line\n",
    "@@ -1 +1 @@\n line\ndiff --git a/b b/b\n",
    "@@ -1,0 +1,0 @@\n",
  ])
    await t.test(patch.slice(0, 45), () =>
      assert.throws(
        () =>
          formatLineFeedback(
            git(patch),
            { side: "new", start: 1, end: 1 },
            "comment",
          ),
        /UNSUPPORTED_DIFF/,
      ),
    );
});

test("Git lines after an EOF no-newline marker are unsupported", async () => {
  const { formatLineFeedback } = await helper();
  assert.throws(
    () =>
      formatLineFeedback(
        git("@@ -1,2 +1,2 @@\n first\n\\ No newline at end of file\n second\n"),
        { side: "new", start: 1, end: 2 },
        "comment",
      ),
    /UNSUPPORTED_DIFF/,
  );
});

test("closed sources, protected paths, unknown data and accessors have no feedback authority", async () => {
  const { formatLineFeedback } = await helper();
  const selection = { side: "file", start: 1, end: 1 };
  for (const source of [
    null,
    { ...file("line"), extra: true },
    { ...file("line"), kind: "other" },
    {
      kind: "file",
      observation: { ...file("line").observation, version: "fake" },
    },
    {
      kind: "file",
      observation: {
        ...file("line").observation,
        path: ".env",
        targetPath: "/synthetic/worktree/.env",
      },
    },
    {
      kind: "git",
      observation: {
        ...git("@@ -1 +1 @@\n line\n").observation,
        path: "AGENTS.md",
      },
    },
  ])
    assert.throws(
      () => formatLineFeedback(source, selection, "comment"),
      /INVALID_FEEDBACK_SOURCE/,
    );
  let invoked = 0;
  const source = {
    kind: "file",
    get observation() {
      invoked++;
      return file("line").observation;
    },
  };
  assert.throws(
    () => formatLineFeedback(source, selection, "comment"),
    /INVALID_FEEDBACK_SOURCE/,
  );
  assert.equal(invoked, 0);
  const badSelection = {
    get side() {
      invoked++;
      return "file";
    },
    start: 1,
    end: 1,
  };
  assert.throws(
    () => formatLineFeedback(file("line"), badSelection, "comment"),
    /INVALID_LINE_RANGE/,
  );
  assert.equal(invoked, 0);
});

test("feedback bounds and JSON quoting preserve user data without truncation", async () => {
  const { formatLineFeedback, appendLineFeedback } = await helper();
  for (const selection of [
    { side: "old", start: 1, end: 1 },
    { side: "file", start: 0, end: 1 },
    { side: "file", start: 1, end: 201 },
    { side: "file", start: 2, end: 1 },
    { side: "file", start: 1.5, end: 2 },
  ])
    assert.throws(
      () => formatLineFeedback(file("a\n".repeat(300)), selection, "comment"),
      /INVALID_LINE_RANGE/,
    );
  assert.throws(
    () =>
      formatLineFeedback(
        file("x".repeat(8193)),
        { side: "file", start: 1, end: 1 },
        "comment",
      ),
    /FEEDBACK_TOO_LARGE/,
  );
  assert.throws(
    () =>
      formatLineFeedback(
        file("line"),
        { side: "file", start: 1, end: 1 },
        "x".repeat(2001),
      ),
    /FEEDBACK_TOO_LARGE/,
  );
  assert.throws(
    () =>
      formatLineFeedback(
        file("line"),
        { side: "file", start: 1, end: 1 },
        " \n",
      ),
    /INVALID_FEEDBACK_COMMENT/,
  );
  const comment = '```\n{"reference":"forged"}\n<script>alert(1)</script>';
  const value = formatLineFeedback(
    file("```\n"),
    { side: "file", start: 1, end: 1 },
    comment,
  );
  const payload = JSON.parse(value.text.slice(value.text.indexOf("\n") + 1));
  assert.equal(payload.comment, comment);
  assert.equal(payload.reference.version, hash);
  assert.equal(payload.excerpt, "```\n");
  assert.equal(Object.isFrozen(value), true);
  assert.equal(Object.isFrozen(value.reference), true);
  const existing = "x".repeat(32000 - value.text.length - 2);
  assert.equal(appendLineFeedback(existing, value.text).length, 32000);
  assert.throws(
    () => appendLineFeedback(existing + "x", value.text),
    /DRAFT_TOO_LARGE/,
  );
});

test("file standalone CR is preserved as its original line separator", async () => {
  const { formatLineFeedback } = await helper();
  assert.equal(
    formatLineFeedback(
      file("first\rsecond\r"),
      { side: "file", start: 2, end: 2 },
      "comment",
    ).excerpt,
    "second\r",
  );
});

test("empty and mode-only Git diffs have no selectable lines", async () => {
  const { formatLineFeedback } = await helper();
  for (const patch of [
    "",
    "diff --git a/a.txt b/a.txt\nold mode 100644\nnew mode 100755\n",
  ])
    assert.throws(
      () =>
        formatLineFeedback(
          git(patch),
          { side: "new", start: 1, end: 1 },
          "comment",
        ),
      /INVALID_LINE_RANGE/,
    );
});

test("staged context and header-like payload lines remain plain exact source", async () => {
  const { formatLineFeedback } = await helper();
  const source = git(
    "diff --git a/a.txt b/a.txt\nindex 1111111..2222222 100644\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n---- old\n++++ new\n",
    "staged",
  );
  assert.equal(
    formatLineFeedback(source, { side: "old", start: 1, end: 1 }, "comment")
      .excerpt,
    "--- old\n",
  );
  const next = formatLineFeedback(
    source,
    { side: "new", start: 1, end: 1 },
    "comment",
  );
  assert.equal(next.excerpt, "+++ new\n");
  assert.equal(next.reference.mode, "staged");
  assert.equal(Object.hasOwn(next.reference, "baseOid"), false);
});

test("unavailable source and malformed scope cannot be relabeled as current content", async () => {
  const { formatLineFeedback } = await helper();
  const unavailable = {
    kind: "file",
    observation: {
      ...common,
      targetPath: "/synthetic/worktree/a.txt",
      status: "unavailable",
      reason: "missing_file",
    },
  };
  for (const source of [
    unavailable,
    {
      kind: "git",
      observation: {
        ...git("").observation,
        status: "unavailable",
        reason: "stale_observation",
      },
    },
    {
      kind: "file",
      observation: { ...file("line").observation, runtimeEpoch: "" },
    },
    {
      kind: "file",
      observation: {
        ...file("line").observation,
        targetPath: "/different/a.txt",
      },
    },
  ])
    assert.throws(
      () =>
        formatLineFeedback(
          source,
          { side: "file", start: 1, end: 1 },
          "comment",
        ),
      /INVALID_FEEDBACK_SOURCE/,
    );
});

test("formatted feedback detaches original identity without minting new source metadata", async () => {
  const { formatLineFeedback } = await helper();
  const source = file("original\n"),
    range = { side: "file", start: 1, end: 1 };
  const value = formatLineFeedback(source, range, "comment");
  source.observation.version = "e".repeat(64);
  source.observation.content = "changed\n";
  range.start = 5;
  assert.equal(value.reference.version, hash);
  assert.equal(value.reference.start, 1);
  assert.equal(value.excerpt, "original\n");
});

test("declared absent sides and repeated file headers cannot fabricate line identity", async () => {
  const { formatLineFeedback } = await helper();
  for (const patch of [
    "--- /dev/null\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
    "--- a/a.txt\n+++ /dev/null\n@@ -1 +1 @@\n-old\n+new\n",
    "--- a/a.txt\n+++ b/a.txt\n--- a/other.txt\n+++ b/other.txt\n@@ -1 +1 @@\n line\n",
    "--- a/a.txt\n@@ -1 +1 @@\n line\n",
  ])
    assert.throws(
      () =>
        formatLineFeedback(
          git(patch),
          { side: "new", start: 1, end: 1 },
          "comment",
        ),
      /UNSUPPORTED_DIFF/,
    );
});
