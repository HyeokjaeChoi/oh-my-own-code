export {
  NOTIFICATION_LIMIT,
  NOTIFICATIONS_STORAGE_KEY,
  NOTIFICATION_JOB_MARK_KEY,
  jobNoticeMark,
  sessionText,
  jobText,
  deriveSessionNotices,
  deriveJobNotices,
  mergeNotices,
} from "./index.mjs";
export type {
  NoticeKind,
  NoticeSpec,
  Notice,
  NoticeSnapshot,
} from "./index.mjs";
export type NotifyStatus = {
  supported: boolean;
  failed: boolean;
};
export async function callNotify<T>(
  request:
    | { type: "notify.status" }
    | {
        type: "notify.show";
        text: string;
        workspaceId?: string;
        sessionId?: string;
      }
    | { type: "notify.clicked" },
): Promise<{ ok: true; value: T } | { ok: false; code: string }> {
  try {
    return (await window.desktopBridge.notify(request)) as {
      ok: true;
      value: T;
    };
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
