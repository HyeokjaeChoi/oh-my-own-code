import type { WorkbenchMessage } from "../../../desktop-bridge.js";
export type TodoItem = { content: string; status: string };
export const APPROVED_MARKER: RegExp;
export function latestChecklist(messages: WorkbenchMessage[]): {
  items: TodoItem[];
  done: number;
  total: number;
} | null;
export function latestPlan(
  messages: WorkbenchMessage[],
): WorkbenchMessage | null;
export function approvalMessage(version: number, plan: string): string;
export function approvedPlans(messages: WorkbenchMessage[]): {
  version: number;
  messageId: string;
  index: number;
  runs: string[];
}[];
export function nextVersion(messages: WorkbenchMessage[]): number;
export type CheckKind = "lint" | "test" | "typecheck";
export type CheckStatus = "passed" | "failed" | "running" | "unknown";
export function checkKind(command: string): CheckKind | null;
export function verifiedChecks(messages: WorkbenchMessage[]): {
  checks: {
    id: string;
    kind: CheckKind;
    command: string;
    status: CheckStatus;
    turn: number;
  }[];
  needsReverify: boolean;
};
export function findingLines(text: string): string[] | null;
