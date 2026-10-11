import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { types } from "node:util";

// Exact capacity required by the fixed 35-source permission overlay.
const MAX_FILES = 35;
const MAX_EDITS = 256;
const MAX_BYTES = 32 * 1024 * 1024;
const byteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
).get;
const backingBuffer = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "buffer",
).get;

function requireValid(condition, reason) {
  if (!condition) throw new TypeError(`Invalid permission overlay: ${reason}`);
}

function record(value, keys) {
  requireValid(
    value !== null && typeof value === "object" && !types.isProxy(value),
    "record required",
  );
  requireValid(
    Object.getPrototypeOf(value) === Object.prototype,
    "record prototype",
  );
  const ownKeys = Reflect.ownKeys(value);
  requireValid(
    ownKeys.length === keys.length &&
      ownKeys.every((key) => keys.includes(key)),
    "record fields",
  );
  const copy = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    requireValid(
      descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable,
      "record data property required",
    );
    copy[key] = descriptor.value;
  }
  return copy;
}

function array(value, max) {
  requireValid(!types.isProxy(value) && Array.isArray(value), "array required");
  requireValid(
    Object.getPrototypeOf(value) === Array.prototype,
    "array prototype",
  );
  const length = Object.getOwnPropertyDescriptor(value, "length").value;
  requireValid(length <= max, "count limit");
  const keys = Reflect.ownKeys(value);
  requireValid(keys.length === length + 1, "dense closed array required");
  const copy = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    requireValid(
      descriptor && Object.hasOwn(descriptor, "value") && descriptor.enumerable,
      "array data element required",
    );
    copy.push(descriptor.value);
  }
  return copy;
}

function text(value, empty = false) {
  requireValid(
    typeof value === "string" && (empty || value.length > 0),
    "text required",
  );
  requireValid(value.length <= MAX_BYTES, "text byte limit");
  requireValid(value.isWellFormed() && !value.includes("\0"), "invalid text");
  requireValid(Buffer.byteLength(value) <= MAX_BYTES, "text byte limit");
  return value;
}

function path(value) {
  text(value);
  const parts = value.split("/");
  requireValid(
    parts.length >= 4 &&
      parts[0] === "node_modules" &&
      parts[1] === "@opencode" &&
      !value.includes("\\") &&
      !value.includes(":") &&
      parts.every((part) => part !== "" && part !== "." && part !== ".."),
    "relative normalized @opencode file path required",
  );
  return value;
}

function hash(value) {
  requireValid(
    typeof value === "string" &&
      value.length === 64 &&
      /^[a-f0-9]{64}$/u.test(value),
    "SHA256 required",
  );
  return value;
}

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function detachRecipe(input) {
  const recipe = record(input, [
    "schemaVersion",
    "id",
    "serverVersion",
    "files",
  ]);
  requireValid(
    recipe.schemaVersion === 1 && recipe.serverVersion === "2.0.18",
    "recipe version",
  );
  text(recipe.id);
  let editCount = 0;
  let recipeBytes = Buffer.byteLength(recipe.id);
  const paths = new Set();
  recipe.files = array(recipe.files, MAX_FILES).map((entry) => {
    const file = record(entry, [
      "path",
      "beforeSha256",
      "afterSha256",
      "edits",
    ]);
    path(file.path);
    requireValid(!paths.has(file.path), "duplicate recipe path");
    paths.add(file.path);
    hash(file.beforeSha256);
    hash(file.afterSha256);
    recipeBytes += Buffer.byteLength(file.path) + 128;
    const edits = array(file.edits, MAX_EDITS - editCount);
    editCount += edits.length;
    file.edits = edits.map((entry) => {
      const edit = record(entry, ["find", "replace"]);
      text(edit.find);
      text(edit.replace, true);
      recipeBytes +=
        Buffer.byteLength(edit.find) + Buffer.byteLength(edit.replace);
      requireValid(recipeBytes <= MAX_BYTES, "recipe byte limit");
      return edit;
    });
    requireValid(recipeBytes <= MAX_BYTES, "recipe byte limit");
    return file;
  });
  return recipe;
}

