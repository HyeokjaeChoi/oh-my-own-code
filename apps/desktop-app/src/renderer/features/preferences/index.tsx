import { useCallback, useEffect, useState } from "react";
import { Button, ModalSheet } from "@workbench/ui";
import { Settings } from "lucide-react";
import {
  applyPreferences,
  loadPreferences,
  savePreferences,
  SHORTCUTS,
  type Preferences,
} from "../../shared/preferences/index.js";
import {
  callNotify,
  type NotifyStatus,
} from "../../shared/notifications/index.js";
import { OPEN_SETTINGS_EVENT } from "../../shared/palette/index.js";
import { ProviderSettings } from "./providers.js";
import styles from "./preferences.module.css";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const FIELDS = [
  [
    "theme",
    "테마",
    [
      ["system", "시스템 설정 따르기"],
      ["light", "라이트"],
      ["dark", "다크"],
    ],
  ],
  [
    "fontSize",
    "글자 크기",
    [
      ["small", "작게"],
      ["medium", "보통"],
      ["large", "크게"],
    ],
  ],
  [
    "density",
    "밀도",
    [
      ["comfortable", "여유롭게"],
      ["compact", "촘촘하게"],
    ],
  ],
] as const;

// Single owner of user preferences: loads, applies to the document root, persists.
function usePreferences() {
  const [preferences, setPreferences] = useState<Preferences>(() =>
    loadPreferences(),
  );
  const [systemDark, setSystemDark] = useState(
    () => window.matchMedia?.(DARK_QUERY).matches ?? false,
  );
  useEffect(() => {
    const query = window.matchMedia?.(DARK_QUERY);
    if (!query) return;
    const onChange = (event: MediaQueryListEvent) =>
      setSystemDark(event.matches);
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, []);
  useEffect(() => {
    applyPreferences(document.documentElement, preferences, systemDark);
  }, [preferences, systemDark]);
  const update = useCallback((patch: Partial<Preferences>) => {
    setPreferences((current) => {
      const next = { ...current, ...patch };
      savePreferences(next);
      return next;
    });
  }, []);
  return { preferences, update };
}

function OsNotificationField(props: {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
}) {
  const [status, setStatus] = useState<NotifyStatus>();
  useEffect(() => {
    void callNotify<NotifyStatus>({ type: "notify.status" }).then(
      (r) => r.ok && setStatus(r.value),
    );
  }, []);
  const blocked = status ? !status.supported || status.failed : false;
  return (
    <label className={styles.field}>
      <span>
        OS 알림 (창이 비활성일 때, 내용 없이 알림만)
        {blocked && (
          <small role="status">
            {" "}
            이 환경에서는 OS 알림을 사용할 수 없어 앱 안에서만 표시됩니다.
          </small>
        )}
      </span>
      <input
        type="checkbox"
        checked={props.preferences.osNotifications}
        onChange={(event) =>
          props.onChange({ osNotifications: event.target.checked })
        }
      />
    </label>
  );
}

export function PreferencesSheetView(props: {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
}) {
  return (
    <>
      {FIELDS.map(([key, label, options]) => (
        <label key={key} className={styles.field}>
          <span>{label}</span>
          <select
            value={props.preferences[key]}
            onChange={(event) =>
              props.onChange({
                [key]: event.target.value,
              } as Partial<Preferences>)
            }
          >
            {options.map(([value, text]) => (
              <option key={value} value={value}>
                {text}
              </option>
            ))}
          </select>
        </label>
      ))}
      <OsNotificationField {...props} />
      <ProviderSettings />
      <h3 className={styles.subheading}>키보드 단축키</h3>
      <dl className={styles.shortcuts}>
        {SHORTCUTS.map(({ keys, action }) => (
          <div key={keys} className={styles.shortcut}>
            <dt>
              <kbd>{keys}</kbd>
            </dt>
            <dd>{action}</dd>
          </div>
        ))}
      </dl>
    </>
  );
}

export function PreferencesButton() {
  const { preferences, update } = usePreferences();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener(OPEN_SETTINGS_EVENT, onOpen);
    return () => window.removeEventListener(OPEN_SETTINGS_EVENT, onOpen);
  }, []);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "?" || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (event.isComposing || event.defaultPrevented) return;
      if (
        (event.target as Element | null)?.closest?.(
          "input, textarea, select, [contenteditable]",
        )
      )
        return;
      event.preventDefault();
      setOpen(true);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);
  return (
    <>
      <Button
        size="compact"
        aria-label="설정·단축키"
        title="설정·단축키"
        onClick={() => setOpen(true)}
      >
        <Settings size={18} />
      </Button>
      <ModalSheet open={open} onOpenChange={setOpen} title="설정">
        <PreferencesSheetView preferences={preferences} onChange={update} />
      </ModalSheet>
    </>
  );
}
