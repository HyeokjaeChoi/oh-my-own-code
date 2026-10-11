import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  Tools,
  useAui,
  useExternalStoreRuntime,
  type ThreadMessageLike,
  type Toolkit,
} from "@assistant-ui/react";
import type { OpenCode as SDKHost } from "@opencode/sdk";
import { LinkPreview } from "./vendor/tool-ui/components/tool-ui/link-preview";
import { safeParseSerializableLinkPreview } from "./vendor/tool-ui/components/tool-ui/link-preview/schema";

// Compile-time boundary: the installed new-v2 SDK exposes an owned host.
type HostFactory = typeof SDKHost.create;
const hostFactoryIsTyped: HostFactory extends (...args: never[]) => unknown ? true : false = true;
assert.equal(hostFactoryIsTyped, true);

const valid = safeParseSerializableLinkPreview({
  id: "synthetic-preview",
  href: "https://example.invalid/fixture",
  title: "Synthetic result",
});
assert.ok(valid);
assert.equal(safeParseSerializableLinkPreview({ id: "bad", href: "not-a-url" }), null);
const unsafe = safeParseSerializableLinkPreview({ id: "unsafe", href: "javascript:alert(1)" });
assert.ok(unsafe, "Tool UI Zod URL validation accepts javascript: URLs; navigation must be checked separately");

// Tool UI's documented backend-tool registration shape; no model loop or tool execution.
const toolkit: Toolkit = {
  previewLink: {
    type: "backend",
    render: ({ result }) => {
      const parsed = safeParseSerializableLinkPreview(result);
      return parsed ? <LinkPreview {...parsed} /> : null;
    },
  },
};
assert.ok(toolkit.previewLink);

const messages: ThreadMessageLike[] = [
  { id: "synthetic-user", role: "user", content: [{ type: "text", text: "Synthetic input" }] },
  { id: "synthetic-assistant", role: "assistant", content: [
    { type: "text", text: "Synthetic output" },
    { type: "tool-call", toolCallId: "synthetic-call", toolName: "previewLink", args: {}, result: valid },
  ] },
];

function RuntimeFixture() {
  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: false,
    convertMessage: (message) => message,
    onNew: async () => {},
  });
  const aui = useAui({ tools: Tools({ toolkit }) });
  return (
    <AssistantRuntimeProvider runtime={runtime} aui={aui}>
      <ThreadPrimitive.Messages
        components={{ Message: () => <MessagePrimitive.Parts components={{
          Text: ({ text }) => <span>{text}</span>,
          tools: { Fallback: ({ toolName }) => <span data-tool-fallback={toolName}>Synthetic tool fallback</span> },
        }} /> }}
      />
    </AssistantRuntimeProvider>
  );
}

const threadMarkup = renderToStaticMarkup(<RuntimeFixture />);
assert.match(threadMarkup, /Synthetic input/);
assert.match(threadMarkup, /Synthetic output/);
assert.match(threadMarkup, /data-tool-fallback="previewLink"/);
const cardMarkup = renderToStaticMarkup(<LinkPreview {...valid} />);
assert.match(cardMarkup, /data-tool-ui-id="synthetic-preview"/);
assert.match(cardMarkup, /Synthetic result/);
const unsafeMarkup = renderToStaticMarkup(<LinkPreview {...unsafe} />);
assert.doesNotMatch(unsafeMarkup, /role="link"/);
assert.doesNotMatch(unsafeMarkup, /tabindex=/i);
assert.doesNotMatch(unsafeMarkup, /href="javascript:/);
console.log("PASS assistant-ui ExternalStoreRuntime synthetic text/tool fallback SSR");
console.log("PASS Tool UI schema and standalone component SSR; Toolkit registration typechecked only");
