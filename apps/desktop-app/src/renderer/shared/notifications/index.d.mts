export type NoticeKind = "done" | "error" | "approval" | "job";
export type NoticeSpec = {
  id: string;
  kind: NoticeKind;
  text: string;
  /** Title-free text for OS notifications; defaults to text. */
  os?: string;
  workspaceId?: string;
  sessionId?: string;
};
export type Notice = NoticeSpec & { at: number; read: boolean };
export type NoticeSnapshot = {
  sessions: {
    id: string;
    workspaceId: string;
    title: string;
    status: string;
  }[];
  permissions: { id: string; sessionId: string }[];
};
export const NOTIFICATION_LIMIT: number;
export const NOTIFICATIONS_STORAGE_KEY: string;
export const NOTIFICATION_JOB_MARK_KEY: string;
export function sessionText(
  kind: "done" | "error" | "approval",
  title: string,
  os?: boolean,
): string;
export function jobText(
  name: string,
  entry: { result: string; count?: number },
): string;
export function deriveSessionNotices(
  prev: NoticeSnapshot | undefined,
  next: NoticeSnapshot | undefined,
  now: number,
): NoticeSpec[];
export function deriveJobNotices(
  jobs: {
    name: string;
    target: { workspaceId: string };
    history: {
      id: string;
      recordedAt: number;
      result: string;
      count?: number;
    }[];
  }[],
  startedAt: number,
  seenAt?: number,
): NoticeSpec[];
export function jobNoticeMark(
  jobs: { history: { recordedAt: number }[] }[],
  seenAt?: number,
): number;
export const NOTIFICATIONS_CLEARED_KEY: string;
export function unionNotices(
  a: Notice[],
  b: Notice[],
  clearedAt?: number,
): Notice[];
export function mergeNotices(
  list: Notice[],
  notices: NoticeSpec[],
  now: number,
): { added: Notice[]; list: Notice[] };
