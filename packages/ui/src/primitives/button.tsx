import React, { forwardRef, type ComponentPropsWithoutRef } from "react";
import styles from "./button.module.css";

export type ButtonProps = ComponentPropsWithoutRef<"button"> & {
  intent?: "primary" | "secondary" | "quiet" | "danger";
  size?: "compact" | "standard";
};

// Presentation only. The caller owns permission, pending and effect authority.
export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  function Button(
    {
      intent = "quiet",
      size = "standard",
      type = "button",
      className,
      ...props
    },
    ref,
  ) {
    return (
      <button
        {...props}
        ref={ref}
        type={type}
        className={[styles.button, styles[intent], styles[size], className]
          .filter(Boolean)
          .join(" ")}
      />
    );
  },
);
