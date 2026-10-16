import React, { useId } from "react";
import styles from "./segmented.module.css";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
};

export type SegmentedProps<T extends string> = {
  options: ReadonlyArray<SegmentedOption<T>>;
  value: T;
  onChange: (_value: T) => void;
  name?: string;
  disabled?: boolean;
  "aria-label"?: string;
  "aria-labelledby"?: string;
  className?: string;
};

// Native radios give arrow-key navigation and group semantics for free.
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  name,
  disabled,
  className,
  ...aria
}: SegmentedProps<T>) {
  const generated = useId();
  return (
    <div
      role="radiogroup"
      {...aria}
      className={[styles.group, className].filter(Boolean).join(" ")}
    >
      {options.map((option) => (
        <label
          key={option.value}
          className={[
            styles.option,
            option.value === value ? styles.selected : "",
            disabled ? styles.disabled : "",
          ]
            .filter(Boolean)
            .join(" ")}
        >
          <input
            type="radio"
            className={styles.native}
            name={name ?? generated}
            value={option.value}
            checked={option.value === value}
            disabled={disabled}
            onChange={() => onChange(option.value)}
          />
          {option.label}
        </label>
      ))}
    </div>
  );
}
