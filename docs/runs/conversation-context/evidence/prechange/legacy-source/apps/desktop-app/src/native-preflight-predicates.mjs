import { isAbsolute } from "node:path";
import { isDeepStrictEqual } from "node:util";
import {
  PREFLIGHT_LIMITS,
  assertClosedObject,
  preflightAssert,
  isPreflightId,
  isPreflightDigest,
  isPreflightPath,
  validatePreflightRequest,
  validatePreflightDecision,
} from "./native-preflight-protocol.mjs";

// Native 2.0.18 public migration.gen IDs. This is a version coupling, not a ledger API.
export const PINNED_MIGRATION_IDS = Object.freeze([
  "20260127222353_familiar_lady_ursula",
  "20260211171708_add_project_commands",
  "20260213144116_wakeful_the_professor",
  "20260225215848_workspace",
  "20260227213759_add_session_workspace_id",
  "20260228203230_blue_harpoon",
  "20260303231226_add_workspace_fields",
  "20260309230000_move_org_to_state",
  "20260312043431_session_message_cursor",
  "20260323234822_events",
  "20260410174513_workspace-name",
  "20260413175956_chief_energizer",
  "20260423070820_add_icon_url_override",
  "20260427172553_slow_nightmare",
  "20260428004200_add_session_path",
  "20260501142318_next_venus",
  "20260504145000_add_sync_owner",
  "20260507164347_add_workspace_time",
  "20260510033149_session_usage",
  "20260511000411_data_migration_state",
  "20260511173437_session-metadata",
  "20260601010001_normalize_storage_paths",
  "20260601202201_amazing_prowler",
  "20260602002951_lowly_union_jack",
  "20260602182828_add_project_directories",
  "20260603001617_session_message_projection_indexes",
  "20260603040000_session_message_projection_order",
  "20260603141458_session_input_inbox",
  "20260603160727_jittery_ezekiel_stane",
  "20260604172448_event_sourced_session_input",
  "20260605003541_add_session_context_snapshot",
  "20260605042240_add_context_epoch_agent",
  "20260611035744_credential",
  "20260611192811_lush_chimera",
  "20260612174303_project_dir_strategy",
  "20260622142730_simplify_session_context_epoch",
  "20260622170816_reset_v2_session_state",
  "20260622202450_simplify_session_input",
  "20260804233008_loose_psylocke",
  "20260805200742_import_legacy_credentials",
  "20260808023530_workspace_domain",
  "20260811161259_execution_claim_attempts",
  "20260812181746_session_inbox",
  "20260812213948_worktree",
  "20260819222447_session_viewed_state",
  "20260823191254_nullable_workspace_binding",
  "20260910120000_clear_v1_session_permission",
  "20260923013825_project_time_active",
]);

