import React, { useId, type ReactNode } from "react";
import styles from "./field.module.css";

export type FieldControlProps = {
  id: string;
  "aria-describedby"?: string | undefined;
  "aria-invalid"?: true;
};

export type FieldProps = {
  label: ReactNode;
  // Keep the label for assistive technology but do not paint it.
  hideLabel?: boolean;
  hint?: ReactNode;
  error?: ReactNode;
  id?: string;
  className?: string;
  children: (_control: FieldControlProps) => ReactNode;
};

// Presentation only: wires label, hint and error to one control by id.
export function Field({
  label,
  hideLabel = false,
  hint,
  error,
  id,
  className,
  children,
}: FieldProps) {
  const generated = useId();
  const controlId = id ?? generated;
  const hintId = hint ? `${controlId}-hint` : undefined;
  const errorId = error ? `${controlId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(" ") || undefined;
  return (
    <div className={[styles.field, className].filter(Boolean).join(" ")}>
      <label
        htmlFor={controlId}
        className={hideLabel ? styles.hidden : styles.label}
      >
        {label}
      </label>
      {children({
        id: controlId,
        "aria-describedby": describedBy,
        ...(error ? { "aria-invalid": true as const } : {}),
      })}
      {hint ? (
        <p id={hintId} className={styles.hint}>
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className={styles.error}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
