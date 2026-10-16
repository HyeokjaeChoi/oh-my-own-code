import React, { forwardRef, type ComponentPropsWithoutRef } from "react";
import styles from "./switch.module.css";

export type SwitchProps = Omit<
  ComponentPropsWithoutRef<"input">,
  "type" | "role"
> & {
  // Optional visible label; otherwise name it with aria-label or a label[for].
  label?: string;
};

// Native checkbox exposed as a switch: keyboard, form and a11y behavior stay
// native. The caller owns checked state and effects.
export const Switch = forwardRef<HTMLInputElement, SwitchProps>(function Switch(
  { label, className, ...props },
  ref,
) {
  const control = (
    <input
      {...props}
      ref={ref}
      type="checkbox"
      role="switch"
      className={[styles.switch, className].filter(Boolean).join(" ")}
    />
  );
  return label ? (
    <label className={styles.labelled}>
      {control}
      {label}
    </label>
  ) : (
    control
  );
});
