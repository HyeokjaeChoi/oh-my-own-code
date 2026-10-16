import { useCallback, useEffect, useState } from "react";
import { Kbd, Row, Section, Segmented, Switch } from "@workbench/ui";
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
import { ThemePicker } from "./theme-picker.js";
import styles from "./preferences.module.css";

export { ProviderSettings } from "./providers.js";
export { SavedRulesSettings } from "./saved-rules.js";

const DARK_QUERY = "(prefers-color-scheme: dark)";
const FONT_SIZES = [
  { value: "small", label: "작게" },
  { value: "medium", label: "보통" },
  { value: "large", label: "크게" },
] as const;
const DENSITIES = [
  { value: "comfortable", label: "여유롭게" },
  { value: "compact", label: "촘촘하게" },
] as const;
const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform);

type PreferenceProps = {
  preferences: Preferences;
  onChange: (patch: Partial<Preferences>) => void;
};

// Single owner of user preferences: loads, applies to the document root, persists.
export function usePreferences() {
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

// "일반": appearance and terminal accessibility. Every control applies at once.
export function GeneralSettings({ preferences, onChange }: PreferenceProps) {
  return (
    <>
      <Section title="화면">
        <ThemePicker
          value={preferences.theme}
          onChange={(theme) => onChange({ theme })}
        />
        <Row label="글자 크기">
          <Segmented
            name="pref-fontSize"
            aria-label="글자 크기"
            options={FONT_SIZES}
            value={preferences.fontSize}
            onChange={(fontSize) => onChange({ fontSize })}
          />
        </Row>
        <Row label="밀도">
          <Segmented
            name="pref-density"
            aria-label="밀도"
            options={DENSITIES}
            value={preferences.density}
            onChange={(density) => onChange({ density })}
          />
        </Row>
      </Section>
      <Section title="접근성">
        <Row
          label="터미널 스크린 리더 모드"
          htmlFor="pref-terminal-screen-reader"
          description="출력을 보조 기술이 읽을 수 있게 하지만 터미널이 느려질 수 있습니다."
        >
          <Switch
            id="pref-terminal-screen-reader"
            aria-describedby="pref-terminal-screen-reader-description"
            checked={preferences.terminalScreenReader}
            onChange={(event) =>
              onChange({ terminalScreenReader: event.target.checked })
            }
          />
        </Row>
      </Section>
    </>
  );
}

// "알림" page header row: OS notifications are an optional echo of the in-app list.
export function OsNotificationField({
  preferences,
  onChange,
}: PreferenceProps) {
  const [status, setStatus] = useState<NotifyStatus>();
  useEffect(() => {
    void callNotify<NotifyStatus>({ type: "notify.status" }).then(
      (r) => r.ok && setStatus(r.value),
    );
  }, []);
  const blocked = status ? !status.supported || status.failed : false;
  return (
    <Row
      htmlFor="pref-os-notifications"
      label="시스템 알림"
      description={
        blocked ? (
          <span role="status">
            이 환경에서는 시스템 알림을 사용할 수 없어 앱 안에서만 표시됩니다.
          </span>
        ) : (
          "앱이 백그라운드일 때 알립니다. 내용은 표시하지 않습니다."
        )
      }
    >
      <Switch
        id="pref-os-notifications"
        aria-describedby="pref-os-notifications-description"
        checked={preferences.osNotifications}
        onChange={(event) =>
          onChange({ osNotifications: event.target.checked })
        }
      />
    </Row>
  );
}

// ⌘ on macOS, Ctrl elsewhere; every other key is shown as written.
const glyphs = (keys: string) =>
  keys
    .split("+")
    .flatMap((part) => part.split(" "))
    .map((part) => (part === "Cmd/Ctrl" ? (IS_MAC ? "⌘" : "Ctrl") : part));

export function ShortcutsSettings() {
  return (
    <ul className={styles.shortcuts} aria-label="키보드 단축키">
      {SHORTCUTS.map(({ keys, action }) => (
        <li key={keys} className={styles.shortcut}>
          <span>{action}</span>
          <span className={styles.keys}>
            {glyphs(keys).map((key) => (
              <Kbd key={key}>{key}</Kbd>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}
