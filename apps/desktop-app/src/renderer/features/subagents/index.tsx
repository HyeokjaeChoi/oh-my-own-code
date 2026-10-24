import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import {
  DEFAULT_CAP,
  briefTitle,
  cancelAll,
  childMode,
  deriveChildTree,
  drainQueuePerParent,
  isActive,
  renderBrief,
  validBrief,
  type Brief,
  type ChildStatus,
  type QueuedDelegation,
} from "../../shared/subagents/index.js";
import styles from "./subagents.module.css";
import { Plus } from "lucide-react";
import { Button, Field, InfoTip, Input, Textarea } from "@workbench/ui";

const statusLabels: Record<ChildStatus, string> = {
  queued: "대기열",
  running: "실행 중",
  waiting: "권한 응답 대기",
  stopping: "중단 확인 중",
  failed: "실패/상태 불명",
  done: "완료",
};
const LINEAGE_KEY = "omoc.delegation.lineage";
// App-side lineage for user-delegated children (Native session.create has no
// parentID). Per-viewer convenience: lost storage only hides the link.
let lineage: Record<string, string> = (() => {
  try {
    const value = JSON.parse(localStorage.getItem(LINEAGE_KEY) ?? "{}");
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
})();
let queue: QueuedDelegation[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => void listeners.delete(l);
};
const link = (child: string, parent: string) => {
  lineage = { ...lineage, [child]: parent };
  try {
    localStorage.setItem(LINEAGE_KEY, JSON.stringify(lineage));
  } catch {
    /* in-memory lineage only */
  }
  emit();
};
const setQueue = (next: QueuedDelegation[]) => {
  queue = next;
  emit();
};

// Queues a delegation; a mounted SubagentPanel (bare is enough) starts it.
export function enqueueDelegation(item: QueuedDelegation) {
  setQueue([...queue, item]);
}
// Child rows of a session (native + delegated + queued), re-rendered on changes.
export function useChildRows(sessionId: string | undefined) {
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  useSyncExternalStore(subscribe, () => queue);
  useSyncExternalStore(subscribe, () => lineage);
  return deriveChildTree({
    rootId: sessionId,
    sessions: snapshot?.sessions ?? [],
    permissions: snapshot?.permissions ?? [],
    lineage,
    queued: queue,
  });
}

export function SubagentPanel({
  workspaceId,
  sessionId,
  bare = false,
}: {
  workspaceId?: string | undefined;
  sessionId?: string | undefined;
  /** Runs the queue/drain logic without rendering the 하위 작업 UI. */
  bare?: boolean;
}) {
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const pending = useWorkbenchSelector(selectors.pending);
  const { actions, store } = useWindowWorkbench();
  useSyncExternalStore(subscribe, () => queue);
  const [brief, setBrief] = useState<Brief>({});
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [formOpen, setFormOpen] = useState(false);
  const unlinked = useRef(false);
  const rows = deriveChildTree({
    rootId: sessionId,
    sessions: snapshot?.sessions ?? [],
    permissions: snapshot?.permissions ?? [],
    lineage,
    queued: queue,
  });
  const runningByParent = new Map<string, number>();
  for (const s of snapshot?.sessions ?? []) {
    const parent = lineage[s.id];
    if (parent && (s.status === "running" || s.status === "stopping"))
      runningByParent.set(parent, (runningByParent.get(parent) ?? 0) + 1);
  }
  const delegatedActive = sessionId ? (runningByParent.get(sessionId) ?? 0) : 0;
  const active = rows.filter(isActive);

  // The host acts only on the selected session, so wait for selection to settle.
  const settle = (id: string, ms = 8000) =>
    new Promise<boolean>((resolve) => {
      const ready = (s: ReturnType<typeof store.getState>) =>
        s.selection.sessionId === id &&
        s.snapshot?.selectedSessionId === id &&
        !selectors.pending(s);
      if (ready(store.getState())) return resolve(true);
      const timer = setTimeout(() => {
        off();
        resolve(false);
      }, ms);
      const off = store.subscribe((s) => {
        if (!ready(s)) return;
        clearTimeout(timer);
        off();
        resolve(true);
      });
    });
  const open = (id: string) => actions.select(workspaceId, id);
  const cancelOne = async (id: string) => {
    if (!workspaceId) return false;
    open(id);
    if (!(await settle(id))) return false;
    return actions.mutate({
      type: "session.interrupt",
      workspaceId,
      sessionId: id,
    });
  };
  const cancelMany = async (ids: string[]) => {
    if (busy) return;
    setBusy(true);
    try {
      const out = await cancelAll(
        ids.map((id) => ({ id, status: "running" as const })),
        cancelOne,
      );
      setNote(
        `중단 요청 ${out.cancelled.length}개${out.failed.length ? `, 실패 ${out.failed.length}개` : ""}`,
      );
      if (sessionId) open(sessionId);
    } finally {
      setBusy(false);
    }
  };
  // Creates a fresh session (new context, not a history fork), links it app-side
  // to the parent and sends the rendered brief as its first prompt.
  const start = async (item: QueuedDelegation) => {
    if (!workspaceId) return false;
    const known = () =>
      new Set([
        ...store.getState().lists.sessions.map((x) => x.id),
        ...(store.getState().snapshot?.sessions ?? []).map((x) => x.id),
      ]);
    const before = known();
    unlinked.current = false;
    if (
      !(await actions.mutate(
        { type: "session.create", workspaceId, title: item.title },
        true,
      ))
    )
      return false;
    // The new id comes from the session list diff, not from the (movable) selection.
    const added = [...known()].filter((x) => !before.has(x));
    // mutate() returns no result, so an ambiguous diff fails instead of guessing.
    const child = added.length === 1 ? added[0] : undefined;
    if (!child || child === item.parentId) {
      unlinked.current = true;
      return false;
    }
    link(child, item.parentId);
    if (!(await settle(child))) return false;
    // The child must never be broader than its parent: apply the parent's mode
    // before the brief; an unknown parent mode or a failed set sends nothing.
    const state = store.getState();
    // A reviewer asks for read_plan, but never a broader mode than its parent (ask stays ask).
    const mode = childMode(
      item.mode,
      state.snapshot?.sessions.find((x) => x.id === item.parentId)
        ?.permissionMode,
    );
    if (!mode) return false;
    const own = state.snapshot?.sessions.find(
      (x) => x.id === child,
    )?.permissionMode;
    if (
      mode !== own &&
      !(await actions.mutate({
        type: "permission.mode.set",
        workspaceId,
        sessionId: child,
        requestId: crypto.randomUUID(),
        mode,
      }))
    )
      return false;
    return actions.sendMessageToSession(
      workspaceId,
      child,
      renderBrief(item.brief),
    );
  };
  const drain = async (items: QueuedDelegation[]) => {
    if (busy || pending) return;
    setBusy(true);
    try {
      const { start: now, rest } = drainQueuePerParent({
        queued: items,
        runningByParent,
      });
      setQueue(rest);
      for (const item of now)
        if (!(await start(item)))
          setNote(
            `위임 시작 실패: ${item.title}${unlinked.current ? " (새로 만들어진 세션이 있다면 부모와 연결되지 않은 채 남아 있습니다)" : ""}`,
          );
    } finally {
      setBusy(false);
    }
  };
  const delegate = () => {
    if (!sessionId || !validBrief(brief)) return;
    const item: QueuedDelegation = {
      id: crypto.randomUUID(),
      parentId: sessionId,
      title: briefTitle(brief),
      brief,
    };
    setBrief({});
    setFormOpen(false);
    void drain([...queue, item]);
  };
  const waiting = queue.filter((q) => q.parentId === sessionId);
  // A freed slot starts the next queued item, only while its parent is open
  // (starting a child selects it).
  useEffect(() => {
    if (waiting.length && delegatedActive < DEFAULT_CAP && !busy && !pending)
      void drain([...queue]);
  }, [delegatedActive, waiting.length, busy, pending]);
  const set = (key: keyof Brief) => (value: string) =>
    setBrief({ ...brief, [key]: value });
  if (bare) return null;
  return (
    <div className={`${styles.root} subagent-panel`}>
      <div className={styles.head}>
        <h3>하위 작업</h3>
        <InfoTip label="위임 안내">
          <p>
            동시에 실행하는 직접 위임은 최대 {DEFAULT_CAP}개이며 초과분은
            대기열에서 순서대로 시작합니다. 모델이 시작한 하위 작업은 여기서
            관찰만 합니다. 중단은 해당 세션을 열어 요청하므로 선택이 바뀝니다.
          </p>
          <p>
            분기와 달리 현재 대화 기록 없이 새 컨텍스트로 시작하며, 아래
            지시서가 첫 프롬프트가 됩니다.
          </p>
        </InfoTip>
        <Button
          size="compact"
          intent="secondary"
          className={styles.newButton}
          aria-expanded={formOpen}
          onClick={() => setFormOpen((value) => !value)}
        >
          <Plus size={14} aria-hidden="true" />
          위임 만들기
        </Button>
      </div>
      {rows.length === 0 ? (
        <p className={styles.muted}>아직 하위 작업이 없어요.</p>
      ) : (
        <ul className={styles.tree}>
          {rows.map((row) => (
            <li
              key={row.id}
              className={styles.row}
              style={{ paddingInlineStart: row.depth * 16 }}
              data-child-status={row.status}
            >
              <span>
                {row.title}{" "}
                <small>
                  {statusLabels[row.status]}
                  {row.origin === "delegated" ? " · 직접 위임" : ""}
                </small>
              </span>
              {row.status === "queued" ? (
                <Button
                  size="compact"
                  intent="quiet"
                  onClick={() => setQueue(queue.filter((q) => q.id !== row.id))}
                >
                  대기열 취소
                </Button>
              ) : (
                <>
                  <Button
                    size="compact"
                    intent="quiet"
                    onClick={() => open(row.id)}
                  >
                    기록 열기
                  </Button>
                  {isActive(row) && (
                    <Button
                      size="compact"
                      intent="quiet"
                      disabled={busy || pending}
                      onClick={() => void cancelMany([row.id])}
                    >
                      중단
                    </Button>
                  )}
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {active.length > 0 && (
        <p>
          <Button
            size="compact"
            intent="secondary"
            disabled={busy || pending}
            onClick={() => void cancelMany(active.map((r) => r.id))}
          >
            모든 하위 작업 중단 ({active.length})
          </Button>
        </p>
      )}
      {note && <p role="status">{note}</p>}
      {formOpen && (
        <form
          className={styles.form}
          aria-label="위임 만들기"
          onSubmit={(event) => {
            event.preventDefault();
            delegate();
          }}
        >
          <Field label="목표 (필수)">
            {(c) => (
              <Textarea
                {...c}
                autoFocus
                value={brief.goal ?? ""}
                onChange={(e) => set("goal")(e.target.value)}
              />
            )}
          </Field>
          <details className={styles.more}>
            <summary>자세히</summary>
            <Field label="역할">
              {(c) => (
                <Input
                  {...c}
                  value={brief.role ?? ""}
                  onChange={(e) => set("role")(e.target.value)}
                />
              )}
            </Field>
            <Field label="입력/참고 자료">
              {(c) => (
                <Textarea
                  {...c}
                  value={brief.inputs ?? ""}
                  onChange={(e) => set("inputs")(e.target.value)}
                />
              )}
            </Field>
            <Field label="담당 경로">
              {(c) => (
                <Textarea
                  {...c}
                  value={String(brief.ownedPaths ?? "")}
                  onChange={(e) => set("ownedPaths")(e.target.value)}
                />
              )}
            </Field>
            <Field label="수락 기준">
              {(c) => (
                <Textarea
                  {...c}
                  value={brief.acceptance ?? ""}
                  onChange={(e) => set("acceptance")(e.target.value)}
                />
              )}
            </Field>
          </details>
          <Button
            size="compact"
            intent="primary"
            type="submit"
            disabled={!sessionId || !validBrief(brief) || busy || pending}
          >
            새 컨텍스트로 위임
            {waiting.length ? ` (대기 ${waiting.length})` : ""}
          </Button>
        </form>
      )}
    </div>
  );
}
