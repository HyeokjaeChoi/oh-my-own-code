# Routine correction evidence

Preserve final-code-review-r1 changes_requested and final-design-review-r1 PASS, source-freeze-r1/r2 and hidden-r1/r2. No initial approval repeated.

CF-CODE-R1-01: separate shared configurationFileContentFits from nonempty draft validation, used by Host/store/synthetic DTO fixture. Empty, whitespace, BOM-only and mixed BOM/whitespace actual temporary file IO through controller/store now loads raw bytes/text and establishes observed baseline while later draft validation reports empty. Structural MCP refusal and byte/control checks remain.

Main confirmed a second path bug with an actual temporary POSIX directory named literal\\name\\. Host available and controller false/INVALID_REQUEST reproduced before fix. Shared configurationTargetPath derives separator from canonical root form and strips only that separator. Actual Host→controller path regression plus Windows/UNC string-only cases passed. No Windows runtime claim.

Targeted final correction checks: four meaningful tests passed across shared helper and real Host→controller cases. The earlier targeted host-file runner with name filter matching no host case is not new full-host coverage. Full current contracted suite is recorded separately in run.json.

Hidden-r2 passed68 captures before the path fix. Hidden-r3 adds original blank-file/empty-validation and literal-backslash target UI states; preserve the source/evidence revision distinction. Parent evidence directory creation after initial ENOENT involved no product source fix. ESLint ignores validation.d.mts; tsc verifies declarations.

Current revision6 format argv uses prettier --write. Its actual output reports every contracted path unchanged and the harness records unchanged whole-source fingerprints. This establishes formatting without source edits in that invocation; it is not described as a read-only --check invocation. Preserve exact argv and evidence.
