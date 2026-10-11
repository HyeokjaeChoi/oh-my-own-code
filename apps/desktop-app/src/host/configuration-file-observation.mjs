import { createHash } from "node:crypto";

// These timestamps describe an observation, never a write/CAS authorization.
export function configurationFileVersion(base, root, file, bytes, chain) {
  const fields = [
    base.workspaceId,
    base.workspacePath,
    base.kind,
    base.path,
    root.dev,
    root.ino,
    root.mtimeNs,
    root.ctimeNs,
    file.dev,
    file.ino,
    file.size,
    file.mtimeNs,
    file.ctimeNs,
    createHash("sha256").update(bytes).digest("hex"),
  ].map(String);
  if (["skill", "agent"].includes(base.kind))
    fields.push(base.sourceName, chain);
  if (base.kind === "file") fields.push(chain);
  return createHash("sha256").update(JSON.stringify(fields)).digest("hex");
}

export function configurationBackupId(runtimeEpoch, operationId, kind) {
  if (
    ![runtimeEpoch, operationId].every(
      (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v),
    ) ||
    !["instructions", "mcp", "skill", "agent", "file"].includes(kind)
  )
    throw new Error("invalid_request");
  const key = createHash("sha256")
    .update(JSON.stringify([runtimeEpoch, operationId]))
    .digest("hex");
  return `.omoc-configuration-${key}.${kind}.backup`;
}

// chain is ordered workspace -> .opencode -> skills -> sourceName, or agents.
// Entries contain canonical paths and decimal dev/ino strings, never timestamps.
export function configurationSkillDirectoryVersion(base, chain) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        base.workspaceId,
        base.workspacePath,
        base.sourceName,
        chain,
      ]),
    )
    .digest("hex");
}

// Generic files bind the exact relative path and ordered canonical root -> parent.
export function configurationWorkspaceFileDirectoryVersion(base, chain) {
  return createHash("sha256")
    .update(
      JSON.stringify([
        base.workspaceId,
        base.workspacePath,
        "file",
        base.path,
        chain,
      ]),
    )
    .digest("hex");
}
