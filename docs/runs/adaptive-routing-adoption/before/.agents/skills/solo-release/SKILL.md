---
name: solo-release
description: Prepare or execute a requested web, API, or Expo release and record validation and rollout evidence.
---

# Release

Identify the requested deliverable: readiness review, release artifacts, preview deployment, store submission, or production rollout. Carry that scope through to completion using existing authorization; preparing a release does not by itself request publication.

Use the project's deployment instructions, package scripts, target environment, and existing release workflow. Confirm the artifact/revision and configuration the release actually uses. The coordinator runs checks needed for affected behavior and required CI through the active run's `python3 .solopreneur/harness.py check <run-id> --name <name>`. Reuse valid results only for the same revision and relevant environment. Record unavailable runtime checks as unverified.

Select the relevant release risks: migration compatibility and recovery, authentication or entitlement behavior, deep links, environment-specific keys, analytics delivery, crash reporting, and version/build identifiers. A simple static-copy change does not need every category. Native dependencies or configuration can require a new Expo binary; do not assume a JavaScript update replaces it. Consult the project's Expo/EAS configuration and current provider documentation for compatibility.

Write release notes around user-visible changes. Capture validation evidence, rollout target, monitoring signals, rollback or forward-fix path, and any outstanding dependencies in `docs/releases/release-template.md` or the existing release record. For store releases, distinguish uploaded, submitted, in review, approved, and live states.

The primary agent registers the release record with `artifact`, saves the `release_engineer` review, and registers `review <run-id> --gate release --reviewer release_engineer --verdict ... --evidence <review-path>`. The coordinator checks `status <run-id>` before `finish <run-id>`.

If deployment is requested, prepare the concrete artifact and proceed with the authorized deployment. Release execution inherits current conversation settings unless the user explicitly requests a supported override. Inspect the resulting URL or build where accessible, address failures caused by the change, and record deployment separately from post-deployment behavior and monitoring. The final release judgment must be a separate fresh independent `release_engineer` invocation. It inherits current conversation settings by default; pass only explicit user-requested supported overrides. Record the actual route and evidence; ledger metadata does not prove runtime identity. If missing credentials or account access blocks only the final action, finish the local release artifacts and state the specific remaining operation. Do not treat an issued command as proof that a release succeeded.
