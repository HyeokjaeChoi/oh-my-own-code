import { useMemo, useState } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  deriveTimeline,
  filterTimeline,
  timelineKinds,
  type TimelineEntry,
  type TimelineKind,
} from "../../shared/projection/index.js";
import type { WorkbenchDiagnostics } from "../../../desktop-bridge.js";
import { operationLabels } from "./labels.js";
import styles from "./activity.module.css";
import { Button } from "@workbench/ui";
const kindLabels: Record<TimelineKind, string> = {
  message: "메시지",
  tool: "도구",
  permission: "권한",
  child: "하위 세션",
  activity: "활동",
  error: "오류",
};
// Token/cost/context usage is not carried by the projection, so none is shown.
export function Timeline({
  workspaceId,
  sessionId,
  events,
}: {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  events: WorkbenchDiagnostics["events"];
}) {
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const { actions } = useWindowWorkbench();
  const [kinds, setKinds] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"all" | "current" | "children">("all");
  const entries = useMemo(
    () =>
      deriveTimeline({
        sessionId,
        messages: snapshot?.messages ?? [],
        permissions: snapshot?.permissions ?? [],
        sessions: snapshot?.sessions ?? [],
        events,
      }),
    [snapshot, sessionId, events],
  );
  const children = new Set(
    (snapshot?.sessions ?? [])
      .filter((s) => sessionId && s.parentSessionId === sessionId)
      .map((s) => s.id),
  );
  const visible = filterTimeline(entries, {
    kinds: kinds.size ? kinds : undefined,
    sessionIds:
      scope === "current" && sessionId
        ? new Set([sessionId])
        : scope === "children"
          ? children
          : undefined,
  });
  const jump = (entry: TimelineEntry) => {
    const t = entry.target;
    if (!t) return;
    if (t.type === "session") return actions.select(workspaceId, t.sessionId);
    const selector =
      t.type === "message"
        ? `[data-message-id="${CSS.escape(t.messageId)}"]`
        : `[data-permission-id="${CSS.escape(t.permissionId)}"]`;
    document.querySelector(selector)?.scrollIntoView({ block: "center" });
  };
  return (
    <>
      <p className={styles.muted}>
        메시지·도구·권한은 대화 순서대로, 활동은 시각순으로 이어 표시합니다.
      </p>
      <div role="group" aria-label="종류 필터" className={styles.chips}>
        {timelineKinds.map((kind) => (
          <Button
            size="compact"
            intent="secondary"
            key={kind}
            aria-pressed={kinds.has(kind)}
            onClick={() => {
              const next = new Set(kinds);
              if (!next.delete(kind)) next.add(kind);
              setKinds(next);
            }}
          >
            {kindLabels[kind]}
          </Button>
        ))}
      </div>
      <div role="group" aria-label="세션 필터" className={styles.chips}>
        {(
          [
            ["all", "전체"],
            ["current", "현재 세션"],
            ["children", "하위 세션"],
          ] as const
        ).map(([value, label]) => (
          <Button
            size="compact"
            intent="secondary"
            key={value}
            aria-pressed={scope === value}
            onClick={() => setScope(value)}
          >
            {label}
          </Button>
        ))}
      </div>
      {visible.length === 0 ? (
        <p>표시할 항목이 없습니다.</p>
      ) : (
        <ol className={styles.events}>
          {visible.map((entry) => (
            <li key={entry.seq}>
              <Button
                size="compact"
                intent="quiet"
                className={styles.entry}
                disabled={!entry.target}
                onClick={() => jump(entry)}
                title={entry.target ? "관련 결과로 이동" : undefined}
              >
                <strong>{kindLabels[entry.kind]}</strong>{" "}
                {entry.kind === "activity" || entry.kind === "error"
                  ? (operationLabels[entry.title] ?? entry.title)
                  : entry.title}
                <span> {entry.status}</span>
                {entry.time !== null && (
                  <time dateTime={new Date(entry.time).toISOString()}>
                    {" "}
                    {new Date(entry.time).toLocaleTimeString("ko-KR")}
                  </time>
                )}
              </Button>
            </li>
          ))}
        </ol>
      )}
    </>
  );
}
