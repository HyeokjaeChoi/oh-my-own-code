// ABI and inert resource-loading checks. These tests do not load Bun or libc.
import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import {
  DARWIN_DESCRIPTOR_FFI_SYMBOLS,
  DARWIN_DIRECTORY_FFI_SYMBOLS,
  openDarwinDescriptorFFI,
} from "./darwin-descriptor-ffi.mjs";
test("shared descriptor ABI matches the actual pre-extraction kernel including Apple arm64 variadic mode position", async () => {
  const source = await readFile(
    new URL(
      "../../../../docs/runs/permission-task-lifetime-integration/prechange/descriptor-ffi-before-r1/apps/desktop-app/src/host/configuration-save-kernel.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  const begin =
    source.indexOf('library = dlopen("/usr/lib/libSystem.B.dylib", ') +
    'library = dlopen("/usr/lib/libSystem.B.dylib", '.length;
  const end = source.indexOf("\n    });", begin) + 6;
  const original = new Function("return (" + source.slice(begin, end) + ");")();
  assert.deepEqual(DARWIN_DESCRIPTOR_FFI_SYMBOLS, original);
  assert.deepEqual(DARWIN_DESCRIPTOR_FFI_SYMBOLS.openat.args, [
    "i32",
    "ptr",
    "i32",
    "u64",
    "u64",
    "u64",
    "u64",
    "u64",
    "u64",
  ]);
  assert.ok(Object.isFrozen(DARWIN_DESCRIPTOR_FFI_SYMBOLS));
  for (const symbol of Object.values(DARWIN_DESCRIPTOR_FFI_SYMBOLS)) {
    assert.ok(Object.isFrozen(symbol));
    assert.ok(Object.isFrozen(symbol.args));
  }
});
test("Node cannot load the descriptor library or obtain syscall functions", async () => {
  assert.equal(globalThis.Bun, undefined, "this contracted test is Node-only");
  await assert.rejects(openDarwinDescriptorFFI, /unsupported_runtime/);
  await assert.rejects(
    openDarwinDescriptorFFI({ directory: true }),
    /unsupported_runtime/,
  );
});
test("directory ABI is a separate fixed opt-in with no writable or caller-defined symbols", async () => {
  assert.deepEqual(DARWIN_DIRECTORY_FFI_SYMBOLS, {
    fdopendir: { args: ["i32"], returns: "ptr" },
    readdir: { args: ["ptr"], returns: "ptr" },
    closedir: { args: ["ptr"], returns: "i32" },
  });
  assert.ok(Object.isFrozen(DARWIN_DIRECTORY_FFI_SYMBOLS));
  for (const value of Object.values(DARWIN_DIRECTORY_FFI_SYMBOLS)) {
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(value.args));
  }
  let traps = 0;
  const proxy = new Proxy(
    {},
    {
      getPrototypeOf() {
        traps++;
      },
      ownKeys() {
        traps++;
      },
    },
  );
  const getter = Object.defineProperty({}, "directory", {
    enumerable: true,
    get() {
      traps++;
      return true;
    },
  });
  for (const value of [
    proxy,
    getter,
    null,
    {},
    { directory: false },
    { directory: true, extra: true },
    { symbols: {} },
  ])
    await assert.rejects(openDarwinDescriptorFFI(value));
  assert.equal(traps, 0);
});
test("save kernel preserves every original byte outside the shared loader replacement", async () => {
  const original = await readFile(
    new URL(
      "../../../../docs/runs/permission-task-lifetime-integration/prechange/descriptor-ffi-before-r1/apps/desktop-app/src/host/configuration-save-kernel.mjs",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(
    createHash("sha256").update(original).digest("hex"),
    "3984812e18d5e2e27fe653020ce743688d21619d061a96ce16a36ef23bc2aab4",
  );
  const begin = original.indexOf('    const ffi = await import("bun:ffi");');
  const end = original.indexOf("\n    });", begin) + "\n    });".length;
  assert.ok(begin >= 0 && end > begin);
  const expected =
    'import { openDarwinDescriptorFFI } from "./darwin-descriptor-ffi.mjs";\n' +
    original.slice(0, begin) +
    "    ({ library, ptr, toArrayBuffer } = await openDarwinDescriptorFFI());" +
    original.slice(end);
  assert.equal(
    await readFile(
      new URL("./configuration-save-kernel.mjs", import.meta.url),
      "utf8",
    ),
    expected,
  );
});
