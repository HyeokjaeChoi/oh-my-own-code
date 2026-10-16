import { useId } from "react";
import type { Preferences } from "../../shared/preferences/index.js";
import styles from "./theme-picker.module.css";

const THEMES = [
  ["system", "시스템"],
  ["light", "라이트"],
  ["dark", "다크"],
] as const;

// Radio group drawn as three miniature windows; native radios keep arrow keys.
export function ThemePicker(props: {
  value: Preferences["theme"];
  onChange: (_theme: Preferences["theme"]) => void;
}) {
  const name = useId();
  return (
    <div className={styles.field}>
      <span id={`${name}-label`} className={styles.label}>
        테마
      </span>
      <div
        role="radiogroup"
        aria-labelledby={`${name}-label`}
        className={styles.group}
      >
        {THEMES.map(([value, label]) => (
          <label key={value} className={styles.option}>
            <input
              type="radio"
              className={styles.native}
              name={name}
              value={value}
              checked={props.value === value}
              onChange={() => props.onChange(value)}
            />
            <span className={styles.thumb} data-theme-preview={value}>
              <span className={styles.bar} />
              <span className={styles.side} />
              <span className={styles.line} />
              <span className={styles.line2} />
            </span>
            <span className={styles.caption}>{label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
