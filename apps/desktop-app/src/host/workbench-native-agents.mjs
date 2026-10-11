import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { fail } from "../workbench-contract.mjs";
// Main-only pure conversion and bounded read proof. No import-time IO.
import { parseAgentFile } from "../renderer/shared/configuration-draft/agent.mjs";
import { BASELINE_POLICY } from "../renderer/shared/configuration-draft/policy.mjs";
import {
  nativeAgentId,
  nativeAgentDigest,
  validateAgentRpcResult,
  validAgentProjection,
  validAgentOwner,
  NATIVE_AGENT_LIMITS,
} from "../native-agents-protocol.mjs";

export function parseAgentRuntimeRecord(text, owner) {
  if (!validAgentOwner(owner)) throw new Error("native_agent_invalid");
  const parsed = parseAgentFile(text);
  if (!parsed) return undefined;
  return {
    id: nativeAgentId(owner),
    name: owner.sourceName,
    system: parsed.system,
    ...(parsed.description !== undefined && {
      description: parsed.description,
    }),
    ...(parsed.color !== undefined && { color: parsed.color }),
    mode: "primary",
    hidden: false,
    request: { settings: {}, headers: {}, body: {} },
    permissions: BASELINE_POLICY.map((r) => ({ ...r })),
  };
}
const field = (v, key) => {
  const d = v && Object.getOwnPropertyDescriptor(v, key);
  if (!d || !Object.hasOwn(d, "value"))
    throw new Error("native_agent_references_unverified");
  return d.value;
};
const safe = (v, max) =>
  typeof v === "string" &&
  v.length > 0 &&
  v.length <= max &&
  v.isWellFormed() &&
  ![...v].some(
    (c) =>
      c.charCodeAt(0) < 32 ||
      (c.charCodeAt(0) >= 127 && c.charCodeAt(0) <= 159),
  );