export function emptyPreflightCounts() {
  return {
    sessions: 0,
    messages: 0,
    pending: 0,
    inbox: 0,
    kv: 0,
    migrations: 0,
  };
}
export function deniedPreflightDecision(
  nonce,
  counts = emptyPreflightCounts(),
  reason = "native_startup_unverified",
) {
  return {
    version: 1,
    nonce,
    allowed: false,
    reason,
    counts,
    correlations: [],
  };
}
function rows(value, width, max) {
  preflightAssert(Array.isArray(value) && value.length <= max);
  for (const row of value)
    preflightAssert(Array.isArray(row) && row.length === width);
  return value;
}
function parseObject(text, max) {
  preflightAssert(typeof text === "string" && Buffer.byteLength(text) <= max);
  const value = JSON.parse(text);
  preflightAssert(
    value !== null && typeof value === "object" && !Array.isArray(value),
  );
  return value;
}
function rootMetadata(text) {
  const value = parseObject(text, PREFLIGHT_LIMITS.requestBytes);
  assertClosedObject(value, [
    "operationId",
    "originalRuntimeEpoch",
    "appSessionId",
    "workspaceId",
    "digest",
  ]);
  preflightAssert(
    [
      "operationId",
      "originalRuntimeEpoch",
      "appSessionId",
      "workspaceId",
    ].every((key) => isPreflightId(value[key])) &&
      isPreflightDigest(value.digest),
  );
  return value;
}
function completeTime(time) {
  return (
    time !== null &&
    typeof time === "object" &&
    Number.isFinite(time.created) &&
    Number.isFinite(time.completed) &&
    time.completed >= time.created
  );
}
const MESSAGE_TYPES = new Set([
  "agent-switched",
  "model-switched",
  "location-switched",
  "user",
  "synthetic",
  "system",
  "skill",
  "shell",
  "assistant",
  "compaction",
  "idle",
]);
function terminalMessage(value) {
  preflightAssert(
    value !== null &&
      typeof value === "object" &&
      MESSAGE_TYPES.has(value.type),
  );
  if (value.type === "assistant") {
    if (!completeTime(value.time) || Object.hasOwn(value, "retry"))
      return false;
    preflightAssert(Array.isArray(value.content));
    for (const part of value.content) {
      preflightAssert(part !== null && typeof part === "object");
      if (part.type === "tool") {
        if (
          !["completed", "error"].includes(part.state?.status) ||
          !completeTime(part.time)
        )
          return false;
      } else if (part.type === "reasoning") {
        if (part.time !== undefined && !completeTime(part.time)) return false;
      } else preflightAssert(part.type === "text");
    }
  } else if (value.type === "shell") {
    if (
      !["exited", "timeout", "killed"].includes(value.status) ||
      !completeTime(value.time)
    )
      return false;
  } else if (value.type === "compaction") {
    if (!["completed", "failed"].includes(value.status)) return false;
  }
  return true;
}
function validateLedger(snapshot) {
  preflightAssert(
    Array.isArray(snapshot.migrationIds) &&
      snapshot.migrationIds.length === PREFLIGHT_LIMITS.migrations,
  );
  const expected = new Set(snapshot.migrationIds);
  preflightAssert(
    expected.size === PREFLIGHT_LIMITS.migrations &&
      PINNED_MIGRATION_IDS.every((id) => expected.has(id)),
  );
  const ledger = rows(snapshot.migrations, 2, PREFLIGHT_LIMITS.migrations);
  preflightAssert(ledger.length === expected.size);
  const seen = new Set();
  for (const [id, completed] of ledger) {
    preflightAssert(
      expected.has(id) &&
        !seen.has(id) &&
        Number.isSafeInteger(completed) &&
        completed > 0,
    );
    seen.add(id);
  }
  preflightAssert(snapshot.legacyStatus?.status === "completed");
}
function validateSessions(request, rawRows) {
  const mappings = new Map(
    request.mappings.map((mapping) => [mapping.nativeSessionId, mapping]),
  );
  const sessions = new Map();
  for (const raw of rows(rawRows, 11, PREFLIGHT_LIMITS.sessions)) {
    const [
      id,
      parent,
      suspended,
      compacting,
      attempts,
      directory,
      subpath,
      workspace,
      fork,
      boundary,
      metadata,
    ] = raw;
    preflightAssert(isPreflightId(id) && !sessions.has(id) && mappings.has(id));
    preflightAssert(
      parent === null &&
        suspended === null &&
        compacting === null &&
        attempts === 0,
    );
    const mapping = mappings.get(id);
    preflightAssert(
      isPreflightPath(directory) && directory === mapping.canonicalPath,
    );
    // Native path is a relative subpath, not the workspace's canonical directory.
    preflightAssert(
      subpath === null ||
        (typeof subpath === "string" &&
          !subpath.includes("\0") &&
          Buffer.byteLength(subpath) <= PREFLIGHT_LIMITS.pathBytes &&
          !isAbsolute(subpath) &&
          !subpath.split(/[\\/]/).includes("..")),
    );
    preflightAssert(workspace === null || isPreflightId(workspace));
    const meta = rootMetadata(metadata);
    let forkBoundary = null;
    if (fork === null) {
      preflightAssert(
        boundary === null &&
          !Object.hasOwn(mapping, "parentAppSessionId") &&
          meta.appSessionId === mapping.appSessionId &&
          meta.workspaceId === mapping.workspaceId,
      );
    } else {
      preflightAssert(
        isPreflightId(fork) && Object.hasOwn(mapping, "parentAppSessionId"),
      );
      forkBoundary = parseObject(boundary, 1024);
      assertClosedObject(forkBoundary, ["type", "messageID"]);
      preflightAssert(
        ["before", "through"].includes(forkBoundary.type) &&
          isPreflightId(forkBoundary.messageID) &&
          forkBoundary.messageID.startsWith("msg_"),
      );
    }
    sessions.set(id, {
      mapping,
      metadata: meta,
      workspace,
      fork,
      boundary: forkBoundary,
    });
  }
  preflightAssert(sessions.size === mappings.size);
  return sessions;
}

