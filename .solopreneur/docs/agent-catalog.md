# Execution profiles and workflow aliases

The primary conversation coordinates the task. Domain expertise lives in skills; native agent files contain only execution defaults and a pointer to `solo-specialist`. There are **two runtime profiles and 26 compatible logical aliases**, not 26 separately configured native agents.

| Native profile | Declared default | Purpose |
| --- | --- | --- |
| `solo_worker` | `workspace-write` | Execute an assigned skill within owned paths. |
| `solo_reader` | `read-only` | Research or independently review evidence and return a report. |

Every assignment starts a fresh child. Reusing a profile does not mean resuming the same child or reusing its context. An independent reviewer must be a separate invocation from the author; a distinct role name or TOML alone does not establish independence. All `review` phase routes select `solo_reader`, including release and growth judgments. Observation QA remains a report-only observation workflow and cannot approve a final gate.

## Logical workflow aliases

The schema-2 `harness/roles.json` is the routing source in the library; applied products use `.solopreneur/roles.json`. These stable names support existing plans, ownership declarations, CLI arguments and review gates. Their default execution profiles preserve the earlier read/write split. A review phase overrides that default with the reader.

| Alias | Skill | Mode | Default execution profile |
| --- | --- | --- | --- |
| `planner` | `solo-engineering-plan` | `analysis` | `solo_reader` |
| `plan_reviewer` | `solo-plan-review` | `default` | `solo_reader` |
| `file_scout` | `solo-evidence-research` | `files` | `solo_reader` |
| `code_explorer` | `solo-evidence-research` | `code` | `solo_reader` |
| `web_researcher` | `solo-evidence-research` | `web` | `solo_reader` |
| `product_research` | `solo-product-spec` | `research` | `solo_reader` |
| `product_manager` | `solo-product-spec` | `author` | `solo_worker` |
| `product_reviewer` | `solo-product-review` | `default` | `solo_reader` |
| `design_researcher` | `solo-design-research` | `default` | `solo_reader` |
| `design_architect` | `solo-design-system` | `default` | `solo_worker` |
| `design_spec_reviewer` | `solo-design-spec-review` | `default` | `solo_reader` |
| `design_qa` | `solo-design-review` | `default` | `solo_reader` |
| `engineer` | `solo-implement` | `general` | `solo_worker` |
| `mobile_engineer` | `solo-implement` | `mobile` | `solo_worker` |
| `reviewer` | `solo-code-review` | `default` | `solo_reader` |
| `bug_analyst` | `solo-debugging` | `default` | `solo_worker` |
| `test_engineer` | `solo-tdd` | `strategy` | `solo_worker` |
| `qa_runner` | `solo-qa-run` | `default` | `solo_reader` |
| `analytics_engineer` | `solo-analytics-instrumentation` | `default` | `solo_worker` |
| `analytics_analyst` | `solo-analytics-experiment` | `default` | `solo_reader` |
| `monetization_engineer` | `solo-subscription-check` | `default` | `solo_worker` |
| `aso_specialist` | `solo-aso` | `default` | `solo_worker` |
| `marketing_specialist` | `solo-marketing` | `default` | `solo_worker` |
| `store_assets` | `solo-store-launch` | `default` | `solo_worker` |
| `release_engineer` | `solo-release` | `default` | `solo_worker` |
| `reliability_engineer` | `solo-monitoring` | `default` | `solo_worker` |

## Dispatch

Resolve a workflow before preparing its packet:

```sh
python3 scripts/harness.py route --role mobile_engineer --phase implementation
python3 scripts/harness.py route --role release_engineer --phase review
```

Use `.solopreneur/harness.py` in an applied product. The returned profile file, bootstrap, selected skill and reference inputs belong in a bounded handoff with the current plan path/revision, assigned outcome, owned paths, acceptance criteria and evidence requirements. `prepare-handoff` binds the resolved inputs; `dispatch` checks them again and records the actual child reference. The `--role-file` option now receives the resolved runtime profile path.

Use a native profile selector only when supported by the current client and when it creates a clean child. Otherwise inject the resolved profile and bootstrap into a fresh generic child. Never pass a domain alias as an unregistered native agent type. Instruction injection does not create an OS sandbox; the actual runtime controls permissions. A task label is not proof of role selection or context isolation.

The primary persists reports and the ledger. Children do not restart intake, spawn additional workers or write the coordinator's records. Bounded `planner` work uses engineering-plan analysis; it returns proposed text rather than becoming another coordinator. Corrections use a fresh child referencing the prior report by path.

## Routing and capacity

Follow the [adaptive-routing reference](../../.agents/skills/solo-orchestrate/references/adaptive-routing.md). Exact user choices and explicit inheritance/default instructions take precedence; otherwise use authorized economical choices. Profiles, aliases and the launcher carry no permanent model or effort pins. Record requested, chosen and observed settings separately; metadata does not attest runtime identity or measured savings.

Use only needed independent work with disjoint writer ownership. The configured ceiling is eight open specialist threads beside the primary, subject to the client's lower capacity. Completed or interrupted children may still occupy a slot. Preserve outputs before closing when supported; do not silently reuse an old context to claim a fresh specialist.

## Reviews and compatibility

Keep existing logical review gate names: `plan_reviewer`, `product_reviewer`, `design_spec_reviewer`, `reviewer`, `design_qa`, `analytics_analyst`, `marketing_specialist` and `release_engineer`. Product/design documents require their independent handoff before consumers; actual UI needs rendered evidence. Every feature/bugfix needs risk-scaled independent code review. Release execution and final judgment are separate assignments. These requirements live in the corresponding skills and run protocol, not in duplicated domain profiles.

Historical records remain unchanged and readable. A pre-migration packet has no schema-2 routing binding and must be prepared again before dispatch. `solo.py apply` retires unchanged managed domain TOMLs and preserves unrelated project text, MCP choices and locally modified files through its existing conflict checks. See [harness.md](harness.md) for the full command protocol.
