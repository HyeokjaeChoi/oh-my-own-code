// Host-only, in-memory checked attachment snapshots. Importing performs no IO.
import { createHash, randomUUID } from "node:crypto";
import * as actualIO from "node:fs/promises";
import { isAbsolute, normalize } from "node:path";
import { fail } from "../workbench-contract.mjs";
import {
  validWorkspaceFileRoot,
  workspaceFilePathReason,
  workspaceFileContentFits,
} from "../renderer/shared/workspace-file/index.mjs";
import { observeWorkspaceFileBytes } from "./workbench-file-edit.mjs";

const TEXT_BYTES = 65536;
const MEDIA_BYTES = 8 * 1024 * 1024;
const SEND_BYTES = 16 * 1024 * 1024;
const CACHE_BYTES = 64 * 1024 * 1024;
const TTL = 10 * 60 * 1000;
const id = (v) => typeof v === "string" && /^[A-Za-z0-9_.:-]{1,128}$/u.test(v);
const hex = (v) => typeof v === "string" && /^[a-f0-9]{64}$/u.test(v);
const data = (v) =>
  Boolean(
    v &&
      Object.getPrototypeOf(v) === Object.prototype &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
const closed = (v, required, optional = []) =>
  data(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Reflect.ownKeys(v).every((k) => required.includes(k) || optional.includes(k));
const validWorkspace = (w) =>
  closed(w, ["id", "path"]) &&
  id(w.id) &&
  validWorkspaceFileRoot(w.path) &&
  isAbsolute(w.path) &&
  normalize(w.path) === w.path;
function captureScope(value, observe = false) {
  if (
    !closed(
      value,
      ["runtimeEpoch", "sender", "check"],
      observe ? ["selection"] : [],
    ) ||
    !id(value.runtimeEpoch) ||
    typeof value.sender !== "string" ||
    !value.sender.length ||
    value.sender.length > 256 ||
    !value.sender.isWellFormed() ||
    typeof value.check !== "function"
  )
    fail("INVALID_REQUEST");
  const s = { ...value };
  if (Object.hasOwn(s, "selection")) {
    const r = s.selection;
    if (
      !closed(r, ["version", "start", "end"]) ||
      !hex(r.version) ||
      !Number.isSafeInteger(r.start) ||
      !Number.isSafeInteger(r.end) ||
      r.start < 0 ||
      r.start >= r.end
    )
      fail("INVALID_REQUEST");
    s.selection = { ...r };
  }
  return s;
}
const prefix = (bytes, signature) =>
  bytes.length >= signature.length &&
  bytes.subarray(0, signature.length).equals(signature);
function mediaMime(bytes) {
  if (prefix(bytes, Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])))
    return "image/png";
  if (prefix(bytes, Buffer.from([255, 216, 255]))) return "image/jpeg";
  if (
    prefix(bytes, Buffer.from("GIF87a")) ||
    prefix(bytes, Buffer.from("GIF89a"))
  )
    return "image/gif";
  if (
    prefix(bytes, Buffer.from("RIFF")) &&
    bytes.length >= 12 &&
    bytes.toString("ascii", 8, 12) === "WEBP"
  )
    return "image/webp";
  if (prefix(bytes, Buffer.from("%PDF-"))) return "application/pdf";
  return undefined;
}
function decodeText(bytes) {
  let text;
  try {
    text = new globalThis.TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    return undefined;
  }
  if (!workspaceFileContentFits(text)) return undefined;
  // SVG is text syntactically, but is outside the supported attachment types.
  const head = text
    .replace(/^\uFEFF/u, "")
    .trimStart()
    .replace(/^(?:(?:<\?[\s\S]*?\?>|<!--[\s\S]*?-->)\s*)*/u, "");
  if (/^<(?:svg\b|!DOCTYPE\s+svg\b)/iu.test(head)) return undefined;
  return text;
}
function boundary(text, offset) {
  return (
    offset <= text.length &&
    !(
      offset > 0 &&
      offset < text.length &&
      /[\uD800-\uDBFF]/u.test(text[offset - 1]) &&
      /[\uDC00-\uDFFF]/u.test(text[offset])
    )
  );
}
function equalDescriptor(value, expected) {
  if (!closed(value, Object.keys(expected))) return false;
  return Object.keys(expected).every((k) =>
    k === "range"
      ? closed(value.range, ["start", "end"]) &&
        value.range.start === expected.range.start &&
        value.range.end === expected.range.end
      : value[k] === expected[k],
  );
}
const unavailable = (reason) => ({ status: "unavailable", reason });
const unsupported = (reason) => ({ status: "unsupported", reason });

