import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";
import { validWireId, ERRORS } from "../workbench-contract.mjs";

export const STORAGE_LIMITS = Object.freeze({
  recordBytes: 4 * 1024 * 1024,
  operations: 2048,
  workspaces: 100,
  sessions: 200,
});
export const STORE_RECOVERY_REASONS = Object.freeze([
  "owner_conflict",
  "owner_unverified",
  "corrupt_journal",
  "unsupported_version",
  "identity_conflict",
  "unconfirmed_tail",
  "writer_poisoned",
  "pending_inbox",
  "native_startup_unverified",
  "storage_denied",
  "retained_limit",
]);
export const RESOURCE_RECOVERY_REASONS = Object.freeze([
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation",
]);
const mutations = new Set([
  "configuration.save",
  "session.rename",
  "session.pin",
  "session.archive",
  "session.fork",
  "session.remove",
  "workspace.import",
  "workspace.create",
  "workspace.remove",
  "session.create",
  "message.send",
  "session.interrupt",
  "permission.respond",
  "command.run",
]);
export const DISPATCH_STEPS = Object.freeze([
  "filesystem.configuration.stage",
  "filesystem.configuration.publish",
  "native.create",
  "native.fork",
  "native.remove",
  "native.rename",
  "native.pin",
  "native.archive",
  "native.metadata",
  "native.send",
  "native.command",
  "native.interrupt",
  "native.permission",
  "native.policy",
  "native.policy.before_selection",
  "native.policy.after_selection",
  "native.agent",
  "native.model",
  "registry.metadata",
  "registry.unregister",
  "filesystem.managed_base",
  "filesystem.managed_folder",
]);
const zeroHash = "0".repeat(64);
const clone = (value) => JSON.parse(JSON.stringify(value));
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function storageError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}
function need(condition, code = "invalid_record") {
  if (!condition) throw storageError(code);
}
function closed(value, required, optional = []) {
  need(
    value !== null &&
      typeof value === "object" &&
      Object.getPrototypeOf(value) === Object.prototype,
  );
  need(
    required.every((key) => Object.hasOwn(value, key)) &&
      Object.keys(value).every((key) =>
        [...required, ...optional].includes(key),
      ),
  );
}
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value) => validWireId(value);
const resourceId = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
const displayText = (value) =>
  ![...value].some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  );
const path = (value) =>
  typeof value === "string" &&
  value.length <= 4096 &&
  !value.includes("\0") &&
  isAbsolute(value) &&
  resolve(value) === value;
