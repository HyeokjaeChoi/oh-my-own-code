import React, { type ComponentPropsWithoutRef, type ReactNode } from "react";
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from "lucide-react";
import styles from "./notice.module.css";

export type NoticeTone = "info" | "warning" | "danger" | "success";

export type NoticeProps = Omit<ComponentPropsWithoutRef<"div">, "role"> & {
  tone?: NoticeTone;
  // One quiet Button, kept by the caller.
  action?: ReactNode;
  onDismiss?: () => void;
  role?: "alert" | "status" | "note";
};

const ICONS = {
  info: Info,
  warning: TriangleAlert,
  danger: CircleAlert,
  success: CircleCheck,
} as const;

export function Notice({
  tone = "info",
  children,
  action,
  onDismiss,
  role,
  className,
  ...rest
}: NoticeProps) {
  const Icon = ICONS[tone];
  return (
    <div
      {...rest}
      role={role ?? (tone === "danger" ? "alert" : "status")}
      className={[styles.notice, styles[tone], className]
        .filter(Boolean)
        .join(" ")}
    >
      <Icon className={styles.icon} size={14} aria-hidden="true" />
      <div className={styles.body}>{children}</div>
      {action || onDismiss ? (
        <span className={styles.slot}>
          {action}
          {onDismiss ? (
            <button
              type="button"
              className={styles.dismiss}
              aria-label="닫기"
              onClick={onDismiss}
            >
              <X size={14} aria-hidden="true" />
            </button>
          ) : null}
        </span>
      ) : null}
    </div>
  );
}
