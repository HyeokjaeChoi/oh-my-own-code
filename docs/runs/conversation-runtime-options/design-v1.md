# F06 runtime options design
Version: 1 · 2026-10-09

Initial independent design-review input. No product implementation or consumer freeze yet.

## Behavior and terminology
The composer selects requests for the next explicit send. The Native session setting and the Agent/model reported by an assistant response have separate labels and sources. A switch ACK is not provider execution evidence. Empty selections mean no explicit value is requested; the UI says 'Native에서 결정 · 요청 안 함', not 'the default has been applied'. Per-model variants retain their actual opaque IDs; do not rename them to universal effort tiers.

Keep current pending/running/unknown authority. A request draft can change during execution, but the in-flight request is an immutable copy. Display '다음 전송에 요청'; never switch Native on option-change UI events. A send validates the current catalog and performs existing baseline-before-selection, switches, baseline-after-selection and prompt ordering.

## Proposed public shapes for initial review
The following design is submitted for initial independent review; actual consumers wait for implemented source/DTO freeze.
- Extend only the models catalog entry projection with variants: {status:'available'|'unavailable', ids:string[]} and optional capabilities: {tools:boolean,input:string[],output:string[]}. Use a specialized model entry type rather than put model fields on commands/MCP/skills. Bound strings/counts and refuse duplicates. Unknown capability strings are displayed as unrecognized and authorize no attachment. Project only these fields; provider settings/headers/body never enter DTOs.
- message.send adds optional variant:string. Explicit variant requires explicit model. Preserve omitted values. Variant must be in the currently authenticated/enabled model's valid list. Do not expose a new arbitrary Native Model.Ref request surface.
- Snapshot adds optional sessionSelection:{sessionId,agent?,model?}, where model={providerId,id,variant?}. This is a Native session setting report, scoped to the selected validated Native session/location. Replace atomically on every accepted snapshot; omission clears any old report. A snapshot without a successful fresh session refresh must not claim a current selection. Bind same epoch/sequence/revision-floor rules as other snapshot fields.
- Each assistant message may include optional runtime:{agent,model:{providerId,id,variant?}}. Source is that same validated Native assistant message; never infer from composer/session/catalog. Missing or malformed values omit the whole optional record without manufacturing a value. The transcript can label historical model IDs no longer present in catalog, but cannot make them an executable select option.
- IDs are bounded inert text, not paths, URI targets or navigation. No provider configuration overlays, credentials, cost estimates or chain-of-thought data are exposed.

## Default and reset semantics
Blank Agent/model/variant request fields mean omission, exactly as current send. A chosen model with blank variant sends id/providerID without a variant; the UI makes no claim that this resets an old Native variant. Explicit reset is not invented. Current observed settings and later assistant metadata reveal what Native reports. This limitation is visible rather than silently substituting a supported value. A future reset control requires an exact supported Native operation and separate evidence.

## Host and storage ordering
Retain both policy stages and trust/AGENTS baseline rechecks. Catalog validation precedes switchModel; pass variant only when explicitly selected and admitted. Variant joins the canonical operation fingerprint automatically through the existing closed request. Same key changed variant is conflict; unknown switch/prompt stays lookup-only with no replay. Do not add another storage journal schema or reserve a new dispatch step without a concrete actual compatibility failure. Read-only sessionSelection is transient native projection, not durable authority or permission state.

## Renderer ownership
Use the existing one window Zustand owner. Extend scoped composer draft and its immutable send identity; clear a variant only on an explicit model change UI action, with visible context, not on background catalog refresh. If a selected variant disappears, retain it as unavailable and block send. Incoming snapshots cannot overwrite a user's next-turn draft. Current snapshot setting and historical message report remain separate from requested options.
A late read/ACK from previous epoch/workspace/session/root/trust/floor cannot update current state. Unknown retained original operations restore neither Agent/model payload nor active controls. Existing pending actual IO and resource/global recovery holds remain. Use native selects/current CSS Modules tokens; no new dependency, store or primitive foundation.

## Test obligations
1. Meaningful RED for new variant request/DTO/projection and observed-versus-requested distinctions before production edits.
2. Production host catalog/request/admission tests, both policy steps and immutable same-key conflicts; variant removed, duplicate malformed catalog, absent Native values and historical model reports.
3. Actual SDK-shaped assistant/session fixtures with deliberately different requested/session/response refs. No overlay/credential canary leaks; no assumed model.default variant.
4. Renderer draft/catalog races, next-boundary running edit, snapshot floor/sequence/ABA isolation, unknown original lookup/no replay and no fabricated restored payload.
5. Coherent app type/lint/format/boundary/unit/build/bundle; actual hidden native PNG keyboard/320/760/200%/dark/light and invalid/absent/current/historical states. Synthetic Native methods prove wiring only, no provider execution claim.
6. One initial independent PLAN+DESIGN_SPEC for this new DTO/runtime contract, then ordinary implementation/fixes without repeated entry gates; final fresh CODE+RENDER.

## Sequencing and remaining product scope
First finish frozen conversation-markdown final independent judgments without altering its sources. Then adopt this bounded F06 run only after initial review. Attachments, retry, edit-and-fork, queue and full Windows/release remain required subsequent full18 work; no product reduction. Existing version-bound line-feedback covers explicit selected text and stays authoritative. Generic FileAttachment.uri does not establish safe attachment access, so attachments need a later concrete source/byte/type/privacy design, not a guessed URI passthrough here.

## Bounds and malformed-data policy
Keep existing catalog300models/messages100/identity256character limits. Variant list maximum64 and capability list maximum32 strings of64characters are proposed bounded UI surfaces; exceeding or malformed/duplicate variants makes that variant list unavailable instead of truncating it into a false complete list. Model itself may remain selectable without explicit variant. Native selection strings are well-formed bounded inert text without NUL/control characters; variants are not restricted to universal tier words or current model hash grammar. Host membership uses exact original string. A malformed optional per-response runtime record is not reported, never partial fabricated truth. Optional snapshot sessionSelection must be selected-session correlated and absent on failed refresh, disconnected/global/resource unavailable, untrusted or not-current observation. Preserve all existing snapshot validators' closedness with only explicit additive fields.

## Module and migration comparison
A small shared runtime-options validator/projection helper gives host and browser one closed schema without importing host SDK into renderer. Alternative duplicated handwritten validators risks shape drift; importing @opencode/schema into browser adds effect/host-oriented dependencies and exposes overly broad overlays. Choose app-owned small pure helper, no dependency additions. State remains window Zustand, transient model observations remain projection-owned and are never saved as execution authority. Existing durable identity digest includes new request field automatically; no journal schema change is anticipated. If actual storage rejects the unchanged native.model step payload, hold and produce a reproducer instead of editing frozen machinery privately.
