# Shutdown admission fence gap

Main inspected frozen Main and host admission. requestQuit sets quitAfterStartup, but admit(event) still accepts the current renderer. finishStorage awaits drain(), then appends shutdown/checkpoint, closes registry and releases owner. host.drain only snapshots current actual promises and does not reject later handle/trusted admissions. A new request can therefore enter after drain captured its task set and before storage closes.

Owner and writer guards protect many late effects, but drain cannot claim exhaustive actual-task settlement without first closing new admission. Add a shutdown admission fence at quit request (Main renderer IPC) and a host-local drain state that synchronously rejects new work while allowing already admitted actual tasks to settle. Do not fabricate effect-none for already dispatched tasks, clear unknown holds, release owner early or discard actual promises. The drain API shape stays unchanged.

Meaningful regression uses a deferred actual task: drain remains pending after caller timeout/response settlement, a later mutation is rejected with zero handler/admission/effect calls, and only exact actual settlement releases drain. Test normal close/cancel and existing durable receipts regressions. This is lifecycle ordering within the existing v5 contract, not a new wire/API/schema concern.
