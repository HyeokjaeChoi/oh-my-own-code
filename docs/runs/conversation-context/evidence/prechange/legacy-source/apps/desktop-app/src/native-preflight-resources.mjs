import { join } from "node:path";
import {
  eventHostInventorySha256,
  verifyEventHostResources,
} from "./event-host-resources.mjs";

export const NATIVE_PREFLIGHT_ASSETS = Object.freeze([
  "native-preflight-reader.mjs",
  "native-preflight-protocol.mjs",
  "native-preflight-predicates.mjs",
]);

// Derive fixed paths only from the validated existing event-host descriptor.
export async function verifyNativePreflightResources(eventHost) {
  const manifest = await verifyEventHostResources(eventHost, {
    platform: process.platform,
    arch: process.arch,
  });
  for (const path of NATIVE_PREFLIGHT_ASSETS) {
    const entry = manifest.entries.find((value) => value.path === path);
    if (!entry || entry.type !== "file" || entry.mode !== 0o644)
      throw new Error("native_startup_unverified");
  }
  return Object.freeze({
    entry: join(eventHost.root, NATIVE_PREFLIGHT_ASSETS[0]),
    engine: eventHost.enginePath,
    inventorySha256: eventHostInventorySha256(manifest),
  });
}
