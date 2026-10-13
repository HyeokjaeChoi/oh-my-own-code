import { createRequire } from "node:module";
import { join } from "node:path";

// Loads the staged node-pty (see scripts/stage-node-pty.mjs). Returns undefined when it is
// missing or fails to load, so the terminal host fails closed with PTY_UNAVAILABLE.
export function loadStagedPty(resourcesPath) {
  try {
    return createRequire(import.meta.url)(
      join(resourcesPath, "node-pty", "lib", "index.js"),
    );
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
