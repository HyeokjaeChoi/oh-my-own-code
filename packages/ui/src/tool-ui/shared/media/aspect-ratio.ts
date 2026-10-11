import styles from "./aspect-ratio.module.css";

export type AspectRatio = "auto" | "1:1" | "4:3" | "16:9" | "9:16";
export type MediaFit = "cover" | "contain";

export const RATIO_CLASS_MAP: Record<AspectRatio, string> = {
  auto: styles.auto!,
  "1:1": styles.square!,
  "4:3": styles.standard!,
  "16:9": styles.wide!,
  "9:16": styles.portrait!,
};

export function getFitClass(fit: MediaFit): string {
  return fit === "cover" ? styles.cover! : styles.contain!;
}
