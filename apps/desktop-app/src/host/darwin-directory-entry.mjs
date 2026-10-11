// Pure Darwin inode64 dirent decoder; no filesystem or FFI initialization.
// Layout: local public SDK sys/dirent.h __DARWIN_STRUCT_DIRENTRY.
// This is not directory observation, completeness, or permission authority.
import { types } from "node:util";
import { validWorkspaceFilePath } from "../renderer/shared/workspace-file/index.mjs";
const byteLength = Object.getOwnPropertyDescriptor(
  Object.getPrototypeOf(Uint8Array.prototype),
  "byteLength",
).get;
const need = (value) => {
  if (!value) throw new Error("unsupported_directory_entry");
};
const kinds = new Map([
  [8, "file"],
  [4, "directory"],
  [10, "symlink"],
  [1, "other"],
  [2, "other"],
  [6, "other"],
  [12, "other"],
  [14, "other"],
]);
export function decodeDarwinDirectoryEntry(record) {
  need(!types.isProxy(record) && Buffer.isBuffer(record));
  const length = byteLength.call(record);
  need(length >= 24 && length <= 1048 && length % 4 === 0);
  const size = record[16] + record[17] * 256;
  const nameLength = record[18] + record[19] * 256;
  need(
    size === length &&
      nameLength > 0 &&
      nameLength <= 1023 &&
      nameLength + 22 <= size,
  );
  need(record[21 + nameLength] === 0);
  need(
    Array.from({ length: 8 }, (_, index) => record[index]).some(
      (value) => value !== 0,
    ),
  );
  const type = kinds.get(record[20]);
  need(type !== undefined); // Unknown kind cannot be silently omitted.
  const bytes = Buffer.alloc(nameLength);
  for (let index = 0; index < nameLength; index++) {
    need(record[21 + index] !== 0);
    bytes[index] = record[21 + index];
  }
  let name;
  try {
    name = new globalThis.TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes);
  } catch {
    need(false);
  }
  if (name === "." || name === "..") {
    need(type === "directory");
    return undefined;
  }
  need(!name.includes("/") && validWorkspaceFilePath(name));
  return Object.freeze({ name, type });
}
