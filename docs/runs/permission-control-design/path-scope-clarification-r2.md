# Allowed-path semantics — explicit proposed clarification r2

Status: proposed product/security clarification under Main's delegated design authority. Not a user approval, not a retrospective rewrite, not a resolved DS-01 finding. Original PRD and the changes_requested r1 report remain unchanged. Independent product and design judgment is required before dependent implementation.

## Actual authority and discrepancy

User instruction is to complete the approved product autonomously, with the design foundation first and no interim stopping. The user did not explicitly specify an adversarial external same-user filesystem-namespace threat model.

PRD section5 requires allowed paths enforced at the actual execution boundary and distinguishes tool policy from OS sandbox. Section4 disallows a create strategy which can write outside an allowed root; post-result pathname inspection is insufficient. Engineering verification AC09 requires actual inside/outside markers and blocked indirect routes. None explicitly defines whether a selected folder's authority follows its filesystem identity or its original pathname after a separate process moves it.

R1 reviewer DS-01 interpreted this as strict current-absolute-path confinement during every mutation, including noncooperating external ancestor/root relocation. Main's subsequent research assignment preserved that interpretation rather than silently weakening it. The analyst's first attribution to a user instruction was incorrect; its separate correction records the actual source. No actual user requirement is being waived by pretending that attribution was true.

The research establishes that current descriptor checks do not provide that strict guarantee. Supported App Sandbox/bookmark documents do not establish it either. Deprecated custom sandbox_init profiles, advisory locks, optimistic before/after checks, or post-effect unknown are not a substitute. No production implementation may advertise that guarantee from these mechanisms.

## Proposed selected product contract

An allowed local path selects an exact user-visible directory object, anchored at its checked canonical path and filesystem identity, plus only its checked descendants. This is object-scoped tool authority. It is explicitly NOT an OS sandbox or an invariant that a different same-user application cannot relocate that authorized directory. No unchecked pathname is accepted merely because it has the same textual prefix. The authority never follows a replacement object placed at the old pathname.

Protect against repository/model/plugin-controlled traversal, symlink replacement, hardlinks, unchecked common-root siblings, cross-device rebinding, direct/nested callback bypass and stale grants. All tools that can change files, launch programs or delegate access must use a trusted adapter with this authority or be denied for restricted modes. A model/tool cannot relocate the authority root or an ancestor; such an operation is outside its capability. A root rename requested by another app/user invalidates further authority when observed, pauses execution and exposes actual partial state. No claim that the app can prevent the other process's relocation or recall a completed effect.

Broker operations use held descriptors, no-follow traversal and expected directory/leaf identities at every affected boundary; no post-return-only validation. Inside-root ancestor changes must fail before any effect to an unadmitted replacement. Effects remaining on already-authorized filesystem objects during an externally caused root relocation are disclosed as a relocation uncertainty, not represented as writes to an unrelated new folder. The app retains holds and reports unknown until actual task settlement/readback. A fresh selection is necessary to authorize the new location; automatic root adoption is forbidden.

Root identity does not authorize unrestricted writes into any renamed descendant: before-effect traversal binds each target's ancestor chain under the admitted root. The precise residual remains a concurrent external move after the last identity check. This cannot be eliminated by the selected descriptor mechanism. It is an explicit platform/security limitation, not a passed strict-path acceptance test.

A permission disclosure states: “선택한 폴더와 확인된 하위 파일에 도구 권한을 적용합니다. OS Sandbox는 아닙니다. 다른 앱이 폴더를 이동하면 작업을 보류합니다. 이미 발생한 변경은 되돌리지 않습니다.” Advanced details disclose the concurrent external relocation residual without promising detection before every syscall. The UI does not claim hostile same-user process isolation.

## Independent decision requested

Determine whether this is a reasonable explicit interpretation of the existing local product's allowed-folder requirement or an unacceptable material weakening of a requirement. Reject it if the stated residual contradicts the approved product/security outcome. Do not pass merely to unblock work. Do not require a mathematically stronger filesystem guarantee solely because wording is ambiguous. State whether a revised product specification is necessary before adopting this contract; no silent inherited acceptance from r1.

If accepted, record this clarification as binding alongside the PRD, obtain the focused design correction judgment, then implement/test the actual descriptor/adapter boundary. If rejected, strict-path scoped-write remains blocked and full F09 remains incomplete; continue unrelated full-product work instead of repeating unsupported-platform research. Do not replace the full product with an observation-only app.

## Decisive implementation evidence

The normal threat matrix must observe actual effects: outside-root sentinels stay unchanged for traversal, symlink/hardlink/ancestor replacement, stale snapshots, raw/nested tools and shell/MCP/formatter/CodeMode bypass. A separate externally orchestrated rename matrix records exact syscall timing, affected object identity, bytes/stage/backup and remaining holds. It must honestly expose the residual, never count unknown as proof of strict prevention. No runtime/probe has been executed for this proposal.