function optionalIds(value, names) {
  for (const name of names)
    if (Object.hasOwn(value, name)) need(resourceId(value[name]));
}
export function validateStorageIdentity(value) {
  closed(
    value,
    ["runtimeEpoch", "operationId", "type", "digest"],
    ["workspaceId", "sessionId"],
  );
  need(
    id(value.runtimeEpoch) &&
      id(value.operationId) &&
      mutations.has(value.type) &&
      digest(value.digest),
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  return clone(value);
}
export function validateStorageReceipt(value) {
  closed(
    value,
    [
      "runtimeEpoch",
      "operationId",
      "type",
      "admission",
      "delivery",
      "effect",
      "revision",
      "evidence",
    ],
    ["workspaceId", "sessionId", "result"],
  );
  need(
    id(value.runtimeEpoch) &&
      id(value.operationId) &&
      mutations.has(value.type) &&
      integer(value.revision),
  );
  optionalIds(value, ["workspaceId", "sessionId"]);
  need(!value.sessionId || value.workspaceId);
  need(["admitted", "dispatched", "rejected"].includes(value.admission));
  need(
    ["pending", "accepted", "unknown"].includes(value.delivery) &&
      ["none", "pending", "confirmed", "unknown"].includes(value.effect),
  );
  need(Array.isArray(value.evidence) && value.evidence.length <= 8);
  for (const entry of value.evidence) {
    closed(entry, ["kind"], ["id"]);
    need(resourceId(entry.kind));
    optionalIds(entry, ["id"]);
  }
  if (Object.hasOwn(value, "result")) {
    const result = value.result;
    need(result !== null && typeof result === "object");
    const shapes = {
      created: [
        ["kind", "workspaceId"],
        ["sessionId", "nativeSessionId"],
      ],
      forked: [["kind", "workspaceId", "sessionId", "nativeSessionId"], []],
      removed: [
        ["kind", "workspaceId", "workspaceRemoved"],
        ["removedSessionIds"],
      ],
      metadata: [["kind", "workspaceId", "sessionId"], []],
      configuration_saved: [
        ["kind", "workspaceId", "configurationKind", "version"],
        ["backupId"],
      ],
      delivery: [
        ["kind", "status"],
        ["nativeInboxId", "nativeRequestId"],
      ],
      rejected: [["kind", "code"], []],
    };
    need(Object.hasOwn(shapes, result.kind));
    closed(result, ...shapes[result.kind]);
    optionalIds(result, [
      "workspaceId",
      "sessionId",
      "nativeSessionId",
      "nativeInboxId",
      "nativeRequestId",
    ]);
    if (result.kind === "configuration_saved")
      need(
        value.type === "configuration.save" &&
          value.workspaceId === result.workspaceId &&
          value.effect === "confirmed" &&
          ["instructions", "mcp"].includes(result.configurationKind) &&
          digest(result.version) &&
          (result.backupId === undefined ||
            (typeof result.backupId === "string" &&
              new RegExp(
                `^\\.omoc-configuration-[a-f0-9]{64}\\.${result.configurationKind}\\.backup$`,
              ).test(result.backupId))),
      );
    if (result.kind === "removed") {
      need(typeof result.workspaceRemoved === "boolean");
      if (Object.hasOwn(result, "removedSessionIds"))
        need(
          Array.isArray(result.removedSessionIds) &&
            result.removedSessionIds.length <= 200 &&
            result.removedSessionIds.every(resourceId) &&
            new Set(result.removedSessionIds).size ===
              result.removedSessionIds.length,
        );
    }
    if (result.kind === "delivery")
      need(["accepted", "stopping", "decided"].includes(result.status));
    if (result.kind === "rejected") need(Object.hasOwn(ERRORS, result.code));
  }
  return clone(value);
}
export function validateRegistryDelta(value) {
  closed(value, ["workspaces", "sessions", "tombstones"]);
  need(
    Array.isArray(value.workspaces) &&
      value.workspaces.length <= 100 &&
      Array.isArray(value.sessions) &&
      value.sessions.length <= 200 &&
      Array.isArray(value.tombstones) &&
      value.tombstones.length <= 300,
  );
  for (const workspace of value.workspaces) {
    closed(
      workspace,
      ["workspaceId", "ownership", "canonicalPath", "registrationState"],
      ["folderSessionId", "name", "trustRevision", "storageGeneration"],
    );
    need(
      resourceId(workspace.workspaceId) &&
        ["managed", "imported", "legacy"].includes(workspace.ownership) &&
        path(workspace.canonicalPath) &&
        ["reserved", "registered", "unavailable"].includes(
          workspace.registrationState,
        ),
    );
    optionalIds(workspace, ["folderSessionId"]);
    if (workspace.ownership === "managed")
      need(
        typeof workspace.folderSessionId === "string" &&
          /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            workspace.folderSessionId,
          ),
      );
    if (workspace.name !== undefined)
      need(
        typeof workspace.name === "string" &&
          workspace.name.length <= 256 &&
          displayText(workspace.name),
      );
    for (const key of ["trustRevision", "storageGeneration"])
      if (workspace[key] !== undefined) need(integer(workspace[key]));
  }
  for (const session of value.sessions) {
    closed(
      session,
      ["appSessionId", "workspaceId", "lifecycleState", "pinned", "archived"],
      [
        "nativeSessionId",
        "parentSessionId",
        "title",
        "lastViewedAt",
        "recoveryReason",
      ],
    );
    need(
      resourceId(session.appSessionId) &&
        resourceId(session.workspaceId) &&
        ["reserved", "active", "unavailable"].includes(
          session.lifecycleState,
        ) &&
        typeof session.pinned === "boolean" &&
        typeof session.archived === "boolean",
    );
    optionalIds(session, ["nativeSessionId", "parentSessionId"]);
    if (session.title !== undefined)
      need(
        typeof session.title === "string" &&
          session.title.length <= 256 &&
          displayText(session.title),
      );
    if (session.lastViewedAt !== undefined) need(integer(session.lastViewedAt));
    if (session.recoveryReason !== undefined)
      need(
        session.lifecycleState === "unavailable" &&
          RESOURCE_RECOVERY_REASONS.includes(session.recoveryReason),
      );
  }
  for (const entry of value.tombstones) {
    closed(entry, ["kind", "id"]);
    need(["workspace", "session"].includes(entry.kind) && resourceId(entry.id));
  }
  for (const [entries, key] of [
    [value.workspaces, "workspaceId"],
    [value.sessions, "appSessionId"],
  ])
    need(
      new Set(entries.map((entry) => entry[key])).size === entries.length,
      "identity_conflict",
    );
  need(
    new Set(
      value.tombstones.map((entry) => JSON.stringify([entry.kind, entry.id])),
    ).size === value.tombstones.length,
    "identity_conflict",
  );
  return clone(value);
}
export function validateJournalPayload(value) {
  const common = ["kind", "revision"];
  need(
    value &&
      typeof value.kind === "string" &&
      integer(value.revision) &&
      value.revision > 0,
  );
  switch (value.kind) {
    case "feature_gate":
      closed(value, [...common, "feature"]);
      need(value.feature === "configuration_save_v1", "unsupported_version");
      break;
    case "admission":
      closed(value, [...common, "identity"], ["rejectionCode"]);
      validateStorageIdentity(value.identity);
      if (value.rejectionCode !== undefined)
        need(Object.hasOwn(ERRORS, value.rejectionCode));
      break;
    case "reservation":
      closed(
        value,
        [...common, "runtimeEpoch", "operationId", "workspace", "appSessionId"],
        ["plannedNativeSessionId"],
      );
      need(
        id(value.runtimeEpoch) &&
          id(value.operationId) &&
          resourceId(value.appSessionId),
      );
      optionalIds(value, ["plannedNativeSessionId"]);
      validateRegistryDelta({
        workspaces: [value.workspace],
        sessions: [],
        tombstones: [],
      });
      need(value.workspace.registrationState === "reserved");
      break;
    case "dispatch":
      closed(
        value,
        [...common, "runtimeEpoch", "operationId", "step"],
        ["nativeSessionId"],
      );
      need(
        id(value.runtimeEpoch) &&
          id(value.operationId) &&
          DISPATCH_STEPS.includes(value.step),
      );
      optionalIds(value, ["nativeSessionId"]);
      break;
    case "completion":
      closed(value, [
        ...common,
        "runtimeEpoch",
        "operationId",
        "receipt",
        "delta",
      ]);
      need(id(value.runtimeEpoch) && id(value.operationId));
      validateStorageReceipt(value.receipt);
      validateRegistryDelta(value.delta);
      need(
        value.receipt.runtimeEpoch === value.runtimeEpoch &&
          value.receipt.operationId === value.operationId &&
          value.receipt.revision === value.revision,
      );
      break;
    case "owner_intent":
      closed(value, [...common, "ownerNonce", "phase"], ["childId"]);
      need(
        id(value.ownerNonce) &&
          ["startup", "child_started", "shutdown"].includes(value.phase),
      );
      optionalIds(value, ["childId"]);
      break;
    case "migration_phase":
      closed(value, [
        ...common,
        "migrationId",
        "sourceStoreId",
        "destinationStoreId",
        "phase",
        "inventoryHash",
      ]);
      need(
        id(value.migrationId) &&
          id(value.sourceStoreId) &&
          id(value.destinationStoreId) &&
          value.sourceStoreId !== value.destinationStoreId &&
          [
            "retained",
            "quiesced",
            "copied",
            "verified",
            "cutover",
            "rollback",
          ].includes(value.phase) &&
          digest(value.inventoryHash),
      );
      break;
    case "recovery_decision":
      closed(value, [...common, "action", "throughSequence", "throughHash"]);
      need(
        value.action === "adopt_validated_tail" &&
          integer(value.throughSequence) &&
          digest(value.throughHash),
      );
      break;
    default:
      throw storageError("unsupported_version");
  }
  return clone(value);
}
const operationKey = (value) =>
  JSON.stringify([value.runtimeEpoch, value.operationId]);
