import React, { useId, type ReactNode } from "react";
import { InfoTip } from "./info-tip.js";
import styles from "./section.module.css";

export type SectionProps = {
  title: ReactNode;
  description?: ReactNode;
  // Longer explanation, disclosed from an "i" button beside the title.
  info?: ReactNode;
  className?: string;
  children: ReactNode;
};

export function Section({
  title,
  description,
  info,
  className,
  children,
}: SectionProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className={[styles.section, className].filter(Boolean).join(" ")}
    >
      <div className={styles.header}>
        <div className={styles.titleRow}>
          <h3 id={titleId} className={styles.title}>
            {title}
          </h3>
          {info ? <InfoTip>{info}</InfoTip> : null}
        </div>
        {description ? (
          <p className={styles.description}>{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

export type RowProps = {
  label: ReactNode;
  description?: ReactNode;
  // Associates the label with the control that carries this id.
  htmlFor?: string;
  className?: string;
  children?: ReactNode;
};

export function Row({
  label,
  description,
  htmlFor,
  className,
  children,
}: RowProps) {
  const LabelTag = htmlFor ? "label" : "span";
  return (
    <div className={[styles.row, className].filter(Boolean).join(" ")}>
      <div className={styles.text}>
        <LabelTag {...(htmlFor ? { htmlFor } : {})} className={styles.label}>
          {label}
        </LabelTag>
        {description ? (
          <span
            id={htmlFor ? `${htmlFor}-description` : undefined}
            className={styles.rowDescription}
          >
            {description}
          </span>
        ) : null}
      </div>
      {children ? <div className={styles.control}>{children}</div> : null}
    </div>
  );
}
