import { workspaceFilePathReason } from "../workspace-file/index.mjs";
// Browser-safe plan helpers (F-15). No IO. A plan is a Markdown file; everything
// here is a byte-preserving text transform or a pure state derivation.
export const PLAN_DIR = ".omoc/plans";
export const PLAN_LIMITS = Object.freeze({
  bytes: 65536,
  listed: 100,
  approvals: 200,
  links: 200,
  checks: 100,
  findingChars: 500,
});
export const CHECK_KINDS = Object.freeze([
  "lint",
  "test",
  "typecheck",
  "custom",
]);
export const FINDING_AUTHORS = Object.freeze(["implementer", "reviewer"]);
export const RESOLVERS = Object.freeze(["user", "implementer", "reviewer"]);

export const isPlanPath = (v) =>
  typeof v === "string" &&
  v.length <= 512 &&
  v.endsWith(".md") &&
  workspaceFilePathReason(v) === undefined;

export function planSlug(title) {
  const slug = String(title ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  return slug || "plan";
}
export const planTemplate = (title) =>
  `# ${
    String(title ?? "")
      .replace(/\s+/g, " ")
      .trim() || "계획"
  }\n\n## 작업\n\n- [ ] \n\n## Review\n\n`;

// [{start, end (exclusive of EOL), text}] for LF, CRLF and bare-CR-free text.
function lines(text) {
  const out = [];
  let start = 0;
  while (start <= text.length) {
    const nl = text.indexOf("\n", start);
    if (nl === -1) {
      out.push({ start, end: text.length, text: text.slice(start) });
      break;
    }
    const end = nl > start && text[nl - 1] === "\r" ? nl - 1 : nl;
    out.push({ start, end, text: text.slice(start, end) });
    start = nl + 1;
  }
  return out;
}
const eol = (text) => (text.includes("\r\n") ? "\r\n" : "\n");
const FENCE_OPEN = /^ {0,3}(`{3,}|~{3,})(.*)$/;
const FENCE_CLOSE = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;
// CommonMark: a fence closes with the same char and length >= the opener.
// Returns the next fence state ({ch, len} while inside) for one line.
export function fenceStep(fence, text) {
  if (fence) {
    const m = FENCE_CLOSE.exec(text);
    return m && m[1][0] === fence.ch && m[1].length >= fence.len
      ? undefined
      : fence;
  }
  const m = FENCE_OPEN.exec(text);
  if (!m || (m[1][0] === "`" && m[2].includes("`"))) return undefined;
  return { ch: m[1][0], len: m[1].length };
}
const HEADING = /^ {0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
const BOX = /^(\s*(?:[-*+]|\d+[.)])\s+\[)([ xX])(\] .*|\]$)/;

// Marks each line: inside a code fence, or inside the "## Review" section.
export function scan(text) {
  const rows = lines(text);
  let fence,
    review = false;
  return rows.map((row, line) => {
    const was = fence;
    fence = fenceStep(fence, row.text);
    const inFence = Boolean(was || fence);
    if (!inFence) {
      const h = HEADING.exec(row.text);
      if (h && h[1].length <= 2) review = /^review$/i.test(h[2]);
    }
    return { ...row, line, inFence, review };
  });
}

// Task checklist items, excluding code fences and the Review section.
export function parseChecklist(text) {
  const items = [];
  for (const row of scan(text)) {
    if (row.inFence || row.review) continue;
    const m = BOX.exec(row.text);
    if (!m) continue;
    items.push({
      line: row.line,
      checked: m[2] !== " ",
      mark: row.start + m[1].length,
      text: m[3].slice(2).trim(),
    });
  }
  return {
    items,
    total: items.length,
    done: items.filter((i) => i.checked).length,
  };
}
// Flips one checkbox character; every other byte is untouched.
export function toggleChecklistItem(text, line) {
  const item = parseChecklist(text).items.find((i) => i.line === line);
  if (!item) return undefined;
  return (
    text.slice(0, item.mark) +
    (item.checked ? " " : "x") +
    text.slice(item.mark + 1)
  );
}

// Findings live under "## Review" as:
//   - [ ] **reviewer**: text
//   - [x] **reviewer**: text -- resolved by implementer
const FINDING =
  /^(\s*-\s+\[)([ xX])\]\s+\*\*(implementer|reviewer)\*\*:\s(.*?)(?:\s+--\s+resolved by (user|implementer|reviewer))?\s*$/;
export function parseFindings(text) {
  const out = [];
  for (const row of scan(text)) {
    if (row.inFence || !row.review) continue;
    const m = FINDING.exec(row.text);
    if (!m) continue;
    const resolved = m[2] !== " ";
    out.push({
      line: row.line,
      author: m[3],
      text: m[4],
      status: resolved ? "resolved" : "open",
      resolvedBy: resolved ? (m[5] ?? "user") : undefined,
    });
  }
  return out;
}
const clean = (t) =>
  String(t ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, PLAN_LIMITS.findingChars);
const findingLine = (f) =>
  `- [${f.status === "resolved" ? "x" : " "}] **${f.author}**: ${f.text}${f.status === "resolved" ? ` -- resolved by ${f.resolvedBy}` : ""}`;
export function appendFinding(text, { author, text: body }) {
  const t = clean(body);
  if (!FINDING_AUTHORS.includes(author) || !t) return undefined;
  const nl = eol(text);
  const add = findingLine({ author, text: t, status: "open" });
  const rows = scan(text);
  const start = rows.findIndex(
    (r) => !r.inFence && /^ {0,3}##\s+review\s*#*\s*$/i.test(r.text),
  );
  if (start === -1)
    return `${text}${text === "" || text.endsWith("\n") ? "" : nl}${text === "" ? "" : nl}## Review${nl}${nl}${add}${nl}`;
  // Insert after the last non-blank line of the section.
  let last = start;
  for (let i = start + 1; i < rows.length && rows[i].review; i++)
    if (rows[i].text.trim()) last = i;
  const at = rows[last].end;
  const tail = text.slice(at);
  return text.slice(0, at) + nl + add + (tail === "" ? nl : "") + tail;
}
export function setFindingStatus(text, line, status, resolvedBy = "user") {
  const f = parseFindings(text).find((x) => x.line === line);
  if (!f || !["open", "resolved"].includes(status)) return undefined;
  if (status === "resolved" && !RESOLVERS.includes(resolvedBy))
    return undefined;
  const row = lines(text)[line];
  const next = findingLine({
    author: f.author,
    text: f.text,
    status,
    resolvedBy,
  });
  return text.slice(0, row.start) + next + text.slice(row.end);
}
// A reviewer finding closed only by the implementer is a claim, not a result:
// it stays "needs reviewer re-check" until the reviewer or the user closes it.
export function summarizeFindings(findings) {
  const s = { open: 0, resolved: 0, awaitingRecheck: 0 };
  for (const f of findings) {
    if (f.status === "open") s.open++;
    else if (f.author === "reviewer" && f.resolvedBy === "implementer")
      s.awaitingRecheck++;
    else s.resolved++;
  }
  return s;
}

// Approvals: [{path, sha256, version, approvedAt}]. Versions count up per path.
export function approvalState(records, path, sha256) {
  const mine = (records ?? []).filter((r) => r.path === path);
  if (mine.length === 0) return { state: "none" };
  const hit = mine.find((r) => r.sha256 === sha256);
  if (hit) return { state: "approved", version: hit.version, record: hit };
  const latest = mine.reduce((a, b) => (b.version > a.version ? b : a));
  return { state: "stale", version: latest.version, record: latest };
}
export const nextApprovalVersion = (records, path) =>
  1 +
  (records ?? [])
    .filter((r) => r.path === path)
    .reduce((n, r) => Math.max(n, r.version), 0);

// Check results come only from a process exit observed by the host.
export function checkStatusFromTerminal(term) {
  if (!term) return "not-run";
  if (term.status === "running") return "running";
  return term.exitCode === 0 && !term.signal ? "passed" : "failed";
}
// current: {planSha, fingerprint?}. A finished check is stale when the plan or
// the workspace fingerprint differs from what it ran against.
export function checkStale(check, current) {
  if (check.status !== "passed" && check.status !== "failed") return false;
  if (check.planSha !== current.planSha) return true;
  return Boolean(
    check.fingerprint &&
      current.fingerprint &&
      check.fingerprint !== current.fingerprint,
  );
}
export function verificationSummary(checks, current) {
  if (checks.length === 0) return "none";
  if (checks.some((c) => c.status === "running")) return "running";
  if (checks.some((c) => checkStale(c, current))) return "stale";
  if (checks.some((c) => c.status === "failed")) return "failed";
  if (checks.every((c) => c.status === "passed")) return "passed";
  return "pending";
}
export function workspaceFingerprint(repository, files) {
  if (!repository) return undefined;
  // ponytail: the git observation has no per-file content identity, so a further
  // edit to an already-dirty file keeps the same fingerprint (not detected).
  // Plan files are excluded: editing the plan is tracked by planSha instead.
  const dirty = [...(files ?? [])]
    .filter((f) => !f.path.startsWith(`${PLAN_DIR}/`))
    .map((f) => `${f.path}:${f.index}:${f.worktree}`)
    .sort()
    .join("\n");
  return `${repository.head ?? "-"}\n${dirty}`;
}
export async function sha256Hex(text) {
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new globalThis.TextEncoder().encode(text),
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
export const executionMessage = ({ path, sha256, version }) =>
  `승인된 계획(v${version})을 실행하세요.\n계획 파일: ${path}\n승인된 sha256: ${sha256}\n파일을 읽어 위 해시와 같은지 확인한 뒤, 체크리스트 순서대로 진행하세요. 완료했다고 말하는 것만으로는 lint/테스트/리뷰 통과로 기록되지 않으며, 검증은 앱에서 실제 실행 결과로만 기록됩니다.`;

// Closed IPC request validation for desktop:v1:plans.
const id = (v, max) =>
  typeof v === "string" && /^[\w.:-]+$/.test(v) && v.length <= max;
const schemas = {
  "plans.list": [["workspaceId"], []],
  "plans.create": [["workspaceId", "title"], []],
  "plans.approve": [["workspaceId", "path", "sha256"], []],
  "plans.link": [["workspaceId", "path", "sha256", "sessionId"], []],
  "plans.check": [
    ["workspaceId", "path", "kind", "terminalId"],
    ["fingerprint"],
  ],
};
export function validatePlansRequest(value) {
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
    if ((k === "workspaceId" || k === "sessionId") && !id(v, 256))
      return undefined;
    if (k === "terminalId" && !id(v, 64)) return undefined;
    if (k === "path" && !isPlanPath(v)) return undefined;
    if (k === "sha256" && !(typeof v === "string" && /^[a-f0-9]{64}$/.test(v)))
      return undefined;
    if (k === "kind" && !CHECK_KINDS.includes(v)) return undefined;
    if (
      k === "title" &&
      !(
        typeof v === "string" &&
        v.trim() &&
        v.length <= 120 &&
        v.isWellFormed()
      )
    )
      return undefined;
    if (
      k === "fingerprint" &&
      !(typeof v === "string" && /^[a-f0-9]{64}$/.test(v))
    )
      return undefined;
  }
  return value;
}
