// Closed private Main-to-fixed-plugin observation. Importing performs no IO.
import { isAbsolute, normalize } from "node:path";
import { validateExtensionsInventory } from "./renderer/shared/configuration-draft/extensions.mjs";

export const NATIVE_EXTENSIONS_RPC = "omoc.workbench.extensions";
const invalid = () => {
  throw new Error("native_extensions_invalid");
};
function closed(value, keys) {
  return Boolean(
    value &&
      Object.getPrototypeOf(value) === Object.prototype &&
      Reflect.ownKeys(value).length === keys.length &&
      keys.every((key) =>
        Object.hasOwn(
          Object.getOwnPropertyDescriptor(value, key) ?? {},
          "value",
        ),
      ),
  );
}
export function validateExtensionRpc(method, input) {
  if (
    method !== "observe" ||
    !closed(input, ["nonce", "workspaceId", "workspacePath"]) ||
    typeof input.nonce !== "string" ||
    !/^[a-f0-9]{64}$/u.test(input.nonce)
  )
    invalid();
  // Reuse the exact browser-safe scope bounds, then require this platform's
  // canonical absolute context. This grants no filesystem authority.
  validateExtensionsInventory({
    workspaceId: input.workspaceId,
    workspacePath: input.workspacePath,
    status: "unavailable",
    plugins: { status: "unavailable", reason: "runtime_unavailable" },
    tools: { status: "unavailable", reason: "runtime_unavailable" },
    hooks: { status: "not_reported", reason: "inventory_not_supported" },
  });
  if (
    !isAbsolute(input.workspacePath) ||
    normalize(input.workspacePath) !== input.workspacePath
  )
    invalid();
  return input;
}
export function validateExtensionRpcResult(method, value) {
  if (method !== "observe") invalid();
  return validateExtensionsInventory(value);
}
const portable = (validate) =>
  Object.freeze({
    "~standard": Object.freeze({
      version: 1,
      vendor: "oh-my-own-code",
      validate(value) {
        try {
          return { value: validate(value) };
        } catch {
          return {
            issues: [{ message: "Invalid Native extension RPC value" }],
          };
        }
      },
    }),
  });
export const NATIVE_EXTENSIONS_RPC_DEFINITION = Object.freeze({
  id: NATIVE_EXTENSIONS_RPC,
  events: Object.freeze({}),
  methods: Object.freeze({
    observe: Object.freeze({
      input: portable((value) => validateExtensionRpc("observe", value)),
      output: portable((value) => validateExtensionRpcResult("observe", value)),
      errors: Object.freeze({
        denied: portable((value) => {
          if (
            !closed(value, ["code"]) ||
            !["invalid_context", "nonce_mismatch"].includes(value.code)
          )
            invalid();
          return value;
        }),
      }),
    }),
  }),
});