export function createConversationContextIO(options = {}) {
  if (!closed(options, [], ["io", "now", "randomId", "validateImage"]))
    fail("INVALID_REQUEST");
  const {
    io = actualIO,
    now = () => Math.floor(globalThis.performance.now()),
    randomId = randomUUID,
    validateImage,
  } = options;
  if (
    !io ||
    !["open", "lstat", "realpath"].every((k) => typeof io[k] === "function") ||
    typeof now !== "function" ||
    typeof randomId !== "function" ||
    (validateImage !== undefined && typeof validateImage !== "function")
  )
    fail("INVALID_REQUEST");
  const entries = new Map(),
    closedSenders = new Set();
  let closedAll = false,
    serial = 0;
  function active(s) {
    if (closedAll || closedSenders.has(s.sender)) fail("INVALID_SELECTION");
  }
  function check(s) {
    s.check();
    active(s);
  }
  function clock() {
    const value = now();
    if (!Number.isSafeInteger(value) || value < 0) fail("INVALID_REQUEST");
    return value;
  }
  function revoke(entry) {
    entry.reusable = false;
    if (entry.pins === 0) {
      entries.delete(entry.descriptor.capabilityId);
      entry.bytes = undefined;
    }
  }
  function expire(time) {
    for (const entry of entries.values())
      if (time - entry.touched >= TTL) revoke(entry);
  }
  function unpin(entry) {
    entry.pins--;
    if (entry.pins === 0 && !entry.reusable) revoke(entry);
  }
  async function observe(workspace, relativePath, scope) {
    if (
      !validWorkspace(workspace) ||
      workspaceFilePathReason(relativePath) === "invalid_path"
    )
      fail("INVALID_REQUEST");
    const w = { ...workspace },
      s = captureScope(scope, true);
    check(s);
    const source = await observeWorkspaceFileBytes(w, relativePath, {
      io,
      check: () => check(s),
      maxBytes: MEDIA_BYTES,
      byteLimit: (bytes) => (mediaMime(bytes) ? MEDIA_BYTES : TEXT_BYTES),
    });
    check(s);
    if (source.status !== "available")
      return { status: source.status, reason: source.reason };
    const mime = mediaMime(source.bytes) ?? "text/plain";
    let bytes = source.bytes,
      text;
    if (mime === "text/plain") {
      text = decodeText(bytes);
      if (text === undefined) return unsupported("unsupported_content");
    }
    if (s.selection) {
      if (source.version !== s.selection.version)
        return unavailable("file_changed");
      if (
        text === undefined ||
        !boundary(text, s.selection.start) ||
        !boundary(text, s.selection.end)
      )
        fail("INVALID_REQUEST");
      text = text.slice(s.selection.start, s.selection.end);
      bytes = Buffer.from(text, "utf8");
    }
    // The caller cannot mutate our held bytes through an injected decoder.
    if (mime.startsWith("image/") && validateImage) {
      let valid;
      try {
        check(s);
        valid = await validateImage(Buffer.from(bytes), mime);
      } catch (e) {
        check(s);
        if (e?.appCode) throw e;
        return unsupported("unsupported_content");
      }
      check(s);
      if (valid !== true) return unsupported("unsupported_content");
    }
    bytes = Buffer.from(bytes);
    const token = randomId();
    check(s);
    if (!id(token) || token.length > 96) fail("INVALID_REQUEST");
    if (!Number.isSafeInteger(serial + 1)) fail("LIMIT_REACHED");
    const capabilityId = `${token}.${++serial}`;
    const descriptor = Object.freeze({
      capabilityId,
      workspaceId: w.id,
      workspacePath: w.path,
      path: relativePath,
      name: relativePath.split("/").at(-1),
      source: s.selection ? "selection" : "file",
      version: source.version,
      digest: createHash("sha256").update(bytes).digest("hex"),
      mime,
      size: bytes.length,
      ...(s.selection
        ? {
            range: Object.freeze({
              start: s.selection.start,
              end: s.selection.end,
            }),
          }
        : {}),
    });
    const preview = Object.freeze(
      mime === "text/plain"
        ? { kind: "text", text }
        : mime === "application/pdf"
          ? { kind: "pdf" }
          : {
              kind: "image",
              dataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
            },
    );
    check(s);
    const time = clock();
    active(s);
    expire(time);
    const owned = [...entries.values()].filter(
      (entry) => entry.sender === s.sender,
    );
    let count = owned.length,
      size = owned.reduce((total, entry) => total + entry.bytes.length, 0);
    const victims = [];
    // Map order is successful observation/acquisition order, including equal clocks.
    for (const entry of owned) {
      if (count < 64 && size + bytes.length <= CACHE_BYTES) break;
      if (entry.pins !== 0) continue;
      victims.push(entry);
      count--;
      size -= entry.bytes.length;
    }
    if (count >= 64 || size + bytes.length > CACHE_BYTES) fail("LIMIT_REACHED");
    // No caller callbacks occur between the capacity decision and publication.
    for (const entry of victims) revoke(entry);
    entries.set(capabilityId, {
      descriptor,
      bytes,
      sender: s.sender,
      runtimeEpoch: s.runtimeEpoch,
      touched: time,
      pins: 0,
      reusable: true,
    });
    return Object.freeze({ status: "available", descriptor, preview });
  }
  function acquire(descriptors, workspace, scope) {
    if (!validWorkspace(workspace)) fail("INVALID_REQUEST");
    const w = { ...workspace },
      s = captureScope(scope);
    if (
      !Array.isArray(descriptors) ||
      Object.getPrototypeOf(descriptors) !== Array.prototype
    )
      fail("INVALID_SELECTION");
    if (descriptors.length > 8) fail("LIMIT_REACHED");
    if (
      Reflect.ownKeys(descriptors).length !== descriptors.length + 1 ||
      !Array.from({ length: descriptors.length }, (_, i) =>
        Object.getOwnPropertyDescriptor(descriptors, String(i)),
      ).every((d) => d && Object.hasOwn(d, "value"))
    )
      fail("INVALID_SELECTION");
    // Capture all request fields/order before a caller check can reenter. Never
    // invoke an array accessor installed by that callback or consume new fields.
    const requested = Array.from({ length: descriptors.length }, (_, i) => {
      const descriptor = Object.getOwnPropertyDescriptor(
        descriptors,
        String(i),
      ).value;
      if (!data(descriptor)) fail("INVALID_SELECTION");
      const copy = { ...descriptor };
      if (Object.hasOwn(copy, "range")) {
        if (!closed(copy.range, ["start", "end"])) fail("INVALID_SELECTION");
        copy.range = { ...copy.range };
      }
      return copy;
    });
    check(s);
    let time = clock();
    active(s);
    expire(time);
    const selected = [],
      seen = new Set();
    let total = 0;
    for (const descriptor of requested) {
      if (!data(descriptor)) fail("INVALID_SELECTION");
      const entry = entries.get(descriptor.capabilityId);
      if (
        !entry ||
        !entry.reusable ||
        seen.has(descriptor.capabilityId) ||
        entry.sender !== s.sender ||
        entry.runtimeEpoch !== s.runtimeEpoch ||
        entry.descriptor.workspaceId !== w.id ||
        entry.descriptor.workspacePath !== w.path ||
        !equalDescriptor(descriptor, entry.descriptor)
      )
        fail("INVALID_SELECTION");
      selected.push(entry);
      seen.add(descriptor.capabilityId);
      total += entry.bytes.length;
    }
    if (total > SEND_BYTES) fail("LIMIT_REACHED");
    for (const entry of selected) entry.pins++;
    let files;
    try {
      files = Object.freeze(
        selected.map((entry) =>
          Object.freeze({
            uri: `data:${entry.descriptor.mime};base64,${entry.bytes.toString("base64")}`,
            name: entry.descriptor.name,
          }),
        ),
      );
      check(s);
      time = clock();
      active(s);
      expire(time);
      if (
        selected.some(
          (entry) =>
            !entry.reusable ||
            entries.get(entry.descriptor.capabilityId) !== entry,
        )
      )
        fail("INVALID_SELECTION");
    } catch (e) {
      for (const entry of selected) unpin(entry);
      throw e;
    }
    for (const entry of selected) {
      entry.touched = time;
      entries.delete(entry.descriptor.capabilityId);
      entries.set(entry.descriptor.capabilityId, entry);
    }
    let released = false;
    return Object.freeze({
      files,
      release() {
        if (released) return;
        released = true;
        for (const entry of selected) unpin(entry);
      },
    });
  }
  function closeSender(sender) {
    if (
      typeof sender !== "string" ||
      !sender.length ||
      sender.length > 256 ||
      !sender.isWellFormed()
    )
      fail("INVALID_REQUEST");
    closedSenders.add(sender);
    for (const entry of entries.values())
      if (entry.sender === sender) revoke(entry);
  }
  function close() {
    closedAll = true;
    for (const entry of entries.values()) revoke(entry);
  }
  return Object.freeze({ observe, acquire, closeSender, close });
}
