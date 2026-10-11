# Bounded static research handoff

- Run: `build-delivery`
- Current task plan SSOT: `docs/runs/build-delivery/plan.md` revision 7, SHA-256 `7bcacee7766d65c157a9b1e8b402f9a77e792f6907c89a045b084a62546999d3`
- Contract: `docs/runs/build-delivery/contract.json`, SHA-256 `1a5b79ccd693e06ae42c169818e444f63bbaa5eaa3a80f5207f5fd217b838386`
- Phase: read-only factual code exploration. Requested route: `gpt-6-luna/high`; coordinator-selected for pinned SDK source retrieval under delegated routing. Runtime identity is not independently attested.
- Role: `code_explorer`, using `.codex/agents/code_explorer.toml` and `.agents/skills/solo-evidence-research/SKILL.md`.

## Question

Inspect the locally installed, pinned OpenCode SDK/client sources and project boundaries to identify the least-risk path for a future real embedded host lifecycle probe. Report source-backed exact package entrypoints and dependency/resource initialization paths, filesystem/config reads and writes, child process/native binary behavior, sockets/listeners, network/effect-capable subsystems, required environment variables, disposal/shutdown behavior, and what can/cannot be excluded or observed before host creation. Distinguish documented source facts from inference. Include file paths and symbol names/line references where available, and identify uncertainty or transitive behavior that cannot be established statically.

## Constraints

- Read-only. Do not execute, import, instantiate, start, or attach to any OpenCode host or client. Do not read user config/credentials or environment secrets. Do not contact network or registry.
- Do not edit project source, runtime configuration, manifests, lockfiles, or files outside this assigned evidence output.
- Produce findings at `docs/runs/build-delivery/host-lifecycle-static-research-r1.md` only.
- Assess whether a separately isolated host probe can be safely planned now, what exact effect manifest and controls it would require, and which choices still need user input/approval.
- Report exact evidence examined, commands or reads (not commands that execute package code), conclusions, confidence, open questions, and next recommendation. No feature plan or product-scope changes.
