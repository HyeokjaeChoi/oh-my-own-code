// Shared wire identity syntax only. This module has no runtime dependencies.
export function validWireId(value) {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,128}$/.test(value);
}
