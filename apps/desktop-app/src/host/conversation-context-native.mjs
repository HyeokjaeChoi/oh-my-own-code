// Explicit bounded Native reports. Never project raw attachment data or source paths.
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/u.test(value);
const invalid = () => {
  throw new Error("INVALID_REQUEST");
};
export function projectContextInbox(rows, sessionID) {
  if (!Array.isArray(rows) || rows.length > 64 || !id(sessionID)) invalid();
  const ids = new Set(),
    entries = [];
  let otherCount = 0;
  for (const row of rows) {
    if (
      !row ||
      !id(row.id) ||
      ids.has(row.id) ||
      row.sessionID !== sessionID ||
      !["user", "synthetic", "compaction", "move"].includes(row.type)
    )
      invalid();
    ids.add(row.id);
    if (row.type !== "user") {
      otherCount++;
      continue;
    }
    const text = row.payload?.text,
      files = row.payload?.files;
    if (
      !["steer", "queue"].includes(row.delivery) ||
      typeof text !== "string" ||
      text.length > 32000 ||
      !text.isWellFormed() ||
      (files !== undefined && (!Array.isArray(files) || files.length > 8))
    )
      invalid();
    // A bounded UTF-16 preview must not expose half of a surrogate pair.
    const end =
      text.length > 2000 &&
      text.charCodeAt(1999) >= 0xd800 &&
      text.charCodeAt(1999) <= 0xdbff
        ? 1999
        : 2000;
    entries.push({
      id: row.id,
      delivery: row.delivery,
      textPreview: text.slice(0, end),
      textTruncated: text.length > 2000,
      attachmentCount: files?.length ?? 0,
    });
  }
  return { entries, otherCount };
}
export function validContextPromptReceipt(
  result,
  sessionID,
  text,
  delivery,
  files,
) {
  if (
    !id(result?.id) ||
    result.sessionID !== sessionID ||
    result.type !== "user" ||
    result.payload?.text !== text ||
    (delivery !== undefined && result.delivery !== delivery)
  )
    return false;
  if (!files) return true;
  const reported = result.payload.files;
  if (!Array.isArray(reported) || reported.length !== files.length)
    return false;
  return reported.every((file, i) => {
    const expected = files[i],
      prefix = expected.uri.indexOf(","),
      mime = expected.uri.slice(5, prefix - 7);
    if (
      !file ||
      file.source?.type !== "inline" ||
      Object.keys(file.source).length !== 1 ||
      file.name !== expected.name ||
      typeof file.data !== "string" ||
      file.data.length > Math.ceil((20 * 1024 * 1024) / 3) * 4 ||
      file.data.length % 4 !== 0 ||
      !/^[A-Za-z0-9+/]*={0,2}$/.test(file.data)
    )
      return false;
    return mime.startsWith("image/")
      ? ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(
          file.mime,
        )
      : file.mime === mime && file.data === expected.uri.slice(prefix + 1);
  });
}
