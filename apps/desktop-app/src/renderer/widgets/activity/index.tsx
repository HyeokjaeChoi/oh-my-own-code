import { useEffect, useState } from "react";
import {
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import { Timeline } from "./timeline.js";
import { SubagentPanel } from "../../features/subagents/index.js";
import {
  activityFilters,
  activityMatches,
  operationLabels,
  type ActivityFilter,
} from "./labels.js";
import { relativeTime } from "../../shared/panel-text/index.js";
import styles from "./activity.module.css";
import {
  CircleAlert,
  CircleCheck,
  CircleHelp,
  CircleSlash,
  type LucideIcon,
} from "lucide-react";
import { Button, Notice, Switch } from "@workbench/ui";
const statusLabels = {
  ok: "완료",
  error: "오류",
  unknown: "결과 불명",
  cancelled: "취소",
};
const statusIcons: Record<keyof typeof statusLabels, LucideIcon> = {
  ok: CircleCheck,
  error: CircleAlert,
  unknown: CircleHelp,
  cancelled: CircleSlash,
};
export function ActivityPanel({
  workspaceId,
  sessionId,
}: {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
}) {
  const filtered = useWorkbenchSelector(
    (s) => s.diagnosticsIdentity?.filtered ?? false,
  );
  const data = useWorkbenchSelector((s) => s.diagnostics);
  const error = useWorkbenchSelector((s) => s.diagnosticsError);
  const { actions } = useWindowWorkbench();
  const [filter, setFilter] = useState<ActivityFilter>("all");
  useEffect(() => {
    actions.diagnostics(false);
    return () => actions.closeDiagnostics();
  }, [actions]);
  const shown = (data?.events ?? [])
    .filter((event) => activityMatches(filter, event))
    .reverse();
  return (
    <section
      className={`${styles.panel} activity-panel`}
      aria-label="로컬 활동 기록"
    >
      <SubagentPanel workspaceId={workspaceId} sessionId={sessionId} />
      <div className={styles.head}>
        <h3>활동</h3>
        <Switch
          label="선택한 세션만 보기"
          checked={filtered}
          disabled={!workspaceId || !sessionId}
          onChange={(event) => actions.diagnostics(event.target.checked)}
        />
      </div>
      {error ? (
        <Notice
          tone="danger"
          action={
            <Button
              size="compact"
              intent="quiet"
              onClick={() => actions.refreshDiagnostics()}
            >
              활동 다시 확인
            </Button>
          }
        >
          {error}
        </Notice>
      ) : !data ? (
        <p role="status" className={styles.muted}>
          활동 불러오는 중…
        </p>
      ) : null}
      {data && (
        <>
          <h4 className={styles.group}>
            {filtered && sessionId ? "선택한 세션의 기록" : "앱 전체 기록"}
          </h4>
          <div role="group" aria-label="활동 종류" className={styles.head}>
            {activityFilters.map(([id, label]) => (
              <Button
                key={id}
                size="compact"
                intent="quiet"
                aria-pressed={filter === id}
                onClick={() => setFilter(id)}
              >
                {label}
              </Button>
            ))}
          </div>
          {data.events.length === 0 ? (
            <p className={styles.muted}>아직 활동 기록이 없습니다.</p>
          ) : (
            <ol className={styles.events}>
              {shown.length === 0 && (
                <li className={styles.muted}>
                  이 종류에 해당하는 활동이 없습니다.
                </li>
              )}
              {shown.map((event) => {
                const Icon = statusIcons[event.status];
                return (
                  <li key={event.id}>
                    <details className={styles.details}>
                      <summary>
                        <Icon
                          size={14}
                          aria-hidden="true"
                          className={styles.icon}
                          data-status={event.status}
                        />
                        <strong>
                          {operationLabels[event.operation] ?? "런타임 작업"}
                        </strong>
                        {event.status !== "ok" && (
                          <span className={styles.state}>
                            {statusLabels[event.status]}
                          </span>
                        )}
                        <time
                          dateTime={new Date(event.timestamp).toISOString()}
                          title={new Date(event.timestamp).toLocaleString(
                            "ko-KR",
                          )}
                        >
                          {relativeTime(event.timestamp)}
                        </time>
                      </summary>
                      <dl>
                        <dt>소요 시간</dt>
                        <dd>{Math.round(event.durationMs)} ms</dd>
                        <dt>작업</dt>
                        <dd>{event.operation}</dd>
                        <dt>기록 ID</dt>
                        <dd>{event.id}</dd>
                        {event.workspaceId && (
                          <>
                            <dt>작업 공간 ID</dt>
                            <dd>{event.workspaceId}</dd>
                          </>
                        )}
                        {event.sessionId && (
                          <>
                            <dt>세션 ID</dt>
                            <dd>{event.sessionId}</dd>
                          </>
                        )}
                        {event.code && (
                          <>
                            <dt>오류 코드</dt>
                            <dd>{event.code}</dd>
                          </>
                        )}
                      </dl>
                      {event.workspaceId && event.sessionId && (
                        <Button
                          size="compact"
                          intent="quiet"
                          onClick={() =>
                            actions.select(event.workspaceId!, event.sessionId!)
                          }
                        >
                          이 세션으로 이동
                        </Button>
                      )}
                    </details>
                  </li>
                );
              })}
            </ol>
          )}
          <details className={styles.more}>
            <summary>앱 전체 집계</summary>
            <dl className={styles.counts}>
              <div>
                <dt>관찰한 작업</dt>
                <dd>{data.observedOperations}</dd>
              </div>
              <div>
                <dt>오류</dt>
                <dd>{data.errors}</dd>
              </div>
              <div>
                <dt>결과 불명</dt>
                <dd>{data.unknownOutcomes}</dd>
              </div>
            </dl>
            <p className={styles.muted}>
              시작: {new Date(data.startedAt).toLocaleString("ko-KR")}
              <br />
              보관 한도로 제외된 기록: {data.droppedEvents}개 · 앱 전체
            </p>
          </details>
          <details className={styles.more}>
            <summary>대화 타임라인</summary>
            <Timeline
              workspaceId={workspaceId}
              sessionId={sessionId}
              events={data.events}
            />
          </details>
        </>
      )}
    </section>
  );
}
