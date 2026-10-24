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
    if (hit) found.push({ version: Number(hit[1]), messageId: m.id, index });
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

const CHECKS = [
  ["typecheck", /\b(tsc|typecheck|check-types|mypy|pyright)\b/],
  ["lint", /\b(eslint|lint)\b/],
  [
    "test",
    /\b(vitest|jest|pytest)\b|\bcargo test\b|\bgo test\b|\bnode\b[^|;&\n]*--test\b|\b(npm|pnpm|yarn|bun|npx|nx|turbo|make|just)\b[^|;&\n]*\btest\b/,
  ],
];
export function checkKind(command) {
  for (const [kind, re] of CHECKS) if (re.test(command)) return kind;
  return null;
}

// Status comes only from the tool part: "error" = the tool failed, a parsed exit
// code decides completed shell calls, otherwise "unknown" (never guessed).
export function checkStatus(tool, view) {
  if (tool.status === "error") return "failed";
  if (tool.status !== "completed") return "running";
  if (view.exitCode === null) return "unknown";
  return view.exitCode === 0 ? "passed" : "failed";
}

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
