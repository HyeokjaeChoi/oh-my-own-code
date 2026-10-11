export const TERMINAL_LIMITS: Readonly<{
  inputChars: 8192;
  outputChars: 262144;
  readChars: 65536;
  perWorkspace: 8;
  total: 32;
}>;
export type TerminalRequest =
  | {
      type: "terminal.start";
      workspaceId: string;
      cols?: number;
      rows?: number;
    }
  | { type: "terminal.list"; workspaceId: string }
  | { type: "terminal.write"; terminalId: string; text: string }
  | { type: "terminal.read"; terminalId: string; cursor: number }
  | { type: "terminal.resize"; terminalId: string; cols: number; rows: number }
  | { type: "terminal.stop"; terminalId: string }
  | { type: "terminal.close"; terminalId: string };
export type TerminalStatus = "running" | "exited";
export type TerminalInfo = {
  terminalId: string;
  workspaceId: string;
  status: TerminalStatus;
  exitCode: number | null;
  signal: string | null;
};
export type TerminalRead = TerminalInfo & {
  output: string;
  cursor: number;
  truncated: boolean;
};
export type TerminalResult<T> =
  | { ok: true; value: T }
  | { ok: false; code: string };
export function validateTerminalRequest(
  value: unknown,
): TerminalRequest | undefined;
export function stripAnsi(text: string): string;
