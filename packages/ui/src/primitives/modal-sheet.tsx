import React, { useRef } from "react";
import type { ReactNode, RefObject } from "react";
import { Dialog } from "radix-ui";
import { X } from "lucide-react";
import styles from "./modal-sheet.module.css";

export type ModalSheetProps = {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  title: string;
  children: ReactNode;
  side?: "left" | "right";
  // Content that owns its own padding and scrolling (panels, navigation).
  flush?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
};

export function ModalSheet({
  open,
  onOpenChange,
  title,
  children,
  side = "right",
  flush = false,
  returnFocusRef,
}: ModalSheetProps) {
  const openingFocusRef = useRef<HTMLElement | null>(null);

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange} modal>
      <Dialog.Portal>
        <Dialog.Overlay className={styles.overlay} />
        <Dialog.Content
          className={styles.content}
          data-side={side}
          aria-modal="true"
          aria-describedby={undefined}
          onEscapeKeyDown={(event) => {
            // Radix observes Escape at document capture, before a descendant's
            // React handler. An explicit local scope consumes Escape itself;
            // keep the sheet open so that handler can focus its local status.
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
          <header className={styles.header}>
            <Dialog.Title className={styles.title}>{title}</Dialog.Title>
            <Dialog.Close asChild>
              <button
                type="button"
                className={styles.close}
                aria-label={`${title} 닫기`}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </Dialog.Close>
          </header>
          <div className={styles.body} data-flush={flush || undefined}>
            {children}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
