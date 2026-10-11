// Browser-safe terminal request validation and output helpers. No IO.
export const TERMINAL_LIMITS = Object.freeze({
  inputChars: 8192,
  outputChars: 262144,
  readChars: 65536,
  perWorkspace: 8,
  total: 32,
});
const id = (v, max) =>
  typeof v === "string" && /^[\w.:-]+$/.test(v) && v.length <= max;
const dim = (v) => Number.isInteger(v) && v >= 1 && v <= 1000;
const schemas = {
  "terminal.start": [["workspaceId"], ["cols", "rows"]],
  "terminal.list": [["workspaceId"], []],
  "terminal.write": [["terminalId", "text"], []],
  "terminal.read": [["terminalId", "cursor"], []],
  "terminal.resize": [["terminalId", "cols", "rows"], []],
  "terminal.stop": [["terminalId"], []],
  "terminal.close": [["terminalId"], []],
};
// Returns the request when valid, otherwise undefined.
export function validateTerminalRequest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.hasOwn(schemas, value.type)
  )
    return undefined;
  const [required, optional] = schemas[value.type];
  const allowed = new Set(["type", ...required, ...optional]);
  if (
    Reflect.ownKeys(value).some((k) => !allowed.has(k)) ||
    required.some((k) => !Object.hasOwn(value, k))
  )
    return undefined;
  for (const [k, v] of Object.entries(value)) {
    if (k === "type") continue;
    if (k === "workspaceId" && !id(v, 256)) return undefined;
    if (k === "terminalId" && !id(v, 64)) return undefined;
    if ((k === "cols" || k === "rows") && !dim(v)) return undefined;
    if (k === "cursor" && !(Number.isSafeInteger(v) && v >= 0))
      return undefined;
    if (
      k === "text" &&
      !(
        typeof v === "string" &&
        v.length <= TERMINAL_LIMITS.inputChars &&
        v.isWellFormed() &&
        !v.includes("\0")
      )
    )
      return undefined;
  }
  return value;
}
// ponytail: plain-text view; CSI/OSC/charset escapes and bare CR are dropped. An xterm.js renderer replaces this with a PTY.
const ansi =
  // eslint-disable-next-line no-control-regex
  /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)?|[()][0-2AB]|[@-Z\\-_=>])/g;
export function stripAnsi(text) {
  return text.replace(ansi, "").replace(/\r(?!\n)/g, "");
}
