import React from "react";
import type { ReactNode } from "react";
import { DropdownMenu } from "radix-ui";
import styles from "./action-menu.module.css";

export type ActionMenuProps = {
  label: string;
  trigger: ReactNode;
  items: Array<{
    label: string;
    onSelect: () => void;
    disabled?: boolean;
    danger?: boolean;
  }>;
  className?: string;
};

export function ActionMenu({
  label,
  trigger,
  items,
  className,
}: ActionMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className={[styles.trigger, className].filter(Boolean).join(" ")}
        >
          {trigger}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={styles.content}
          align="end"
          sideOffset={4}
          collisionPadding={12}
          aria-label={label}
        >
          {items.map((item, index) => (
            <DropdownMenu.Item
              key={`${item.label}-${index}`}
              className={styles.item}
              disabled={item.disabled ?? false}
              data-danger={item.danger || undefined}
              onSelect={item.onSelect}
            >
              {item.label}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
