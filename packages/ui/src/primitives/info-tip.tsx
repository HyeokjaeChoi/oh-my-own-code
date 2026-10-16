import React, { type ReactNode } from "react";
import { Popover } from "radix-ui";
import { Info } from "lucide-react";
import styles from "./info-tip.module.css";

export type InfoTipProps = {
  children: ReactNode;
  label?: string;
};

// One quiet "i" button that discloses longer explanatory copy on demand.
export function InfoTip({ children, label = "설명 보기" }: InfoTipProps) {
  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button type="button" className={styles.trigger} aria-label={label}>
          <Info size={14} aria-hidden="true" />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          className={styles.content}
          side="bottom"
          align="start"
          sideOffset={6}
          collisionPadding={12}
        >
          {children}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
