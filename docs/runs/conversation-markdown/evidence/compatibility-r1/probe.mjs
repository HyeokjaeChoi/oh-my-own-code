// probe.tsx
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantRuntimeProvider, MessagePrimitive, ThreadPrimitive, useExternalStoreRuntime } from "@assistant-ui/react";
import { MarkdownTextPrimitive } from "@assistant-ui/react-markdown";
import remarkGfm from "remark-gfm";
function Text() {
  return /* @__PURE__ */ React.createElement(MarkdownTextPrimitive, { smooth: false, defer: true, remarkPlugins: [remarkGfm] });
}
function Message() {
  return /* @__PURE__ */ React.createElement(MessagePrimitive.Root, null, /* @__PURE__ */ React.createElement(MessagePrimitive.Parts, { components: { Text } }));
}
function Probe() {
  const runtime = useExternalStoreRuntime({ messages: [{ id: "m", role: "assistant", content: [{ type: "text", text: "# Known\n\n**bold**\n\n```ts\nconst x=1;\n```\n\n|a|b|\n|-|-|\n|1|2|\n\n<script>bad()</script>" }] }], convertMessage: (m) => m, isRunning: false, onNew: async () => {
  } });
  return /* @__PURE__ */ React.createElement(AssistantRuntimeProvider, { runtime }, /* @__PURE__ */ React.createElement(ThreadPrimitive.Root, null, /* @__PURE__ */ React.createElement(ThreadPrimitive.Messages, { components: { AssistantMessage: Message, UserMessage: Message } })));
}
var html = renderToStaticMarkup(/* @__PURE__ */ React.createElement(Probe, null));
if (!html.includes("<h1>Known</h1>") || !html.includes("<strong>bold</strong>") || !html.includes("<table>") || !html.includes("&lt;script&gt;bad()&lt;/script&gt;") || html.includes("<script>")) throw Error("Actual Markdown runtime incompatibility");
console.log(JSON.stringify({ pass: true, html, scope: "Isolated pinned real external runtime SSR; not browser or app integration" }));
