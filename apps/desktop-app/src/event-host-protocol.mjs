import {
  validateGitBranchRestoreKernelRequest,
  validateGitBranchRestoreKernelResult,
} from "./host/git-branch-restore-contract.mjs";
import {
  validateGitCommitKernelRequest,
  validateGitCommitKernelResult,
} from "./host/git-commit-contract.mjs";
import {
  validateGitIndexKernelRequest,
  validateGitIndexKernelResult,
} from "./host/git-index-contract.mjs";
import {
  validWorkspaceFilePath,
  validWorkspaceFileRoot,
  workspaceFilePathReason,
  workspaceFileWriteFits,
} from "./renderer/shared/workspace-file/index.mjs";
import { configurationFileWriteFits } from "./renderer/shared/configuration-draft/validation.mjs";
import {
  validSkillSourceName,
  skillFileWriteFits,
} from "./renderer/shared/configuration-draft/skill.mjs";
import {
  validAgentSourceName,
  agentFileWriteFits,
} from "./renderer/shared/configuration-draft/agent.mjs";
import { isAbsolute } from "node:path";
import {
  initialization,
  taskArmRequest,
  taskPreparation,
  taskPreparedResult,
} from "./native-permission-control-input.mjs";

export const EVENT_HOST_CONFIG = JSON.stringify({
  plugins: [],
  mcp: {},
  providers: {},
  instructions: [],
  permissions: [{ action: "*", resource: "*", effect: "deny" }],
  update: "disable",
  share: "disabled",
});
const hex = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const closed = (object, keys) =>
  object &&
  typeof object === "object" &&
  !Array.isArray(object) &&
  Object.keys(object).sort().join() === keys.sort().join();
const absolute = (value) =>
  typeof value === "string" && isAbsolute(value) && !value.includes("\0");
