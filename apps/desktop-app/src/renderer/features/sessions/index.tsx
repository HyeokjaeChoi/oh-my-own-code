import type { MutationRequest } from "../../shared/transport/index.js";
import {
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { ActionMenu } from "@workbench/ui";
import {
  Archive,
  CircleAlert,
  LoaderCircle,
  MoreHorizontal,
  Pin,
  Search,
} from "lucide-react";
import type { WorkbenchSession } from "../../shared/api/index.js";
import {
  emptyActivity,
  trackSessions,
  visibleSessions,
  validSessionTitle,
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
  sessions: WorkbenchSession[];
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
let activity: SessionActivity = emptyActivity;
const listeners = new Set<() => void>();
function track(sessions: WorkbenchSession[], selectedId?: string) {
  const next = trackSessions(activity, sessions, selectedId);
  if (JSON.stringify(next) === JSON.stringify(activity)) return;
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
  const { unread, recent } = useSessionActivity(
    props.sessions,
    props.selectedId,
  );
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
        <label className={`${styles.search} session-search`}>
          <span className={styles.srOnly}>세션 검색</span>
          <input
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
      {!archived && !query && (
        <div className={styles.views} aria-label="최근 연 세션">
          {recent
            .map((id) =>
              props.sessions.find(
                (s) =>
                  s.id === id &&
                  s.workspaceId === props.workspaceId &&
                  !s.archived &&
                  s.id !== props.selectedId,
              ),
            )
            .filter((s): s is WorkbenchSession => Boolean(s))
            .map((s) => (
              <button
                key={s.id}
                title={s.title}
                disabled={
                  props.disabled ||
                  props.pending ||
                  s.status !== "idle" ||
                  props.unknownIds.includes(s.id)
                }
                onClick={() => props.select(s.id)}
              >
                {s.title.length > 14 ? `${s.title.slice(0, 14)}…` : s.title}
              </button>
            ))}
        </div>
      )}
      <ul className={`${styles.list} session-list`}>
        {sessions.map((session) => (
          <SessionRow
            key={session.id}
            session={session}
            selected={session.id === props.selectedId}
            unread={unread.includes(session.id)}
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
        ))}
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
  permission,
  disabled,
  select,
  mutate,
  afterHidden,
}: {
  session: WorkbenchSession;
  selected: boolean;
  unread: boolean;
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
              className={`${styles.dot} ${styles.permission}`}
              role="img"
              aria-label="권한 요청 대기"
              data-session-permission
            />
          )}
          {unread && (
            <span
              className={`${styles.dot} ${styles.unread}`}
              role="img"
              aria-label="읽지 않은 응답"
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
              className={styles.indicator}
              role="img"
              aria-label={labels[session.status]}
            >
              {["unknown", "unavailable"].includes(session.status) ? (
                <CircleAlert size={14} />
              ) : (
                <LoaderCircle size={14} className={styles.spinner} />
              )}
            </span>
          )}
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
                setTitle(session.title);
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
          <input
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
            <p id={`${id}-error`} className={styles.error} role="alert">
              이름은 공백과 제어 문자를 제외한 1~120자로 입력하세요.
            </p>
          )}
          <div>
            <button type="submit" disabled={disabled}>
              이름 저장
            </button>
            <button type="button" onClick={close}>
              취소
            </button>
          </div>
        </form>
      )}
    </li>
  );
}
