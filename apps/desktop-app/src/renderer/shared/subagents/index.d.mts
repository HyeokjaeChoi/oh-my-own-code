import type {
  WorkbenchSession,
  WorkbenchPermission,
} from "../../../desktop-bridge.js";
export type ChildStatus =
  | "queued"
  | "running"
  | "waiting"
  | "stopping"
  | "failed"
  | "done";
export interface ChildRow {
  id: string;
  title: string;
  parentId: string;
  depth: number;
  status: ChildStatus;
  origin: "native" | "delegated";
}
export interface QueuedDelegation {
  id: string;
  parentId: string;
  title: string;
  brief: Brief;
}
export interface Brief {
  role?: string;
  goal?: string;
  inputs?: string;
  ownedPaths?: string | string[];
  acceptance?: string;
}
export const DEFAULT_CAP: number;
export function childStatus(
  session: Pick<WorkbenchSession, "id" | "status">,
  permissions?: Pick<WorkbenchPermission, "sessionId">[],
): ChildStatus;
export function deriveChildTree(input: {
  rootId?: string | undefined;
  sessions?: WorkbenchSession[];
  permissions?: Pick<WorkbenchPermission, "sessionId">[];
  lineage?: Record<string, string>;
  queued?: QueuedDelegation[];
}): ChildRow[];
export function isActive(row: { status: ChildStatus }): boolean;
export function renderBrief(brief: Brief): string;
export function validBrief(brief: Brief): boolean;
export function briefTitle(brief: Brief): string;
export function drainQueue<T>(input: {
  queued: T[];
  runningCount: number;
  cap?: number;
}): { start: T[]; rest: T[] };
export function cancelAll(
  rows: { id: string; status: ChildStatus }[],
  cancelOne: (id: string) => Promise<boolean>,
): Promise<{ cancelled: string[]; failed: string[] }>;
export function parseSubagentResult(
  output: string,
): { sessionId: string; state: string; text: string } | null;