function historyValidator() {
  const operations = new Map();
  const migrations = new Map();
  const features = new Set();
  let revision = 0;
  return (payload) => {
    need(payload.revision === revision + 1, "identity_conflict");
    const key = operationKey(payload.identity ?? payload);
    const prior = operations.get(key);
    if (payload.kind === "feature_gate") {
      need(!features.has(payload.feature), "identity_conflict");
      features.add(payload.feature);
    } else if (payload.kind === "admission") {
      need(
        payload.identity.type !== "configuration.save" ||
          features.has("configuration_save_v1"),
        "unsupported_version",
      );
      need(!prior, "identity_conflict");
      need(operations.size < STORAGE_LIMITS.operations, "retained_limit");
      operations.set(key, {
        identity: payload.identity,
        terminal: !!payload.rejectionCode,
        reserved: false,
        steps: new Set(),
      });
    } else if (
      ["reservation", "dispatch", "completion"].includes(payload.kind)
    ) {
      need(prior && !prior.terminal, "identity_conflict");
      if (payload.kind === "reservation") {
        need(!prior.reserved, "identity_conflict");
        prior.reserved = true;
      }
      if (payload.kind === "dispatch") {
        need(
          (prior.identity.type === "configuration.save") ===
            payload.step.startsWith("filesystem.configuration."),
          "identity_conflict",
        );
        if (payload.step === "filesystem.configuration.publish")
          need(
            prior.steps.has("filesystem.configuration.stage"),
            "identity_conflict",
          );
        need(!prior.steps.has(payload.step), "identity_conflict");
        prior.steps.add(payload.step);
      }
      if (payload.kind === "completion") {
        for (const field of [
          "runtimeEpoch",
          "operationId",
          "type",
          "workspaceId",
          "sessionId",
        ])
          need(
            payload.receipt[field] === prior.identity[field],
            "identity_conflict",
          );
        need(
          payload.receipt.effect !== "confirmed" || prior.steps.size > 0,
          "identity_conflict",
        );
        need(
          payload.receipt.effect !== "none" || prior.steps.size === 0,
          "identity_conflict",
        );
        need(
          payload.receipt.admission !== "rejected" ||
            payload.receipt.effect === "none",
          "identity_conflict",
        );
        if (
          prior.identity.type === "configuration.save" &&
          payload.receipt.effect === "confirmed"
        )
          need(
            prior.steps.has("filesystem.configuration.stage") &&
              prior.steps.has("filesystem.configuration.publish") &&
              payload.receipt.result?.kind === "configuration_saved" &&
              payload.delta.workspaces.length === 0 &&
              payload.delta.sessions.length === 0 &&
              payload.delta.tombstones.length === 0,
            "identity_conflict",
          );
        prior.terminal =
          payload.receipt.effect === "confirmed" ||
          payload.receipt.admission === "rejected";
      }
    } else if (payload.kind === "migration_phase") {
      const priorMigration = migrations.get(payload.migrationId);
      if (priorMigration)
        need(
          priorMigration.sourceStoreId === payload.sourceStoreId &&
            priorMigration.destinationStoreId === payload.destinationStoreId &&
            priorMigration.phase !== "rollback",
          "identity_conflict",
        );
      const transitions = {
        retained: ["quiesced", "rollback"],
        quiesced: ["copied", "rollback"],
        copied: ["verified", "rollback"],
        verified: ["cutover", "rollback"],
        cutover: ["rollback"],
      };
      need(
        priorMigration
          ? transitions[priorMigration.phase]?.includes(payload.phase)
          : payload.phase === "retained",
        "identity_conflict",
      );
      migrations.set(payload.migrationId, payload);
    }
    revision = payload.revision;
  };
}