function sourceLength(content) {
  requireValid(
    !types.isProxy(content) &&
      Buffer.isBuffer(content) &&
      Object.getPrototypeOf(content) === Buffer.prototype,
    "ordinary Buffer required",
  );
  requireValid(
    !types.isSharedArrayBuffer(backingBuffer.call(content)),
    "shared Buffer refused",
  );
  return byteLength.call(content);
}

function detachSource(content, length) {
  // Buffers are opaque byte containers. Never enumerate metadata or call an
  // original Buffer method, getter or iterator. The detached bytes alone are
  // validated and hashed; caller metadata is neither executed nor projected.
  // Do not use the shared small-Buffer pool: even the underlying ArrayBuffer
  // must be separate from caller-owned bytes and other returned records.
  const copy = Buffer.alloc(length);
  Uint8Array.prototype.set.call(copy, content);
  requireValid(isUtf8(copy), "invalid UTF-8 source");
  for (const byte of copy) {
    requireValid(
      byte >= 32 || byte === 9 || byte === 10 || byte === 13,
      "binary source refused",
    );
  }
  return copy;
}

/** Pure synchronous byte planner. Never loads Native or reads/writes files.
 * The frozen envelope owns detached, mutable Buffers; consumers must verify
 * afterSha256 after copying them into a separately authorized staging tree.
 */
export function planNativePermissionOverlay(recipe, files) {
  const detachedRecipe = detachRecipe(recipe);
  const entries = array(files, MAX_FILES).map((entry) =>
    record(entry, ["path", "content"]),
  );
  const sources = new Map();
  let inputBytes = 0;
  for (const entry of entries) {
    path(entry.path);
    requireValid(!sources.has(entry.path), "duplicate source path");
    const length = sourceLength(entry.content);
    inputBytes += length;
    requireValid(inputBytes <= MAX_BYTES, "input byte limit");
    sources.set(entry.path, { content: entry.content, length });
  }
  requireValid(
    sources.size === detachedRecipe.files.length &&
      detachedRecipe.files.every((file) => sources.has(file.path)),
    "exact source path set required",
  );
  for (const [path, source] of sources) {
    sources.set(path, detachSource(source.content, source.length));
  }
  // Validate the complete input set before transforming any file.
  for (const file of detachedRecipe.files) {
    requireValid(
      sha256(sources.get(file.path)) === file.beforeSha256,
      "input hash mismatch",
    );
  }
  let outputBytes = 0;
  const result = detachedRecipe.files.map((file) => {
    let output = sources.get(file.path).toString("utf8");
    for (const edit of file.edits) {
      const index = output.indexOf(edit.find);
      requireValid(
        index >= 0 && output.indexOf(edit.find, index + 1) === -1,
        "unique anchor required",
      );
      const nextLength =
        Buffer.byteLength(output) -
        Buffer.byteLength(edit.find) +
        Buffer.byteLength(edit.replace);
      requireValid(
        inputBytes + outputBytes + nextLength <= MAX_BYTES,
        "output byte limit",
      );
      // Concatenation is literal: replacement strings such as $& never expand.
      output =
        output.slice(0, index) +
        edit.replace +
        output.slice(index + edit.find.length);
    }
    requireValid(
      inputBytes + outputBytes + Buffer.byteLength(output) <= MAX_BYTES,
      "output byte limit",
    );
    const content = Buffer.alloc(Buffer.byteLength(output));
    content.write(output, "utf8");
    outputBytes += content.length;
    requireValid(sha256(content) === file.afterSha256, "output hash mismatch");
    return Object.freeze({
      path: file.path,
      beforeSha256: file.beforeSha256,
      afterSha256: file.afterSha256,
      content,
    });
  });
  return Object.freeze({
    schemaVersion: 1,
    recipeSha256: sha256(canonical(detachedRecipe)),
    files: Object.freeze(result),
  });
}
