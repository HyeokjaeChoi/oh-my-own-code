// Shared private initialization. Pure validation; no Effect or Native imports.
import { types } from "node:util";
import { validWireId } from "./wire-id.mjs";

const error = (code) => new Error(`native_permission_${code}`);
const reject = (code) => {
  throw error(code);
};

export function record(value, fields) {
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    reject("input");
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== fields.length ||
    keys.some((key) => !fields.includes(key))
  )
    reject("input");
  const copy = {};
  for (const key of fields) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    if (!field?.enumerable || !Object.hasOwn(field, "value")) reject("input");
    copy[key] = field.value;
  }
  return copy;
}

export function array(value, maximum) {
  if (
    !Array.isArray(value) ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Array.prototype
  )
    reject("input");
  const length = Object.getOwnPropertyDescriptor(value, "length").value;
  if (length > maximum || Reflect.ownKeys(value).length !== length + 1)
    reject("input");
  const copy = [];
  for (let i = 0; i < length; i++) {
    const item = Object.getOwnPropertyDescriptor(value, String(i));
    if (!item?.enumerable || !Object.hasOwn(item, "value")) reject("input");
    copy.push(item.value);
  }
  return copy;
}

export function text(value, maximum = 4096) {
  if (
    typeof value !== "string" ||
    !value.length ||
    !value.isWellFormed() ||
    Array.from(value).some(
      (char) => char.codePointAt(0) < 32 || char === "\x7f",
    ) ||
    Buffer.byteLength(value, "utf8") > maximum
  )
    reject("input");
  return value;
}

export function identifier(value) {
  text(value, 128);
  if (!/^[A-Za-z0-9_-]+$/u.test(value)) reject("input");
  return value;
}

export function initialization(input) {
  const { runtimeEpoch, bootHolds } = record(input, [
    "runtimeEpoch",
    "bootHolds",
  ]);
  identifier(runtimeEpoch);
  const holds = array(bootHolds, 1024).map((item) => {
    const row = record(item, ["projectId", "originalOperationKey"]);
    text(row.projectId);
    text(row.originalOperationKey);
    return Object.freeze(row);
  });
  holds.sort(
    (a, b) =>
      compare(a.projectId, b.projectId) ||
      compare(a.originalOperationKey, b.originalOperationKey),
  );
  return Object.freeze({
    runtimeEpoch,
    bootHolds: Object.freeze(
      holds.filter(
        (row, i) =>
          !i ||
          row.projectId !== holds[i - 1].projectId ||
          row.originalOperationKey !== holds[i - 1].originalOperationKey,
      ),
    ),
  });
}

function compare(a, b) {
  return a < b ? -1 : a > b ? 1 : 0;
}

// Metadata only: no raw prompt, file content or allocated Native identity.
export function taskPreparation(input) {
  const request = record(input, [
    "originKind",
    "origin",
    "workspaceId",
    "appSessionId",
    "nativeSessionId",
    "inputDigest",
  ]);
  const origin = record(request.origin, [
    "runtimeEpoch",
    "operationId",
    "type",
    "digest",
  ]);
  if (request.originKind !== "prompt" || origin.type !== "message.send")
    reject("input");
  for (const value of [
    origin.runtimeEpoch,
    origin.operationId,
    request.workspaceId,
    request.appSessionId,
    request.nativeSessionId,
  ]) {
    if (!validWireId(value)) reject("input");
  }
  for (const value of [origin.digest, request.inputDigest]) {
    if (typeof value !== "string" || !/^[a-f0-9]{64}$/u.test(value))
      reject("input");
  }
  return Object.freeze({ ...request, origin: Object.freeze(origin) });
}
