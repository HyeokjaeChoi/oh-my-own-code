import { useEffect } from "react";
import {
  useWorkbenchSelector,
  useWindowWorkbench,
} from "../../entities/workbench/index.js";
import styles from "./activity.module.css";
const operationLabels: Record<string, string> = {
  "workspace.import": "폴더 가져오기",
  "workspace.create": "작업 공간 만들기",
  "workspace.remove": "작업 공간 목록에서 제거",
  "session.create": "새 세션 만들기",
  "session.rename": "세션 이름 변경",
  "session.pin": "세션 고정 변경",
  "session.archive": "세션 보관 변경",
  "session.fork": "대화 분기",
  "session.remove": "대화 삭제",
  "message.send": "메시지 전송",
  "command.run": "명령 실행",
  "session.interrupt": "실행 중단 요청",
  "permission.respond": "권한 요청 응답",
};
const statusLabels = {
  ok: "완료",
  error: "오류",
  unknown: "결과 불명",
  cancelled: "취소",
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
  useEffect(() => {
    actions.diagnostics(false);
    return () => actions.closeDiagnostics();
  }, [actions]);
  return (
    <section
      className={`${styles.panel} activity-panel`}
      aria-label="로컬 활동 기록"
    >
      <h2>로컬 활동</h2>
      <p className={styles.muted}>이번 앱 실행에서 관찰한 작업입니다.</p>
      <label className={styles.filter}>
        <input
          type="checkbox"
          checked={filtered}
          disabled={!workspaceId || !sessionId}
          onChange={(event) => actions.diagnostics(event.target.checked)}
        />
        선택한 세션만 보기
      </label>
      {error ? (
        <div role="alert">
          <p>{error}</p>
          <button onClick={() => actions.refreshDiagnostics()}>
            활동 다시 확인
          </button>
        </div>
      ) : !data ? (
        <p role="status">활동 불러오는 중…</p>
      ) : null}
      {data && (
        <>
          <h3>앱 전체 집계</h3>
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
          <h3>
            {filtered && sessionId ? "선택한 세션의 기록" : "앱 전체 기록"}
          </h3>
          {data.events.length === 0 ? (
            <p>아직 활동 기록이 없습니다.</p>
          ) : (
            <ol className={styles.events}>
              {data.events
                .slice()
                .reverse()
                .map((event) => (
                  <li key={event.id}>
                    <div>
                      <strong>
                        {operationLabels[event.operation] ?? "런타임 작업"}
                      </strong>
                      <span>{statusLabels[event.status]}</span>
                    </div>
                    <p>
                      <time dateTime={new Date(event.timestamp).toISOString()}>
                        {new Date(event.timestamp).toLocaleTimeString("ko-KR", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>{" "}
                      · {Math.round(event.durationMs)} ms
                    </p>
                    <details className={styles.details}>
                      <summary>작업 상세</summary>
                      <dl>
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
                    </details>
                  </li>
                ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
