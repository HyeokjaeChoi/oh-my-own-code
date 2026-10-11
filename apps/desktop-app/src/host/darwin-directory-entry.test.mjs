// Struct samples, not actual Darwin readdir execution or directory confinement.
import assert from "node:assert/strict";
import test from "node:test";
import { decodeDarwinDirectoryEntry } from "./darwin-directory-entry.mjs";
function entry(name, type = 8) {
  const bytes = Buffer.from(name);
  const record = Buffer.alloc(Math.ceil((22 + bytes.length) / 4) * 4);
  record.writeBigUInt64LE(42n, 0);
  record.writeUInt16LE(record.length, 16);
  record.writeUInt16LE(bytes.length, 18);
  record[20] = type;
  bytes.copy(record, 21);
  return record;
}
test("inode64 dirent fields decode only the bounded name and type", () => {
  for (const [code, type] of [
    [8, "file"],
    [4, "directory"],
    [10, "symlink"],
    [1, "other"],
    [2, "other"],
    [6, "other"],
    [12, "other"],
  ]) {
    const decoded = decodeDarwinDirectoryEntry(entry("한글 이름.txt", code));
    assert.deepEqual(decoded, { name: "한글 이름.txt", type });
    assert.ok(Object.isFrozen(decoded));
  }
  for (const name of [".", ".."])
    assert.equal(decodeDarwinDirectoryEntry(entry(name, 4)), undefined);
});
test("malformed size, kind, UTF8 and paths refuse the entire entry", () => {
  for (const input of [
    null,
    {},
    new Uint8Array(24),
    Buffer.alloc(0),
    Buffer.alloc(21),
  ])
    assert.throws(() => decodeDarwinDirectoryEntry(input));
  for (const name of [
    "",
    "/",
    "a/b",
    "a\\b",
    "a\0b",
    "x\n",
    "CON",
    "trailing.",
    "x".repeat(256),
  ])
    assert.throws(() => decodeDarwinDirectoryEntry(entry(name)));
  for (const mutate of [
    (r) => r.writeUInt16LE(r.length - 1, 16),
    (r) => r.writeUInt16LE(1049, 16),
    (r) => r.writeUInt16LE(0, 18),
    (r) => r.writeUInt16LE(1024, 18),
    (r) => {
      r[21 + r.readUInt16LE(18)] = 65;
    },
    (r) => {
      r[21] = 0xff;
    },
    (r) => {
      r[20] = 0;
    },
    (r) => {
      r[20] = 255;
    },
    (r) => r.writeBigUInt64LE(0n, 0),
  ]) {
    const record = entry("test");
    mutate(record);
    assert.throws(() => decodeDarwinDirectoryEntry(record));
  }
  assert.throws(() =>
    decodeDarwinDirectoryEntry(Buffer.concat([entry("test"), Buffer.alloc(4)])),
  );
});
