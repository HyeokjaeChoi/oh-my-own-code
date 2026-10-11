import type {
  WorkbenchMessage,
  WorkbenchPermission,
  WorkbenchSession,
  WorkbenchDiagnostics,
} from "../../../desktop-bridge.js";
export type TimelineKind =
  | "message"
  | "tool"
  | "permission"
  | "child"
  | "activity"
  | "error";
export type TimelineTarget =
  | { type: "message"; messageId: string; toolId?: string }
  | { type: "permission"; permissionId: string }
  | { type: "session"; sessionId: string };
export interface TimelineEntry {
  seq: number;
  time: number | null;
  kind: TimelineKind;
  sessionId?: string | undefined;
  title: string;
  status: string;
  target: TimelineTarget | null;
}
export const timelineKinds: TimelineKind[];
export function deriveTimeline(input: {
  sessionId?: string | undefined;
  messages?: WorkbenchMessage[];
  permissions?: WorkbenchPermission[];
  sessions?: WorkbenchSession[];
  events?: WorkbenchDiagnostics["events"];
}): TimelineEntry[];
export function filterTimeline(
  entries: TimelineEntry[],
  filter?: {
    kinds?: Set<string> | undefined;
    sessionIds?: Set<string> | undefined;
  },
): TimelineEntry[];
