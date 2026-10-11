// Main-only conversion and bounded history proof. No registration or file IO.
import { createHash } from "node:crypto";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fail } from "../workbench-contract.mjs";
import { validateSkillFile } from "../renderer/shared/configuration-draft/skill.mjs";
import {
  nativeSkillId,
  nativeSkillDigest,
  validNativeSkill,
  validateSkillRpcResult,
} from "../native-skills-protocol.mjs";
export const skillRuntimeDigest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
export function parseSkillRuntimeRecord(owner, text) {
  if (validateSkillFile(text).status !== "valid") fail("SKILL_UNSUPPORTED");
  let content = text.replace(/^\uFEFF/u, ""),
    name = owner.sourceName,
    description;
  if (content.startsWith("---")) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(content);
    if (!match) fail("SKILL_UNSUPPORTED");
    for (const line of match[1].split(/\r?\n/u)) {
      if (line.startsWith("name: ")) name = JSON.parse(line.slice(6));
      if (line.startsWith("description: "))
        description = JSON.parse(line.slice(13));
    }
    content = content.slice(match[0].length);
  }
  const record = {
    id: nativeSkillId(owner),
    name,
    ...(description !== undefined && { description }),
    autoinvoke: false,
    path: join(
      owner.workspacePath,
      ".opencode/skills",
      owner.sourceName,
      "SKILL.md",
    ),
    content,
  };
  if (!validNativeSkill(record, owner)) fail("SKILL_UNSUPPORTED");
  return Object.freeze(record);
}
export function projectNativeSkillRows(
  observed,
  publicList,
  { workspaceId, workspacePath, runtimeEpoch },
) {
  try {
    validateSkillRpcResult("observe", observed);
  } catch {
    fail("SKILL_UNVERIFIED");
  }
  if (observed.status !== "ready")
    return { status: "unavailable", reason: observed.reason };
  if (
    observed.workspaceId !== workspaceId ||
    observed.workspacePath !== workspacePath ||
    publicList?.location?.directory !== workspacePath ||
    !isDeepStrictEqual(publicList.data, observed.native)
  )
    fail("SKILL_UNVERIFIED");
  const owned = observed.rows.map(({ owner, record, recordDigest }) => {
    if (
      owner.runtimeEpoch !== runtimeEpoch ||
      owner.workspaceId !== workspaceId ||
      owner.workspacePath !== workspacePath ||
      recordDigest !== nativeSkillDigest(record)
    )
      fail("SKILL_UNVERIFIED");
    return {
      sourceName: owner.sourceName,
      nativeId: record.id,
      digest: owner.digest,
      nativeDigest: recordDigest,
      registrationRuntimeEpoch: owner.runtimeEpoch,
      registrationOperationId: owner.operationId,
      name: record.name,
      ...(record.description !== undefined && {
        description: record.description,
      }),
      autoinvoke: false,
      path: record.path,
      content: record.content,
      bodyDigest: skillRuntimeDigest(record.content),
    };
  });
  return {
    status: "observed",
    owned,
    unowned: observed.native
      .filter((r) => !owned.some((o) => o.nativeId === r.id))
      .map((r) => ({
        nativeId: r.id,
        name: r.name,
        ...(r.autoinvoke !== undefined && { autoinvoke: r.autoinvoke }),
      })),
  };
}
export const skillRuntimeIdentity = (row) =>
  Object.fromEntries(
    [
      "sourceName",
      "nativeId",
      "digest",
      "nativeDigest",
      "registrationRuntimeEpoch",
      "registrationOperationId",
    ].map((k) => [k, row[k]]),
  );
export const skillRuntimeDispatchProof = (row) => ({
  ...skillRuntimeIdentity(row),
  bodyDigest: row.bodyDigest,
});
// First page supplies order. Pinned Native rejects cursor combined with order.
export async function scanNativeSkillHistory(read, sessionID) {
  const messages = [],
    cursors = new Set(),
    ids = new Set();
  let cursor;
  for (let page = 0; page < 16; page++) {
    const result = await read({
      sessionID,
      type: "skill",
      limit: 64,
      ...(cursor === undefined ? { order: "asc" } : { cursor }),
    });
    if (
      !result ||
      !Array.isArray(result.data) ||
      result.data.length > 64 ||
      !result.cursor ||
      typeof result.cursor !== "object" ||
      Array.isArray(result.cursor)
    )
      fail("SKILL_UNVERIFIED");
    for (const row of result.data) {
      if (
        !row ||
        row.type !== "skill" ||
        typeof row.id !== "string" ||
        !/^[\w.:-]{1,256}$/u.test(row.id) ||
        ids.has(row.id) ||
        typeof row.skill !== "string" ||
        !row.skill.length ||
        row.skill.length > 512 ||
        typeof row.name !== "string" ||
        !row.name.length ||
        row.name.length > 256 ||
        typeof row.text !== "string" ||
        Buffer.byteLength(row.text, "utf8") > 32768 ||
        !row.text.isWellFormed()
      )
        fail("SKILL_UNVERIFIED");
      ids.add(row.id);
      messages.push({
        nativeId: row.skill,
        messageId: row.id,
        name: row.name,
        bodyDigest: skillRuntimeDigest(row.text),
      });
    }
    const next = result.cursor.next;
    if (next === undefined || next === null) return messages;
    if (
      typeof next !== "string" ||
      !next.length ||
      next.length > 8192 ||
      [...next].some(
        (c) =>
          c.charCodeAt(0) < 32 ||
          (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
      ) ||
      cursors.has(next)
    )
      fail("SKILL_UNVERIFIED");
    cursors.add(next);
    cursor = next;
  }
  fail("SKILL_UNVERIFIED");
}
