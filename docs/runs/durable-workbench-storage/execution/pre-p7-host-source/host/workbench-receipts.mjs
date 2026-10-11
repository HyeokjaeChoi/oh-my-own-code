import { ERRORS } from "../workbench-contract.mjs";
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const optionalId = (key, value) => (id(value) ? { [key]: value } : {});
// Deliberate allowlists: no raw errors, payloads, snapshots, paths, titles or digest.
export function redactReceipt(record) {
  const result = record.result;
  let projected;
  if (result) {
    switch (result.kind) {
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
