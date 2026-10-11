import {
  NATIVE_AGENTS_RPC,
  validateAgentRpc,
  validateAgentRpcResult,
} from "./native-agents-protocol.mjs";
import { readNativeAgentSessions } from "./host/workbench-native-agents.mjs";

// Private Main adapter. Entire task is tracked by the owner supervisor. A
// complete global reference read runs immediately before the private remove.
export function createNativeAgentsClient({
  client,
  nonce,
  assertLive,
  timeoutMs = 5000,
}) {
  if (
    typeof assertLive !== "function" ||
    !/^[a-f0-9]{64}$/u.test(nonce) ||
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs <= 0
  )
    throw new Error("native_agent_invalid");
  const call = async (method, input) => {
    if (
      !input ||
      Object.getPrototypeOf(input) !== Object.prototype ||
      Object.hasOwn(input, "nonce") ||
      Reflect.ownKeys(input).some(
        (k) =>
          typeof k !== "string" ||
          !Object.hasOwn(Object.getOwnPropertyDescriptor(input, k), "value"),
      )
    )
      throw new Error("native_agent_invalid");
    const request = { ...input, nonce };
    validateAgentRpc(method, request);
    const saved = globalThis.structuredClone(request),
      deadline = Date.now() + timeoutMs;
    await assertLive();
    if (method === "remove") {
      const rows = await readNativeAgentSessions(client, {
        check: assertLive,
        timeoutMs,
      });
      await assertLive();
      if (rows.some((r) => r.agent === saved.nativeId))
        throw Object.assign(new Error("native_agent_in_use"), {
          code: "AGENT_IN_USE",
        });
    }
    if (typeof client?.rpc !== "function" || deadline <= Date.now())
      throw new Error("native_agent_unavailable");
    const workspacePath =
      method === "observe" ? saved.workspacePath : saved.owner.workspacePath;
    const rpc = client.rpc(NATIVE_AGENTS_RPC);
    const result = await rpc[method](saved, {
      location: { directory: workspacePath },
      signal: AbortSignal.timeout(deadline - Date.now()),
    });
    await assertLive();
    return validateAgentRpcResult(method, result);
  };
  return Object.freeze({
    observe: (input) => call("observe", input),
    register: (input) => call("register", input),
    remove: (input) => call("remove", input),
  });
}
