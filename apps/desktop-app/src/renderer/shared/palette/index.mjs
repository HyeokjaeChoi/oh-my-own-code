// Pure command-palette derivation. Entries carry an `action` the UI dispatches; nothing here runs anything.
export const PALETTE_SOURCES = Object.freeze({
  app: "앱",
  runtime: "런타임",
  project: "프로젝트",
});
const PANELS = [
  ["files", "파일 패널 열기"],
  ["changes", "변경 패널 열기"],
  ["work", "작업 패널 열기"],
  ["terminal", "터미널 패널 열기"],
  ["preview", "미리보기 패널 열기"],
  ["plan", "계획 패널 열기"],
];

// One definition list shared by the composer `/` menu and the palette so they cannot drift.
// compact has no app operation: it exists only when the runtime offers a command of that name.
const APP_COMMANDS = [
  {
    name: "model",
    label: "모델 바꾸기",
    action: { type: "composer", target: "model" },
    session: true,
  },
  {
    name: "permissions",
    label: "권한 모드 바꾸기",
    action: { type: "composer", target: "permission" },
    session: true,
  },
  {
    name: "status",
    label: "세션 상태 보기",
    action: { type: "composer", target: "status" },
    session: true,
  },
  {
    name: "mcp",
    label: "MCP 서버 보기",
    action: { type: "extensions", sub: "mcp" },
  },
  {
    name: "help",
    label: "도움말·단축키",
    action: { type: "settings", page: "shortcuts" },
  },
  {
    name: "review",
    label: "변경 검토 열기",
    action: { type: "panel", panel: "changes" },
    workspace: true,
  },
  {
    name: "plan",
    label: "계획 모드 (Plan 에이전트)",
    action: { type: "composer", target: "plan" },
    session: true,
  },
  { name: "compact", label: "대화 압축", runtimeOnly: true },
];
export const APP_COMMAND_NAMES = Object.freeze(APP_COMMANDS.map((c) => c.name));

// runtimeNames: names of the runtime's commands, or null when the catalog is unavailable.
// ctx: { hasWorkspace, hasSession, archived }
export function buildAppCommands(ctx, runtimeNames) {
  const out = [];
  for (const c of APP_COMMANDS) {
    const base = {
      id: `app:cmd:${c.name}`,
      label: c.label,
      detail: `/${c.name}`,
      source: "app",
    };
    if (c.runtimeOnly) {
      if (runtimeNames?.has(c.name)) continue; // the runtime entry is the real command
      out.push({
        ...base,
        action: { type: "none" },
        disabled: true,
        reason: runtimeNames
          ? `런타임이 /${c.name} 명령을 제공하지 않습니다.`
          : "런타임 명령 목록을 사용할 수 없습니다.",
      });
      continue;
    }
    const reason =
      c.workspace && !ctx.hasWorkspace
        ? "작업 공간을 먼저 선택하세요."
        : c.session && !ctx.hasSession
          ? "세션을 먼저 선택하세요."
          : c.session && c.action.target !== "status" && ctx.archived
            ? "보관된 세션입니다."
            : undefined;
    out.push({
      ...base,
      action: c.action,
      ...(reason ? { disabled: true, reason } : {}),
    });
  }
  return out;
}

// Runtime command names that also name an app command (both are listed, labelled by source).
export const conflictingNames = (runtimeNames) =>
  new Set(APP_COMMAND_NAMES.filter((n) => runtimeNames?.has(n)));

// ctx: { hasWorkspace, hasSession, pending, workspaceBlocked, resourceBlocked, connected,
//        running, sessions: [{id,title}], currentSessionId, catalog, scripts, packageManager, draft }
export function buildPaletteEntries(ctx) {
  const entries = [];
  const app = (id, label, action, reason) =>
    entries.push({
      id,
      label,
      source: "app",
      action,
      ...(reason ? { disabled: true, reason } : {}),
    });
  const busy = ctx.pending ? "요청을 확인 중입니다." : undefined;
  app("app:settings", "설정·단축키 열기", { type: "settings" });
  app("app:notifications", "알림 센터 열기", { type: "notifications" });
  app("app:automation", "자동화(반복 작업) 열기", { type: "automation" });
  app("app:extensions", "확장 설정 열기", { type: "extensions" });
  for (const [panel, label] of PANELS)
    app(
      `app:panel:${panel}`,
      label,
      { type: "panel", panel },
      panel !== "files" && !ctx.hasWorkspace
        ? "작업 공간을 먼저 선택하세요."
        : undefined,
    );
  app(
    "app:new-session",
    "새 세션 만들기",
    { type: "session.create" },
    !ctx.hasWorkspace
      ? "작업 공간을 먼저 선택하세요."
      : (busy ??
          (!ctx.connected
            ? "런타임에 연결되어 있지 않습니다."
            : ctx.resourceBlocked
              ? "현재 작업 공간 변경이 제한되어 있습니다."
              : undefined)),
  );
  app(
    "app:import-folder",
    "폴더 가져오기",
    { type: "workspace.import" },
    busy ??
      (ctx.workspaceBlocked
        ? "작업 공간 변경이 제한되어 있습니다."
        : undefined),
  );
  for (const s of ctx.sessions ?? [])
    if (s.id !== ctx.currentSessionId)
      app(`app:session:${s.id}`, `세션 전환: ${s.title || s.id}`, {
        type: "session.select",
        sessionId: s.id,
      });

  const c = ctx.catalog;
  const runtimeNames =
    c?.commands?.status === "available"
      ? new Set(c.commands.entries.map((e) => e.name))
      : null;
  entries.push(
    ...buildAppCommands(
      {
        hasWorkspace: ctx.hasWorkspace,
        hasSession: Boolean(ctx.currentSessionId),
        archived: ctx.archived,
      },
      runtimeNames,
    ),
  );
  const clash = conflictingNames(runtimeNames);
  if (c?.commands?.status === "available")
    for (const e of c.commands.entries)
      entries.push({
        id: `runtime:command:${e.id}`,
        label: `/${e.name}`,
        detail:
          [e.description, clash.has(e.name) ? "앱 명령과 이름이 같음" : ""]
            .filter(Boolean)
            .join(" · ") || undefined,
        source: "runtime",
        action: { type: "draft", text: `/${e.name} ` },
      });
  if (c?.skills?.status === "available")
    for (const e of c.skills.entries) {
      const base = ctx.draft && ctx.draft !== "/" ? `${ctx.draft}\n` : "";
      entries.push({
        id: `runtime:skill:${e.id}`,
        label: `스킬 ${e.name}`,
        detail: "메시지에 스킬 이름을 추가합니다.",
        source: "runtime",
        action: {
          type: "draft",
          text: `${base}스킬 ${e.name}을 참고해 주세요. `,
        },
      });
    }

  for (const s of ctx.scripts ?? [])
    entries.push({
      id: `project:script:${s.name}`,
      label: `${ctx.packageManager ?? "npm"} run ${s.name}`,
      detail: s.command,
      source: "project",
      action: { type: "script", script: s.name },
    });
  return entries;
}

// Case-insensitive; every whitespace-separated term must match label, detail or source label.
export function filterPaletteEntries(entries, query) {
  const terms = String(query ?? "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  if (!terms.length) return entries;
  return entries.filter((e) => {
    const hay =
      `${e.label} ${e.detail ?? ""} ${PALETTE_SOURCES[e.source]}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}