export async function readNativeAgentSessions(
  client,
  { check = () => {}, timeoutMs = 5000, signal } = {},
) {
  const refused = () => {
    throw new Error("native_agent_references_unverified");
  };
  if (
    typeof client?.session?.list !== "function" ||
    typeof check !== "function" ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    refused();
  const deadline = Date.now() + timeoutMs,
    ids = new Set(),
    cursors = new Set(),
    rows = [];
  let cursor;
  try {
    for (let page = 0; page < NATIVE_AGENT_LIMITS.referencePages; page++) {
      await check();
      const remaining = deadline - Date.now();
      if (remaining <= 0 || signal?.aborted) refused();
      const timeout = AbortSignal.timeout(remaining);
      const response = await client.session.list(
        {
          limit: NATIVE_AGENT_LIMITS.referencePageSize,
          ...(cursor === undefined ? { order: "asc" } : { cursor }),
        },
        { signal: signal ? AbortSignal.any([signal, timeout]) : timeout },
      );
      await check();
      if (Date.now() > deadline || signal?.aborted) refused();
      const data = field(response, "data"),
        paging = field(response, "cursor");
      if (
        !Array.isArray(data) ||
        data.length > NATIVE_AGENT_LIMITS.referencePageSize ||
        Reflect.ownKeys(data).length !== data.length + 1 ||
        !paging ||
        Object.getPrototypeOf(paging) !== Object.prototype ||
        Reflect.ownKeys(paging).some((k) => !["next", "previous"].includes(k))
      )
        refused();
      for (let index = 0; index < data.length; index++) {
        const row = field(data, String(index)),
          id = field(row, "id");
        if (!safe(id, 256) || ids.has(id)) refused();
        let agent;
        if (Object.hasOwn(row, "agent")) {
          agent = field(row, "agent");
          if (agent !== undefined && !safe(agent, 512)) refused();
        }
        ids.add(id);
        rows.push(Object.freeze({ id, ...(agent !== undefined && { agent }) }));
      }
      for (const key of Reflect.ownKeys(paging)) {
        const value = field(paging, key);
        if (value !== null && value !== undefined && !safe(value, 8192))
          refused();
      }
      const next = Object.hasOwn(paging, "next")
        ? field(paging, "next")
        : undefined;
      if (next === undefined || next === null) return Object.freeze(rows);
      if (cursors.has(next)) refused();
      cursors.add(next);
      cursor = next;
    }
  } catch (error) {
    if (error?.appCode) throw error;
    refused();
  }
  refused();
}

// Public projection never exposes foreign prompts or treats ID prefixes as ownership.
export function projectNativeAgentRows(observed, publicList, sessions, scope) {
  try {
    validateAgentRpcResult("observe", observed);
  } catch {
    fail("AGENT_UNVERIFIED");
  }
  if (observed.status !== "ready")
    return { status: "unavailable", reason: observed.reason };
  if (
    observed.workspaceId !== scope.workspaceId ||
    observed.workspacePath !== scope.workspacePath ||
    publicList?.location?.directory !== scope.workspacePath ||
    !Array.isArray(publicList.data) ||
    publicList.data.length > NATIVE_AGENT_LIMITS.native ||
    Reflect.ownKeys(publicList.data).length !== publicList.data.length + 1 ||
    !Array.isArray(sessions)
  )
    fail("AGENT_UNVERIFIED");
  const native = [];
  for (let index = 0; index < publicList.data.length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(
      publicList.data,
      String(index),
    );
    if (!descriptor || !Object.hasOwn(descriptor, "value"))
      fail("AGENT_UNVERIFIED");
    const row = descriptor.value;
    const projection = Object.fromEntries(
      ["id", "name", "mode", "hidden"].map((key) => {
        const d = row && Object.getOwnPropertyDescriptor(row, key);
        if (!d || !Object.hasOwn(d, "value")) fail("AGENT_UNVERIFIED");
        return [key, d.value];
      }),
    );
    if (!validAgentProjection(projection)) fail("AGENT_UNVERIFIED");
    native.push(projection);
  }
  if (!isDeepStrictEqual(native, observed.native)) fail("AGENT_UNVERIFIED");
  const owned = observed.rows.map(({ owner, record, recordDigest }) => {
    if (
      owner.runtimeEpoch !== scope.runtimeEpoch ||
      owner.workspaceId !== scope.workspaceId ||
      owner.workspacePath !== scope.workspacePath ||
      recordDigest !== nativeAgentDigest(record) ||
      !isDeepStrictEqual(
        publicList.data.find((r) => r.id === record.id),
        record,
      )
    )
      fail("AGENT_UNVERIFIED");
    return {
      ...agentRuntimeIdentity({
        sourceName: owner.sourceName,
        nativeId: record.id,
        digest: owner.digest,
        nativeDigest: recordDigest,
        registrationRuntimeEpoch: owner.runtimeEpoch,
        registrationOperationId: owner.operationId,
      }),
      name: record.name,
      system: record.system,
      systemDigest: agentRuntimeDigest(record.system),
      path: `${owner.workspacePath}/.opencode/agents/${owner.sourceName}.md`,
      mode: record.mode,
      hidden: record.hidden,
      permissions: globalThis.structuredClone(record.permissions),
      referenceCount: sessions.filter((r) => r.agent === record.id).length,
      ...(record.description !== undefined && {
        description: record.description,
      }),
      ...(record.color !== undefined && { color: record.color }),
    };
  });
  return {
    status: "observed",
    defaultAgentId: observed.defaultAgentId,
    owned,
    unowned: native
      .filter((r) => !owned.some((o) => o.nativeId === r.id))
      .map(({ id, ...rest }) => ({ nativeId: id, ...rest })),
  };
}
export const agentRuntimeDigest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
export const agentRuntimeIdentity = (row) =>
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
export const agentRuntimeDispatchProof = (row) => ({
  ...agentRuntimeIdentity(row),
  systemDigest: row.systemDigest,
});
