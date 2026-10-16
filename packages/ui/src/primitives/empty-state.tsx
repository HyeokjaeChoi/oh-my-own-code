import React, { type ReactNode } from "react";
import styles from "./empty-state.module.css";

export type EmptyStateProps = {
  icon?: ReactNode;
  title: ReactNode;
  hint?: ReactNode;
  // One call to action, kept by the caller.
  action?: ReactNode;
  className?: string;
};

export function EmptyState({
  icon,
  title,
  hint,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={[styles.empty, className].filter(Boolean).join(" ")}>
      {icon ? (
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
      ) : null}
      <p className={styles.title}>{title}</p>
      {hint ? <p className={styles.hint}>{hint}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
