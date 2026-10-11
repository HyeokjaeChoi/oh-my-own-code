// Private shared Darwin FFI ABI. Import is inert; callers own library.close().
// This loader grants no path, root, IO settlement or permission authority.
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

export async function openDarwinDescriptorFFI() {
  if (
    process.platform !== "darwin" ||
    process.arch !== "arm64" ||
    globalThis.Bun?.version !== "1.4.2"
  )
    throw new Error("unsupported_runtime");
  const { dlopen, ptr, toArrayBuffer } = await import("bun:ffi");
  // Bun receives its own ABI descriptor copies; runtime internals cannot mutate
  // the source-owned declaration used by either descriptor kernel.
  const options = Object.fromEntries(
    Object.entries(symbols).map(([name, value]) => [
      name,
      { args: [...value.args], returns: value.returns },
    ]),
  );
  const library = dlopen("/usr/lib/libSystem.B.dylib", options);
  return Object.freeze({ library, ptr, toArrayBuffer });
}
