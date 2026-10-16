import React, { type ComponentPropsWithoutRef } from "react";
import styles from "./kbd.module.css";

export type KbdProps = ComponentPropsWithoutRef<"kbd">;

export function Kbd({ className, ...props }: KbdProps) {
  return (
    <kbd
      {...props}
      className={[styles.kbd, className].filter(Boolean).join(" ")}
    />
  );
}
