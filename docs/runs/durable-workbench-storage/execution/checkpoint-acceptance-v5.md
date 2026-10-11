# First P7 checkpoint acceptance
Plan revision6 / storage-contract version5. Preparation only.

Journal/registry writer owns four new modules/tests; owner writer owns two new modules/tests. Public APIs are frozen from actual source/results after both return. Single integrator consumes those APIs, never guessed equivalents. Module checks are checkpoint observations, not the full registered storage-unit acceptance before host tests exist.

| Trigger | Required independent expected observation |
| --- | --- |
| Admission flush rejects | no effect; later append is rejected; bytes preserved |
| Second dispatch flush rejects after first effect | first dispatch remains uncertain; no second effect; global writer poison |
| Completion flush paused | readView/lookup have prior root, no candidate mapping/tombstone/confirmed receipt |
| Concurrent rejection/admission during candidate lifetime | completion rebases and retains both receipt identities |
| Complete JSONL record written but sync rejects | valid checksum does not become automatic confirmed success on reopen |
| Corrupt/partial/unsupported journal | original bytes unchanged; validated checkpoint projection; recovery_required |
| New transport epoch | original immutable epoch+operationId lookup and unknown holds survive |
| Folder rename/unregister/session removal | no project file delete/move; imported sentinels unchanged |
| Managed ID reserve | recorded stable ID exists before folder/native effect |
| Kernel owner denied | no record/journal open or native launch; owner_conflict |
| Dirty record, child live/unverifiable, spawn gap | no takeover, kill, release or native startup |
| Child exit unconfirmed | no clean owner release or disposable cleanup |
| Closed owner record flush rejects | no claimed success; fail closed and preserve record |

Storage fixture tests use only synthetic owned temp roots and dependency injection. No provider, visible GUI, private native store or real Documents. Return exact exported API examples and command results; Main records them and later runs all eleven contracted checks at the coherent integration source.
