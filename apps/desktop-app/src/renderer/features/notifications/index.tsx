import { useCallback, useEffect, useRef, useState } from "react";
import { Button, EmptyState } from "@workbench/ui";
import { Bell } from "lucide-react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import type { AutomationList } from "../../shared/automation/index.js";
import { callAutomation } from "../../shared/automation/index.js";
import {
  NOTIFICATIONS_STORAGE_KEY,
  NOTIFICATION_JOB_MARK_KEY,
  NOTIFICATIONS_CLEARED_KEY,
  jobNoticeMark,
  callNotify,
  deriveJobNotices,
  deriveSessionNotices,
  mergeNotices,
  unionNotices,
  type Notice,
  type NoticeSnapshot,
  type NoticeSpec,
} from "../../shared/notifications/index.js";
import { loadPreferences } from "../../shared/preferences/index.js";
import { openSettingsPage } from "../../shared/palette/index.js";
import styles from "./notifications.module.css";

function load(): Notice[] {
  try {
    const v = JSON.parse(
      globalThis.localStorage?.getItem(NOTIFICATIONS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
// Same-window subscribers (badge + settings list) reload from storage on this.
const CHANGED_EVENT = "omoc:notices-changed";
function save(list: Notice[]) {
  try {
    globalThis.localStorage?.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify(list),
    );
  } catch {
    // Blocked storage: the list lasts for this session only.
  }
  globalThis.dispatchEvent?.(new Event(CHANGED_EVENT));
}
function loadMark(): number {
  try {
    const v = Number(
      globalThis.localStorage?.getItem(NOTIFICATION_JOB_MARK_KEY),
    );
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
function saveMark(v: number) {
  try {
    globalThis.localStorage?.setItem(NOTIFICATION_JOB_MARK_KEY, String(v));
  } catch {
    // Blocked storage: the mark lasts for this session only.
  }
}
function loadCleared(): number {
  try {
    const v = Number(
      globalThis.localStorage?.getItem(NOTIFICATIONS_CLEARED_KEY),
    );
    return Number.isFinite(v) ? v : 0;
  } catch {
    return 0;
  }
}
function saveCleared(v: number) {
  try {
    globalThis.localStorage?.setItem(NOTIFICATIONS_CLEARED_KEY, String(v));
  } catch {
    // Blocked storage: other windows will not see the clear.
  }
}
const KIND: Record<string, string> = {
  done: "완료",
  error: "오류",
  approval: "승인",
  job: "자동화",
};

// In-app center is the source of truth; OS notifications are an optional, generic-text echo.
// This mounts for the app's lifetime: it derives notices and owns the unread badge.
export function NotificationCenter({
  badgeOnly = false,
}: {
  /** Header "더 보기" owns the entry point; show the bell only while unread. */
  badgeOnly?: boolean;
}) {
  const { actions } = useWindowWorkbench();
  const lists = useWorkbenchSelector(selectors.lists);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const [list, setList] = useState<Notice[]>(load);
  const prev = useRef<NoticeSnapshot | undefined>(undefined);
  const jobMark = useRef(loadMark());
  const listRef = useRef(list);
  listRef.current = list;
  const push = useCallback((specs: NoticeSpec[]) => {
    if (!specs.length) return;
    const { added, list: next } = mergeNotices(
      listRef.current,
      specs,
      Date.now(),
    );
    if (!added.length) return;
    listRef.current = next;
    setList(next);
    save(next);
    if (loadPreferences().osNotifications)
      for (const n of added.slice(0, 3))
        void callNotify({
          type: "notify.show",
          id: n.id,
          text: n.os ?? n.text,
          ...(n.workspaceId ? { workspaceId: n.workspaceId } : {}),
          ...(n.sessionId ? { sessionId: n.sessionId } : {}),
        });
  }, []);

  useEffect(() => {
    const next: NoticeSnapshot = {
      sessions: lists.sessions.map((s) => ({
        id: s.id,
        workspaceId: s.workspaceId,
        title: s.title,
        status: s.status,
      })),
      permissions: (snapshot?.permissions ?? []).map((p) => ({
        id: p.id,
        sessionId: p.sessionId,
      })),
    };
    push(deriveSessionNotices(prev.current, next, Date.now()));
    prev.current = next;
  }, [lists, snapshot, push]);

  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const r = await callAutomation<AutomationList>({
        type: "automation.list",
      });
      if (!stop && r.ok) {
        push(
          deriveJobNotices(r.value.jobs, r.value.startedAt, jobMark.current),
        );
        const mark = jobNoticeMark(r.value.jobs, jobMark.current);
        if (mark !== jobMark.current) {
          jobMark.current = mark;
          saveMark(mark);
        }
      }
      const c = await callNotify<{
        workspaceId: string;
        sessionId: string;
      } | null>({ type: "notify.clicked" });
      if (!stop && c.ok && c.value)
        actions.select(c.value.workspaceId, c.value.sessionId);
    };
    void tick();
    const t = setInterval(() => void tick(), 5000);
    return () => {
      stop = true;
      clearInterval(t);
    };
  }, [push, actions]);

  // Other windows write the same keys: union their list (never overwrite) and follow their job mark.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (
        e.key === NOTIFICATIONS_STORAGE_KEY ||
        e.key === NOTIFICATIONS_CLEARED_KEY
      ) {
        const next = unionNotices(listRef.current, load(), loadCleared());
        listRef.current = next;
        setList(next);
      } else if (e.key === NOTIFICATION_JOB_MARK_KEY)
        jobMark.current = Math.max(jobMark.current, loadMark());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  // The settings list edits the same storage; follow it.
  useEffect(() => {
    const onChanged = () => {
      const next = load();
      listRef.current = next;
      setList(next);
    };
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, []);

  const unread = list.filter((n) => !n.read).length;
  if (badgeOnly && unread === 0) return null;
  return (
    <Button
      size="compact"
      aria-label={`알림 ${unread}건 읽지 않음`}
      title="알림"
      onClick={() => openSettingsPage("notifications")}
    >
      <span className={styles.bell}>
        <Bell size={16} />
        {unread > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </span>
    </Button>
  );
}

// "알림" page content: the in-app list. Edits go through storage so the badge follows.
export function NotificationList({ onNavigate }: { onNavigate?: () => void }) {
  const { actions } = useWindowWorkbench();
  const [list, setList] = useState<Notice[]>(load);
  useEffect(() => {
    const onChanged = () => setList(load());
    window.addEventListener(CHANGED_EVENT, onChanged);
    return () => window.removeEventListener(CHANGED_EVENT, onChanged);
  }, []);
  const update = (next: Notice[]) => {
    setList(next);
    save(next);
  };
  return (
    <>
      <div className={styles.toolbar}>
        <Button
          size="compact"
          disabled={!list.some((n) => !n.read)}
          onClick={() => update(list.map((n) => ({ ...n, read: true })))}
        >
          모두 읽음
        </Button>
        <Button
          size="compact"
          disabled={!list.length}
          onClick={() => {
            saveCleared(Date.now());
            update([]);
          }}
        >
          비우기
        </Button>
      </div>
      {!list.length && <EmptyState title="알림이 없습니다." />}
      <ul className={styles.list}>
        {list.map((n) => (
          <li key={n.id} data-unread={!n.read}>
            <button
              type="button"
              className={styles.item}
              onClick={() => {
                update(
                  list.map((x) => (x.id === n.id ? { ...x, read: true } : x)),
                );
                if (n.workspaceId && n.sessionId) {
                  actions.select(n.workspaceId, n.sessionId);
                  onNavigate?.();
                }
              }}
            >
              <span>
                <small>{KIND[n.kind]}</small> {n.text}
              </span>
              <small>{new Date(n.at).toLocaleString()}</small>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}
