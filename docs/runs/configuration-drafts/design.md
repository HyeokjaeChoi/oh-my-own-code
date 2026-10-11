# Temporary configuration draft contract

Version: 1 | Date: 2026-10-08

## Ownership and API

Use the existing single window Zustand store. Add transient configurationDrafts keyed by JSON.stringify([workspaceId,registeredCanonicalPath,kind]) with kind instructions|mcp. Limit16 entries, text and baseline each32KiB UTF8, revision nonnegative safe integer. On first edit create baseline empty. No localStorage, filesystem, bridge request, polling, Native SDK, global store or dependency. Draft actions use selected registered workspace; a changed path cannot receive an older draft. Keep drafts through epoch/panel/session changes without implying that they are valid execution candidates. Discard affects only the selected draft. At capacity retain old drafts and show a bounded notice, never silently evict user input.

Store public helpers/actions: configurationDraftKey(workspaceId,path,kind), selected draft selectors, editConfigurationDraft(kind,text), validateConfigurationDraft(kind), baselineConfigurationDraft(kind), discardConfigurationDraft(kind). Validation output stores validatedRevision and closed diagnostics; an edit clears validation. Pure shared helpers validateConfigurationDraft(kind,text) and compareConfigurationDraft(baseline,text) are browser-safe with no side effects. Main freezes exact types before worker consumption.

## Validation and comparison

AGENTS.md is user-authored text only; do not load a discovered file. Check nonempty meaningful text,32KiB UTF8 and no NUL/forbidden control bytes (tab/newline/CR allowed). Do not claim policy safety, secret detection completeness, compatibility with every instruction loader or Native activation.

MCP draft is strict JSON with exactly {mcp:{servers:{name:config}}}. Up to16 server names (ASCII letters/digits/underscore/hyphen/dot,1–80, exclude prototype names). Closed supported subset from pinned @opencode/schema2.0.18: local {type:'local',command:string[],cwd?,disabled?,codemode?,protocol?}; remote {type:'remote',url:string,disabled?,codemode?,protocol?,oauth?:false}. No environment,headers,client_secret,OAuth setup or other raw credential fields. Reject unsupported keys rather than dropping them. Bounds: command1–32 strings≤1024 each; URL≤2048, http/https only, no username/password/query/fragment; cwd≤1024. Basic strings reject controls. Protocol legacy|auto|2026-07-28. A disabled example is optional user-loaded draft, never automatic registration. Generic root/provider/plugin/vendor JSON is unsupported, not valid by implication. JSON nesting≤16, no evaluation/interpolation/fetch. Diagnostic messages never contain input/key/value/parser error text. Format pass means the app-supported subset only, not Native schema acceptance or safe process execution.

Diff compares user-selected in-memory baseline with draft. Initial empty baseline is labelled '새 초안 기준 · 실제 파일과 비교하지 않음'. Keeping current text as baseline explicitly changes only the comparison. Use linear common prefix/suffix and at most80 displayed changed/context lines, include exact omitted-line count. Plain React text/pre only, no markup execution. Comparison stays available with invalid input so users can correct it.

## UI and UX

New features/configuration-drafts composition inside the existing CatalogPanel, after source metadata and before runtime lists. Section aria-label='설정 초안'. Native kind select, labelled textarea '설정 초안 내용', buttons '형식 검증', '현재 초안을 비교 기준으로', '이 초안 버리기'. Region aria-label='초안 변경 비교'. Show target relative name, selected registered workspace path, temporary window-only retention, current/validated revision and honest validation result. Text: '창 안의 임시 초안입니다. 파일 저장·적용·연결은 하지 않습니다.' Baseline never called saved/effective. No apply/reload/connect controls in this increment; future actual actions remain required.

Use selected A desktop32/coarse44, existing shared focus tokens and CSS Modules, native text/select/buttons. Narrow sheet stays scrollable, textarea/pre wrap without horizontal page overflow; native multiline textarea consumes typing/Enter, app global shortcuts must not treat textarea input as send or command. UI no separate copy of draft text; component selects store entry. Switching kind and reopening preserves each entry. UI local kind preference may reset without losing drafts.

## Tradeoffs and subsequent boundary

Temporary user-authored drafts are useful preparation without reading credentials or causing Native location initialization. They do not implement editing the existing disk file, applying/reloading or MCP lifecycle. Those remain required full-product work. File-backed apply needs compare-and-set identity, explicit effect admission, durable flushed intent, writer ownership and confirmed post-state; runtime activation can load plugins/processes, so it needs its own changed-effect review. A void MCP response is not observed connection. Do not misuse command.run or shell-only config.update. Existing Native/P7 proof is neither reopened nor bypassed here.
