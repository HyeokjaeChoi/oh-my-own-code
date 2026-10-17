// Pure helpers for the side panel: unified-patch rows, relative time and
// middle-ellipsis path splitting. Nothing here touches the DOM.

// Splits a unified patch into display rows. Lines before the first hunk are
// file headers; inside hunks `+`/`-`/space lines carry old/new line numbers.
export function parsePatch(patch) {
  const rows = [];
  let added = 0,
    removed = 0,
    oldNo = 0,
    newNo = 0,
    inHunk = false;
  for (const line of String(patch).split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      inHunk = true;
      oldNo = Number(hunk[1]);
      newNo = Number(hunk[2]);
      rows.push({ kind: "hunk", text: line });
    } else if (!inHunk || line.startsWith("\\")) {
      rows.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      added++;
      rows.push({ kind: "add", text: line, newNo: newNo++ });
    } else if (line.startsWith("-")) {
      removed++;
      rows.push({ kind: "del", text: line, oldNo: oldNo++ });
    } else {
      rows.push({ kind: "ctx", text: line, oldNo: oldNo++, newNo: newNo++ });
    }
  }
  // A trailing newline yields one empty tail row that is not part of the patch.
  if (rows.length && rows.at(-1).text === "") rows.pop();
  return { rows, added, removed };
}

export function relativeTime(timestamp, now = Date.now()) {
  const seconds = Math.max(0, Math.round((now - timestamp) / 1000));
  if (seconds < 45) return "방금 전";
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}분 전`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간 전`;
  return `${Math.round(hours / 24)}일 전`;
}

// Keeps the file name whole: [shrinkable head, fixed tail].
export function splitMiddle(path, tailMax = 28) {
  const slash = path.lastIndexOf("/");
  const name = slash < 0 ? path : path.slice(slash + 1);
  const keep = name.length > tailMax ? name.slice(-tailMax) : name;
  return [path.slice(0, path.length - keep.length), keep];
}
