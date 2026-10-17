import { splitMiddle } from "./index.mjs";
import styles from "./path-text.module.css";

// One line, shrinking in the middle: the file name always stays whole.
export function PathText({
  path,
  className,
}: {
  path: string;
  className?: string | undefined;
}) {
  const [head, tail] = splitMiddle(path);
  return (
    <span className={[styles.path, className].filter(Boolean).join(" ")}>
      {head && <span className={styles.head}>{head}</span>}
      <span className={styles.tail}>{tail}</span>
    </span>
  );
}
