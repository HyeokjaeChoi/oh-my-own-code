// Private inert data encoding. A digest is not permission or execution authority.
import { createHash } from "node:crypto";
import { types } from "node:util";

export const PERMISSION_DATA_MAX_BYTES = 1024 * 1024;
const MAX_DEPTH = 32;
const domains = new Set(["grant", "saved", "policy", "scope", "preview"]);
const invalid = () => {
  throw new Error("permission_control_invalid_data");
};
const validString = (value) => {
  if (!value.isWellFormed() || value.includes("\0")) invalid();
  return value;
};

export function permissionCanonicalJSON(value) {
  const chunks = [];
  const active = new WeakSet();
  let bytes = 0;
  const append = (chunk) => {
    bytes += Buffer.byteLength(chunk, "utf8");
    if (bytes > PERMISSION_DATA_MAX_BYTES) invalid();
    chunks.push(chunk);
  };
  const visit = (current, depth) => {
    if (depth > MAX_DEPTH) invalid();
    if (current === null || typeof current === "boolean") {
      append(JSON.stringify(current));
      return;
    }
    if (typeof current === "string") {
      if (
        Buffer.byteLength(current, "utf8") >
        PERMISSION_DATA_MAX_BYTES - bytes
      )
        invalid();
      append(JSON.stringify(validString(current)));
      return;
    }
    if (typeof current === "number") {
      if (
        !Number.isSafeInteger(current) ||
        current < 0 ||
        Object.is(current, -0)
      )
        invalid();
      append(String(current));
      return;
    }
    if (
      !current ||
      typeof current !== "object" ||
      types.isProxy(current) ||
      active.has(current)
    )
      invalid();
    active.add(current);
    const isArray = Array.isArray(current);
    if (
      Object.getPrototypeOf(current) !==
      (isArray ? Array.prototype : Object.prototype)
    )
      invalid();
    const keys = Reflect.ownKeys(current);
    if (keys.length > PERMISSION_DATA_MAX_BYTES) invalid();
    if (isArray) {
      const length = Object.getOwnPropertyDescriptor(current, "length").value;
      if (keys.length !== length + 1) invalid();
      append("[");
      for (let index = 0; index < length; index++) {
        const field = Object.getOwnPropertyDescriptor(current, String(index));
        if (!field?.enumerable || !Object.hasOwn(field, "value")) invalid();
        if (index) append(",");
        visit(field.value, depth + 1);
      }
      append("]");
    } else {
      if (keys.some((key) => typeof key !== "string")) invalid();
      // UTF-8 order differs from JavaScript's UTF-16 default for astral keys.
      let keyBytes = 2;
      const ordered = keys.map((key) => {
        validString(key);
        if (Buffer.byteLength(key, "utf8") > PERMISSION_DATA_MAX_BYTES - bytes)
          invalid();
        const encoded = JSON.stringify(key);
        keyBytes += Buffer.byteLength(encoded, "utf8") + 2;
        if (keyBytes > PERMISSION_DATA_MAX_BYTES - bytes) invalid();
        return { key, encoded, bytes: Buffer.from(key, "utf8") };
      });
      ordered.sort((a, b) => Buffer.compare(a.bytes, b.bytes));
      append("{");
      for (let index = 0; index < ordered.length; index++) {
        const { key, encoded } = ordered[index];
        const field = Object.getOwnPropertyDescriptor(current, key);
        if (!field?.enumerable || !Object.hasOwn(field, "value")) invalid();
        if (index) append(",");
        append(encoded);
        append(":");
        visit(field.value, depth + 1);
      }
      append("}");
    }
    active.delete(current);
  };
  visit(value, 0);
  return chunks.join("");
}

export function permissionDomainDigest(domain, value) {
  if (!domains.has(domain)) invalid();
  return createHash("sha256")
    .update(`omoc.permission.${domain}.v1\n`, "utf8")
    .update(permissionCanonicalJSON(value), "utf8")
    .digest("hex");
}
