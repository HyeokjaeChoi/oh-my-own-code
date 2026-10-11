# Composer-room recovery report

Plan revision 1. Recovery completed local documentation and evidence freeze. No preview repair, new Figma call, repeated mutation, repeated capture, or broad QA was needed. Independent final code/design review remains pending.

The previous worker stopped with transport error `502 getaddrinfo chatgpt.com` after writing the preview, actual Figma mutations, and captures. This failure is historical and coordinator-reported. It does not mean the saved Figma changes failed. Recovery read the saved successful tool results and viewed all six worker screenshots.

## Evidence findings

- C1 supported: saved Chrome Light/Dark observations show composer/input/toolbar 120/72/32px. The saved Light/Dark screenshots show the taller input area. The source comparison changes only growth token lookup, A input CSS, short-height positioning, and seven A data paths. Toolbar markup and targets remain the same as the old runtime. B/C observations retain 24px input minima.
- C2 supported within the saved checks: three lines remain 120px; 12 lines reach input 144px, shell 192px, `overflow:auto`, and scrollHeight 288px. Attachment produces a 160px shell. At 640×440, the attachment shell is 576px wide, toolbar bottom 258px, hint bottom 288px, document width 640px. The narrow screenshot has no visible clipping. Permission/artifact hint bottoms are 784px at 1280×800. Saved state records show archived read-only and send-disabled; unknown send-disabled with the reconciliation reason. Sending, stopping, stale and unavailable are also send-disabled. Source state logic, draft retention and keyboard guards match the historical runtime. These are synthetic preview states, not live effects or exhaustive keyboard tests.
- C3 supported: saved successful Figma component results contain 13 updated A variants, the 120/72 semantic variable aliases, preserved component aliases, and two affected showcase IDs. Saved screen results show all six A Empty/Permission/Artifact Light/Dark instances at 120/72/32px. Recovery inspected actual Empty Light/Dark and empty specimen images. No new live Figma read was made. The result does not include an exhaustive post-write binding audit of all descendants, and only the three saved Figma images are visually verified here.

Figma's saved toolbar Y is 81px in normal variants versus Chrome's relative 80px. The captures show the same base shell and control sizes; exact pixel parity across renderers is not claimed. State reason variants remain 148px and attachment remains 160px. Attachment at maximum growth is 232px by unchanged row arithmetic, but that combined case has no saved browser observation. No actual bounded-scope defect was found in the inspected evidence.

## Recovery checks and limits

`node --check` passed for preview `app.js` and `data.js`. The Figma script passed syntax parsing when wrapped as its intended async function body. A standalone `node --check` rejected its top-level return; that probe used the wrong execution context and was corrected without editing the script. The data comparison used VM evaluation because the file has multiple window assignments; a direct single-JSON parser was not applicable. JSON outputs parse. The historical compact library freeze matched all 251 files: no missing files or hash mismatch. Recovery did not run the browser observation script again.

The current recovery packet matches the current plan and contract hashes. Existing `plan.binding.json` and the saved entry plan verdict bind contract SHA `5af3de5b…`; the current contract SHA is `14a1f05f…`. Recovery preserved all coordinator metadata and reports this difference for the coordinator to resolve before claiming a fresh independent gate.

## Review handoff

Review `amendment.md`, this report, four `preview/` files, `execution/browser-observations.json`, raw `figma-components.json` and `figma-screens.json`, all six worker PNGs, and `execution/recovery/`. Normalized state snapshots retain saved-result provenance. `execution/evidence-binding.json` binds acceptance evidence and current plan/contract inputs. `freeze.json` hashes all current preview/execution files and recovery documents; `freeze.sha256` binds the manifest. The manifest and its sidecar are excluded from their own recursive file list. These hashes establish file identity, not reviewer approval, source capture time, or live service state.
