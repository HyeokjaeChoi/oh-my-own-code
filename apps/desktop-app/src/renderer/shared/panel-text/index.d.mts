export type PatchRow = {
  kind: "meta" | "hunk" | "add" | "del" | "ctx";
  text: string;
  oldNo?: number;
  newNo?: number;
};
export function parsePatch(patch: string): {
  rows: PatchRow[];
  added: number;
  removed: number;
};
export function relativeTime(timestamp: number, now?: number): string;
export function splitMiddle(path: string, tailMax?: number): [string, string];
