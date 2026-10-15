import React from "react";
import type { ReactNode, Ref } from "react";
import { DropdownMenu } from "radix-ui";
import { Check } from "lucide-react";
import styles from "./action-menu.module.css";

export type ActionMenuItem =
  | { separator: true }
  | {
      label: string;
      onSelect: () => void;
      disabled?: boolean;
      danger?: boolean;
      icon?: ReactNode;
      /** Defined = radio item (menuitemradio); true marks the current choice. */
      checked?: boolean;
      /** Stable identifier exposed as data-value (tests, tooling). */
      value?: string;
    };

export type ActionMenuProps = {
  label: string;
  trigger: ReactNode;
  items: ActionMenuItem[];
  className?: string;
  contentClassName?: string;
  align?: "start" | "end";
  title?: string;
  triggerRef?: Ref<HTMLButtonElement>;
};

export function ActionMenu({
  label,
  trigger,
  items,
  className,
  contentClassName,
  align = "end",
  title,
  triggerRef,
}: ActionMenuProps) {
  const checkedIndex = items.findIndex(
    (item) => "checked" in item && item.checked,
  );
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          ref={triggerRef}
          type="button"
          aria-label={label}
          title={title}
          className={[styles.trigger, className].filter(Boolean).join(" ")}
        >
          {trigger}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          className={[styles.content, contentClassName]
            .filter(Boolean)
            .join(" ")}
          align={align}
          sideOffset={4}
          collisionPadding={12}
          aria-label={label}
        >
          <DropdownMenu.RadioGroup value={String(checkedIndex)}>
            {items.map((item, index) => {
              if ("separator" in item)
                return (
                  <DropdownMenu.Separator
                    key={`separator-${index}`}
                    className={styles.separator}
                  />
                );
              const common = {
                className: styles.item,
                disabled: item.disabled ?? false,
                "data-danger": item.danger || undefined,
                "data-value": item.value,
                onSelect: item.onSelect,
              };
              const body = (
                <>
                  {item.icon && (
                    <span className={styles.icon} aria-hidden="true">
                      {item.icon}
                    </span>
                  )}
                  <span className={styles.itemLabel}>{item.label}</span>
                </>
              );
              return item.checked === undefined ? (
                <DropdownMenu.Item key={`${item.label}-${index}`} {...common}>
                  {body}
                </DropdownMenu.Item>
              ) : (
                <DropdownMenu.RadioItem
                  key={`${item.label}-${index}`}
                  value={String(index)}
                  {...common}
                >
                  {body}
                  <DropdownMenu.ItemIndicator
                    className={styles.check}
                    aria-hidden="true"
                  >
                    <Check size={14} />
                  </DropdownMenu.ItemIndicator>
                </DropdownMenu.RadioItem>
              );
            })}
          </DropdownMenu.RadioGroup>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
