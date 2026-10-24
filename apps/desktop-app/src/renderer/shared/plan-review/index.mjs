// Pure F-15 derivations over snapshot messages (checklist, plan, approved
// versions, verified checks, review findings). Nothing is stored: every value is
// recomputed from the messages. No IO.
import { canonicalToolName, deriveToolView } from "../tool-ui/index.mjs";

export const APPROVED_MARKER = /^\[승인된 계획 v(\d+)\]/;
const tools = (m) => (m.role === "assistant" ? m.tools : []);

// Latest todowrite call with a parsable list. cancelled items do not count in m.
export function latestChecklist(messages) {
  for (let i = messages.length - 1; i >= 0; i--)
    for (const t of tools(messages[i]).toReversed()) {
      if (canonicalToolName(t.name) !== "todowrite") continue;
      const view = deriveToolView(t);
      if (view.kind !== "todo") continue;
      const counted = view.items.filter((x) => x.status !== "cancelled");
      return {
        items: view.items,
        done: counted.filter((x) => x.status === "completed").length,
        total: counted.length,
      };
    }
  return null;
}

// Latest non-empty assistant message produced by the runtime Plan agent.
export const latestPlan = (messages) =>
  messages.findLast(
    (m) =>
      m.role === "assistant" &&
      m.runtime?.agent?.toLowerCase() === "plan" &&
      m.text.trim(),
  ) ?? null;

export const approvalMessage = (version, plan) =>
  `[승인된 계획 v${version}]\n${plan.trim()}\n\n위 승인된 계획을 순서대로 실행하세요.`;

// Approved versions in order, with the assistant turns that ran each one (up to
// the next approval). Only the loaded message window is scanned.
export function approvedPlans(messages) {
  const found = [];
  messages.forEach((m, index) => {
    const hit = m.role === "user" ? APPROVED_MARKER.exec(m.text) : null;
    if (hit) found.push({ version: found.length + 1, messageId: m.id, index });
  });
  return found.map((p, n) => {
    const end = found[n + 1]?.index ?? messages.length;
    const runs = messages
      .slice(p.index + 1, end)
      .filter((m) => m.role === "assistant");
    return { ...p, runs: runs.map((m) => m.id) };
  });
}
export const nextVersion = (messages) => approvedPlans(messages).length + 1;

// Command-shape classifier: only the runner/first token decides, never words elsewhere in the
// command. Any pipe, redirect, chain, substitution or newline => unknown (null).
const kindOfWord = (w = "") =>
  /(^|[:_-])(typecheck|check-types|tsc|mypy|pyright)($|[:_-])/.test(w)
    ? "typecheck"
    : /(^|[:_-])(lint|eslint)($|[:_-])/.test(w)
      ? "lint"
      : /(^|[:_-])(test|tests|vitest|jest|pytest)($|[:_-])/.test(w)
        ? "test"
        : null;
const DIRECT = {
  tsc: "typecheck",
  mypy: "typecheck",
  pyright: "typecheck",
  eslint: "lint",
  vitest: "test",
  jest: "test",
  pytest: "test",
};
export function checkKind(command) {
  if (typeof command !== "string") return null;
  const cmd = command.replace(/^\s*cd\s+[^\s&|;<>`$]+\s*&&\s*/, "");
  if (/[|;&<>`\n\r]|\$\(/.test(cmd)) return null;
  const t = cmd.trim().split(/\s+/);
  while (/^[A-Za-z_]\w*=/.test(t[0] ?? "")) t.shift();
  t[0] = (t[0] ?? "").split("/").at(-1);
  const [bin, a1, a2] = t;
  const flagless = t.slice(1).filter((x) => !x.startsWith("-"));
  if (bin in DIRECT) return DIRECT[bin];
  if (bin === "cargo" || bin === "go") return a1 === "test" ? "test" : null;
  if (bin === "node") return t.slice(1, 3).includes("--test") ? "test" : null;
  if (["npm", "pnpm", "yarn", "bun"].includes(bin)) {
    if (a1 === "test" || a1 === "t") return "test";
    if (a1 === "run" || a1 === "run-script") return kindOfWord(a2);
    if (a1 === "exec" || (bin === "yarn" && a1 === "dlx"))
      return DIRECT[flagless[1]] ?? null;
    return bin === "bun" ? null : kindOfWord(a1);
  }
  if (bin === "npx" || bin === "bunx" || bin === "pnpx")
    return DIRECT[flagless[0]] ?? null;
  if (["nx", "turbo", "make", "just"].includes(bin)) {
    const w = flagless.find((x) => !["run", "run-many"].includes(x));
    return kindOfWord(w?.split(":").at(-1));
  }
  return null;
}

// Status comes only from the tool part: "error" = the tool failed, the runtime's structured
// exit status decides completed shell calls, otherwise "unknown" (never guessed or text-parsed).
export function checkStatus(tool, view) {
  if (tool.status === "error") return "failed";
  if (tool.status !== "completed") return "running";
  if (view.exitCode === null) return "unknown";
  return view.exitCode === 0 ? "passed" : "failed";
}

// Completed shell calls that write files count as edits (conservative: false positives only
// ask for a re-run).
const SHELL_EDIT =
  /\bsed\s+(-\w*i|--in-place)|\b(tee|mv|cp|rm|patch)\b|\bgit\s+(apply|checkout|restore)\b|>/;
export const shellEdits = (command) =>
  SHELL_EDIT.test(command.replace(/\d*>&\d+|\d*>\s*\/dev\/null/g, ""));

export function verifiedChecks(messages) {
  const checks = [];
  let order = 0;
  let lastPass = -1;
  let lastEdit = -1;
  messages.forEach((m, index) => {
    for (const t of tools(m)) {
      order++;
      const view = deriveToolView(t);
      if (view.kind === "diff" && t.status === "completed") lastEdit = order;
      if (view.kind !== "shell") continue;
      if (t.status === "completed" && shellEdits(view.command))
        lastEdit = order;
      const kind = checkKind(view.command);
      if (!kind) continue;
      const status = checkStatus(t, view);
      if (status === "passed") lastPass = order;
      checks.push({
        id: t.id,
        kind,
        command: view.command.split("\n")[0],
        status,
        turn: index + 1,
      });
    }
  });
  return { checks, needsReverify: lastPass >= 0 && lastEdit > lastPass };
}

// Lines starting with "- " are open findings; null when the text has none.
export function findingLines(text) {
  const lines = text.split("\n").filter((l) => l.startsWith("- "));
  return lines.length ? lines : null;
}
