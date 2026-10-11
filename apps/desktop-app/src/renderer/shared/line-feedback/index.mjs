// Pure local context formatting. Existing observations supply identity; no IO,
// hashing, execution authority, version generation or automatic transmission.
import {
  validateWorkspaceFileObservation,
  workspaceFilePathReason,
} from "../workspace-file/index.mjs";
import {
  validateGitDiffObservation,
  GIT_REVIEW_LIMITS,
} from "../git-review/index.mjs";

export const LINE_FEEDBACK_LIMITS = Object.freeze({
  lines: 200,
  excerptCharacters: 8192,
  excerptBytes: 32768,
  commentCharacters: 2000,
  draftCharacters: 32000,
});
const fail = (code) => {
  throw new Error(code);
};
const closed = (value, keys) =>
  Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).length === keys.length &&
      keys.every(
        (key) =>
          Object.hasOwn(value, key) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(value, key), "value"),
      ),
  );
const bytes = (text) => new globalThis.TextEncoder().encode(text).length;

function observation(source) {
  if (
    !closed(source, ["kind", "observation"]) ||
    !["file", "git"].includes(source.kind)
  )
    fail("INVALID_FEEDBACK_SOURCE");
  let value;
  try {
    value =
      source.kind === "file"
        ? validateWorkspaceFileObservation(source.observation)
        : validateGitDiffObservation(source.observation);
  } catch {
    fail("INVALID_FEEDBACK_SOURCE");
  }
  if (value.status !== "available" || workspaceFilePathReason(value.path))
    fail("INVALID_FEEDBACK_SOURCE");
  return value;
}

function selectedRange(selection, kind) {
  if (
    !closed(selection, ["side", "start", "end"]) ||
    !(kind === "file"
      ? selection.side === "file"
      : ["old", "new"].includes(selection.side)) ||
    !Number.isSafeInteger(selection.start) ||
    selection.start < 1 ||
    !Number.isSafeInteger(selection.end) ||
    selection.end < selection.start ||
    selection.end - selection.start >= LINE_FEEDBACK_LIMITS.lines
  )
    fail("INVALID_LINE_RANGE");
}

function fileExcerpt(text, start, end) {
  const lines = text.match(/[^\r\n]*(?:\r\n|\r|\n)|[^\r\n]+$/gu) ?? [];
  if (end > lines.length) fail("INVALID_LINE_RANGE");
  return lines.slice(start - 1, end).join("");
}

function diffLines(patch) {
  const maps = { old: new Map(), new: new Map() };
  if (!patch) return maps;
  if (!patch.endsWith("\n")) fail("UNSUPPORTED_DIFF");
  const lines = patch.slice(0, -1).split("\n");
  if (lines.length > GIT_REVIEW_LIMITS.patchLines) fail("UNSUPPORTED_DIFF");
  let hunk,
    previous,
    hunks = 0,
    files = 0;
  const ends = { old: 0, new: 0 };
  const terminated = { old: false, new: false };
  const headers = { old: undefined, new: undefined };
  function finish() {
    if (
      hunk &&
      (hunk.oldUsed !== hunk.oldCount || hunk.newUsed !== hunk.newCount)
    )
      fail("UNSUPPORTED_DIFF");
  }
  for (const line of lines) {
    if (line.startsWith("@@")) {
      finish();
      const match =
        /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?: .*)?$/u.exec(line);
      if (!match || ++hunks > GIT_REVIEW_LIMITS.patchHunks)
        fail("UNSUPPORTED_DIFF");
      const oldStart = Number(match[1]),
        oldCount = Number(match[2] ?? 1);
      const newStart = Number(match[3]),
        newCount = Number(match[4] ?? 1);
      if (
        ![
          oldStart,
          oldCount,
          newStart,
          newCount,
          oldStart + oldCount,
          newStart + newCount,
        ].every(Number.isSafeInteger) ||
        oldCount > GIT_REVIEW_LIMITS.patchLines ||
        newCount > GIT_REVIEW_LIMITS.patchLines ||
        (oldCount && oldStart < 1) ||
        (newCount && newStart < 1) ||
        oldStart < ends.old ||
        newStart < ends.new ||
        (headers.old !== undefined) !== (headers.new !== undefined) ||
        (headers.old === "/dev/null" && (oldStart !== 0 || oldCount !== 0)) ||
        (headers.new === "/dev/null" && (newStart !== 0 || newCount !== 0)) ||
        (!oldCount && !newCount)
      )
        fail("UNSUPPORTED_DIFF");
      ends.old = oldStart + oldCount;
      ends.new = newStart + newCount;
      hunk = { oldStart, oldCount, newStart, newCount, oldUsed: 0, newUsed: 0 };
      previous = undefined;
      continue;
    }
    if (!hunk) {
      if (line.startsWith("--- ") || line.startsWith("+++ ")) {
        const side = line.startsWith("--- ") ? "old" : "new";
        if (
          headers[side] !== undefined ||
          !line.slice(4) ||
          (side === "new" && headers.old === undefined)
        )
          fail("UNSUPPORTED_DIFF");
        headers[side] = line.slice(4);
      } else if (line.startsWith("diff --git ")) {
        if (++files > 1) fail("UNSUPPORTED_DIFF");
      } else if (
        !/^(?:index |--- |\+\+\+ |old mode |new mode |new file mode |deleted file mode )/u.test(
          line,
        )
      )
        fail("UNSUPPORTED_DIFF");
      continue;
    }
    if (line === "\\ No newline at end of file") {
      if (!previous) fail("UNSUPPORTED_DIFF");
      for (const { side, item } of previous) {
        item.newline = false;
        terminated[side] = true;
      }
      previous = undefined;
      continue;
    }
    const prefix = line[0];
    if (![" ", "+", "-"].includes(prefix)) fail("UNSUPPORTED_DIFF");
    const item = { text: line.slice(1), newline: true };
    previous = [];
    for (const side of ["old", "new"]) {
      if (
        (side === "old" && prefix === "+") ||
        (side === "new" && prefix === "-")
      )
        continue;
      const used = side + "Used",
        count = side + "Count",
        position = hunk[side + "Start"] + hunk[used];
      if (
        terminated[side] ||
        hunk[used] >= hunk[count] ||
        maps[side].has(position)
      )
        fail("UNSUPPORTED_DIFF");
      hunk[used]++;
      maps[side].set(position, item);
      previous.push({ side, item });
    }
  }
  finish();
  return maps;
}

