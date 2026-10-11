// Private payload identity only. No journal, Native, file IO or execution authority.
import { createHash } from "node:crypto";
import { types } from "node:util";
import { permissionCanonicalJSON } from "./permission-control-canonical.mjs";
import { validWireId } from "./wire-id.mjs";
import { validWorkspaceFilePath } from "./renderer/shared/workspace-file/index.mjs";

const TEXT_BYTES = 65536;
const FILE_BYTES = 8388608;
const SEND_BYTES = 16777216;
const MIME_TYPES = [
  "text/plain",
  "application/pdf",
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
];
const invalid = () => {
  throw new Error("permission_control_invalid_data");
};
const need = (condition) => {
  if (!condition) invalid();
};
const hash = (text, encoding = "utf8") =>
  createHash("sha256").update(text, encoding).digest("hex");

function capture(value, required, optional = []) {
  need(value && typeof value === "object" && !types.isProxy(value));
  need(Object.getPrototypeOf(value) === Object.prototype);
  const keys = Reflect.ownKeys(value);
  need(required.every((key) => Object.hasOwn(value, key)));
  const copy = {};
  for (const key of keys) {
    need(typeof key === "string" && [...required, ...optional].includes(key));
    const field = Object.getOwnPropertyDescriptor(value, key);
    need(field.enumerable && Object.hasOwn(field, "value"));
    copy[key] = field.value;
  }
  return copy;
}

function captureFiles(value) {
  need(value && typeof value === "object" && !types.isProxy(value));
  need(
    Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype,
  );
  const length = Object.getOwnPropertyDescriptor(value, "length").value;
  need(
    length > 0 && length <= 8 && Reflect.ownKeys(value).length === length + 1,
  );
  const entries = [];
  let total = 0;
  for (let index = 0; index < length; index++) {
    const field = Object.getOwnPropertyDescriptor(value, String(index));
    need(field?.enumerable && Object.hasOwn(field, "value"));
    const entry = capture(field.value, ["uri", "name"]);
    need(
      typeof entry.name === "string" &&
        !entry.name.includes("/") &&
        validWorkspaceFilePath(entry.name),
    );
    need(
      typeof entry.uri === "string" &&
        entry.uri.length <= Math.ceil(FILE_BYTES / 3) * 4 + 64,
    );
    const comma = entry.uri.indexOf(",");
    const prefix = entry.uri.slice(0, comma);
    const mime = MIME_TYPES.find((type) => prefix === `data:${type};base64`);
    need(mime !== undefined);
    const encoded = entry.uri.slice(comma + 1);
    const limit = mime === "text/plain" ? TEXT_BYTES : FILE_BYTES;
    need(
      encoded.length <= Math.ceil(limit / 3) * 4 && encoded.length % 4 === 0,
    );
    need(/^[A-Za-z0-9+/]*={0,2}$/.test(encoded));
    const padding = encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0;
    const bytes = (encoded.length / 4) * 3 - padding;
    need(bytes >= 0 && bytes <= limit);
    total += bytes;
    need(total <= SEND_BYTES);
    entries.push({ ...entry, mime, bytes, encoded });
  }
  // Every descriptor, encoded bound and aggregate is checked before any decode.
  for (const entry of entries)
    need(
      Buffer.from(entry.encoded, "base64").toString("base64") === entry.encoded,
    );
  return entries;
}

export function permissionPromptInputDigest(input) {
  const value = capture(input, ["sessionID", "text"], ["delivery", "files"]);
  need(validWireId(value.sessionID));
  need(
    typeof value.text === "string" &&
      value.text.length <= 32000 &&
      value.text.isWellFormed() &&
      !value.text.includes("\0") &&
      value.text.trim().length > 0,
  );
  const hasDelivery = Object.hasOwn(value, "delivery");
  need(!hasDelivery || ["steer", "queue"].includes(value.delivery));
  const hasFiles = Object.hasOwn(value, "files");
  const files = hasFiles ? captureFiles(value.files) : [];
  const body = {
    version: 1,
    kind: "prompt",
    sessionID: value.sessionID,
    text: {
      bytes: Buffer.byteLength(value.text, "utf8"),
      digest: hash(value.text),
    },
    delivery: {
      present: hasDelivery,
      value: hasDelivery ? value.delivery : "steer",
    },
    files: {
      present: hasFiles,
      items: files.map((entry) => ({
        name: entry.name,
        mime: entry.mime,
        bytes: entry.bytes,
        uriDigest: hash(entry.uri, "ascii"),
      })),
    },
  };
  return hash(`omoc.permission.input.v1\n${permissionCanonicalJSON(body)}`);
}
