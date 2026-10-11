# Agent routing and verification synthesis

Reviewed 2026-09-24 for the current harness revision. The user's ChatGPT conversations “OpenViking 성능 향상 비교” and “모델 소개” were read as design input, then checked against the current repository and [Codex subagent documentation](https://learn.chatgpt.com/docs/agent-configuration/subagents). Those conversations are prior discussion, not proof of current repository behavior.

## Routing conclusion

The role specifies its responsibility, input/output boundary, and review independence. Runtime model selection belongs to the current conversation and explicit user instruction. For an ordinary fresh child, omit both model and reasoning effort. Codex documents parent inheritance in this case. A custom role file can override spawn values, and `[agents]` defaults or launcher flags can also defeat inheritance; therefore all shared pins were removed. An explicit user-requested supported model and/or effort is passed to the spawn call. If only the model is specified, Codex uses that model's default effort. Validate available combinations in the current client; do not silently substitute an unsupported choice. No automatic router or Jev service is needed to restore user choice.

## Stage and evidence conclusion

The ChatGPT harness-evaluation discussion framed `request → planning → research → specification → implementation → verification → completion` as a behavior to inspect, not as evidence that the old harness enforced it. This revision maps each relevant stage to a trigger, artifact handoff, independent gate, and failure path in `.agents/skills/solo-orchestrate/references/run-protocol.md` and `docs/agent-catalog.md` from the product root. Stages irrelevant to a bounded request are skipped; small edits use a compact plan and targeted checks.

Verification is an actual completion gate for declared checks and required reviews. The ledger records the command, exit code, timestamp, plan hash, and project fingerprint. The coordinator or specialist report records environment, relevant output, and evidence paths separately. Choose format, lint, typecheck, unit, integration, and automated browser E2E by the change's risk and available project scripts. Manual observation, HTTP access, and automated browser E2E are distinct claims. A passed unit check does not excuse missing declared lint/format checks. A source fingerprint change stales every recorded check in the current ledger, so rerun all of them before completion. A report-only change within `docs/runs/` leaves passing checks valid when source inputs stay unchanged. Final reviewers inspect current artifacts and evidence independently of authors. The ledger checks consistency of these records, not product correctness, reviewer identity, or actual model identity.

## Validation boundary

The current configuration can establish absence of shared model pins and can exercise ledger behavior. It cannot attest to the model/effort a live child used unless the client exposes a trustworthy runtime observation. Coordinator-reported routing fields preserve the request only. Historical run reports retain their old model metadata as dated evidence and are not active policy.

## 2026-09-26 runtime clarification

The current default request omits model and effort, but actual resolution is explicit spawn setting, then `[agents]` defaults, then parent. A model chosen without effort uses its model default; a role-model-only setting may keep resolved effort. Inspect effective client configuration before describing a child as inheriting the parent pair. Role files and ledger dispatch metadata cannot attest runtime identity. [Official subagent configuration](https://learn.chatgpt.com/docs/agent-configuration/subagents) was checked on 2026-09-26. Schema v2 contract and prepared-handoff details are in [run-protocol](../../../.agents/skills/solo-orchestrate/references/run-protocol.md). Earlier research remains historical.
