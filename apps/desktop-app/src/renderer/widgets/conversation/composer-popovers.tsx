import {
  useId,
  useRef,
  type ComponentPropsWithoutRef,
  type CSSProperties,
  type ReactNode,
} from "react";
import styles from "./conversation.module.css";

/* Native popover + CSS anchor positioning: the browser top layer, light
   dismiss and Esc handling come for free. The CSS keeps every panel above the
   composer card (never over the input) and aligned to its own trigger. */
const anchorStyle = (anchor: string, above?: string) =>
  ({
    "--anchor": anchor,
    ...(above ? { "--above": above } : {}),
  }) as CSSProperties;

export function PopoverTrigger({
  id,
  anchor,
  className,
  children,
  ...rest
}: {
  id: string;
  anchor: string;
  className: string | undefined;
  children: ReactNode;
  "aria-label": string;
} & Omit<
  ComponentPropsWithoutRef<"button">,
  "id" | "className" | "style" | "type" | "popoverTarget" | "children"
>) {
  return (
    <button
      type="button"
      className={className}
      popoverTarget={id}
      style={anchorStyle(anchor)}
      {...rest}
    >
      {children}
    </button>
  );
}

// On open, focus moves to the selected radio or the first actionable control
// unless the content already took focus (the model search field does).
// Closing a popover returns focus to its trigger natively.
const FOCUS_TARGET =
  'input:checked, [data-autofocus], button:not(:disabled), input:not(:disabled):not([type="radio"])';
// `opener` is read in beforetoggle (sync); toggle fires a task later, when
// focus may already have moved elsewhere (e.g. back to the composer): keep it.
function focusFirst(panel: HTMLElement, opener: Element | null) {
  requestAnimationFrame(() => {
    if (
      !panel.matches(":popover-open") ||
      panel.contains(document.activeElement) ||
      (document.activeElement !== opener &&
        document.activeElement !== document.body)
    )
      return;
    panel
      .querySelector<HTMLElement>(FOCUS_TARGET)
      ?.focus({ preventScroll: true });
  });
}

export function PopoverPanel({
  id,
  anchor,
  above,
  className,
  title,
  label,
  role = "group",
  align = "end",
  onToggle,
  children,
}: {
  id: string;
  anchor: string;
  // Anchor name whose top edge the panel sits above (default: the composer card).
  above?: string;
  className: string | undefined;
  title?: string;
  // Accessible name when there is no visible title (the attach menu).
  label?: string;
  role?: "group" | "menu";
  align?: "start" | "end";
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  const titleId = useId();
  const opener = useRef<Element | null>(null);
  return (
    <div
      id={id}
      popover="auto"
      role={role}
      aria-labelledby={title ? titleId : undefined}
      aria-label={title ? undefined : label}
      className={className}
      data-align={align}
      style={anchorStyle(anchor, above)}
      onBeforeToggle={() => {
        opener.current = document.activeElement;
      }}
      onToggle={(event) => {
        const open = (event.nativeEvent as ToggleEvent).newState === "open";
        onToggle?.(open);
        if (open) focusFirst(event.currentTarget, opener.current);
      }}
    >
      {title && (
        <h2 id={titleId} className={styles.popoverTitle}>
          {title}
        </h2>
      )}
      {children}
    </div>
  );
}

export type RadioOption = {
  value: string;
  label: string;
  detail?: string | undefined;
};

// Vertical radiogroup shared by the agent, effort and permission popovers.
export function OptionRadios({
  name,
  label,
  value,
  options,
  disabled,
  onChange,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly RadioOption[];
  disabled: boolean;
  onChange(_value: string): void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={styles.permissionModes}
    >
      {options.map((option) => (
        <label key={option.value} className={styles.permissionOption}>
          <input
            type="radio"
            name={name}
            value={option.value}
            checked={value === option.value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          <span>
            <strong>{option.label}</strong>
            {option.detail && <small>{option.detail}</small>}
          </span>
        </label>
      ))}
    </div>
  );
}