// decodeMessage is supplied by the reader's official Schema.toEncoded(Info) decoder.
// Unit tests use an explicit synthetic decoder and do not claim Native schema execution.
export function evaluatePreflightSnapshot(request, snapshot, decodeMessage) {
  const counts = emptyPreflightCounts();
  const reason = "native_startup_unverified";
  try {
    validatePreflightRequest(request);
    const bounds = {
      sessions: 201,
      messages: 10001,
      pending: 1,
      inbox: 1,
      kv: 1,
      migrations: 49,
    };
    for (const [key, max] of Object.entries(bounds)) {
      preflightAssert(Array.isArray(snapshot[key]));
      counts[key] = Math.min(snapshot[key].length, max);
    }
    rows(snapshot.pending, 1, 1);
    rows(snapshot.inbox, 1, 1);
    rows(snapshot.kv, 1, 1);
    if (counts.pending || counts.inbox)
      return deniedPreflightDecision(request.nonce, counts, "pending_inbox");
    preflightAssert(counts.kv === 0);
    validateLedger(snapshot);
    const sessions = validateSessions(request, snapshot.sessions);
    preflightAssert(typeof decodeMessage === "function");
    const messageIds = new Map(
      [...sessions.keys()].map((id) => [id, new Set()]),
    );
    let bytes = 0;
    for (const [id, sessionId, type, data] of rows(
      snapshot.messages,
      4,
      PREFLIGHT_LIMITS.messages,
    )) {
      preflightAssert(
        isPreflightId(id) &&
          id.startsWith("msg_") &&
          sessions.has(sessionId) &&
          MESSAGE_TYPES.has(type),
      );
      const ids = messageIds.get(sessionId);
      preflightAssert(!ids.has(id));
      ids.add(id);
      preflightAssert(typeof data === "string");
      const size = Buffer.byteLength(data);
      bytes += size;
      preflightAssert(
        size <= PREFLIGHT_LIMITS.messageBytes &&
          bytes <= PREFLIGHT_LIMITS.messageTotalBytes,
      );
      const parsed = parseObject(data, PREFLIGHT_LIMITS.messageBytes);
      const message = decodeMessage({ ...parsed, id, type });
      preflightAssert(message?.id === id && message?.type === type);
      if (!terminalMessage(message))
        return deniedPreflightDecision(request.nonce, counts, "pending_inbox");
    }
    const visiting = new Set();
    const visited = new Set();
    function lineage(id) {
      if (visited.has(id)) return;
      preflightAssert(!visiting.has(id));
      visiting.add(id);
      const session = sessions.get(id);
      if (session.fork !== null) {
        const parent = sessions.get(session.fork);
        preflightAssert(
          parent !== undefined &&
            parent.mapping.appSessionId ===
              session.mapping.parentAppSessionId &&
            parent.mapping.workspaceId === session.mapping.workspaceId &&
            parent.workspace === session.workspace,
        );
        preflightAssert(
          messageIds.get(session.fork).has(session.boundary.messageID),
        );
        lineage(session.fork);
        preflightAssert(isDeepStrictEqual(session.metadata, parent.metadata));
      }
      visiting.delete(id);
      visited.add(id);
    }
    for (const id of sessions.keys()) lineage(id);
    const correlations = [...sessions.entries()]
      .filter(([, session]) => session.fork === null)
      .map(([nativeSessionId, { mapping, metadata }]) => ({
        nativeSessionId,
        appSessionId: mapping.appSessionId,
        workspaceId: mapping.workspaceId,
        runtimeEpoch: metadata.originalRuntimeEpoch,
        operationId: metadata.operationId,
        digest: metadata.digest,
      }));
    const decision = {
      version: 1,
      nonce: request.nonce,
      allowed: true,
      reason: null,
      counts,
      correlations,
    };
    return validatePreflightDecision(decision, request.nonce);
  } catch {
    return deniedPreflightDecision(request.nonce, counts, reason);
  }
}
