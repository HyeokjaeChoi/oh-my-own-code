import test from "node:test";
import assert from "node:assert/strict";
import { pathToFileURL, fileURLToPath } from "node:url";
import { build } from "esbuild";
import { mapMessages } from "./renderer/shared/projection/projection.mjs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

const actual = await build({
  stdin: {
    contents:
      'export {Conversation} from "./renderer/widgets/conversation/index.tsx"; export {createWindowWorkbench,WorkbenchProvider} from "./renderer/entities/workbench/index.ts";',
    resolveDir: fileURLToPath(new URL(".", import.meta.url)),
    loader: "tsx",
  },
  bundle: true,
  write: false,
  outfile: "actual-conversation.mjs",
  format: "esm",
  platform: "node",
  jsx: "automatic",
  loader: { ".css": "text" },
  plugins: [
    {
      name: "actual-dependencies",
      setup(builder) {
        builder.onResolve({ filter: /^[^./]/ }, async (args) => {
          if (
            args.path.startsWith("@workbench/") ||
            args.pluginData?.actualDependency
          )
            return;
          const resolved = await builder.resolve(args.path, {
            resolveDir: args.resolveDir,
            kind: args.kind,
            pluginData: { actualDependency: true },
          });
          if (resolved.errors.length) return { errors: resolved.errors };
          return { path: pathToFileURL(resolved.path).href, external: true };
        });
      },
    },
  ],
});
const { Conversation, createWindowWorkbench, WorkbenchProvider } = await import(
  `data:text/javascript;base64,${Buffer.from(actual.outputFiles.find((f) => f.path.endsWith(".mjs")).text).toString("base64")}`
);

function render(messages, status = "idle") {
  const oldWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  let mutations = 0;
  const api = createWindowWorkbench({
    workbench: async () => {
      mutations++;
      throw Error("No SSR transport");
    },
  });
  const snapshot = {
    runtimeEpoch: "markdown-ssr",
    revision: 1,
    observationSequence: 1,
    state: "connected",
    temporary: true,
    recovery: { store: { state: "ready" }, resources: [] },
    retainedOperations: [],
    workspaces: [
      {
        id: "w",
        name: "Synthetic",
        path: "/synthetic",
        trusted: true,
        trustRevision: 1,
        kind: "folder",
        temporary: true,
      },
    ],
    sessions: [{ id: "s", workspaceId: "w", title: "Synthetic", status }],
    selectedWorkspaceId: "w",
    selectedSessionId: "s",
    messages,
    permissions: [],
  };
  api.store.dispatch({
    type: "snapshot",
    scope: { epoch: undefined, generation: 0 },
    value: snapshot,
  });
  try {
    assert.equal(api.store.getState().snapshot?.runtimeEpoch, "markdown-ssr");
    const html = renderToStaticMarkup(
      createElement(
        WorkbenchProvider,
        { value: api },
        createElement(Conversation, {
          workspaceId: "w",
          sessionId: "s",
          messages,
          permissions: [],
          catalog: null,
          status,
          disabled: false,
          executionAvailable: true,
          pending: false,
          mutate: api.actions.mutate,
          openPanel: () => {},
          newSession: () => {},
        }),
      ),
    );
    assert.equal(mutations, 0);
    return html;
  } finally {
    api.dispose();
    if (oldWindow === undefined) delete globalThis.window;
    else globalThis.window = oldWindow;
  }
}
const message = (text, role = "assistant", extra = {}) => ({
  id: "m",
  role,
  text,
  tools: [],
  ...extra,
});

test("Markdown actual Conversation renders prose/code/GFM from its existing part context", () => {
  const text =
    '# 제목\n\n**굵게** *기울임* ~~이전~~ `inline`\n\n> 인용\n\n1. 첫째\n2. 둘째\n\n- [x] 확인\n- [ ] 대기\n\n| 이름 | 값 |\n| --- | --- |\n| alpha | 1 |\n\n```typescript\nconst 한글 = "값";\n```';
  const html = render([message(text)]);
  for (const part of [
    "<h1>제목</h1>",
    "<strong>굵게</strong>",
    "<em>기울임</em>",
    "<del>이전</del>",
    "<blockquote>",
    "<ol>",
    "<table>",
    "language-typescript",
    "const 한글 = &quot;값&quot;;",
    "코드 복사",
    "표시된 메시지 복사",
  ])
    assert.ok(html.includes(part), part);
  const inputs = html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? [];
  assert.equal(inputs.length, 2);
  for (const input of inputs) assert.match(input, /disabled=""/);
});
test("Markdown actual Conversation keeps user source literal", () => {
  const html = render([
    message("# 나의 원문\n**문자**\n```sh\necho x\n```", "user"),
  ]);
  assert.ok(html.includes("# 나의 원문"));
  assert.ok(html.includes("**문자**"));
  assert.ok(!html.includes("<h1>"));
  assert.ok(!html.includes("<strong>문자</strong>"));
  assert.ok(html.includes("표시된 메시지 복사"));
  assert.ok(!html.includes("코드 복사"));
});
test("Markdown raw HTML remains readable and links/images cannot execute or fetch", () => {
  const html = render([
    message(
      '<script>bad()</script>\n\n<img src="https://remote.invalid/tracker" onerror="bad()">\n\n[주소](https://example.invalid/path?secret=synthetic) ![대체 설명](https://remote.invalid/image)\n\n[위험](javascript:bad)\n\n<iframe src="https://remote.invalid/frame"></iframe>',
    ),
  ]);
  assert.ok(html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert.ok(html.includes("대체 설명"));
  assert.ok(html.includes("https://example.invalid/path?secret=synthetic"));
  assert.ok(!/<(?:script|img|iframe|object|embed)\b/i.test(html));
  assert.ok(!/href="(?:https?:|javascript:|data:)/i.test(html));
});
test("Markdown partial streaming fence keeps plain code and actual running state", () => {
  const html = render(
    [message('처리 중\n\n```js\nconst partial = "아직')],
    "running",
  );
  assert.ok(html.includes("language-js"));
  assert.ok(html.includes("const partial = &quot;아직"));
  assert.ok(html.includes("코드 복사"));
  assert.ok(html.includes("현재 세션 실행 중입니다."));
});
test("Markdown generic tool output stays escaped and is not reinterpreted as Markdown", () => {
  const html = render([
    message("**실제 메시지**", "assistant", {
      tools: [
        {
          id: "tool",
          name: "unknown",
          status: "completed",
          input: "{}",
          output: "<img onerror=bad()>\n# raw tool",
        },
      ],
    }),
  ]);
  assert.ok(html.includes("<strong>실제 메시지</strong>"));
  assert.ok(html.includes("&lt;img onerror=bad()&gt;"));
  assert.ok(html.includes("# raw tool"));
  assert.ok(!html.includes("<h1>raw tool</h1>"));
});
test("Markdown copy labels describe bounded displayed source, not Native history", () => {
  // Snapshot validation caps messages at 32000; the projection bound is a second guard.
  const html = render([message("x".repeat(32000))]);
  assert.ok(html.includes("표시된 메시지 복사"));
  assert.ok(!html.includes("전체 기록 복사"));
  assert.ok(html.length < 100000);
  const [projected] = mapMessages([message("x".repeat(70000))]);
  assert.ok(projected.content[0].text.endsWith("… 표시 길이 제한"));
});
