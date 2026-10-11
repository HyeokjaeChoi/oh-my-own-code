import { useCallback, useEffect, useRef, useState } from "react";
import { Button, ModalSheet } from "@workbench/ui";
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
  callNotify,
  deriveJobNotices,
  deriveSessionNotices,
  mergeNotices,
  type Notice,
  type NoticeSnapshot,
  type NoticeSpec,
} from "../../shared/notifications/index.js";
import { loadPreferences } from "../../shared/preferences/index.js";
import { OPEN_NOTIFICATIONS_EVENT } from "../../shared/palette/index.js";
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
function save(list: Notice[]) {
  try {
    globalThis.localStorage?.setItem(
      NOTIFICATIONS_STORAGE_KEY,
      JSON.stringify(list),
    );
  } catch {
    // Blocked storage: the list lasts for this session only.
  }
}
const KIND: Record<string, string> = {
  done: "완료",
  error: "오류",
  approval: "승인",
  job: "자동화",
};

// In-app center is the source of truth; OS notifications are an optional, generic-text echo.
export function NotificationCenter() {
  const { actions } = useWindowWorkbench();
  const lists = useWorkbenchSelector(selectors.lists);
  const snapshot = useWorkbenchSelector(selectors.snapshot);
  const [list, setList] = useState<Notice[]>(load);
  const [open, setOpen] = useState(false);
  const prev = useRef<NoticeSnapshot | undefined>(undefined);
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
          text: n.text,
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
      if (!stop && r.ok)
        push(deriveJobNotices(r.value.jobs, r.value.startedAt));
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

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_NOTIFICATIONS_EVENT, onOpen);
  }, []);

  const unread = list.filter((n) => !n.read).length;
  const update = (next: Notice[]) => {
    setList(next);
    save(next);
  };
  return (
    <>
      <Button
        size="compact"
        aria-label={`알림 ${unread}건 읽지 않음`}
        title="알림"
        onClick={() => setOpen(true)}
      >
        <Bell size={18} />
        {unread > 0 && <span className={styles.badge}>{unread}</span>}
      </Button>
      <ModalSheet open={open} onOpenChange={setOpen} title="알림">
        <div className={styles.toolbar}>
          <Button
            size="compact"
            onClick={() => update(list.map((n) => ({ ...n, read: true })))}
          >
            모두 읽음
          </Button>
          <Button size="compact" onClick={() => update([])}>
            비우기
          </Button>
        </div>
        {!list.length && <p>알림이 없습니다.</p>}
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
                    setOpen(false);
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
      </ModalSheet>
    </>
  );
}
