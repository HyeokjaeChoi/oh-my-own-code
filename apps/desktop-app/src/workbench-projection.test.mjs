import test from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
import { mapMessages } from "./renderer/shared/projection/projection.mjs";
function realDependencies() {
  return {
    name: "real-test-dependencies",
    setup(builder) {
      // Compile workspace code/CSS while sharing installed React with SSR.
      // Resolve from each importing package to preserve pnpm dependency scope.
      builder.onResolve({ filter: /^[^./]/ }, async (args) => {
        if (
          args.path.startsWith("@workbench/") ||
          args.pluginData?.realDependency
        )
          return;
        const resolved = await builder.resolve(args.path, {
          resolveDir: args.resolveDir,
          kind: args.kind,
          pluginData: { realDependency: true },
        });
        if (resolved.errors.length) return { errors: resolved.errors };
        return { path: pathToFileURL(resolved.path).href, external: true };
      });
    },
  };
}

// Mutation/draft/deletion races now exercise the sole vanilla store and real
// scheduling controller in workbench-store.test.mjs, outside the renderer tree.
test("mapping bounds content and removes duplicate IDs without executable content parts", () => {
  const raw = {
    id: "x",
    role: "assistant",
    text: "<script>alert(1)</script>",
    tools: [
      {
        id: "t",
        name: "html",
        status: "pending",
        input: "{}",
        output: '<img onerror="bad()">',
      },
    ],
  };
  const mapped = mapMessages([raw, raw]);
  assert.equal(mapped.length, 1);
  assert.deepEqual(mapped[0].content[0], { type: "text", text: raw.text });
  assert.equal(mapped[0].content[1].result, undefined);
  assert.equal(mapped[0].content[1].args.output, raw.tools[0].output);
  assert.ok(
    mapMessages(
      Array.from({ length: 600 }, (_, i) => ({
        ...raw,
        id: String(i),
        text: "x".repeat(100000),
      })),
    ).length <= 300,
  );
  assert.ok(
    mapMessages([{ ...raw, text: "x".repeat(100000) }])[0].content[0].text
      .length < 66000,
  );
});
test("tool completion comes from tool status, never an accepted request receipt", () => {
  const messages = mapMessages([
    {
      id: "m",
      role: "assistant",
      text: "",
      tools: [
        {
          id: "t",
          name: "run",
          status: "running",
          input: "",
          output: '{"status":"accepted"}',
        },
      ],
    },
  ]);
  assert.equal(messages[0].content[1].result, undefined);
  assert.equal(messages[0].content[1].args.state, "running");
});
test("actual assistant-ui transcript dispatches validated LinkPreview and escaped fallback", async () => {
  const require = createRequire(new URL("../package.json", import.meta.url));
  const { build } = require("esbuild");
  const bundled = await build({
    stdin: {
      contents: `export { Conversation } from "./src/renderer/widgets/conversation/index.tsx";
        export { createWindowWorkbench, WorkbenchProvider } from "./src/renderer/entities/workbench/index.ts";`,
      resolveDir: fileURLToPath(new URL("../", import.meta.url)),
      loader: "tsx",
    },
    bundle: true,
    write: false,
    outfile: "workbench-conversation-test.mjs",
    format: "esm",
    platform: "node",
    plugins: [realDependencies()],
  });
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  const { Conversation, createWindowWorkbench, WorkbenchProvider } =
    await import(
      `data:text/javascript;base64,${Buffer.from(bundled.outputFiles.find((file) => file.path.endsWith(".mjs")).text).toString("base64")}`
    );
  const previousWindow = globalThis.window;
  globalThis.window = { matchMedia: () => ({ matches: false }) };
  const api = createWindowWorkbench({
    workbench: async () => {
      throw new Error("Static render cannot send");
    },
  });
  api.store.dispatch({
    type: "snapshot",
    scope: { epoch: undefined, generation: 0 },
    value: {
      runtimeEpoch: "ssr",
      revision: 1,
      observationSequence: 1,
      state: "connected",
      temporary: true,
      recovery: { store: { state: "ready" }, resources: [] },
      retainedOperations: [],
      workspaces: [
        {
          id: "w",
          name: "Fixture",
          path: "/fixture",
          trusted: true,
          trustRevision: 1,
          kind: "folder",
          temporary: true,
        },
      ],
      sessions: [
        { id: "s", workspaceId: "w", title: "Fixture", status: "idle" },
      ],
      selectedWorkspaceId: "w",
      selectedSessionId: "s",
      messages: [
        {
          id: "m",
          role: "assistant",
          text: "<script>bad()</script>",
          tools: [
            {
              id: "t",
              name: "preview",
              status: "completed",
              input: "{}",
              output: JSON.stringify({
                id: "link",
                href: "https://example.com",
                title: "Validated link",
              }),
            },
            {
              id: "u",
              name: "unknown",
              status: "running",
              input: "{}",
              output: "<img onerror=bad()>",
            },
            {
              id: "v",
              name: "preview",
              status: "completed",
              input: "{}",
              output: JSON.stringify({
                id: "unsafe",
                href: "javascript:bad()",
                title: "Unsafe link",
              }),
            },
          ],
        },
      ],
      permissions: [
        {
          id: "permission",
          sessionId: "s",
          title: "Allow tool",
          detail: "Read a file",
          sessionAllow: "src/*",
        },
        {
          id: "outside",
          sessionId: "s",
          title: "external_directory",
          detail: "/etc",
        },
      ],
    },
  });
  let html;
  try {
    assert.equal(api.store.getState().snapshot?.runtimeEpoch, "ssr");
    html = renderToStaticMarkup(
      createElement(
        WorkbenchProvider,
        { value: api },
        createElement(Conversation, {
          workspaceId: "w",
          sessionId: "s",
          messages: api.store.getState().snapshot.messages,
          permissions: api.store.getState().snapshot.permissions,
          catalog: null,
          status: "idle",
          disabled: false,
          pending: false,
          mutate: api.actions.mutate,
          openPanel: () => {},
          newSession: () => {},
        }),
      ),
    );
  } finally {
    api.dispose();
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
  assert.equal((html.match(/data-slot="link-preview"/g) ?? []).length, 1);
  assert.ok(html.includes("Validated link"));
  assert.ok(html.includes("&lt;script&gt;bad()&lt;/script&gt;"));
  assert.ok(html.includes("&lt;img onerror=bad()&gt;"));
  assert.ok(!html.includes("<script>bad()"));
  assert.ok(!html.includes('href="javascript:'));
  assert.ok(html.includes("메시지 작성"));
  assert.ok(html.includes("이번만 허용"));
  // "항상 허용" only where main offered patterns (never external_directory).
  assert.equal((html.match(/>항상 허용</g) ?? []).length, 1);
  assert.ok(html.includes("다른 대기 중 권한 요청도 취소"));
});

test("runtime options projection keeps same-message reports in assistant metadata only", () => {
  const runtime = {
    agent: "actual",
    model: {
      providerId: "historical",
      id: "actual-model",
      variant: "actual-variant",
    },
  };
  const source = {
    id: "response",
    role: "assistant",
    text: "answer",
    tools: [],
    runtime,
  };
  assert.deepEqual(mapMessages([source])[0].metadata.custom.runtime, runtime);
  const projected = mapMessages([source])[0];
  runtime.agent = "changed";
  assert.equal(projected.metadata.custom.runtime.agent, "actual");
  assert.equal(
    mapMessages([{ ...source, role: "user" }])[0].metadata,
    undefined,
  );
  assert.equal(
    mapMessages([{ ...source, runtime: { ...runtime, body: {} } }])[0].metadata,
    undefined,
  );
});
