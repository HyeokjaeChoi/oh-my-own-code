import type { MutationRequest } from "../../shared/transport/index.js";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActionMenu, Button, Input, Notice } from "@workbench/ui";
import { Archive, MoreHorizontal, Pin, Search } from "lucide-react";
import type { WorkbenchSession } from "../../shared/api/index.js";
import {
  emptyActivity,
  trackSessions,
  visibleSessions,
  recentSessions,
  validSessionTitle,
  isPlaceholderTitle,
  relativeTime,
  sessionTime,
  type SessionActivity,
} from "./navigation.js";
import styles from "./sessions.module.css";
export {
  visibleSessions,
  sessionSuccessor,
  validSessionTitle,
  isPlaceholderTitle,
  titleFromPrompt,
  withDisplayTitles,
} from "./navigation.js";
/* eslint-disable no-unused-vars -- Callback parameter names describe the public interface. */
type Props = {
  /** `storedTitle` = authoritative title when `title` is a display fallback. */
  sessions: (WorkbenchSession & { storedTitle?: string })[];
  workspaceId: string;
  selectedId?: string | undefined;
  disabled: boolean;
  pending: boolean;
  unknownIds: string[];
  /** Sessions with a pending permission request (only those the renderer holds). */
  permissionIds?: string[];
  select(id: string): void;
  mutate(operation: MutationRequest, navigate?: boolean): Promise<boolean>;
};
/* eslint-enable no-unused-vars */
const labels = {
  idle: "대기",
  running: "실행 중",
  stopping: "중단 확인 중",
  unknown: "상태 불명",
  unavailable: "사용 불가",
};
// Module-level so unread/recent survive the navigation unmounting or a workspace switch.
// Last-activity times persist per profile so "3분" survives a restart.
const ACTIVE_KEY = "omoc.sessionActive.v1";
const RECENT_KEY = "omoc.sessionRecent.v1";
function loadRecent(): string[] {
  try {
    const value: unknown = JSON.parse(
      globalThis.localStorage?.getItem(RECENT_KEY) ?? "[]",
    );
    return Array.isArray(value)
      ? value.filter((id): id is string => typeof id === "string").slice(0, 5)
      : [];
  } catch {
    return [];
  }
}
function loadActive(): Record<string, number> {
  try {
    const value: unknown = JSON.parse(
      globalThis.localStorage?.getItem(ACTIVE_KEY) ?? "{}",
    );
    return Object.fromEntries(
      Object.entries(
        value && typeof value === "object" ? (value as object) : {},
      ).filter(([, at]) => Number.isFinite(at)),
    ) as Record<string, number>;
  } catch {
    return {};
  }
}
let activity: SessionActivity = {
  ...emptyActivity,
  active: loadActive(),
  recent: loadRecent(),
};
const listeners = new Set<() => void>();
function track(sessions: WorkbenchSession[], selectedId?: string) {
  // An empty list is "not loaded yet", not "all sessions gone": keep persisted recents.
  if (sessions.length === 0) return;
  const next = trackSessions(activity, sessions, selectedId);
  if (JSON.stringify(next) === JSON.stringify(activity)) return;
  if (JSON.stringify(next.active) !== JSON.stringify(activity.active))
    try {
      globalThis.localStorage?.setItem(ACTIVE_KEY, JSON.stringify(next.active));
    } catch {
      // Blocked storage: times last for this session only.
    }
  if (JSON.stringify(next.recent) !== JSON.stringify(activity.recent))
    try {
      globalThis.localStorage?.setItem(RECENT_KEY, JSON.stringify(next.recent));
    } catch {
      // Blocked storage: recents last for this session only.
    }
  activity = next;
  for (const listener of listeners) listener();
}
function useSessionActivity(sessions: WorkbenchSession[], selectedId?: string) {
  useEffect(() => track(sessions, selectedId), [sessions, selectedId]);
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    () => activity,
  );
}
export function SessionNavigation(props: Props) {
  const { unread, active, recent } = useSessionActivity(
    props.sessions,
    props.selectedId,
  );
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  const [query, setQuery] = useState("");
  const [archived, setArchived] = useState(false);
  const [searching, setSearching] = useState(false);
  const search = useRef<HTMLInputElement>(null);
  const searchButton = useRef<HTMLButtonElement>(null);
  const sessions = visibleSessions(
    props.sessions,
    props.workspaceId,
    query,
    archived,
  );
  const reopen =
    archived || query.trim()
      ? []
      : recentSessions(
          props.sessions,
          recent,
          props.workspaceId,
          props.selectedId,
        );
  return (
    <div className={`${styles.navigation} session-navigation`}>
      <div className={styles.sectionHeader}>
        <h2>{archived ? "보관된 세션" : "최근"}</h2>
        <button
          ref={searchButton}
          type="button"
          className={styles.iconButton}
          aria-label="세션 검색"
          title="세션 검색"
          aria-pressed={searching}
          onClick={() => {
            if (searching) setQuery("");
            setSearching(!searching);
          }}
        >
          <Search size={16} aria-hidden="true" />
        </button>
        <button
          type="button"
          className={styles.iconButton}
          aria-label="보관된 세션 보기"
          title="보관된 세션 보기"
          aria-pressed={archived}
          onClick={() => setArchived(!archived)}
        >
          <Archive size={16} aria-hidden="true" />
        </button>
      </div>
      {searching && (
        <label
          className={`${styles.search} session-search`}
          data-escape-key-scope
        >
          <span className={styles.srOnly}>세션 검색</span>
          <Input
            ref={search}
            type="search"
            value={query}
            placeholder="세션 검색"
            autoFocus
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
                setSearching(false);
                searchButton.current?.focus();
              }
            }}
          />
        </label>
      )}
      {reopen.length > 0 && (
        <nav
          className={`${styles.recent} session-recent`}
          aria-label="최근 연 세션"
        >
          <p className={styles.recentLabel} aria-hidden="true">
            최근 연 세션
          </p>
          <ul>
            {reopen.map((session) => (
              <li key={session.id}>
                <button
                  type="button"
                  className={styles.recentButton}
                  aria-label={`최근 연 세션 ${session.title}${unread.includes(session.id) ? ", 읽지 않은 응답" : ""}`}
                  data-session-recent={session.id}
                  onClick={() => props.select(session.id)}
                >
                  <span className={styles.title}>{session.title}</span>
                  {unread.includes(session.id) && (
                    <span
                      className={`${styles.dot} ${styles.unread}`}
                      aria-hidden="true"
                    />
                  )}
                </button>
              </li>
            ))}
          </ul>
        </nav>
      )}
      <ul className={`${styles.list} session-list`}>
        {sessions.map((session) => {
          const at = sessionTime(session, active);
          return (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === props.selectedId}
              unread={unread.includes(session.id)}
              time={at === undefined ? "" : relativeTime(at, now)}
              permission={props.permissionIds?.includes(session.id) ?? false}
              disabled={
                props.disabled ||
                props.pending ||
                session.status !== "idle" ||
                props.unknownIds.includes(session.id)
              }
              select={() => props.select(session.id)}
              mutate={props.mutate}
              afterHidden={() =>
                (search.current ?? searchButton.current)?.focus()
              }
            />
          );
        })}
      </ul>
      {sessions.length === 0 && (
        <p className={styles.empty}>
          {query
            ? "검색 결과가 없습니다."
            : archived
              ? "보관된 세션이 없습니다."
              : "활성 세션이 없습니다."}
        </p>
      )}
    </div>
  );
}
/* eslint-disable no-unused-vars -- Callback parameter names describe the public interface. */
function SessionRow({
  session,
  selected,
  unread,
  time,
  permission,
  disabled,
  select,
  mutate,
  afterHidden,
}: {
  session: WorkbenchSession & { storedTitle?: string };
  selected: boolean;
  unread: boolean;
  time: string;
  permission: boolean;
  disabled: boolean;
  select(): void;
  mutate(operation: MutationRequest, navigate?: boolean): Promise<boolean>;
  afterHidden(): void;
}) {
  /* eslint-enable no-unused-vars */
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState("");
  const [invalid, setInvalid] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const row = useRef<HTMLLIElement>(null);
  const busy = useRef(false);
  const id = useId();
  useEffect(() => {
    if (!renaming) return;
    // Let menu close/focus restoration settle before entering the inline form.
    const frame = requestAnimationFrame(() => {
      input.current?.focus();
      input.current?.select();
    });
    return () => cancelAnimationFrame(frame);
  }, [renaming]);
  const close = () => {
    setRenaming(false);
    row.current
      ?.querySelector<HTMLButtonElement>(`button[aria-label]`)
      ?.focus();
  };
  type Action = Extract<
    MutationRequest,
    {
      type:
        | "session.rename"
        | "session.pin"
        | "session.archive"
        | "session.fork"
        | "session.remove";
    }
  >;
  const run = async (action: Action, navigate = false, hidden = false) => {
    if (disabled || busy.current) return;
    busy.current = true;
    try {
      const ok = await mutate(action, navigate);
      if (ok) {
        close();
        if (hidden) afterHidden();
      }
    } finally {
      busy.current = false;
    }
  };
  const target = () => ({
    workspaceId: session.workspaceId,
    sessionId: session.id,
    requestId: crypto.randomUUID(),
  });
  return (
    <li ref={row}>
      <div
        className={`${styles.row} session-row`}
        data-selected={selected}
        data-session-status={session.status}
      >
        <button
          className={styles.sessionButton}
          aria-current={selected ? "page" : undefined}
          onClick={select}
          title={session.title}
        >
          <span className={styles.title}>{session.title}</span>
          {permission && (
            <span
              className={styles.statusDot}
              data-tone="warning"
              role="img"
              aria-label="권한 요청 대기"
              title="권한 요청 대기"
              data-session-permission
            />
          )}
          {unread && (
            <span
              className={`${styles.dot} ${styles.unread}`}
              role="img"
              aria-label="읽지 않은 응답"
              title="읽지 않은 응답"
              data-session-unread
            />
          )}
          {session.pinned && (
            <span className={styles.indicator} role="img" aria-label="고정">
              <Pin size={13} />
            </span>
          )}
          {session.status !== "idle" && (
            <span
              className={styles.statusDot}
              data-tone={
                ["unknown", "unavailable"].includes(session.status)
                  ? "danger"
                  : "running"
              }
              role="img"
              aria-label={labels[session.status]}
              title={labels[session.status]}
            />
          )}
          {time && <span className={styles.time}>{time}</span>}
        </button>
        <ActionMenu
          className={styles.menuTrigger ?? ""}
          label={`${session.title} 세션 작업`}
          trigger={<MoreHorizontal size={18} />}
          items={[
            {
              label: "이름 변경",
              disabled,
              onSelect: () => {
                // Never prefill a derived/fallback title: Enter would persist it.
                const stored = session.storedTitle ?? session.title;
                setTitle(isPlaceholderTitle(stored) ? "" : stored);
                setInvalid(false);
                setRenaming(true);
              },
            },
            {
              label: session.pinned ? "고정 해제" : "세션 고정",
              disabled,
              onSelect: () => {
                void run({
                  type: "session.pin",
                  ...target(),
                  pinned: !session.pinned,
                });
              },
            },
            {
              label: session.archived ? "세션 복원" : "세션 보관",
              disabled,
              onSelect: () => {
                void run(
                  {
                    type: "session.archive",
                    ...target(),
                    archived: !session.archived,
                  },
                  selected || Boolean(session.archived),
                  true,
                );
              },
            },
            {
              label: "전체 대화 기록으로 분기",
              disabled,
              onSelect: () => {
                void run({ type: "session.fork", ...target() }, true);
              },
            },
            {
              label: "대화 삭제…",
              disabled,
              danger: true,
              onSelect: () => {
                void run(
                  { type: "session.remove", ...target() },
                  selected,
                  true,
                );
              },
            },
          ]}
        />
      </div>
      {renaming && (
        <form
          className={`${styles.rename} session-actions`}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              close();
            }
          }}
          onSubmit={(event) => {
            event.preventDefault();
            if (!validSessionTitle(title)) {
              setInvalid(true);
              return;
            }
            void run({
              type: "session.rename",
              ...target(),
              title: title.trim(),
            });
          }}
        >
          <label htmlFor={id}>세션 이름</label>
          <Input
            ref={input}
            id={id}
            value={title}
            maxLength={120}
            aria-invalid={invalid}
            aria-describedby={invalid ? `${id}-error` : undefined}
            onChange={(event) => {
              setTitle(event.target.value);
              setInvalid(false);
            }}
          />
          {invalid && (
            <Notice tone="danger" id={`${id}-error`}>
              이름은 공백과 제어 문자를 제외한 1~120자로 입력하세요.
            </Notice>
          )}
          <div>
            <Button
              size="compact"
              intent="primary"
              type="submit"
              disabled={disabled}
            >
              이름 저장
            </Button>
            <Button size="compact" type="button" onClick={close}>
              취소
            </Button>
          </div>
        </form>
      )}
    </li>
  );
}
