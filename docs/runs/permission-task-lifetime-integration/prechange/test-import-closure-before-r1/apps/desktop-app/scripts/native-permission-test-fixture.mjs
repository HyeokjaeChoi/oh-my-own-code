// Node test source preparation only. This never loads copied modules or Native.
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { EVENT_HOST_CODE_ASSETS } from "../src/event-host-resources.mjs";
import { localResourceImports } from "./stage-event-host.mjs";

// Follow actual local imports within the same closed staged-source allowlist.
// Tests must not silently omit a new dependency or substitute installed code.
export function copyPermissionControlSources(namespace) {
  return copyPermissionTestSources(namespace, [
    "native-permission-control.mjs",
  ]);
}

export async function copyPermissionTestSources(namespace, entries) {
  const allowed = new Set(EVENT_HOST_CODE_ASSETS);
  const pending = [...entries];
  const copied = new Map();
  while (pending.length) {
    const path = pending.shift();
    if (copied.has(path)) continue;
    if (!allowed.has(path)) throw new Error("undeclared_control_test_source");
    const bytes = await readFile(new URL(`../src/${path}`, import.meta.url));
    for (const specifier of localResourceImports(
      bytes.toString("utf8"),
      path,
    )) {
      const dependency = posix.normalize(
        posix.join(posix.dirname(path), specifier),
      );
      if (!allowed.has(dependency))
        throw new Error("undeclared_control_test_source");
      pending.push(dependency);
    }
    const target = join(namespace, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: "wx" });
    copied.set(
      path,
      Object.freeze({
        path,
        sha256: createHash("sha256").update(bytes).digest("hex"),
      }),
    );
  }
  return Object.freeze([...copied.values()]);
}
