export type RuntimeInfo = { version: string };

export type RuntimeInfoObservation =
  | { kind: "info_validated"; info: RuntimeInfo }
  | { kind: "invalid_response"; code: "INVALID_SCHEMA" }
  | { kind: "read_failed"; code: "RUNTIME_UNAVAILABLE" };

export type RuntimeDiagnosticProjection =
  | { kind: "info_validated"; provenance: "synthetic-injected-client" }
  | {
      kind: "invalid_response";
      code: "INVALID_SCHEMA";
      provenance: "synthetic-injected-client";
    }
  | {
      kind: "read_failed";
      code: "RUNTIME_UNAVAILABLE";
      provenance: "synthetic-injected-client";
    };

type OwnDataField = { value: unknown } | null;

function ownDataField(target: object, key: string): OwnDataField {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);
  if (
    descriptor === undefined ||
    !Object.prototype.hasOwnProperty.call(descriptor, "value")
  ) {
    return null;
  }
  return { value: descriptor.value };
}

function isObjectRecord(value: unknown): value is object {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasUtf8ByteLengthBetween(
  value: string,
  minimum: number,
  maximum: number,
): boolean {
  let byteLength = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      byteLength += 1;
    } else if (codeUnit <= 0x7ff) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff &&
      index + 1 < value.length &&
      value.charCodeAt(index + 1) >= 0xdc00 &&
      value.charCodeAt(index + 1) <= 0xdfff
    ) {
      byteLength += 4;
      index += 1;
    } else {
      // Lone surrogates are encoded as the three-byte replacement character.
      byteLength += 3;
    }
    if (byteLength > maximum) return false;
  }
  return byteLength >= minimum;
}

function isVersion(value: unknown): value is string {
  if (typeof value !== "string" || !hasUtf8ByteLengthBetween(value, 1, 128)) {
    return false;
  }
  const match = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.exec(value);
  return match?.[0] === value;
}

function isUrlList(value: unknown): boolean {
  if (!Array.isArray(value)) return false;
  const length = ownDataField(value, "length")?.value;
  if (
    typeof length !== "number" ||
    !Number.isInteger(length) ||
    length < 0 ||
    length > 16
  ) {
    return false;
  }

  for (let index = 0; index < length; index += 1) {
    const field = ownDataField(value, String(index));
    if (
      field === null ||
      typeof field.value !== "string" ||
      !hasUtf8ByteLengthBetween(field.value, 1, 2_048)
    ) {
      return false;
    }
  }
  return true;
}

/** Validate inert response data and retain only a fresh copy of its version. */
export function validateRuntimeInfo(input: unknown): RuntimeInfo | null {
  try {
    if (!isObjectRecord(input)) return null;

    const version = ownDataField(input, "version");
    const pid = ownDataField(input, "pid");
    const urls = ownDataField(input, "urls");
    const paths = ownDataField(input, "paths");
    if (
      version === null ||
      pid === null ||
      urls === null ||
      paths === null ||
      !isVersion(version.value) ||
      typeof pid.value !== "number" ||
      !Number.isSafeInteger(pid.value) ||
      pid.value <= 0 ||
      !isUrlList(urls.value) ||
      !isObjectRecord(paths.value)
    ) {
      return null;
    }

    const temporaryPath = ownDataField(paths.value, "tmp");
    if (
      temporaryPath === null ||
      typeof temporaryPath.value !== "string" ||
      !hasUtf8ByteLengthBetween(temporaryPath.value, 1, 4_096)
    ) {
      return null;
    }

    return { version: version.value };
  } catch {
    // Reflection can trigger caller-supplied Proxy traps. Treat inspection
    // failures as invalid schema without returning or logging the trap error.
    return null;
  }
}

/** Invoke one explicitly supplied read and reduce all rejected reads to a fixed outcome. */
export async function observeRuntimeInfo(
  read: () => Promise<unknown>,
): Promise<RuntimeInfoObservation> {
  let input: unknown;
  try {
    input = await read();
  } catch {
    return { kind: "read_failed", code: "RUNTIME_UNAVAILABLE" };
  }

  const info = validateRuntimeInfo(input);
  if (info === null) {
    return { kind: "invalid_response", code: "INVALID_SCHEMA" };
  }
  return { kind: "info_validated", info };
}

/** Project only fixed outcome metadata; a validated version is intentionally omitted. */
export function projectRuntimeDiagnostic(
  result: RuntimeInfoObservation,
  provenance: "synthetic-injected-client",
): RuntimeDiagnosticProjection {
  if (result.kind === "info_validated") {
    return { kind: result.kind, provenance };
  }
  if (result.kind === "invalid_response") {
    return { kind: result.kind, code: result.code, provenance };
  }
  return { kind: result.kind, code: result.code, provenance };
}
