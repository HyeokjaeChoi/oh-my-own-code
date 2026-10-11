import { configurationBackupId } from "./configuration-file-observation.mjs";
import { validSkillSourceName } from "../renderer/shared/configuration-draft/skill.mjs";

export const SKILL_FEATURE = "configuration_skill_files_v1";
export const isSkillSave = (type) => type === "configuration.skill.save";
const wireId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
const resourceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
export const skillBackupId = (runtimeEpoch, operationId) =>
  configurationBackupId(runtimeEpoch, operationId, "skill");
// Private admission authority is supplied separately; a result cannot bind itself.
export function validSkillSavedResult(record, sourceName) {
  const result = record.result;
  return !!(
    isSkillSave(record.type) &&
    wireId(record.runtimeEpoch) &&
    wireId(record.operationId) &&
    resourceId(record.workspaceId) &&
    record.sessionId === undefined &&
    record.admission === "dispatched" &&
    record.delivery === "accepted" &&
    record.effect === "confirmed" &&
    validSkillSourceName(sourceName) &&
    result &&
    Object.getPrototypeOf(result) === Object.prototype &&
    ["kind", "workspaceId", "sourceName", "version"].every((key) =>
      Object.hasOwn(result, key),
    ) &&
    Object.keys(result).every((key) =>
      ["kind", "workspaceId", "sourceName", "version", "backupId"].includes(
        key,
      ),
    ) &&
    result.kind === "skill_file_saved" &&
    result.workspaceId === record.workspaceId &&
    result.sourceName === sourceName &&
    typeof result.version === "string" &&
    /^[a-f0-9]{64}$/.test(result.version) &&
    (!Object.hasOwn(result, "backupId") ||
      result.backupId ===
        skillBackupId(record.runtimeEpoch, record.operationId))
  );
}
