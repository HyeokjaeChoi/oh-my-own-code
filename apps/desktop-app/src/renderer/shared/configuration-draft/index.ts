export {
  CONFIGURATION_DRAFT_LIMITS,
  emptyConfigurationDraft,
  configurationIssueMessages,
  configurationDraftKey,
  configurationDraftFits,
  configurationFileContentFits,
  configurationFileWriteFits,
  configurationTargetPath,
  validateConfigurationDraft,
} from "./validation.mjs";
export type {
  ConfigurationDraftKind,
  ConfigurationDraft,
  ConfigurationLoadIdentity,
  ConfigurationIssue,
  ConfigurationValidation,
} from "./validation.mjs";
import {
  CONFIGURATION_DRAFT_LIMITS,
  configurationDraftFits,
} from "./validation.mjs";
export type ConfigurationDiffRow = {
  kind: "context" | "removed" | "added";
  text: string;
  oldLine?: number;
  newLine?: number;
};
export function compareConfigurationDraft(baseline: string, text: string) {
  const rows: ConfigurationDiffRow[] = [];
  if (!configurationDraftFits(baseline) || !configurationDraftFits(text))
    return { rows, added: 0, removed: 0, omitted: 0, bounded: false };
  const before = baseline ? baseline.split("\n") : [],
    after = text ? text.split("\n") : [];
  let prefix = 0,
    suffix = 0;
  while (
    prefix < before.length &&
    prefix < after.length &&
    before[prefix] === after[prefix]
  )
    prefix++;
  while (
    suffix < before.length - prefix &&
    suffix < after.length - prefix &&
    before[before.length - suffix - 1] === after[after.length - suffix - 1]
  )
    suffix++;
  const removed = before.length - prefix - suffix,
    added = after.length - prefix - suffix;
  if (!removed && !added)
    return { rows, added, removed, omitted: 0, bounded: true };
  for (let i = Math.max(0, prefix - 3); i < prefix; i++)
    rows.push({
      kind: "context",
      text: before[i] ?? "",
      oldLine: i + 1,
      newLine: i + 1,
    });
  const tail = Math.min(3, suffix),
    budget = CONFIGURATION_DRAFT_LIMITS.diffRows - rows.length - tail;
  let oldCount = Math.min(removed, Math.floor(budget / 2)),
    newCount = Math.min(added, budget - oldCount);
  oldCount = Math.min(removed, budget - newCount);
  newCount = Math.min(added, budget - oldCount);
  for (let i = 0; i < oldCount; i++)
    rows.push({
      kind: "removed",
      text: before[prefix + i] ?? "",
      oldLine: prefix + i + 1,
    });
  for (let i = 0; i < newCount; i++)
    rows.push({
      kind: "added",
      text: after[prefix + i] ?? "",
      newLine: prefix + i + 1,
    });
  for (let i = 0; i < tail; i++)
    rows.push({
      kind: "context",
      text: after[after.length - suffix + i] ?? "",
      oldLine: before.length - suffix + i + 1,
      newLine: after.length - suffix + i + 1,
    });
  return {
    rows,
    added,
    removed,
    omitted: removed + added - oldCount - newCount,
    bounded: true,
  };
}
export {
  SKILL_LIMITS,
  validSkillSourceName,
  skillDraftKey,
  skillFileContentFits,
  validateSkillFile,
  skillFileWriteFits,
  skillIssueMessages,
} from "./skill.mjs";
export type { SkillIssue, SkillValidation } from "./skill.mjs";

export {
  validSkillRuntimeObservation,
  validSkillRuntimeMutation,
  skillRuntimeIdPayload,
  skillRuntimeStep,
} from "./skill-runtime.mjs";

export {
  AGENT_LIMITS,
  validAgentSourceName,
  agentDraftKey,
  agentFileContentFits,
  agentFileWriteFits,
  validateAgentFile,
  parseAgentFile,
  agentIssueMessages,
} from "./agent.mjs";
export type { AgentIssue, AgentValidation } from "./agent.mjs";
export {
  AGENT_RUNTIME_FEATURE,
  agentRuntimeStep,
  validAgentNativeId,
  agentRuntimeIdPayload,
  validAgentRuntimeRow,
  validAgentRuntimeObservation,
  validAgentRuntimeMutation,
} from "./agent-runtime.mjs";
export { BASELINE_POLICY } from "./policy.mjs";
export {
  EXTENSIONS_LIMITS,
  projectNativePlugins,
  projectNativeTools,
  validateExtensionsInventory,
  validateExtensionsObservation,
} from "./extensions.mjs";
export type {
  WorkbenchExtensionUnavailableReason,
  WorkbenchExtensionSource,
  WorkbenchExtensionPlugin,
  WorkbenchExtensionTool,
  WorkbenchExtensionsGroup,
  WorkbenchExtensionsInventory,
  WorkbenchExtensionsObservation,
} from "./extensions.mjs";

export {
  validPermissionPolicyRules,
  validatePermissionPolicyObservation,
} from "./permission-policy.mjs";
export type {
  PermissionPolicyRule,
  WorkbenchPermissionPolicyObservation,
} from "./permission-policy.mjs";
