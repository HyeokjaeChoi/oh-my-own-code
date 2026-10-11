---
name: solo-debugging
description: Diagnose a reproducible bug, failing check, performance regression, or unexpected integration behavior before proposing or implementing a fix.
---

# Debugging

Respect the requested outcome: a diagnosis produces a cause and evidence; a fix request continues through correction and verification.

Start from the actual symptom. Capture the exact failure, reproduction steps, environment, and frequency. Read the full error and recent relevant changes. If it is intermittent, gather observations or add narrow, removable instrumentation instead of guessing.

Trace the failing value or state backward through callers and component boundaries until its origin is supported by evidence. In a multi-component path, record what crosses each relevant boundary without printing secrets or unnecessary personal data. Compare the broken path with a nearby working path and list the differences that could explain the symptom.

State one falsifiable hypothesis and the observation that would confirm or reject it. Test the smallest variable possible. If rejected, remove experimental changes, update the evidence, and form a new hypothesis. After three failed fix attempts or when each attempt exposes different coupling, stop patching symptoms and reassess the design and assumptions; ask for direction only if the viable alternatives materially change scope or behavior.

For an authorized fix, create the smallest reliable reproducer when practical, confirm the valid failing state, change the root cause, and rerun the same check to prove the transition. Then run nearby regression checks and inspect the original user-visible symptom. Prefer waiting on an observable condition over arbitrary sleeps; keep bounded timeouts for failure recovery.

For mutating bugfix work, use the active run; the coordinator records reproduction and regression commands through `python3 .solopreneur/harness.py check <run-id> --name <name>`. Record hypotheses, observations, attempted changes, root cause, revision/environment, and remaining uncertainty under `docs/runs/<run-id>/`; give durable report paths to the coordinator for `artifact` registration. Remove temporary diagnostics unless they are intentionally useful operational telemetry. Report what was proven and distinguish environmental or external causes from unverified guesses.
