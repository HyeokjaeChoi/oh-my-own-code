export {
  TERMINAL_LIMITS,
  validateTerminalRequest,
  stripAnsi,
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
let lastStarted: string | undefined;
export const lastStartedTerminal = () => lastStarted;
export function announceTerminalStarted(terminalId: string) {
  lastStarted = terminalId;
  window.dispatchEvent(new CustomEvent(TERMINAL_STARTED_EVENT));
}
