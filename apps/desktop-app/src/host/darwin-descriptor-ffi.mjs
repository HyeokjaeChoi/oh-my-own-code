// Private shared Darwin FFI ABI. Import is inert; callers own library.close().
// This loader grants no path, root, IO settlement or permission authority.
import { types } from "node:util";
const symbols = {
  openat: {
    // Apple arm64 variadic mode belongs at stack[0], not x3.
    // Occupy x3..x7 so the ninth fixed FFI argument is stack[0].
    // https://developer.apple.com/documentation/apple-silicon/addressing-architectural-differences-in-your-macos-code
    args: ["i32", "ptr", "i32", "u64", "u64", "u64", "u64", "u64", "u64"],
    returns: "i32",
  },
  renameatx_np: {
    args: ["i32", "ptr", "i32", "ptr", "u32"],
    returns: "i32",
  },
  flistxattr: { args: ["i32", "ptr", "u64", "i32"], returns: "i64" },
  fgetxattr: {
    args: ["i32", "ptr", "ptr", "u64", "u32", "i32"],
    returns: "i64",
  },
  fsetxattr: {
    args: ["i32", "ptr", "ptr", "u64", "u32", "i32"],
    returns: "i32",
  },
  fremovexattr: { args: ["i32", "ptr", "i32"], returns: "i32" },
  acl_get_fd_np: { args: ["i32", "i32"], returns: "ptr" },
  acl_free: { args: ["ptr"], returns: "i32" },
  fgetattrlist: {
    args: ["i32", "ptr", "ptr", "u64", "u32"],
    returns: "i32",
  },
  __error: { args: [], returns: "ptr" },
};
for (const value of Object.values(symbols)) {
  Object.freeze(value.args);
  Object.freeze(value);
}
export const DARWIN_DESCRIPTOR_FFI_SYMBOLS = Object.freeze(symbols);
// Public Darwin dirent.h. arm64 uses unsuffixed inode64/UNIX03 symbols
// (sys/cdefs.h __DARWIN_ONLY_64_BIT_INO_T / __DARWIN_ONLY_UNIX_CONFORMANCE).
export const DARWIN_DIRECTORY_FFI_SYMBOLS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      fdopendir: { args: ["i32"], returns: "ptr" },
      readdir: { args: ["ptr"], returns: "ptr" },
      closedir: { args: ["ptr"], returns: "i32" },
    }).map(([name, value]) => [
      name,
      Object.freeze({ ...value, args: Object.freeze(value.args) }),
    ]),
  ),
);

export async function openDarwinDescriptorFFI(options) {
  // An internal fixed opt-in only; never a caller-provided FFI symbol table.
  const directory = options !== undefined;
  if (
    directory &&
    (options === null ||
      typeof options !== "object" ||
      types.isProxy(options) ||
      Object.getPrototypeOf(options) !== Object.prototype ||
      Reflect.ownKeys(options).length !== 1 ||
      Object.getOwnPropertyDescriptor(options, "directory")?.enumerable !==
        true ||
      Object.getOwnPropertyDescriptor(options, "directory")?.value !== true)
  )
    throw new Error("unsupported_runtime");
  if (
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    globalThis.Bun?.version !== "1.4.2"
  )
    throw new Error("unsupported_runtime");
  const { dlopen, ptr, toArrayBuffer } = await import("bun:ffi");
  // Bun receives its own ABI descriptor copies; runtime internals cannot mutate
  // the source-owned declaration used by either descriptor kernel.
  const ffiOptions = Object.fromEntries(
    Object.entries(
      directory ? { ...symbols, ...DARWIN_DIRECTORY_FFI_SYMBOLS } : symbols,
    ).map(([name, value]) => [
      name,
      { args: [...value.args], returns: value.returns },
    ]),
  );
  const library = dlopen("/usr/lib/libSystem.B.dylib", ffiOptions);
  return Object.freeze({ library, ptr, toArrayBuffer });
}
