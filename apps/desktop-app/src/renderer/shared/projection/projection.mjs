import { validAssistantRuntime } from "../runtime-options/index.mjs";
// Pure renderer projection: no host access, executable markup, or optimistic results.
export const selectionKey = (workspaceId = "", sessionId = "") =>
  JSON.stringify([workspaceId, sessionId]);
const bounded = (value, limit = 65536) =>
  typeof value === "string"
    ? value.slice(0, limit) + (value.length > limit ? "\n… 표시 길이 제한" : "")
    : "";
export function mapMessages(messages) {
  const seen = new Set();
  return messages
    .slice(-300)
    .filter((message) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    })
    .map((message) => ({
      id: message.id,
      role: message.role,
      ...(message.role === "assistant" && validAssistantRuntime(message.runtime)
        ? {
            metadata: {
              custom: {
                runtime: {
                  agent: message.runtime.agent,
                  model: { ...message.runtime.model },
                  ...(message.runtime.usage
                    ? { usage: { ...message.runtime.usage } }
                    : {}),
                },
              },
            },
          }
        : {}),
      content: [
        { type: "text", text: bounded(message.text) },
        ...(message.role === "assistant"
          ? message.tools.slice(0, 40).map((tool) => ({
              type: "tool-call",
              toolCallId: tool.id,
              toolName: tool.name,
              args: {
                input: bounded(tool.input, 8192),
                output: bounded(tool.output),
                state: tool.status,
              },
              argsText: bounded(tool.input, 8192),
              ...(tool.status === "completed" || tool.status === "error"
                ? {
                    result: bounded(tool.output),
                    isError: tool.status === "error",
                  }
                : {}),
            }))
          : []),
      ],
    }));
}
