// Startup crash reconciler for unsettled bootstrap (Native create) tasks.
// Reached only after the sidecar is live and before the workbench is admitted:
// the only Native call is the read-only `session.get(plannedNativeSessionId)`
// that the live ledger itself issues. It never creates, forks, updates or arms
// anything, so a crash at any point (including mid-reconciliation) can only
// repeat the read. Every outcome but an exact match or a proven absence holds.
const hold = () =>
  Object.assign(new Error("pending recovery"), {
    storageReason: "native_startup_unverified",
  });

export async function reconcileBootstrapTasks({
  registry,
  nativeTasks,
  signal,
}) {
  const plan = registry.reconcilePlan();
  // A non-bootstrap (or unrecognised) retained operation means no automatic
  // recovery at all: the profile stays held exactly as before.
  if (!plan.eligible || !plan.candidates.length) throw hold();
  if (typeof nativeTasks?.reconcile !== "function") throw hold();
  for (const { operation, task, state } of plan.candidates) {
    signal?.throwIfAborted();
    let decision;
    try {
      decision = await nativeTasks.reconcile({ operation, task, state });
    } catch {
      throw hold();
    }
    if (decision.outcome === "hold") throw hold();
    let result;
    try {
      result = await registry.recordTask({
        kind: "task_reconciled",
        runtimeEpoch: decision.original.runtimeEpoch,
        operationId: decision.original.operationId,
        taskScopeId: decision.taskScopeId,
        ticketDigest: decision.ticketDigest,
        proofDigest: decision.proofDigest,
        outcome: decision.outcome,
        bootstrap: decision.bootstrap,
      });
    } catch {
      throw hold();
    }
    if (result.status !== "recorded") throw hold();
    // An uncheckpointed tail is replayed conservatively after a crash: make the
    // resolved state durable before anything depends on it (repeat is safe).
    try {
      await registry.checkpoint();
    } catch {
      throw hold();
    }
  }
  // Every recorded reconciliation resolves its operation in the same record;
  // anything still retained is not explained by this phase: hold.
  if (registry.readView().retainedOperations.length) throw hold();
}
