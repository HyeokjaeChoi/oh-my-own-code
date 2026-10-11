import {
  validAgentSavedResult,
  validAgentRuntimeResult,
} from "./workbench-agent-storage.mjs";
import { validSkillRuntimeResult } from "./workbench-skill-runtime-storage.mjs";
import { validSkillSavedResult } from "./workbench-skill-storage.mjs";
import { ERRORS } from "../workbench-contract.mjs";
import { mcpNativeName, validMcpSourceName } from "./workbench-mcp.mjs";
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const optionalId = (key, value) => (id(value) ? { [key]: value } : {});
// Deliberate allowlists: no raw errors, payloads, snapshots, paths, titles or admission digest.
export function redactReceipt(record) {
  const result = record.result;
  let projected;
  if (result) {
    switch (result.kind) {
      case "agent_registered":
      case "agent_removed":
        if (validAgentRuntimeResult(record)) projected = { ...result };
        break;
      case "agent_file_saved":
        if (validAgentSavedResult(record, record.agentSourceName))
          projected = { ...result };
        break;
      case "skill_registered":
      case "skill_removed":
      case "skill_applied":
        if (validSkillRuntimeResult(record)) projected = { ...result };
        break;
      case "mcp_registered":
      case "mcp_connection":
      case "mcp_removed": {
        const action =
          result.kind === "mcp_registered"
            ? "register"
            : result.kind === "mcp_removed"
              ? "remove"
              : result.action;
        const confirmed =
          record.admission === "dispatched" && record.effect === "confirmed";
        const removedNone =
          result.kind === "mcp_removed" &&
          record.admission === "admitted" &&
          record.effect === "none";
        if (
          record.type !== `configuration.mcp.${action}` ||
          record.delivery !== "accepted" ||
          !(confirmed || removedNone) ||
          !id(result.workspaceId) ||
          result.workspaceId !== record.workspaceId ||
          !validMcpSourceName(result.sourceName) ||
          result.nativeName !==
            mcpNativeName(result.workspaceId, result.sourceName) ||
          (record.nativeServerName !== undefined &&
            record.nativeServerName !== result.nativeName)
        )
          break;
        const common = {
          kind: result.kind,
          workspaceId: result.workspaceId,
          sourceName: result.sourceName,
          nativeName: result.nativeName,
        };
        if (
          result.kind === "mcp_registered" &&
          result.status === "disabled" &&
          /^[a-f0-9]{64}$/.test(result.digest) &&
          /^[a-f0-9]{64}$/.test(result.sourceVersion)
        )
          projected = {
            ...common,
            digest: result.digest,
            sourceVersion: result.sourceVersion,
            status: "disabled",
          };
        else if (
          result.kind === "mcp_connection" &&
          (action === "connect"
            ? ["connected", "failed", "needs_auth"].includes(
                result.connectionStatus,
              )
            : action === "disconnect" && result.connectionStatus === "disabled")
        )
          projected = {
            ...common,
            action,
            connectionStatus: result.connectionStatus,
          };
        else if (result.kind === "mcp_removed") projected = common;
        break;
      }
      case "instruction_registered":
      case "instruction_removed":
        if (
          record.type ===
            (result.kind === "instruction_registered"
              ? "configuration.instructions.apply"
              : "configuration.instructions.remove") &&
          record.admission === "dispatched" &&
          record.delivery === "accepted" &&
          record.effect === "confirmed" &&
          result.workspaceId === record.workspaceId &&
          result.sessionId === record.sessionId &&
          id(result.sessionId) &&
          (result.kind === "instruction_removed" ||
            (/^[a-f0-9]{64}$/.test(result.digest) &&
              /^[a-f0-9]{64}$/.test(result.sourceVersion)))
        )
          projected = {
            kind: result.kind,
            workspaceId: result.workspaceId,
            sessionId: result.sessionId,
            ...(result.kind === "instruction_registered" && {
              digest: result.digest,
              sourceVersion: result.sourceVersion,
            }),
          };
        break;
      case "created":
        projected = {
          kind: "created",
          workspaceId: result.workspaceId,
          ...optionalId("sessionId", result.sessionId),
          ...optionalId("nativeSessionId", result.nativeSessionId),
        };
        break;
      case "forked":
        if (id(result.sessionId) && id(result.nativeSessionId))
          projected = {
            kind: "forked",
            workspaceId: result.workspaceId,
            sessionId: result.sessionId,
            nativeSessionId: result.nativeSessionId,
          };
        break;
      case "removed":
        projected = {
          kind: "removed",
          workspaceId: result.workspaceId,
          workspaceRemoved: result.workspaceRemoved === true,
          ...(Array.isArray(result.removedSessionIds) && {
            removedSessionIds: result.removedSessionIds
              .filter(id)
              .slice(0, 200),
          }),
        };
        break;
      case "skill_file_saved":
        if (validSkillSavedResult(record, record.skillSourceName))
          projected = { ...result };
        break;
      case "configuration_saved":
        if (
          record.type === "configuration.save" &&
          record.admission === "dispatched" &&
          record.delivery === "accepted" &&
          record.effect === "confirmed" &&
          ["instructions", "mcp"].includes(result.configurationKind) &&
          /^[a-f0-9]{64}$/.test(result.version) &&
          (result.backupId === undefined ||
            /^\.omoc-configuration-[a-f0-9]{64}\.(instructions|mcp)\.backup$/.test(
              result.backupId,
            ))
        )
          projected = {
            kind: "configuration_saved",
            workspaceId: result.workspaceId,
            configurationKind: result.configurationKind,
            version: result.version,
            ...optionalId("backupId", result.backupId),
          };
        break;
      case "metadata":
        if (id(result.sessionId))
          projected = {
            kind: "metadata",
            workspaceId: result.workspaceId,
            sessionId: result.sessionId,
          };
        break;
      case "delivery":
        if (["accepted", "stopping", "decided"].includes(result.status))
          projected = {
            kind: "delivery",
            status: result.status,
            ...optionalId("nativeInboxId", result.nativeInboxId),
            ...optionalId("nativeRequestId", result.nativeRequestId),
          };
        break;
      case "rejected":
        if (Object.hasOwn(ERRORS, result.code))
          projected = { kind: "rejected", code: result.code };
        break;
    }
    if (projected?.workspaceId && !id(projected.workspaceId))
      projected = undefined;
  }
  return {
    runtimeEpoch: record.runtimeEpoch,
    operationId: record.operationId,
    type: record.type,
    ...optionalId("workspaceId", record.workspaceId),
    ...optionalId("sessionId", record.sessionId),
    admission: record.admission,
    delivery: record.delivery,
    effect: record.effect,
    revision: record.revision,
    evidence: record.evidence
      .slice(0, 8)
      .filter((e) => id(e.kind) && (e.id === undefined || id(e.id)))
      .map((e) => ({ kind: e.kind, ...optionalId("id", e.id) })),
    ...(projected && { result: projected }),
  };
}
