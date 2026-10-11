# Review reconciliation

The code review was a fresh, report-only CLI invocation
`cli:01a0eb10-7cba-7460-9533-f9b00742f12c`. The rendered-design review was
`cli:01a0eb19-dd08-7141-a08a-136d8d16596d`. Both requested and reported the
`chatgpt-web/gpt-5.6-sol` route with high effort. These are CLI observations,
not independent model identity attestations. The native spawn route reported
its existing thread limit. No implementation context was reused for review.

## Code findings

- **Model default override — repaired.** Only an explicit renderer model
  selection calls `session.switchModel`. An omitted selection leaves runtime,
  session and agent resolution, including the variant, untouched. Three new
  regression cases failed before the repair with one unwanted switch and now
  pass. An explicit-selection test also checks mapped SDK arguments and policy
  read-back before sending. See `model-default-before.log` and
  `model-default-after.log` plus the current full unit check.
- **Trust confirmation for ordinary new folders — retained, with rationale
  for final independent adjudication.** Interface v2 requires confirmation for
  imported paths; it does not state that this must be the only confirmed case.
  An ordinary folder under a user-selected parent is not the app's isolated
  temporary workspace. The source explicitly distinguishes both imported/new
  folders from that owned workspace and requires confirmation before SDK
  activation. The UI reports untrusted registration honestly. Automatically
  granting trust would widen behavior without a requirement to do so. No
  contract, permission policy or approved scope was weakened to clear a review.

## Rendered-design findings

- **Composer hidden by pending permissions — repaired.** Permission requests
  have their own bounded scroll area. The composer and interruption control
  stay outside it. A viewport assertion reproduced the defect before repair
  (only 34.56% of the textarea was visible). Final UI-state evidence checks the
  full textarea and cancellation control are visible with two pending requests.
- **Desktop navigation toggle did not change visibility — repaired.** Explicit
  navigation state now controls visibility at every supported width. Desktop
  session selection preserves navigation; closing the detail panel restores
  its previous desktop state. The synthetic Electron test exercises both
  open/close actions at 1180 CSS pixels.

Additional integration corrections remove a stale cancellation notice once
the authoritative session is idle, place the slash menu above the composer,
and supply scoped desktop styles for the owned Tool UI link preview. The
existing unknown-receipt draft preservation is now exercised in Electron.
These changes do not demonstrate provider-authenticated tool execution.

The first additional UI fixture attempt waited at top-level Electron readiness
before creating a window. The owned test-only process was identified and
terminated; its fixture entry now schedules readiness without top-level await
and the runner has bounded launch/window waits. This test host is never
included in the packaged app. Real sidecar and packaged lifecycle tests remain
separate from all synthetic UI-state evidence.
