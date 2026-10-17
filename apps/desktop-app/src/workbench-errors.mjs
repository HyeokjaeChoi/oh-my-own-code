// Shared wire errors only. No DTO, Native, browser or IO imports.
export const ERRORS = Object.freeze({
  AGENT_CHANGED: "The Native Agent observation changed.",
  AGENT_UNVERIFIED:
    "The Native Agent identity or references could not be verified.",
  AGENT_UNSUPPORTED:
    "The Agent file cannot be converted for Native registration.",
  AGENT_OWNERSHIP_CONFLICT: "The Native Agent is not owned by this runtime.",
  AGENT_IN_USE: "A Native session still references this Agent.",
  SKILL_CHANGED: "The Native Skill observation changed.",
  SKILL_UNVERIFIED:
    "The Native Skill identity or history could not be verified.",
  SKILL_UNSUPPORTED:
    "The Skill file cannot be converted for Native registration.",
  SKILL_OWNERSHIP_CONFLICT: "The Native Skill is not owned by this runtime.",
  SKILL_ALREADY_APPLIED:
    "This Native Skill already has a record in the session.",
  MCP_CHANGED: "The MCP catalog changed after its observation.",
  MCP_UNVERIFIED: "The MCP status or ownership could not be verified.",
  MCP_UNSUPPORTED: "This MCP definition cannot be converted for runtime use.",
  MCP_OWNERSHIP_CONFLICT:
    "This MCP registration is not owned by the current runtime.",
  READ_BUSY: "The read capacity is occupied.",
  READ_TIMEOUT: "The whole-read deadline expired.",
  STALE_EPOCH: "The runtime epoch is no longer current.",
  STALE_REVISION: "The expected revision is no longer current.",
  ARCHIVED_SESSION: "Restore this archived session before executing.",
  EMPTY_SESSION: "Add conversation history before forking this session.",
  HAS_DESCENDANTS: "Remove descendant conversations first.",
  DESCENDANTS_UNVERIFIED: "The descendant list could not be verified.",
  INVALID_REQUEST: "Invalid workbench request.",
  NOT_FOUND: "The workspace or session is not registered.",
  BUSY: "The session is busy or its outcome is unconfirmed.",
  CONFLICT: "Another session of the workspace changed files afterwards.",
  CANCELLED: "The operation was cancelled.",
  UNAVAILABLE: "The runtime is unavailable.",
  AUTH_REQUIRED: "No verified model credentials are available.",
  POLICY_UNVERIFIED: "The required permission policy could not be verified.",
  INVALID_SELECTION: "The selected runtime option is unavailable.",
  STALE_PERMISSION: "This permission request is no longer pending.",
  DUPLICATE_CONFLICT:
    "This request ID was already used with different content.",
  LIMIT_REACHED: "The temporary workbench limit was reached.",
  FILE_CHANGED: "The configuration file changed after its observation.",
  INSTRUCTIONS_CHANGED:
    "The session instruction registration changed after its observation.",
  INSTRUCTIONS_UNVERIFIED:
    "The session instruction ownership or state could not be verified.",
  FILE_DENIED: "This path cannot be accessed in the text preview.",
  FILE_UNSUPPORTED: "This file is not supported by the text preview.",
  FILE_TOO_LARGE: "This file exceeds the text preview limit.",
  RUNTIME_ERROR: "The runtime operation failed.",
  TOOL_ERROR: "A tool operation failed.",
  UNKNOWN_OUTCOME:
    "The operation outcome is unknown. It will not be resent automatically.",
});
export function failure(code) {
  return { ok: false, code, message: ERRORS[code] ?? ERRORS.RUNTIME_ERROR };
}
export function fail(code) {
  const error = new Error(ERRORS[code]);
  error.appCode = code;
  throw error;
}
