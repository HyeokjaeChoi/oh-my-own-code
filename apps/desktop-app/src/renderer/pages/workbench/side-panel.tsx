import { useRef, type KeyboardEvent, type ReactNode } from "react";
import { Button } from "@workbench/ui";
import {
  FileDiff,
  Folder,
  Globe,
  ClipboardCheck,
  ListChecks,
  SquareTerminal,
  X,
  type LucideIcon,
} from "lucide-react";
import type { Panel } from "../../entities/workbench/index.js";
import styles from "./side-panel.module.css";

export const PANEL_TABS: { id: Panel; label: string; icon: LucideIcon }[] = [
  { id: "files", label: "파일", icon: Folder },
  { id: "changes", label: "변경", icon: FileDiff },
  { id: "work", label: "작업", icon: ListChecks },
  { id: "plan", label: "계획", icon: ClipboardCheck },
  { id: "terminal", label: "터미널", icon: SquareTerminal },
  { id: "preview", label: "미리보기", icon: Globe },
];
export const panelTabId = (panel: Panel) => `side-panel-tab-${panel}`;
export const panelBodyId = "side-panel-body";

// One 40px header row: tablist + close. Labels collapse to icons by container width.
export function SidePanel({
  panel,
  onSelect,
  onClose,
  fill,
  children,
}: {
  panel: Panel;
  onSelect: (panel: Panel) => void;
  onClose?: (() => void) | undefined;
  fill?: boolean;
  children: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  // Manual activation: arrows only move focus, Enter/Space (a native click) selects.
  const move = (event: KeyboardEvent<HTMLDivElement>) => {
    const tabs = [
      ...(list.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ??
        []),
    ];
    const at = tabs.indexOf(document.activeElement as HTMLButtonElement);
    if (at < 0) return;
    const next =
      event.key === "ArrowRight"
        ? (at + 1) % tabs.length
        : event.key === "ArrowLeft"
          ? (at + tabs.length - 1) % tabs.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? tabs.length - 1
              : -1;
    if (next < 0) return;
    event.preventDefault();
    tabs[next]?.focus();
  };
  return (
    <>
      <div className={styles.header}>
        <div
          ref={list}
          role="tablist"
          aria-label="보조 패널 보기"
          className={`${styles.tabs} panel-tabs`}
          onKeyDown={move}
        >
          {PANEL_TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              id={panelTabId(id)}
              type="button"
              role="tab"
              aria-selected={panel === id}
              aria-controls={panelBodyId}
              aria-label={label}
              title={label}
              tabIndex={panel === id ? 0 : -1}
              className={styles.tab}
              onClick={() => onSelect(id)}
            >
              <Icon size={16} aria-hidden="true" className={styles.tabIcon} />
              <span className={styles.tabLabel}>{label}</span>
            </button>
          ))}
        </div>
        {onClose && (
          <Button
            size="compact"
            className={styles.close}
            aria-label="상세 패널 닫기"
            title="상세 패널 닫기"
            onClick={onClose}
          >
            <X size={16} aria-hidden="true" />
          </Button>
        )}
      </div>
      <div
        id={panelBodyId}
        role="tabpanel"
        aria-labelledby={panelTabId(panel)}
        className={`${styles.body} ${fill ? styles.fill : ""}`}
        data-panel={panel}
      >
        {children}
      </div>
    </>
  );
}
