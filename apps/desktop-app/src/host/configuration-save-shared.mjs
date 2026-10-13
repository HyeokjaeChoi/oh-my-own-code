// Pure helpers shared by the darwin (descriptor) and win32 (name-identity)
// configuration/file save kernels. No IO, no platform primitives.
import { isAbsolute, normalize } from "node:path";
import {
  validSkillSourceName,
  skillFileWriteFits,
} from "../renderer/shared/configuration-draft/skill.mjs";
import {
  validAgentSourceName,
  agentFileWriteFits,
} from "../renderer/shared/configuration-draft/agent.mjs";
import { configurationFileWriteFits } from "../renderer/shared/configuration-draft/validation.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
  workspaceFileWriteFits,
} from "../renderer/shared/workspace-file/index.mjs";

// Metadata budgets stay fixed; only ordinary file content receives 64KiB.
export const LIMIT = 32768;
export const sourceFile = (kind) => ["skill", "agent"].includes(kind);
export const chainBound = (kind) => sourceFile(kind) || kind === "file";
export const HEX = /^[a-f0-9]{64}$/;
export const key = (v, max = 128) =>
  typeof v === "string" && new RegExp(`^[A-Za-z0-9_.:-]{1,${max}}$`).test(v);
export const closed = (v, required, optional = []) => {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) return false;
  const keys = Reflect.ownKeys(v);
  return (
    required.every((k) => keys.includes(k)) &&
    keys.every(
      (k) =>
        [...required, ...optional].includes(k) &&
        Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
    )
  );
};
export class KernelFailure extends Error {}
export const refuse = (reason) => {
  throw new KernelFailure(reason);
};
export const unknown = (e, task) => ({
  status: "unknown",
  reason:
    e instanceof KernelFailure
      ? e.message
      : chainBound(task?.request.kind) && ["EACCES", "EPERM"].includes(e?.code)
        ? "path_denied"
        : chainBound(task?.request.kind) &&
            ["ENOENT", "ENOTDIR"].includes(e?.code)
          ? "path_missing"
          : "io_failed",
});
export const identity = (a, b) => a.dev === b.dev && a.ino === b.ino;
export const sameFile = (a, b, renamed = false) =>
  identity(a, b) &&
  a.size === b.size &&
  a.mtimeNs === b.mtimeNs &&
  (renamed || a.ctimeNs === b.ctimeNs);
export const sameMetadata = (a, b) =>
  a.mode === b.mode &&
  a.entries.length === b.entries.length &&
  a.entries.every(
    ([name, value], i) =>
      name.equals(b.entries[i][0]) && value.equals(b.entries[i][1]),
  );

export function requestFits(r) {
  if (
    !closed(
      r,
      [
        "runtimeEpoch",
        "operationId",
        "workspaceId",
        "workspacePath",
        "kind",
        "text",
        "expectation",
      ],
      r?.kind === "file"
        ? ["version", "path", "directoryVersion"]
        : sourceFile(r?.kind)
          ? ["version", "sourceName", "directoryVersion"]
          : ["version"],
    )
  )
    return false;
  return (
    key(r.runtimeEpoch) &&
    key(r.operationId) &&
    key(r.workspaceId, 256) &&
    typeof r.workspacePath === "string" &&
    r.workspacePath.length <= 4096 &&
    isAbsolute(r.workspacePath) &&
    normalize(r.workspacePath) === r.workspacePath &&
    !Array.from(r.workspacePath).some((ch) => {
      const code = ch.charCodeAt(0);
      return code < 32 || (code >= 127 && code <= 159);
    }) &&
    ["instructions", "mcp", "skill", "agent", "file"].includes(r.kind) &&
    (r.kind === "file"
      ? key(r.workspaceId) &&
        validWorkspaceFileRoot(r.workspacePath) &&
        workspaceFilePathReason(r.path) === undefined &&
        workspaceFileWriteFits(r.text) &&
        r.expectation === "version" &&
        typeof r.directoryVersion === "string" &&
        HEX.test(r.directoryVersion)
      : sourceFile(r.kind)
        ? (r.kind === "skill" ? validSkillSourceName : validAgentSourceName)(
            r.sourceName,
          ) &&
          typeof r.directoryVersion === "string" &&
          HEX.test(r.directoryVersion) &&
          (r.kind === "skill" ? skillFileWriteFits : agentFileWriteFits)(r.text)
        : configurationFileWriteFits(r.kind, r.text)) &&
    ((r.expectation === "missing" && !Object.hasOwn(r, "version")) ||
      (r.expectation === "version" &&
        typeof r.version === "string" &&
        HEX.test(r.version)))
  );
}
