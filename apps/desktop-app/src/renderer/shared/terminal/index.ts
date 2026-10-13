export {
  TERMINAL_LIMITS,
  validateTerminalRequest,
  stripAnsi,
  createResizeSync,
} from "./index.mjs";
export type {
  TerminalRequest,
  TerminalInfo,
  TerminalRead,
  TerminalResult,
  TerminalStatus,
} from "./index.mjs";
import type { TerminalRequest, TerminalResult } from "./index.mjs";
export async function callTerminal<T>(
  request: TerminalRequest,
): Promise<TerminalResult<T>> {
  try {
    return (await window.desktopBridge.terminal(request)) as TerminalResult<T>;
  } catch {
    return { ok: false, code: "UNAVAILABLE" };
  }
}
// Panels listen for this to pick up terminals started elsewhere (e.g. the command palette).
export const TERMINAL_STARTED_EVENT = "omoc:terminal-started";
// Last terminal started outside the panel; a panel mounting later selects it.
let lastStarted: { workspaceId: string; terminalId: string } | undefined;
// Consuming only for the matching workspace, so another workspace's panel does
// not take it; cleared on read so a later remount does not re-select a stale terminal.
export function lastStartedTerminal(workspaceId: string) {
  if (lastStarted?.workspaceId !== workspaceId) return undefined;
  const id = lastStarted.terminalId;
  lastStarted = undefined;
  return id;
}
export function announceTerminalStarted(
  workspaceId: string,
  terminalId: string,
) {
  lastStarted = { workspaceId, terminalId };
  window.dispatchEvent(new CustomEvent(TERMINAL_STARTED_EVENT));
}
