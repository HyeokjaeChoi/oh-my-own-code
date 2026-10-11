# Permission read observation contract
Revision: 2
Date: 2026-10-10
Class: routine accepted-design implementation.

Implement schema-contract-r3 sections 1, 3 and 5 within the accepted F09 design-contract-r4 and adopted path-scope clarification. No new design boundary.

Outcome: one private Node producer validator for complete closed permission.control.read and permission.saved.read observations. It returns a detached deeply frozen validated observation; rejects malformed/oversized/unsafe shape, duplicate/composite identities, orphan/cyclic ancestry, invalid scope membership, impossible capability/settings and count limits. Unavailable results have no partial data or handles. No Node module imported into renderer; public browser DTO integration is subsequent coordinated work.

Exports validatePermissionControlObservation(value), validatePermissionSavedObservation(value). Exact accepted DTO; synchronous error permission_control_invalid_data. Canonical encoder enforces 1MiB/depth/plain descriptors/no Proxy before reading. Preserve ordered rules, resources and savePatterns. Sets require distinct identities and canonicalJSON(identity) UTF-8 ordering per section5: locations [locationId,incarnation], sessions [workspaceId,sessionId], pending [locationId,sessionId,permissionId], saved savedId, capabilities/settings capabilityId. Reject noncanonical sets; never silently sort or normalize validated input. Root read scope must appear in complete sessions/locations; pending rows must reference their matching session location. IDs reuse validWireId. All generations positive. Unsupported capabilities effect deny; preset settings empty; custom distinct canonical settings must refer to listed capabilities with matching effect (unsupported rows are necessarily deny). A capability effect is mode projection, not proof of actual policy evaluation. ParentSessionId must resolve to one unambiguous session in the captured project; no invented cross-workspace prohibition. Location handles are globally distinct in the observation; session membership is composite [workspaceId,sessionId].

Trust boundary: shape validation cannot establish Native inventory completeness, actual mapping, correct digests, policy compilation, caller/sender/epoch ownership, expiry or execution authority. Those remain graph/Main producer requirements. No runtime clocks invented. No Native, Bun, Electron, provider, UI, build, activation or journal writes. No scope/preview authority created by validated input. No other existing source changes.

Ownership: initial Main production and Gauss3 tests; correction Main both exact paths. Independent CODE after freeze/checks; no repeated PLAN/DESIGN.

Acceptance O1 closed exact available/unavailable read unions with bounds and detached immutable copy. O2 unique full structural membership/ancestry and capability/mode consistency, preserving Native ordered lists. O3 reject unsafe inputs without getters/Proxy hooks.

Checks: scoped Node including canonical/digest regressions; exact two-path lint and format. Typecheck/render/Native not applicable to private unconnected Node module. First missing-module RED then meaningful behavioral regressions. No decision blocks implementation. Change history: r1 applies already approved closed read schema. r2 fixes genuine CODE-R2-01 missing section5 set order validation; current-source RED recorded. No design change or repeated entry gate.
