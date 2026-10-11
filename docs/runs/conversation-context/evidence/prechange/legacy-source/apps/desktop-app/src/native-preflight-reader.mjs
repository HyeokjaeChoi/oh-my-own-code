import {
  PREFLIGHT_LIMITS,
  createPreflightRequestDecoder,
  validatePreflightDecision,
} from "./native-preflight-protocol.mjs";
import {
  evaluatePreflightSnapshot,
  deniedPreflightDecision,
} from "./native-preflight-predicates.mjs";

// Install parent-loss/deadline protection before any Native, Effect or Schema import.
const controller = new AbortController();
let hardExitTimer;
let request;
let receive;
let rejectRequest;
const requestReady = new Promise((resolve, reject) => {
  receive = resolve;
  rejectRequest = reject;
});
function cancel() {
  if (controller.signal.aborted) return;
  controller.abort();
  rejectRequest(new Error("invalid_preflight"));
  // Import, finalization and stdout flush can each hang. No late positive frame.
  hardExitTimer = setTimeout(
    () => process.exit(1),
    PREFLIGHT_LIMITS.cancellationGraceMs,
  );
}
const decoder = createPreflightRequestDecoder({
  onRequest(value) {
    request = value;
    receive(value);
  },
  onCancel: cancel,
});
process.stdin.on("end", decoder.end);
process.stdin.on("error", decoder.error);
process.stdin.on("data", decoder.push);
process.stdout.on("error", cancel);
process.on("SIGTERM", cancel);
process.on("SIGINT", cancel);
process.on("uncaughtException", cancel);
process.on("unhandledRejection", cancel);
const deadlineTimer = setTimeout(cancel, PREFLIGHT_LIMITS.deadlineMs);
process.env.MSGPACKR_NATIVE_ACCELERATION_DISABLED = "true";

async function inspect(value) {
  controller.signal.throwIfAborted();
  const [
    effect,
    sqlite,
    drizzle,
    database,
    session,
    kv,
    generated,
    legacy,
    messageSchema,
    sqliteCore,
    sql,
  ] = await Promise.all([
    import("effect"),
    import("@opencode/core/database/sqlite.bun"),
    import("@opencode/core/database/drizzle"),
    import("@opencode/core/database/database"),
    import("@opencode/core/session/sql"),
    import("@opencode/core/kv/sql"),
    import("@opencode/core/database/migration.gen"),
    import("@opencode/core/database/v1-migration.bun"),
    import("@opencode/schema/session-message"),
    import("drizzle-orm/sqlite-core"),
    import("effect/unstable/sql/SqlClient"),
  ]);
  controller.signal.throwIfAborted();
  const { Context, Effect, Layer, Logger, Schema } = effect;
  const {
    SessionTable: S,
    SessionMessageTable: M,
    SessionPendingTable: P,
    SessionInboxTable: I,
  } = session;
  // Reviewed Native 2.0.18 coupling: declaration only, never DDL/migration execution.
  const ledger = sqliteCore.sqliteTable("migration", {
    id: sqliteCore.text("id").primaryKey(),
    time_completed: sqliteCore.integer("time_completed").notNull(),
  });
  const decodeMessage = Schema.decodeUnknownSync(
    Schema.toEncoded(messageSchema.Info),
    { onExcessProperty: "error" },
  );
  const read = Effect.gen(function* () {
    // Build the official layer privately. Native is never provided to read effects.
    const acquired = yield* Layer.build(
      sqlite.sqliteLayer({
        filename: value.database,
        readonly: true,
        readwrite: false,
        create: false,
        disableWAL: true,
      }),
    );
    const client = Context.get(acquired, sql.SqlClient);
    const db = yield* drizzle.EffectDrizzleSqlite.makeWithDefaults().pipe(
      Effect.provideService(sql.SqlClient, client),
    );
    // The legacy status read only needs select/get. Do not provide default Database.
    const closedDb = Object.freeze({
      select: db.select.bind(db),
      get: db.get.bind(db),
    });
    const closedDatabaseService = Object.freeze({ db: closedDb });
    const snapshot = {
      sessions: [],
      messages: [],
      pending: [],
      inbox: [],
      kv: [],
      migrations: [],
      migrationIds: generated.migrations.map((migration) => migration.id),
      legacyStatus: undefined,
    };
    snapshot.pending = yield* db.select({ id: P.id }).from(P).limit(1).values();
    snapshot.inbox = yield* db.select({ id: I.id }).from(I).limit(1).values();
    snapshot.kv = yield* db
      .select({ key: kv.KVTable.key })
      .from(kv.KVTable)
      .limit(1)
      .values();
    if (
      snapshot.pending.length ||
      snapshot.inbox.length ||
      snapshot.kv.length
    ) {
      return deniedPreflightDecision(
        value.nonce,
        {
          sessions: 0,
          messages: 0,
          pending: Math.min(snapshot.pending.length, 1),
          inbox: Math.min(snapshot.inbox.length, 1),
          kv: Math.min(snapshot.kv.length, 1),
          migrations: 0,
        },
        snapshot.pending.length || snapshot.inbox.length
          ? "pending_inbox"
          : "native_startup_unverified",
      );
    }
    snapshot.migrations = yield* db
      .select({ id: ledger.id, time_completed: ledger.time_completed })
      .from(ledger)
      .limit(PREFLIGHT_LIMITS.migrations + 1)
      .values();
    snapshot.legacyStatus = yield* legacy
      .status()
      .pipe(Effect.provideService(database.Service, closedDatabaseService));
    // Keep this explicit order in sync with the pure predicate's raw row contract.
    snapshot.sessions = yield* db
      .select({
        id: S.id,
        parent_id: S.parent_id,
        time_suspended: S.time_suspended,
        time_compacting: S.time_compacting,
        resume_attempts: S.resume_attempts,
        directory: S.directory,
        path: S.path,
        workspace_id: S.workspace_id,
        fork_session_id: S.fork_session_id,
        fork_boundary: S.fork_boundary,
        metadata: S.metadata,
      })
      .from(S)
      .limit(PREFLIGHT_LIMITS.sessions + 1)
      .values();
    snapshot.messages = yield* db
      .select({
        id: M.id,
        session_id: M.session_id,
        type: M.type,
        data: M.data,
      })
      .from(M)
      .limit(PREFLIGHT_LIMITS.messages + 1)
      .values();
    return evaluatePreflightSnapshot(value, snapshot, decodeMessage);
  });
  // Public logging suppression applies to acquisition, queries and finalization.
  const exit = await Effect.runPromiseExit(
    Effect.scoped(read).pipe(Effect.provide(Logger.layer([]))),
    { signal: controller.signal },
  );
  controller.signal.throwIfAborted();
  return exit._tag === "Success"
    ? exit.value
    : deniedPreflightDecision(value.nonce);
}

async function main() {
  let decision;
  try {
    const value = await requestReady;
    decision = await inspect(value);
  } catch {
    if (request) decision = deniedPreflightDecision(request.nonce);
  }
  // inspect has settled its scope before reaching here. Cancellation has no output.
  if (controller.signal.aborted || !decision) return process.exit(1);
  try {
    validatePreflightDecision(decision, request.nonce);
    const frame = JSON.stringify(decision) + "\n";
    if (Buffer.byteLength(frame) > PREFLIGHT_LIMITS.responseBytes)
      return process.exit(1);
    process.stdout.write(frame, () => {
      if (controller.signal.aborted) return process.exit(1);
      clearTimeout(deadlineTimer);
      clearTimeout(hardExitTimer);
      process.exit(0);
    });
  } catch {
    process.exit(1);
  }
}
void main();
