import React from "react";
import styles from "./status-badge.module.css";

export type StatusBadgeTone =
  | "info"
  | "warning"
  | "success"
  | "error"
  | "neutral";

export type StatusBadgeProps = {
  label: string;
  tone: StatusBadgeTone;
};

export function StatusBadge({ label, tone }: StatusBadgeProps) {
  return (
    <span className={styles.badge} data-tone={tone}>
      {label}
    </span>
  );
}
