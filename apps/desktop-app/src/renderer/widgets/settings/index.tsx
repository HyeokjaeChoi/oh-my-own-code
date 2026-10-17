import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import { SettingsDialog, type SettingsNavItem } from "@workbench/ui";
import {
  Bell,
  Clock,
  Cpu,
  Database,
  Keyboard,
  Puzzle,
  ShieldCheck,
  SlidersHorizontal,
} from "lucide-react";
import {
  selectors,
  useWindowWorkbench,
  useWorkbenchSelector,
} from "../../entities/workbench/index.js";
import type { WorkbenchMessage } from "../../shared/api/index.js";
import {
  OPEN_AUTOMATION_EVENT,
  OPEN_DATA_EVENT,
  OPEN_EXTENSIONS_EVENT,
  OPEN_NOTIFICATIONS_EVENT,
  OPEN_SETTINGS_EVENT,
  type SettingsPage,
} from "../../shared/palette/index.js";
import {
  GeneralSettings,
  OsNotificationField,
  ProviderSettings,
  SavedRulesSettings,
  ShortcutsSettings,
  usePreferences,
} from "../../features/preferences/index.js";
import {
  noProviderConnected,
  useProviderList,
} from "../../features/onboarding/index.js";
import { NotificationList } from "../../features/notifications/index.js";
import { AutomationSettings } from "../../features/automation/index.js";
import { DataSettings } from "../../features/data-transfer/index.js";
import {
  ExtensionsSettings,
  SUB_TITLES,
  type ExtensionSub,
} from "./extensions.js";

const ICON = 16;
const ITEMS: SettingsNavItem<SettingsPage>[] = [
  { id: "general", label: "일반", icon: <SlidersHorizontal size={ICON} /> },
  { id: "models", label: "모델", icon: <Cpu size={ICON} /> },
  { id: "permissions", label: "권한", icon: <ShieldCheck size={ICON} /> },
  { id: "extensions", label: "확장", icon: <Puzzle size={ICON} /> },
  { id: "notifications", label: "알림", icon: <Bell size={ICON} /> },
  { id: "automation", label: "자동화", icon: <Clock size={ICON} /> },
  { id: "data", label: "데이터", icon: <Database size={ICON} /> },
  { id: "shortcuts", label: "단축키", icon: <Keyboard size={ICON} /> },
];
const PAGES = new Set<string>(ITEMS.map((item) => item.id));
const DESCRIPTIONS: Partial<Record<SettingsPage, string>> = {
  models: "모델 제공자와 기본 모델을 관리합니다.",
  permissions: "‘항상 허용’으로 저장한 규칙입니다.",
  notifications: "완료·오류·승인 요청을 모아 둡니다.",
  automation: "정해진 시간에 프롬프트나 스크립트를 실행합니다.",
  data: "대화를 내보내고, 가져온 기록과 앱 데이터를 관리합니다.",
};

// The only settings surface: one centered dialog, opened at a page by event.
// Always mounted so preferences keep applying to the document root.
export function SettingsHost({
  session,
  messages,
  returnFocusRef,
  fallbackFocusRef,
}: {
  session: { id: string; title: string } | undefined;
  messages: WorkbenchMessage[];
  returnFocusRef?: RefObject<HTMLElement | null>;
  // Where focus goes when the opener is no longer visible.
  fallbackFocusRef?: RefObject<HTMLElement | null>;
}) {
  const { actions } = useWindowWorkbench();
  const { preferences, update } = usePreferences();
  const catalog = useWorkbenchSelector(selectors.catalog);
  const catalogError = useWorkbenchSelector((s) => s.catalogError);
  const workspace = useWorkbenchSelector((s) =>
    s.lists.workspaces.find((w) => w.id === s.selection.workspaceId),
  );
  const providerList = useProviderList();
  const noProvider = useRef(false);
  noProvider.current = noProviderConnected(providerList);
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState<SettingsPage>("general");
  const [sub, setSub] = useState<ExtensionSub | null>(null);
  const [saved, setSaved] = useState(false);
  const savedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const localReturn = useRef<HTMLElement | null>(null);
  const openRef = useRef(false);
  openRef.current = open;

  const flash = useCallback(() => {
    setSaved(true);
    clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2000);
  }, []);
  useEffect(() => () => clearTimeout(savedTimer.current), []);
  const commit = useCallback(
    (patch: Parameters<typeof update>[0]) => {
      update(patch);
      flash();
    },
    [update, flash],
  );

  const show = useCallback(
    (next: SettingsPage, nextSub: ExtensionSub | null = null) => {
      // The opener hands its focus target over once; never reuse a stale one.
      localReturn.current = returnFocusRef?.current ?? null;
      if (returnFocusRef) returnFocusRef.current = null;
      setPage(next);
      setSub(nextSub);
      setSaved(false);
      setOpen(true);
    },
    [returnFocusRef],
  );
  useEffect(() => {
    const on = (name: string, next?: SettingsPage) => {
      const handler = (event: Event) => {
        const { page: detail, sub: subDetail } =
          (event as CustomEvent<{ page?: string; sub?: string }>).detail ?? {};
        show(
          next ??
            (detail && PAGES.has(detail)
              ? (detail as SettingsPage)
              : // With nothing connected, the only useful page is 모델.
                noProvider.current
                ? "models"
                : "general"),
          next === "extensions" && subDetail && subDetail in SUB_TITLES
            ? (subDetail as ExtensionSub)
            : null,
        );
      };
      window.addEventListener(name, handler);
      return () => window.removeEventListener(name, handler);
    };
    const offs = [
      on(OPEN_SETTINGS_EVENT),
      on(OPEN_NOTIFICATIONS_EVENT, "notifications"),
      on(OPEN_AUTOMATION_EVENT, "automation"),
      on(OPEN_DATA_EVENT, "data"),
      on(OPEN_EXTENSIONS_EVENT, "extensions"),
    ];
    return () => offs.forEach((off) => off());
  }, [show]);
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
      // Already open: the key must not navigate away from the current page.
      if (!openRef.current) show("general");
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [show]);

  let content: ReactNode;
  switch (page) {
    case "general":
      content = <GeneralSettings preferences={preferences} onChange={commit} />;
      break;
    case "models":
      content = <ProviderSettings onSaved={flash} />;
      break;
    case "permissions":
      content = <SavedRulesSettings />;
      break;
    case "extensions":
      content = (
        <ExtensionsSettings
          catalog={catalog}
          error={catalogError}
          refresh={actions.refresh}
          sub={sub}
          onSubChange={setSub}
        />
      );
      break;
    case "notifications":
      content = (
        <>
          <OsNotificationField preferences={preferences} onChange={commit} />
          <NotificationList onNavigate={() => setOpen(false)} />
        </>
      );
      break;
    case "automation":
      content = <AutomationSettings />;
      break;
    case "data":
      content = <DataSettings session={session} messages={messages} />;
      break;
    default:
      content = <ShortcutsSettings />;
  }

  return (
    <SettingsDialog
      open={open}
      onOpenChange={setOpen}
      title="설정"
      items={ITEMS}
      page={page}
      onPageChange={(next) => {
        setPage(next);
        setSub(null);
      }}
      pageDescription={
        page === "extensions"
          ? workspace
            ? `작업 공간: ${workspace.name}`
            : "작업 공간을 선택하세요."
          : DESCRIPTIONS[page]
      }
      status={saved ? "저장됨" : undefined}
      returnFocusRef={localReturn}
      {...(fallbackFocusRef && { fallbackFocusRef })}
    >
      {content}
    </SettingsDialog>
  );
}
