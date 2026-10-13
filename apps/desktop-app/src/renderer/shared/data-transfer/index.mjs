// Browser-safe session export/import + retention rules (F-17). No IO.
export const EXPORT_FORMAT = "omoc-session-export";
export const EXPORT_VERSION = 1;
export const RETENTION_OPTIONS = Object.freeze([0, 30, 90, 365]);
export const WIPE_WORD = "삭제";
export const DATA_LIMITS = Object.freeze({
  fileBytes: 16 * 1024 * 1024,
  sessions: 50,
  messages: 1000,
  text: 65536,
  tools: 40,
  toolInput: 2000,
  toolOutput: 65536,
  archives: 200,
});

const REDACTED = "[REDACTED]";
const TAIL_DROP = 256;
// Order matters: block/header forms first, then bare token shapes, then assignments.
const SECRET_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
  /\b(authorization|proxy-authorization|x-api-key)(\\?["']?\s*[:=]\s*)(?:\\?"(?:[^"\\\n]|\\.)*"|\\?'(?:[^'\\\n]|\\.)*'|\\?"[^\n]*|\\?'[^\n]*|\[REDACTED\](?![\w.-])|(?:(?:Bearer|Basic|Token)\s+)?[^\s"',;]+)/gi,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}/g,
  /\bglpat-[A-Za-z0-9_-]{20,}/g,
  /\bnpm_[A-Za-z0-9]{20,}/g,
  /\bya29\.[A-Za-z0-9_-]{20,}/g,
  /\bxox[abprs]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bAIza[0-9A-Za-z_-]{30,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g,
  // Partial JWT cut at the end of the text.
  /\beyJ[\w-]+(?:\.[\w-]*){0,2}$/g,
];
// NAME=value / "name": "value" where NAME looks like a credential.
const ASSIGN =
  /(["']?[A-Za-z0-9_.-]{0,64}(?:api[_-]?key|token|secret|passw(?:or)?d|credential|private[_-]?key)[A-Za-z0-9_.-]{0,64}\\?["']?\s*[:=]\s*)(?:\\?"(?:[^"\\\n]|\\.)*"|\\?'(?:[^'\\\n]|\\.)*'|\\?"[^\n]*|\\?'[^\n]*|\[REDACTED\](?![\w.-])|[^\s"',;]+)/gi;

// scheme://user:pass@host keeps the scheme and host, drops the credentials.
const URL_USERINFO = /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi;

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// Returns {text, counts:{secrets, home}}. Idempotent: replacements never match again.
export function redactText(value, { home } = {}) {
  let text = typeof value === "string" ? value : "";
  const counts = { secrets: 0, home: 0 };
  const sub = (re, fn) => {
    text = text.replace(re, (...m) => {
      const out = fn(...m);
      if (out !== m[0]) counts.secrets++;
      return out;
    });
  };
  for (const re of SECRET_PATTERNS)
    sub(re, (m, name, sep) =>
      typeof name === "string" && typeof sep === "string"
        ? `${name}${sep}${REDACTED}`
        : REDACTED,
    );
  sub(URL_USERINFO, (_m, scheme) => `${scheme}${REDACTED}@`);
  sub(ASSIGN, (_m, lead) => `${lead}${REDACTED}`);
  if (typeof home === "string" && home.length > 1 && home !== "/") {
    const clean = home.replace(/[\\/]+$/, "");
    if (clean) {
      text = text.replace(
        new RegExp(`${escapeRe(clean)}(?=$|[\\\\/\\s"'\`)\\]:,;])`, "g"),
        () => {
          counts.home++;
          return "~";
        },
      );
    }
  }
  return { text, counts };
}

const clip = (v, n) =>
  typeof v === "string" ? v.slice(0, n).replace(/\p{Surrogate}$/u, "") : "";
function clipAtMarker(text, n) {
  const out = clip(text, n);
  const at = out.lastIndexOf("[");
  return at >= 0 &&
    out.length - at < REDACTED.length &&
    REDACTED.startsWith(out.slice(at)) &&
    out.length < text.length
    ? out.slice(0, at)
    : out;
}
const idOk = (v) => typeof v === "string" && v.length > 0 && v.length <= 256;
const TOOL_STATUS = ["pending", "running", "completed", "error"];
const ENV_FILE = /(^|[\\/\s"'])\.env(\.[\w.-]+)?(?=$|[\\/\s"'])/;

// session: {id,title,workspaceName?}; messages: projected WorkbenchMessage[].
export function buildExport({
  session,
  messages,
  includeToolOutputs = false,
  now,
  home,
  appVersion = "unknown",
}) {
  const totals = { secrets: 0, home: 0, envOutputs: 0 };
  const red = (v, n) => {
    // Bounded pre-clip (redaction only shrinks text, secrets are far shorter than the slack), redact,
    // then the final clip; a cut inside a [REDACTED] marker backs up to the marker start.
    // When pre-clipped the cut may leave a partial secret at the tail; unterminated quotes and partial
    // JWTs are redacted by the patterns, and a bounded tail is dropped for any other partial token shape.
    const cut = typeof v === "string" && v.length > n + 4096;
    const r = redactText(clip(v, n + 4096), { home });
    let text = r.text;
    // Only the unredacted tail after the last marker can hold a partial secret.
    if (cut)
      text = text.slice(
        0,
        Math.max(
          text.lastIndexOf(REDACTED) + REDACTED.length,
          text.length - TAIL_DROP,
        ),
      );
    totals.secrets += r.counts.secrets;
    totals.home += r.counts.home;
    return clipAtMarker(text, n);
  };
  let tools = 0;
  let outputs = 0;
  const out = [];
  for (const m of (Array.isArray(messages) ? messages : []).slice(
    -DATA_LIMITS.messages,
  )) {
    if (!m || !idOk(m.id) || !["user", "assistant"].includes(m.role)) continue;
    const row = { id: m.id, role: m.role, text: red(m.text, DATA_LIMITS.text) };
    if (m.role === "assistant" && Array.isArray(m.tools)) {
      row.tools = m.tools.slice(0, DATA_LIMITS.tools).map((t) => {
        tools++;
        const input = typeof t.input === "string" ? t.input : "";
        const tool = {
          id: clip(t.id, 256),
          name: clip(t.name, 128),
          status: TOOL_STATUS.includes(t.status) ? t.status : "error",
          input: red(input, DATA_LIMITS.toolInput),
        };
        if (includeToolOutputs) {
          if (ENV_FILE.test(input) || ENV_FILE.test(t.name ?? "")) {
            totals.envOutputs++;
            tool.output = "[.env 관련 출력 제거됨]";
          } else {
            tool.output = red(t.output, DATA_LIMITS.toolOutput);
            outputs++;
          }
        }
        return tool;
      });
    }
    out.push(row);
  }
  const doc = {
    format: EXPORT_FORMAT,
    version: EXPORT_VERSION,
    exportedAt: now,
    app: { name: "Oh My Own Code", version: clip(appVersion, 64) },
    sessions: [
      {
        meta: {
          id: clip(session?.id, 256),
          title: red(session?.title ?? "", 200),
          messageCount: out.length,
          toolOutputsIncluded: Boolean(includeToolOutputs),
        },
        messages: out,
      },
    ],
  };
  return {
    doc,
    summary: {
      sessions: 1,
      messages: out.length,
      tools,
      toolOutputsIncluded: Boolean(includeToolOutputs),
      toolOutputs: outputs,
      redactions: { ...totals },
    },
  };
}

// Strict whitelist rebuild; returns {doc} or {error}. Never trusts extra fields.
export function parseImport(text) {
  if (typeof text !== "string" || text.length > DATA_LIMITS.fileBytes)
    return { error: "TOO_LARGE" };
  let v;
  try {
    v = JSON.parse(text);
  } catch {
    return { error: "MALFORMED" };
  }
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    v.format !== EXPORT_FORMAT
  )
    return { error: "WRONG_FORMAT" };
  if (v.version !== EXPORT_VERSION) return { error: "UNSUPPORTED_VERSION" };
  if (
    typeof v.exportedAt !== "string" ||
    Number.isNaN(Date.parse(v.exportedAt)) ||
    !Array.isArray(v.sessions) ||
    v.sessions.length === 0 ||
    v.sessions.length > DATA_LIMITS.sessions
  )
    return { error: "MALFORMED" };
  const sessions = [];
  for (const s of v.sessions) {
    if (
      !s?.meta ||
      !idOk(s.meta.id) ||
      typeof s.meta.title !== "string" ||
      !Array.isArray(s.messages) ||
      s.messages.length > DATA_LIMITS.messages
    )
      return { error: "MALFORMED" };
    const messages = [];
    for (const m of s.messages) {
      if (
        !m ||
        !idOk(m.id) ||
        !["user", "assistant"].includes(m.role) ||
        typeof m.text !== "string" ||
        (m.tools !== undefined &&
          (!Array.isArray(m.tools) || m.tools.length > DATA_LIMITS.tools))
      )
        return { error: "MALFORMED" };
      const row = {
        id: m.id,
        role: m.role,
        // Imported text is redacted again: an edited file must not smuggle secrets in.
        text: redactText(clip(m.text, DATA_LIMITS.text)).text,
      };
      if (m.tools)
        row.tools = m.tools.map((t) => {
          if (!t || typeof t.name !== "string" || typeof t.input !== "string")
            throw new Error("MALFORMED");
          return {
            id: clip(t.id, 256),
            name: clip(t.name, 128),
            status: TOOL_STATUS.includes(t.status) ? t.status : "error",
            input: redactText(clip(t.input, DATA_LIMITS.toolInput)).text,
            ...(typeof t.output === "string" && {
              output: redactText(clip(t.output, DATA_LIMITS.toolOutput)).text,
            }),
          };
        });
      messages.push(row);
    }
    sessions.push({
      meta: {
        id: clip(s.meta.id, 256),
        title: redactText(clip(s.meta.title, 200)).text,
        messageCount: messages.length,
        toolOutputsIncluded: Boolean(s.meta.toolOutputsIncluded),
      },
      messages,
    });
  }
  return {
    doc: {
      format: EXPORT_FORMAT,
      version: EXPORT_VERSION,
      exportedAt: v.exportedAt,
      app: {
        name: clip(v.app?.name, 64),
        version: clip(v.app?.version, 64),
      },
      sessions,
    },
  };
}

// rows: [{id, at: ISO string}]. Pure; days 0 = retention off.
export function retentionCandidates(rows, days, now) {
  if (!RETENTION_OPTIONS.includes(days) || days === 0) return [];
  const cutoff = Date.parse(now) - days * 86400000;
  if (Number.isNaN(cutoff)) return [];
  return rows.filter((r) => {
    const t = Date.parse(r.at);
    return !Number.isNaN(t) && t < cutoff;
  });
}

const schemas = {
  "export.preview": ["session", "messages", "includeToolOutputs"],
  "export.save": ["session", "messages", "includeToolOutputs"],
  "import.open": [],
  "archives.list": [],
  "archives.get": ["id"],
  "archives.remove": ["id"],
  "retention.get": [],
  "retention.preview": ["days"],
  "retention.set": ["days"],
  "wipe.info": [],
  "wipe.run": ["word"],
};
export function validateDataRequest(value) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    !Object.hasOwn(schemas, value.type)
  )
    return undefined;
  const keys = schemas[value.type];
  const allowed = new Set(["type", ...keys]);
  if (
    Reflect.ownKeys(value).some((k) => !allowed.has(k)) ||
    keys.some((k) => !Object.hasOwn(value, k))
  )
    return undefined;
  if ("session" in value) {
    const s = value.session;
    if (
      !s ||
      typeof s !== "object" ||
      !idOk(s.id) ||
      typeof s.title !== "string" ||
      !Array.isArray(value.messages) ||
      value.messages.length > DATA_LIMITS.messages ||
      typeof value.includeToolOutputs !== "boolean"
    )
      return undefined;
  }
  if ("id" in value && !/^[A-Za-z0-9-]{8,64}$/.test(value.id)) return undefined;
  if ("days" in value && !RETENTION_OPTIONS.includes(value.days))
    return undefined;
  if ("word" in value && typeof value.word !== "string") return undefined;
  return value;
}