function diffExcerpt(patch, selection) {
  const lines = diffLines(patch)[selection.side];
  let excerpt = "";
  for (let line = selection.start; line <= selection.end; line++) {
    const item = lines.get(line);
    if (!item) fail("INVALID_LINE_RANGE");
    excerpt += item.text + (item.newline ? "\n" : "");
  }
  return excerpt;
}

export function formatLineFeedback(source, selection, comment) {
  const value = observation(source);
  selectedRange(selection, source.kind);
  if (typeof comment !== "string" || !comment.isWellFormed() || !comment.trim())
    fail("INVALID_FEEDBACK_COMMENT");
  if (comment.length > LINE_FEEDBACK_LIMITS.commentCharacters)
    fail("FEEDBACK_TOO_LARGE");
  const excerpt =
    source.kind === "file"
      ? fileExcerpt(value.content, selection.start, selection.end)
      : diffExcerpt(value.patch, selection);
  if (
    excerpt.length > LINE_FEEDBACK_LIMITS.excerptCharacters ||
    bytes(excerpt) > LINE_FEEDBACK_LIMITS.excerptBytes
  )
    fail("FEEDBACK_TOO_LARGE");
  const reference = Object.freeze({
    kind: source.kind,
    runtimeEpoch: value.runtimeEpoch,
    revision: value.revision,
    workspaceId: value.workspaceId,
    workspacePath: value.workspacePath,
    path: value.path,
    ...(source.kind === "file"
      ? {
          targetPath: value.targetPath,
          version: value.version,
          directoryVersion: value.directoryVersion,
        }
      : {
          observationId: value.observationId,
          sourceDigest: value.sourceDigest,
          mode: value.mode,
          ...(value.mode === "base"
            ? { baseRef: value.baseRef, baseOid: value.baseOid }
            : {}),
        }),
    side: selection.side,
    start: selection.start,
    end: selection.end,
  });
  const text =
    "[파일·diff 줄 피드백 · 관찰한 버전 기준]\n" +
    JSON.stringify({ reference, excerpt, comment }, null, 2);
  if (text.length > LINE_FEEDBACK_LIMITS.draftCharacters)
    fail("FEEDBACK_TOO_LARGE");
  return Object.freeze({ reference, excerpt, comment, text });
}

export function appendLineFeedback(existingText, formattedText) {
  if (
    typeof existingText !== "string" ||
    !existingText.isWellFormed() ||
    typeof formattedText !== "string" ||
    !formattedText.isWellFormed() ||
    !formattedText
  )
    fail("INVALID_FEEDBACK_TEXT");
  const next = existingText
    ? existingText + "\n\n" + formattedText
    : formattedText;
  if (next.length > LINE_FEEDBACK_LIMITS.draftCharacters)
    fail("DRAFT_TOO_LARGE");
  return next;
}
