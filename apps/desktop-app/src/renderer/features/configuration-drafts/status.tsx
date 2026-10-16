import type { ComponentPropsWithoutRef } from "react";
import { Notice } from "@workbench/ui";
import styles from "./drafts.module.css";

// Muted status text that becomes a danger Notice when it reports a failure.
export function Status({
  error,
  children,
  ...rest
}: ComponentPropsWithoutRef<"p"> & { error: boolean }) {
  return error ? (
    <Notice tone="danger" role="note" {...(rest as object)}>
      {children}
    </Notice>
  ) : (
    <p {...rest} className={styles.muted}>
      {children}
    </p>
  );
}