// Bounded, path-redacted diagnostics. Observational only: no authority, no
// renderer exposure. Absolute paths and long opaque tokens never leave the child.
// No free text: log messages and error messages can carry paths or user data.
const DIAGNOSTIC_TEXT = ["step", "code", "route", "tag", "heldBy"];
const DIAGNOSTIC_IDENTIFIER = ["code", "tag"];
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,80}$/u;
const DIAGNOSTIC_FLAGS = ["runtimeHeld", "inventoryFailed", "inventoryChanged"];
const redact = (value, max) =>
  String(value ?? "")
    .replace(/[^\x20-\x7e]/gu, "?")
    .replace(/(^|[\s"'(=:])\/[^\s"')]*/gu, "$1<path>")
    .replace(/[A-Za-z0-9+/_-]{40,}/gu, "<token>")
    .slice(0, max);
const redactRoute = (value) =>
  String(value ?? "")
    .split("?")[0]
    .split("/")
    .map((part) => (part.length >= 16 ? ":id" : part))
    .join("/")
    .replace(/[^\x20-\x7e]/gu, "?")
    .slice(0, 120);
export function sanitizeDiagnostic(input) {
  const out = {};
  if (
    ["hold", "reject", "native", "inventory-diagnostic"].includes(input?.kind)
  )
    out.kind = input.kind;
  else return undefined;
  for (const key of DIAGNOSTIC_TEXT) {
    if (input[key] === undefined) continue;
    if (DIAGNOSTIC_IDENTIFIER.includes(key)) {
      if (IDENTIFIER.test(input[key])) out[key] = input[key];
    } else
      out[key] =
        key === "route" ? redactRoute(input[key]) : redact(input[key], 120);
  }
  for (const key of DIAGNOSTIC_FLAGS)
    if (input[key] !== undefined) out[key] = input[key] === true;
  if (
    Number.isInteger(input.status) &&
    input.status >= 100 &&
    input.status < 600
  )
    out.status = input.status;
  return out;
}
// Bounded, deduplicated emitter. Per-kind caps: a flood of rejects or 5xx logs
// can never crowd out holds. Best effort; never throws or carries authority.
export function createDiagnosticEmitter(emit, isClosing) {
  const caps = { hold: 100, reject: 100, native: 100 };
  const counts = { hold: 0, reject: 0, native: 0 };
  let last;
  return (raw) => {
    try {
      const clean = sanitizeDiagnostic(raw);
      if (!clean || isClosing() || counts[clean.kind] >= caps[clean.kind])
        return;
      const key = JSON.stringify(clean);
      if (key === last) return;
      last = key;
      counts[clean.kind]++;
      emit({ type: "diagnostic", diagnostic: clean });
    } catch {
      /* diagnostics are best effort */
    }
  };
}
const validDiagnostic = (value) => {
  const clean = sanitizeDiagnostic(value);
  return (
    clean !== undefined &&
    Object.keys(value).length === Object.keys(clean).length &&
    Object.entries(clean).every(([key, item]) => value[key] === item)
  );
};
export function validateHostMessage(message, receiver) {
  let size;
  try {
    size = Buffer.byteLength(JSON.stringify(message));
  } catch {
    throw new Error("invalid_ipc");
  }
  const saveMessage = [
    "git-branch-restore-prepare",
    "git-branch-restore-publish",
    "git-branch-restore-abort",
    "git-branch-restore-result",
    "git-commit-prepare",
    "git-commit-publish",
    "git-commit-abort",
    "git-commit-result",
    "git-index-prepare",
    "git-index-publish",
    "git-index-abort",
    "git-index-result",
    "configuration-prepare",
    "configuration-publish",
    "configuration-abort",
    "configuration-result",
  ].includes(message?.type);
  if (size > (saveMessage ? 262144 : 16384) || !message || !hex(message.nonce))
    throw new Error("invalid_ipc");
  if (receiver === "child") {
    if (message.type === "task-prepare") {
      if (
        !closed(message, ["type", "nonce", "requestId", "request"]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      try {
        taskPreparation(message.request);
      } catch {
        throw new Error("invalid_ipc");
      }
      return message;
    }
    if (message.type === "task-arm") {
      if (
        !closed(message, ["type", "nonce", "requestId", "request"]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      try {
        taskArmRequest(message.request);
      } catch {
        throw new Error("invalid_ipc");
      }
      return message;
    }
    if (message.type === "task-revoke") {
      if (
        !closed(message, ["type", "nonce", "requestId", "handoffId"]) ||
        !hex(message.requestId) ||
        typeof message.handoffId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(message.handoffId)
      )
        throw new Error("invalid_ipc");
      return message;
    }
    if (
      [
        "git-index-prepare",
        "git-commit-prepare",
        "git-branch-restore-prepare",
      ].includes(message.type)
    ) {
      if (
        !closed(message, ["type", "nonce", "requestId", "operation"]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      try {
        (message.type === "git-branch-restore-prepare"
          ? validateGitBranchRestoreKernelRequest
          : message.type === "git-commit-prepare"
            ? validateGitCommitKernelRequest
            : validateGitIndexKernelRequest)(message.operation);
      } catch {
        throw new Error("invalid_ipc");
      }
      return message;
    }
    if (
      [
        "git-branch-restore-publish",
        "git-branch-restore-abort",
        "git-index-publish",
        "git-index-abort",
        "git-commit-publish",
        "git-commit-abort",
      ].includes(message.type)
    ) {
      if (
        !closed(message, ["type", "nonce", "requestId", "token"]) ||
        !hex(message.requestId) ||
        !hex(message.token)
      )
        throw new Error("invalid_ipc");
      return message;
    }
    if (message.type === "stop" && closed(message, ["type", "nonce"]))
      return message;
    if (
      message.type === "observe" &&
      closed(message, ["type", "nonce", "requestId"]) &&
      hex(message.requestId)
    )
      return message;
    if (message.type === "configuration-prepare") {
      if (
        !closed(message, ["type", "nonce", "requestId", "operation"]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      const op = message.operation;
      const keys = [
        "runtimeEpoch",
        "operationId",
        "workspaceId",
        "workspacePath",
        "kind",
        "text",
        "expectation",
        ...(op?.kind === "file" ? ["path", "directoryVersion"] : []),
        ...(["skill", "agent"].includes(op?.kind)
          ? ["sourceName", "directoryVersion"]
          : []),
        ...(op?.expectation === "version" ? ["version"] : []),
      ];
      if (
        !closed(op, keys) ||
        ![op.runtimeEpoch, op.operationId, op.workspaceId].every(
          (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(v),
        ) ||
        !absolute(op.workspacePath) ||
        op.workspacePath.length > 4096 ||
        [...op.workspacePath].some((c) => c.charCodeAt(0) < 32) ||
        !(op.kind === "file"
          ? validWorkspaceFileRoot(op.workspacePath) &&
            validWorkspaceFilePath(op.path) &&
            !workspaceFilePathReason(op.path) &&
            workspaceFileWriteFits(op.text) &&
            hex(op.directoryVersion) &&
            op.expectation === "version"
          : ["skill", "agent"].includes(op.kind)
            ? (op.kind === "skill"
                ? validSkillSourceName
                : validAgentSourceName)(op.sourceName) &&
              hex(op.directoryVersion) &&
              (op.kind === "skill" ? skillFileWriteFits : agentFileWriteFits)(
                op.text,
              )
            : configurationFileWriteFits(op.kind, op.text)) ||
        !["missing", "version"].includes(op.expectation) ||
        (op.expectation === "version" && !hex(op.version))
      )
        throw new Error("invalid_ipc");
      return message;
    }
    if (
      ["configuration-publish", "configuration-abort"].includes(message.type)
    ) {
      if (
        !closed(message, ["type", "nonce", "requestId", "token"]) ||
        !hex(message.requestId) ||
        !hex(message.token)
      )
        throw new Error("invalid_ipc");
      return message;
    }
    const keys = [
      "type",
      "nonce",
      "runtimeEpoch",
      "password",
      "port",
      "root",
      "workspace",
      "configPath",
      "namespaceRoot",
      "dataPath",
      "statePath",
      "database",
      "engineVersion",
      "serverVersion",
    ];
    if (
      message.type !== "init" ||
      !closed(message, keys) ||
      !hex(message.password) ||
      !Number.isInteger(message.port) ||
      message.port < 0 ||
      message.port > 65535 ||
      message.engineVersion !== "1.4.2" ||
      message.serverVersion !== "2.0.18" ||
      ![
        "root",
        "workspace",
        "configPath",
        "namespaceRoot",
        "dataPath",
        "statePath",
        "database",
      ].every((key) => absolute(message[key]))
    )
      throw new Error("invalid_ipc");
    try {
      initialization({ runtimeEpoch: message.runtimeEpoch, bootHolds: [] });
    } catch {
      throw new Error("invalid_ipc");
    }
  } else if (receiver === "parent") {
    if (!Number.isSafeInteger(message.pid) || message.pid <= 0)
      throw new Error("invalid_ipc");
    if (message.type === "task-preparation") {
      if (
        !closed(message, [
          "type",
          "nonce",
          "pid",
          "requestId",
          "request",
          "result",
        ]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      try {
        taskPreparation(message.request);
      } catch {
        throw new Error("invalid_ipc");
      }
      try {
        taskPreparedResult(message.result);
      } catch {
        throw new Error("invalid_ipc");
      }
      return message;
    }
    if (message.type === "task-handoff-result") {
      if (
        !closed(message, [
          "type",
          "nonce",
          "pid",
          "requestId",
          "action",
          "handoffId",
          "status",
        ]) ||
        !hex(message.requestId) ||
        !["arm", "revoke"].includes(message.action) ||
        !["ok", "refused"].includes(message.status) ||
        typeof message.handoffId !== "string" ||
        !/^[a-f0-9-]{36}$/.test(message.handoffId)
      )
        throw new Error("invalid_ipc");
      return message;
    }
    if (
      [
        "git-index-result",
        "git-commit-result",
        "git-branch-restore-result",
      ].includes(message.type)
    ) {
      if (
        !closed(message, ["type", "nonce", "pid", "requestId", "result"]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      try {
        (message.type === "git-branch-restore-result"
          ? validateGitBranchRestoreKernelResult
          : message.type === "git-commit-result"
            ? validateGitCommitKernelResult
            : validateGitIndexKernelResult)(message.result);
      } catch {
        throw new Error("invalid_ipc");
      }
      return message;
    }
    if (message.type === "configuration-result") {
      if (
        !closed(message, ["type", "nonce", "pid", "requestId", "result"]) ||
        !hex(message.requestId)
      )
        throw new Error("invalid_ipc");
      const r = message.result;
      const ok =
        r?.status === "staged"
          ? closed(r, ["status", "token"]) && hex(r.token)
          : r?.status === "saved"
            ? closed(r, [
                "status",
                "version",
                ...(r.backupId === undefined ? [] : ["backupId"]),
              ]) &&
              hex(r.version) &&
              (r.backupId === undefined ||
                /^\.omoc-configuration-[a-f0-9]{64}\.(instructions|mcp|skill|agent|file)\.backup$/.test(
                  r.backupId,
                ))
            : r?.status === "aborted"
              ? closed(r, ["status"])
              : r?.status === "unknown"
                ? closed(r, ["status", "reason"]) &&
                  [
                    "invalid_request",
                    "unsupported_runtime",
                    "busy",
                    "path_denied",
                    "path_missing",
                    "file_changed",
                    "unsupported_content",
                    "unsupported_metadata",
                    "stage_collision",
                    "io_failed",
                    "expired",
                    "invalid_token",
                    "closed",
                  ].includes(r.reason)
                : false;
      if (!ok) throw new Error("invalid_ipc");
      return message;
    }
    if (message.type === "ready") {
      if (
        !closed(message, [
          "type",
          "nonce",
          "pid",
          "port",
          "engineVersion",
          "serverVersion",
        ]) ||
        !Number.isInteger(message.port) ||
        message.port < 1 ||
        message.port > 65535 ||
        message.engineVersion !== "1.4.2" ||
        message.serverVersion !== "2.0.18"
      )
        throw new Error("invalid_ipc");
    } else if (message.type === "observation") {
      if (
        !closed(message, [
          "type",
          "nonce",
          "pid",
          "requestId",
          "observerGap",
          "live",
          "allExited",
        ]) ||
        !hex(message.requestId) ||
        typeof message.observerGap !== "boolean" ||
        typeof message.allExited !== "boolean" ||
        !Number.isSafeInteger(message.live) ||
        message.live < 0 ||
        message.live > 100000 ||
        message.allExited !== (message.live === 0)
      )
        throw new Error("invalid_ipc");
    } else if (message.type === "scope-closed") {
      if (
        !closed(message, ["type", "nonce", "pid", "observerGap", "live"]) ||
        typeof message.observerGap !== "boolean" ||
        !Number.isSafeInteger(message.live) ||
        message.live < 0 ||
        message.live > 100000
      )
        throw new Error("invalid_ipc");
    } else if (message.type === "diagnostic") {
      if (
        !closed(message, ["type", "nonce", "pid", "diagnostic"]) ||
        !validDiagnostic(message.diagnostic)
      )
        throw new Error("invalid_ipc");
    } else if (
      message.type !== "hold" ||
      !closed(message, ["type", "nonce", "pid"])
    )
      throw new Error("invalid_ipc");
  } else throw new Error("invalid_ipc");
  return message;
}
