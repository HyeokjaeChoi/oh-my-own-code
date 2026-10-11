import { createHash } from "node:crypto";
import { configurationFileWriteFits } from "../renderer/shared/configuration-draft/validation.mjs";

export const INSTRUCTION_KEY = "omoc.project-instructions";
export const INSTRUCTION_FEATURE = "configuration_instructions_v1";
export const instructionDigest = (text) =>
  createHash("sha256").update(text, "utf8").digest("hex");
const digest = (value) =>
  typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
const id = (value) =>
  typeof value === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(value);
export function validInstructionRegistration(value) {
  if (
    !value ||
    Object.getPrototypeOf(value) !== Object.prototype ||
    value.key !== INSTRUCTION_KEY
  )
    return false;
  if (value.state === "absent") return Object.keys(value).length === 2;
  if (
    value.state !== "registered" ||
    !digest(value.digest) ||
    !digest(value.sourceVersion)
  )
    return false;
  const fields = ["state", "key", "digest", "sourceVersion", "origin"];
  if (value.origin === "fork") {
    if (!id(value.inheritedFromSessionId)) return false;
    fields.push("inheritedFromSessionId");
  } else if (value.origin !== "direct") return false;
  return (
    Object.keys(value).length === fields.length &&
    fields.every((key) => Object.hasOwn(value, key))
  );
}
export function canonicalInstructionRegistration(value) {
  if (value === undefined) return null;
  if (!validInstructionRegistration(value))
    throw new Error("invalid_instruction_registration");
  if (value.state === "absent")
    return { state: "absent", key: INSTRUCTION_KEY };
  return {
    state: "registered",
    key: INSTRUCTION_KEY,
    digest: value.digest,
    sourceVersion: value.sourceVersion,
    origin: value.origin,
    ...(value.origin === "fork" && {
      inheritedFromSessionId: value.inheritedFromSessionId,
    }),
  };
}
// SDK decoding precedes this bounded projection. Never return other entries or text.
export function observeInstructions(entries, registration) {
  const unavailable = (reason) => ({ status: "unavailable", reason });
  if (!Array.isArray(entries) || entries.length > 64)
    return unavailable("unsupported_entries");
  let found;
  let count = 0;
  for (const entry of entries) {
    if (!entry || typeof entry.key !== "string")
      return unavailable("unsupported_entries");
    if (entry.key === INSTRUCTION_KEY) {
      found = entry;
      count++;
    }
  }
  if (
    count > 1 ||
    (found && !configurationFileWriteFits("instructions", found.value))
  )
    return unavailable("unsupported_entries");
  if (found && registration === undefined)
    return unavailable("ownership_conflict");
  const metadata = canonicalInstructionRegistration(registration);
  const actualDigest = found ? instructionDigest(found.value) : undefined;
  const version = instructionDigest(
    JSON.stringify([
      INSTRUCTION_KEY,
      metadata,
      found ? { digest: actualDigest } : { absent: true },
    ]),
  );
  if (!found && (!metadata || metadata.state === "absent"))
    return { status: "missing", version };
  if (metadata?.state === "registered" && actualDigest === metadata.digest)
    return {
      status: "registered",
      version,
      digest: actualDigest,
      sourceVersion: metadata.sourceVersion,
      origin: metadata.origin,
      ...(metadata.origin === "fork" && {
        inheritedFromSessionId: metadata.inheritedFromSessionId,
      }),
    };
  return {
    status: "changed",
    version,
    ...(actualDigest && { digest: actualDigest }),
  };
}
