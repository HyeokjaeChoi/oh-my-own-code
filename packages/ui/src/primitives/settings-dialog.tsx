import React, { useId, useRef } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import { Select } from "./controls.js";
import styles from "./settings-dialog.module.css";

export type SettingsNavItem<T extends string> = {
  id: T;
  label: string;
  icon?: ReactNode;
};

export type SettingsDialogProps<T extends string> = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  // Names the dialog for assistive technology and heads the nav column.
  title: string;
  items: ReadonlyArray<SettingsNavItem<T>>;
  page: T;
  onPageChange: (_page: T) => void;
  pageTitle?: ReactNode;
  pageDescription?: ReactNode;
  // Rendered inside an always-mounted polite live region (e.g. "저장됨").
  status?: ReactNode;
  children: ReactNode;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

// Centered two-column dialog: left navigation (a vertical tablist, collapsing
// to a select on narrow windows) and one scrolling content column.
export function SettingsDialog<T extends string>({
  open,
  onOpenChange,
  title,
  items,
  page,
  onPageChange,
  pageTitle,
  pageDescription,
  status,
  children,
  returnFocusRef,
}: SettingsDialogProps<T>) {
  const openingFocusRef = useRef<HTMLElement | null>(null);
  const base = useId();
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = `${base}-panel`;
  const current = items.find((item) => item.id === page) ?? items[0];

  const onTabKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = items.findIndex((item) => item.id === page);
    const last = items.length - 1;
    const next =
      event.key === "ArrowDown"
        ? (index + 1) % items.length
        : event.key === "ArrowUp"
          ? (index - 1 + items.length) % items.length
          : event.key === "Home"
            ? 0
            : event.key === "End"
              ? last
              : -1;
    if (next < 0) return;
    event.preventDefault();
    const item = items[next]!;
    onPageChange(item.id);
    document.getElementById(tabId(item.id))?.focus();
  };

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          aria-modal="true"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // A descendant scope (e.g. a cancellable observation) owns Escape.
            if (
              event.target instanceof Element &&
              event.target.closest("[data-escape-key-scope]")
            )
              event.preventDefault();
          }}
          onOpenAutoFocus={() => {
            openingFocusRef.current =
              document.activeElement instanceof HTMLElement
                ? document.activeElement
                : null;
          }}
          onCloseAutoFocus={(event) => {
            const target = returnFocusRef?.current ?? openingFocusRef.current;
            if (target?.isConnected) {
              event.preventDefault();
              target.focus({ preventScroll: true });
            }
          }}
        >
          <nav className={styles.nav} aria-label={`${title} 메뉴`}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <div
              role="tablist"
              aria-orientation="vertical"
              className={styles.tabs}
              onKeyDown={onTabKeyDown}
            >
              {items.map((item) => (
                <button
                  key={item.id}
                  id={tabId(item.id)}
                  type="button"
                  role="tab"
                  className={styles.tab}
                  aria-selected={item.id === current?.id}
                  aria-controls={panelId}
                  tabIndex={item.id === current?.id ? 0 : -1}
                  onClick={() => onPageChange(item.id)}
                >
                  {item.icon ? (
                    <span className={styles.icon} aria-hidden="true">
                      {item.icon}
                    </span>
                  ) : null}
                  {item.label}
                </button>
              ))}
            </div>
            <Select
              className={styles.compactNav}
              wrapperClassName={styles.compactNavWrap ?? ""}
              aria-label={`${title} 페이지`}
              value={current?.id}
              onChange={(event) => onPageChange(event.target.value as T)}
            >
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </Select>
          </nav>
          <div
            id={panelId}
            role="tabpanel"
            aria-labelledby={current ? tabId(current.id) : undefined}
            className={styles.panel}
          >
            <header className={styles.header}>
              <div className={styles.heading}>
                <h2 className={styles.pageTitle}>
                  {pageTitle ?? current?.label}
                </h2>
                {pageDescription ? (
                  <p className={styles.pageDescription}>{pageDescription}</p>
                ) : null}
              </div>
              <span className={styles.status} role="status" aria-live="polite">
                {status}
              </span>
            </header>
            <div className={styles.body} data-settings-body>
              {children}
            </div>
          </div>
          <Dialog.Close asChild>
            <button
              type="button"
              className={styles.close}
              aria-label={`${title} 닫기`}
            >
              <X size={16} aria-hidden="true" />
            </button>
          </Dialog.Close>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