// The caller must acquire the exclusive store owner before invoking this API.
// io overrides are per-instance test dependencies, never process-wide fault hooks.
export async function openStorageJournal({
  directory,
  storeId,
  io = {},
  recoveryReason,
} = {}) {
  need(path(directory) && id(storeId));
  if (recoveryReason !== undefined)
    need(STORE_RECOVERY_REASONS.includes(recoveryReason));
  const adapter = {
    write: (file, bytes) => file.writeFile(bytes),
    syncFile: (file) => file.sync(),
    syncDirectory: async (directory) => {
      const handle = await fs.open(directory, constants.O_RDONLY);
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
    },
    rename: fs.rename,
    unlink: fs.unlink,
    ...io,
  };
  const filename = join(directory, "journal.jsonl");
  const current = join(directory, "checkpoint.json");
  const previous = join(directory, "checkpoint.previous.json");
  const pending = join(directory, "checkpoint.pending.json");
  const temp = join(directory, "checkpoint.tmp.json");
  let handle;
  let reason = recoveryReason;
  let closedWriter = false;
  let queue = Promise.resolve();
  let records = [];
  let committed = [];
  let checkpointGeneration = 0;
  let checkpointValue;
  let lastHash = zeroHash;
  let uncertainCheckpoint = false;
  try {
    const stat = await fs.lstat(directory);
    need(stat.isDirectory() && !stat.isSymbolicLink(), "storage_denied");
    need((await fs.realpath(directory)) === directory, "storage_denied");
    for (const entry of [filename, current, previous, pending, temp]) {
      try {
        const stat = await fs.lstat(entry);
        need(
          stat.isFile() && !stat.isSymbolicLink() && stat.nlink === 1,
          "storage_denied",
        );
      } catch (error) {
        if (error.code !== "ENOENT") throw error;
      }
    }
    let bytes;
    try {
      bytes = await fs.readFile(filename);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      bytes = Buffer.alloc(0);
    }
    const validateHistory = historyValidator();
    let offset = 0;
    while (offset < bytes.length) {
      const end = bytes.indexOf(10, offset);
      try {
        need(
          end !== -1 && end - offset + 1 <= STORAGE_LIMITS.recordBytes,
          "corrupt_journal",
        );
        const line = bytes.subarray(offset, end);
        const decoded = line.toString("utf8");
        need(Buffer.from(decoded).equals(line), "corrupt_journal");
        const record = JSON.parse(decoded);
        closed(record, [
          "schemaVersion",
          "storeId",
          "sequence",
          "previousHash",
          "payload",
          "checksum",
        ]);
        need(record.schemaVersion === 1, "unsupported_version");
        need(
          record.storeId === storeId &&
            record.sequence === records.length + 1 &&
            record.previousHash === lastHash,
          "identity_conflict",
        );
        const { checksum, ...body } = record;
        need(digest(checksum) && hash(body) === checksum, "corrupt_journal");
        validateJournalPayload(record.payload);
        if (record.payload.kind === "recovery_decision")
          need(
            record.payload.throughSequence === records.length &&
              record.payload.throughHash === lastHash,
            "identity_conflict",
          );
        validateHistory(record.payload);
        records.push(record);
        lastHash = checksum;
        offset = end + 1;
      } catch (error) {
        reason = [
          "unsupported_version",
          "identity_conflict",
          "retained_limit",
        ].includes(error.code)
          ? error.code
          : "corrupt_journal";
        break;
      }
    }
    let ceiling = Infinity;
    try {
      const marker = JSON.parse(await fs.readFile(pending, "utf8"));
      closed(marker, ["schemaVersion", "storeId", "baseGeneration"]);
      need(
        marker.schemaVersion === 1 &&
          marker.storeId === storeId &&
          integer(marker.baseGeneration),
      );
      ceiling = marker.baseGeneration;
      uncertainCheckpoint = true;
    } catch (error) {
      if (error.code !== "ENOENT") {
        ceiling = 0;
        uncertainCheckpoint = true;
        reason ??= "corrupt_journal";
      }
    }
    const checkpoints = [];
    for (const entry of [current, previous]) {
      try {
        const candidate = JSON.parse(await fs.readFile(entry, "utf8"));
        closed(candidate, [
          "schemaVersion",
          "storeId",
          "generation",
          "sequence",
          "hash",
          "checksum",
        ]);
        need(candidate.schemaVersion === 1, "unsupported_version");
        const { checksum, ...body } = candidate;
        need(
          candidate.storeId === storeId &&
            integer(candidate.generation) &&
            candidate.generation > 0 &&
            integer(candidate.sequence) &&
            candidate.sequence <= records.length &&
            candidate.hash ===
              (candidate.sequence
                ? records[candidate.sequence - 1].checksum
                : zeroHash) &&
            checksum === hash(body),
          "corrupt_journal",
        );
        if (candidate.generation <= ceiling) checkpoints.push(candidate);
      } catch (error) {
        if (error.code !== "ENOENT")
          reason ??=
            error.code === "unsupported_version"
              ? "unsupported_version"
              : "corrupt_journal";
      }
    }
    checkpoints.sort((a, b) => b.generation - a.generation);
    checkpointValue = checkpoints[0];
    checkpointGeneration = checkpointValue?.generation ?? 0;
    committed = records.slice(0, checkpointValue?.sequence ?? 0);
    if (records.length > committed.length || uncertainCheckpoint)
      reason ??= "unconfirmed_tail";
    if (!reason) {
      handle = await fs.open(
        filename,
        constants.O_CREAT |
          constants.O_APPEND |
          constants.O_WRONLY |
          constants.O_NOFOLLOW,
        0o600,
      );
      await adapter.syncFile(handle, "open");
      await adapter.syncDirectory(directory, "open");
    }
  } catch (error) {
    reason = error.code === "storage_denied" ? error.code : "storage_denied";
    if (handle) {
      await handle.close();
      handle = undefined;
    }
  }
  const status = () => ({
    state: reason ? "recovery_required" : "ready",
    ...(reason && { reason }),
    sequence: records.length,
    hash: lastHash,
    checkpointGeneration,
    checkpointSequence: checkpointValue?.sequence ?? 0,
    directoryFlush:
      "required; platform failures block writes; power-loss durability unverified",
    closed: closedWriter,
  });
  const assertWritable = () => {
    if (closedWriter) throw storageError("closed");
    if (reason) throw storageError(reason);
  };
  const serialized = (fn) => {
    const task = queue.then(fn);
    queue = task.catch(() => {});
    return task;
  };
  const poison = () => {
    reason = "writer_poisoned";
  };
  async function appendInternal(payload) {
    assertWritable();
    const validated = validateJournalPayload(payload);
    if (validated.kind === "recovery_decision")
      need(
        validated.throughSequence === records.length &&
          validated.throughHash === lastHash,
        "identity_conflict",
      );
    const validateHistory = historyValidator();
    for (const record of records) validateHistory(record.payload);
    validateHistory(validated);
    const body = {
      schemaVersion: 1,
      storeId,
      sequence: records.length + 1,
      previousHash: lastHash,
      payload: validated,
    };
    const record = { ...body, checksum: hash(body) };
    const bytes = Buffer.from(JSON.stringify(record) + "\n");
    need(bytes.length <= STORAGE_LIMITS.recordBytes);
    try {
      await adapter.write(handle, bytes, "append");
      await adapter.syncFile(handle, `append:${payload.kind}`);
      await adapter.syncDirectory(directory, "append");
    } catch {
      poison();
      throw storageError(reason);
    }
    records.push(record);
    lastHash = record.checksum;
    return clone(record);
  }
  async function writeFlushed(filename, value, context, exclusive = false) {
    const file = await fs.open(
      filename,
      constants.O_WRONLY |
        constants.O_CREAT |
        (exclusive ? constants.O_EXCL : constants.O_TRUNC) |
        constants.O_NOFOLLOW,
      0o600,
    );
    try {
      await adapter.write(
        file,
        Buffer.from(JSON.stringify(value) + "\n"),
        context,
      );
      await adapter.syncFile(file, context);
    } finally {
      await file.close();
    }
  }
  async function checkpointInternal() {
    assertWritable();
    const body = {
      schemaVersion: 1,
      storeId,
      generation: checkpointGeneration + 1,
      sequence: records.length,
      hash: lastHash,
    };
    const candidate = { ...body, checksum: hash(body) };
    try {
      // Persist the last established generation before any checkpoint replacement.
      // A failed checkpoint can never authorize its new generation on reopen.
      await writeFlushed(
        pending,
        { schemaVersion: 1, storeId, baseGeneration: checkpointGeneration },
        "checkpoint:pending",
        !uncertainCheckpoint,
      );
      await adapter.syncDirectory(directory, "checkpoint:pending");
      if (checkpointValue)
        await writeFlushed(previous, checkpointValue, "checkpoint:previous");
      await writeFlushed(temp, candidate, "checkpoint:file");
      await adapter.rename(temp, current);
      await adapter.syncDirectory(directory, "checkpoint:publish");
      // Last fallible step. Removal is intentionally not a power-loss durability claim:
      // a resurrected marker after power loss causes conservative recovery.
      await adapter.unlink(pending);
    } catch {
      poison();
      throw storageError(reason);
    }
    checkpointValue = candidate;
    checkpointGeneration = candidate.generation;
    committed = records.slice();
    uncertainCheckpoint = false;
    return clone(candidate);
  }
  return {
    status,
    readRecords: () =>
      clone({
        committed,
        uncertain: records.slice(committed.length),
        validated: records,
      }),
    append: (payload) => {
      const copy = validateJournalPayload(payload);
      return serialized(() => appendInternal(copy));
    },
    checkpoint: () => serialized(checkpointInternal),
    // Only a trusted local host recovery decision may adopt a complete validated tail.
    recover: (decision) =>
      serialized(async () => {
        closed(decision, [
          "action",
          "expectedSequence",
          "expectedHash",
          "ownerVerified",
          "preflightVerified",
        ]);
        need(
          decision.action === "adopt_validated_tail" &&
            decision.ownerVerified === true &&
            decision.preflightVerified === true &&
            decision.expectedSequence === records.length &&
            decision.expectedHash === lastHash,
          "recovery_denied",
        );
        need(
          reason === "unconfirmed_tail" && !uncertainCheckpoint,
          "recovery_denied",
        );
        reason = undefined;
        try {
          handle = await fs.open(
            filename,
            constants.O_APPEND | constants.O_WRONLY | constants.O_NOFOLLOW,
          );
          await appendInternal({
            kind: "recovery_decision",
            revision: (records.at(-1)?.payload.revision ?? 0) + 1,
            action: decision.action,
            throughSequence: decision.expectedSequence,
            throughHash: decision.expectedHash,
          });
          await checkpointInternal();
          return status();
        } catch {
          poison();
          throw storageError(reason);
        }
      }),
    close: () =>
      serialized(async () => {
        if (closedWriter) return;
        closedWriter = true;
        if (handle) {
          await handle.close();
          handle = undefined;
        }
      }),
  };
}
