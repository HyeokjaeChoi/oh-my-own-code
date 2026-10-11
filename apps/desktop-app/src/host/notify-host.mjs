// OS notifications are optional and best-effort; the in-app center is the source of truth.
// text is built by the renderer from generic templates; this host only bounds and forwards it.
export function createNotifyHost({
  Notification,
  isFocused,
  focusWindow,
  now = Date.now,
  dedupeMs = 10000,
}) {
  let failed = false;
  let clicked;
  // Several windows may echo the same entry; main shows each (text, target) once per window of time.
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
    show({ text, workspaceId, sessionId }) {
      const key = JSON.stringify([text, workspaceId, sessionId]);
      const t = now();
      for (const [k, at] of recent) if (t - at >= dedupeMs) recent.delete(k);
      if (recent.has(key)) return { shown: false };
      recent.set(key, t);
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
