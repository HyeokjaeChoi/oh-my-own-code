// Child-process transient metadata only. The graph owns this factory instance.
// arm() is reached only from authenticated private Main delivery AFTER durable
// original intent. This store itself proves neither journal flush nor execution
// permission. Native final entry must supply its actual detached body/target.
import { types } from "node:util";
import { performance } from "node:perf_hooks";
import { record, identifier } from "./native-permission-control-input.mjs";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import { validateTaskHandoffIdentity } from "./host/workbench-task-storage.mjs";

const fields = [
  "handoffId",
  "taskScopeId",
  "originalKey",
  "originalDigest",
  "step",
  "stageArgumentDigest",
  "targetIdentity",
  "currentLaunchIdentity",
  "expiresAt",
];
const targets = [
  "workspaceId",
  "appSessionId",
  "nativeSessionId",
  "projectId",
  "locationId",
  "modeGeneration",
  "inventoryGeneration",
];
const reject = () => {
  throw new Error("native_permission_task_handoff_invalid");
};
const hash = (value) => {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value)) reject();
};
function detached(input) {
  try {
    const row = record(input, fields);
    const key = record(row.originalKey, ["runtimeEpoch", "operationId"]);
    const target = record(row.targetIdentity, targets);
    for (const value of [
      row.handoffId,
      row.taskScopeId,
      row.currentLaunchIdentity,
      key.runtimeEpoch,
      key.operationId,
      ...targets.slice(0, 5).map((name) => target[name]),
    ])
      identifier(value);
    for (const name of ["modeGeneration", "inventoryGeneration"])
      if (!Number.isSafeInteger(target[name]) || target[name] <= 0) reject();
    for (const value of [row.handoffId, row.taskScopeId])
      if (
        !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(
          value,
        )
      )
        reject();
    hash(row.originalDigest);
    validateTaskHandoffIdentity({
      handoffId: row.handoffId,
      step: row.step,
      stageArgumentDigest: row.stageArgumentDigest,
    });
    if (
      !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(
        target.locationId,
      )
    )
      reject();
    if (!Number.isSafeInteger(row.expiresAt) || row.expiresAt < 0) reject();
    const copy = {
      ...row,
      originalKey: Object.freeze(key),
      targetIdentity: Object.freeze(target),
    };
    if (Buffer.byteLength(permissionCanonicalJSON(copy), "utf8") > 16384)
      reject();
    return Object.freeze(copy);
  } catch {
    reject();
  }
}

export function createNativeTaskHandoffs(input) {
  // The injected clock is private to the graph factory/test. expiresAt belongs
  // to THIS child clock, obtained by private preparation. Main treats it as
  // opaque and separately bounds its own wait; process clocks are not shared.
  if (!input || typeof input !== "object" || types.isProxy(input)) reject();
  const options = record(
    input,
    Object.hasOwn(input, "now")
      ? ["runtimeEpoch", "launchIdentity", "now"]
      : ["runtimeEpoch", "launchIdentity"],
  );
  const { runtimeEpoch, launchIdentity } = options;
  identifier(runtimeEpoch);
  identifier(launchIdentity);
  const now = options.now ?? (() => Math.floor(performance.now()));
  if (typeof now !== "function") reject();
  const entries = new Map();
  let closed = false;
  let active = 0;
  let lastClock = 0;
  const clock = () => {
    const value = now();
    if (!Number.isSafeInteger(value) || value < lastClock) reject();
    lastClock = value;
    return value;
  };
  const open = () => {
    if (closed) reject();
  };
  const sameLaunch = (row) => {
    if (
      row.originalKey.runtimeEpoch !== runtimeEpoch ||
      row.currentLaunchIdentity !== launchIdentity
    )
      reject();
  };
  const retire = (entry, state) => {
    if (entry.state === "armed") active--;
    entry.state = state;
  };
  const expire = (time) => {
    for (const entry of entries.values())
      if (entry.state === "armed" && time >= entry.row.expiresAt)
        retire(entry, "expired");
  };
  const arm = (input) => {
    open();
    const row = detached(input);
    sameLaunch(row);
    const time = clock();
    open();
    // Expiry is never renewed. Remember retired IDs so repeated Main delivery
    // cannot restore an already consumed, expired or revoked handoff.
    expire(time);
    if (
      row.expiresAt <= time ||
      row.expiresAt - time > 5000 ||
      entries.has(row.handoffId) ||
      active >= 32 ||
      entries.size >= 8192
    )
      reject();
    entries.set(row.handoffId, {
      row,
      state: "armed",
      canonical: permissionCanonicalJSON(row),
    });
    active++;
  };
  const consume = (input) => {
    open();
    const row = detached(input);
    sameLaunch(row);
    const time = clock();
    open();
    expire(time);
    const entry = entries.get(row.handoffId);
    if (
      !entry ||
      entry.state !== "armed" ||
      entry.canonical !== permissionCanonicalJSON(row)
    )
      reject();
    retire(entry, "consumed");
    return entry.row;
  };
  const revoke = (id) => {
    open();
    identifier(id);
    const entry = entries.get(id);
    if (!entry || entry.state !== "armed") reject();
    retire(entry, "revoked");
  };
  const close = () => {
    if (closed) return;
    closed = true;
    for (const entry of entries.values())
      if (entry.state === "armed") retire(entry, "revoked");
  };
  return Object.freeze({ arm, consume, revoke, close });
}
