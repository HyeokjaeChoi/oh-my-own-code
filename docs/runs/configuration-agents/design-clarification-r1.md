# Agent registration wording clarification

The accepted plan revision1 and design version1 require `mode: primary`, `hidden: false`, exact three-rule baseline, empty request settings/headers/body, no model override, and unchanged Native default/current session selection. The actual public DTO freezes `registered_primary`.

The design UI paragraph's phrase “inactive register” is stale wording from the adjacent Skill flow. It means no automatic selection or model start; it does not define a disabled Agent state. Agent registration has no inactive/disabled field. The implemented label is “primary Agent로 Native에 등록”. The source, plan, frozen DTO and actual Native proof retain the accepted primary registration behavior. This corrects terminology only; no API, ownership or runtime boundary changes and no repeated major entry gate.
