import {
  NATIVE_SKILLS_RPC,
  validateSkillRpc,
} from "./native-skills-protocol.mjs";

// Private Main-only adapter. The raw nonce and general RPC factory are not
// returned. The supervisor tracks each entire call, including owner checks.
export function createNativeSkillsClient({
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
    throw new Error("native_skill_invalid");
  const call = async (method, input) => {
    if (!input || Object.hasOwn(input, "nonce"))
      throw new Error("native_skill_invalid");
    const request = { ...input, nonce };
    validateSkillRpc(method, request);
    const saved = globalThis.structuredClone(request);
    await assertLive();
    if (typeof client?.rpc !== "function")
      throw new Error("native_skill_unavailable");
    const rpc = client.rpc(NATIVE_SKILLS_RPC);
    const workspacePath =
      method === "observe" ? saved.workspacePath : saved.owner.workspacePath;
    const result = await rpc[method](saved, {
      location: { directory: workspacePath },
      signal: AbortSignal.timeout(timeoutMs),
    });
    await assertLive();
    return result;
  };
  return Object.freeze({
    observe: (input) => call("observe", input),
    registerDisabled: (input) => call("registerDisabled", input),
    removeOwned: (input) => call("removeOwned", input),
  });
}
