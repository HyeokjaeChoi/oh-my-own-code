// OS notifications are optional and best-effort; the in-app center is the source of truth.
// text is built by the renderer from generic templates; this host only bounds and forwards it.
export function createNotifyHost({
  Notification,
  isFocused,
  focusWindow,
  now = Date.now,
  dedupeMs = 10000,
  sessionDedupeMs = 3000,
}) {
  let failed = false;
  let clicked;
  // Several windows may echo the same entry; main shows each notice id once per window of time.
  const recent = new Map();
  const supported = () => {
    try {
      return Boolean(Notification?.isSupported?.());
    } catch {
      return false;
    }
  };
  return {
    status: () => ({ supported: supported(), failed }),
    show({ id, text, workspaceId, sessionId }) {
      // done/error ids carry a per-window timestamp; those dedupe by (kind, session) instead.
      const kind = id?.split(":", 1)[0];
      const bySession = sessionId && (kind === "done" || kind === "error");
      const key = bySession
        ? `${kind}:${sessionId}`
        : (id ?? JSON.stringify([text, workspaceId, sessionId]));
      const ms = bySession ? sessionDedupeMs : dedupeMs;
      const t = now();
      for (const [k, e] of recent) if (t - e.at >= e.ms) recent.delete(k);
      if (recent.has(key)) return { shown: false };
      recent.set(key, { at: t, ms });
      if (!supported() || isFocused()) return { shown: false };
      try {
        const n = new Notification({
          title: "Oh My Own Code",
          body: String(text).slice(0, 200),
          silent: true,
        });
        n.on("click", () => {
          focusWindow();
          if (sessionId && workspaceId) clicked = { workspaceId, sessionId };
        });
        n.show();
        failed = false;
        return { shown: true };
      } catch {
        failed = true;
        return { shown: false };
      }
    },
    takeClicked() {
      const c = clicked;
      clicked = undefined;
      return c ?? null;
    },
  };
}
