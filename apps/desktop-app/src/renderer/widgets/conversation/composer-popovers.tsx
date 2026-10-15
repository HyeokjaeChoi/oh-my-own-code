import type { CSSProperties, ReactNode } from "react";

/* Native popover + CSS anchor positioning: the browser top layer, light
   dismiss and Esc handling come for free; no JS positioning is needed. */
const anchorStyle = (anchor: string) =>
  ({ "--anchor": anchor }) as CSSProperties;

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
  title?: string;
  disabled?: boolean;
}) {
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

export function PopoverPanel({
  id,
  anchor,
  className,
  label,
  align = "end",
  onToggle,
  children,
}: {
  id: string;
  anchor: string;
  className: string | undefined;
  label: string;
  align?: "start" | "end";
  onToggle?: (open: boolean) => void;
  children: ReactNode;
}) {
  return (
    <div
      id={id}
      popover="auto"
      role="group"
      aria-label={label}
      className={className}
      data-align={align}
      style={anchorStyle(anchor)}
      onToggle={(event) =>
        onToggle?.((event.nativeEvent as ToggleEvent).newState === "open")
      }
    >
      {children}
    </div>
  );
}
