import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";

// Loads the staged node-pty (see scripts/stage-node-pty.mjs). Returns undefined when it is
// missing or fails to load, so the terminal host fails closed with PTY_UNAVAILABLE.
export function loadStagedPty(resourcesPath) {
  const base = join(resourcesPath, "node-pty");
  // node-pty tries build/Release and build/Debug before prebuilds/; a stray build tree would
  // shadow the stamped binary, so refuse to load at all.
  if (existsSync(join(base, "build")) || existsSync(join(base, "lib", "build")))
    return undefined;
  try {
    return createRequire(import.meta.url)(join(base, "lib", "index.js"));
  } catch {
    return undefined;
  }
}

// Defers the native load to the first spawn; a failed load throws PTY_UNAVAILABLE.
export function lazyPty(load) {
  let pty;
  return {
    spawn(...args) {
      pty ??= load();
      if (!pty)
        throw Object.assign(new Error("node-pty unavailable"), {
          terminalCode: "PTY_UNAVAILABLE",
        });
      return pty.spawn(...args);
    },
  };
}
