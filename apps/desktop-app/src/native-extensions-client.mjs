import {
  NATIVE_EXTENSIONS_RPC_DEFINITION,
  validateExtensionRpc,
  validateExtensionRpcResult,
} from "./native-extensions-protocol.mjs";

// Private observe-only adapter. The supervisor separately tracks the actual
// RPC Promise, including settlement after a caller's deadline.
export function createNativeExtensionsClient({
  client,
  nonce,
  assertLive,
  timeoutMs = 5000,
}) {
  if (
    typeof assertLive !== "function" ||
    typeof nonce !== "string" ||
    !/^[a-f0-9]{64}$/u.test(nonce) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error("native_extensions_invalid");
  return Object.freeze({
    async observe(input) {
      if (
        !input ||
        Object.getPrototypeOf(input) !== Object.prototype ||
        Reflect.ownKeys(input).some(
          (key) =>
            typeof key !== "string" ||
            !Object.hasOwn(
              Object.getOwnPropertyDescriptor(input, key),
              "value",
            ),
        ) ||
        Object.hasOwn(input, "nonce")
      )
        throw new Error("native_extensions_invalid");
      const request = globalThis.structuredClone(
        validateExtensionRpc("observe", { ...input, nonce }),
      );
      const controller = new AbortController();
      const unavailable = () => new Error("native_extensions_unavailable");
      const live = () => {
        if (controller.signal.aborted) throw unavailable();
      };
      let timer;
      const deadline = new Promise((_, reject) => {
        timer = setTimeout(() => {
          controller.abort();
          reject(unavailable());
        }, timeoutMs);
      });
      const task = (async () => {
        await assertLive();
        live();
        if (typeof client?.rpc !== "function") throw unavailable();
        const rpc = client.rpc(NATIVE_EXTENSIONS_RPC_DEFINITION);
        if (typeof rpc?.observe !== "function") throw unavailable();
        const result = await rpc.observe(request, {
          location: { directory: request.workspacePath },
          signal: controller.signal,
        });
        live();
        await assertLive();
        live();
        validateExtensionRpcResult("observe", result);
        if (
          result.workspaceId !== request.workspaceId ||
          result.workspacePath !== request.workspacePath
        )
          throw unavailable();
        return globalThis.structuredClone(result);
      })();
      try {
        return await Promise.race([task, deadline]);
      } finally {
        clearTimeout(timer);
      }
    },
  });
}
