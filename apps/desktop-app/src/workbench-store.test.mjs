import {
  createHostAdmission,
  currentScope,
} from "./host/workbench-admission.mjs";
import { fileBackupId } from "./host/workbench-file-storage.mjs";
import test from "node:test";
import { createHash } from "node:crypto";
import { parseSkillRuntimeRecord } from "./host/workbench-native-skills.mjs";
import { parseAgentRuntimeRecord } from "./host/workbench-native-agents.mjs";
import { nativeAgentDigest } from "./native-agents-protocol.mjs";
import { nativeSkillDigest } from "./native-skills-protocol.mjs";
import { mcpNativeName as hostMcpNativeName } from "./host/workbench-mcp.mjs";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  realpath,
  writeFile,
  readFile,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readConfigurationFile } from "./host/workbench-configuration-files.mjs";
import {
  createWorkbenchStore,
  selectors,
  scopeOf,
  operationKey,
  mutationDisabled,
  resourceMutationDisabled,
  gitReviewHeld,
  extensionsHeld,
} from "./renderer/entities/workbench/model/store.ts";
import { createWindowWorkbench } from "./renderer/entities/workbench/model/controller.ts";
import { createTransport } from "./renderer/shared/transport/index.ts";
import { selectionKey } from "./renderer/shared/projection/projection.mjs";
import {
  formatLineFeedback,
  appendLineFeedback as appendFeedbackText,
} from "./renderer/shared/line-feedback/index.ts";
import { configurationDraftKey } from "./renderer/shared/configuration-draft/index.ts";

test("conversation context: malformed additive attachment body is refused locally without IO", async () => {
  const { api, calls } = contextWindow();
  try {
    assert.equal(
      await api.actions.mutate({ ...send(), attachments: {} }),
      false,
    );
    assert.equal(calls.length, 0);
  } finally {
    api.dispose();
  }
});

const flush = async () => {
  for (let i = 0; i < 24; i++) await Promise.resolve();
};

const contextObserved = (
  path = "notes.txt",
  text = "\uFEFFa\r\nb😀c",
  extra = {},
) => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  workspacePath: "/fixture",
  path,
  status: "available",
  descriptor: {
    capabilityId: `cap-${path}`,
    workspaceId: "w",
    workspacePath: "/fixture",
    path,
    name: path.split("/").at(-1),
    source: "file",
    version: "a".repeat(64),
    digest: "b".repeat(64),
    mime: "text/plain",
    size: Buffer.byteLength(text),
  },
  preview: { kind: "text", text },
  ...extra,
});
function contextWindow(handler = () => undefined, running = false) {
  const clock = fakeClock();
  const h = bridgeHarness((e) => handler(e) ?? readFallback(e));
  const api = createWindowWorkbench(h.bridge, { clock, id, timeoutMs: 30 });
  seed(
    api.store,
    snapshot(
      1,
      "a",
      running
        ? { sessions: [session("a", "w", { status: "running" }), session("b")] }
        : {},
    ),
  );
  seedRuntimeCatalog(api.store, {
    ...runtimeCatalog(),
    models: {
      status: "available",
      entries: [
        {
          id: "next-model",
          name: "Next model",
          variants: { status: "available", ids: [] },
          capabilities: {
            tools: true,
            input: ["text", "image", "pdf"],
            output: ["text"],
          },
        },
      ],
    },
  });
  return { api, clock, ...h };
}
const inboxObserved = () => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  sessionId: "a",
  entries: [
    {
      id: "pending-1",
      delivery: "queue",
      textPreview: "original queue",
      textTruncated: false,
      attachmentCount: 0,
    },
  ],
  otherCount: 0,
});
function changeContextAuthority(api, kind) {
  const s = api.store.getState();
  if (kind === "ABA") {
    api.actions.select("w", "b");
    api.actions.select("w", "a");
    return;
  }
  if (kind === "hold") {
    api.store.dispatch({ type: "configuration.io", lane: "saves", delta: 1 });
    return;
  }
  if (kind === "model") {
    seedRuntimeCatalog(api.store, catalog);
    return;
  }
  if (kind === "epoch") {
    api.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(s), bootstrap: true },
      value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
    });
    return;
  }
  const w = { ...s.lists.workspaces[0] };
  if (kind === "root") w.path = "/replaced";
  if (kind === "trust") w.trustRevision++;
  seed(
    api.store,
    snapshot(kind === "floor" ? 2 : 1, "a", {
      workspaces: [w],
      ...(kind === "epoch" ? { runtimeEpoch: "epoch-b" } : {}),
      ...(kind === "disconnected" ? { state: "disconnected" } : {}),
    }),
  );
}
test("conversation context: explicit selection uses exact full version and UTF16 offsets without renderer text", async () => {
  const original = contextObserved(),
    selected = "b😀";
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? {
          ok: true,
          value: e.operation.selection
            ? contextObserved("notes.txt", selected, {
                descriptor: {
                  ...original.descriptor,
                  capabilityId: "cap-selection",
                  source: "selection",
                  size: Buffer.byteLength(selected),
                  range: { start: 4, end: 7 },
                },
              })
            : original,
        }
      : undefined,
  );
  try {
    assert.equal(
      await api.actions.observeContext("notes.txt", {
        version: "a".repeat(64),
        start: 4,
        end: 7,
      }),
      false,
    );
    assert.equal(calls.length, 0);
    await api.actions.observeContext("notes.txt");
    for (const bad of [
      { version: "f".repeat(64), start: 4, end: 7 },
      { version: "a".repeat(64), start: 4, end: 99 },
      { version: "a".repeat(64), start: 7, end: 4 },
    ])
      assert.equal(await api.actions.observeContext("notes.txt", bad), false);
    assert.equal(
      await api.actions.observeContext("notes.txt", {
        version: original.descriptor.version,
        start: 4,
        end: 7,
      }),
      true,
    );
    assert.deepEqual(
      calls.filter((e) => e.operation.type === "context.observe").at(-1)
        .operation.selection,
      { version: original.descriptor.version, start: 4, end: 7 },
    );
    assert.equal(
      selectors.conversationContext(api.store.getState()).preview.value.text,
      selected,
    );
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 2);
    assert.equal(
      JSON.stringify(calls.at(-1).operation).includes(selected),
      false,
    );
  } finally {
    api.dispose();
  }
});
test("conversation context: no capability inference from absent unsupported or historical model reports", async (t) => {
  for (const input of [undefined, ["image"], ["unknown"]])
    await t.test(String(input), async () => {
      const { api, calls } = contextWindow((e) =>
        e.operation.type === "context.observe"
          ? { ok: true, value: contextObserved() }
          : undefined,
      );
      try {
        const entry = {
          id: "next-model",
          name: "Next model",
          variants: { status: "available", ids: [] },
          ...(input
            ? { capabilities: { tools: true, input, output: ["text"] } }
            : {}),
        };
        seedRuntimeCatalog(api.store, {
          ...catalog,
          models: { status: "available", entries: [entry] },
        });
        await api.actions.observeContext("notes.txt");
        assert.equal(await api.actions.sendContextMessage("question"), false);
        api.actions.options({ model: "next-model" });
        assert.equal(await api.actions.sendContextMessage("question"), false);
        assert.equal(
          calls.filter((e) => e.operation.type === "message.send").length,
          0,
        );
      } finally {
        api.dispose();
      }
    });
});
test("conversation context: late file reads reject epoch root trust floor disconnect and ABA", async (t) => {
  for (const kind of ["epoch", "root", "trust", "floor", "disconnected", "ABA"])
    await t.test(kind, async () => {
      const wait = deferred();
      const { api } = contextWindow((e) =>
        e.operation.type === "context.observe" ? wait.promise : undefined,
      );
      try {
        const done = api.actions.observeContext("notes.txt");
        await flush();
        changeContextAuthority(api, kind);
        wait.resolve({ ok: true, value: contextObserved() });
        assert.equal(await done, false);
        assert.equal(
          selectors.contextDraft(api.store.getState()).items.length,
          0,
        );
        assert.equal(
          selectors.conversationContext(api.store.getState()).preview,
          undefined,
        );
      } finally {
        wait.resolve({ ok: false, code: "CANCELLED" });
        api.dispose();
      }
    });
});
test("conversation context: subscriber races at request and actual read IO prevent the bridge effect", async (t) => {
  for (const boundary of ["request", "IO"])
    for (const kind of ["root", "trust", "floor", "ABA", "hold"])
      await t.test(`${boundary}:${kind}`, async () => {
        const { api, calls } = contextWindow((e) =>
          e.operation.type === "context.observe"
            ? { ok: true, value: contextObserved() }
            : undefined,
        );
        let changed = false;
        const off = api.store.subscribe((s) => {
          if (
            !changed &&
            s.conversationContext.request &&
            (boundary === "request" || s.configurationIO.reads > 0)
          ) {
            changed = true;
            changeContextAuthority(api, kind);
          }
        });
        try {
          assert.equal(await api.actions.observeContext("notes.txt"), false);
          assert.equal(
            calls.filter((e) => e.operation.type === "context.observe").length,
            0,
          );
        } finally {
          off();
          api.dispose();
        }
      });
});
test("conversation context: async digest and pending intent subscriber races prevent original attachment dispatch", async (t) => {
  for (const boundary of ["digest", "intent"])
    for (const kind of ["root", "trust", "floor", "ABA", "hold", "model"])
      await t.test(`${boundary}:${kind}`, async () => {
        const { api, calls } = contextWindow((e) =>
          e.operation.type === "context.observe"
            ? { ok: true, value: contextObserved() }
            : undefined,
        );
        const original = globalThis.crypto.subtle.digest;
        let changed = false,
          off = () => {};
        try {
          await api.actions.observeContext("notes.txt");
          api.actions.options({ model: "next-model" });
          api.actions.draft("question");
          if (boundary === "digest")
            globalThis.crypto.subtle.digest = async function (...args) {
              if (!changed) {
                changed = true;
                changeContextAuthority(api, kind);
              }
              return original.apply(this, args);
            };
          else
            off = api.store.subscribe((s) => {
              if (
                !changed &&
                Object.values(s.operations).some((i) => i.status === "pending")
              ) {
                changed = true;
                changeContextAuthority(api, kind);
              }
            });
          assert.equal(await api.actions.sendContextMessage("question"), false);
          assert.equal(
            calls.filter((e) => e.operation.type === "message.send").length,
            0,
          );
          assert.equal(
            api.store.getState().drafts[selectionKey("w", "a")].text,
            "question",
          );
        } finally {
          globalThis.crypto.subtle.digest = original;
          off();
          api.dispose();
        }
      });
});
test("conversation context: bounded metadata list keeps one preview slot and refuses the ninth item", async () => {
  const { api } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? { ok: true, value: contextObserved(e.operation.path) }
      : undefined,
  );
  try {
    for (let n = 0; n < 8; n++)
      assert.equal(await api.actions.observeContext(`item-${n}.txt`), true);
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 8);
    assert.equal(
      selectors.conversationContext(api.store.getState()).preview.descriptor
        .path,
      "item-7.txt",
    );
    assert.equal(
      JSON.stringify(selectors.contextDraft(api.store.getState())).includes(
        "preview",
      ),
      false,
    );
    assert.equal(await api.actions.observeContext("ninth.txt"), false);
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 8);
  } finally {
    api.dispose();
  }
});
test("conversation context: late attachment ACK preserves newer text and NEXT options across authority changes", async (t) => {
  for (const kind of ["root", "trust", "floor", "ABA", "epoch"])
    await t.test(kind, async () => {
      const wait = deferred();
      let envelope;
      const { api } = contextWindow((e) =>
        e.operation.type === "context.observe"
          ? { ok: true, value: contextObserved() }
          : e.operation.type === "message.send"
            ? ((envelope = e), wait.promise)
            : undefined,
      );
      try {
        await api.actions.observeContext("notes.txt");
        api.actions.options({ model: "next-model" });
        api.actions.draft("original");
        const done = api.actions.sendContextMessage("original");
        for (let n = 0; n < 12 && !envelope; n++)
          await new Promise((r) => setImmediate(r));
        assert.ok(envelope);
        changeContextAuthority(api, kind);
        api.actions.draft("new text");
        api.actions.options({ agent: "next-agent", model: "other-model" });
        const current = selectors.draft(api.store.getState());
        wait.resolve({
          ok: true,
          value: { status: "accepted" },
          receipt: receipt(envelope),
        });
        await done;
        assert.equal(selectors.draft(api.store.getState()), current);
        assert.equal(current.text, "new text");
        assert.equal(current.model, "other-model");
        assert.equal(
          selectors.conversationContext(api.store.getState()).preview,
          undefined,
        );
      } finally {
        wait.resolve({ ok: false, code: "CANCELLED" });
        api.dispose();
      }
    });
});
test("conversation context: unknown branch lookup cannot reconstruct text or send and no guessed child is selected", async () => {
  const wait = deferred();
  let fork;
  const { api, clock, calls } = contextWindow((e) =>
    e.operation.type === "session.fork"
      ? ((fork = e), wait.promise)
      : e.operation.type === "operation.lookup" && fork
        ? {
            ok: true,
            value: {
              status: "found",
              runtimeEpoch: fork.runtimeEpoch,
              operationId: fork.operationId,
              receipt: receipt(fork, {
                result: {
                  kind: "forked",
                  workspaceId: "w",
                  sessionId: "child",
                  nativeSessionId: "native-child",
                },
              }),
            },
          }
        : undefined,
  );
  try {
    seed(
      api.store,
      snapshot(1, "a", {
        messages: [
          { id: "u-1", role: "user", text: "original secret input", tools: [] },
        ],
      }),
    );
    api.actions.previewContextBranch("u-1");
    const done = api.actions.confirmContextBranch();
    for (let n = 0; n < 12 && !fork; n++)
      await new Promise((r) => setImmediate(r));
    await clock.advance(31);
    await done;
    await flush();
    const i = Object.values(api.store.getState().operations)[0];
    assert.equal(i.lookupOnly, true);
    assert.equal(i.conversation.branch, undefined);
    assert.equal(i.submitted, undefined);
    assert.equal(api.store.getState().selection.sessionId, "a");
    assert.equal(
      api.store.getState().drafts[selectionKey("w", "child")],
      undefined,
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      0,
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "session.fork").length,
      1,
    );
  } finally {
    wait.resolve({ ok: false, code: "CANCELLED" });
    api.dispose();
  }
});
test("conversation context: malformed historical metadata rejects the complete snapshot", () => {
  for (const context of [
    { status: "available" },
    { status: "unavailable", count: 9 },
    { status: "unavailable", path: "private.txt" },
  ]) {
    const s = createWorkbenchStore();
    seed(s);
    const previous = s.getState().snapshot;
    seed(
      s,
      snapshot(2, "a", {
        messages: [
          { id: "u-1", role: "user", text: "text", tools: [], context },
        ],
      }),
    );
    assert.equal(s.getState().snapshot, previous);
  }
  const s = createWorkbenchStore();
  seed(s);
  const previous = s.getState().snapshot;
  seed(
    s,
    snapshot(2, "a", {
      messages: [
        {
          id: "a-1",
          role: "assistant",
          text: "text",
          tools: [],
          context: { status: "unavailable" },
        },
      ],
    }),
  );
  assert.equal(s.getState().snapshot, previous);
});
test("conversation context: digest failure refuses the action without intent or effect", async () => {
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? { ok: true, value: contextObserved() }
      : undefined,
  );
  const original = globalThis.crypto.subtle.digest;
  try {
    await api.actions.observeContext("notes.txt");
    api.actions.options({ model: "next-model" });
    globalThis.crypto.subtle.digest = async () => {
      throw Error("unavailable digest");
    };
    assert.equal(await api.actions.sendContextMessage("question"), false);
    assert.equal(Object.keys(api.store.getState().operations).length, 0);
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      0,
    );
  } finally {
    globalThis.crypto.subtle.digest = original;
    api.dispose();
  }
});
test("conversation context: observing another file cannot extend the earliest cache deadline", async () => {
  const { api, clock } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? { ok: true, value: contextObserved(e.operation.path) }
      : undefined,
  );
  try {
    await api.actions.observeContext("one.txt");
    await clock.advance(590000);
    await api.actions.observeContext("two.txt");
    await clock.advance(10000);
    assert.equal(
      selectors.contextDraft(api.store.getState()).authority,
      undefined,
    );
    assert.equal(
      selectors.conversationContext(api.store.getState()).preview,
      undefined,
    );
  } finally {
    api.dispose();
  }
});
test("conversation context: confirmed Native admission permits subsequent running queue without NEXT switches", async () => {
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "message.send"
      ? { ok: true, value: { status: "accepted" }, receipt: receipt(e) }
      : e.operation.type === "snapshot"
        ? {
            ok: true,
            value: snapshot(2, "a", {
              sessions: [
                session("a", "w", { status: "running" }),
                session("b"),
              ],
            }),
          }
        : undefined,
  );
  try {
    api.actions.draft("first");
    assert.equal(await api.actions.sendContextMessage(), true);
    await flush();
    api.actions.options({ agent: "next-agent", model: "next-model" });
    api.actions.draft("queued text");
    assert.equal(await api.actions.deliverContextMessage("queue"), true);
    const e = calls.filter((e) => e.operation.type === "message.send").at(-1);
    assert.equal(e.operation.delivery, "queue");
    assert.equal(e.operationId, e.operation.requestId);
    for (const field of ["model", "agent", "variant", "attachments"])
      assert.equal(Object.hasOwn(e.operation, field), false);
    assert.equal(selectors.draft(api.store.getState()).model, "next-model");
  } finally {
    api.dispose();
  }
});
test("conversation context: actual React controls render inert previews and complete branch and queue hooks", async () => {
  const { registerHooks } = await import("node:module");
  const css = registerHooks({
    load(url, context, nextLoad) {
      return new URL(url).pathname.endsWith(".module.css")
        ? {
            format: "module",
            shortCircuit: true,
            source:
              "export default new Proxy({}, {get: (_v, key) => String(key)});",
          }
        : nextLoad(url, context);
    },
  });
  const { register } = await import("tsx/esm/api");
  const { fileURLToPath } = await import("node:url");
  const scoped = register({
    namespace: "conversation-context-react",
    tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  });
  let Controls, MessageActions, Provider;
  // The composer wraps these bodies in popovers; render them bare here.
  const passthrough = { attachPanel: (body) => body, runPanel: (body) => body };
  try {
    ({
      ConversationContextControls: Controls,
      ContextMessageActions: MessageActions,
    } = await scoped.import(
      "./renderer/features/conversation-context/index.tsx",
      import.meta.url,
    ));
    ({ WorkbenchProvider: Provider } = await scoped.import(
      "./renderer/entities/workbench/index.ts",
      import.meta.url,
    ));
  } finally {
    css.deregister();
    await scoped.unregister();
  }
  const { createElement } = await import("react"),
    { renderToStaticMarkup } = await import("react-dom/server");
  const text = "\uFEFF<script>never run</script>\r\nexact text";
  let observed = contextObserved("notes.txt", text);
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? { ok: true, value: observed }
      : e.operation.type === "session.inbox"
        ? { ok: true, value: inboxObserved() }
        : undefined,
  );
  try {
    seed(
      api.store,
      snapshot(1, "a", {
        messages: [
          {
            id: "u-1",
            role: "user",
            text: "original",
            tools: [],
            context: { status: "unavailable", count: 1 },
          },
        ],
      }),
    );
    await api.actions.observeContext("notes.txt");
    const value = {
      ...api,
      store: { ...api.store, getInitialState: () => api.store.getState() },
    };
    const html = renderToStaticMarkup(
      createElement(Provider, { value }, createElement(Controls, passthrough)),
    );
    assert.ok(
      html.includes("&lt;script&gt;never run&lt;/script&gt;\r\nexact text"),
    );
    assert.ok(!html.includes("<script>"));
    assert.ok(html.includes("a".repeat(64)));
    assert.ok(html.includes("b".repeat(64)));
    for (const hook of [
      "path",
      "observe",
      "list",
      "item",
      "preview",
      "text",
      "selection",
      "steer",
      "queue",
      "inbox-observe",
    ])
      assert.ok(html.includes(`data-context-${hook}`), hook);
    // A branch task owns the composer: attach/run panels are not rendered.
    api.actions.previewContextBranch("u-1");
    const branchHtml = renderToStaticMarkup(
      createElement(Provider, { value }, createElement(Controls, passthrough)),
    );
    for (const hook of ["branch", "boundary", "branch-text", "branch-confirm"])
      assert.ok(branchHtml.includes(`data-context-${hook}`), hook);
    for (const hook of ["path", "observe", "steer", "queue", "inbox-observe"])
      assert.ok(!branchHtml.includes(`data-context-${hook}`), hook);
    assert.ok(branchHtml.includes("현재 작업 공간의 파일은 그대로 둡니다"));
    assert.ok(branchHtml.includes("새 분기 만들기 · 전송 안 함"));
    const messageHtml = renderToStaticMarkup(
      createElement(
        Provider,
        { value },
        createElement(MessageActions, {
          message: api.store.getState().snapshot.messages[0],
        }),
      ),
    );
    assert.ok(messageHtml.includes('data-context-historical="unavailable"'));
    assert.ok(messageHtml.includes('data-context-retry="u-1"'));
    assert.equal(
      calls.length,
      1,
      "Server rendering performs no read, upload or mutation",
    );
    api.actions.closeContextBranch();
    const gif = "R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";
    observed = contextObserved("pixel.gif", "", {
      descriptor: {
        ...contextObserved("pixel.gif", "").descriptor,
        mime: "image/gif",
        size: Buffer.from(gif, "base64").length,
      },
      preview: { kind: "image", dataUrl: `data:image/gif;base64,${gif}` },
    });
    assert.equal(await api.actions.observeContext("pixel.gif"), true);
    const imageHtml = renderToStaticMarkup(
      createElement(Provider, { value }, createElement(Controls, passthrough)),
    );
    assert.ok(imageHtml.includes(`src="data:image/gif;base64,${gif}"`));
    assert.ok(
      !JSON.stringify(selectors.contextDraft(api.store.getState())).includes(
        "data:image",
      ),
    );
    observed = contextObserved("sample.pdf", "", {
      descriptor: {
        ...contextObserved("sample.pdf", "").descriptor,
        mime: "application/pdf",
        size: 16,
      },
      preview: { kind: "pdf" },
    });
    assert.equal(await api.actions.observeContext("sample.pdf"), true);
    const pdfHtml = renderToStaticMarkup(
      createElement(Provider, { value }, createElement(Controls, passthrough)),
    );
    assert.ok(pdfHtml.includes("PDF 내용 미리보기를 사용할 수 없습니다"));
    assert.ok(!/<(?:iframe|embed|object|img)\b/.test(pdfHtml));
    assert.equal(await api.actions.observeInbox(), true);
    const inboxHtml = renderToStaticMarkup(
      createElement(Provider, { value }, createElement(Controls, passthrough)),
    );
    assert.ok(inboxHtml.includes('data-context-inbox-row="pending-1"'));
    assert.ok(inboxHtml.includes('data-context-inbox-cancel="pending-1"'));
    assert.ok(inboxHtml.includes("취소나 미실행을 증명하지 않습니다"));
    assert.equal(calls.length, 4);
  } finally {
    api.dispose();
  }
});
const contextDigest = (e) =>
  createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys({ ...e.operation, expectedRevision: e.expectedRevision })
          .sort()
          .map((k) => [
            k,
            { ...e.operation, expectedRevision: e.expectedRevision }[k],
          ]),
      ),
    )
    .digest("hex");
test("conversation context: exact cancellation ACK means request accepted and invalidates explicit inbox observation", async () => {
  const { api, calls } = contextWindow(
    (e) =>
      e.operation.type === "session.inbox"
        ? { ok: true, value: inboxObserved() }
        : e.operation.type === "session.inbox.cancel"
          ? {
              ok: true,
              value: { status: "accepted" },
              receipt: receipt(e, {
                result: {
                  kind: "inbox_cancel_requested",
                  workspaceId: "w",
                  sessionId: "a",
                  inboxId: "pending-1",
                  digest: contextDigest(e),
                },
              }),
            }
          : undefined,
    true,
  );
  try {
    assert.equal(await api.actions.observeInbox(), true);
    assert.equal(await api.actions.cancelInbox("not-observed"), false);
    assert.equal(await api.actions.cancelInbox("pending-1"), true);
    const e = calls.find((e) => e.operation.type === "session.inbox.cancel");
    assert.equal(e.operationId, e.operation.requestId);
    assert.equal(e.expectedRevision, 1);
    assert.equal(
      selectors.conversationContext(api.store.getState()).inbox,
      undefined,
    );
    assert.match(
      selectors.conversationContext(api.store.getState()).notice,
      /취소를 요청했습니다/,
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "session.inbox").length,
      1,
    );
  } finally {
    api.dispose();
  }
});
test("conversation context: wrong cancel digest or target stays unknown and original key lookup never replays", async (t) => {
  for (const field of ["digest", "inboxId", "workspaceId", "sessionId"])
    await t.test(field, async () => {
      const { api, calls, clock } = contextWindow(
        (e) =>
          e.operation.type === "session.inbox"
            ? { ok: true, value: inboxObserved() }
            : e.operation.type === "session.inbox.cancel"
              ? {
                  ok: true,
                  value: { status: "accepted" },
                  receipt: receipt(e, {
                    result: {
                      kind: "inbox_cancel_requested",
                      workspaceId: "w",
                      sessionId: "a",
                      inboxId: "pending-1",
                      digest: contextDigest(e),
                      [field]: field === "digest" ? "f".repeat(64) : "wrong",
                    },
                  }),
                }
              : undefined,
        true,
      );
      try {
        await api.actions.observeInbox();
        assert.equal(await api.actions.cancelInbox("pending-1"), false);
        await flush();
        const i = Object.values(api.store.getState().operations).find(
          (i) => i.operation.type === "session.inbox.cancel",
        );
        assert.equal(i.status, "unknown");
        assert.equal(i.lookupOnly, true);
        assert.equal(Object.hasOwn(i.operation, "inboxId"), false);
        assert.equal(i.conversation.inboxId, "pending-1");
        await clock.advance(5000);
        assert.equal(
          calls.filter((e) => e.operation.type === "session.inbox.cancel")
            .length,
          1,
        );
        assert.equal(await api.actions.deliverContextMessage("queue"), false);
      } finally {
        api.dispose();
      }
    });
});
test("conversation context: before-user branch prepares edited draft with historical input unavailable and zero sends", async () => {
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "session.fork"
      ? {
          ok: true,
          value: snapshot(2, "child", {
            sessions: [
              session("a"),
              session("b"),
              session("child", "w", { parentSessionId: "a" }),
            ],
          }),
          receipt: receipt(e, {
            evidence: [{ kind: "native_session", id: "native-child" }],
            result: {
              kind: "forked",
              workspaceId: "w",
              sessionId: "child",
              nativeSessionId: "native-child",
            },
          }),
        }
      : undefined,
  );
  try {
    seed(
      api.store,
      snapshot(1, "a", {
        messages: [
          {
            id: "u-1",
            role: "user",
            text: "original",
            tools: [],
            context: { status: "unavailable", count: 1 },
          },
          { id: "a-1", role: "assistant", text: "response", tools: [] },
        ],
      }),
    );
    assert.equal(api.actions.previewContextBranch("a-1"), false);
    assert.equal(api.actions.previewContextBranch("u-1"), true);
    api.actions.editContextBranch("edited");
    assert.equal(calls.length, 0);
    assert.equal(await api.actions.confirmContextBranch(), true);
    assert.equal(api.store.getState().selection.sessionId, "child");
    assert.equal(selectors.draft(api.store.getState()).text, "edited");
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 0);
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      0,
    );
    const e = calls.find((e) => e.operation.type === "session.fork");
    assert.equal(e.operation.before, "u-1");
    assert.equal(e.expectedRevision, 1);
  } finally {
    api.dispose();
  }
});
test("conversation context: malformed fork snapshot cannot navigate or prepare a fabricated child", async () => {
  const { api } = contextWindow((e) =>
    e.operation.type === "session.fork"
      ? {
          ok: true,
          value: snapshot(2, "b"),
          receipt: receipt(e, {
            result: {
              kind: "forked",
              workspaceId: "w",
              sessionId: "b",
              nativeSessionId: "native-b",
            },
          }),
        }
      : undefined,
  );
  try {
    seed(
      api.store,
      snapshot(1, "a", {
        messages: [{ id: "u-1", role: "user", text: "original", tools: [] }],
      }),
    );
    api.actions.previewContextBranch("u-1");
    assert.equal(await api.actions.confirmContextBranch(), false);
    assert.equal(api.store.getState().selection.sessionId, "a");
    assert.equal(
      Object.values(api.store.getState().operations)[0].status,
      "unknown",
    );
  } finally {
    api.dispose();
  }
});
test("conversation context: empty attachment send readiness requires current Workspace trust", async () => {
  const { api, calls } = contextWindow();
  try {
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 0);
    assert.equal(selectors.contextSendReady(api.store.getState()), true);
    seed(
      api.store,
      snapshot(1, "a", {
        workspaces: [{ ...workspace(), trusted: false }],
      }),
    );
    assert.equal(selectors.contextSendReady(api.store.getState()), false);
    api.actions.draft("inert draft");
    assert.equal(await api.actions.sendContextMessage(), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      0,
    );
    assert.equal(selectors.draft(api.store.getState()).text, "inert draft");
  } finally {
    api.dispose();
  }
});
test("conversation context: expired summaries never revive when another file is observed", async () => {
  const { api, calls, clock } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? { ok: true, value: contextObserved(e.operation.path) }
      : undefined,
  );
  try {
    api.actions.options({ model: "next-model" });
    await api.actions.observeContext("one.txt");
    await clock.advance(600000);
    assert.equal(selectors.contextSendReady(api.store.getState()), false);
    await api.actions.observeContext("two.txt");
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 2);
    assert.equal(selectors.contextSendReady(api.store.getState()), false);
    assert.equal(await api.actions.sendContextMessage("question"), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      0,
    );
  } finally {
    api.dispose();
  }
});
test("conversation context: read timeout keeps actual IO hold until the host call settles", async () => {
  const wait = deferred();
  const { api, clock, calls } = contextWindow((e) =>
    e.operation.type === "context.observe" ? wait.promise : undefined,
  );
  try {
    const done = api.actions.observeContext("notes.txt");
    await flush();
    await clock.advance(31);
    assert.equal(await done, false);
    assert.equal(api.store.getState().configurationIO.reads, 1);
    assert.equal(await api.actions.observeInbox(), false);
    assert.equal(await api.actions.sendContextMessage("question"), false);
    wait.resolve({ ok: true, value: contextObserved() });
    await flush();
    assert.equal(api.store.getState().configurationIO.reads, 0);
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 0);
    assert.equal(
      calls.filter((e) => e.operation.type === "context.observe").length,
      1,
    );
  } finally {
    wait.resolve({ ok: false, code: "CANCELLED" });
    api.dispose();
  }
});
test("conversation context: invalid runtime delivery is refused locally with zero IO", async () => {
  const { api, calls } = contextWindow(() => undefined, true);
  try {
    api.actions.draft("text");
    assert.equal(await api.actions.deliverContextMessage("invalid"), false);
    assert.equal(calls.length, 0);
  } finally {
    api.dispose();
  }
});
test("conversation context: explicit capture retains exact BOM CRLF and sends frozen descriptors only", async () => {
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "context.observe"
      ? { ok: true, value: contextObserved() }
      : e.operation.type === "message.send"
        ? { ok: true, value: { status: "accepted" }, receipt: receipt(e) }
        : undefined,
  );
  try {
    assert.equal(calls.length, 0);
    assert.equal(await api.actions.observeContext("notes.txt"), true);
    assert.equal(
      selectors.conversationContext(api.store.getState()).preview.value.text,
      "\uFEFFa\r\nb😀c",
    );
    api.actions.options({ model: "next-model" });
    api.actions.draft("question");
    assert.equal(await api.actions.sendContextMessage("question"), true);
    const e = calls.find((e) => e.operation.type === "message.send");
    assert.equal(e.expectedRevision, 1);
    assert.deepEqual(e.operation.attachments, [contextObserved().descriptor]);
    assert.ok(Object.isFrozen(e.operation.attachments[0]));
    assert.equal(JSON.stringify(e.operation).includes("data:"), false);
  } finally {
    api.dispose();
  }
});
test("conversation context: late read after selection ABA is discarded without automatic reread", async () => {
  const wait = deferred();
  const { api, calls } = contextWindow((e) =>
    e.operation.type === "context.observe" ? wait.promise : undefined,
  );
  try {
    const done = api.actions.observeContext("notes.txt");
    await flush();
    api.actions.select("w", "b");
    api.actions.select("w", "a");
    wait.resolve({ ok: true, value: contextObserved() });
    assert.equal(await done, false);
    assert.equal(selectors.contextDraft(api.store.getState()).items.length, 0);
    assert.equal(
      calls.filter((e) => e.operation.type === "context.observe").length,
      1,
    );
  } finally {
    wait.resolve({ ok: false, code: "CANCELLED" });
    api.dispose();
  }
});
test("conversation context: historical unavailable context is accepted only for user metadata", () => {
  const store = createWorkbenchStore();
  seed(
    store,
    snapshot(1, "a", {
      messages: [
        {
          id: "u",
          role: "user",
          text: "question",
          tools: [],
          context: { status: "unavailable", count: 1 },
        },
      ],
    }),
  );
  assert.equal(store.getState().snapshot.messages[0].context.count, 1);
});
test("conversation context: running delivery omits NEXT options and attachments", async () => {
  const { api, calls } = contextWindow(
    (e) =>
      e.operation.type === "message.send"
        ? { ok: true, value: { status: "accepted" }, receipt: receipt(e) }
        : undefined,
    true,
  );
  try {
    api.actions.options({ agent: "next-agent", model: "next-model" });
    api.actions.draft("extra instruction");
    assert.equal(await api.actions.deliverContextMessage("steer"), true);
    const e = calls.find((e) => e.operation.type === "message.send");
    assert.equal(e.operation.delivery, "steer");
    for (const field of ["agent", "model", "variant", "attachments"])
      assert.equal(Object.hasOwn(e.operation, field), false);
    assert.equal(selectors.draft(api.store.getState()).model, "next-model");
  } finally {
    api.dispose();
  }
});
function deferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}
function fakeClock() {
  let now = 0,
    sequence = 0;
  const timers = new Map();
  return {
    timers,
    setTimeout(callback, delay) {
      const id = ++sequence;
      timers.set(id, { at: now + delay, callback });
      return id;
    },
    clearTimeout(id) {
      timers.delete(id);
    },
    async advance(ms) {
      const end = now + ms;
      let count = 0;
      while (true) {
        const next = [...timers]
          .filter(([, v]) => v.at <= end)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        assert.ok(++count < 1000, "timer loop must be bounded");
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
      await flush();
    },
  };
}
let idSequence = 0;
const id = () => `test-${++idSequence}`;
const workspace = (id = "w", trustRevision = 1) => ({
  id,
  name: id,
  path: "/fixture",
  trusted: true,
  trustRevision,
  kind: "folder",
  temporary: true,
});
const session = (id, workspaceId = "w", extras = {}) => ({
  id,
  workspaceId,
  title: id,
  status: "idle",
  ...extras,
});
let snapshotSequence = 0;
const snapshot = (revision = 1, selectedSessionId = "a", extra = {}) => ({
  runtimeEpoch: "epoch-a",
  revision,
  observationSequence: ++snapshotSequence,
  recovery: { store: { state: "ready" }, resources: [] },
  retainedOperations: [],
  state: "connected",
  temporary: true,
  workspaces: [workspace()],
  sessions: [session("a"), session("b")],
  selectedWorkspaceId: "w",
  ...(selectedSessionId ? { selectedSessionId } : {}),
  messages: [],
  permissions: [],
  ...extra,
});
function seed(store, value = snapshot()) {
  store.dispatch({ type: "snapshot", scope: scopeOf(store.getState()), value });
}
const receipt = (envelope, extra = {}) => ({
  runtimeEpoch: envelope.runtimeEpoch,
  operationId: envelope.operationId,
  type: envelope.operation.type,
  ...(envelope.operation.workspaceId
    ? { workspaceId: envelope.operation.workspaceId }
    : {}),
  ...(envelope.operation.sessionId
    ? { sessionId: envelope.operation.sessionId }
    : {}),
  admission: "dispatched",
  delivery: "accepted",
  effect: "confirmed",
  revision: 2,
  evidence: [{ kind: "native_inbox", id: "inbox" }],
  result: { kind: "delivery", status: "accepted", nativeInboxId: "inbox" },
  ...extra,
});
const send = () => ({
  type: "message.send",
  workspaceId: "w",
  sessionId: "a",
  requestId: "native-send",
  text: "original",
});
function bridgeHarness(handler) {
  const calls = [],
    cancellations = [];
  return {
    calls,
    cancellations,
    bridge: {
      workbench(envelope) {
        calls.push(envelope);
        return handler(envelope);
      },
      cancelRead(envelope) {
        cancellations.push(envelope);
        return Promise.resolve({ ok: true, value: { status: "cancelled" } });
      },
    },
  };
}
const catalog = {
  commands: { status: "available", entries: [] },
  skills: { status: "available", entries: [] },
  mcp: { status: "available", entries: [] },
  agents: { status: "available", entries: [] },
  models: { status: "available", entries: [] },
};
const readFallback = (envelope) => ({
  ok: true,
  value:
    envelope.operation.type === "catalog.list"
      ? catalog
      : envelope.operation.type === "operation.lookup"
        ? {
            status: "missing",
            runtimeEpoch: envelope.operation.runtimeEpoch,
            operationId: envelope.operation.operationId,
            effect: "unknown",
          }
        : snapshot(2, envelope.operation.sessionId ?? "a"),
});

test("window stores are independent, selector references are stable, and setState is not exposed", () => {
  const a = createWorkbenchStore(),
    b = createWorkbenchStore();
  seed(a);
  const references = [
    selectors.selection(a.getState()),
    selectors.lists(a.getState()),
    selectors.snapshot(a.getState()),
    selectors.files(a.getState()),
    selectors.draft(a.getState()),
  ];
  a.dispatch({ type: "layout", value: { panelWidth: 410 } });
  assert.deepEqual(
    [
      selectors.selection(a.getState()),
      selectors.lists(a.getState()),
      selectors.snapshot(a.getState()),
      selectors.files(a.getState()),
      selectors.draft(a.getState()),
    ].map((v, i) => v === references[i]),
    [true, true, true, true, true],
  );
  a.dispatch({ type: "draft", key: selectionKey("w", "a"), text: "A" });
  assert.equal(selectors.draft(b.getState()).text, "");
  assert.equal(b.getState().epoch, undefined);
  assert.equal(a.setState, undefined);
});
test("snapshot projection and health commit atomically; stale revision/generation/epoch never changes health", () => {
  const store = createWorkbenchStore();
  seed(store, snapshot(8));
  const baseline = store.getState(),
    scope = scopeOf(baseline);
  let notifications = 0;
  store.subscribe(() => notifications++);
  for (const value of [
    snapshot(7, "a", { state: "disconnected" }),
    snapshot(8, "a", {
      state: "unavailable",
      observationSequence: baseline.observationSequence,
    }),
    snapshot(9, "b", { state: "disconnected" }),
    snapshot(100, "a", { runtimeEpoch: "alien", state: "disconnected" }),
  ])
    store.dispatch({ type: "snapshot", scope, value });
  assert.equal(store.getState(), baseline);
  assert.equal(notifications, 0);
  store.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
  store.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
  const reselected = store.getState();
  store.dispatch({
    type: "snapshot",
    scope,
    value: snapshot(10, "a", { state: "unavailable" }),
  });
  store.dispatch({ type: "health", scope, code: "old" });
  assert.equal(store.getState(), reselected);
  store.dispatch({
    type: "snapshot",
    scope: scopeOf(reselected),
    value: snapshot(9, "a", { state: "disconnected" }),
  });
  assert.equal(store.getState().connection, "disconnected");
  assert.equal(store.getState().snapshot.revision, 9);
});
test("a new epoch is established by bootstrap only and retired epochs cannot re-enter", () => {
  const store = createWorkbenchStore();
  seed(store, snapshot(10));
  store.dispatch({
    type: "snapshot",
    scope: { ...scopeOf(store.getState()), bootstrap: true },
    value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
  });
  assert.equal(store.getState().epoch, "epoch-b");
  const state = store.getState();
  store.dispatch({
    type: "snapshot",
    scope: { ...scopeOf(state), bootstrap: true },
    value: snapshot(99),
  });
  assert.equal(store.getState(), state);
});
for (const newer of [false, true])
  test(`exact accepted receipt clears submitted draft revision only: newer=${newer}`, async () => {
    const response = deferred(),
      clock = fakeClock();
    const h = bridgeHarness((e) =>
      e.operation.type === "message.send" ? response.promise : readFallback(e),
    );
    const api = createWindowWorkbench(h.bridge, { clock, id });
    seed(api.store);
    api.actions.draft("original");
    const originalRevision = selectors.draft(api.store.getState()).revision;
    const done = api.actions.mutate(send(), false, "original");
    await flush();
    if (newer) api.actions.draft("new edit");
    const envelope = h.calls.find((c) => c.operation.type === "message.send");
    response.resolve({
      ok: true,
      value: { status: "accepted" },
      receipt: receipt(envelope),
    });
    assert.equal(await done, true);
    assert.equal(
      selectors.draft(api.store.getState()).text,
      newer ? "new edit" : "",
    );
    assert.equal(
      api.store.getState().operations[
        operationKey(envelope.runtimeEpoch, envelope.operationId)
      ].submitted.revision,
      originalRevision,
    );
    assert.equal(
      api.store.getState().operations[
        operationKey(envelope.runtimeEpoch, envelope.operationId)
      ].submitted.text,
      "original",
    );
    api.dispose();
    assert.equal(clock.timers.size, 0);
  });
test("unknown delivery retains original plus later draft, blocks same target, uses lookup only, and survives epoch replacement", async () => {
  const clock = fakeClock(),
    never = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "message.send" ? never.promise : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id, timeoutMs: 30 });
  seed(api.store);
  api.actions.draft("original");
  const done = api.actions.mutate(send(), false, "original");
  await flush();
  api.actions.draft("latest");
  await clock.advance(30);
  assert.equal(await done, false);
  await flush();
  const intent = Object.values(api.store.getState().operations)[0];
  assert.equal(intent.status, "unknown");
  assert.equal(intent.submitted.text, "original");
  assert.equal(selectors.draft(api.store.getState()).text, "latest");
  assert.equal(await api.actions.mutate(send()), false);
  assert.equal(
    h.calls.filter((c) => c.operation.type === "message.send").length,
    1,
  );
  const lookup = h.calls.find((c) => c.operation.type === "operation.lookup");
  assert.equal(lookup.operation.runtimeEpoch, "epoch-a");
  assert.equal(lookup.operation.operationId, intent.id);
  assert.equal(lookup.operationId, undefined);
  assert.ok(lookup.readId);
  api.store.dispatch({
    type: "snapshot",
    scope: { ...scopeOf(api.store.getState()), bootstrap: true },
    value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
  });
  assert.equal(selectors.unknown(api.store.getState()), true);
  await clock.advance(5000);
  const lastLookup = h.calls
    .filter((c) => c.operation.type === "operation.lookup")
    .at(-1);
  assert.equal(lastLookup.runtimeEpoch, "epoch-b");
  assert.equal(lastLookup.operation.runtimeEpoch, "epoch-a");
  never.resolve({
    ok: true,
    value: { status: "accepted" },
    receipt: receipt(h.calls[0]),
  });
  await flush();
  assert.equal(selectors.unknown(api.store.getState()), true);
  assert.equal(selectors.draft(api.store.getState()).text, "latest");
  api.dispose();
  assert.equal(clock.timers.size, 0);
});
test("authoritative lookup resolves only its exact operation; unrelated receipt cannot clear draft or hold", async () => {
  const clock = fakeClock();
  let sent;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "message.send") {
      sent = e;
      return Promise.resolve({
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: "unknown",
      });
    }
    if (e.operation.type === "operation.lookup")
      return Promise.resolve({
        ok: true,
        value: {
          status: "found",
          runtimeEpoch: sent.runtimeEpoch,
          operationId: sent.operationId,
          receipt: receipt(sent, { operationId: "wrong" }),
        },
      });
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.actions.draft("original");
  await api.actions.mutate(send(), false, "original");
  await flush();
  assert.equal(selectors.unknown(api.store.getState()), true);
  assert.equal(selectors.draft(api.store.getState()).text, "original");
  api.store.dispatch({
    type: "receipt",
    id: sent.operationId,
    receipt: receipt(sent),
  });
  assert.equal(selectors.unknown(api.store.getState()), false);
  assert.equal(selectors.draft(api.store.getState()).text, "");
  api.dispose();
});
for (const selection of [
  ["w", "a"],
  ["w", "b"],
  ["other", "other-a"],
])
  test(`confirmed target deletion reconciles A-B-A identity and only target drafts: ${selection}`, async () => {
    const clock = fakeClock(),
      pending = deferred();
    const h = bridgeHarness((e) =>
      e.operation.type === "session.remove" ? pending.promise : readFallback(e),
    );
    const api = createWindowWorkbench(h.bridge, { clock, id });
    seed(
      api.store,
      snapshot(1, "a", {
        workspaces: [workspace(), workspace("other")],
        sessions: [
          session("a"),
          session("b"),
          session("other-a", "other"),
          session("archived", "w", { archived: true }),
        ],
      }),
    );
    for (const [w, s] of [
      ["w", "a"],
      ["w", "b"],
      ["other", "other-a"],
    ])
      api.actions.draft(`${w}-${s}`, selectionKey(w, s));
    const done = api.actions.mutate({
      type: "session.remove",
      workspaceId: "w",
      sessionId: "a",
      requestId: "remove",
    });
    await flush();
    api.actions.select("w", "b");
    api.actions.select(...selection);
    const envelope = h.calls.find((c) => c.operation.type === "session.remove");
    pending.resolve({
      ok: true,
      value: snapshot(2, "b"),
      receipt: receipt(envelope, {
        result: {
          kind: "removed",
          workspaceId: "w",
          removedSessionIds: ["a"],
          workspaceRemoved: false,
        },
      }),
    });
    assert.equal(await done, true);
    assert.equal(
      api.store.getState().drafts[selectionKey("w", "a")],
      undefined,
    );
    assert.equal(
      api.store.getState().drafts[selectionKey("w", "b")].text,
      "w-b",
    );
    assert.equal(
      api.store.getState().drafts[selectionKey("other", "other-a")].text,
      "other-other-a",
    );
    const current = api.store.getState().selection;
    assert.deepEqual(
      [current.workspaceId, current.sessionId],
      selection[0] === "w" ? ["w", "b"] : selection,
    );
    api.dispose();
  });
test("unconfirmed absence in a successful snapshot never resolves deletion or removes a draft", async () => {
  const clock = fakeClock();
  const h = bridgeHarness((e) =>
    e.operation.type === "session.remove"
      ? { ok: false, code: "UNKNOWN_OUTCOME", message: "unknown" }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.actions.draft("keep");
  await api.actions.mutate({
    type: "session.remove",
    workspaceId: "w",
    sessionId: "a",
    requestId: "remove",
  });
  await flush();
  api.store.dispatch({
    type: "snapshot",
    scope: scopeOf(api.store.getState()),
    value: snapshot(50, "a", { sessions: [session("b")] }),
  });
  assert.equal(selectors.unknown(api.store.getState()), true);
  assert.equal(selectors.draft(api.store.getState()).text, "keep");
  api.dispose();
});
test("startup snapshot timeout keeps re-polling with capped backoff until connected", async () => {
  const clock = fakeClock(),
    pending = deferred();
  let n = 0;
  const h = bridgeHarness((e) =>
    e.operation.type === "snapshot" && ++n === 1
      ? pending.promise
      : e.operation.type === "snapshot" && n < 4
        ? { ok: false, code: "UNAVAILABLE", message: "x" }
        : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id, timeoutMs: 30 });
  api.start();
  await flush();
  await clock.advance(30);
  assert.equal(api.store.getState().connection, "disconnected");
  pending.resolve({ ok: false, code: "UNAVAILABLE", message: "late" });
  await clock.advance(20000);
  assert.ok(n >= 4);
  assert.equal(api.store.getState().connection, "connected");
  api.dispose();
});
test("bounded transport coalesces up to eight subscribers, isolates cancellations and keeps first task deadline", async () => {
  const clock = fakeClock(),
    pending = deferred(),
    abort = new AbortController();
  const h = bridgeHarness(() => pending.promise);
  const transport = createTransport(h.bridge, { clock, id, timeoutMs: 20 });
  const a = transport.read({ type: "snapshot" }, "epoch-a", abort.signal);
  await flush();
  await clock.advance(10);
  const b = transport.read({ type: "snapshot" }, "epoch-a");
  const rest = Array.from({ length: 6 }, () =>
    transport.read({ type: "snapshot" }, "epoch-a"),
  );
  assert.equal(
    (await transport.read({ type: "snapshot" }, "epoch-a")).code,
    "READ_BUSY",
  );
  abort.abort();
  assert.equal((await a).code, "CANCELLED");
  await flush();
  assert.equal(h.cancellations.length, 0);
  await clock.advance(10);
  assert.equal((await b).code, "READ_TIMEOUT");
  assert.ok((await Promise.all(rest)).every((v) => v.code === "READ_TIMEOUT"));
  await flush();
  assert.equal(h.calls.length, 1);
  assert.equal(h.cancellations.length, 1);
  assert.deepEqual(h.cancellations[0], {
    version: 2,
    runtimeEpoch: "epoch-a",
    readId: h.calls[0].readId,
  });
  assert.equal(
    (await transport.read({ type: "snapshot" }, "epoch-a")).code,
    "READ_BUSY",
  );
  pending.resolve({ ok: true, value: snapshot(1) });
  await flush();
  assert.equal(clock.timers.size, 0);
  transport.dispose();
});
test("reserved receipt lookup survives never-settling read lanes; dispose settles waits and drops late completions", async () => {
  const clock = fakeClock(),
    pending = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "operation.lookup" ? readFallback(e) : pending.promise,
  );
  const transport = createTransport(h.bridge, { clock, id, timeoutMs: 25 });
  const reads = [
    transport.read({ type: "snapshot" }, "epoch-a"),
    transport.read({ type: "catalog.list", workspaceId: "w" }, "epoch-a"),
    transport.read(
      { type: "file.read", workspaceId: "w", path: "a" },
      "epoch-a",
    ),
  ];
  await flush();
  await clock.advance(25);
  assert.ok((await Promise.all(reads)).every((r) => r.code === "READ_TIMEOUT"));
  assert.equal(
    (
      await transport.read(
        {
          type: "operation.lookup",
          runtimeEpoch: "epoch-a",
          operationId: "op",
        },
        "epoch-a",
      )
    ).ok,
    true,
  );
  const wait = transport.mutate(send(), "epoch-a", "operation-once");
  await flush();
  transport.dispose();
  assert.equal((await wait).code, "UNKNOWN_OUTCOME");
  assert.equal(clock.timers.size, 0);
  pending.resolve({ ok: true, value: snapshot(100) });
  await flush();
  assert.equal(
    h.calls.filter((c) => c.operation.type === "message.send").length,
    1,
  );
});

function fileHarness() {
  const clock = fakeClock();
  let version = 1,
    missing = false,
    shown = true,
    visibility,
    refocus,
    revision = 1;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "file.list")
      return {
        ok: true,
        value: {
          path: e.operation.path ?? "",
          entries: missing
            ? []
            : [{ name: "a.txt", path: "a.txt", type: "file" }],
        },
      };
    if (e.operation.type === "file.read")
      return missing
        ? { ok: false, code: "NOT_FOUND", message: "missing" }
        : {
            ok: true,
            value: {
              path: e.operation.path,
              content: `version-${version}`,
              truncated: false,
            },
          };
    if (e.operation.type === "snapshot")
      return {
        ok: true,
        value: snapshot(++revision, e.operation.sessionId ?? "a"),
      };
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, {
    clock,
    id,
    visible: () => shown,
    onVisibility: (listener) => {
      visibility = listener;
      return () => {
        visibility = undefined;
      };
    },
    onRefocus: (listener) => {
      refocus = listener;
      return () => {
        refocus = undefined;
      };
    },
  });
  seed(api.store);
  api.start();
  return {
    api,
    clock,
    h,
    edit() {
      version++;
    },
    remove() {
      missing = true;
    },
    recreate() {
      missing = false;
      version++;
    },
    hide() {
      shown = false;
      visibility?.();
    },
    show() {
      shown = true;
      visibility?.();
    },
    focus() {
      refocus?.();
    },
    listeners() {
      return [visibility, refocus];
    },
  };
}
test("visible file has fresh reopen, listing+preview refresh, delete/recreation, five-second timer and hidden/refocus cleanup", async () => {
  const f = fileHarness();
  await flush();
  f.api.actions.openFiles();
  await flush();
  f.api.actions.openFiles("a.txt", "file");
  await flush();
  assert.equal(f.api.store.getState().files.preview.content, "version-1");
  f.edit();
  const before = f.h.calls.length;
  await f.api.actions.refreshFiles();
  assert.deepEqual(
    f.h.calls.slice(before).map((c) => c.operation.type),
    ["file.list", "file.read"],
  );
  assert.equal(f.api.store.getState().files.preview.content, "version-2");
  f.api.actions.closeFiles();
  f.edit();
  f.api.actions.openFiles("a.txt", "file");
  assert.equal(f.api.store.getState().files.preview, null);
  await flush();
  assert.equal(f.api.store.getState().files.preview.content, "version-3");
  f.remove();
  await f.api.actions.refreshFiles();
  assert.equal(f.api.store.getState().files.status, "missing");
  assert.equal(f.api.store.getState().files.preview, null);
  f.recreate();
  await f.api.actions.refreshFiles();
  assert.equal(f.api.store.getState().files.preview.content, "version-4");
  f.edit();
  await f.clock.advance(5000);
  assert.equal(f.api.store.getState().files.preview.content, "version-5");
  f.hide();
  const reads = f.h.calls.filter((c) =>
    c.operation.type.startsWith("file."),
  ).length;
  await f.clock.advance(10000);
  assert.equal(
    f.h.calls.filter((c) => c.operation.type.startsWith("file.")).length,
    reads,
  );
  f.edit();
  f.show();
  await flush();
  assert.equal(f.api.store.getState().files.preview.content, "version-6");
  f.edit();
  f.focus();
  await flush();
  assert.equal(f.api.store.getState().files.preview.content, "version-7");
  f.api.dispose();
  assert.equal(f.clock.timers.size, 0);
  assert.deepEqual(f.listeners(), [undefined, undefined]);
  const state = f.api.store.getState();
  await f.clock.advance(10000);
  assert.equal(f.api.store.getState(), state);
});
test("late file A-B-A reply, old epoch and changed trust identity cannot restore an obsolete preview", async () => {
  const store = createWorkbenchStore();
  seed(store);
  store.dispatch({ type: "files.open", path: "a.txt", kind: "file" });
  const old = store.getState().files.identity;
  store.dispatch({ type: "files.open", path: "b.txt", kind: "file" });
  store.dispatch({ type: "files.open", path: "a.txt", kind: "file" });
  const current = store.getState();
  for (const identity of [
    old,
    { ...current.files.identity, epoch: "old" },
    { ...current.files.identity, trustRevision: 0 },
  ])
    store.dispatch({
      type: "files.read",
      identity,
      value: { path: "a.txt", content: "obsolete", truncated: false },
    });
  assert.equal(store.getState(), current);
  store.dispatch({
    type: "files.read",
    identity: current.files.identity,
    value: { path: "a.txt", content: "fresh", truncated: false },
  });
  assert.equal(store.getState().files.preview.content, "fresh");
});
test("file controller disposal cancels waiting read and prevents delayed visible payload writes", async () => {
  const clock = fakeClock(),
    pending = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "file.list" ? pending.promise : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.start();
  await flush();
  api.actions.openFiles();
  await flush();
  api.dispose();
  const final = api.store.getState();
  pending.resolve({
    ok: true,
    value: {
      path: "",
      entries: [{ name: "late", path: "late", type: "file" }],
    },
  });
  await flush();
  assert.equal(api.store.getState(), final);
  assert.equal(clock.timers.size, 0);
  assert.ok(
    h.cancellations.some(
      (c) =>
        c.readId ===
        h.calls.find((c) => c.operation.type === "file.list").readId,
    ),
  );
});

test("a timed-out old snapshot cannot overwrite health after a newer projection in the same selection", () => {
  const store = createWorkbenchStore();
  seed(store);
  const old = scopeOf(store.getState());
  store.dispatch({ type: "snapshot", scope: old, value: snapshot(2) });
  const current = store.getState();
  store.dispatch({ type: "health", scope: old, code: "READ_TIMEOUT" });
  assert.equal(store.getState(), current);
});
test("host epoch bootstrap precedes mutations; new epoch bootstrap does not use obsolete selected IDs", async () => {
  const clock = fakeClock(),
    boot = deferred();
  let hostEpoch = "epoch-a",
    seenMutation,
    bootstrapCalls = 0;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "snapshot") {
      if (!e.runtimeEpoch && !e.operation.workspaceId) {
        bootstrapCalls++;
        return bootstrapCalls === 1
          ? boot.promise
          : {
              ok: true,
              value: snapshot(1, "fresh", {
                runtimeEpoch: hostEpoch,
                selectedWorkspaceId: "new",
                workspaces: [workspace("new")],
                sessions: [session("fresh", "new")],
              }),
            };
      }
      if (e.runtimeEpoch !== hostEpoch)
        return { ok: false, code: "STALE_EPOCH", message: "epoch changed" };
      return {
        ok: true,
        value: snapshot(20, e.operation.sessionId ?? "a", {
          runtimeEpoch: hostEpoch,
        }),
      };
    }
    if (e.operation.type === "session.pin") {
      seenMutation = e;
      return {
        ok: true,
        value: snapshot(10),
        receipt: receipt(e, {
          result: { kind: "metadata", workspaceId: "w", sessionId: "a" },
        }),
      };
    }
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  assert.equal(await api.actions.mutate(send()), false);
  assert.equal(h.calls.length, 0);
  api.start();
  await flush();
  assert.equal(h.calls[0].runtimeEpoch, undefined);
  assert.ok(h.calls[0].readId);
  assert.equal(await api.actions.mutate(send()), false);
  boot.resolve({ ok: true, value: snapshot() });
  await flush();
  await api.actions.mutate({
    type: "session.pin",
    workspaceId: "w",
    sessionId: "a",
    requestId: "pin",
    pinned: true,
  });
  assert.equal(seenMutation.runtimeEpoch, "epoch-a");
  assert.ok(seenMutation.operationId);
  assert.equal(seenMutation.readId, undefined);
  hostEpoch = "epoch-b";
  await flush();
  await clock.advance(1200);
  assert.equal(api.store.getState().epoch, "epoch-b");
  assert.equal(api.store.getState().selection.workspaceId, "new");
  assert.equal(api.store.getState().selection.sessionId, "fresh");
  const reboot = h.calls
    .filter((e) => e.operation.type === "snapshot" && !e.runtimeEpoch)
    .at(-1);
  assert.deepEqual(reboot.operation, { type: "snapshot" });
  api.dispose();
});
test("confirmed workspace removal clears only its workspace drafts and chooses a valid remaining target", async () => {
  const clock = fakeClock(),
    response = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "workspace.remove"
      ? response.promise
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(
    api.store,
    snapshot(1, "a", {
      workspaces: [workspace(), workspace("other")],
      sessions: [session("a"), session("b"), session("c", "other")],
    }),
  );
  api.actions.draft("a");
  api.actions.draft("b", selectionKey("w", "b"));
  api.actions.draft("keep", selectionKey("other", "c"));
  const done = api.actions.mutate({
    type: "workspace.remove",
    workspaceId: "w",
  });
  await flush();
  api.actions.select("other", "c");
  api.actions.select("w", "a");
  const envelope = h.calls.find((e) => e.operation.type === "workspace.remove");
  response.resolve({
    ok: true,
    value: snapshot(5),
    receipt: receipt(envelope, {
      result: {
        kind: "removed",
        workspaceId: "w",
        removedSessionIds: ["a", "b"],
        workspaceRemoved: true,
      },
    }),
  });
  await done;
  assert.deepEqual(Object.keys(api.store.getState().drafts), [
    selectionKey("other", "c"),
  ]);
  assert.deepEqual(
    [
      api.store.getState().selection.workspaceId,
      api.store.getState().selection.sessionId,
    ],
    ["other", "c"],
  );
  api.dispose();
});
test("lookup-confirmed create navigates by evidence ID, never re-dispatches intent, and refreshes separately", async () => {
  const clock = fakeClock();
  let submitted;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "session.create") {
      submitted = e;
      return { ok: false, code: "UNKNOWN_OUTCOME", message: "unknown" };
    }
    if (e.operation.type === "operation.lookup")
      return {
        ok: true,
        value: {
          status: "found",
          runtimeEpoch: submitted.runtimeEpoch,
          operationId: submitted.operationId,
          receipt: receipt(submitted, {
            result: {
              kind: "created",
              workspaceId: "w",
              sessionId: "created",
              nativeSessionId: "native-created",
            },
          }),
        },
      };
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  await api.actions.mutate({ type: "session.create", workspaceId: "w" }, true);
  await flush();
  assert.equal(api.store.getState().selection.sessionId, "created");
  assert.equal(
    h.calls.filter((e) => e.operation.type === "session.create").length,
    1,
  );
  assert.ok(
    h.calls.some(
      (e) =>
        e.operation.type === "snapshot" && e.operation.sessionId === "created",
    ),
  );
  api.dispose();
});
test("late file response after real controller A-B-A selection is dropped and a fresh read replaces it", async () => {
  const clock = fakeClock(),
    old = deferred();
  let first = true;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "file.list")
      return {
        ok: true,
        value: {
          path: "",
          entries: [
            { name: "a", path: "a", type: "file" },
            { name: "b", path: "b", type: "file" },
          ],
        },
      };
    if (e.operation.type === "file.read") {
      if (first) {
        first = false;
        return old.promise;
      }
      return {
        ok: true,
        value: {
          path: e.operation.path,
          content: `fresh-${e.operation.path}`,
          truncated: false,
        },
      };
    }
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.start();
  await flush();
  api.actions.openFiles("a", "file");
  await flush();
  api.actions.openFiles("b", "file");
  api.actions.openFiles("a", "file");
  await flush();
  old.resolve({
    ok: true,
    value: { path: "a", content: "obsolete-a", truncated: false },
  });
  await flush();
  assert.notEqual(api.store.getState().files.preview?.content, "obsolete-a");
  await clock.advance(5000);
  assert.equal(api.store.getState().files.preview.content, "fresh-a");
  api.dispose();
  assert.equal(clock.timers.size, 0);
});
test("disconnect stops visible file timer and aborts pending preview; reconnect/refocus resumes one visible read", async () => {
  const clock = fakeClock(),
    old = deferred();
  let fileReads = 0;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "file.list")
      return { ok: true, value: { path: "", entries: [] } };
    if (e.operation.type === "file.read") {
      fileReads++;
      return fileReads === 1
        ? old.promise
        : {
            ok: true,
            value: {
              path: e.operation.path,
              content: "fresh",
              truncated: false,
            },
          };
    }
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.start();
  await flush();
  api.actions.openFiles("a", "file");
  await flush();
  api.store.dispatch({
    type: "snapshot",
    scope: scopeOf(api.store.getState()),
    value: snapshot(30, "a", { state: "disconnected" }),
  });
  await flush();
  old.resolve({
    ok: true,
    value: { path: "a", content: "obsolete", truncated: false },
  });
  await flush();
  assert.equal(api.store.getState().files.preview, null);
  assert.equal(api.store.getState().files.busy, false);
  const count = fileReads;
  await clock.advance(6000);
  assert.equal(fileReads, count);
  api.store.dispatch({
    type: "snapshot",
    scope: scopeOf(api.store.getState()),
    value: snapshot(31),
  });
  await flush();
  assert.equal(api.store.getState().files.preview.content, "fresh");
  api.dispose();
  assert.equal(clock.timers.size, 0);
});

test("a delayed composer submission retains its original text without overwriting a newer pre-admission draft", async () => {
  const clock = fakeClock(),
    pending = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "message.send" ? pending.promise : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.actions.draft("newer pre-admission edit");
  const done = api.actions.mutate(send(), false, "original");
  await flush();
  assert.equal(
    selectors.draft(api.store.getState()).text,
    "newer pre-admission edit",
  );
  const envelope = h.calls.find((e) => e.operation.type === "message.send");
  pending.resolve({
    ok: true,
    value: { status: "accepted" },
    receipt: receipt(envelope),
  });
  await done;
  assert.equal(
    selectors.draft(api.store.getState()).text,
    "newer pre-admission edit",
  );
  assert.equal(
    api.store.getState().operations[
      operationKey(envelope.runtimeEpoch, envelope.operationId)
    ].submitted.text,
    "original",
  );
  api.dispose();
});

test("disposal before scheduled mutation dispatch sends no native operation", async () => {
  const clock = fakeClock();
  const h = bridgeHarness(() => new Promise(() => {}));
  const transport = createTransport(h.bridge, { clock, id });
  const done = transport.mutate(send(), "epoch-a", "once");
  transport.dispose();
  assert.equal((await done).code, "UNKNOWN_OUTCOME");
  await flush();
  assert.equal(h.calls.length, 0);
  assert.equal(clock.timers.size, 0);
});
test("trust revision invalidates catalog and visible file identity; stale catalog cannot repopulate availability", () => {
  const store = createWorkbenchStore();
  seed(store);
  store.dispatch({
    type: "catalog",
    scope: scopeOf(store.getState()),
    value: catalog,
  });
  store.dispatch({ type: "files.open", path: "nested/a.txt", kind: "file" });
  const oldScope = scopeOf(store.getState()),
    oldIdentity = store.getState().files.identity;
  store.dispatch({
    type: "snapshot",
    scope: oldScope,
    value: snapshot(2, "a", { workspaces: [workspace("w", 2)] }),
  });
  assert.equal(store.getState().catalog, null);
  assert.equal(store.getState().files.identity.trustRevision, 2);
  assert.equal(store.getState().files.directory, "nested");
  store.dispatch({ type: "catalog", scope: oldScope, value: catalog });
  store.dispatch({
    type: "files.read",
    identity: oldIdentity,
    value: { path: "nested/a.txt", content: "old-trust", truncated: false },
  });
  assert.equal(store.getState().catalog, null);
  assert.equal(store.getState().files.preview, null);
});

function interruptIntent(store, id = "interrupt", extra = {}) {
  const state = store.getState();
  const intent = {
    id,
    epoch: state.epoch,
    operation: {
      type: "session.interrupt",
      workspaceId: state.selection.workspaceId,
      sessionId: state.selection.sessionId,
    },
    origin: state.selection,
    key: selectionKey(state.selection.workspaceId, state.selection.sessionId),
    navigate: false,
    status: "pending",
    ...extra,
  };
  store.dispatch({ type: "intent", intent });
  return intent;
}
function interruptReceipt(intent, revision = 2) {
  return receipt(
    {
      runtimeEpoch: intent.epoch,
      operationId: intent.id,
      operation: intent.operation,
    },
    {
      revision,
      effect: "pending",
      result: { kind: "delivery", status: "stopping" },
    },
  );
}
function acceptInterrupt(store, intent, revision = 2) {
  const value = interruptReceipt(intent, revision);
  store.dispatch({ type: "receipt", id: intent.id, receipt: value });
  return value;
}
function observeSession(
  store,
  revision,
  status,
  scope = scopeOf(store.getState()),
  extra = {},
) {
  store.dispatch({
    type: "snapshot",
    scope,
    value: snapshot(revision, "a", {
      sessions: [session("a", "w", { status }), session("b")],
      ...extra,
    }),
  });
}
async function controllerInterruptFixture() {
  const clock = fakeClock(),
    response = deferred();
  const running = snapshot(1, "a", {
    sessions: [session("a", "w", { status: "running" }), session("b")],
  });
  const h = bridgeHarness((e) => {
    if (e.operation.type === "message.send")
      return {
        ok: false,
        code: "UNKNOWN_OUTCOME",
        message: "unknown",
        receipt: receipt(e, {
          delivery: "unknown",
          effect: "unknown",
          evidence: [],
          result: { kind: "delivery", status: "unknown" },
        }),
      };
    if (e.operation.type === "session.interrupt") return response.promise;
    if (e.operation.type === "snapshot") return { ok: true, value: running };
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store, running);
  api.actions.draft("original");
  assert.equal(await api.actions.mutate(send(), false, "original"), false);
  await flush();
  api.actions.draft("latest");
  const original = Object.values(api.store.getState().operations)[0];
  assert.equal(original.status, "unknown");
  assert.equal(original.receipt.effect, "unknown");
  return {
    api,
    h,
    clock,
    response,
    original,
    operation: { type: "session.interrupt", workspaceId: "w", sessionId: "a" },
  };
}
test("controller admits one current connected running safety interrupt over original unknown, preserving receipt and draft", async () => {
  const { api, h, clock, response, original, operation } =
    await controllerInterruptFixture();
  const draft = selectors.draft(api.store.getState());
  try {
    for (const blocked of [
      send(),
      {
        ...operation,
        type: "command.run",
        requestId: "command",
        name: "help",
        arguments: "",
      },
      {
        ...operation,
        type: "session.rename",
        requestId: "rename",
        title: "new",
      },
      { ...operation, type: "session.pin", requestId: "pin", pinned: true },
      {
        ...operation,
        type: "session.archive",
        requestId: "archive",
        archived: true,
      },
      { ...operation, type: "session.fork", requestId: "fork" },
      { ...operation, type: "session.remove", requestId: "remove" },
      {
        ...operation,
        type: "permission.respond",
        requestId: "permission",
        decision: "reject",
      },
    ]) {
      const before = h.calls.length;
      assert.equal(await api.actions.mutate(blocked), false, blocked.type);
      await flush();
      assert.equal(h.calls.length, before, blocked.type);
    }
    const admitted = api.actions.mutate(operation);
    await flush();
    assert.equal(await api.actions.mutate(operation), false);
    const attempts = h.calls.filter(
      (e) => e.operation.type === "session.interrupt",
    );
    assert.equal(attempts.length, 1);
    assert.equal(attempts[0].runtimeEpoch, "epoch-a");
    response.resolve({
      ok: true,
      value: { status: "stopping" },
      receipt: receipt(attempts[0], {
        effect: "pending",
        result: { kind: "delivery", status: "stopping" },
      }),
    });
    assert.equal(await admitted, true);
    await flush();
    assert.equal(
      api.store.getState().operations[
        operationKey(original.epoch, original.id)
      ],
      original,
    );
    assert.equal(selectors.draft(api.store.getState()), draft);
    assert.equal(selectors.unknown(api.store.getState()), true);
    const interrupted =
      api.store.getState().operations[
        operationKey(attempts[0].runtimeEpoch, attempts[0].operationId)
      ];
    assert.equal(interrupted.status, "accepted");
    assert.equal(interrupted.receipt.effect, "pending");
    observeSession(api.store, 3, "idle");
    assert.equal(
      api.store.getState().operations[
        operationKey(original.epoch, original.id)
      ],
      original,
    );
    assert.equal(
      api.store.getState().operations[
        operationKey(interrupted.epoch, interrupted.id)
      ],
      interrupted,
    );
    assert.equal(selectors.draft(api.store.getState()), draft);
    assert.equal(
      h.calls.filter((e) => e.operation.type === "message.send").length,
      1,
    );
  } finally {
    api.dispose();
  }
  assert.equal(clock.timers.size, 0);
});

test("host-held message.send receipt blocks mutations but not session.interrupt", async () => {
  const { api, original, operation } = await controllerInterruptFixture();
  try {
    const state = api.store.getState();
    const held = {
      ...state,
      operations: {
        ...state.operations,
        [operationKey(original.epoch, original.id)]: {
          ...original,
          hostHeld: true,
        },
      },
    };
    assert.equal(resourceMutationDisabled(held, "w"), true);
    assert.equal(mutationDisabled(held, operation), false);
    assert.equal(
      mutationDisabled(held, { ...operation, type: "session.rename" }),
      true,
    );
  } finally {
    api.dispose();
  }
});

for (const unknownHold of [true, false])
  test(`controller safety interrupt waits for current observation at confirmed receipt floor: unknown=${unknownHold}`, async () => {
    const {
      api,
      h,
      clock,
      response,
      original: unknown,
      operation,
    } = await controllerInterruptFixture();
    if (!unknownHold)
      api.store.dispatch({ type: "refused", id: unknown.id, code: "BUSY" });
    const original =
      api.store.getState().operations[operationKey(unknown.epoch, unknown.id)];
    const draft = selectors.draft(api.store.getState());
    const running = api.store.getState().snapshot;
    try {
      const confirmed = interruptIntent(api.store, "confirmed-floor", {
        operation: send(),
      });
      api.store.dispatch({
        type: "receipt",
        id: confirmed.id,
        receipt: receipt(
          {
            runtimeEpoch: confirmed.epoch,
            operationId: confirmed.id,
            operation: confirmed.operation,
          },
          { revision: 20 },
        ),
      });
      assert.equal(
        api.store.getState().operations[
          operationKey(confirmed.epoch, confirmed.id)
        ].status,
        "accepted",
      );
      assert.equal(api.store.getState().revision, 20);
      assert.equal(api.store.getState().snapshot, running);
      assert.equal(running.revision, 1);
      assert.equal(running.sessions[0].status, "running");
      assert.equal(selectors.unknown(api.store.getState()), unknownHold);

      const before = h.calls.length;
      const blocked = api.actions.mutate(operation);
      await flush();
      assert.equal(
        h.calls.length,
        before,
        "stale running observation must not reach transport",
      );
      assert.equal(await blocked, false);
      observeSession(api.store, 19, "running");
      assert.equal(api.store.getState().snapshot, running);
      assert.equal(await api.actions.mutate(operation), false);
      assert.equal(h.calls.length, before);
      assert.equal(
        api.store.getState().operations[
          operationKey(original.epoch, original.id)
        ],
        original,
      );
      assert.equal(selectors.draft(api.store.getState()), draft);

      observeSession(api.store, 20, "running");
      assert.equal(api.store.getState().snapshot.revision, 20);
      const admitted = api.actions.mutate(operation);
      await flush();
      assert.equal(await api.actions.mutate(operation), false);
      const attempts = h.calls.filter(
        (e) => e.operation.type === "session.interrupt",
      );
      assert.equal(attempts.length, 1);
      response.resolve({
        ok: true,
        value: { status: "stopping" },
        receipt: interruptReceipt(
          {
            epoch: attempts[0].runtimeEpoch,
            id: attempts[0].operationId,
            operation: attempts[0].operation,
          },
          20,
        ),
      });
      assert.equal(await admitted, true);
      await flush();
      assert.equal(
        api.store.getState().operations[
          operationKey(original.epoch, original.id)
        ],
        original,
      );
      assert.equal(selectors.draft(api.store.getState()), draft);
      assert.equal(selectors.unknown(api.store.getState()), unknownHold);
      assert.equal(
        h.calls.filter((e) => e.operation.type === "session.interrupt").length,
        1,
      );
      assert.equal(
        h.calls.filter((e) => e.operation.type === "message.send").length,
        1,
      );
    } finally {
      api.dispose();
    }
    assert.equal(clock.timers.size, 0);
  });

for (const unknownHold of [true, false])
  for (const denied of [
    "disconnected",
    "unavailable",
    "health",
    "archived",
    "idle",
    "stopping",
    "unknown",
    "missing-workspace",
    "missing-session",
    "wrong-session-workspace",
    "other-workspace",
    "other-session",
    "no-selection",
    "no-current-snapshot",
    "reselected-generation",
    "replaced-epoch",
    "missing-epoch",
    "pending",
    "capacity",
    "disposed",
  ])
    test(`controller safety interrupt makes zero transport attempts: ${denied}, unknown=${unknownHold}`, async () => {
      const {
        api,
        h,
        clock,
        original: unknown,
        operation,
      } = await controllerInterruptFixture();
      if (!unknownHold)
        api.store.dispatch({ type: "refused", id: unknown.id, code: "BUSY" });
      const original =
        api.store.getState().operations[
          operationKey(unknown.epoch, unknown.id)
        ];
      try {
        const scope = scopeOf(api.store.getState());
        if (["disconnected", "unavailable"].includes(denied))
          seed(
            api.store,
            snapshot(2, "a", {
              state: denied,
              sessions: [session("a", "w", { status: "running" })],
            }),
          );
        else if (denied === "health")
          api.store.dispatch({ type: "health", scope, code: "UNAVAILABLE" });
        else if (["archived", "idle", "stopping", "unknown"].includes(denied))
          observeSession(
            api.store,
            2,
            denied === "archived" ? "running" : denied,
            scope,
            denied === "archived"
              ? {
                  sessions: [
                    session("a", "w", { status: "running", archived: true }),
                  ],
                }
              : {},
          );
        else if (
          [
            "missing-workspace",
            "missing-session",
            "wrong-session-workspace",
          ].includes(denied)
        ) {
          if (denied === "missing-workspace") {
            api.actions.select();
            seed(
              api.store,
              snapshot(2, undefined, {
                workspaces: [],
                sessions: [],
                selectedWorkspaceId: undefined,
                selectedSessionId: undefined,
              }),
            );
          } else if (denied === "missing-session") {
            api.actions.select("w");
            seed(
              api.store,
              snapshot(2, undefined, {
                sessions: [],
                selectedSessionId: undefined,
              }),
            );
          } else {
            api.actions.select("other", "a");
            seed(
              api.store,
              snapshot(2, "a", {
                selectedWorkspaceId: "other",
                workspaces: [workspace("other")],
                sessions: [session("a", "other", { status: "running" })],
              }),
            );
          }
        } else if (denied === "other-workspace")
          operation.workspaceId = "other";
        else if (denied === "other-session") operation.sessionId = "b";
        else if (denied === "no-selection") api.actions.select();
        else if (denied === "no-current-snapshot") api.actions.select("w", "b");
        else if (denied === "reselected-generation") {
          api.actions.select("w", "b");
          api.actions.select("w", "a");
          api.store.dispatch({
            type: "snapshot",
            scope,
            value: snapshot(5, "a", {
              sessions: [session("a", "w", { status: "running" })],
            }),
          });
        } else if (denied === "replaced-epoch") {
          api.store.dispatch({
            type: "snapshot",
            scope: { ...scope, bootstrap: true },
            value: snapshot(1, "b", { runtimeEpoch: "epoch-b" }),
          });
          api.store.dispatch({
            type: "snapshot",
            scope,
            value: snapshot(5, "a", {
              sessions: [session("a", "w", { status: "running" })],
            }),
          });
        } else if (denied === "missing-epoch" || denied === "disposed")
          api.dispose();
        else if (denied === "pending")
          interruptIntent(api.store, "global-pending", {
            key: selectionKey("other", "other"),
          });
        else if (denied === "capacity") {
          for (let i = 1; i < 2048; i++) {
            interruptIntent(api.store, `full-${i}`);
            api.store.dispatch({
              type: "refused",
              id: `full-${i}`,
              code: "BUSY",
            });
          }
        }
        let targetApi = api;
        if (denied === "missing-epoch")
          targetApi = createWindowWorkbench(h.bridge, { clock, id });
        const before = h.calls.length;
        try {
          const result = targetApi.actions.mutate(operation);
          await flush();
          assert.equal(h.calls.length, before);
          assert.equal(await result, false);
          assert.equal(
            api.store.getState().operations[
              operationKey(original.epoch, original.id)
            ],
            original,
          );
          assert.equal(
            api.store.getState().drafts[selectionKey("w", "a")].text,
            "latest",
          );
        } finally {
          if (targetApi !== api) targetApi.dispose();
        }
      } finally {
        api.dispose();
      }
      assert.equal(clock.timers.size, 0);
    });

test("interrupt wait survives running/stopping but fresh idle retires display only, preserving pending effect and unknown send hold", () => {
  const store = createWorkbenchStore();
  seed(store);
  store.dispatch({
    type: "draft",
    key: selectionKey("w", "a"),
    text: "latest edit",
  });
  const hold = interruptIntent(store, "unknown-send", { operation: send() });
  store.dispatch({ type: "unknown", id: hold.id });
  const intent = interruptIntent(store);
  const evidence = acceptInterrupt(store, intent);
  const operations = store.getState().operations;
  const drafts = store.getState().drafts;
  const notice = store.getState().notice;
  assert.match(notice, /중단을 요청/);
  for (const [revision, status] of [
    [3, "running"],
    [4, "stopping"],
    [5, "unknown"],
  ]) {
    observeSession(store, revision, status);
    assert.equal(store.getState().notice, notice);
  }
  observeSession(store, 6, "idle");
  assert.equal(store.getState().notice, "");
  assert.equal(store.getState().interruptNotice, null);
  assert.equal(store.getState().operations, operations);
  assert.equal(
    store.getState().operations[operationKey(intent.epoch, intent.id)].receipt,
    evidence,
  );
  assert.equal(evidence.effect, "pending");
  assert.equal(
    store.getState().operations[operationKey(hold.epoch, hold.id)].status,
    "unknown",
  );
  assert.equal(selectors.unknown(store.getState()), true);
  assert.equal(store.getState().drafts, drafts);
});
test("interrupt notice requires a newer accepted current read; stale revision, generation, epoch, target and health cannot retire it", () => {
  const store = createWorkbenchStore();
  seed(store);
  const staleRead = scopeOf(store.getState());
  const intent = interruptIntent(store);
  acceptInterrupt(store, intent, 4);
  observeSession(store, 2, "running");
  const notice = store.getState().notice;
  for (const revision of [2, 3]) {
    observeSession(store, revision, "idle");
    assert.equal(store.getState().notice, notice);
    assert.equal(store.getState().revision, revision);
  }
  observeSession(store, 8, "idle", staleRead);
  assert.equal(store.getState().notice, notice);
  const current = store.getState(),
    scope = scopeOf(current);
  for (const invalidScope of [
    { ...scope, generation: scope.generation - 1 },
    { ...scope, epoch: "old" },
    { ...scope, sessionId: "b" },
    { ...scope, workspaceId: "other" },
  ]) {
    observeSession(store, 20, "idle", invalidScope);
    assert.equal(store.getState(), current);
  }
  observeSession(store, 20, "idle", scope, { selectedSessionId: "b" });
  observeSession(store, 20, "idle", scope, { runtimeEpoch: "old" });
  assert.equal(store.getState(), current);
  store.dispatch({ type: "health", scope, code: "READ_TIMEOUT" });
  assert.equal(store.getState().notice, notice);
  observeSession(store, 21, "idle", scopeOf(store.getState()), {
    state: "disconnected",
  });
  assert.equal(store.getState().notice, notice);
  observeSession(store, 22, "idle", scopeOf(store.getState()), {
    sessions: [session("b")],
  });
  assert.equal(store.getState().notice, notice);
  observeSession(store, 23, "idle");
  assert.equal(store.getState().notice, "");
});
test("late other-session, A-B-A generation and retired-epoch receipts retain evidence without replacing the current notice", () => {
  for (const move of ["session", "generation", "epoch"]) {
    const store = createWorkbenchStore();
    seed(store);
    const old = interruptIntent(store, "old");
    store.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
    if (move !== "session")
      store.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
    seed(store, snapshot(2, store.getState().selection.sessionId));
    if (move === "epoch") {
      store.dispatch({
        type: "snapshot",
        scope: { ...scopeOf(store.getState()), bootstrap: true },
        value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
      });
    }
    const current = interruptIntent(store, "current");
    store.dispatch({ type: "unknown", id: current.id });
    const notice = store.getState().notice;
    const identity = store.getState().interruptNotice;
    const evidence = acceptInterrupt(store, old, 4);
    assert.equal(
      store.getState().operations[operationKey(old.epoch, old.id)].receipt,
      evidence,
    );
    assert.equal(store.getState().notice, notice);
    assert.equal(store.getState().interruptNotice, identity);
  }
});
test("late interrupt ACK cannot recreate a wait notice after newer current idle observation", () => {
  const store = createWorkbenchStore();
  seed(store);
  const intent = interruptIntent(store);
  observeSession(store, 5, "idle");
  const evidence = acceptInterrupt(store, intent, 2);
  assert.equal(store.getState().notice, "");
  assert.equal(
    store.getState().operations[operationKey(intent.epoch, intent.id)].receipt,
    evidence,
  );
  assert.equal(evidence.effect, "pending");
});

test("late unknown and accepted receipts cannot replace another scope's explicit interrupt notice", () => {
  const store = createWorkbenchStore();
  seed(store);
  const old = interruptIntent(store, "old");
  store.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
  seed(store, snapshot(2, "b"));
  const current = interruptIntent(store, "current");
  acceptInterrupt(store, current, 3);
  const identity = store.getState().interruptNotice;
  const notice = store.getState().notice;
  assert.equal(identity.operationId, current.id);
  store.dispatch({ type: "unknown", id: old.id });
  assert.equal(
    store.getState().operations[operationKey(old.epoch, old.id)].status,
    "unknown",
  );
  assert.equal(store.getState().interruptNotice, identity);
  assert.equal(store.getState().notice, notice);
  acceptInterrupt(store, old, 4);
  assert.equal(store.getState().interruptNotice, identity);
  assert.equal(store.getState().notice, notice);
  store.dispatch({
    type: "snapshot",
    scope: scopeOf(store.getState()),
    value: snapshot(5, "b"),
  });
  assert.equal(store.getState().notice, "");
  assert.equal(
    store.getState().operations[operationKey(current.epoch, current.id)].receipt
      .effect,
    "pending",
  );
});
test("fresh idle cannot clear an unknown notice or resolve an unknown mutation", () => {
  const store = createWorkbenchStore();
  seed(store);
  const intent = interruptIntent(store, "unknown-send", { operation: send() });
  store.dispatch({ type: "unknown", id: intent.id });
  const operations = store.getState().operations;
  const notice = store.getState().notice;
  observeSession(store, 30, "idle");
  assert.equal(store.getState().notice, notice);
  assert.equal(store.getState().operations, operations);
  assert.equal(selectors.unknown(store.getState()), true);
});

for (const oldEpoch of [false, true])
  test(`confirmed deletion rejects deferred same-B pre-deletion snapshot only in its current epoch: old=${oldEpoch}`, async () => {
    const store = createWorkbenchStore();
    seed(store);
    const intent = interruptIntent(store, "remove-a", {
      operation: {
        type: "session.remove",
        workspaceId: "w",
        sessionId: "a",
        requestId: "remove",
      },
    });
    store.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
    seed(store, snapshot(1, "b"));
    if (oldEpoch)
      store.dispatch({
        type: "snapshot",
        scope: { ...scopeOf(store.getState()), bootstrap: true },
        value: snapshot(1, "b", { runtimeEpoch: "epoch-b" }),
      });
    store.dispatch({
      type: "draft",
      key: selectionKey("w", "b"),
      text: "latest B draft",
    });
    const scope = scopeOf(store.getState()),
      selection = store.getState().selection;
    const pending = deferred();
    const read = pending.promise.then((value) =>
      store.dispatch({ type: "snapshot", scope, value }),
    );
    const observations = [];
    const unsubscribe = store.subscribe((s) => observations.push(s));
    store.dispatch({
      type: "receipt",
      id: intent.id,
      receipt: receipt(
        {
          runtimeEpoch: intent.epoch,
          operationId: intent.id,
          operation: intent.operation,
        },
        {
          revision: 10,
          result: {
            kind: "removed",
            workspaceId: "w",
            workspaceRemoved: false,
            removedSessionIds: ["a"],
          },
        },
      ),
    });
    assert.equal(store.getState().revision, oldEpoch ? 1 : 10);
    assert.equal(observations.length, 1);
    assert.equal(
      observations[0].lists.sessions.some((s) => s.id === "a"),
      false,
    );
    pending.resolve(
      snapshot(9, "b", {
        runtimeEpoch: oldEpoch ? "epoch-b" : "epoch-a",
        state: "disconnected",
      }),
    );
    await read;
    assert.equal(
      store.getState().lists.sessions.some((s) => s.id === "a"),
      oldEpoch,
    );
    assert.equal(
      store.getState().connection,
      oldEpoch ? "disconnected" : "connected",
    );
    assert.equal(store.getState().selection, selection);
    assert.equal(selectors.draft(store.getState()).text, "latest B draft");
    unsubscribe();
  });

const diagnostics = (label) => ({
  startedAt: 0,
  observedOperations: 1,
  errors: 0,
  unknownOutcomes: 0,
  droppedEvents: 0,
  events: [
    {
      id: label,
      operation: "message.send",
      status: "ok",
      workspaceId: "w",
      sessionId: label === "all" ? "b" : "a",
      timestamp: 0,
      durationMs: 1,
    },
  ],
});
for (const lateError of [false, true])
  test(`diagnostics all-to-filtered detaches old reply and retries READ_BUSY with current filter only: error=${lateError}`, async () => {
    const clock = fakeClock(),
      old = deferred(),
      current = deferred();
    let filteredCalls = 0;
    const h = bridgeHarness((e) => {
      if (e.operation.type !== "diagnostics.list") return readFallback(e);
      if (!e.operation.sessionId) return old.promise;
      filteredCalls++;
      return filteredCalls === 1
        ? { ok: false, code: "READ_BUSY", message: "busy" }
        : current.promise;
    });
    const api = createWindowWorkbench(h.bridge, { clock, id });
    seed(api.store);
    api.actions.openPanel("activity");
    void api.actions.diagnostics(false);
    await flush();
    void api.actions.diagnostics(true);
    await flush();
    assert.equal(api.store.getState().diagnostics, null);
    assert.equal(h.cancellations.length, 1);
    await clock.advance(400);
    assert.equal(
      h.calls.filter((e) => e.operation.type === "diagnostics.list").length,
      1,
      "quarantined old task permits no overlapping work",
    );
    old.resolve(
      lateError
        ? { ok: false, code: "UNAVAILABLE", message: "late" }
        : { ok: true, value: diagnostics("all") },
    );
    await flush();
    assert.equal(api.store.getState().diagnostics, null);
    assert.equal(api.store.getState().diagnosticsError, "");
    assert.equal(api.store.getState().connection, "connected");
    await clock.advance(400);
    assert.equal(filteredCalls, 1);
    assert.equal(api.store.getState().diagnosticsError, "");
    await clock.advance(400);
    assert.equal(filteredCalls, 2);
    for (let i = 0; i < 8; i++) api.actions.refreshDiagnostics();
    await flush();
    assert.equal(filteredCalls, 2, "refresh must not overlap a current read");
    current.resolve({ ok: true, value: diagnostics("filtered") });
    await flush();
    assert.equal(api.store.getState().diagnostics.events[0].id, "filtered");
    assert.equal(api.store.getState().diagnosticsError, "");
    await clock.advance(3000);
    assert.equal(filteredCalls, 3, "controller owns polling");
    api.dispose();
    assert.equal(clock.timers.size, 0);
  });
for (const close of ["panel", "dispose"])
  for (const lateError of [false, true])
    test(`diagnostics ${close} detaches and invalidates late payload/error: error=${lateError}`, async () => {
      const clock = fakeClock(),
        pending = deferred();
      const h = bridgeHarness(() => pending.promise);
      const api = createWindowWorkbench(h.bridge, { clock, id });
      seed(api.store);
      api.actions.openPanel("activity");
      void api.actions.diagnostics(true);
      await flush();
      if (close === "panel") api.actions.closePanel();
      else api.dispose();
      const state = api.store.getState();
      assert.equal(state.diagnosticsIdentity, null);
      await flush();
      assert.equal(h.cancellations.length, 1);
      pending.resolve(
        lateError
          ? { ok: false, code: "UNAVAILABLE", message: "late" }
          : { ok: true, value: diagnostics("late") },
      );
      await flush();
      await clock.advance(4000);
      assert.equal(api.store.getState(), state);
      assert.equal(state.diagnostics, null);
      assert.equal(state.diagnosticsError, "");
      assert.equal(state.connection, "connected");
      assert.equal(h.calls.length, 1);
      assert.equal(clock.timers.size, 0);
      api.dispose();
    });

test("validated confirmed current receipts raise a monotonic floor; invalid, unconfirmed and old-epoch receipts do not", () => {
  const store = createWorkbenchStore();
  seed(store, snapshot(8));
  const intent = interruptIntent(store, "floor");
  const confirmed = receipt(
    {
      runtimeEpoch: intent.epoch,
      operationId: intent.id,
      operation: intent.operation,
    },
    { revision: 20 },
  );
  const original = store.getState();
  for (const value of [
    { ...confirmed, operationId: "wrong" },
    { ...confirmed, runtimeEpoch: "old" },
    { ...confirmed, sessionId: "b" },
  ]) {
    store.dispatch({ type: "receipt", id: intent.id, receipt: value });
    assert.equal(store.getState(), original);
  }
  store.dispatch({
    type: "receipt",
    id: intent.id,
    receipt: { ...confirmed, evidence: [] },
  });
  assert.equal(store.getState().revision, 8);
  store.dispatch({
    type: "receipt",
    id: intent.id,
    receipt: { ...confirmed, effect: "pending" },
  });
  assert.equal(store.getState().revision, 8);
  store.dispatch({ type: "receipt", id: intent.id, receipt: confirmed });
  assert.equal(store.getState().revision, 20);
  const lower = interruptIntent(store, "lower");
  store.dispatch({
    type: "receipt",
    id: lower.id,
    receipt: receipt(
      {
        runtimeEpoch: lower.epoch,
        operationId: lower.id,
        operation: lower.operation,
      },
      { revision: 10 },
    ),
  });
  assert.equal(store.getState().revision, 20);
  seed(store, snapshot(20));
  assert.equal(
    store.getState().snapshot.revision,
    20,
    "same-floor authoritative observation is allowed",
  );
  store.dispatch({
    type: "snapshot",
    scope: { ...scopeOf(store.getState()), bootstrap: true },
    value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
  });
  store.dispatch({
    type: "receipt",
    id: intent.id,
    receipt: { ...confirmed, revision: 100 },
  });
  assert.equal(store.getState().revision, 1);
  seed(store, snapshot(2, "a", { runtimeEpoch: "epoch-b" }));
  assert.equal(store.getState().revision, 2);
});

test("diagnostics filtered-to-all clears old payload/error and rejects prior generation events", async () => {
  const clock = fakeClock(),
    old = deferred();
  const h = bridgeHarness((e) =>
    e.operation.sessionId
      ? old.promise
      : { ok: true, value: diagnostics("all") },
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  api.actions.openPanel("activity");
  api.actions.diagnostics(true);
  await flush();
  const identity = api.store.getState().diagnosticsIdentity;
  api.store.dispatch({ type: "diagnostics", identity, error: "current error" });
  api.actions.diagnostics(false);
  await flush();
  const state = api.store.getState();
  assert.equal(state.diagnostics, null);
  assert.equal(state.diagnosticsError, "");
  api.store.dispatch({
    type: "diagnostics",
    identity,
    value: diagnostics("filtered"),
  });
  api.store.dispatch({ type: "diagnostics", identity, error: "late error" });
  assert.equal(api.store.getState(), state);
  old.resolve({ ok: true, value: diagnostics("filtered") });
  await flush();
  await clock.advance(400);
  assert.equal(api.store.getState().diagnostics.events[0].id, "all");
  assert.equal(api.store.getState().diagnosticsIdentity.filtered, false);
  api.dispose();
  assert.equal(clock.timers.size, 0);
});

for (const move of ["selection", "epoch", "reopen"])
  test(`diagnostics ${move} renews identity and drops old reply/health/error`, async () => {
    const clock = fakeClock(),
      old = deferred();
    let reads = 0;
    const h = bridgeHarness(() =>
      ++reads === 1 ? old.promise : { ok: true, value: diagnostics("current") },
    );
    const api = createWindowWorkbench(h.bridge, { clock, id });
    seed(api.store);
    api.actions.openPanel("activity");
    api.actions.diagnostics(true);
    await flush();
    const identity = api.store.getState().diagnosticsIdentity;
    if (move === "selection") api.actions.select("w", "b");
    else if (move === "epoch")
      api.store.dispatch({
        type: "snapshot",
        scope: { ...scopeOf(api.store.getState()), bootstrap: true },
        value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
      });
    else {
      api.actions.closePanel();
      api.actions.openPanel("activity");
      api.actions.diagnostics(true);
    }
    await flush();
    const state = api.store.getState();
    assert.notEqual(
      state.diagnosticsIdentity.requestGeneration,
      identity.requestGeneration,
    );
    api.store.dispatch({ type: "diagnostics", identity, error: "late error" });
    if (move !== "reopen")
      api.store.dispatch({
        type: "health",
        scope: identity,
        code: "UNAVAILABLE",
      });
    assert.equal(api.store.getState(), state);
    old.resolve({ ok: false, code: "UNAVAILABLE", message: "old error" });
    await flush();
    await clock.advance(400);
    assert.equal(api.store.getState().diagnostics.events[0].id, "current");
    assert.equal(api.store.getState().diagnosticsError, "");
    assert.equal(h.calls.at(-1).runtimeEpoch, state.epoch);
    assert.equal(h.calls.at(-1).operation.sessionId, state.selection.sessionId);
    api.dispose();
    assert.equal(clock.timers.size, 0);
  });

test("v5 same-revision observations update streaming and reject duplicate sequence before recovery or health", () => {
  const store = createWorkbenchStore();
  seed(store, snapshot(8, "a", { observationSequence: 10 }));
  const oldScope = scopeOf(store.getState());
  seed(
    store,
    snapshot(8, "a", {
      observationSequence: 11,
      messages: [{ id: "m", role: "assistant", text: "fresh", tools: [] }],
    }),
  );
  assert.equal(store.getState().snapshot.messages[0].text, "fresh");
  const accepted = store.getState();
  for (const value of [
    snapshot(9, "a", { observationSequence: 11, state: "unavailable" }),
    snapshot(7, "a", { observationSequence: 100, state: "unavailable" }),
  ])
    seed(store, value);
  store.dispatch({ type: "health", scope: oldScope, code: "READ_TIMEOUT" });
  assert.equal(store.getState(), accepted);
});

test("v5 malformed clocks, recovery and retained identities reject the whole observation", () => {
  const store = createWorkbenchStore();
  seed(store);
  const baseline = store.getState();
  const key = {
    authorityHold: true,
    runtimeEpoch: "old",
    operationId: "retained",
    type: "message.send",
    workspaceId: "w",
    sessionId: "a",
  };
  for (const extra of [
    ...[undefined, 0, -1, 1.5, Infinity, NaN, Number.MAX_SAFE_INTEGER + 1].map(
      (observationSequence) => ({ observationSequence }),
    ),
    ...[-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1].map((revision) => ({
      revision,
    })),
    { recovery: undefined },
    {
      recovery: {
        store: { state: "ready", reason: "owner_conflict" },
        resources: [],
      },
    },
    {
      recovery: {
        store: { state: "recovery_required", reason: "invented" },
        resources: [],
      },
    },
    {
      recovery: {
        store: { state: "ready" },
        resources: [
          { workspaceId: "w", state: "unavailable", reason: "invented" },
        ],
      },
    },
    { retainedOperations: undefined },
    { retainedOperations: [key, key] },
    { retainedOperations: [{ ...key, text: "must not hydrate" }] },
    { retainedOperations: [{ ...key, type: "snapshot" }] },
  ]) {
    seed(store, snapshot(2, "a", extra));
    assert.equal(store.getState(), baseline);
  }
});

const retainedKey = (
  runtimeEpoch = "previous",
  operationId = "same",
  extra = {},
) => ({
  authorityHold: true,
  runtimeEpoch,
  operationId,
  type: "message.send",
  workspaceId: "w",
  sessionId: "a",
  ...extra,
});
const recoverySnapshot = (reason, extra = {}) =>
  snapshot(5, "a", {
    state: "unavailable",
    temporary: false,
    workspaces: [{ ...workspace(), temporary: false }],
    recovery: { store: { state: "recovery_required", reason }, resources: [] },
    ...extra,
  });

test("authorityHold true survives confirmed original lookup; fresh false releases authority without replay", async () => {
  const held = retainedKey();
  const h = bridgeHarness(readFallback);
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  try {
    seed(api.store, snapshot(5, "a", { retainedOperations: [held] }));
    const key = operationKey(held.runtimeEpoch, held.operationId);
    api.store.dispatch({
      type: "receipt",
      id: held.operationId,
      receipt: receipt({
        runtimeEpoch: held.runtimeEpoch,
        operationId: held.operationId,
        operation: send(),
      }),
    });
    assert.equal(api.store.getState().operations[key].status, "accepted");
    assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
    assert.equal(
      await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
      false,
    );
    seed(
      api.store,
      snapshot(5, "a", {
        retainedOperations: [{ ...held, authorityHold: false }],
      }),
    );
    assert.equal(resourceMutationDisabled(api.store.getState(), "w"), false);
    assert.equal(api.store.getState().operations[key].lookupOnly, true);
    assert.deepEqual(api.store.getState().operations[key].operation, {
      type: "message.send",
      workspaceId: "w",
      sessionId: "a",
    });
  } finally {
    api.dispose();
  }
});

test("authorityHold false retains unknown original key and permits a new distinct mutation", async () => {
  const held = retainedKey();
  const h = bridgeHarness((e) =>
    e.operation.type === "session.create"
      ? {
          ok: true,
          value: { status: "accepted" },
          receipt: receipt(e, {
            revision: 6,
            result: {
              kind: "metadata",
              workspaceId: "w",
              sessionId: "new-session",
            },
          }),
        }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  try {
    seed(api.store, snapshot(5, "a", { retainedOperations: [held] }));
    const key = operationKey(held.runtimeEpoch, held.operationId);
    assert.equal(
      await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
      false,
    );
    seed(
      api.store,
      snapshot(5, "a", {
        retainedOperations: [{ ...held, authorityHold: false }],
      }),
    );
    const original = api.store.getState().operations[key];
    assert.equal(original.status, "unknown");
    assert.equal(original.lookupOnly, true);
    assert.equal(original.submitted, undefined);
    assert.equal(selectors.unknown(api.store.getState()), false);
    assert.equal(resourceMutationDisabled(api.store.getState(), "w"), false);
    assert.deepEqual(original.operation, {
      type: "message.send",
      workspaceId: "w",
      sessionId: "a",
    });
    assert.equal(
      await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
      true,
    );
    const mutations = h.calls.filter(
      (e) => e.operation.type === "session.create",
    );
    assert.equal(mutations.length, 1);
    assert.notEqual(mutations[0].operationId, held.operationId);
    assert.equal(
      h.calls.some((e) => e.operation.type === "message.send"),
      false,
    );
    seed(api.store, snapshot(6, "a"));
    assert.equal(selectors.unknown(api.store.getState()), false);
    assert.equal(api.store.getState().operations[key].status, "unknown");
  } finally {
    api.dispose();
  }
});

test("authorityHold release rejects malformed rows and stale or future request clocks atomically", () => {
  const store = createWorkbenchStore(),
    held = retainedKey();
  seed(
    store,
    snapshot(5, "a", { observationSequence: 100, retainedOperations: [held] }),
  );
  const before = store.getState(),
    scope = scopeOf(before);
  const { authorityHold, ...missing } = held;
  assert.equal(authorityHold, true);
  for (const malformed of [
    missing,
    ...[undefined, null, 0, "false"].map((authorityHold) => ({
      ...held,
      authorityHold,
    })),
  ]) {
    seed(
      store,
      snapshot(6, "a", {
        observationSequence: 101,
        retainedOperations: [
          { ...held, authorityHold: false },
          { ...malformed, operationId: "bad" },
        ],
      }),
    );
    assert.equal(store.getState(), before);
  }
  for (const [revision, observationSequence] of [
    [4, 101],
    [5, 100],
    [6, 99],
  ]) {
    seed(
      store,
      snapshot(revision, "a", {
        observationSequence,
        retainedOperations: [{ ...held, authorityHold: false }],
      }),
    );
    assert.equal(store.getState(), before);
  }
  for (const revision of [4, 6]) {
    store.dispatch({
      type: "snapshot",
      scope: { ...scope, revision },
      value: snapshot(6, "a", {
        observationSequence: 101,
        retainedOperations: [{ ...held, authorityHold: false }],
      }),
    });
    assert.equal(store.getState(), before);
  }
  seed(
    store,
    snapshot(6, "a", { observationSequence: 101, retainedOperations: [] }),
  );
  assert.equal(
    resourceMutationDisabled(store.getState(), "w"),
    true,
    "absent unknown key cannot release authority",
  );
});

test("authorityHold false does not settle an actual outstanding bridge call", async () => {
  const pending = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "session.pin" ? pending.promise : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  try {
    seed(api.store, snapshot(5));
    const done = api.actions.mutate({
      type: "session.pin",
      workspaceId: "w",
      sessionId: "a",
      requestId: "pin",
      pinned: true,
    });
    await flush();
    const sent = h.calls.find((e) => e.operation.type === "session.pin");
    assert.ok(sent);
    seed(
      api.store,
      snapshot(6, "a", {
        retainedOperations: [
          retainedKey(sent.runtimeEpoch, sent.operationId, {
            type: "session.pin",
            authorityHold: false,
          }),
        ],
      }),
    );
    assert.equal(selectors.pending(api.store.getState()), true);
    const count = h.calls.length;
    assert.equal(
      await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
      false,
    );
    assert.equal(h.calls.length, count);
    pending.resolve({
      ok: true,
      value: { status: "accepted" },
      receipt: receipt(sent, {
        revision: 6,
        result: { kind: "metadata", workspaceId: "w", sessionId: "a" },
      }),
    });
    await done;
    assert.equal(selectors.pending(api.store.getState()), false);
  } finally {
    api.dispose();
  }
});

test("authorityHold explicit release preserves resource scopes and local unknown holds", () => {
  for (const type of [
    "message.send",
    "permission.respond",
    "configuration.save",
    "configuration.instructions.apply",
    "configuration.mcp.register",
    "configuration.skill.save",
    "configuration.agent.save",
    "file.save",
    "git.index.apply",
    "git.commit.apply",
    "git.branch.apply",
    "git.restore.apply",
  ]) {
    const store = createWorkbenchStore();
    const held = retainedKey("previous", "original", {
      type,
      sessionId: undefined,
    });
    delete held.sessionId;
    seed(store, snapshot(5, "a", { retainedOperations: [held] }));
    assert.equal(resourceMutationDisabled(store.getState(), "w"), true, type);
    assert.equal(
      resourceMutationDisabled(store.getState(), "other"),
      false,
      type,
    );
    seed(
      store,
      snapshot(6, "a", {
        retainedOperations: [{ ...held, authorityHold: false }],
      }),
    );
    assert.equal(resourceMutationDisabled(store.getState(), "w"), false, type);
    assert.equal(selectors.unknown(store.getState()), false, type);
    assert.equal(gitReviewHeld(store.getState()), false, type);
    assert.equal(extensionsHeld(store.getState()), false, type);
    seed(store, snapshot(7, "a", { retainedOperations: [held] }));
    assert.equal(resourceMutationDisabled(store.getState(), "w"), true, type);
  }
  const store = createWorkbenchStore();
  seed(store);
  const intent = interruptIntent(store, "local-unknown", { operation: send() });
  store.dispatch({ type: "unknown", id: intent.id });
  seed(store, snapshot(2));
  assert.equal(selectors.unknown(store.getState()), true);
});

test("authorityHold false bootstrap keeps missing original lookups inert and unblocked", async () => {
  const held = retainedKey("previous", "original", { authorityHold: false });
  const clock = fakeClock();
  const h = bridgeHarness((e) =>
    e.operation.type === "snapshot"
      ? { ok: true, value: snapshot(5, "a", { retainedOperations: [held] }) }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  try {
    api.start();
    await flush();
    await clock.advance(5000);
    const original =
      api.store.getState().operations[
        operationKey(held.runtimeEpoch, held.operationId)
      ];
    assert.equal(original.status, "unknown");
    assert.equal(original.lookupOnly, true);
    assert.equal(original.hostHeld, false);
    assert.equal(selectors.unknown(api.store.getState()), false);
    assert.equal(resourceMutationDisabled(api.store.getState(), "w"), false);
    assert.deepEqual(original.operation, {
      type: "message.send",
      workspaceId: "w",
      sessionId: "a",
    });
    assert.ok(h.calls.some((e) => e.operation.type === "operation.lookup"));
    assert.ok(
      h.calls.every((e) =>
        ["snapshot", "catalog.list", "operation.lookup"].includes(
          e.operation.type,
        ),
      ),
    );
  } finally {
    api.dispose();
  }
});

test("v5 metadata unavailable startup reaches connected through bounded reads without refocus or refresh", async () => {
  const clock = fakeClock();
  let reads = 0;
  const h = bridgeHarness((e) =>
    e.operation.type === "snapshot"
      ? {
          ok: true,
          value:
            ++reads < 5
              ? recoverySnapshot("native_startup_unverified")
              : snapshot(5),
        }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  api.start();
  await flush();
  assert.equal(api.store.getState().connection, "unavailable");
  assert.equal(await api.actions.mutate(send()), false);
  await clock.advance(30000);
  assert.equal(api.store.getState().connection, "connected");
  assert.ok(reads >= 5 && reads < 30);
  assert.equal(h.calls[0].runtimeEpoch, undefined);
  assert.ok(h.calls.slice(1).every((e) => e.runtimeEpoch === "epoch-a"));
  assert.ok(
    h.calls.every((e) =>
      ["snapshot", "catalog.list"].includes(e.operation.type),
    ),
  );
  api.dispose();
});

test("v5 metadata startup retry pauses while hidden and disposal drops a late ready read", async () => {
  const clock = fakeClock(),
    pending = deferred();
  let shown = true,
    visibility,
    delayed = false;
  const h = bridgeHarness((e) =>
    e.operation.type === "snapshot"
      ? delayed
        ? pending.promise
        : { ok: true, value: snapshot(5, "a", { state: "unavailable" }) }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, {
    clock,
    id,
    visible: () => shown,
    onVisibility(listener) {
      visibility = listener;
      return () => {
        visibility = undefined;
      };
    },
  });
  api.start();
  await flush();
  assert.ok(clock.timers.size > 0, "unavailable startup schedules a read");
  shown = false;
  visibility();
  const calls = h.calls.length;
  await clock.advance(30000);
  assert.equal(h.calls.length, calls);
  delayed = true;
  shown = true;
  visibility();
  await flush();
  assert.equal(
    h.calls.filter((e) => e.operation.type === "snapshot").at(-1).runtimeEpoch,
    "epoch-a",
  );
  const snapshotReads = h.calls.filter(
    (e) => e.operation.type === "snapshot",
  ).length;
  await clock.advance(5000);
  assert.equal(
    h.calls.filter((e) => e.operation.type === "snapshot").length,
    snapshotReads,
  );
  api.dispose();
  const disposed = api.store.getState();
  pending.resolve({ ok: true, value: snapshot(5) });
  await clock.advance(30000);
  assert.equal(api.store.getState(), disposed);
  assert.equal(clock.timers.size, 0);
  assert.equal(visibility, undefined);
});

test("v5 startup retry rejects stale ready observations and bootstraps a changed epoch without obsolete targets", async () => {
  const clock = fakeClock();
  let stage = "unavailable";
  const h = bridgeHarness((e) => {
    if (e.operation.type !== "snapshot") return readFallback(e);
    if (stage === "new-epoch")
      return e.runtimeEpoch && e.runtimeEpoch !== "epoch-b"
        ? { ok: false, code: "STALE_EPOCH", message: "restarted" }
        : {
            ok: true,
            value: snapshot(0, "fresh", {
              runtimeEpoch: "epoch-b",
              observationSequence: 1,
              selectedWorkspaceId: "new",
              workspaces: [workspace("new")],
              sessions: [session("fresh", "new")],
            }),
          };
    return {
      ok: true,
      value:
        stage === "stale"
          ? snapshot(4)
          : recoverySnapshot("native_startup_unverified"),
    };
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  api.start();
  await flush();
  stage = "stale";
  const calls = h.calls.length;
  await clock.advance(10000);
  assert.ok(h.calls.length > calls);
  assert.equal(api.store.getState().connection, "unavailable");
  assert.equal(api.store.getState().revision, 5);
  assert.equal(await api.actions.mutate(send()), false);
  stage = "new-epoch";
  await clock.advance(5000);
  assert.equal(api.store.getState().epoch, "epoch-b");
  assert.equal(api.store.getState().connection, "connected");
  const bootstrap = h.calls
    .filter((e) => e.operation.type === "snapshot" && !e.runtimeEpoch)
    .at(-1);
  assert.deepEqual(bootstrap.operation, { type: "snapshot" });
  api.dispose();
});

for (const reason of ["owner_conflict", "corrupt_journal", "pending_inbox"])
  test(`v5 bounded startup reads preserve permanent ${reason} recovery and retained unknown holds without replay`, async () => {
    const clock = fakeClock(),
      key = retainedKey();
    let reads = 0;
    const h = bridgeHarness((e) => {
      if (e.operation.type === "snapshot") {
        reads++;
        return {
          ok: true,
          value: recoverySnapshot(reason, { retainedOperations: [key] }),
        };
      }
      assert.ok(
        ["catalog.list", "operation.lookup"].includes(e.operation.type),
      );
      if (e.operation.type === "operation.lookup") {
        assert.equal(e.runtimeEpoch, "epoch-a");
        assert.deepEqual(e.operation, {
          type: "operation.lookup",
          runtimeEpoch: key.runtimeEpoch,
          operationId: key.operationId,
        });
      }
      return readFallback(e);
    });
    const api = createWindowWorkbench(h.bridge, { clock, id });
    api.start();
    await flush();
    await clock.advance(60000);
    assert.ok(reads > 2 && reads < 20);
    assert.equal(api.store.getState().recovery.store.reason, reason);
    assert.equal(
      api.store.getState().operations[
        operationKey(key.runtimeEpoch, key.operationId)
      ].status,
      "unknown",
    );
    assert.equal(selectors.globalMutationDisabled(api.store.getState()), true);
    seed(
      api.store,
      recoverySnapshot(reason, {
        state: "connected",
        retainedOperations: [key],
      }),
    );
    assert.equal(selectors.executionAvailable(api.store.getState()), false);
    const beforeMutations = h.calls.length;
    for (const operation of mutations())
      assert.equal(await api.actions.mutate(operation), false);
    assert.equal(
      h.calls.length,
      beforeMutations,
      "recovery never dispatches or replays a mutation",
    );
    assert.equal(selectors.unknown(api.store.getState()), true);
    api.dispose();
    const calls = h.calls.length;
    await clock.advance(30000);
    assert.equal(h.calls.length, calls);
    assert.equal(clock.timers.size, 0);
  });

const mutations = () => [
  { type: "workspace.import" },
  { type: "workspace.create" },
  { type: "workspace.remove", workspaceId: "w" },
  { type: "session.create", workspaceId: "w" },
  ...[
    "session.rename",
    "session.pin",
    "session.archive",
    "session.fork",
    "session.remove",
  ].map((type) => ({
    type,
    workspaceId: "w",
    sessionId: "a",
    requestId: "metadata",
    ...(type === "session.rename" ? { title: "new" } : {}),
    ...(type === "session.pin" ? { pinned: true } : {}),
    ...(type === "session.archive" ? { archived: true } : {}),
  })),
  { type: "session.interrupt", workspaceId: "w", sessionId: "a" },
  send(),
  {
    type: "command.run",
    workspaceId: "w",
    sessionId: "a",
    requestId: "command",
    name: "test",
    arguments: "",
  },
  {
    type: "permission.respond",
    workspaceId: "w",
    sessionId: "a",
    requestId: "permission",
    decision: "once",
  },
];

for (const reason of [
  "owner_conflict",
  "owner_unverified",
  "corrupt_journal",
  "unsupported_version",
  "identity_conflict",
  "unconfirmed_tail",
  "writer_poisoned",
  "pending_inbox",
  "native_startup_unverified",
  "storage_denied",
  "retained_limit",
])
  test(`v5 global recovery ${reason} blocks every mutation with zero transport attempts but preserves draft/navigation`, async () => {
    const h = bridgeHarness(() =>
      assert.fail("recovery mutation reached bridge"),
    );
    const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
    seed(api.store, recoverySnapshot(reason));
    api.actions.draft("select and copy this draft");
    const drafts = api.store.getState().drafts;
    for (const operation of mutations())
      assert.equal(await api.actions.mutate(operation), false);
    assert.equal(h.calls.length, 0);
    assert.equal(api.store.getState().recovery.store.reason, reason);
    api.actions.select("w", "b");
    api.actions.openPanel("files");
    assert.equal(api.store.getState().selection.sessionId, "b");
    assert.equal(api.store.getState().drafts, drafts);
    assert.equal(selectors.globalMutationDisabled(api.store.getState()), true);
    api.dispose();
  });

test("v5 pristine bootstrap looks up exact original epochs via current envelope without executable payload or permission hydration", async () => {
  const clock = fakeClock();
  let sequence = 20;
  const keys = [
    retainedKey("old-one"),
    retainedKey("old-two", "same", { type: "permission.respond" }),
  ];
  const h = bridgeHarness((e) => {
    if (e.operation.type === "snapshot")
      return {
        ok: true,
        value: recoverySnapshot("pending_inbox", {
          runtimeEpoch: "current",
          observationSequence: ++sequence,
          retainedOperations: keys,
        }),
      };
    assert.equal(e.operation.type, "operation.lookup");
    assert.equal(e.runtimeEpoch, "current");
    return {
      ok: true,
      value: {
        status: "found",
        runtimeEpoch: e.operation.runtimeEpoch,
        operationId: e.operation.operationId,
        receipt: receipt(
          {
            runtimeEpoch: e.operation.runtimeEpoch,
            operationId: e.operation.operationId,
            operation: keys.find(
              (k) => k.runtimeEpoch === e.operation.runtimeEpoch,
            ),
          },
          { revision: 900 },
        ),
      },
    };
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  api.actions.draft("saved local draft", selectionKey("w", "a"));
  api.start();
  await flush();
  const state = api.store.getState();
  assert.equal(state.epoch, "current");
  assert.equal(
    state.revision,
    5,
    "historical receipt cannot raise current durable floor",
  );
  assert.equal(state.observationSequence, sequence);
  assert.equal(Object.keys(state.operations).length, 2);
  for (const key of keys) {
    const intent =
      state.operations[operationKey(key.runtimeEpoch, key.operationId)];
    assert.equal(intent.lookupOnly, true);
    assert.equal(
      intent.hostHeld,
      true,
      "confirmed lookup alone cannot release host hold",
    );
    assert.deepEqual(Object.keys(intent.operation).sort(), [
      "sessionId",
      "type",
      "workspaceId",
    ]);
    assert.equal(intent.submitted, undefined);
  }
  assert.equal(selectors.draft(state).text, "saved local draft");
  assert.deepEqual(state.snapshot.permissions, []);
  assert.deepEqual(
    h.calls
      .filter((e) => e.operation.type === "operation.lookup")
      .map((e) => e.operation.runtimeEpoch)
      .sort(),
    ["old-one", "old-two"],
  );
  const count = h.calls.length;
  await clock.advance(4999);
  assert.equal(
    h.calls.length,
    count,
    "do not spin on accepted retained receipts",
  );
  await clock.advance(1);
  assert.equal(
    h.calls.filter((e) => e.operation.type === "operation.lookup").length,
    4,
  );
  assert.equal(await api.actions.mutate(send()), false);
  api.dispose();
  assert.equal(clock.timers.size, 0);
});

test("v5 epoch-composite operations isolate duplicate IDs and new-runtime reuse, including ambiguous late status events", async () => {
  const clock = fakeClock(),
    pending = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "session.pin" ? pending.promise : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id: () => "reused" });
  seed(
    api.store,
    snapshot(8, "c", {
      workspaces: [workspace(), workspace("other")],
      selectedWorkspaceId: "other",
      sessions: [session("a"), session("c", "other")],
      retainedOperations: [
        retainedKey("old-one", "reused"),
        retainedKey("old-two", "reused"),
      ],
    }),
  );
  const done = api.actions.mutate({
    type: "session.pin",
    workspaceId: "other",
    sessionId: "c",
    requestId: "pin",
    pinned: true,
  });
  await flush();
  assert.equal(Object.keys(api.store.getState().operations).length, 3);
  const before = api.store.getState();
  api.store.dispatch({ type: "unknown", id: "reused" });
  api.store.dispatch({ type: "refused", id: "reused", code: "BUSY" });
  assert.equal(
    api.store.getState(),
    before,
    "ambiguous bare IDs cannot select an epoch",
  );
  const old = before.operations[operationKey("old-one", "reused")];
  api.store.dispatch({
    type: "receipt",
    id: "reused",
    receipt: receipt(
      { runtimeEpoch: "old-two", operationId: "reused", operation: send() },
      { revision: 900 },
    ),
  });
  assert.equal(
    api.store.getState().operations[operationKey("old-one", "reused")],
    old,
  );
  assert.equal(
    api.store.getState().operations[operationKey("old-two", "reused")].status,
    "accepted",
  );
  assert.equal(
    api.store.getState().operations[operationKey("epoch-a", "reused")].status,
    "pending",
  );
  assert.equal(api.store.getState().revision, 8);
  const envelope = h.calls.find((e) => e.operation.type === "session.pin");
  pending.resolve({
    ok: true,
    value: { status: "accepted" },
    receipt: receipt(envelope, {
      revision: 9,
      result: { kind: "metadata", workspaceId: "other", sessionId: "c" },
    }),
  });
  assert.equal(await done, true);
  assert.equal(
    api.store.getState().operations[operationKey("epoch-a", "reused")].status,
    "accepted",
  );
  api.dispose();
});

test("v5 ready/idle and missing lookup or omitted retained key never resolve an unknown original request", async () => {
  const clock = fakeClock();
  let sequence = 40;
  const key = retainedKey();
  const h = bridgeHarness((e) =>
    e.operation.type === "snapshot"
      ? {
          ok: true,
          value: snapshot(8, "a", {
            observationSequence: ++sequence,
            retainedOperations: [key],
          }),
        }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  api.start();
  await flush();
  assert.equal(
    api.store.getState().operations[operationKey("previous", "same")].status,
    "unknown",
  );
  await clock.advance(5000);
  assert.equal(await api.actions.mutate(send()), false);
  assert.equal(
    await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
    false,
  );
  seed(
    api.store,
    snapshot(8, "a", {
      observationSequence: ++sequence,
      retainedOperations: [],
    }),
  );
  assert.equal(selectors.unknown(api.store.getState()), true);
  assert.equal(
    resourceMutationDisabled(api.store.getState(), "w"),
    true,
    "absent keys do not prove no effect",
  );
  assert.equal(
    await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
    false,
  );
  assert.equal(
    h.calls.every((e) =>
      ["snapshot", "catalog.list", "operation.lookup"].includes(
        e.operation.type,
      ),
    ),
    true,
  );
  api.dispose();
});

for (const reason of [
  "path_missing",
  "path_denied",
  "path_conflict",
  "native_mapping_unverified",
  "partial_native_mapping",
  "unresolved_operation",
])
  test(`v5 resource ${reason} blocks all touched/shared-workspace mutations and allows unrelated ready resources`, async () => {
    const h = bridgeHarness((e) =>
      e.operation.type === "session.pin"
        ? {
            ok: true,
            value: { status: "accepted" },
            receipt: receipt(e, {
              revision: 9,
              result: {
                kind: "metadata",
                workspaceId: "other",
                sessionId: "c",
              },
            }),
          }
        : readFallback(e),
    );
    const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
    seed(
      api.store,
      snapshot(8, "a", {
        temporary: false,
        workspaces: [workspace(), workspace("other")],
        sessions: [
          session("a", "w", { status: "unavailable" }),
          session("b"),
          session("c", "other"),
        ],
        recovery: {
          store: { state: "ready" },
          resources: [
            { workspaceId: "w", sessionId: "a", state: "unavailable", reason },
          ],
        },
      }),
    );
    assert.equal(selectors.executionAvailable(api.store.getState()), false);
    for (const operation of mutations().filter((o) => o.workspaceId === "w"))
      assert.equal(await api.actions.mutate(operation), false);
    assert.equal(
      await api.actions.mutate({
        type: "session.pin",
        workspaceId: "w",
        sessionId: "b",
        requestId: "sibling",
        pinned: true,
      }),
      false,
    );
    assert.equal(h.calls.length, 0);
    assert.equal(
      mutationDisabled(api.store.getState(), {
        type: "session.create",
        workspaceId: "other",
      }),
      false,
    );
    assert.equal(
      mutationDisabled(api.store.getState(), { type: "workspace.import" }),
      false,
    );
    assert.equal(
      await api.actions.mutate({
        type: "session.pin",
        workspaceId: "other",
        sessionId: "c",
        requestId: "other-pin",
        pinned: true,
      }),
      true,
    );
    assert.equal(
      h.calls.filter((e) => e.operation.type === "session.pin").length,
      1,
    );
    api.dispose();
  });

test("v5 lower revision, duplicate observation and retained identity conflicts cannot clear recovery atomically", () => {
  const store = createWorkbenchStore();
  seed(
    store,
    recoverySnapshot("unconfirmed_tail", {
      observationSequence: 40,
      retainedOperations: [retainedKey()],
    }),
  );
  const state = store.getState();
  for (const next of [
    snapshot(4, "a", { observationSequence: 99 }),
    snapshot(6, "a", { observationSequence: 40 }),
    snapshot(5, "a", { observationSequence: 39 }),
    snapshot(5, "a", {
      observationSequence: 41,
      retainedOperations: [
        retainedKey("previous", "same", { type: "permission.respond" }),
      ],
    }),
  ])
    seed(store, next);
  assert.equal(store.getState(), state);
  store.dispatch({
    type: "health",
    scope: { ...scopeOf(state), observationSequence: 39 },
    code: "UNAVAILABLE",
  });
  assert.equal(store.getState(), state);
  assert.equal(selectors.globalMutationDisabled(state), true);
});

test("v5 oversized and malformed retained scopes fail closed without partial hydration", () => {
  const store = createWorkbenchStore();
  const state = store.getState();
  for (const retainedOperations of [
    Array.from({ length: 2049 }, (_, n) => retainedKey("old", `key-${n}`)),
    [retainedKey("bad/epoch")],
    [retainedKey("old", "bad/id")],
    [retainedKey("old", "k", { workspaceId: undefined })],
    [retainedKey("old", "k", { type: "permission.respond", decision: "once" })],
  ])
    seed(store, snapshot(1, "a", { retainedOperations }));
  assert.equal(store.getState(), state);
  assert.equal(selectors.globalMutationDisabled(state), true);
});

test("v5 lookup uses one reserved read and fair bounded 32-key rounds with five-second cadence", async () => {
  const clock = fakeClock();
  let active = 0,
    maxActive = 0;
  const keys = Array.from({ length: 70 }, (_, n) =>
    retainedKey("old", `key-${n}`),
  );
  const h = bridgeHarness(async (e) => {
    if (e.operation.type === "snapshot")
      return {
        ok: true,
        value: recoverySnapshot("pending_inbox", { retainedOperations: keys }),
      };
    assert.equal(e.operation.type, "operation.lookup");
    maxActive = Math.max(maxActive, ++active);
    await Promise.resolve();
    active--;
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  api.start();
  for (let n = 0; n < 10; n++) await flush();
  assert.equal(
    h.calls.filter((e) => e.operation.type === "operation.lookup").length,
    32,
  );
  await clock.advance(4999);
  assert.equal(
    h.calls.filter((e) => e.operation.type === "operation.lookup").length,
    32,
  );
  await clock.advance(1);
  for (let n = 0; n < 10; n++) await flush();
  assert.equal(
    h.calls.filter((e) => e.operation.type === "operation.lookup").length,
    64,
  );
  await clock.advance(5000);
  for (let n = 0; n < 10; n++) await flush();
  assert.equal(
    new Set(
      h.calls
        .filter((e) => e.operation.type === "operation.lookup")
        .map((e) => e.operation.operationId),
    ).size,
    70,
  );
  assert.equal(maxActive, 1);
  api.dispose();
});

for (const payload of ["catalog", "file", "diagnostics"])
  for (const lateError of [false, true])
    test(`v5 slow ${payload} data/error keeps its own identity across several same-revision polls: error=${lateError}`, async () => {
      const pending = deferred(),
        clock = fakeClock();
      const h = bridgeHarness((e) => {
        if (payload === "catalog" && e.operation.type === "catalog.list")
          return pending.promise;
        if (payload === "file" && e.operation.type === "file.list")
          return pending.promise;
        if (
          payload === "diagnostics" &&
          e.operation.type === "diagnostics.list"
        )
          return pending.promise;
        if (e.operation.type === "file.read")
          return {
            ok: true,
            value: {
              path: "readme.txt",
              content: "slow file",
              truncated: false,
            },
          };
        return readFallback(e);
      });
      const api = createWindowWorkbench(h.bridge, { clock, id });
      seed(api.store, snapshot(8));
      if (payload === "catalog") api.actions.refresh();
      else if (payload === "file") api.actions.openFiles("readme.txt", "file");
      else api.actions.diagnostics(true);
      await flush();
      for (let n = 0; n < 4; n++) seed(api.store, snapshot(8));
      const before = api.store.getState();
      pending.resolve(
        lateError
          ? { ok: false, code: "UNAVAILABLE", message: "late" }
          : {
              ok: true,
              value:
                payload === "catalog"
                  ? catalog
                  : payload === "file"
                    ? {
                        path: "",
                        entries: [
                          {
                            name: "readme.txt",
                            path: "readme.txt",
                            type: "file",
                          },
                        ],
                      }
                    : diagnostics("slow"),
            },
      );
      await flush();
      const state = api.store.getState();
      assert.equal(state.connection, "connected");
      assert.equal(state.selection, before.selection);
      assert.equal(state.notice, before.notice);
      if (payload === "catalog")
        assert.equal(
          lateError ? state.catalogError : state.catalog,
          lateError ? "UNAVAILABLE" : catalog,
        );
      else if (payload === "file")
        assert.equal(
          lateError ? state.files.error : state.files.preview.content,
          lateError ? "UNAVAILABLE" : "slow file",
        );
      else
        assert.equal(
          lateError ? state.diagnosticsError : state.diagnostics.events[0].id,
          lateError ? "UNAVAILABLE" : "slow",
        );
      api.dispose();
    });

test("v5 catalog request generation rejects an older response independently of snapshot observation order", () => {
  const store = createWorkbenchStore();
  seed(store);
  store.dispatch({ type: "catalog.check" });
  const old = scopeOf(store.getState());
  store.dispatch({ type: "catalog.check" });
  const current = scopeOf(store.getState());
  for (let n = 0; n < 3; n++) seed(store, snapshot(1));
  const metadata = (path) => ({
    ...catalog,
    configuration: {
      status: "available",
      runtimeStatus: "not_reported",
      entries: [
        {
          id: "config-source",
          kind: "instructions",
          source: "workspace",
          scope: "workspace",
          state: "discovered",
          path,
        },
      ],
    },
  });
  const outdated = metadata("/synthetic/outdated/AGENTS.md");
  const accepted = metadata("/synthetic/current/AGENTS.md");
  store.dispatch({ type: "catalog", scope: old, value: outdated });
  assert.equal(store.getState().catalog, null);
  store.dispatch({ type: "catalog", scope: current, value: accepted });
  store.dispatch({ type: "catalog", scope: old, value: outdated });
  assert.equal(store.getState().catalog, accepted);
  assert.equal(
    store.getState().catalog.configuration.entries[0].path,
    "/synthetic/current/AGENTS.md",
  );
});

test("v5 interrupt ACK needs later current-target idle at the exact durable floor; retiring notice never resolves unknown hold", () => {
  const store = createWorkbenchStore();
  seed(
    store,
    snapshot(8, "a", {
      observationSequence: 100,
      sessions: [session("a", "w", { status: "running" }), session("b")],
    }),
  );
  const hold = interruptIntent(store, "send-hold", { operation: send() });
  store.dispatch({ type: "unknown", id: hold.id });
  const interrupt = interruptIntent(store);
  acceptInterrupt(store, interrupt, 8);
  const notice = store.getState().notice;
  assert.match(notice, /중단을 요청/);
  seed(store, snapshot(8, "a", { observationSequence: 100 }));
  seed(store, snapshot(7, "a", { observationSequence: 999 }));
  assert.equal(store.getState().notice, notice);
  seed(store, snapshot(8, "a", { observationSequence: 101 }));
  assert.equal(store.getState().notice, "");
  assert.equal(
    store.getState().operations[operationKey(hold.epoch, hold.id)].status,
    "unknown",
  );
  assert.equal(
    store.getState().operations[operationKey(interrupt.epoch, interrupt.id)]
      .receipt.effect,
    "pending",
  );
  assert.equal(selectors.unknown(store.getState()), true);
});

test("v5 host-retained running hold still admits interrupt despite a confirmed historical receipt and connected health", async () => {
  const h = bridgeHarness((e) =>
    e.operation.type === "session.interrupt"
      ? {
          ok: true,
          value: { status: "stopping" },
          receipt: receipt(e, {
            effect: "pending",
            result: { kind: "delivery", status: "stopping" },
          }),
        }
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  const key = retainedKey();
  seed(
    api.store,
    snapshot(8, "a", {
      retainedOperations: [key],
      sessions: [session("a", "w", { status: "running" }), session("b")],
    }),
  );
  api.store.dispatch({
    type: "receipt",
    id: key.operationId,
    receipt: receipt(
      {
        runtimeEpoch: key.runtimeEpoch,
        operationId: key.operationId,
        operation: send(),
      },
      { revision: 99 },
    ),
  });
  assert.equal(selectors.pending(api.store.getState()), false);
  assert.equal(selectors.unknown(api.store.getState()), true);
  assert.equal(
    await api.actions.mutate({
      type: "session.interrupt",
      workspaceId: "w",
      sessionId: "a",
    }),
    true,
  );
  assert.equal(
    h.calls.filter((e) => e.operation.type === "session.interrupt").length,
    1,
  );
  api.dispose();
});

test("v5 bootstrap resets observation order only in a new non-retired epoch; original receipts never set either current clock", () => {
  const store = createWorkbenchStore();
  seed(store, snapshot(90, "a", { observationSequence: 900 }));
  const intent = interruptIntent(store, "original");
  const newEpoch = snapshot(0, "a", {
    runtimeEpoch: "epoch-b",
    observationSequence: 1,
  });
  seed(store, newEpoch);
  assert.equal(
    store.getState().epoch,
    "epoch-a",
    "ordinary selected read cannot reset epoch",
  );
  store.dispatch({
    type: "snapshot",
    scope: { ...scopeOf(store.getState()), bootstrap: true },
    value: newEpoch,
  });
  assert.equal(store.getState().revision, 0);
  assert.equal(store.getState().observationSequence, 1);
  store.dispatch({
    type: "receipt",
    id: intent.id,
    receipt: receipt(
      {
        runtimeEpoch: intent.epoch,
        operationId: intent.id,
        operation: intent.operation,
      },
      { revision: 9999 },
    ),
  });
  assert.equal(store.getState().revision, 0);
  assert.equal(store.getState().observationSequence, 1);
});

test("v5 invalid receipt clocks do not raise floor or clear drafts; receipt floor rejects lower revision before newer health/recovery", () => {
  const store = createWorkbenchStore();
  seed(store, snapshot(8, "a", { observationSequence: 100 }));
  store.dispatch({ type: "draft", key: selectionKey("w", "a"), text: "draft" });
  const intent = interruptIntent(store, "floor", { operation: send() });
  const current = store.getState();
  const value = receipt(
    {
      runtimeEpoch: intent.epoch,
      operationId: intent.id,
      operation: intent.operation,
    },
    { revision: 12 },
  );
  for (const revision of [
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    store.dispatch({
      type: "receipt",
      id: intent.id,
      receipt: { ...value, revision },
    });
    assert.equal(store.getState(), current);
  }
  const oldHealth = scopeOf(store.getState());
  store.dispatch({ type: "receipt", id: intent.id, receipt: value });
  const confirmed = store.getState();
  assert.equal(confirmed.revision, 12);
  assert.equal(confirmed.observationSequence, 100);
  seed(
    store,
    recoverySnapshot("writer_poisoned", {
      revision: 11,
      observationSequence: 101,
    }),
  );
  store.dispatch({ type: "health", scope: oldHealth, code: "UNAVAILABLE" });
  assert.equal(store.getState(), confirmed);
  seed(store, snapshot(12, "a", { observationSequence: 101 }));
  assert.equal(store.getState().snapshot.revision, 12);
  assert.equal(selectors.draft(store.getState()).text, "draft");
});

test("v5 retained lookup READ_BUSY retries its exact original key after 400ms with no mutation or skipped identity", async () => {
  const clock = fakeClock();
  let attempts = 0;
  const key = retainedKey();
  const h = bridgeHarness((e) => {
    if (e.operation.type === "snapshot")
      return {
        ok: true,
        value: recoverySnapshot("pending_inbox", { retainedOperations: [key] }),
      };
    assert.equal(e.operation.type, "operation.lookup");
    assert.equal(e.operation.runtimeEpoch, key.runtimeEpoch);
    assert.equal(e.operation.operationId, key.operationId);
    return ++attempts === 1
      ? { ok: false, code: "READ_BUSY", message: "busy" }
      : readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  api.start();
  await flush();
  assert.equal(attempts, 1);
  await clock.advance(399);
  assert.equal(attempts, 1);
  await clock.advance(1);
  assert.equal(attempts, 2);
  assert.equal(
    api.store.getState().operations[
      operationKey(key.runtimeEpoch, key.operationId)
    ].status,
    "unknown",
  );
  api.dispose();
});

test("v5 slow file preview itself survives repeated polling after the listing already completed", async () => {
  const clock = fakeClock(),
    pending = deferred();
  const h = bridgeHarness((e) =>
    e.operation.type === "file.read"
      ? pending.promise
      : {
          ok: true,
          value: {
            path: "",
            entries: [{ name: "readme.txt", path: "readme.txt", type: "file" }],
          },
        },
  );
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store, snapshot(8));
  api.actions.openFiles("readme.txt", "file");
  await flush();
  assert.equal(h.calls.at(-1).operation.type, "file.read");
  const identity = api.store.getState().files.identity;
  for (let n = 0; n < 4; n++) seed(api.store, snapshot(8));
  pending.resolve({
    ok: true,
    value: {
      path: "readme.txt",
      content: "late valid preview",
      truncated: false,
    },
  });
  await flush();
  assert.equal(api.store.getState().files.identity, identity);
  assert.equal(
    api.store.getState().files.preview.content,
    "late valid preview",
  );
  assert.equal(api.store.getState().connection, "connected");
  api.dispose();
});

test("v5 same-revision current idle preceding a late interrupt ACK cannot recreate the notice", () => {
  const store = createWorkbenchStore();
  seed(
    store,
    snapshot(8, "a", {
      observationSequence: 100,
      sessions: [session("a", "w", { status: "running" }), session("b")],
    }),
  );
  const intent = interruptIntent(store);
  seed(store, snapshot(8, "a", { observationSequence: 101 }));
  acceptInterrupt(store, intent, 8);
  assert.equal(store.getState().notice, "");
  assert.equal(store.getState().interruptNotice, null);
  assert.equal(
    store.getState().operations[operationKey(intent.epoch, intent.id)].receipt
      .effect,
    "pending",
  );
});

test("configuration drafts retain panel/workspace/kind isolation without any transport", () => {
  const h = bridgeHarness(readFallback),
    clock = fakeClock(),
    api = createWindowWorkbench(h.bridge, { clock, id });
  seed(
    api.store,
    snapshot(1, "a", {
      workspaces: [workspace(), { ...workspace("other"), path: "/other" }],
    }),
  );
  api.actions.editConfigurationDraft("instructions", "# workspace-w");
  api.actions.validateConfigurationDraft("instructions");
  const first = selectors.configurationDraft("instructions")(
    api.store.getState(),
  );
  assert.equal(first.validation.status, "valid");
  api.actions.baselineConfigurationDraft("instructions");
  api.actions.editConfigurationDraft("mcp", '{"mcp":{"servers":{}}}');
  api.actions.openPanel("catalog");
  api.actions.closePanel();
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "# workspace-w",
  );
  api.actions.select("other");
  api.actions.editConfigurationDraft("instructions", "# workspace-other");
  api.actions.select("w", "b");
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "# workspace-w",
  );
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).baseline,
    "# workspace-w",
  );
  assert.equal(
    selectors.configurationDraft("mcp")(api.store.getState()).text,
    '{"mcp":{"servers":{}}}',
  );
  assert.deepEqual(h.calls, []);
  assert.equal(clock.timers.size, 0);
  assert.deepEqual(createWorkbenchStore().getState().configurationDrafts, {});
  api.dispose();
});

test("configuration validation belongs to current text revision and comparison baseline is not persistence", () => {
  const h = bridgeHarness(readFallback),
    api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(api.store);
  api.actions.editConfigurationDraft("instructions", "first");
  api.actions.validateConfigurationDraft("instructions");
  const valid = selectors.configurationDraft("instructions")(
    api.store.getState(),
  );
  assert.equal(valid.validation.revision, valid.revision);
  api.actions.baselineConfigurationDraft("instructions");
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState())
      .validation.revision,
    valid.revision,
  );
  api.actions.editConfigurationDraft("instructions", "second");
  const edited = selectors.configurationDraft("instructions")(
    api.store.getState(),
  );
  assert.equal(edited.revision, valid.revision + 1);
  assert.equal(edited.validation, null);
  assert.equal(edited.baseline, "first");
  api.actions.discardConfigurationDraft("instructions");
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "",
  );
  assert.deepEqual(h.calls, []);
  api.dispose();
});

test("same workspace id at another registered path never reuses configuration draft", () => {
  const store = createWorkbenchStore();
  seed(store);
  store.dispatch({
    type: "configuration.draft",
    workspaceId: "w",
    path: "/fixture",
    kind: "instructions",
    action: "edit",
    text: "original",
  });
  seed(
    store,
    snapshot(2, "a", {
      workspaces: [{ ...workspace(), path: "/replacement" }],
    }),
  );
  assert.equal(
    selectors.configurationDraft("instructions")(store.getState()).text,
    "",
  );
  const before = store.getState();
  store.dispatch({
    type: "configuration.draft",
    workspaceId: "w",
    path: "/fixture",
    kind: "instructions",
    action: "edit",
    text: "stale",
  });
  assert.equal(store.getState(), before);
  assert.equal(
    before.configurationDrafts[
      configurationDraftKey("w", "/fixture", "instructions")
    ].text,
    "original",
  );
});

test("oversized configuration edit preserves old draft and validation; untrusted recovery allows inert composition", () => {
  const h = bridgeHarness(readFallback),
    api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(
    api.store,
    snapshot(1, null, {
      state: "unavailable",
      sessions: [],
      workspaces: [{ ...workspace(), trusted: false }],
      recovery: {
        store: {
          state: "recovery_required",
          reason: "native_startup_unverified",
        },
        resources: [],
      },
    }),
  );
  api.actions.editConfigurationDraft("instructions", "safe draft");
  api.actions.validateConfigurationDraft("instructions");
  const before = selectors.configurationDraft("instructions")(
    api.store.getState(),
  );
  api.actions.editConfigurationDraft("instructions", "가".repeat(10923));
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()),
    before,
  );
  assert.match(api.store.getState().configurationNotice, /이전 내용을 유지/);
  assert.deepEqual(h.calls, []);
  assert.deepEqual(api.store.getState().operations, {});
  api.dispose();
});

test("configuration capacity never evicts input and selected discard frees exactly its own slot", () => {
  const h = bridgeHarness(readFallback),
    api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  const workspaces = Array.from({ length: 9 }, (_, i) => ({
    ...workspace(`w${i}`),
    path: `/fixture-${i}`,
  }));
  seed(
    api.store,
    snapshot(1, null, { workspaces, sessions: [], selectedWorkspaceId: "w0" }),
  );
  for (let i = 0; i < 8; i++) {
    api.actions.select(`w${i}`);
    for (const kind of ["instructions", "mcp"])
      api.actions.editConfigurationDraft(kind, `${kind}-${i}`);
  }
  const drafts = api.store.getState().configurationDrafts;
  api.actions.select("w8");
  api.actions.editConfigurationDraft("instructions", "blocked-new");
  assert.equal(api.store.getState().configurationDrafts, drafts);
  assert.match(api.store.getState().configurationNotice, /최대 16개/);
  api.actions.select("w0");
  api.actions.discardConfigurationDraft("mcp");
  assert.equal(
    Object.keys(api.store.getState().configurationDrafts).length,
    15,
  );
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "instructions-0",
  );
  api.actions.select("w8");
  api.actions.editConfigurationDraft("instructions", "allowed-new");
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "allowed-new",
  );
  assert.equal(
    Object.keys(api.store.getState().configurationDrafts).length,
    16,
  );
  assert.deepEqual(h.calls, []);
  api.dispose();
});

test("configuration actions on a started window controller do not initiate even a read", async () => {
  const h = bridgeHarness(readFallback),
    clock = fakeClock(),
    api = createWindowWorkbench(h.bridge, { clock, id });
  api.start();
  await flush();
  assert.equal(api.store.getState().selection.workspaceId, "w");
  const requests = h.calls.length;
  api.actions.editConfigurationDraft("instructions", "# inert draft");
  api.actions.validateConfigurationDraft("instructions");
  api.actions.baselineConfigurationDraft("instructions");
  api.actions.editConfigurationDraft("instructions", "# revised inert draft");
  api.actions.discardConfigurationDraft("instructions");
  await flush();
  assert.equal(h.calls.length, requests);
  assert.deepEqual(api.store.getState().operations, {});
  api.dispose();
  assert.equal(clock.timers.size, 0);
});

const configurationFile = (
  content = "# loaded synthetic instructions",
  extra = {},
) => ({
  workspaceId: "w",
  workspacePath: "/fixture",
  kind: "instructions",
  path: "/fixture/AGENTS.md",
  status: "available",
  content,
  version: "a".repeat(64),
  ...extra,
});

test("actual host file IO to controller accepts blank and BOM instructions without passing draft format", async (t) => {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-blank-config-")),
  );
  t.after(() => rm(root, { recursive: true, force: true }));
  const w = { ...workspace(), path: root };
  for (const content of ["", " \n\t", "\ufeff", "\ufeff \r\n\t"]) {
    await writeFile(join(root, "AGENTS.md"), content);
    const h = bridgeHarness(async (e) => ({
      ok: true,
      value: await readConfigurationFile(w, e.operation.kind),
    }));
    const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
    seed(api.store, snapshot(1, "a", { workspaces: [w] }));
    api.actions.editConfigurationDraft("instructions", "existing text");
    assert.equal(
      await api.actions.loadConfigurationDraft("instructions"),
      true,
    );
    const draft = selectors.configurationDraft("instructions")(
      api.store.getState(),
    );
    assert.equal(draft.text, content);
    assert.equal(draft.baseline, content);
    assert.equal(draft.fileRead.status, "available");
    assert.match(draft.baselineFile.version, /^[a-f0-9]{64}$/);
    assert.equal(draft.validation, null);
    api.actions.validateConfigurationDraft("instructions");
    assert.deepEqual(
      selectors.configurationDraft("instructions")(api.store.getState())
        .validation.issues,
      ["empty"],
    );
    assert.deepEqual(api.store.getState().operations, {});
    api.dispose();
  }
});

test("actual host and controller agree on POSIX workspace containing literal trailing backslash", async (t) => {
  if (process.platform === "win32")
    return t.skip("POSIX filename fixture only");
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-config-path-")),
  );
  t.after(() => rm(parent, { recursive: true, force: true }));
  const root = join(parent, "literal\\name\\");
  await mkdir(root);
  await writeFile(join(root, "AGENTS.md"), "# safe synthetic instructions");
  const w = { ...workspace(), path: root };
  const h = bridgeHarness(async (e) => ({
    ok: true,
    value: await readConfigurationFile(w, e.operation.kind),
  }));
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(api.store, snapshot(1, "a", { workspaces: [w] }));
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), true);
  const d = selectors.configurationDraft("instructions")(api.store.getState());
  assert.equal(d.text, "# safe synthetic instructions");
  assert.equal(d.baselineFile.path, join(root, "AGENTS.md"));
  api.dispose();
});

test("explicit configuration load replaces only its unchanged draft and establishes observed disk baseline", async () => {
  const h = bridgeHarness(() => ({ ok: true, value: configurationFile() }));
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(api.store);
  api.actions.editConfigurationDraft("instructions", "# temporary");
  api.actions.validateConfigurationDraft("instructions");
  api.actions.editConfigurationDraft("mcp", '{"mcp":{"servers":{}}}');
  const revision = selectors.configurationDraft("instructions")(
    api.store.getState(),
  ).revision;
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), true);
  const draft = selectors.configurationDraft("instructions")(
    api.store.getState(),
  );
  assert.equal(draft.text, configurationFile().content);
  assert.equal(draft.baseline, draft.text);
  assert.deepEqual(draft.baselineFile, {
    path: "/fixture/AGENTS.md",
    version: "a".repeat(64),
  });
  assert.equal(draft.revision, revision + 1);
  assert.equal(draft.validation, null);
  assert.equal(draft.fileRequest, undefined);
  assert.equal(draft.fileRead.status, "available");
  assert.equal(
    selectors.configurationDraft("mcp")(api.store.getState()).text,
    '{"mcp":{"servers":{}}}',
  );
  assert.equal(h.calls.length, 1);
  assert.equal(h.calls[0].operation.type, "configuration.read");
  assert.ok(h.calls[0].readId);
  assert.equal(h.calls[0].operationId, undefined);
  assert.deepEqual(api.store.getState().operations, {});
  api.actions.baselineConfigurationDraft("instructions");
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState())
      .baselineFile,
    undefined,
  );
  api.dispose();
});

test("discard and recreated revision0 require the exact new configuration load identity in the store", () => {
  for (const oldResult of [
    { value: configurationFile("old") },
    { error: "READ_TIMEOUT" },
  ]) {
    const store = createWorkbenchStore();
    seed(store);
    const original = Object.freeze({
      id: "old",
      epoch: "epoch-a",
      workspaceId: "w",
      path: "/fixture",
      kind: "instructions",
      revision: 0,
    });
    store.dispatch({ type: "configuration.load", identity: original });
    store.dispatch({
      type: "configuration.draft",
      workspaceId: "w",
      path: "/fixture",
      kind: "instructions",
      action: "discard",
    });
    const afterDiscard = store.getState();
    store.dispatch({
      type: "configuration.loaded",
      identity: original,
      ...oldResult,
    });
    assert.equal(store.getState(), afterDiscard);
    const next = Object.freeze({ ...original, id: "new" });
    store.dispatch({ type: "configuration.load", identity: next });
    const recreated = store.getState();
    assert.equal(
      selectors.configurationDraft("instructions")(recreated).revision,
      0,
    );
    store.dispatch({
      type: "configuration.loaded",
      identity: original,
      ...oldResult,
    });
    assert.equal(store.getState(), recreated);
    store.dispatch({
      type: "configuration.loaded",
      identity: next,
      value: configurationFile("new"),
    });
    assert.equal(
      selectors.configurationDraft("instructions")(store.getState()).text,
      "new",
    );
  }
});

test("controller discard aborts its read and late success cannot resurrect a discarded draft", async () => {
  const late = deferred(),
    h = bridgeHarness(() => late.promise);
  const clock = fakeClock(),
    api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  const loading = api.actions.loadConfigurationDraft("instructions");
  await flush();
  api.actions.discardConfigurationDraft("instructions");
  await flush();
  assert.equal(await loading, false);
  assert.equal(h.cancellations.length, 1);
  late.resolve({ ok: true, value: configurationFile("discarded late text") });
  await flush();
  assert.deepEqual(api.store.getState().configurationDrafts, {});
  assert.deepEqual(api.store.getState().operations, {});
  assert.equal(clock.timers.size, 0);
  api.dispose();
});

test("edit, kind cancellation, workspace/path and epoch replacement all retire an explicit configuration read", async (t) => {
  for (const change of [
    "edit",
    "kind",
    "workspace",
    "path",
    "epoch",
    "baseline",
  ])
    await t.test(change, async () => {
      const late = deferred(),
        h = bridgeHarness(() => late.promise);
      const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
      seed(api.store);
      const pending = api.actions.loadConfigurationDraft("instructions");
      await flush();
      if (change === "edit")
        api.actions.editConfigurationDraft("instructions", "newer user text");
      else if (change === "kind")
        api.actions.cancelConfigurationLoad("instructions");
      else if (change === "workspace") api.actions.select("other");
      else if (change === "path")
        seed(
          api.store,
          snapshot(2, "a", {
            workspaces: [{ ...workspace(), path: "/replacement" }],
          }),
        );
      else if (change === "epoch") {
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(2, "a", { runtimeEpoch: "epoch-b" }),
        });
        assert.equal(api.store.getState().epoch, "epoch-b");
      } else api.actions.baselineConfigurationDraft("instructions");
      await flush();
      assert.equal(await pending, false);
      late.resolve({ ok: true, value: configurationFile("late source") });
      await flush();
      assert.equal(h.cancellations.length, 1);
      assert.ok(
        Object.values(api.store.getState().configurationDrafts).every(
          (d) =>
            d.text !== "late source" &&
            !d.fileRequest &&
            d.fileRead?.status !== "loading",
        ),
      );
      if (change === "edit")
        assert.equal(
          selectors.configurationDraft("instructions")(api.store.getState())
            .text,
          "newer user text",
        );
      api.dispose();
    });
});

test("configuration refusal and malformed responses preserve input and validation without automatic retry", async () => {
  for (const response of [
    { ok: false, code: "READ_BUSY", message: "ignored original detail" },
    {
      ok: true,
      value: {
        workspaceId: "w",
        workspacePath: "/fixture",
        kind: "instructions",
        path: "/fixture/AGENTS.md",
        status: "unsupported",
        reason: "unsupported_content",
      },
    },
    {
      ok: true,
      value: configurationFile(undefined, {
        status: "unsupported",
        reason: "unsupported_content",
        content: undefined,
        version: undefined,
      }),
    },
    {
      ok: true,
      value: {
        workspaceId: "w",
        workspacePath: "/fixture",
        kind: "instructions",
        path: "/fixture/AGENTS.md",
        status: "missing",
        reason: "missing_file",
      },
    },
    {
      ok: true,
      value: configurationFile("unsafe", { path: "/outside/AGENTS.md" }),
    },
    {
      ok: true,
      value: configurationFile("unsafe", { version: ["a".repeat(64)] }),
    },
    { ok: true, value: configurationFile("unsafe\u0000text") },
    {
      ok: true,
      value: configurationFile("unsafe", {
        headers: { authorization: "SYNTHETIC-CANARY" },
      }),
    },
    { ok: true, value: null },
  ]) {
    const h = bridgeHarness(() => response),
      clock = fakeClock();
    const api = createWindowWorkbench(h.bridge, { clock, id });
    seed(api.store);
    api.actions.editConfigurationDraft(
      "instructions",
      "keep current user text",
    );
    api.actions.validateConfigurationDraft("instructions");
    api.actions.baselineConfigurationDraft("instructions");
    const before = selectors.configurationDraft("instructions")(
      api.store.getState(),
    );
    assert.equal(
      await api.actions.loadConfigurationDraft("instructions"),
      false,
    );
    const after = selectors.configurationDraft("instructions")(
      api.store.getState(),
    );
    assert.equal(after.text, before.text);
    assert.equal(after.baseline, before.baseline);
    assert.equal(after.validation, before.validation);
    assert.equal(after.revision, before.revision);
    assert.notEqual(after.fileRead.status, "available");
    assert.doesNotMatch(
      JSON.stringify(after),
      /SYNTHETIC-CANARY|ignored original detail/,
    );
    await clock.advance(6000);
    assert.equal(h.calls.length, 1);
    api.dispose();
  }
});

test("configuration load supersedes old response and needs explicit retry after occupied actual lane settles", async () => {
  const first = deferred(),
    second = deferred();
  let reads = 0;
  const h = bridgeHarness((e) =>
    e.operation.type === "configuration.read"
      ? ++reads === 1
        ? first.promise
        : second.promise
      : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(api.store);
  const old = api.actions.loadConfigurationDraft("instructions");
  await flush();
  const fresh = api.actions.loadConfigurationDraft("instructions");
  await flush();
  assert.equal(await old, false);
  assert.equal(await fresh, false);
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).fileRead
      .reason,
    "READ_BUSY",
  );
  first.resolve({ ok: true, value: configurationFile("old source") });
  await flush();
  assert.notEqual(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "old source",
  );
  const retry = api.actions.loadConfigurationDraft("instructions");
  await flush();
  second.resolve({
    ok: true,
    value: configurationFile("current source", { version: "b".repeat(64) }),
  });
  assert.equal(await retry, true);
  api.actions.refresh();
  await flush();
  assert.equal(reads, 2);
  assert.deepEqual(api.store.getState().operations, {});
  api.dispose();
});

test("configuration save requires a loaded observation and sends the actual v2 version request", async () => {
  const h = bridgeHarness((e) => {
    if (e.operation.type === "configuration.read")
      return { ok: true, value: configurationFile() };
    if (e.operation.type === "configuration.save") return configurationSaved(e);
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(api.store);
  api.actions.editConfigurationDraft("instructions", "new instructions");
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), false);
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), false);
  await api.actions.loadConfigurationDraft("instructions");
  api.actions.editConfigurationDraft("instructions", "new instructions");
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), true);
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), true);
  const envelope = h.calls.find(
    (e) => e.operation.type === "configuration.save",
  );
  assert.equal(envelope.version, 2);
  assert.equal(envelope.runtimeEpoch, "epoch-a");
  assert.equal(envelope.expectedRevision, 1);
  assert.deepEqual(Object.keys(envelope.operation).sort(), [
    "expectation",
    "kind",
    "requestId",
    "text",
    "type",
    "version",
    "workspaceId",
  ]);
  assert.equal(envelope.operation.version, "a".repeat(64));
  const draft = selectors.configurationDraft("instructions")(
    api.store.getState(),
  );
  assert.equal(draft.text, "new instructions");
  assert.equal(draft.baseline, draft.text);
  assert.equal(draft.baselineFile.version, "b".repeat(64));
  assert.equal(draft.fileSave.status, "saved");
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), false);
  api.dispose();
});

function configurationSaved(e, extra = {}) {
  const backupId =
    e.operation.expectation === "version"
      ? `.omoc-configuration-${createHash("sha256")
          .update(JSON.stringify([e.runtimeEpoch, e.operationId]))
          .digest("hex")}.${e.operation.kind}.backup`
      : undefined;
  const result = {
    kind: "configuration_saved",
    workspaceId: e.operation.workspaceId,
    configurationKind: e.operation.kind,
    version: "b".repeat(64),
    ...(backupId ? { backupId } : {}),
  };
  return {
    ok: true,
    value: {
      requestId: e.operation.requestId,
      status: "saved",
      version: result.version,
      ...(backupId ? { backupId } : {}),
    },
    receipt: receipt(e, {
      evidence: [{ kind: "host-registry", id: e.operation.workspaceId }],
      result,
    }),
    ...extra,
  };
}

async function configurationSaveFixture({
  kind = "instructions",
  missing = false,
  save,
  clock = fakeClock(),
  initial = snapshot(),
} = {}) {
  const h = bridgeHarness((e) => {
    if (e.operation.type === "configuration.read") {
      const value = configurationFile(
        kind === "instructions"
          ? "original"
          : '{"mcp":{"servers":{"demo":{"type":"local","command":["old"]}}}}',
        {
          kind,
          path: `/fixture/${kind === "instructions" ? "AGENTS.md" : "opencode.json"}`,
        },
      );
      if (missing) {
        delete value.content;
        delete value.version;
        value.status = "missing";
        value.reason = "missing_file";
      }
      return { ok: true, value };
    }
    if (e.operation.type === "configuration.save")
      return save ? save(e) : configurationSaved(e);
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store, initial);
  await api.actions.loadConfigurationDraft(kind);
  api.actions.editConfigurationDraft(
    kind,
    kind === "instructions"
      ? "submitted"
      : '{"mcp":{"servers":{"demo":{"type":"local","command":["new"]}}}}',
  );
  const draft = () => selectors.configurationDraft(kind)(api.store.getState());
  return { api, h, clock, draft, kind };
}
async function configurationSaveCall(h) {
  for (let n = 0; n < 40; n++) {
    const call = h.calls.find((e) => e.operation.type === "configuration.save");
    if (call) return call;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("save must reach actual transport");
}

test("configuration save missing creation has no version or backup, including supported MCP whole document", async (t) => {
  for (const kind of ["instructions", "mcp"])
    await t.test(kind, async () => {
      const { api, h, draft } = await configurationSaveFixture({
        kind,
        missing: true,
      });
      assert.equal(api.actions.canSaveConfigurationDraft(kind), true);
      assert.equal(await api.actions.saveConfigurationDraft(kind), true);
      const e = h.calls.find((e) => e.operation.type === "configuration.save");
      assert.equal(e.operation.expectation, "missing");
      assert.equal(Object.hasOwn(e.operation, "version"), false);
      assert.equal(Object.hasOwn(draft().fileSave, "backupId"), false);
      assert.equal(draft().baseline, e.operation.text);
      assert.equal(draft().fileSave.current, true);
      api.dispose();
    });
});

test("configuration save permits blank clear with invalid-empty draft validation and preserves exact BOM text", async (t) => {
  for (const text of ["", " \n\t", "\ufeff \r\n\t", "\ufeff# exact 🧪"])
    await t.test(JSON.stringify(text), async () => {
      const { api, h, draft } = await configurationSaveFixture();
      api.actions.editConfigurationDraft("instructions", text);
      api.actions.validateConfigurationDraft("instructions");
      if (!text.trim()) assert.deepEqual(draft().validation.issues, ["empty"]);
      assert.equal(api.actions.canSaveConfigurationDraft("instructions"), true);
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        true,
      );
      assert.equal(
        h.calls.find((e) => e.operation.type === "configuration.save").operation
          .text,
        text,
      );
      assert.equal(draft().text, text);
      assert.equal(draft().baseline, text);
      api.dispose();
    });
});

test("configuration save uses lossless shared write safety, not draft format approval", async (t) => {
  for (const [kind, text] of [
    ["instructions", "lone \ud800"],
    ["instructions", "lone \udfff"],
    ["instructions", "unsafe\u0000"],
    ["mcp", ""],
    ["mcp", '{"mcp":{"servers":{}},"other":true}'],
    [
      "mcp",
      '{"mcp":{"servers":{"d":{"type":"local","command":["x"],"command":["y"]}}}}',
    ],
  ])
    await t.test(`${kind}:${JSON.stringify(text)}`, async () => {
      const { api, h } = await configurationSaveFixture({ kind });
      api.actions.editConfigurationDraft(kind, text);
      api.actions.validateConfigurationDraft(kind);
      assert.equal(api.actions.canSaveConfigurationDraft(kind), false);
      assert.equal(await api.actions.saveConfigurationDraft(kind), false);
      assert.equal(
        h.calls.filter((e) => e.operation.type === "configuration.save").length,
        0,
      );
      api.dispose();
    });
});

test("configuration save denied and external conflict preserve text with distinct states and require explicit reload", async (t) => {
  for (const [code, status] of [
    ["CANCELLED", "denied"],
    ["FILE_DENIED", "denied"],
    ["FILE_CHANGED", "conflict"],
  ])
    await t.test(code, async () => {
      const { api, h, draft } = await configurationSaveFixture({
        save: (e) => ({
          ok: false,
          code,
          message: code,
          receipt: receipt(e, {
            admission: "rejected",
            delivery: "pending",
            effect: "none",
            evidence: [],
            result: { kind: "rejected", code },
          }),
        }),
      });
      const before = draft();
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(draft().text, before.text);
      assert.equal(draft().baseline, before.baseline);
      assert.equal(draft().fileSave.status, status);
      assert.equal(draft().fileSave.code, code);
      assert.equal(draft().fileSave.current, true);
      assert.equal(
        api.actions.canSaveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(
        h.calls.filter((e) => e.operation.type === "configuration.read").length,
        1,
      );
      assert.equal(
        h.calls.filter((e) => e.operation.type === "operation.lookup").length,
        0,
      );
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), false);
      api.dispose();
    });
});

test("configuration unknown retains original lookup-only key and hold without content reload or mutation replay", async () => {
  const { api, h, draft, clock } = await configurationSaveFixture({
    save: (e) => ({
      ok: true,
      value: { requestId: e.operation.requestId, status: "unknown" },
      receipt: receipt(e, {
        effect: "unknown",
        delivery: "unknown",
        evidence: [],
        result: undefined,
      }),
    }),
  });
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), false);
  await flush();
  const e = h.calls.find((e) => e.operation.type === "configuration.save");
  const key = operationKey(e.runtimeEpoch, e.operationId);
  assert.equal(draft().fileSave.status, "unknown");
  assert.equal(draft().text, "submitted");
  assert.equal(draft().baseline, "original");
  assert.equal(api.store.getState().operations[key].lookupOnly, true);
  assert.deepEqual(api.store.getState().operations[key].operation, {
    type: "configuration.save",
    workspaceId: "w",
  });
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  api.actions.editConfigurationDraft("instructions", "newer unknown text");
  api.actions.discardConfigurationDraft("instructions");
  api.actions.editConfigurationDraft("instructions", "recreated text");
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), false);
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), false);
  await clock.advance(15000);
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.save").length,
    1,
  );
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.read").length,
    1,
  );
  for (const lookup of h.calls.filter(
    (e) => e.operation.type === "operation.lookup",
  )) {
    assert.equal(lookup.operation.operationId, e.operationId);
    assert.equal(lookup.operation.runtimeEpoch, e.runtimeEpoch);
    assert.equal(Object.hasOwn(lookup.operation, "text"), false);
  }
  api.store.dispatch({
    type: "receipt",
    id: key,
    receipt: configurationSaved(e).receipt,
  });
  assert.equal(draft().text, "recreated text");
  assert.equal(draft().baseline, "");
  assert.equal(draft().fileSave, undefined);
  api.dispose();
});

test("configuration late confirmed save advances only captured baseline while edits remain unsaved", async () => {
  const late = deferred();
  const { api, h, draft } = await configurationSaveFixture({
    save: () => late.promise,
  });
  const promise = api.actions.saveConfigurationDraft("instructions");
  const e = await configurationSaveCall(h);
  assert.equal(draft().fileSave.status, "pending");
  assert.equal(draft().fileSave.current, true);
  assert.equal(Object.isFrozen(draft().fileSave.identity), true);
  assert.equal(Object.isFrozen(draft().fileSave.identity.request), true);
  const request = draft().fileSave.identity.request;
  assert.equal(
    api.store.getState().operations[operationKey(e.runtimeEpoch, e.operationId)]
      .operation,
    request,
  );
  api.actions.editConfigurationDraft("instructions", "newer edit");
  const revision = draft().revision;
  assert.equal(draft().fileSave.current, false);
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), false);
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), false);
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), false);
  late.resolve(configurationSaved(e));
  assert.equal(await promise, true);
  assert.equal(draft().text, "newer edit");
  assert.equal(draft().revision, revision);
  assert.equal(draft().baseline, "submitted");
  assert.equal(draft().baselineFile.version, "b".repeat(64));
  assert.equal(draft().fileSave.status, "saved");
  assert.equal(draft().fileSave.current, false);
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), true);
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.read").length,
    1,
  );
  api.dispose();
});

test("configuration late save never revives a discarded draft or rebinds after workspace, path or epoch ABA", async (t) => {
  for (const change of [
    "discard",
    "discard-recreate",
    "workspace-return",
    "path-return",
    "epoch",
    "removed-return",
    "baseline",
  ])
    await t.test(change, async () => {
      const late = deferred();
      const { api, h, draft } = await configurationSaveFixture({
        save: () => late.promise,
      });
      const promise = api.actions.saveConfigurationDraft("instructions");
      const e = await configurationSaveCall(h);
      if (change.startsWith("discard")) {
        api.actions.discardConfigurationDraft("instructions");
        if (change === "discard-recreate")
          api.actions.editConfigurationDraft("instructions", "recreated");
      } else if (change === "workspace-return") {
        api.actions.select("other");
        api.actions.select("w", "a");
        seed(api.store, snapshot(1));
      } else if (change === "path-return") {
        seed(
          api.store,
          snapshot(1, "a", {
            workspaces: [{ ...workspace(), path: "/moved" }],
          }),
        );
        seed(api.store, snapshot(1));
      } else if (change === "epoch") {
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
        });
      } else if (change === "removed-return") {
        api.actions.select();
        seed(
          api.store,
          snapshot(1, undefined, {
            workspaces: [],
            sessions: [],
            selectedWorkspaceId: undefined,
            selectedSessionId: undefined,
          }),
        );
        api.actions.select("w", "a");
        seed(api.store, snapshot(1));
      } else api.actions.baselineConfigurationDraft("instructions");
      const before = draft();
      late.resolve(configurationSaved(e));
      await promise;
      assert.equal(
        draft(),
        before,
        "historical ACK must not modify the current draft binding",
      );
      assert.equal(draft().fileSave, undefined);
      assert.equal(
        api.actions.canSaveConfigurationDraft("instructions"),
        false,
      );
      if (change === "epoch") assert.equal(api.store.getState().revision, 1);
      assert.equal(
        api.store.getState().operations[
          operationKey(e.runtimeEpoch, e.operationId)
        ].status,
        "accepted",
      );
      api.dispose();
    });
});

test("configuration failed load, local baseline, path and epoch changes cannot reuse a stale disk observation", async (t) => {
  for (const change of [
    "load-error",
    "local-baseline",
    "path-return",
    "epoch",
    "cancel-load",
  ])
    await t.test(change, async () => {
      let failRead = false;
      const { api, h } = await configurationSaveFixture({
        save: (e) => configurationSaved(e),
      });
      if (change === "load-error" || change === "cancel-load") {
        const oldWorkbench = h.bridge.workbench;
        h.bridge.workbench = (e) =>
          e.operation.type === "configuration.read" && failRead
            ? change === "cancel-load"
              ? new Promise(() => {})
              : { ok: false, code: "FILE_DENIED", message: "denied" }
            : oldWorkbench(e);
        failRead = true;
        const load = api.actions.loadConfigurationDraft("instructions");
        await flush();
        if (change === "cancel-load") api.actions.cancelConfigurationLoad();
        await load;
      } else if (change === "local-baseline") {
        api.actions.baselineConfigurationDraft("instructions");
        api.actions.editConfigurationDraft("instructions", "newer");
      } else if (change === "path-return") {
        seed(
          api.store,
          snapshot(1, "a", {
            workspaces: [{ ...workspace(), path: "/moved" }],
          }),
        );
        seed(api.store, snapshot(1));
      } else
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
        });
      assert.equal(
        api.actions.canSaveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(
        h.calls.filter((e) => e.operation.type === "configuration.save").length,
        0,
      );
      api.dispose();
    });
});

test("configuration malformed receipts, raw fields, wrong result identities and floor clocks cannot clear unknown holds", async (t) => {
  const { api, h, draft } = await configurationSaveFixture({
    save: (e) => ({
      ok: true,
      value: { requestId: e.operation.requestId, status: "unknown" },
    }),
  });
  await api.actions.saveConfigurationDraft("instructions");
  await flush();
  const e = h.calls.find((e) => e.operation.type === "configuration.save");
  const key = operationKey(e.runtimeEpoch, e.operationId);
  const good = configurationSaved(e).receipt;
  const changes = {
    "raw receipt text": (r) => ({ ...r, text: "raw" }),
    "raw receipt path": (r) => ({ ...r, path: "/private" }),
    "raw result path": (r) => ({
      ...r,
      result: { ...r.result, path: "/private" },
    }),
    "wrong outer workspace": (r) => ({ ...r, workspaceId: "other" }),
    "missing outer workspace": (r) => {
      const next = { ...r };
      delete next.workspaceId;
      return next;
    },
    "wrong result workspace": (r) => ({
      ...r,
      result: { ...r.result, workspaceId: "other" },
    }),
    "wrong kind": (r) => ({
      ...r,
      result: { ...r.result, configurationKind: "mcp" },
    }),
    "wrong version type": (r) => ({
      ...r,
      result: { ...r.result, version: ["b".repeat(64)] },
    }),
    "bad version": (r) => ({
      ...r,
      result: { ...r.result, version: "version" },
    }),
    "wrong backup key": (r) => ({
      ...r,
      result: {
        ...r.result,
        backupId: `.omoc-configuration-${"0".repeat(64)}.instructions.backup`,
      },
    }),
    "raw backup path": (r) => ({
      ...r,
      result: { ...r.result, backupId: "/private/backup" },
    }),
    "missing overwrite backup": (r) => {
      const result = { ...r.result };
      delete result.backupId;
      return { ...r, result };
    },
    "wrong admission": (r) => ({ ...r, admission: "admitted" }),
    "wrong delivery": (r) => ({ ...r, delivery: "unknown" }),
    "unknown result": (r) => ({ ...r, effect: "unknown" }),
    "missing result": (r) => {
      const next = { ...r };
      delete next.result;
      return next;
    },
    "empty evidence": (r) => ({ ...r, evidence: [] }),
    "wrong evidence": (r) => ({
      ...r,
      evidence: [{ kind: "native-ack", id: "inbox" }],
    }),
    "raw evidence": (r) => ({
      ...r,
      evidence: [{ kind: "host-registry", id: "w", path: "/private" }],
    }),
    "wrong evidence workspace": (r) => ({
      ...r,
      evidence: [{ kind: "host-registry", id: "other" }],
    }),
    "floor revision": (r) => ({ ...r, revision: 1 }),
    "older revision": (r) => ({ ...r, revision: 0 }),
    "invalid revision": (r) => ({ ...r, revision: NaN }),
    "fractional revision": (r) => ({ ...r, revision: 2.5 }),
    "different epoch": (r) => ({ ...r, runtimeEpoch: "epoch-b" }),
    "different operation": (r) => ({ ...r, operationId: "different" }),
    "different operation type": (r) => ({ ...r, type: "session.create" }),
    "session field": (r) => ({ ...r, sessionId: "a" }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, () => {
      const before = api.store.getState();
      api.store.dispatch({ type: "receipt", id: key, receipt: change(good) });
      assert.equal(api.store.getState(), before);
      assert.equal(draft().text, "submitted");
      assert.equal(draft().baseline, "original");
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
    });
  const before = api.store.getState();
  api.store.dispatch({ type: "receipt", id: e.operationId, receipt: good });
  assert.equal(
    api.store.getState(),
    before,
    "save receipt requires the original composite key",
  );
  api.store.dispatch({ type: "receipt", id: key, receipt: good });
  assert.equal(draft().fileSave.status, "saved");
  assert.equal(draft().baseline, "submitted");
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), false);
  const saved = api.store.getState();
  api.store.dispatch({
    type: "receipt",
    id: key,
    receipt: {
      ...good,
      revision: 3,
      result: { ...good.result, version: "c".repeat(64) },
    },
  });
  assert.equal(
    api.store.getState(),
    saved,
    "a terminal save receipt is immutable",
  );
  api.dispose();
});

test("configuration save response must correlate requestId, version and backup with the closed receipt", async (t) => {
  const changes = {
    "wrong request": (r) => ({
      ...r,
      value: { ...r.value, requestId: "other" },
    }),
    "wrong version": (r) => ({
      ...r,
      value: { ...r.value, version: "c".repeat(64) },
    }),
    "coerced version": (r) => ({
      ...r,
      value: { ...r.value, version: [r.value.version] },
    }),
    "wrong backup": (r) => ({ ...r, value: { ...r.value, backupId: "wrong" } }),
    "raw response": (r) => ({ ...r, value: { ...r.value, text: "raw" } }),
    "missing receipt": (r) => {
      const next = { ...r };
      delete next.receipt;
      return next;
    },
    "unknown response with confirmed receipt": (r) => ({
      ...r,
      value: { requestId: r.value.requestId, status: "unknown" },
    }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { api, draft } = await configurationSaveFixture({
        save: (e) => change(configurationSaved(e)),
      });
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(draft().baseline, "original");
      assert.equal(draft().fileSave.status, "unknown");
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
      api.dispose();
    });
});

test("configuration save remains blocked while an actual timed-out file read has not settled", async () => {
  const late = deferred();
  const { api, h, clock } = await configurationSaveFixture();
  const oldWorkbench = h.bridge.workbench;
  h.bridge.workbench = (e) =>
    e.operation.type === "file.list"
      ? { ok: true, value: { path: "", entries: [] } }
      : e.operation.type === "file.read"
        ? late.promise
        : oldWorkbench(e);
  api.actions.openFiles("preview.md", "file");
  await flush();
  assert.equal(api.store.getState().configurationIO.reads, 1);
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), false);
  await clock.advance(10000);
  assert.equal(api.store.getState().files.busy, false);
  assert.equal(api.store.getState().configurationIO.reads, 1);
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), false);
  late.resolve({
    ok: true,
    value: { path: "preview.md", content: "late", truncated: false },
  });
  await flush();
  assert.equal(api.store.getState().configurationIO.reads, 0);
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), true);
  api.dispose();
});

test("configuration save timeout keeps actual busy lane even after confirmed lookup and draft discard", async () => {
  const late = deferred();
  const { api, h, clock, draft } = await configurationSaveFixture({
    save: () => late.promise,
  });
  const promise = api.actions.saveConfigurationDraft("instructions");
  const e = await configurationSaveCall(h);
  assert.equal(api.store.getState().configurationIO.saves, 1);
  await clock.advance(10000);
  assert.equal(await promise, false);
  assert.equal(draft().fileSave.status, "unknown");
  const key = operationKey(e.runtimeEpoch, e.operationId);
  seed(
    api.store,
    snapshot(api.store.getState().revision, "a", {
      retainedOperations: [
        {
          runtimeEpoch: e.runtimeEpoch,
          operationId: e.operationId,
          type: "configuration.save",
          workspaceId: "w",
          authorityHold: false,
        },
      ],
    }),
  );
  assert.equal(api.store.getState().operations[key].hostHeld, false);
  assert.equal(api.store.getState().operations[key].status, "unknown");
  assert.equal(api.store.getState().configurationIO.saves, 1);
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), false);
  api.store.dispatch({
    type: "receipt",
    id: key,
    receipt: configurationSaved(e).receipt,
  });
  assert.equal(draft().fileSave.status, "saved");
  api.actions.editConfigurationDraft("instructions", "newer");
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), false);
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), false);
  api.actions.discardConfigurationDraft("instructions");
  assert.equal(
    await api.actions.mutate({ type: "session.create", workspaceId: "w" }),
    false,
  );
  late.resolve(configurationSaved(e));
  await flush();
  assert.equal(api.store.getState().configurationIO.saves, 0);
  assert.equal(draft().fileSave, undefined);
  assert.equal(draft().text, "");
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.save").length,
    1,
  );
  api.dispose();
});

test("configuration loaded save respects global and workspace recovery plus pending file reads", async (t) => {
  for (const change of [
    "global",
    "resource",
    "pending-read",
    "pending-operation",
    "disconnected",
  ])
    await t.test(change, async () => {
      const { api, h } = await configurationSaveFixture();
      if (change === "global")
        seed(api.store, recoverySnapshot("writer_poisoned"));
      else if (change === "resource")
        seed(
          api.store,
          snapshot(1, "a", {
            recovery: {
              store: { state: "ready" },
              resources: [
                {
                  workspaceId: "w",
                  state: "unavailable",
                  reason: "path_conflict",
                },
              ],
            },
          }),
        );
      else if (change === "pending-read") {
        const oldWorkbench = h.bridge.workbench;
        h.bridge.workbench = (e) =>
          e.operation.type === "configuration.read"
            ? new Promise(() => {})
            : oldWorkbench(e);
        void api.actions.loadConfigurationDraft("mcp");
      } else if (change === "pending-operation")
        api.store.dispatch({
          type: "intent",
          intent: {
            id: "pending",
            epoch: "epoch-a",
            operation: send(),
            origin: api.store.getState().selection,
            key: selectionKey("w", "a"),
            navigate: false,
            status: "pending",
          },
        });
      else
        api.store.dispatch({
          type: "health",
          scope: scopeOf(api.store.getState()),
          code: "UNAVAILABLE",
        });
      assert.equal(
        api.actions.canSaveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(
        h.calls.filter((e) => e.operation.type === "configuration.save").length,
        0,
      );
      api.dispose();
    });
});

test("configuration restored retained key is lookup-only and confirmed receipt never releases host hold", async () => {
  const retained = {
    authorityHold: true,
    runtimeEpoch: "older-epoch",
    operationId: "older-save",
    type: "configuration.save",
    workspaceId: "w",
  };
  const h = bridgeHarness(readFallback);
  const api = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(api.store, snapshot(1, "a", { retainedOperations: [retained] }));
  const key = operationKey(retained.runtimeEpoch, retained.operationId);
  assert.equal(api.store.getState().operations[key].lookupOnly, true);
  assert.deepEqual(api.store.getState().operations[key].operation, {
    type: "configuration.save",
    workspaceId: "w",
  });
  const r = receipt(
    {
      runtimeEpoch: retained.runtimeEpoch,
      operationId: retained.operationId,
      operation: {
        ...retained,
        requestId: "history",
        kind: "instructions",
        expectation: "missing",
      },
    },
    {
      evidence: [{ kind: "host-registry", id: "w" }],
      result: {
        kind: "configuration_saved",
        workspaceId: "w",
        configurationKind: "instructions",
        version: "b".repeat(64),
      },
    },
  );
  api.store.dispatch({ type: "receipt", id: key, receipt: r });
  assert.equal(api.store.getState().revision, 1);
  assert.equal(api.store.getState().operations[key].hostHeld, true);
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), false);
  assert.deepEqual(api.store.getState().configurationDrafts, {});
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.save").length,
    0,
  );
  api.dispose();
});

test("configuration same-key save cannot replay, and generic mutate cannot bypass a loaded draft", async () => {
  const h = bridgeHarness((e) =>
    e.operation.type === "configuration.read"
      ? { ok: true, value: configurationFile() }
      : e.operation.type === "configuration.save"
        ? configurationSaved(e)
        : readFallback(e),
  );
  const api = createWindowWorkbench(h.bridge, {
    clock: fakeClock(),
    id: () => "same-key",
  });
  seed(api.store);
  await api.actions.loadConfigurationDraft("instructions");
  api.actions.editConfigurationDraft("instructions", "first");
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), true);
  api.actions.editConfigurationDraft("instructions", "second");
  assert.equal(await api.actions.saveConfigurationDraft("instructions"), false);
  assert.equal(
    await api.actions.mutate({
      type: "configuration.save",
      workspaceId: "w",
      requestId: "bypass",
      kind: "instructions",
      text: "bypass",
      expectation: "missing",
    }),
    false,
  );
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.save").length,
    1,
  );
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "second",
  );
  api.dispose();
});

test("configuration filesystem refusal without a closed no-effect receipt stays unknown", async (t) => {
  for (const code of [
    "FILE_CHANGED",
    "FILE_DENIED",
    "FILE_UNSUPPORTED",
    "FILE_TOO_LARGE",
    "UNKNOWN_OUTCOME",
  ])
    await t.test(code, async () => {
      const { api, draft } = await configurationSaveFixture({
        save: () => ({ ok: false, code, message: code }),
      });
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(draft().fileSave.status, "unknown");
      assert.equal(draft().text, "submitted");
      assert.equal(draft().baseline, "original");
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
      api.dispose();
    });
});

test("configuration unknown save holds only its workspace once the actual save lane settles", async () => {
  const { api, h } = await configurationSaveFixture({
    save: (e) => ({
      ok: true,
      value: { requestId: e.operation.requestId, status: "unknown" },
    }),
  });
  await api.actions.saveConfigurationDraft("instructions");
  const other = { ...workspace("other"), path: "/other" };
  api.actions.select("other");
  seed(
    api.store,
    snapshot(1, undefined, {
      selectedWorkspaceId: "other",
      selectedSessionId: undefined,
      workspaces: [workspace(), other],
      sessions: [session("a"), session("b")],
    }),
  );
  const original = h.bridge.workbench;
  h.bridge.workbench = (e) =>
    e.operation.type === "configuration.read" &&
    e.operation.workspaceId === "other"
      ? {
          ok: true,
          value: configurationFile("other original", {
            workspaceId: "other",
            workspacePath: "/other",
            path: "/other/AGENTS.md",
          }),
        }
      : original(e);
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  assert.equal(resourceMutationDisabled(api.store.getState(), "other"), false);
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), true);
  api.actions.editConfigurationDraft("instructions", "other draft");
  assert.equal(api.actions.canSaveConfigurationDraft("instructions"), true);
  api.dispose();
});

test("configuration no-effect receipt requires a closed known rejection above the captured floor", async (t) => {
  const changes = {
    "missing rejection": (r) => {
      const next = { ...r };
      delete next.result;
      return next;
    },
    "unknown rejection code": (r) => ({
      ...r,
      result: { kind: "rejected", code: "FABRICATED" },
    }),
    "raw rejection field": (r) => ({
      ...r,
      result: { ...r.result, text: "raw" },
    }),
    "floor revision": (r) => ({ ...r, revision: 1 }),
    "accepted rejection": (r) => ({ ...r, delivery: "accepted" }),
    "dispatched rejection": (r) => ({ ...r, admission: "dispatched" }),
    "evidence on rejection": (r) => ({
      ...r,
      evidence: [{ kind: "host-registry", id: "w" }],
    }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { api, draft } = await configurationSaveFixture({
        save: (e) => ({
          ok: false,
          code: "CANCELLED",
          message: "denied",
          receipt: change(
            receipt(e, {
              admission: "rejected",
              delivery: "pending",
              effect: "none",
              evidence: [],
              result: { kind: "rejected", code: "CANCELLED" },
            }),
          ),
        }),
      });
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        false,
      );
      assert.equal(draft().fileSave.status, "unknown");
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
      api.dispose();
    });
});

test("configuration dispatched unknown receipt cannot regress to a fabricated no-effect rejection", async () => {
  const { api, h } = await configurationSaveFixture({
    save: (e) => ({
      ok: true,
      value: { requestId: e.operation.requestId, status: "unknown" },
      receipt: receipt(e, {
        effect: "unknown",
        delivery: "unknown",
        evidence: [],
        result: undefined,
      }),
    }),
  });
  await api.actions.saveConfigurationDraft("instructions");
  const e = h.calls.find((e) => e.operation.type === "configuration.save");
  const before = api.store.getState();
  api.store.dispatch({
    type: "receipt",
    id: operationKey(e.runtimeEpoch, e.operationId),
    receipt: receipt(e, {
      revision: 3,
      admission: "rejected",
      delivery: "pending",
      effect: "none",
      evidence: [],
      result: { kind: "rejected", code: "CANCELLED" },
    }),
  });
  assert.equal(api.store.getState(), before);
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  api.dispose();
});

// Instruction registration uses the frozen public DTO and the original operation lane.
const instructionVersion = "c".repeat(64);
const instructionDigest = createHash("sha256").update("original").digest("hex");
function instructionConfirmed(e) {
  const apply = e.operation.type === "configuration.instructions.apply";
  const result = apply
    ? {
        kind: "instruction_registered",
        workspaceId: "w",
        sessionId: "a",
        digest: instructionDigest,
        sourceVersion: "a".repeat(64),
      }
    : { kind: "instruction_removed", workspaceId: "w", sessionId: "a" };
  return {
    ok: true,
    value: {
      requestId: e.operation.requestId,
      status: apply ? "registered" : "removed",
      ...(apply
        ? { digest: result.digest, sourceVersion: result.sourceVersion }
        : {}),
    },
    receipt: receipt(e, {
      evidence: [{ kind: "host-registry", id: "a" }],
      result,
    }),
  };
}
function instructionFixture({
  read,
  mutate,
  lookup,
  clock = fakeClock(),
} = {}) {
  const h = bridgeHarness((e) => {
    if (e.operation.type === "configuration.instructions.read")
      return read
        ? read(e)
        : {
            ok: true,
            value: {
              workspaceId: e.operation.workspaceId,
              sessionId: e.operation.sessionId,
              status: "missing",
              version: instructionVersion,
            },
          };
    if (e.operation.type.startsWith("configuration.instructions."))
      return mutate ? mutate(e) : instructionConfirmed(e);
    if (e.operation.type === "configuration.read")
      return { ok: true, value: configurationFile("original") };
    if (e.operation.type === "operation.lookup" && lookup) return lookup(e);
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  const instruction = () => selectors.instructions(api.store.getState());
  return { api, h, instruction, clock };
}

test("instructions require explicit observation and exact loaded baseline; confirmation requires fresh read", async () => {
  const { api, h, instruction } = instructionFixture();
  assert.equal(selectors.canApplyInstructions(api.store.getState()), false);
  await api.actions.loadConfigurationDraft("instructions");
  assert.equal(
    h.calls.some((e) =>
      e.operation.type.startsWith("configuration.instructions."),
    ),
    false,
  );
  assert.equal(await api.actions.observeInstructions(), true);
  assert.equal(selectors.canApplyInstructions(api.store.getState()), true);
  assert.equal(await api.actions.applyInstructions(), true);
  const e = h.calls.find(
    (e) => e.operation.type === "configuration.instructions.apply",
  );
  assert.deepEqual(Object.keys(e.operation).sort(), [
    "expectedRegistrationVersion",
    "fileVersion",
    "requestId",
    "sessionId",
    "text",
    "type",
    "workspaceId",
  ]);
  assert.equal(e.operation.text, "original");
  assert.equal(e.operation.fileVersion, "a".repeat(64));
  assert.equal(e.operation.expectedRegistrationVersion, instructionVersion);
  assert.equal(e.expectedRevision, 1);
  assert.equal(instruction().action.status, "registered");
  assert.equal(instruction().observation, undefined);
  assert.equal(selectors.canApplyInstructions(api.store.getState()), false);
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "original",
  );
  assert.equal(
    h.calls.filter(
      (e) => e.operation.type === "configuration.instructions.read",
    ).length,
    1,
  );
  api.dispose();
});

test("instructions remove needs no file; direct/fork origin comes only from closed matching observation", async () => {
  let value = {
    workspaceId: "w",
    sessionId: "a",
    status: "registered",
    version: instructionVersion,
    digest: instructionDigest,
    sourceVersion: "a".repeat(64),
    origin: "fork",
    inheritedFromSessionId: "parent",
  };
  const { api, h, instruction } = instructionFixture({
    read: () => ({ ok: true, value }),
  });
  await api.actions.observeInstructions();
  assert.equal(instruction().observation.origin, "fork");
  value = { ...value, origin: "direct" };
  delete value.inheritedFromSessionId;
  await api.actions.observeInstructions();
  assert.equal(instruction().observation.origin, "direct");
  assert.equal(selectors.canRemoveInstructions(api.store.getState()), true);
  assert.equal(await api.actions.removeInstructions(), true);
  assert.equal(
    h.calls.some((e) => e.operation.type === "configuration.read"),
    false,
  );
  assert.equal(instruction().action.status, "removed");
  api.dispose();
});

test("instructions observation rejects cross scope, extra fields and invented origin; drift and unavailable block correctly", async (t) => {
  for (const value of [
    {
      workspaceId: "other",
      sessionId: "a",
      status: "missing",
      version: instructionVersion,
    },
    {
      workspaceId: "w",
      sessionId: "b",
      status: "missing",
      version: instructionVersion,
    },
    { workspaceId: "w", sessionId: "a", status: "missing", version: "bad" },
    {
      workspaceId: "w",
      sessionId: "a",
      status: "registered",
      version: instructionVersion,
      digest: instructionDigest,
      sourceVersion: "a".repeat(64),
      origin: "fork",
    },
    {
      workspaceId: "w",
      sessionId: "a",
      status: "registered",
      version: instructionVersion,
      digest: instructionDigest,
      sourceVersion: "a".repeat(64),
      origin: "direct",
      inheritedFromSessionId: "parent",
    },
    {
      workspaceId: "w",
      sessionId: "a",
      status: "changed",
      version: instructionVersion,
      origin: "fork",
      inheritedFromSessionId: "parent",
    },
    {
      workspaceId: "w",
      sessionId: "a",
      status: "unavailable",
      reason: "ownership_conflict",
      version: instructionVersion,
    },
  ])
    await t.test(JSON.stringify(value), async () => {
      const { api, instruction } = instructionFixture({
        read: () => ({ ok: true, value }),
      });
      assert.equal(await api.actions.observeInstructions(), false);
      assert.equal(instruction().observation, undefined);
      assert.equal(
        selectors.canRemoveInstructions(api.store.getState()),
        false,
      );
      api.dispose();
    });
  for (const status of ["changed", "ownership_conflict", "unsupported_entries"])
    await t.test(status, async () => {
      const value = {
        workspaceId: "w",
        sessionId: "a",
        ...(status === "changed"
          ? { status, version: instructionVersion, digest: instructionDigest }
          : { status: "unavailable", reason: status }),
      };
      const { api, instruction } = instructionFixture({
        read: () => ({ ok: true, value }),
      });
      await api.actions.loadConfigurationDraft("instructions");
      assert.equal(await api.actions.observeInstructions(), true);
      assert.equal(
        selectors.canApplyInstructions(api.store.getState()),
        status === "changed",
      );
      assert.equal(
        selectors.canRemoveInstructions(api.store.getState()),
        status === "changed",
      );
      assert.equal(instruction().observation.origin, undefined);
      api.dispose();
    });
});

test("instructions late read cannot cross session, epoch, root, trust, floor or discard ABA", async (t) => {
  for (const change of [
    "session",
    "epoch",
    "root",
    "trust",
    "floor",
    "discard",
  ])
    await t.test(change, async () => {
      const pending = deferred();
      const { api, instruction } = instructionFixture({
        read: () => pending.promise,
      });
      const reading = api.actions.observeInstructions();
      await flush();
      if (change === "session") {
        api.actions.select("w", "b");
        seed(api.store, snapshot(1, "b"));
        api.actions.select("w", "a");
        seed(api.store);
      }
      if (change === "epoch")
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
        });
      if (change === "root")
        seed(
          api.store,
          snapshot(1, "a", { workspaces: [{ ...workspace(), path: "/new" }] }),
        );
      if (change === "trust")
        seed(api.store, snapshot(1, "a", { workspaces: [workspace("w", 2)] }));
      if (change === "floor") seed(api.store, snapshot(2));
      if (change === "discard") {
        api.actions.discardConfigurationDraft("instructions");
        api.actions.editConfigurationDraft("instructions", "new");
      }
      pending.resolve({
        ok: true,
        value: {
          workspaceId: "w",
          sessionId: "a",
          status: "missing",
          version: instructionVersion,
        },
      });
      await reading;
      assert.equal(instruction().observation, undefined);
      assert.equal(
        selectors.canRemoveInstructions(api.store.getState()),
        false,
      );
      api.dispose();
    });
});

test("instructions late ACK changes original operation only after edit, discard ABA, selection or epoch", async (t) => {
  for (const change of ["edit", "discard", "selection", "epoch", "root"])
    await t.test(change, async () => {
      const pending = deferred();
      const { api, h, instruction } = instructionFixture({
        mutate: () => pending.promise,
      });
      await api.actions.loadConfigurationDraft("instructions");
      await api.actions.observeInstructions();
      const applying = api.actions.applyInstructions();
      // SHA-256 is asynchronous; let dispatch happen before changing the target.
      for (
        let i = 0;
        i < 10 &&
        !h.calls.some(
          (e) => e.operation.type === "configuration.instructions.apply",
        );
        i++
      )
        await new Promise((resolve) => setImmediate(resolve));
      const e = h.calls.find(
        (e) => e.operation.type === "configuration.instructions.apply",
      );
      assert.ok(e);
      const key = operationKey(e.runtimeEpoch, e.operationId);
      if (change === "edit")
        api.actions.editConfigurationDraft("instructions", "newer");
      if (change === "discard") {
        api.actions.discardConfigurationDraft("instructions");
        api.actions.editConfigurationDraft("instructions", "original");
      }
      if (change === "selection") {
        api.actions.select("w", "b");
        seed(api.store, snapshot(1, "b"));
        api.actions.select("w", "a");
        seed(api.store);
      }
      if (change === "epoch")
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
        });
      if (change === "root")
        seed(
          api.store,
          snapshot(1, "a", { workspaces: [{ ...workspace(), path: "/new" }] }),
        );
      const drafts = api.store.getState().configurationDrafts;
      pending.resolve(instructionConfirmed(e));
      assert.equal(await applying, true);
      assert.equal(api.store.getState().operations[key].status, "accepted");
      assert.equal(api.store.getState().configurationDrafts, drafts);
      assert.equal(instruction().observation, undefined);
      if (change === "edit") assert.equal(instruction().action.current, false);
      else assert.equal(instruction().action, undefined);
      api.dispose();
    });
});

test("instructions unknown is lookup only, never resends, retains text and blocks dependent mutations", async () => {
  const { api, h, instruction } = instructionFixture({
    mutate: (e) => ({
      ok: true,
      value: { requestId: e.operation.requestId, status: "unknown" },
    }),
  });
  await api.actions.loadConfigurationDraft("instructions");
  await api.actions.observeInstructions();
  assert.equal(await api.actions.applyInstructions(), false);
  await flush();
  const e = h.calls.find(
    (e) => e.operation.type === "configuration.instructions.apply",
  );
  const intent =
    api.store.getState().operations[
      operationKey(e.runtimeEpoch, e.operationId)
    ];
  assert.equal(intent.lookupOnly, true);
  assert.deepEqual(intent.operation, {
    type: e.operation.type,
    workspaceId: "w",
    sessionId: "a",
  });
  assert.equal(instruction().action.status, "unknown");
  assert.equal(
    selectors.configurationDraft("instructions")(api.store.getState()).text,
    "original",
  );
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  assert.equal(await api.actions.applyInstructions(), false);
  assert.equal(await api.actions.removeInstructions(), false);
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), false);
  assert.equal(await api.actions.mutate(send()), false);
  assert.equal(
    h.calls.filter(
      (e) => e.operation.type === "configuration.instructions.apply",
    ).length,
    1,
  );
  assert.ok(
    h.calls.some(
      (e) =>
        e.operation.type === "operation.lookup" &&
        e.operation.runtimeEpoch === e.runtimeEpoch,
    ),
  );
  api.dispose();
});

test("instructions retained lookup uses current envelope and original composite key without fabricating payload", async () => {
  const h = bridgeHarness((e) =>
    e.operation.type === "operation.lookup"
      ? {
          ok: true,
          value: {
            status: "found",
            runtimeEpoch: "old-epoch",
            operationId: "old-instruction",
            receipt: {
              runtimeEpoch: "old-epoch",
              operationId: "old-instruction",
              type: "configuration.instructions.apply",
              workspaceId: "w",
              sessionId: "a",
              admission: "dispatched",
              delivery: "accepted",
              effect: "confirmed",
              revision: 99,
              evidence: [{ kind: "host-registry", id: "a" }],
              result: {
                kind: "instruction_registered",
                workspaceId: "w",
                sessionId: "a",
                digest: instructionDigest,
                sourceVersion: "a".repeat(64),
              },
            },
          },
        }
      : readFallback(e),
  );
  const clock = fakeClock();
  const api = createWindowWorkbench(h.bridge, { clock, id });
  const retained = {
    authorityHold: true,
    runtimeEpoch: "old-epoch",
    operationId: "old-instruction",
    type: "configuration.instructions.apply",
    workspaceId: "w",
    sessionId: "a",
  };
  seed(api.store, snapshot(3, "a", { retainedOperations: [retained] }));
  const key = operationKey(retained.runtimeEpoch, retained.operationId);
  assert.deepEqual(api.store.getState().operations[key].operation, {
    type: retained.type,
    workspaceId: "w",
    sessionId: "a",
  });
  api.start();
  await flush();
  const lookup = h.calls.find((e) => e.operation.type === "operation.lookup");
  assert.ok(lookup);
  assert.equal(lookup.runtimeEpoch, "epoch-a");
  assert.equal(lookup.operation.runtimeEpoch, "old-epoch");
  assert.equal(lookup.operation.operationId, "old-instruction");
  assert.equal(api.store.getState().operations[key].status, "accepted");
  assert.equal(api.store.getState().revision, 3);
  assert.equal(
    selectors.instructions(api.store.getState()).observation,
    undefined,
  );
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  assert.equal(
    h.calls.some(
      (e) => e.operation.type === "configuration.instructions.apply",
    ),
    false,
  );
  api.dispose();
});

test("instructions rejects mismatched response and receipt success; no wrong type or cross-scope success", async (t) => {
  const changes = {
    request: (result) => {
      result.value.requestId = "other";
    },
    digest: (result) => {
      result.value.digest = "d".repeat(64);
      result.receipt.result.digest = result.value.digest;
    },
    source: (result) => {
      result.value.sourceVersion = "d".repeat(64);
      result.receipt.result.sourceVersion = result.value.sourceVersion;
    },
    session: (result) => {
      result.receipt.sessionId = "b";
      result.receipt.result.sessionId = "b";
    },
    workspace: (result) => {
      result.receipt.workspaceId = "other";
      result.receipt.result.workspaceId = "other";
    },
    admitted: (result) => {
      result.receipt.admission = "admitted";
    },
    pending: (result) => {
      result.receipt.delivery = "pending";
    },
    effect: (result) => {
      result.receipt.effect = "pending";
    },
    origin: (result) => {
      result.value.origin = "direct";
    },
    receiptOrigin: (result) => {
      result.receipt.result.origin = "direct";
    },
    type: (result) => {
      result.receipt.type = "configuration.instructions.remove";
    },
    kind: (result) => {
      result.receipt.result = {
        kind: "instruction_removed",
        workspaceId: "w",
        sessionId: "a",
      };
    },
    floor: (result) => {
      result.receipt.revision = 1;
    },
    noEvidence: (result) => {
      result.receipt.evidence = [];
    },
    errorSuccess: (result) => {
      result.ok = false;
      result.code = "CANCELLED";
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { api, instruction } = instructionFixture({
        mutate: (e) => {
          const result = instructionConfirmed(e);
          change(result);
          return result;
        },
      });
      await api.actions.loadConfigurationDraft("instructions");
      await api.actions.observeInstructions();
      assert.equal(await api.actions.applyInstructions(), false);
      assert.equal(instruction().action.status, "unknown");
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
      api.dispose();
    });
});

test("instructions denial and changed source retain draft, invalidate baseline and require explicit reread", async (t) => {
  for (const code of [
    "CANCELLED",
    "INSTRUCTIONS_CHANGED",
    "FILE_CHANGED",
    "AUTH_REQUIRED",
  ])
    await t.test(code, async () => {
      const { api, instruction } = instructionFixture({
        mutate: (e) => ({
          ok: false,
          code,
          message: code,
          receipt: receipt(e, {
            admission: "rejected",
            delivery: "pending",
            effect: "none",
            evidence: [],
            result: { kind: "rejected", code },
          }),
        }),
      });
      await api.actions.loadConfigurationDraft("instructions");
      await api.actions.observeInstructions();
      const draft = selectors.configurationDraft("instructions")(
        api.store.getState(),
      );
      assert.equal(await api.actions.applyInstructions(), false);
      assert.equal(
        instruction().action.status,
        code === "INSTRUCTIONS_CHANGED" ? "changed" : "denied",
      );
      assert.equal(instruction().observation, undefined);
      assert.equal(
        selectors.configurationDraft("instructions")(api.store.getState()).text,
        draft.text,
      );
      assert.equal(selectors.canApplyInstructions(api.store.getState()), false);
      assert.equal(
        selectors.canObserveInstructions(api.store.getState()),
        true,
      );
      assert.equal(await api.actions.observeInstructions(), true);
      assert.equal(
        selectors.canApplyInstructions(api.store.getState()),
        code !== "FILE_CHANGED",
      );
      api.dispose();
    });
});

test("instructions same bytes child apply is direct only after fresh read and never inferred from parent", async () => {
  let origin = "fork";
  const { api, h, instruction } = instructionFixture({
    read: () => ({
      ok: true,
      value: {
        workspaceId: "w",
        sessionId: "a",
        status: "registered",
        version: instructionVersion,
        digest: instructionDigest,
        sourceVersion: "a".repeat(64),
        origin,
        ...(origin === "fork" ? { inheritedFromSessionId: "b" } : {}),
      },
    }),
    mutate: (e) => {
      origin = "direct";
      return instructionConfirmed(e);
    },
  });
  seed(
    api.store,
    snapshot(1, "a", {
      sessions: [session("a", "w", { parentSessionId: "b" }), session("b")],
    }),
  );
  await api.actions.loadConfigurationDraft("instructions");
  await api.actions.observeInstructions();
  assert.equal(instruction().observation.origin, "fork");
  await api.actions.applyInstructions();
  assert.equal(instruction().observation, undefined);
  seed(
    api.store,
    snapshot(2, "a", {
      sessions: [session("a", "w", { parentSessionId: "b" }), session("b")],
    }),
  );
  await api.actions.observeInstructions();
  assert.equal(instruction().observation.origin, "direct");
  assert.equal(instruction().observation.inheritedFromSessionId, undefined);
  // Parent record changes neither provide nor overwrite the child's origin evidence.
  seed(
    api.store,
    snapshot(2, "a", {
      sessions: [
        session("a", "w", { parentSessionId: "b" }),
        session("b", "w", { title: "parent changed" }),
      ],
    }),
  );
  assert.equal(instruction().observation.origin, "direct");
  assert.equal(
    h.calls.filter(
      (e) => e.operation.type === "configuration.instructions.read",
    ).length,
    2,
  );
  api.dispose();
});

test("instructions fresh baseline is invalid after edit, replacement file, in-memory baseline, or floor advance", async (t) => {
  for (const change of [
    "edit",
    "memory",
    "floor",
    "untrusted",
    "running",
    "recovery",
    "resource",
  ])
    await t.test(change, async () => {
      const { api, h } = instructionFixture();
      await api.actions.loadConfigurationDraft("instructions");
      await api.actions.observeInstructions();
      if (change === "edit")
        api.actions.editConfigurationDraft("instructions", "unsaved");
      if (change === "memory")
        api.actions.baselineConfigurationDraft("instructions");
      if (change === "floor") seed(api.store, snapshot(2));
      if (change === "untrusted")
        seed(
          api.store,
          snapshot(1, "a", {
            workspaces: [{ ...workspace(), trusted: false }],
          }),
        );
      if (change === "running")
        seed(
          api.store,
          snapshot(1, "a", {
            sessions: [session("a", "w", { status: "running" }), session("b")],
          }),
        );
      if (change === "recovery")
        seed(
          api.store,
          snapshot(1, "a", {
            state: "unavailable",
            recovery: {
              store: { state: "recovery_required", reason: "storage_denied" },
              resources: [],
            },
          }),
        );
      if (change === "resource")
        seed(
          api.store,
          snapshot(1, "a", {
            recovery: {
              store: { state: "ready" },
              resources: [
                {
                  workspaceId: "w",
                  sessionId: "a",
                  state: "unavailable",
                  reason: "unresolved_operation",
                },
              ],
            },
          }),
        );
      assert.equal(await api.actions.applyInstructions(), false);
      assert.equal(
        h.calls.some(
          (e) => e.operation.type === "configuration.instructions.apply",
        ),
        false,
      );
      if (!["edit", "memory"].includes(change))
        assert.equal(
          selectors.instructionObservation(api.store.getState()),
          undefined,
        );
      api.dispose();
    });
});

test("instructions hash await rechecks immutable revision, draft lifetime, selection, file version and floor before dispatch", async (t) => {
  for (const change of ["edit", "discard", "selection", "floor", "file"])
    await t.test(change, async () => {
      const { api, h } = instructionFixture();
      await api.actions.loadConfigurationDraft("instructions");
      await api.actions.observeInstructions();
      const applying = api.actions.applyInstructions();
      if (change === "edit") {
        api.actions.editConfigurationDraft("instructions", "new");
        api.actions.editConfigurationDraft("instructions", "original");
      }
      if (change === "discard") {
        api.actions.discardConfigurationDraft("instructions");
        api.actions.editConfigurationDraft("instructions", "original");
      }
      if (change === "selection") {
        api.actions.select("w", "b");
        seed(api.store, snapshot(1, "b"));
        api.actions.select("w", "a");
        seed(api.store);
      }
      if (change === "floor") seed(api.store, snapshot(2));
      if (change === "file")
        await api.actions.loadConfigurationDraft("instructions");
      assert.equal(await applying, false);
      assert.equal(
        h.calls.some(
          (e) => e.operation.type === "configuration.instructions.apply",
        ),
        false,
      );
      api.dispose();
    });
});

test("instructions supported saved file baseline applies exact BOM or blank text, independent of draft format", async (t) => {
  for (const text of ["", "\ufeff", "\ufeff# instructions\r\n가"])
    await t.test(JSON.stringify(text), async () => {
      const calls = [];
      const digest = createHash("sha256").update(text).digest("hex");
      const api = createWindowWorkbench(
        {
          workbench(e) {
            calls.push(e);
            if (e.operation.type === "configuration.read")
              return { ok: true, value: configurationFile("old") };
            if (e.operation.type === "configuration.save")
              return configurationSaved(e);
            if (e.operation.type === "configuration.instructions.read")
              return {
                ok: true,
                value: {
                  workspaceId: "w",
                  sessionId: "a",
                  status: "missing",
                  version: instructionVersion,
                },
              };
            if (e.operation.type === "configuration.instructions.apply")
              return {
                ok: true,
                value: {
                  requestId: e.operation.requestId,
                  status: "registered",
                  digest,
                  sourceVersion: "b".repeat(64),
                },
                receipt: receipt(e, {
                  revision: 3,
                  result: {
                    kind: "instruction_registered",
                    workspaceId: "w",
                    sessionId: "a",
                    digest,
                    sourceVersion: "b".repeat(64),
                  },
                }),
              };
            return readFallback(e);
          },
          cancelRead: () => ({ ok: true, value: { status: "cancelled" } }),
        },
        { clock: fakeClock(), id },
      );
      seed(api.store);
      await api.actions.loadConfigurationDraft("instructions");
      api.actions.editConfigurationDraft("instructions", text);
      assert.equal(
        await api.actions.saveConfigurationDraft("instructions"),
        true,
      );
      assert.equal(
        calls.some((e) =>
          e.operation.type.startsWith("configuration.instructions."),
        ),
        false,
      );
      seed(api.store, snapshot(2));
      await api.actions.observeInstructions();
      assert.equal(selectors.canApplyInstructions(api.store.getState()), true);
      assert.equal(await api.actions.applyInstructions(), true);
      const e = calls.find(
        (e) => e.operation.type === "configuration.instructions.apply",
      );
      assert.equal(e.operation.text, text);
      assert.equal(e.operation.fileVersion, "b".repeat(64));
      assert.equal(e.expectedRevision, 2);
      assert.equal(
        selectors.configurationDraft("instructions")(api.store.getState())
          .fileSave.status,
        "saved",
      );
      api.dispose();
    });
});

test("instructions timeout preserves actual IO hold even after matching lookup; discard cannot enable replay", async () => {
  const pending = deferred();
  let e;
  const clock = fakeClock();
  const { api, h, instruction } = instructionFixture({
    clock,
    mutate: (envelope) => {
      e = envelope;
      return pending.promise;
    },
    lookup: () => ({
      ok: true,
      value: {
        status: "found",
        runtimeEpoch: e.runtimeEpoch,
        operationId: e.operationId,
        receipt: instructionConfirmed(e).receipt,
      },
    }),
  });
  await api.actions.loadConfigurationDraft("instructions");
  await api.actions.observeInstructions();
  const applying = api.actions.applyInstructions();
  while (!e) await new Promise((resolve) => setImmediate(resolve));
  await clock.advance(10000);
  await applying;
  await flush();
  assert.equal(instruction().action.status, "registered");
  assert.equal(instruction().observation, undefined);
  assert.equal(api.store.getState().configurationIO.saves, 1);
  seed(api.store, snapshot(2));
  api.actions.discardConfigurationDraft("instructions");
  assert.equal(await api.actions.observeInstructions(), false);
  assert.equal(await api.actions.removeInstructions(), false);
  assert.equal(await api.actions.loadConfigurationDraft("instructions"), false);
  assert.equal(
    h.calls.filter(
      (call) => call.operation.type === "configuration.instructions.apply",
    ).length,
    1,
  );
  pending.resolve(instructionConfirmed(e));
  await flush();
  assert.equal(api.store.getState().configurationIO.saves, 0);
  assert.equal(instruction().action, undefined);
  api.dispose();
});

test("instructions unknown lookup rejects malformed no-effect claims and never regresses dispatched evidence", async (t) => {
  for (const invalid of [
    "unknown-code",
    "dispatched",
    "wrong-result",
    "floor",
    "raw-fields",
  ])
    await t.test(invalid, async () => {
      const { api, h } = instructionFixture({
        mutate: (e) => ({
          ok: true,
          value: { requestId: e.operation.requestId, status: "unknown" },
          ...(invalid === "dispatched"
            ? {
                receipt: receipt(e, {
                  effect: "unknown",
                  delivery: "unknown",
                  evidence: [],
                  result: undefined,
                }),
              }
            : {}),
        }),
      });
      await api.actions.loadConfigurationDraft("instructions");
      await api.actions.observeInstructions();
      await api.actions.applyInstructions();
      const e = h.calls.find(
        (e) => e.operation.type === "configuration.instructions.apply",
      );
      const rejected = receipt(e, {
        admission: "rejected",
        delivery: "pending",
        effect: "none",
        evidence: [],
        result: { kind: "rejected", code: "CANCELLED" },
      });
      if (invalid === "unknown-code") rejected.result.code = "MADE_UP";
      if (invalid === "wrong-result")
        rejected.result = {
          kind: "instruction_removed",
          workspaceId: "w",
          sessionId: "a",
        };
      if (invalid === "floor") rejected.revision = 1;
      if (invalid === "raw-fields") rejected.result.text = "unexpected";
      const before = api.store.getState();
      api.store.dispatch({
        type: "receipt",
        id: operationKey(e.runtimeEpoch, e.operationId),
        receipt: rejected,
      });
      assert.equal(api.store.getState(), before);
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
      api.dispose();
    });
});

test("instructions selection, start, polling, refresh and refocus never auto read or mutate Native instructions", async () => {
  const clock = fakeClock();
  let refocus;
  const h = bridgeHarness(readFallback);
  const api = createWindowWorkbench(h.bridge, {
    clock,
    id,
    onRefocus: (listener) => {
      refocus = listener;
      return () => {};
    },
  });
  api.start();
  await flush();
  api.actions.select("w", "b");
  await flush();
  api.actions.select("w", "a");
  await flush();
  await clock.advance(4000);
  api.actions.refresh();
  await flush();
  refocus();
  await flush();
  assert.equal(
    h.calls.some((e) =>
      e.operation.type.startsWith("configuration.instructions."),
    ),
    false,
  );
  assert.equal(
    selectors.instructions(api.store.getState()).observation,
    undefined,
  );
  api.dispose();
});

// MCP fixtures use the actual frozen DTO and deterministic host naming helper.
const mcpVersion = "c".repeat(64);
const mcpSourceVersion = "a".repeat(64);
const mcpText = JSON.stringify({
  mcp: {
    servers: {
      demo: {
        type: "local",
        command: ["node", "server.mjs", "--complete-argv"],
        cwd: ".",
        disabled: false,
      },
    },
  },
});
const mcpNativeName = (sourceName = "demo", workspaceId = "w") =>
  hostMcpNativeName(workspaceId, sourceName);
const mcpOwned = (status = "disabled") => ({
  nativeName: mcpNativeName(),
  sourceName: "demo",
  status,
  ownership: "current_runtime",
  submittedDefinitionDigest: "d".repeat(64),
  sourceVersion: mcpSourceVersion,
});
function mcpFixture({
  read,
  mutate,
  lookup,
  text = mcpText,
  value = snapshot(1, undefined, { selectedSessionId: undefined }),
  clock = fakeClock(),
} = {}) {
  // Undefined is not a wire field.
  delete value.selectedSessionId;
  const h = bridgeHarness((e) => {
    if (e.operation.type === "configuration.mcp.read")
      return read
        ? read(e)
        : {
            ok: true,
            value: {
              workspaceId: e.operation.workspaceId,
              status: "observed",
              version: mcpVersion,
              servers: [],
            },
          };
    if (e.operation.type.startsWith("configuration.mcp."))
      return mutate ? mutate(e) : mcpConfirmed(e);
    if (e.operation.type === "configuration.read")
      return {
        ok: true,
        value: {
          workspaceId: "w",
          workspacePath: "/fixture",
          kind: "mcp",
          path: "/fixture/opencode.json",
          status: "available",
          content: text,
          version: mcpSourceVersion,
        },
      };
    if (e.operation.type === "operation.lookup" && lookup) return lookup(e);
    return readFallback(e);
  });
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store, value);
  return { api, h, clock, mcp: () => selectors.mcp(api.store.getState()) };
}
function mcpConfirmed(e, connectionStatus = "connected") {
  const action = e.operation.type.split(".").at(-1);
  const common = {
    sourceName: e.operation.sourceName,
    nativeName: mcpNativeName(e.operation.sourceName, e.operation.workspaceId),
  };
  const details =
    action === "register"
      ? { digest: "d".repeat(64), sourceVersion: e.operation.fileVersion }
      : action === "remove"
        ? {}
        : {
            action,
            connectionStatus:
              action === "disconnect" ? "disabled" : connectionStatus,
          };
  return {
    ok: true,
    value: {
      requestId: e.operation.requestId,
      status:
        action === "register"
          ? "registered_disabled"
          : action === "remove"
            ? "removed"
            : "connection_status",
      ...common,
      ...details,
    },
    receipt: receipt(e, {
      evidence: [{ kind: "native-mcp" }],
      result: {
        kind:
          action === "register"
            ? "mcp_registered"
            : action === "remove"
              ? "mcp_removed"
              : "mcp_connection",
        workspaceId: e.operation.workspaceId,
        ...common,
        ...details,
        ...(action === "register" ? { status: "disabled" } : {}),
      },
    }),
  };
}
test("MCP is explicit and workspace scoped without a selected session; register exact file inactive", async () => {
  const { api, h, mcp } = mcpFixture();
  assert.equal(typeof api.actions.observeMcp, "function");
  assert.equal(selectors.canObserveMcp(api.store.getState()), true);
  assert.equal(selectors.canRegisterMcp(api.store.getState(), "demo"), false);
  await api.actions.loadConfigurationDraft("mcp");
  assert.equal(
    h.calls.some((e) => e.operation.type.startsWith("configuration.mcp.")),
    false,
  );
  assert.equal(await api.actions.observeMcp(), true);
  assert.equal(selectors.canRegisterMcp(api.store.getState(), "demo"), true);
  assert.equal(await api.actions.registerMcp("demo"), true);
  const e = h.calls.find(
    (e) => e.operation.type === "configuration.mcp.register",
  );
  assert.deepEqual(Object.keys(e.operation).sort(), [
    "expectedObservationVersion",
    "fileVersion",
    "requestId",
    "sourceName",
    "text",
    "type",
    "workspaceId",
  ]);
  assert.equal(e.operation.text, mcpText);
  assert.equal(e.operation.fileVersion, mcpSourceVersion);
  assert.equal(e.operation.expectedObservationVersion, mcpVersion);
  assert.equal(e.expectedRevision, 1);
  assert.equal(mcp().action.status, "registered_disabled");
  assert.equal(
    selectors.currentMcpObservation(api.store.getState()),
    undefined,
  );
  assert.equal(
    selectors.canObserveMcp(api.store.getState()),
    false,
    "receipt floor needs a fresh snapshot",
  );
  api.dispose();
});
test("MCP owned runtime controls require no file and failed/needs_auth attempts never claim connected", async (t) => {
  for (const status of ["connected", "failed", "needs_auth"])
    await t.test(status, async () => {
      const { api, h, mcp } = mcpFixture({
        read: () => ({
          ok: true,
          value: {
            workspaceId: "w",
            status: "observed",
            version: mcpVersion,
            servers: [mcpOwned()],
          },
        }),
        mutate: (e) => mcpConfirmed(e, status),
      });
      await api.actions.observeMcp();
      assert.equal(selectors.canConnectMcp(api.store.getState(), "demo"), true);
      assert.equal(await api.actions.connectMcp("demo"), true);
      assert.equal(mcp().action.status, status);
      assert.equal(
        h.calls.some((e) => e.operation.type === "configuration.read"),
        false,
      );
      api.dispose();
    });
});
test("MCP runtime remote conversion requires explicit oauth false but file validator stays inert", async () => {
  const text = JSON.stringify({
    mcp: {
      servers: { demo: { type: "remote", url: "https://example.test/mcp" } },
    },
  });
  const { api, h } = mcpFixture({ text });
  await api.actions.loadConfigurationDraft("mcp");
  await api.actions.observeMcp();
  assert.equal(
    selectors.configurationDraft("mcp")(api.store.getState()).text,
    text,
  );
  assert.equal(selectors.canRegisterMcp(api.store.getState(), "demo"), false);
  assert.equal(await api.actions.registerMcp("demo"), false);
  assert.equal(
    h.calls.some((e) => e.operation.type === "configuration.mcp.register"),
    false,
  );
  api.dispose();
});
test("MCP checks every workspace session and unknown workspace keys hold every session without replay", async () => {
  const { api, h, mcp } = mcpFixture({
    mutate: () => ({
      ok: true,
      value: { requestId: "unknown", status: "unknown" },
    }),
  });
  await api.actions.loadConfigurationDraft("mcp");
  await api.actions.observeMcp();
  await api.actions.registerMcp("demo");
  assert.equal(mcp().action.status, "unknown");
  const op = Object.values(api.store.getState().operations).find(
    (i) => i.operation.type === "configuration.mcp.register",
  );
  assert.equal(op.lookupOnly, true);
  assert.deepEqual(op.operation, {
    type: "configuration.mcp.register",
    workspaceId: "w",
  });
  assert.equal(
    mutationDisabled(api.store.getState(), {
      type: "message.send",
      workspaceId: "w",
      sessionId: "b",
    }),
    true,
  );
  api.actions.editConfigurationDraft("mcp", "editable unknown draft");
  assert.equal(
    selectors.configurationDraft("mcp")(api.store.getState()).text,
    "editable unknown draft",
  );
  api.actions.refresh();
  await flush();
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.mcp.register")
      .length,
    1,
  );
  api.dispose();
  const busy = mcpFixture({
    value: snapshot(1, "a", {
      sessions: [session("a"), session("b", "w", { status: "running" })],
    }),
  });
  assert.equal(selectors.canObserveMcp(busy.api.store.getState()), false);
  busy.api.dispose();
});

test("MCP late explicit read cannot cross workspace ABA, epoch, root, trust, floor, discard or cancel", async (t) => {
  for (const change of [
    "workspace",
    "epoch",
    "root",
    "trust",
    "floor",
    "discard",
    "cancel",
  ])
    await t.test(change, async () => {
      const pending = deferred();
      const { api, mcp } = mcpFixture({ read: () => pending.promise });
      const reading = api.actions.observeMcp();
      await flush();
      if (change === "workspace") {
        api.actions.select("other");
        seed(
          api.store,
          snapshot(1, "x", {
            workspaces: [workspace(), workspace("other")],
            sessions: [session("x", "other")],
            selectedWorkspaceId: "other",
          }),
        );
        api.actions.select("w");
        seed(api.store, snapshot(1, "a"));
      }
      if (change === "epoch")
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(1, undefined, { runtimeEpoch: "epoch-b" }),
        });
      if (change === "root")
        seed(
          api.store,
          snapshot(1, undefined, {
            workspaces: [{ ...workspace(), path: "/new" }],
          }),
        );
      if (change === "trust")
        seed(
          api.store,
          snapshot(1, undefined, { workspaces: [workspace("w", 2)] }),
        );
      if (change === "floor") seed(api.store, snapshot(2, undefined));
      if (change === "discard") {
        api.actions.discardConfigurationDraft("mcp");
        api.actions.editConfigurationDraft("mcp", mcpText);
      }
      if (change === "cancel") api.actions.cancelMcpObservation();
      pending.resolve({
        ok: true,
        value: {
          workspaceId: "w",
          status: "observed",
          version: mcpVersion,
          servers: [mcpOwned()],
        },
      });
      assert.equal(await reading, false);
      assert.equal(mcp().observation, undefined);
      assert.equal(
        selectors.canConnectMcp(api.store.getState(), "demo"),
        false,
      );
      api.dispose();
    });
});
test("MCP late ACK records only original operation and does not rewrite newer draft or new scope", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "workspace",
    "epoch",
    "root",
    "trust",
  ])
    await t.test(change, async () => {
      const pending = deferred();
      const { api, h, mcp } = mcpFixture({ mutate: () => pending.promise });
      await api.actions.loadConfigurationDraft("mcp");
      await api.actions.observeMcp();
      const registering = api.actions.registerMcp("demo");
      // Web Crypto finishes on the event loop, not in a microtask-only flush.
      for (
        let i = 0;
        i < 40 &&
        !h.calls.some((e) => e.operation.type === "configuration.mcp.register");
        i++
      )
        await new Promise((resolve) => setImmediate(resolve));
      const e = h.calls.find(
        (e) => e.operation.type === "configuration.mcp.register",
      );
      assert.ok(e);
      if (change === "edit")
        api.actions.editConfigurationDraft("mcp", "new draft");
      if (change === "discard") {
        api.actions.discardConfigurationDraft("mcp");
        api.actions.editConfigurationDraft("mcp", mcpText);
      }
      if (change === "workspace") {
        api.actions.select("other");
        seed(
          api.store,
          snapshot(1, "x", {
            workspaces: [workspace(), workspace("other")],
            sessions: [session("x", "other")],
            selectedWorkspaceId: "other",
          }),
        );
      }
      if (change === "epoch")
        api.store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(api.store.getState()), bootstrap: true },
          value: snapshot(1, undefined, { runtimeEpoch: "epoch-b" }),
        });
      if (change === "root")
        seed(
          api.store,
          snapshot(1, undefined, {
            workspaces: [{ ...workspace(), path: "/new" }],
          }),
        );
      if (change === "trust")
        seed(
          api.store,
          snapshot(1, undefined, { workspaces: [workspace("w", 2)] }),
        );
      const before = selectors.configurationDraft("mcp")(api.store.getState());
      pending.resolve(mcpConfirmed(e));
      assert.equal(await registering, true);
      assert.equal(
        api.store.getState().operations[
          operationKey(e.runtimeEpoch, e.operationId)
        ].status,
        "accepted",
      );
      assert.equal(
        selectors.configurationDraft("mcp")(api.store.getState()),
        before,
      );
      assert.equal(
        selectors.currentMcpObservation(api.store.getState()),
        undefined,
      );
      if (change === "edit") assert.equal(mcp().action.current, false);
      else assert.equal(mcp().action, undefined);
      api.dispose();
    });
});
test("MCP rejects malformed catalog, unowned authority and false receipt success", async (t) => {
  const good = {
    workspaceId: "w",
    status: "observed",
    version: mcpVersion,
    servers: [mcpOwned()],
  };
  for (const [name, value] of Object.entries({
    workspace: { ...good, workspaceId: "other" },
    extra: { ...good, pid: 1 },
    version: { ...good, version: "bad" },
    duplicate: { ...good, servers: [mcpOwned(), mcpOwned()] },
    unsupported: { ...good, servers: [{ ...mcpOwned(), status: "invented" }] },
    unowned: { ...good, servers: [{ ...mcpOwned(), ownership: "unowned" }] },
  }))
    await t.test(name, async () => {
      const { api, mcp } = mcpFixture({ read: () => ({ ok: true, value }) });
      assert.equal(await api.actions.observeMcp(), false);
      assert.equal(mcp().observation, undefined);
      assert.equal(selectors.canRemoveMcp(api.store.getState(), "demo"), false);
      api.dispose();
    });
  const changes = {
    request: (r) => {
      r.value.requestId = "other";
    },
    native: (r) => {
      r.value.nativeName = mcpNativeName("other");
      r.receipt.result.nativeName = r.value.nativeName;
    },
    source: (r) => {
      r.value.sourceName = "other";
      r.receipt.result.sourceName = "other";
    },
    version: (r) => {
      r.value.sourceVersion = "b".repeat(64);
      r.receipt.result.sourceVersion = r.value.sourceVersion;
    },
    digest: (r) => {
      r.value.digest = "e".repeat(64);
    },
    workspace: (r) => {
      r.receipt.workspaceId = "other";
      r.receipt.result.workspaceId = "other";
    },
    session: (r) => {
      r.receipt.sessionId = "a";
    },
    admitted: (r) => {
      r.receipt.admission = "admitted";
    },
    floor: (r) => {
      r.receipt.revision = 1;
    },
    evidence: (r) => {
      r.receipt.evidence = [];
    },
    raw: (r) => {
      r.receipt.result.text = "forbidden";
    },
    status: (r) => {
      r.receipt.result.status = "connected";
    },
    wrongkind: (r) => {
      r.receipt.result = {
        kind: "mcp_removed",
        workspaceId: "w",
        sourceName: "demo",
        nativeName: mcpNativeName(),
      };
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { api, mcp } = mcpFixture({
        mutate: (e) => {
          const r = mcpConfirmed(e);
          change(r);
          return r;
        },
      });
      await api.actions.loadConfigurationDraft("mcp");
      await api.actions.observeMcp();
      assert.equal(await api.actions.registerMcp("demo"), false);
      assert.equal(mcp().action.status, "unknown");
      assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
      api.dispose();
    });
});
test("MCP disconnect and verified already absent removal complete without reading a file", async (t) => {
  for (const action of ["disconnect", "remove"])
    await t.test(action, async () => {
      const { api, h, mcp } = mcpFixture({
        read: () => ({
          ok: true,
          value: {
            workspaceId: "w",
            status: "observed",
            version: mcpVersion,
            servers: [mcpOwned(action === "remove" ? "absent" : "connected")],
          },
        }),
        mutate: (e) => {
          const r = mcpConfirmed(e);
          if (action === "remove") {
            r.receipt.effect = "none";
            r.receipt.admission = "admitted";
            r.receipt.evidence = [];
          }
          return r;
        },
      });
      await api.actions.observeMcp();
      assert.equal(
        await api.actions[action === "remove" ? "removeMcp" : "disconnectMcp"](
          "demo",
        ),
        true,
      );
      assert.equal(
        mcp().action.status,
        action === "remove" ? "removed" : "disconnected",
      );
      assert.equal(api.store.getState().revision, 2);
      assert.equal(
        h.calls.some((e) => e.operation.type === "configuration.read"),
        false,
      );
      api.dispose();
    });
});
test("MCP retained original keys restore lookup-only history and never grant current runtime ownership", async () => {
  const retained = {
    authorityHold: true,
    runtimeEpoch: "epoch-old",
    operationId: "held-mcp",
    type: "configuration.mcp.register",
    workspaceId: "w",
  };
  const { api, h } = mcpFixture({
    value: snapshot(2, undefined, { retainedOperations: [retained] }),
  });
  const key = operationKey(retained.runtimeEpoch, retained.operationId);
  assert.deepEqual(api.store.getState().operations[key].operation, {
    type: retained.type,
    workspaceId: "w",
  });
  assert.equal(api.store.getState().operations[key].lookupOnly, true);
  assert.equal(selectors.canObserveMcp(api.store.getState()), false);
  api.actions.refresh();
  await flush();
  const lookup = h.calls.find((e) => e.operation.type === "operation.lookup");
  assert.equal(lookup.runtimeEpoch, "epoch-a");
  assert.equal(lookup.operation.runtimeEpoch, "epoch-old");
  assert.equal(lookup.operation.operationId, "held-mcp");
  assert.equal(
    h.calls.some((e) => e.operation.type.startsWith("configuration.mcp.")),
    false,
  );
  assert.equal(
    selectors.currentMcpObservation(api.store.getState()),
    undefined,
  );
  api.dispose();
});

test("MCP rechecks original draft baseline and workspace authority after async target hashing", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "selection",
    "floor",
    "file",
    "baseline",
    "trust",
    "other-session-running",
    "permission",
  ])
    await t.test(change, async () => {
      const { api, h } = mcpFixture();
      await api.actions.loadConfigurationDraft("mcp");
      await api.actions.observeMcp();
      const registering = api.actions.registerMcp("demo");
      if (change === "edit") {
        api.actions.editConfigurationDraft("mcp", "new");
        api.actions.editConfigurationDraft("mcp", mcpText);
      }
      if (change === "discard") {
        api.actions.discardConfigurationDraft("mcp");
        api.actions.editConfigurationDraft("mcp", mcpText);
      }
      if (change === "selection") {
        api.actions.select("w", "b");
        seed(api.store, snapshot(1, "b"));
      }
      if (change === "floor") seed(api.store, snapshot(2, undefined));
      if (change === "file") await api.actions.loadConfigurationDraft("mcp");
      if (change === "baseline") api.actions.baselineConfigurationDraft("mcp");
      if (change === "trust")
        seed(
          api.store,
          snapshot(1, undefined, { workspaces: [workspace("w", 2)] }),
        );
      if (change === "other-session-running")
        seed(
          api.store,
          snapshot(1, undefined, {
            sessions: [session("a"), session("b", "w", { status: "running" })],
          }),
        );
      if (change === "permission")
        seed(
          api.store,
          snapshot(1, undefined, {
            permissions: [
              {
                id: "p",
                workspaceId: "w",
                sessionId: "b",
                permission: "read",
                patterns: [],
              },
            ],
          }),
        );
      assert.equal(await registering, false);
      assert.equal(
        h.calls.some((e) => e.operation.type === "configuration.mcp.register"),
        false,
      );
      api.dispose();
    });
});
test("MCP explicit remote oauth false and whitespace preserve exact submitted bytes and source name grammar", async () => {
  const sourceName = "_" + "a".repeat(79);
  const text =
    " \n" +
    JSON.stringify({
      mcp: {
        servers: {
          [sourceName]: {
            type: "remote",
            url: "http://127.0.0.1:31337/mcp",
            oauth: false,
          },
        },
      },
    });
  const { api, h, mcp } = mcpFixture({ text });
  await api.actions.loadConfigurationDraft("mcp");
  await api.actions.observeMcp();
  assert.equal(
    selectors.canRegisterMcp(api.store.getState(), sourceName),
    true,
  );
  assert.equal(await api.actions.registerMcp(sourceName), true);
  assert.equal(
    h.calls.find((e) => e.operation.type === "configuration.mcp.register")
      .operation.text,
    text,
  );
  assert.equal(
    mcp().action.identity.nativeName,
    hostMcpNativeName("w", sourceName),
  );
  api.dispose();
});
test("MCP unknown lookup resolves only its original key, blocks all sessions and global changes, and cannot regress dispatch", async () => {
  let original;
  let lookupResult;
  const { api, h, mcp, clock } = mcpFixture({
    mutate: (e) => {
      original = e;
      return {
        ok: true,
        value: { requestId: e.operation.requestId, status: "unknown" },
        receipt: receipt(e, {
          effect: "unknown",
          delivery: "unknown",
          evidence: [],
          result: undefined,
        }),
      };
    },
    lookup: (e) =>
      lookupResult
        ? {
            ok: true,
            value: {
              status: "found",
              runtimeEpoch: e.operation.runtimeEpoch,
              operationId: e.operation.operationId,
              receipt: lookupResult,
            },
          }
        : readFallback(e),
  });
  await api.actions.loadConfigurationDraft("mcp");
  await api.actions.observeMcp();
  await api.actions.registerMcp("demo");
  assert.equal(mcp().action.status, "unknown");
  assert.equal(
    mutationDisabled(api.store.getState(), { type: "workspace.import" }),
    true,
  );
  assert.equal(
    mutationDisabled(api.store.getState(), {
      type: "message.send",
      workspaceId: "other",
      sessionId: "x",
    }),
    false,
  );
  assert.equal(await api.actions.loadConfigurationDraft("mcp"), false);
  const key = operationKey(original.runtimeEpoch, original.operationId);
  const before = api.store.getState();
  api.store.dispatch({
    type: "receipt",
    id: key,
    receipt: receipt(original, {
      revision: 3,
      effect: "none",
      admission: "rejected",
      delivery: "pending",
      evidence: [],
      result: { kind: "rejected", code: "CANCELLED" },
    }),
  });
  assert.equal(api.store.getState(), before);
  lookupResult = mcpConfirmed(original).receipt;
  await api.actions.refresh();
  await flush();
  await api.actions.registerMcp("demo");
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.mcp.register")
      .length,
    1,
  );
  await clock.advance(5000);
  assert.equal(api.store.getState().operations[key].status, "accepted");
  assert.equal(
    selectors.currentMcpObservation(api.store.getState()),
    undefined,
  );
  api.dispose();
});
test("MCP denied, collision and changed receipts preserve draft and require explicit fresh observation", async (t) => {
  for (const code of [
    "CANCELLED",
    "MCP_CHANGED",
    "MCP_OWNERSHIP_CONFLICT",
    "MCP_UNSUPPORTED",
    "FILE_CHANGED",
    "BUSY",
  ])
    await t.test(code, async () => {
      const { api, mcp } = mcpFixture({
        mutate: (e) => ({
          ok: false,
          code,
          message: code,
          receipt: receipt(e, {
            admission: "rejected",
            delivery: "pending",
            effect: "none",
            evidence: [],
            result: { kind: "rejected", code },
          }),
        }),
      });
      await api.actions.loadConfigurationDraft("mcp");
      await api.actions.observeMcp();
      assert.equal(await api.actions.registerMcp("demo"), false);
      assert.equal(
        mcp().action.status,
        ["MCP_CHANGED", "FILE_CHANGED"].includes(code) ? "changed" : "denied",
      );
      assert.equal(
        selectors.configurationDraft("mcp")(api.store.getState()).text,
        mcpText,
      );
      if (code === "FILE_CHANGED")
        assert.equal(
          selectors.configurationDraft("mcp")(api.store.getState())
            .fileObservation,
          undefined,
        );
      assert.equal(
        selectors.currentMcpObservation(api.store.getState()),
        undefined,
      );
      assert.equal(
        selectors.canRegisterMcp(api.store.getState(), "demo"),
        false,
      );
      api.dispose();
    });
});
test("MCP start, selection, polling, refresh and refocus do not observe or mutate MCP automatically", async () => {
  const clock = fakeClock();
  let refocus = () => {},
    visibility = () => {};
  const h = bridgeHarness(readFallback);
  const api = createWindowWorkbench(h.bridge, {
    clock,
    id,
    onRefocus: (listener) => {
      refocus = listener;
      return () => {};
    },
    onVisibility: (listener) => {
      visibility = listener;
      return () => {};
    },
  });
  api.start();
  await flush();
  api.actions.select("w", "b");
  await flush();
  api.actions.refresh();
  refocus();
  visibility();
  await clock.advance(6000);
  assert.equal(
    h.calls.some((e) => e.operation.type.startsWith("configuration.mcp.")),
    false,
  );
  api.dispose();
});

test("MCP valid unowned catalog rows stay read only; unsupported or absent host fails closed", async () => {
  const { api, h } = mcpFixture({
    read: () => ({
      ok: true,
      value: {
        workspaceId: "w",
        status: "observed",
        version: mcpVersion,
        servers: [
          {
            nativeName: mcpNativeName(),
            status: "disabled",
            ownership: "unowned",
          },
        ],
      },
    }),
  });
  assert.equal(await api.actions.observeMcp(), true);
  assert.equal(selectors.canConnectMcp(api.store.getState(), "demo"), false);
  assert.equal(selectors.canDisconnectMcp(api.store.getState(), "demo"), false);
  assert.equal(selectors.canRemoveMcp(api.store.getState(), "demo"), false);
  assert.equal(await api.actions.removeMcp("demo"), false);
  assert.equal(
    h.calls.filter((e) => e.operation.type !== "configuration.mcp.read").length,
    0,
  );
  api.dispose();
  const missing = mcpFixture({
    read: () => ({
      ok: false,
      code: "UNAVAILABLE",
      message: "not implemented",
    }),
  });
  await missing.api.actions.loadConfigurationDraft("mcp");
  assert.equal(await missing.api.actions.observeMcp(), false);
  assert.equal(await missing.api.actions.registerMcp("demo"), false);
  assert.equal(
    missing.h.calls.some(
      (e) => e.operation.type === "configuration.mcp.register",
    ),
    false,
  );
  missing.api.dispose();
});
test("MCP timed-out actual work retains IO hold after lookup and discard, and never replays", async () => {
  const pending = deferred();
  let original;
  let resolved = false;
  const { api, h, clock } = mcpFixture({
    mutate: (e) => {
      original = e;
      return pending.promise;
    },
    lookup: (e) =>
      resolved
        ? {
            ok: true,
            value: {
              status: "found",
              runtimeEpoch: e.operation.runtimeEpoch,
              operationId: e.operation.operationId,
              receipt: mcpConfirmed(original).receipt,
            },
          }
        : readFallback(e),
  });
  await api.actions.loadConfigurationDraft("mcp");
  await api.actions.observeMcp();
  const registering = api.actions.registerMcp("demo");
  for (let i = 0; i < 40 && !original; i++)
    await new Promise((resolve) => setImmediate(resolve));
  assert.ok(original);
  await clock.advance(10000);
  assert.equal(await registering, false);
  assert.equal(api.store.getState().configurationIO.saves, 1);
  api.actions.discardConfigurationDraft("mcp");
  api.actions.editConfigurationDraft("mcp", "new editable draft");
  resolved = true;
  await clock.advance(5000);
  assert.equal(
    api.store.getState().operations[
      operationKey(original.runtimeEpoch, original.operationId)
    ].status,
    "accepted",
  );
  assert.equal(selectors.canObserveMcp(api.store.getState()), false);
  assert.equal(await api.actions.loadConfigurationDraft("mcp"), false);
  pending.resolve(mcpConfirmed(original));
  await flush();
  assert.equal(api.store.getState().configurationIO.saves, 0);
  assert.equal(
    selectors.configurationDraft("mcp")(api.store.getState()).text,
    "new editable draft",
  );
  assert.equal(
    h.calls.filter((e) => e.operation.type === "configuration.mcp.register")
      .length,
    1,
  );
  api.dispose();
});

const skillPath = (name = "alpha") =>
  `/fixture/.opencode/skills/${name}/SKILL.md`;
const skillRead = (name = "alpha", content = "# Original\n") => ({
  workspaceId: "w",
  workspacePath: "/fixture",
  sourceName: name,
  path: skillPath(name),
  status: "available",
  content,
  version: "a".repeat(64),
  directoryVersion: "d".repeat(64),
});
function skillHarness(read = skillRead(), saveHandler) {
  const harness = bridgeHarness((e) => {
    if (e.operation.type === "configuration.skill.list")
      return {
        ok: true,
        value: {
          workspaceId: "w",
          workspacePath: "/fixture",
          path: "/fixture/.opencode/skills",
          status: "available",
          entries: ["alpha", "beta"].map((sourceName) => ({
            sourceName,
            path: skillPath(sourceName),
          })),
          truncated: false,
        },
      };
    if (e.operation.type === "configuration.skill.read")
      return typeof read === "function"
        ? read(e)
        : {
            ok: true,
            value: {
              ...read,
              sourceName: e.operation.sourceName,
              path: skillPath(e.operation.sourceName),
            },
          };
    if (e.operation.type === "configuration.skill.save")
      return saveHandler?.(e) ?? { ok: false, code: "UNKNOWN_OUTCOME" };
    return readFallback(e);
  });
  const clock = fakeClock();
  const client = createWindowWorkbench(harness.bridge, {
    clock,
    id,
  });
  seed(client.store);
  return { ...harness, client, clock };
}
async function loadSkill(client, name = "alpha") {
  assert.equal(await client.actions.listSkillFiles(), true);
  client.actions.selectSkillFile(name);
  assert.equal(await client.actions.readSkillFile(), true);
}

test("Skill file drafts isolate A/B; selection ABA retires read authority", async () => {
  const { client, calls } = skillHarness();
  try {
    await loadSkill(client);
    client.actions.editSkillFile("# Alpha edit\n");
    client.actions.validateSkillFile();
    assert.equal(selectors.canSaveSkillFile(client.store.getState()), true);
    client.actions.selectSkillFile("beta");
    assert.equal(selectors.skillDraft(client.store.getState()).text, "");
    client.actions.editSkillFile("# Beta edit\n");
    client.actions.selectSkillFile("alpha");
    assert.equal(
      selectors.skillDraft(client.store.getState()).text,
      "# Alpha edit\n",
    );
    assert.equal(selectors.canSaveSkillFile(client.store.getState()), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.skill.read")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Skill missing leaf requires exact directoryVersion; unsafe DTO never grants save", async () => {
  for (const read of [
    {
      ...skillRead(),
      status: "missing",
      reason: "missing_file",
      content: undefined,
      version: undefined,
      directoryVersion: undefined,
    },
    { ...skillRead(), directoryVersion: undefined },
    { ...skillRead(), extra: "smuggled" },
  ]) {
    const { client } = skillHarness(read);
    try {
      await client.actions.listSkillFiles();
      client.actions.selectSkillFile("alpha");
      assert.equal(await client.actions.readSkillFile(), false);
      client.actions.editSkillFile("# New\n");
      client.actions.validateSkillFile();
      assert.equal(selectors.canSaveSkillFile(client.store.getState()), false);
    } finally {
      client.dispose();
    }
  }
});

test("Skill explicit read preserves unsupported grammar and permits supported correction", async () => {
  const { client } = skillHarness(
    skillRead("alpha", "---\nunknown: x\n---\n# Body\n"),
  );
  try {
    await loadSkill(client);
    client.actions.validateSkillFile();
    assert.equal(
      selectors.skillDraft(client.store.getState()).validation.status,
      "unsupported",
    );
    client.actions.editSkillFile("# Supported\n");
    client.actions.validateSkillFile();
    assert.equal(selectors.canSaveSkillFile(client.store.getState()), true);
  } finally {
    client.dispose();
  }
});

function skillSavedResponse(envelope, change = () => {}) {
  const backupId =
    envelope.operation.expectation === "version"
      ? `.omoc-configuration-${createHash("sha256").update(operationKey(envelope.runtimeEpoch, envelope.operationId)).digest("hex")}.skill.backup`
      : undefined;
  const value = {
    requestId: envelope.operation.requestId,
    status: "saved",
    version: "e".repeat(64),
    ...(backupId ? { backupId } : {}),
  };
  const ack = receipt(envelope, {
    evidence: [{ kind: "host-registry", id: "w" }],
    result: {
      kind: "skill_file_saved",
      workspaceId: "w",
      sourceName: envelope.operation.sourceName,
      version: value.version,
      ...(backupId ? { backupId } : {}),
    },
  });
  const response = { ok: true, value, receipt: ack };
  change(response);
  return response;
}
function editSkill(client, text = "# Edited\n") {
  client.actions.editSkillFile(text);
  client.actions.validateSkillFile();
}

test("Skill confirmed save submits exact baseline, retires read authority and waits for floor snapshot + explicit reread", async () => {
  const original = "\uFEFF# Original\r\n한글\n",
    { client, calls } = skillHarness(
      skillRead("alpha", original),
      skillSavedResponse,
    );
  try {
    await loadSkill(client);
    editSkill(client, "# Edited\r\n한글\n");
    assert.equal(await client.actions.saveSkillFile(), true);
    const sent = calls.find(
      (e) => e.operation.type === "configuration.skill.save",
    );
    assert.equal(sent.operation.version, "a".repeat(64));
    assert.equal(sent.operation.directoryVersion, "d".repeat(64));
    assert.equal(sent.operation.text, "# Edited\r\n한글\n");
    assert.equal(sent.expectedRevision, 1);
    const draft = selectors.skillDraft(client.store.getState());
    assert.equal(draft.baseline, original);
    assert.equal(draft.observation, undefined);
    assert.equal(draft.save.status, "saved");
    assert.equal(selectors.canReadSkillFiles(client.store.getState()), false);
    seed(client.store, snapshot(2));
    assert.equal(selectors.canSaveSkillFile(client.store.getState()), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.skill.read")
        .length,
      1,
    );
    assert.equal(await client.actions.readSkillFile(), true);
    editSkill(client);
    assert.equal(selectors.canSaveSkillFile(client.store.getState()), true);
  } finally {
    client.dispose();
  }
});

test("Skill missing leaf save sends required exact directoryVersion and never fabricates existing file version or backup", async () => {
  const read = {
    workspaceId: "w",
    workspacePath: "/fixture",
    sourceName: "alpha",
    path: skillPath(),
    status: "missing",
    reason: "missing_file",
    directoryVersion: "d".repeat(64),
  };
  const { client, calls } = skillHarness(read, skillSavedResponse);
  try {
    await loadSkill(client);
    editSkill(client);
    assert.equal(await client.actions.saveSkillFile(), true);
    const request = calls.find(
      (e) => e.operation.type === "configuration.skill.save",
    ).operation;
    assert.equal(request.expectation, "missing");
    assert.equal(request.directoryVersion, read.directoryVersion);
    assert.equal(Object.hasOwn(request, "version"), false);
    assert.equal(
      selectors.skillDraft(client.store.getState()).save.backupId,
      undefined,
    );
  } finally {
    client.dispose();
  }
});

test("Skill late explicit read rejects selection ABA, draft edits/discard, workspace, epoch, root, trust and floor", async (t) => {
  for (const change of [
    "source",
    "edit",
    "discard",
    "workspace",
    "epoch",
    "root",
    "trust",
    "floor",
    "cancel",
    "dispose",
  ])
    await t.test(change, async () => {
      const wait = deferred(),
        { client } = skillHarness(() => wait.promise);
      try {
        await client.actions.listSkillFiles();
        client.actions.selectSkillFile("alpha");
        const reading = client.actions.readSkillFile();
        await flush();
        if (change === "source") {
          client.actions.selectSkillFile("beta");
          client.actions.selectSkillFile("alpha");
        }
        if (change === "edit") client.actions.editSkillFile("# Later\n");
        if (change === "discard") {
          client.actions.discardSkillFile();
          client.actions.editSkillFile("# Replacement\n");
        }
        if (change === "workspace") {
          client.actions.select("other", "other-a");
          client.actions.select("w", "a");
          seed(client.store);
        }
        if (change === "epoch")
          client.store.dispatch({
            type: "snapshot",
            scope: { ...scopeOf(client.store.getState()), bootstrap: true },
            value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
          });
        if (change === "root")
          seed(
            client.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/replacement" }],
            }),
          );
        if (change === "trust")
          seed(
            client.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        if (change === "floor") seed(client.store, snapshot(2));
        if (change === "cancel") client.actions.cancelSkillRead();
        if (change === "dispose") client.dispose();
        wait.resolve({ ok: true, value: skillRead() });
        assert.equal(await reading, false);
        const draft = selectors.skillDraft(client.store.getState());
        assert.notEqual(draft.text, "# Original\n");
        assert.equal(draft.observation, undefined);
      } finally {
        client.dispose();
      }
    });
});

test("Skill async SHA rechecks immutable exact draft and scope before dispatch", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "workspace",
    "floor",
    "root",
    "trust",
    "running",
    "permission",
    "read",
    "dispose",
  ])
    await t.test(change, async () => {
      const { client, calls } = skillHarness();
      try {
        await loadSkill(client);
        editSkill(client);
        const saving = client.actions.saveSkillFile();
        if (change === "edit") {
          client.actions.editSkillFile("# Other\n");
          editSkill(client);
        }
        if (change === "discard") {
          client.actions.discardSkillFile();
          editSkill(client);
        }
        if (change === "source") {
          client.actions.selectSkillFile("beta");
          client.actions.selectSkillFile("alpha");
        }
        if (change === "workspace") {
          client.actions.select("w", "b");
          seed(client.store, snapshot(1, "b"));
        }
        if (change === "floor") seed(client.store, snapshot(2));
        if (change === "root")
          seed(
            client.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/other" }],
            }),
          );
        if (change === "trust")
          seed(
            client.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        if (change === "running")
          seed(
            client.store,
            snapshot(1, "a", {
              sessions: [
                session("a"),
                session("b", "w", { status: "running" }),
              ],
            }),
          );
        if (change === "permission")
          seed(
            client.store,
            snapshot(1, "a", {
              permissions: [
                {
                  id: "p",
                  workspaceId: "w",
                  sessionId: "b",
                  permission: "read",
                  patterns: [],
                },
              ],
            }),
          );
        if (change === "read") await client.actions.readSkillFile();
        if (change === "dispose") client.dispose();
        assert.equal(await saving, false);
        assert.equal(
          calls.some((e) => e.operation.type === "configuration.skill.save"),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Skill late ACK preserves later edits and cannot attach to discarded/source ABA or changed scope", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "workspace",
    "root",
    "trust",
    "epoch",
    "floor",
  ])
    await t.test(change, async () => {
      const wait = deferred();
      let envelope;
      const { client } = skillHarness(skillRead(), (e) => {
        envelope = e;
        return wait.promise;
      });
      try {
        await loadSkill(client);
        editSkill(client);
        const saving = client.actions.saveSkillFile();
        for (let n = 0; n < 30 && !envelope; n++)
          await new Promise((resolve) => setImmediate(resolve));
        assert.ok(envelope);
        if (change === "edit") client.actions.editSkillFile("# Later\n");
        if (change === "discard") {
          client.actions.discardSkillFile();
          editSkill(client, "# Replacement\n");
        }
        if (change === "source") {
          client.actions.selectSkillFile("beta");
          client.actions.selectSkillFile("alpha");
        }
        if (change === "workspace") {
          client.actions.select("w", "b");
          seed(client.store, snapshot(1, "b"));
        }
        if (change === "root")
          seed(
            client.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/other" }],
            }),
          );
        if (change === "trust")
          seed(
            client.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        if (change === "epoch")
          client.store.dispatch({
            type: "snapshot",
            scope: { ...scopeOf(client.store.getState()), bootstrap: true },
            value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
          });
        if (change === "floor") seed(client.store, snapshot(3));
        wait.resolve(skillSavedResponse(envelope));
        assert.equal(await saving, true);
        const draft = selectors.skillDraft(client.store.getState());
        if (change === "edit") {
          assert.equal(draft.text, "# Later\n");
          assert.equal(draft.save.current, false);
          assert.equal(draft.baseline, "# Original\n");
        }
        if (change === "discard") {
          assert.equal(draft.text, "# Replacement\n");
          assert.equal(draft.save, undefined);
        }
        if (
          ["source", "workspace", "root", "trust", "epoch"].includes(change)
        ) {
          assert.notEqual(draft.save?.status, "saved");
          assert.equal(selectors.skillSave(client.store.getState()), undefined);
        }
        assert.equal(
          selectors.canSaveSkillFile(client.store.getState()),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Skill malformed save DTO/receipt never grants success or raises floor", async (t) => {
  const cases = {
    request: (r) => (r.value.requestId = "other"),
    extra: (r) => (r.value.content = "# Received payload"),
    version: (r) => (r.value.version = "bad"),
    backup: (r) => {
      delete r.value.backupId;
      delete r.receipt.result.backupId;
    },
    source: (r) => (r.receipt.result.sourceName = "beta"),
    workspace: (r) => (r.receipt.result.workspaceId = "other"),
    session: (r) => (r.receipt.sessionId = "a"),
    type: (r) => (r.receipt.type = "configuration.save"),
    kind: (r) => (r.receipt.result.kind = "configuration_saved"),
    floor: (r) => (r.receipt.revision = 1),
    evidence: (r) => (r.receipt.evidence = []),
    admitted: (r) => (r.receipt.admission = "admitted"),
    raw: (r) => (r.receipt.result.content = "# Smuggled"),
    unknownSuccess: (r) => {
      r.value = { requestId: r.value.requestId, status: "unknown" };
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const { client } = skillHarness(skillRead(), (e) =>
        skillSavedResponse(e, change),
      );
      try {
        await loadSkill(client);
        editSkill(client);
        assert.equal(await client.actions.saveSkillFile(), false);
        assert.equal(
          selectors.skillDraft(client.store.getState()).save.status,
          "unknown",
        );
        assert.equal(client.store.getState().revision, 1);
      } finally {
        client.dispose();
      }
    });
});

test("Skill unknown holds original composite key, editable drafts and global resource mutations without replay", async () => {
  const { client, calls } = skillHarness();
  try {
    await loadSkill(client);
    editSkill(client);
    assert.equal(await client.actions.saveSkillFile(), false);
    const sent = calls.find(
        (e) => e.operation.type === "configuration.skill.save",
      ),
      key = operationKey(sent.runtimeEpoch, sent.operationId);
    assert.equal(client.store.getState().operations[key].lookupOnly, true);
    assert.deepEqual(client.store.getState().operations[key].operation, {
      type: "configuration.skill.save",
      workspaceId: "w",
    });
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(client.store.getState()), true);
    client.actions.editSkillFile("# Later\n");
    client.actions.discardSkillFile();
    editSkill(client, "# Replacement\n");
    assert.equal(await client.actions.saveSkillFile(), false);
    assert.equal(await client.actions.mutate(send()), false);
    assert.equal(await client.actions.listSkillFiles(), false);
    await flush();
    const lookup = calls.find((e) => e.operation.type === "operation.lookup");
    assert.equal(lookup.operation.operationId, sent.operationId);
    assert.equal(lookup.operation.runtimeEpoch, sent.runtimeEpoch);
    client.store.dispatch({
      type: "receipt",
      id: sent.operationId,
      receipt: skillSavedResponse(sent).receipt,
    });
    assert.equal(client.store.getState().operations[key].status, "unknown");
    client.store.dispatch({
      type: "receipt",
      id: key,
      receipt: skillSavedResponse(sent).receipt,
    });
    assert.equal(client.store.getState().operations[key].status, "accepted");
    assert.equal(selectors.skillDraft(client.store.getState()).save, undefined);
    assert.equal(
      selectors.skillDraft(client.store.getState()).text,
      "# Replacement\n",
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.skill.save")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Skill historical retained save restores lookup-only metadata with no draft or executable payload", async () => {
  const old = {
    authorityHold: true,
    runtimeEpoch: "epoch-old",
    operationId: "same-id",
    type: "configuration.skill.save",
    workspaceId: "w",
  };
  const harness = bridgeHarness(readFallback),
    client = createWindowWorkbench(harness.bridge, { clock: fakeClock(), id });
  try {
    seed(client.store, snapshot(5, "a", { retainedOperations: [old] }));
    const key = operationKey(old.runtimeEpoch, old.operationId),
      intent = client.store.getState().operations[key];
    assert.ok(intent);
    assert.equal(intent.lookupOnly, true);
    assert.equal(intent.skillSave, undefined);
    const ack = {
      runtimeEpoch: old.runtimeEpoch,
      operationId: old.operationId,
      type: old.type,
      workspaceId: "w",
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 3,
      evidence: [{ kind: "host-registry", id: "w" }],
      result: {
        kind: "skill_file_saved",
        workspaceId: "w",
        sourceName: "alpha",
        version: "a".repeat(64),
      },
    };
    client.store.dispatch({ type: "receipt", id: key, receipt: ack });
    assert.equal(client.store.getState().operations[key].status, "accepted");
    assert.deepEqual(client.store.getState().skillDrafts, {});
    assert.equal(client.store.getState().revision, 5);
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), true);
    seed(client.store, snapshot(5));
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), false);
  } finally {
    client.dispose();
  }
});

test("Skill start, selection, poll, refresh and refocus never list/read/save automatically", async () => {
  let refocus;
  const clock = fakeClock(),
    h = bridgeHarness(readFallback),
    client = createWindowWorkbench(h.bridge, {
      clock,
      id,
      onRefocus: (listener) => {
        refocus = listener;
        return () => {};
      },
    });
  try {
    client.start();
    await flush();
    client.actions.select("w", "b");
    await flush();
    await clock.advance(15000);
    client.actions.refresh();
    refocus();
    await flush();
    assert.equal(
      h.calls.some((e) => e.operation.type.startsWith("configuration.skill.")),
      false,
    );
  } finally {
    client.dispose();
  }
});

test("Skill snapshots copy accepted producer file bytes and version metadata", async () => {
  const response = skillRead(),
    { client } = skillHarness(() => ({ ok: true, value: response }));
  try {
    await loadSkill(client);
    response.content = "# Replaced\n";
    response.version = "f".repeat(64);
    response.directoryVersion = "f".repeat(64);
    const draft = selectors.skillDraft(client.store.getState());
    assert.equal(draft.read.content, "# Original\n");
    assert.equal(draft.read.version, "a".repeat(64));
    assert.equal(draft.read.directoryVersion, "d".repeat(64));
  } finally {
    client.dispose();
  }
});

test("Skill closed list rejects sparse/accessor entries without invoking getters", async (t) => {
  for (const shape of [
    "sparse",
    "getter",
    "null",
    "duplicate",
    "oversize",
    "extra",
    "truncated",
    "path",
    "source",
  ])
    await t.test(shape, async () => {
      let getterCalls = 0;
      const row = { sourceName: "alpha", path: skillPath() },
        value = {
          workspaceId: "w",
          workspacePath: "/fixture",
          path: "/fixture/.opencode/skills",
          status: "available",
          entries: [row],
          truncated: false,
        };
      if (shape === "sparse") value.entries = new Array(1);
      if (shape === "getter")
        Object.defineProperty(row, "sourceName", {
          get() {
            getterCalls++;
            return "alpha";
          },
        });
      if (shape === "null") value.entries = [null];
      if (shape === "duplicate") value.entries = [row, row];
      if (shape === "oversize")
        value.entries = Array.from({ length: 17 }, (_, i) => ({
          sourceName: `file${i}`,
          path: skillPath(`file${i}`),
        }));
      if (shape === "extra") row.content = "payload";
      if (shape === "truncated") value.truncated = "false";
      if (shape === "path") row.path = "/other/SKILL.md";
      if (shape === "source") row.sourceName = "../alpha";
      const h = bridgeHarness((e) =>
          e.operation.type === "configuration.skill.list"
            ? { ok: true, value }
            : readFallback(e),
        ),
        client = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
      try {
        seed(client.store);
        assert.equal(await client.actions.listSkillFiles(), false);
        assert.equal(getterCalls, 0);
        assert.equal(
          selectors.skillFiles(client.store.getState()).listing,
          undefined,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Skill retained target rejects missing workspace and session-bearing historical identities", () => {
  for (const extra of [{}, { workspaceId: "w", sessionId: "a" }]) {
    const store = createWorkbenchStore();
    seed(
      store,
      snapshot(1, "a", {
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "old",
            operationId: "x",
            type: "configuration.skill.save",
            ...extra,
          },
        ],
      }),
    );
    assert.equal(store.getState().snapshot, null);
  }
});

test("Skill source files bind workspace/root separately and retain intentional drafts across navigation", async () => {
  const { client } = skillHarness();
  try {
    await loadSkill(client);
    editSkill(client, "# W alpha\n");
    const first = selectors.skillDraft(client.store.getState());
    client.actions.select("other", "other-a");
    seed(
      client.store,
      snapshot(1, "other-a", {
        selectedWorkspaceId: "other",
        workspaces: [workspace("other")],
        sessions: [session("other-a", "other")],
      }),
    );
    assert.equal(selectors.skillDraft(client.store.getState()).text, "");
    client.actions.select("w", "a");
    seed(client.store);
    await client.actions.listSkillFiles();
    client.actions.selectSkillFile("alpha");
    assert.equal(
      selectors.skillDraft(client.store.getState()).text,
      first.text,
    );
    assert.equal(selectors.canSaveSkillFile(client.store.getState()), false);
    seed(
      client.store,
      snapshot(1, "a", {
        workspaces: [{ ...workspace(), path: "/replacement" }],
      }),
    );
    assert.equal(selectors.skillDraft(client.store.getState()).text, "");
    assert.equal(
      Object.values(client.store.getState().skillDrafts)[0].text,
      first.text,
    );
  } finally {
    client.dispose();
  }
});

test("Skill list preserves missing/denied/changed/truncated truth and copies accepted entries", async (t) => {
  for (const shape of ["missing", "denied", "changed", "truncated", "empty"])
    await t.test(shape, async () => {
      const value = {
        workspaceId: "w",
        workspacePath: "/fixture",
        path: "/fixture/.opencode/skills",
        ...(shape === "missing"
          ? { status: "missing", reason: "path_missing" }
          : shape === "denied"
            ? { status: "unavailable", reason: "path_denied" }
            : shape === "changed"
              ? { status: "unavailable", reason: "file_changed" }
              : {
                  status: "available",
                  entries:
                    shape === "empty"
                      ? []
                      : [{ sourceName: "alpha", path: skillPath() }],
                  truncated: shape === "truncated",
                }),
      };
      const h = bridgeHarness((e) =>
          e.operation.type === "configuration.skill.list"
            ? { ok: true, value }
            : readFallback(e),
        ),
        client = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
      try {
        seed(client.store);
        assert.equal(await client.actions.listSkillFiles(), true);
        const listing = selectors.skillFiles(client.store.getState()).listing;
        assert.equal(listing.status, value.status);
        assert.equal(listing.reason, value.reason);
        assert.equal(
          h.calls.some((e) => e.operation.type === "configuration.skill.read"),
          false,
        );
        if (shape === "truncated") {
          value.entries[0].sourceName = "beta";
          value.entries.length = 0;
          assert.equal(listing.entries[0].sourceName, "alpha");
          assert.equal(listing.truncated, true);
        }
      } finally {
        client.dispose();
      }
    });
});

test("Skill timeout keeps actual IO hold after lookup resolves; explicit new read waits for original IO settlement", async () => {
  const waiting = deferred();
  let envelope;
  const { client, calls, clock } = skillHarness(skillRead(), (e) => {
    envelope = e;
    return waiting.promise;
  });
  try {
    await loadSkill(client);
    editSkill(client);
    const saving = client.actions.saveSkillFile();
    for (let n = 0; n < 30 && !envelope; n++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(envelope);
    await clock.advance(10000);
    assert.equal(await saving, false);
    client.store.dispatch({
      type: "receipt",
      id: operationKey(envelope.runtimeEpoch, envelope.operationId),
      receipt: skillSavedResponse(envelope).receipt,
    });
    seed(client.store, snapshot(2));
    assert.equal(client.store.getState().configurationIO.saves, 1);
    assert.equal(selectors.canReadSkillFiles(client.store.getState()), false);
    client.actions.discardSkillFile();
    editSkill(client, "# Later\n");
    assert.equal(await client.actions.readSkillFile(), false);
    waiting.resolve(skillSavedResponse(envelope));
    await flush();
    assert.equal(client.store.getState().configurationIO.saves, 0);
    assert.equal(await client.actions.readSkillFile(), true);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.skill.save")
        .length,
      1,
    );
  } finally {
    waiting.resolve({ ok: false, code: "UNAVAILABLE" });
    client.dispose();
  }
});

test("Skill current-read/list selectors retire floor and source ABA authority", async () => {
  const { client } = skillHarness();
  try {
    await loadSkill(client);
    assert.equal(selectors.skillReadCurrent(client.store.getState()), true);
    assert.equal(selectors.skillListCurrent(client.store.getState()), true);
    client.actions.selectSkillFile("beta");
    client.actions.selectSkillFile("alpha");
    assert.equal(selectors.skillReadCurrent(client.store.getState()), false);
    assert.equal(await client.actions.readSkillFile(), true);
    seed(client.store, snapshot(2));
    assert.equal(selectors.skillReadCurrent(client.store.getState()), false);
    assert.equal(selectors.skillListCurrent(client.store.getState()), false);
  } finally {
    client.dispose();
  }
});

const skillRuntimeText =
  '---\nname: "Alpha"\nmetadata:\n  opencode/autoinvoke: true\n---\nUse exact content.\r\n';
const skillHash = (text) => createHash("sha256").update(text).digest("hex");
const skillRuntimeRow = (operationId = "original-register") => {
  const nativeId = `omoc-skill-${skillHash(JSON.stringify(["epoch-a", "w", "alpha", operationId]))}`;
  return {
    sourceName: "alpha",
    nativeId: `omoc-skill-${skillHash(JSON.stringify(["epoch-a", "w", "alpha", operationId]))}`,
    digest: skillHash(skillRuntimeText),
    nativeDigest: skillHash(
      JSON.stringify([
        nativeId,
        "Alpha",
        null,
        false,
        skillPath(),
        "Use exact content.\r\n",
      ]),
    ),
    registrationRuntimeEpoch: "epoch-a",
    registrationOperationId: operationId,
    name: "Alpha",
    autoinvoke: false,
    path: skillPath(),
    content: "Use exact content.\r\n",
    bodyDigest: skillHash("Use exact content.\r\n"),
  };
};
function skillRuntimeObservation(owned = [], extra = {}) {
  return {
    workspaceId: "w",
    workspacePath: "/fixture",
    runtimeEpoch: "epoch-a",
    status: "observed",
    observationId: "native-observation",
    owned,
    unowned: [],
    file: {
      sourceName: "alpha",
      status: "available",
      version: "a".repeat(64),
      directoryVersion: "d".repeat(64),
      digest: skillHash(skillRuntimeText),
    },
    session: { sessionId: "a", status: "observed", messages: [] },
    ...extra,
  };
}
function skillRuntimeConfirmed(e, row = skillRuntimeRow(e.operationId)) {
  const {
    sourceName,
    nativeId,
    digest,
    nativeDigest,
    registrationRuntimeEpoch,
    registrationOperationId,
    bodyDigest,
  } = row;
  const common = {
    sourceName,
    nativeId,
    digest,
    nativeDigest,
    registrationRuntimeEpoch,
    registrationOperationId,
  };
  const action = e.operation.type.split(".").at(-1);
  const value = {
    requestId: e.operationId,
    ...common,
    ...(action === "register"
      ? {
          status: "registered_disabled",
          version: "a".repeat(64),
          directoryVersion: "d".repeat(64),
          bodyDigest,
        }
      : action === "remove"
        ? { status: "removed" }
        : {
            status: "applied",
            sessionId: "a",
            nativeSessionId: "native-a",
            nativeMessageId: "skill-message",
            bodyDigest,
          }),
  };
  const { requestId: _requestId, status: _status, ...proof } = value;
  return {
    ok: true,
    value,
    receipt: receipt(e, {
      evidence: [{ kind: "dispatch", id: `native.skill.${action}` }],
      result: {
        kind: `skill_${action === "register" ? "registered" : action === "remove" ? "removed" : "applied"}`,
        workspaceId: "w",
        ...proof,
      },
    }),
  };
}
function skillRuntimeHarness({
  observation = skillRuntimeObservation(),
  mutate,
  lookup,
  fileText = skillRuntimeText,
  onRefocus,
} = {}) {
  const h = bridgeHarness((e) => {
    if (e.operation.type === "configuration.skill.list")
      return {
        ok: true,
        value: {
          workspaceId: "w",
          workspacePath: "/fixture",
          path: "/fixture/.opencode/skills",
          status: "available",
          entries: ["alpha", "beta"].map((sourceName) => ({
            sourceName,
            path: skillPath(sourceName),
          })),
          truncated: false,
        },
      };
    if (e.operation.type === "configuration.skill.read")
      return {
        ok: true,
        value: skillRead(e.operation.sourceName, fileText),
      };
    if (e.operation.type === "configuration.skill.runtime.read")
      return typeof observation === "function"
        ? observation(e)
        : { ok: true, value: observation };
    if (
      [
        "configuration.skill.register",
        "configuration.skill.remove",
        "configuration.skill.apply",
      ].includes(e.operation.type)
    )
      return (
        mutate?.(e) ??
        skillRuntimeConfirmed(
          e,
          e.operation.type.endsWith("register") ? undefined : skillRuntimeRow(),
        )
      );
    if (e.operation.type === "operation.lookup" && lookup) return lookup(e);
    return readFallback(e);
  });
  const clock = fakeClock(),
    client = createWindowWorkbench(h.bridge, {
      clock,
      id,
      ...(onRefocus ? { onRefocus } : {}),
    });
  seed(client.store);
  return { ...h, client, clock };
}

test("Native Skill explicit actions register exact unchanged file without session scope and retire observation at receipt floor", async () => {
  const { client, calls } = skillRuntimeHarness();
  try {
    await loadSkill(client);
    assert.equal(
      calls.some(
        (e) => e.operation.type === "configuration.skill.runtime.read",
      ),
      false,
    );
    assert.equal(await client.actions.registerSkill(), false);
    assert.equal(await client.actions.observeSkillRuntime(), true);
    const read = calls.find(
      (e) => e.operation.type === "configuration.skill.runtime.read",
    );
    assert.equal(read.operation.sourceName, "alpha");
    assert.equal(read.operation.sessionId, "a");
    assert.equal(selectors.canRegisterSkill(client.store.getState()), true);
    assert.equal(await client.actions.registerSkill(), true);
    const sent = calls.find(
      (e) => e.operation.type === "configuration.skill.register",
    );
    assert.equal(sent.operation.requestId, sent.operationId);
    assert.equal(Object.hasOwn(sent.operation, "sessionId"), false);
    assert.equal(Object.hasOwn(sent.operation, "text"), false);
    assert.equal(sent.operation.digest, skillHash(skillRuntimeText));
    assert.equal(sent.operation.version, "a".repeat(64));
    assert.equal(sent.operation.directoryVersion, "d".repeat(64));
    assert.equal(
      selectors.currentSkillRuntimeObservation(client.store.getState()),
      undefined,
    );
    assert.equal(await client.actions.observeSkillRuntime(), false);
    seed(client.store, snapshot(2));
    assert.equal(
      calls.filter(
        (e) => e.operation.type === "configuration.skill.runtime.read",
      ).length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Native Skill selected-session recorded ID blocks apply, unavailable history never means absent, foreign row stays read-only", async () => {
  for (const mode of ["absent", "recorded", "truncated", "foreign"]) {
    const row = skillRuntimeRow();
    const observation = skillRuntimeObservation(
      mode === "foreign" ? [] : [row],
      mode === "recorded"
        ? {
            session: {
              sessionId: "a",
              status: "observed",
              messages: [
                {
                  nativeId: row.nativeId,
                  messageId: "inherited-fact",
                  name: row.name,
                  bodyDigest: row.bodyDigest,
                },
              ],
            },
          }
        : mode === "truncated"
          ? {
              session: {
                sessionId: "a",
                status: "unavailable",
                reason: "history_truncated",
              },
            }
          : mode === "foreign"
            ? { unowned: [{ nativeId: row.nativeId, name: row.name }] }
            : {},
    );
    const { client, calls } = skillRuntimeHarness({ observation });
    try {
      await loadSkill(client);
      assert.equal(await client.actions.observeSkillRuntime(), true);
      assert.equal(
        selectors.canApplySkill(client.store.getState(), row.nativeId),
        mode === "absent",
      );
      assert.equal(
        await client.actions.applySkill(row.nativeId),
        mode === "absent",
      );
      if (mode === "absent") {
        const sent = calls.find(
          (e) => e.operation.type === "configuration.skill.apply",
        );
        assert.equal(sent.operation.sessionId, "a");
        assert.equal(sent.operation.requestId, sent.operationId);
      } else
        assert.equal(
          calls.some((e) => e.operation.type === "configuration.skill.apply"),
          false,
        );
      if (mode === "foreign")
        assert.equal(await client.actions.removeSkill(row.nativeId), false);
    } finally {
      client.dispose();
    }
  }
});

function waitForSkillRuntimeState(client, predicate) {
  if (predicate(client.store.getState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Skill runtime state checkpoint timed out"));
    }, 2000);
    const unsubscribe = client.store.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}
function changeSkillRuntimeScope(client, change) {
  if (change === "edit") client.actions.editSkillFile("# New draft\n");
  if (change === "discard") {
    client.actions.discardSkillFile();
    client.actions.editSkillFile("# Replacement\n");
  }
  if (change === "source") {
    client.actions.selectSkillFile("beta");
    client.actions.selectSkillFile("alpha");
  }
  if (change === "session") {
    client.actions.select("w", "b");
    client.actions.select("w", "a");
  }
  if (change === "workspace") client.actions.select("other", "other-a");
  if (change === "root")
    seed(
      client.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), path: "/changed" }] }),
    );
  if (change === "trust")
    seed(client.store, snapshot(1, "a", { workspaces: [workspace("w", 2)] }));
  if (change === "untrusted")
    seed(
      client.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), trusted: false }] }),
    );
  if (change === "epoch") {
    client.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(client.store.getState()), bootstrap: true },
      value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
    });
    assert.equal(client.store.getState().epoch, "epoch-b");
  }
  if (change === "floor") seed(client.store, snapshot(2));
  if (change === "cancel") client.actions.cancelSkillRuntimeObservation();
  if (change === "dispose") client.dispose();
  if (change === "running")
    seed(
      client.store,
      snapshot(1, "a", {
        sessions: [session("a"), session("b", "w", { status: "running" })],
      }),
    );
  if (change === "permission")
    seed(
      client.store,
      snapshot(1, "a", {
        permissions: [
          {
            id: "p",
            workspaceId: "w",
            sessionId: "a",
            permission: "read",
            patterns: [],
          },
        ],
      }),
    );
}

test("Native Skill late explicit observation drops selection ABA, draft edits/discard, epoch/root/trust/floor and cancellation", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "session",
    "workspace",
    "root",
    "trust",
    "untrusted",
    "epoch",
    "floor",
    "cancel",
    "dispose",
    "running",
    "permission",
  ])
    await t.test(change, async () => {
      const wait = deferred(),
        { client, calls } = skillRuntimeHarness({
          observation: () => wait.promise,
        });
      try {
        await loadSkill(client);
        const reading = client.actions.observeSkillRuntime();
        await flush();
        changeSkillRuntimeScope(client, change);
        wait.resolve({
          ok: true,
          value: skillRuntimeObservation([skillRuntimeRow()]),
        });
        assert.equal(await reading, false);
        assert.equal(
          selectors.currentSkillRuntimeObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          calls.some((e) =>
            [
              "configuration.skill.register",
              "configuration.skill.apply",
              "configuration.skill.remove",
            ].includes(e.operation.type),
          ),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Skill changed file baseline and unsupported or dirty content cannot register", async (t) => {
  for (const change of [
    "version",
    "directoryVersion",
    "digest",
    "missing",
    "unsupported",
    "dirty",
    "no-read",
    "new-edit",
  ])
    await t.test(change, async () => {
      const observed = skillRuntimeObservation();
      if (["version", "directoryVersion", "digest"].includes(change))
        observed.file[change] = "e".repeat(64);
      if (change === "missing")
        observed.file = {
          sourceName: "alpha",
          status: "missing",
          reason: "missing_file",
        };
      if (change === "unsupported")
        observed.file = {
          sourceName: "alpha",
          status: "unsupported",
          reason: "unsupported_content",
        };
      const { client, calls } = skillRuntimeHarness({ observation: observed });
      try {
        if (change === "no-read") {
          await client.actions.listSkillFiles();
          client.actions.selectSkillFile("alpha");
        } else await loadSkill(client);
        if (change === "dirty") client.actions.editSkillFile("# Dirty\n");
        assert.equal(await client.actions.observeSkillRuntime(), true);
        if (change === "new-edit") {
          client.actions.editSkillFile("# Later\n");
          client.actions.editSkillFile(skillRuntimeText);
        }
        assert.equal(await client.actions.registerSkill(), false);
        assert.equal(
          calls.some(
            (e) => e.operation.type === "configuration.skill.register",
          ),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Skill closed observation rejects forged prefix ownership, wrong content/digest, scope, duplicates and unknown fields", async (t) => {
  const changes = {
    sparseHistory: (o) => (o.session.messages = Array(1)),
    sparseUnowned: (o) => (o.unowned = Array(1)),
    prefix: (o) => (o.owned[0].nativeId = `omoc-skill-${"0".repeat(64)}`),
    registration: (o) => (o.owned[0].registrationOperationId = "borrowed-key"),
    epoch: (o) => (o.owned[0].registrationRuntimeEpoch = "previous-epoch"),
    body: (o) => (o.owned[0].content = "Different Native content"),
    bodyDigest: (o) => (o.owned[0].bodyDigest = "0".repeat(64)),
    nativeDigest: (o) => (o.owned[0].nativeDigest = "0".repeat(64)),
    path: (o) => (o.owned[0].path = "/other/.opencode/skills/alpha/SKILL.md"),
    autoinvoke: (o) => (o.owned[0].autoinvoke = true),
    duplicate: (o) => o.owned.push(o.owned[0]),
    extra: (o) => (o.owned[0].origin = "direct"),
    workspace: (o) => (o.workspaceId = "other"),
    root: (o) => (o.workspacePath = "/other"),
    session: (o) => (o.session.sessionId = "b"),
    file: (o) => (o.file.sourceName = "beta"),
    unownedCollision: (o) =>
      o.unowned.push({ nativeId: o.owned[0].nativeId, name: "Same ID" }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const observed = skillRuntimeObservation([skillRuntimeRow()]);
      change(observed);
      const { client } = skillRuntimeHarness({ observation: observed });
      try {
        await loadSkill(client);
        assert.equal(await client.actions.observeSkillRuntime(), false);
        assert.equal(
          await client.actions.removeSkill(skillRuntimeRow().nativeId),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Skill malformed mutation DTO or receipt never fabricates success or advances receipt floor", async (t) => {
  const both = (r, key, value) => {
    r.value[key] = value;
    r.receipt.result[key] = value;
  };
  const changes = {
    request: (r) => (r.value.requestId = "other"),
    extra: (r) => (r.value.content = "injected body"),
    unknownSuccess: (r) =>
      (r.value = { requestId: r.value.requestId, status: "unknown" }),
    source: (r) => both(r, "sourceName", "beta"),
    id: (r) => both(r, "nativeId", `omoc-skill-${"0".repeat(64)}`),
    digest: (r) => both(r, "digest", "0".repeat(64)),
    bodyDigest: (r) => both(r, "bodyDigest", "0".repeat(64)),
    nativeDigest: (r) => both(r, "nativeDigest", "0".repeat(64)),
    version: (r) => both(r, "version", "0".repeat(64)),
    directoryVersion: (r) => both(r, "directoryVersion", "0".repeat(64)),
    originalKey: (r) => both(r, "registrationOperationId", "other-key"),
    epoch: (r) => both(r, "registrationRuntimeEpoch", "other-epoch"),
    workspace: (r) => (r.receipt.workspaceId = "other"),
    session: (r) => (r.receipt.sessionId = "a"),
    admission: (r) => (r.receipt.admission = "admitted"),
    delivery: (r) => (r.receipt.delivery = "pending"),
    none: (r) => (r.receipt.effect = "none"),
    floor: (r) => (r.receipt.revision = 1),
    evidence: (r) => (r.receipt.evidence = []),
    kind: (r) => (r.receipt.result.kind = "skill_removed"),
    raw: (r) => (r.receipt.result.content = "injected body"),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { client } = skillRuntimeHarness({
        mutate: (e) => {
          const response = skillRuntimeConfirmed(e);
          change(response);
          return response;
        },
      });
      try {
        await loadSkill(client);
        await client.actions.observeSkillRuntime();
        assert.equal(await client.actions.registerSkill(), false);
        assert.equal(
          client.store.getState().skillRuntime.action.status,
          "unknown",
        );
        assert.equal(client.store.getState().revision, 1);
      } finally {
        client.dispose();
      }
    });
});

test("Native Skill unknown retains original-key lookup only, blocks every matching session and keeps drafts editable", async () => {
  let original,
    resolved = false;
  const { client, calls, clock } = skillRuntimeHarness({
    mutate: (e) => {
      original = e;
      return {
        ok: true,
        value: { requestId: e.operationId, status: "unknown" },
      };
    },
    lookup: (e) =>
      resolved
        ? {
            ok: true,
            value: {
              status: "found",
              runtimeEpoch: original.runtimeEpoch,
              operationId: original.operationId,
              receipt: skillRuntimeConfirmed(original).receipt,
            },
          }
        : readFallback(e),
  });
  try {
    await loadSkill(client);
    await client.actions.observeSkillRuntime();
    assert.equal(await client.actions.registerSkill(), false);
    await flush();
    const key = operationKey(original.runtimeEpoch, original.operationId);
    const intent = client.store.getState().operations[key];
    assert.equal(intent.lookupOnly, true);
    assert.deepEqual(intent.operation, {
      type: "configuration.skill.register",
      workspaceId: "w",
    });
    assert.equal(intent.skillRuntimeMutation.request, undefined);
    assert.equal(intent.skillRuntimeMutation.target.content, undefined);
    client.actions.editSkillFile("# Editable after unknown\n");
    assert.equal(
      selectors.skillDraft(client.store.getState()).text,
      "# Editable after unknown\n",
    );
    assert.equal(
      selectors.canObserveSkillRuntime(client.store.getState()),
      false,
    );
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(client.store.getState()), true);
    client.actions.selectSkillFile("beta");
    assert.equal(client.store.getState().skillFiles.sourceName, "beta");
    client.actions.select("w", "b");
    assert.equal(
      await client.actions.mutate({ ...send(), sessionId: "b" }),
      false,
    );
    client.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(client.store.getState()), bootstrap: true },
      value: snapshot(1, "b", { runtimeEpoch: "epoch-b" }),
    });
    assert.equal(client.store.getState().epoch, "epoch-b");
    resolved = true;
    await clock.advance(5000);
    await waitForSkillRuntimeState(
      client,
      (state) => state.operations[key].status === "accepted",
    );
    assert.equal(client.store.getState().operations[key].status, "accepted");
    assert.equal(
      client.store.getState().revision,
      1,
      "historical ACK cannot advance current epoch floor",
    );
    const queries = calls.filter(
      (e) => e.operation.type === "operation.lookup",
    );
    const fresh = queries.find((e) => e.runtimeEpoch === "epoch-b");
    assert.equal(fresh.operation.runtimeEpoch, "epoch-a");
    assert.equal(fresh.operation.operationId, original.operationId);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.skill.register")
        .length,
      1,
    );
    assert.equal(
      selectors.currentSkillRuntimeObservation(client.store.getState()),
      undefined,
    );
  } finally {
    client.dispose();
  }
});

test("Native Skill remove has workspace scope and leaves observed old session facts for next explicit read", async () => {
  const row = skillRuntimeRow(),
    fact = {
      nativeId: row.nativeId,
      messageId: "old-record",
      name: row.name,
      bodyDigest: row.bodyDigest,
    };
  let removed = false;
  const { client, calls } = skillRuntimeHarness({
    observation: () => ({
      ok: true,
      value: skillRuntimeObservation(removed ? [] : [row], {
        session: { sessionId: "a", status: "observed", messages: [fact] },
      }),
    }),
    mutate: (e) => {
      removed = true;
      return skillRuntimeConfirmed(e, row);
    },
  });
  try {
    await loadSkill(client);
    await client.actions.observeSkillRuntime();
    assert.equal(await client.actions.removeSkill(row.nativeId), true);
    const sent = calls.find(
      (e) => e.operation.type === "configuration.skill.remove",
    );
    assert.equal(Object.hasOwn(sent.operation, "sessionId"), false);
    assert.equal(sent.operation.requestId, sent.operationId);
    assert.equal(
      selectors.currentSkillRuntimeObservation(client.store.getState()),
      undefined,
    );
    seed(client.store, snapshot(2));
    assert.equal(await client.actions.observeSkillRuntime(), true);
    assert.deepEqual(
      selectors.currentSkillRuntimeObservation(client.store.getState()).session
        .messages,
      [fact],
    );
    assert.equal(
      selectors.currentSkillRuntimeObservation(client.store.getState()).owned
        .length,
      0,
    );
  } finally {
    client.dispose();
  }
});

test("Native Skill register rechecks authority after asynchronous SHA before any dispatch", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "session",
    "workspace",
    "root",
    "trust",
    "untrusted",
    "epoch",
    "floor",
    "dispose",
    "running",
    "permission",
  ])
    await t.test(change, async () => {
      const { client, calls } = skillRuntimeHarness();
      try {
        await loadSkill(client);
        await client.actions.observeSkillRuntime();
        const registering = client.actions.registerSkill();
        changeSkillRuntimeScope(client, change);
        assert.equal(await registering, false);
        assert.equal(
          calls.some(
            (e) => e.operation.type === "configuration.skill.register",
          ),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Skill late ACK records original action only and preserves later draft or changed scope", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "session",
    "workspace",
    "root",
    "trust",
    "epoch",
    "floor",
  ])
    await t.test(change, async () => {
      let original;
      const dispatched = deferred();
      const wait = deferred(),
        { client } = skillRuntimeHarness({
          mutate: (e) => {
            original = e;
            dispatched.resolve();
            return wait.promise;
          },
        });
      try {
        await loadSkill(client);
        await client.actions.observeSkillRuntime();
        const registering = client.actions.registerSkill();
        await dispatched.promise;
        assert.ok(original);
        changeSkillRuntimeScope(client, change);
        wait.resolve(skillRuntimeConfirmed(original));
        assert.equal(await registering, true);
        assert.equal(
          client.store.getState().operations[
            operationKey(original.runtimeEpoch, original.operationId)
          ].status,
          "accepted",
        );
        assert.equal(
          selectors.currentSkillRuntimeObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.skillRuntimeActionCurrent(client.store.getState()),
          false,
        );
        if (change === "edit")
          assert.equal(
            selectors.skillDraft(client.store.getState()).text,
            "# New draft\n",
          );
        if (change === "discard")
          assert.equal(
            selectors.skillDraft(client.store.getState()).text,
            "# Replacement\n",
          );
      } finally {
        client.dispose();
      }
    });
});

test("Native Skill pending actual IO stays held after timeout and receipt lookup, no mutation replay", async () => {
  let original,
    resolved = false;
  const dispatched = deferred();
  const pending = deferred(),
    { client, clock, calls } = skillRuntimeHarness({
      mutate: (e) => {
        original = e;
        dispatched.resolve();
        return pending.promise;
      },
      lookup: (e) =>
        resolved
          ? {
              ok: true,
              value: {
                status: "found",
                runtimeEpoch: original.runtimeEpoch,
                operationId: original.operationId,
                receipt: skillRuntimeConfirmed(original).receipt,
              },
            }
          : readFallback(e),
    });
  try {
    await loadSkill(client);
    await client.actions.observeSkillRuntime();
    const registering = client.actions.registerSkill();
    await dispatched.promise;
    assert.ok(original);
    await clock.advance(10000);
    assert.equal(await registering, false);
    assert.equal(client.store.getState().configurationIO.saves, 1);
    client.actions.discardSkillFile();
    client.actions.editSkillFile("# Replacement\n");
    resolved = true;
    await clock.advance(5000);
    const key = operationKey(original.runtimeEpoch, original.operationId);
    await waitForSkillRuntimeState(
      client,
      (state) => state.operations[key].status === "accepted",
    );
    assert.equal(client.store.getState().operations[key].status, "accepted");
    seed(client.store, snapshot(2));
    assert.equal(await client.actions.observeSkillRuntime(), false);
    pending.resolve(skillRuntimeConfirmed(original));
    await flush();
    assert.equal(client.store.getState().configurationIO.saves, 0);
    assert.equal(
      selectors.skillDraft(client.store.getState()).text,
      "# Replacement\n",
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.skill.register")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Native Skill restored original keys are lookup-only and enforce exact workspace/session scope", () => {
  for (const type of [
    "configuration.skill.register",
    "configuration.skill.remove",
    "configuration.skill.apply",
  ]) {
    const key = {
      authorityHold: true,
      runtimeEpoch: "original-epoch",
      operationId: "original-id",
      type,
      workspaceId: "w",
      ...(type.endsWith("apply") ? { sessionId: "a" } : {}),
    };
    const store = createWorkbenchStore();
    seed(store, snapshot(1, "a", { retainedOperations: [key] }));
    const retained =
      store.getState().operations[
        operationKey(key.runtimeEpoch, key.operationId)
      ];
    assert.equal(retained.lookupOnly, true);
    assert.equal(retained.skillRuntimeMutation, undefined);
    assert.equal(retained.operation.requestId, undefined);
    assert.equal(resourceMutationDisabled(store.getState(), "w"), true);
    for (const invalid of [
      { ...key, workspaceId: undefined },
      { ...key, sessionId: type.endsWith("apply") ? undefined : "a" },
    ]) {
      const wrong = createWorkbenchStore();
      seed(wrong, snapshot(1, "a", { retainedOperations: [invalid] }));
      assert.equal(wrong.getState().epoch, undefined);
    }
  }
});

test("Native Skill start, selection, poll, save/load and refocus never read or mutate Native automatically", async () => {
  let refocus;
  const { client, clock, calls } = skillRuntimeHarness({
    onRefocus: (listener) => {
      refocus = listener;
      return () => {};
    },
  });
  try {
    client.start();
    await flush();
    await loadSkill(client);
    client.actions.selectSkillFile("beta");
    client.actions.selectSkillFile("alpha");
    client.actions.refresh();
    refocus();
    await clock.advance(15000);
    assert.equal(
      calls.some((e) =>
        [
          "configuration.skill.runtime.read",
          "configuration.skill.register",
          "configuration.skill.remove",
          "configuration.skill.apply",
        ].includes(e.operation.type),
      ),
      false,
    );
    assert.equal(
      await client.actions.mutate({
        type: "configuration.skill.register",
        workspaceId: "w",
        requestId: "bypass",
        sourceName: "alpha",
        observationId: "fake",
        version: "a".repeat(64),
        directoryVersion: "d".repeat(64),
        digest: skillHash(skillRuntimeText),
      }),
      false,
    );
  } finally {
    client.dispose();
  }
});

test("Native Skill renderer full file/body/Native digests match Main parser for BOM and both line endings", async (t) => {
  for (const text of [
    "# Plain\r\n한글\n",
    '\ufeff---\r\nname: "Exact"\r\ndescription: "한글"\r\nmetadata:\r\n  opencode/autoinvoke: true\r\n---\r\nExact body.\r\n',
    '---\nname: "Exact"\n---\nExact body.\n',
  ])
    await t.test(JSON.stringify(text), async () => {
      const observation = skillRuntimeObservation();
      observation.file.digest = skillHash(text);
      const { client } = skillRuntimeHarness({
        fileText: text,
        observation,
        mutate: (e) => {
          const owner = {
            runtimeEpoch: e.runtimeEpoch,
            workspaceId: "w",
            workspacePath: "/fixture",
            sourceName: "alpha",
            operationId: e.operationId,
            digest: skillHash(text),
          };
          const record = parseSkillRuntimeRecord(owner, text);
          const row = {
            ...skillRuntimeRow(e.operationId),
            name: record.name,
            content: record.content,
            bodyDigest: skillHash(record.content),
            digest: skillHash(text),
            nativeDigest: nativeSkillDigest(record),
          };
          return skillRuntimeConfirmed(e, row);
        },
      });
      try {
        await loadSkill(client);
        await client.actions.observeSkillRuntime();
        assert.equal(await client.actions.registerSkill(), true);
      } finally {
        client.dispose();
      }
    });
});

test("agent renderer exposes explicit workspace controls without automatic reads", () => {
  const h = bridgeHarness(readFallback);
  const win = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
  seed(win.store);
  assert.equal(typeof win.actions.observeAgentRuntime, "function");
  assert.equal(typeof selectors.agentDraft, "function");
  assert.equal(h.calls.length, 0);
  assert.equal(selectors.canRegisterAgent(win.store.getState()), false);
  win.dispose();
});

const agentPath = (name = "alpha") => `/fixture/.opencode/agents/${name}.md`;
const agentRead = (name = "alpha", content = "# Original\n") => ({
  workspaceId: "w",
  workspacePath: "/fixture",
  sourceName: name,
  path: agentPath(name),
  status: "available",
  content,
  version: "a".repeat(64),
  directoryVersion: "d".repeat(64),
});
function agentHarness(read = agentRead(), saveHandler) {
  const harness = bridgeHarness((e) => {
    if (e.operation.type === "configuration.agent.list")
      return {
        ok: true,
        value: {
          workspaceId: "w",
          workspacePath: "/fixture",
          path: "/fixture/.opencode/agents",
          status: "available",
          entries: ["alpha", "beta"].map((sourceName) => ({
            sourceName,
            path: agentPath(sourceName),
          })),
          truncated: false,
        },
      };
    if (e.operation.type === "configuration.agent.read")
      return typeof read === "function"
        ? read(e)
        : {
            ok: true,
            value: {
              ...read,
              sourceName: e.operation.sourceName,
              path: agentPath(e.operation.sourceName),
            },
          };
    if (e.operation.type === "configuration.agent.save")
      return saveHandler?.(e) ?? { ok: false, code: "UNKNOWN_OUTCOME" };
    return readFallback(e);
  });
  const clock = fakeClock();
  const client = createWindowWorkbench(harness.bridge, {
    clock,
    id,
  });
  seed(client.store);
  return { ...harness, client, clock };
}
async function loadAgent(client, name = "alpha") {
  assert.equal(await client.actions.listAgentFiles(), true);
  client.actions.selectAgentFile(name);
  assert.equal(await client.actions.readAgentFile(), true);
}

test("Agent file drafts isolate A/B; selection ABA retires read authority", async () => {
  const { client, calls } = agentHarness();
  try {
    await loadAgent(client);
    client.actions.editAgentFile("# Alpha edit\n");
    client.actions.validateAgentFile();
    assert.equal(selectors.canSaveAgentFile(client.store.getState()), true);
    client.actions.selectAgentFile("beta");
    assert.equal(selectors.agentDraft(client.store.getState()).text, "");
    client.actions.editAgentFile("# Beta edit\n");
    client.actions.selectAgentFile("alpha");
    assert.equal(
      selectors.agentDraft(client.store.getState()).text,
      "# Alpha edit\n",
    );
    assert.equal(selectors.canSaveAgentFile(client.store.getState()), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.read")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Agent missing leaf requires exact directoryVersion; unsafe DTO never grants save", async () => {
  for (const read of [
    {
      ...agentRead(),
      status: "missing",
      reason: "missing_file",
      content: undefined,
      version: undefined,
      directoryVersion: undefined,
    },
    { ...agentRead(), directoryVersion: undefined },
    { ...agentRead(), extra: "smuggled" },
  ]) {
    const { client } = agentHarness(read);
    try {
      await client.actions.listAgentFiles();
      client.actions.selectAgentFile("alpha");
      assert.equal(await client.actions.readAgentFile(), false);
      client.actions.editAgentFile("# New\n");
      client.actions.validateAgentFile();
      assert.equal(selectors.canSaveAgentFile(client.store.getState()), false);
    } finally {
      client.dispose();
    }
  }
});

test("Agent explicit read preserves unsupported grammar and permits supported correction", async () => {
  const { client } = agentHarness(
    agentRead("alpha", "---\nunknown: x\n---\n# Body\n"),
  );
  try {
    await loadAgent(client);
    client.actions.validateAgentFile();
    assert.equal(
      selectors.agentDraft(client.store.getState()).validation.status,
      "unsupported",
    );
    client.actions.editAgentFile("# Supported\n");
    client.actions.validateAgentFile();
    assert.equal(selectors.canSaveAgentFile(client.store.getState()), true);
  } finally {
    client.dispose();
  }
});

function agentSavedResponse(envelope, change = () => {}) {
  const backupId =
    envelope.operation.expectation === "version"
      ? `.omoc-configuration-${createHash("sha256").update(operationKey(envelope.runtimeEpoch, envelope.operationId)).digest("hex")}.agent.backup`
      : undefined;
  const value = {
    requestId: envelope.operation.requestId,
    status: "saved",
    version: "e".repeat(64),
    ...(backupId ? { backupId } : {}),
  };
  const ack = receipt(envelope, {
    evidence: [{ kind: "host-registry", id: "w" }],
    result: {
      kind: "agent_file_saved",
      workspaceId: "w",
      sourceName: envelope.operation.sourceName,
      version: value.version,
      ...(backupId ? { backupId } : {}),
    },
  });
  const response = { ok: true, value, receipt: ack };
  change(response);
  return response;
}
function editAgent(client, text = "# Edited\n") {
  client.actions.editAgentFile(text);
  client.actions.validateAgentFile();
}

test("Agent confirmed save submits exact baseline, retires read authority and waits for floor snapshot + explicit reread", async () => {
  const original = "\uFEFF# Original\r\n한글\n",
    { client, calls } = agentHarness(
      agentRead("alpha", original),
      agentSavedResponse,
    );
  try {
    await loadAgent(client);
    editAgent(client, "# Edited\r\n한글\n");
    assert.equal(await client.actions.saveAgentFile(), true);
    const sent = calls.find(
      (e) => e.operation.type === "configuration.agent.save",
    );
    assert.equal(sent.operation.requestId, sent.operationId);
    const backupId = `.omoc-configuration-${createHash("sha256").update(operationKey(sent.runtimeEpoch, sent.operation.requestId)).digest("hex")}.agent.backup`;
    assert.equal(
      selectors.agentDraft(client.store.getState()).save.backupId,
      backupId,
    );
    assert.equal(sent.operation.version, "a".repeat(64));
    assert.equal(sent.operation.directoryVersion, "d".repeat(64));
    assert.equal(sent.operation.text, "# Edited\r\n한글\n");
    assert.equal(sent.expectedRevision, 1);
    const draft = selectors.agentDraft(client.store.getState());
    assert.equal(draft.baseline, original);
    assert.equal(draft.observation, undefined);
    assert.equal(draft.save.status, "saved");
    assert.equal(selectors.canReadAgentFiles(client.store.getState()), false);
    seed(client.store, snapshot(2));
    assert.equal(selectors.canSaveAgentFile(client.store.getState()), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.read")
        .length,
      1,
    );
    assert.equal(await client.actions.readAgentFile(), true);
    editAgent(client);
    assert.equal(selectors.canSaveAgentFile(client.store.getState()), true);
  } finally {
    client.dispose();
  }
});

test("Agent missing leaf save sends required exact directoryVersion and never fabricates existing file version or backup", async () => {
  const read = {
    workspaceId: "w",
    workspacePath: "/fixture",
    sourceName: "alpha",
    path: agentPath(),
    status: "missing",
    reason: "missing_file",
    directoryVersion: "d".repeat(64),
  };
  const { client, calls } = agentHarness(read, agentSavedResponse);
  try {
    await loadAgent(client);
    editAgent(client);
    assert.equal(await client.actions.saveAgentFile(), true);
    const sent = calls.find(
      (e) => e.operation.type === "configuration.agent.save",
    );
    assert.equal(sent.operation.requestId, sent.operationId);
    const request = sent.operation;
    assert.equal(request.expectation, "missing");
    assert.equal(request.directoryVersion, read.directoryVersion);
    assert.equal(Object.hasOwn(request, "version"), false);
    assert.equal(
      selectors.agentDraft(client.store.getState()).save.backupId,
      undefined,
    );
  } finally {
    client.dispose();
  }
});

test("Agent late explicit read rejects selection ABA, draft edits/discard, workspace, epoch, root, trust and floor", async (t) => {
  for (const change of [
    "source",
    "edit",
    "discard",
    "workspace",
    "epoch",
    "root",
    "trust",
    "floor",
    "cancel",
    "dispose",
  ])
    await t.test(change, async () => {
      const wait = deferred(),
        { client } = agentHarness(() => wait.promise);
      try {
        await client.actions.listAgentFiles();
        client.actions.selectAgentFile("alpha");
        const reading = client.actions.readAgentFile();
        await flush();
        if (change === "source") {
          client.actions.selectAgentFile("beta");
          client.actions.selectAgentFile("alpha");
        }
        if (change === "edit") client.actions.editAgentFile("# Later\n");
        if (change === "discard") {
          client.actions.discardAgentFile();
          client.actions.editAgentFile("# Replacement\n");
        }
        if (change === "workspace") {
          client.actions.select("other", "other-a");
          client.actions.select("w", "a");
          seed(client.store);
        }
        if (change === "epoch")
          client.store.dispatch({
            type: "snapshot",
            scope: { ...scopeOf(client.store.getState()), bootstrap: true },
            value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
          });
        if (change === "root")
          seed(
            client.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/replacement" }],
            }),
          );
        if (change === "trust")
          seed(
            client.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        if (change === "floor") seed(client.store, snapshot(2));
        if (change === "cancel") client.actions.cancelAgentRead();
        if (change === "dispose") client.dispose();
        wait.resolve({ ok: true, value: agentRead() });
        assert.equal(await reading, false);
        const draft = selectors.agentDraft(client.store.getState());
        assert.notEqual(draft.text, "# Original\n");
        assert.equal(draft.observation, undefined);
      } finally {
        client.dispose();
      }
    });
});

test("Agent async SHA rechecks immutable exact draft and scope before dispatch", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "workspace",
    "floor",
    "root",
    "trust",
    "running",
    "permission",
    "read",
    "dispose",
  ])
    await t.test(change, async () => {
      const { client, calls } = agentHarness();
      try {
        await loadAgent(client);
        editAgent(client);
        const saving = client.actions.saveAgentFile();
        if (change === "edit") {
          client.actions.editAgentFile("# Other\n");
          editAgent(client);
        }
        if (change === "discard") {
          client.actions.discardAgentFile();
          editAgent(client);
        }
        if (change === "source") {
          client.actions.selectAgentFile("beta");
          client.actions.selectAgentFile("alpha");
        }
        if (change === "workspace") {
          client.actions.select("w", "b");
          seed(client.store, snapshot(1, "b"));
        }
        if (change === "floor") seed(client.store, snapshot(2));
        if (change === "root")
          seed(
            client.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/other" }],
            }),
          );
        if (change === "trust")
          seed(
            client.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        if (change === "running")
          seed(
            client.store,
            snapshot(1, "a", {
              sessions: [
                session("a"),
                session("b", "w", { status: "running" }),
              ],
            }),
          );
        if (change === "permission")
          seed(
            client.store,
            snapshot(1, "a", {
              permissions: [
                {
                  id: "p",
                  workspaceId: "w",
                  sessionId: "b",
                  permission: "read",
                  patterns: [],
                },
              ],
            }),
          );
        if (change === "read") await client.actions.readAgentFile();
        if (change === "dispose") client.dispose();
        assert.equal(await saving, false);
        assert.equal(
          calls.some((e) => e.operation.type === "configuration.agent.save"),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Agent late ACK preserves later edits and cannot attach to discarded/source ABA or changed scope", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "workspace",
    "root",
    "trust",
    "epoch",
    "floor",
  ])
    await t.test(change, async () => {
      const wait = deferred();
      let envelope;
      const { client } = agentHarness(agentRead(), (e) => {
        envelope = e;
        return wait.promise;
      });
      try {
        await loadAgent(client);
        editAgent(client);
        const saving = client.actions.saveAgentFile();
        for (let n = 0; n < 30 && !envelope; n++)
          await new Promise((resolve) => setImmediate(resolve));
        assert.ok(envelope);
        if (change === "edit") client.actions.editAgentFile("# Later\n");
        if (change === "discard") {
          client.actions.discardAgentFile();
          editAgent(client, "# Replacement\n");
        }
        if (change === "source") {
          client.actions.selectAgentFile("beta");
          client.actions.selectAgentFile("alpha");
        }
        if (change === "workspace") {
          client.actions.select("w", "b");
          seed(client.store, snapshot(1, "b"));
        }
        if (change === "root")
          seed(
            client.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/other" }],
            }),
          );
        if (change === "trust")
          seed(
            client.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        if (change === "epoch")
          client.store.dispatch({
            type: "snapshot",
            scope: { ...scopeOf(client.store.getState()), bootstrap: true },
            value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
          });
        if (change === "floor") seed(client.store, snapshot(3));
        wait.resolve(agentSavedResponse(envelope));
        assert.equal(await saving, true);
        const draft = selectors.agentDraft(client.store.getState());
        if (change === "edit") {
          assert.equal(draft.text, "# Later\n");
          assert.equal(draft.save.current, false);
          assert.equal(draft.baseline, "# Original\n");
        }
        if (change === "discard") {
          assert.equal(draft.text, "# Replacement\n");
          assert.equal(draft.save, undefined);
        }
        if (
          ["source", "workspace", "root", "trust", "epoch"].includes(change)
        ) {
          assert.notEqual(draft.save?.status, "saved");
          assert.equal(selectors.agentSave(client.store.getState()), undefined);
        }
        assert.equal(
          selectors.canSaveAgentFile(client.store.getState()),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Agent malformed save DTO/receipt never grants success or raises floor", async (t) => {
  const cases = {
    request: (r) => (r.value.requestId = "other"),
    extra: (r) => (r.value.content = "# Received payload"),
    version: (r) => (r.value.version = "bad"),
    backup: (r) => {
      delete r.value.backupId;
      delete r.receipt.result.backupId;
    },
    source: (r) => (r.receipt.result.sourceName = "beta"),
    workspace: (r) => (r.receipt.result.workspaceId = "other"),
    session: (r) => (r.receipt.sessionId = "a"),
    type: (r) => (r.receipt.type = "configuration.save"),
    kind: (r) => (r.receipt.result.kind = "configuration_saved"),
    floor: (r) => (r.receipt.revision = 1),
    evidence: (r) => (r.receipt.evidence = []),
    admitted: (r) => (r.receipt.admission = "admitted"),
    raw: (r) => (r.receipt.result.content = "# Smuggled"),
    unknownSuccess: (r) => {
      r.value = { requestId: r.value.requestId, status: "unknown" };
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const { client } = agentHarness(agentRead(), (e) =>
        agentSavedResponse(e, change),
      );
      try {
        await loadAgent(client);
        editAgent(client);
        assert.equal(await client.actions.saveAgentFile(), false);
        assert.equal(
          selectors.agentDraft(client.store.getState()).save.status,
          "unknown",
        );
        assert.equal(client.store.getState().revision, 1);
      } finally {
        client.dispose();
      }
    });
});

test("Agent unknown holds original composite key, editable drafts and global resource mutations without replay", async () => {
  const { client, calls } = agentHarness();
  try {
    await loadAgent(client);
    editAgent(client);
    assert.equal(await client.actions.saveAgentFile(), false);
    const sent = calls.find(
        (e) => e.operation.type === "configuration.agent.save",
      ),
      key = operationKey(sent.runtimeEpoch, sent.operationId);
    assert.equal(sent.operation.requestId, sent.operationId);
    assert.equal(client.store.getState().operations[key].lookupOnly, true);
    assert.deepEqual(client.store.getState().operations[key].operation, {
      type: "configuration.agent.save",
      workspaceId: "w",
    });
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(client.store.getState()), true);
    client.actions.editAgentFile("# Later\n");
    client.actions.discardAgentFile();
    editAgent(client, "# Replacement\n");
    assert.equal(await client.actions.saveAgentFile(), false);
    assert.equal(await client.actions.mutate(send()), false);
    assert.equal(await client.actions.listAgentFiles(), false);
    await flush();
    const lookup = calls.find((e) => e.operation.type === "operation.lookup");
    assert.equal(lookup.operation.operationId, sent.operation.requestId);
    assert.equal(lookup.operation.operationId, sent.operationId);
    assert.equal(lookup.operation.runtimeEpoch, sent.runtimeEpoch);
    client.store.dispatch({
      type: "receipt",
      id: sent.operationId,
      receipt: agentSavedResponse(sent).receipt,
    });
    assert.equal(client.store.getState().operations[key].status, "unknown");
    client.store.dispatch({
      type: "receipt",
      id: key,
      receipt: agentSavedResponse(sent).receipt,
    });
    assert.equal(client.store.getState().operations[key].status, "accepted");
    assert.equal(selectors.agentDraft(client.store.getState()).save, undefined);
    assert.equal(
      selectors.agentDraft(client.store.getState()).text,
      "# Replacement\n",
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.save")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Agent historical retained save restores lookup-only metadata with no draft or executable payload", async () => {
  const old = {
    authorityHold: true,
    runtimeEpoch: "epoch-old",
    operationId: "same-id",
    type: "configuration.agent.save",
    workspaceId: "w",
  };
  const harness = bridgeHarness(readFallback),
    client = createWindowWorkbench(harness.bridge, { clock: fakeClock(), id });
  try {
    seed(client.store, snapshot(5, "a", { retainedOperations: [old] }));
    const key = operationKey(old.runtimeEpoch, old.operationId),
      intent = client.store.getState().operations[key];
    assert.ok(intent);
    assert.equal(intent.lookupOnly, true);
    assert.equal(intent.agentSave, undefined);
    const ack = {
      runtimeEpoch: old.runtimeEpoch,
      operationId: old.operationId,
      type: old.type,
      workspaceId: "w",
      admission: "dispatched",
      delivery: "accepted",
      effect: "confirmed",
      revision: 3,
      evidence: [{ kind: "host-registry", id: "w" }],
      result: {
        kind: "agent_file_saved",
        workspaceId: "w",
        sourceName: "alpha",
        version: "a".repeat(64),
      },
    };
    client.store.dispatch({ type: "receipt", id: key, receipt: ack });
    assert.equal(client.store.getState().operations[key].status, "accepted");
    assert.deepEqual(client.store.getState().agentDrafts, {});
    assert.equal(client.store.getState().revision, 5);
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), true);
    seed(client.store, snapshot(5));
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), false);
  } finally {
    client.dispose();
  }
});

test("Agent start, selection, poll, refresh and refocus never list/read/save automatically", async () => {
  let refocus;
  const clock = fakeClock(),
    h = bridgeHarness(readFallback),
    client = createWindowWorkbench(h.bridge, {
      clock,
      id,
      onRefocus: (listener) => {
        refocus = listener;
        return () => {};
      },
    });
  try {
    client.start();
    await flush();
    client.actions.select("w", "b");
    await flush();
    await clock.advance(15000);
    client.actions.refresh();
    refocus();
    await flush();
    assert.equal(
      h.calls.some((e) => e.operation.type.startsWith("configuration.agent.")),
      false,
    );
  } finally {
    client.dispose();
  }
});

test("Agent snapshots copy accepted producer file bytes and version metadata", async () => {
  const response = agentRead(),
    { client } = agentHarness(() => ({ ok: true, value: response }));
  try {
    await loadAgent(client);
    response.content = "# Replaced\n";
    response.version = "f".repeat(64);
    response.directoryVersion = "f".repeat(64);
    const draft = selectors.agentDraft(client.store.getState());
    assert.equal(draft.read.content, "# Original\n");
    assert.equal(draft.read.version, "a".repeat(64));
    assert.equal(draft.read.directoryVersion, "d".repeat(64));
  } finally {
    client.dispose();
  }
});

test("Agent closed list rejects sparse/accessor entries without invoking getters", async (t) => {
  for (const shape of [
    "sparse",
    "getter",
    "null",
    "duplicate",
    "oversize",
    "extra",
    "truncated",
    "path",
    "source",
  ])
    await t.test(shape, async () => {
      let getterCalls = 0;
      const row = { sourceName: "alpha", path: agentPath() },
        value = {
          workspaceId: "w",
          workspacePath: "/fixture",
          path: "/fixture/.opencode/agents",
          status: "available",
          entries: [row],
          truncated: false,
        };
      if (shape === "sparse") value.entries = new Array(1);
      if (shape === "getter")
        Object.defineProperty(row, "sourceName", {
          get() {
            getterCalls++;
            return "alpha";
          },
        });
      if (shape === "null") value.entries = [null];
      if (shape === "duplicate") value.entries = [row, row];
      if (shape === "oversize")
        value.entries = Array.from({ length: 17 }, (_, i) => ({
          sourceName: `file${i}`,
          path: agentPath(`file${i}`),
        }));
      if (shape === "extra") row.content = "payload";
      if (shape === "truncated") value.truncated = "false";
      if (shape === "path") row.path = "/other/AGENT.md";
      if (shape === "source") row.sourceName = "../alpha";
      const h = bridgeHarness((e) =>
          e.operation.type === "configuration.agent.list"
            ? { ok: true, value }
            : readFallback(e),
        ),
        client = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
      try {
        seed(client.store);
        assert.equal(await client.actions.listAgentFiles(), false);
        assert.equal(getterCalls, 0);
        assert.equal(
          selectors.agentFiles(client.store.getState()).listing,
          undefined,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Agent retained target rejects missing workspace and session-bearing historical identities", () => {
  for (const extra of [{}, { workspaceId: "w", sessionId: "a" }]) {
    const store = createWorkbenchStore();
    seed(
      store,
      snapshot(1, "a", {
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "old",
            operationId: "x",
            type: "configuration.agent.save",
            ...extra,
          },
        ],
      }),
    );
    assert.equal(store.getState().snapshot, null);
  }
});

test("Agent source files bind workspace/root separately and retain intentional drafts across navigation", async () => {
  const { client } = agentHarness();
  try {
    await loadAgent(client);
    editAgent(client, "# W alpha\n");
    const first = selectors.agentDraft(client.store.getState());
    client.actions.select("other", "other-a");
    seed(
      client.store,
      snapshot(1, "other-a", {
        selectedWorkspaceId: "other",
        workspaces: [workspace("other")],
        sessions: [session("other-a", "other")],
      }),
    );
    assert.equal(selectors.agentDraft(client.store.getState()).text, "");
    client.actions.select("w", "a");
    seed(client.store);
    await client.actions.listAgentFiles();
    client.actions.selectAgentFile("alpha");
    assert.equal(
      selectors.agentDraft(client.store.getState()).text,
      first.text,
    );
    assert.equal(selectors.canSaveAgentFile(client.store.getState()), false);
    seed(
      client.store,
      snapshot(1, "a", {
        workspaces: [{ ...workspace(), path: "/replacement" }],
      }),
    );
    assert.equal(selectors.agentDraft(client.store.getState()).text, "");
    assert.equal(
      Object.values(client.store.getState().agentDrafts)[0].text,
      first.text,
    );
  } finally {
    client.dispose();
  }
});

test("Agent list preserves missing/denied/changed/truncated truth and copies accepted entries", async (t) => {
  for (const shape of ["missing", "denied", "changed", "truncated", "empty"])
    await t.test(shape, async () => {
      const value = {
        workspaceId: "w",
        workspacePath: "/fixture",
        path: "/fixture/.opencode/agents",
        ...(shape === "missing"
          ? { status: "missing", reason: "path_missing" }
          : shape === "denied"
            ? { status: "unavailable", reason: "path_denied" }
            : shape === "changed"
              ? { status: "unavailable", reason: "file_changed" }
              : {
                  status: "available",
                  entries:
                    shape === "empty"
                      ? []
                      : [{ sourceName: "alpha", path: agentPath() }],
                  truncated: shape === "truncated",
                }),
      };
      const h = bridgeHarness((e) =>
          e.operation.type === "configuration.agent.list"
            ? { ok: true, value }
            : readFallback(e),
        ),
        client = createWindowWorkbench(h.bridge, { clock: fakeClock(), id });
      try {
        seed(client.store);
        assert.equal(await client.actions.listAgentFiles(), true);
        const listing = selectors.agentFiles(client.store.getState()).listing;
        assert.equal(listing.status, value.status);
        assert.equal(listing.reason, value.reason);
        assert.equal(
          h.calls.some((e) => e.operation.type === "configuration.agent.read"),
          false,
        );
        if (shape === "truncated") {
          value.entries[0].sourceName = "beta";
          value.entries.length = 0;
          assert.equal(listing.entries[0].sourceName, "alpha");
          assert.equal(listing.truncated, true);
        }
      } finally {
        client.dispose();
      }
    });
});

test("Agent timeout keeps actual IO hold after lookup resolves; explicit new read waits for original IO settlement", async () => {
  const waiting = deferred();
  let envelope;
  const { client, calls, clock } = agentHarness(agentRead(), (e) => {
    envelope = e;
    return waiting.promise;
  });
  try {
    await loadAgent(client);
    editAgent(client);
    const saving = client.actions.saveAgentFile();
    for (let n = 0; n < 30 && !envelope; n++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.ok(envelope);
    await clock.advance(10000);
    assert.equal(await saving, false);
    client.store.dispatch({
      type: "receipt",
      id: operationKey(envelope.runtimeEpoch, envelope.operationId),
      receipt: agentSavedResponse(envelope).receipt,
    });
    seed(client.store, snapshot(2));
    assert.equal(client.store.getState().configurationIO.saves, 1);
    assert.equal(selectors.canReadAgentFiles(client.store.getState()), false);
    client.actions.discardAgentFile();
    editAgent(client, "# Later\n");
    assert.equal(await client.actions.readAgentFile(), false);
    waiting.resolve(agentSavedResponse(envelope));
    await flush();
    assert.equal(client.store.getState().configurationIO.saves, 0);
    assert.equal(await client.actions.readAgentFile(), true);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.save")
        .length,
      1,
    );
  } finally {
    waiting.resolve({ ok: false, code: "UNAVAILABLE" });
    client.dispose();
  }
});

test("Agent current-read/list selectors retire floor and source ABA authority", async () => {
  const { client } = agentHarness();
  try {
    await loadAgent(client);
    assert.equal(selectors.agentReadCurrent(client.store.getState()), true);
    assert.equal(selectors.agentListCurrent(client.store.getState()), true);
    client.actions.selectAgentFile("beta");
    client.actions.selectAgentFile("alpha");
    assert.equal(selectors.agentReadCurrent(client.store.getState()), false);
    assert.equal(await client.actions.readAgentFile(), true);
    seed(client.store, snapshot(2));
    assert.equal(selectors.agentReadCurrent(client.store.getState()), false);
    assert.equal(selectors.agentListCurrent(client.store.getState()), false);
  } finally {
    client.dispose();
  }
});

const agentRuntimeText =
  '---\n{"description":"Exact Agent","mode":"primary","color":"#112233"}\n---\nUse exact system.\r\n';
const agentHash = (text) => createHash("sha256").update(text).digest("hex");
const agentRuntimeRow = (
  operationId = "original-register",
  text = agentRuntimeText,
) => {
  const owner = {
    runtimeEpoch: "epoch-a",
    workspaceId: "w",
    workspacePath: "/fixture",
    sourceName: "alpha",
    operationId,
    digest: agentHash(text),
  };
  const parsed = parseAgentRuntimeRecord(text, owner);
  return {
    sourceName: "alpha",
    nativeId: parsed.id,
    digest: agentHash(text),
    nativeDigest: nativeAgentDigest(parsed),
    registrationRuntimeEpoch: "epoch-a",
    registrationOperationId: operationId,
    name: parsed.name,
    system: parsed.system,
    systemDigest: agentHash(parsed.system),
    path: agentPath(),
    mode: "primary",
    hidden: false,
    permissions: parsed.permissions,
    referenceCount: 0,
    ...(parsed.description ? { description: parsed.description } : {}),
    ...(parsed.color ? { color: parsed.color } : {}),
  };
};
function agentRuntimeObservation(owned = [], extra = {}) {
  return {
    workspaceId: "w",
    workspacePath: "/fixture",
    runtimeEpoch: "epoch-a",
    status: "observed",
    observationId: "agent-observation",
    defaultAgentId: "builtin-default",
    owned,
    unowned: [
      {
        nativeId: "builtin-default",
        name: "Default",
        mode: "primary",
        hidden: false,
      },
    ],
    file: {
      sourceName: "alpha",
      status: "available",
      version: "a".repeat(64),
      directoryVersion: "d".repeat(64),
      digest: agentHash(agentRuntimeText),
    },
    ...extra,
  };
}
function agentRuntimeConfirmed(e, row = agentRuntimeRow(e.operationId)) {
  const {
    sourceName,
    nativeId,
    digest,
    nativeDigest,
    registrationRuntimeEpoch,
    registrationOperationId,
    systemDigest,
  } = row;
  const register = e.operation.type.endsWith("register");
  const proof = {
    sourceName,
    nativeId,
    digest,
    nativeDigest,
    registrationRuntimeEpoch,
    registrationOperationId,
    systemDigest,
    defaultAgentId: "builtin-default",
    ...(register
      ? { version: "a".repeat(64), directoryVersion: "d".repeat(64) }
      : {}),
  };
  return {
    ok: true,
    value: {
      requestId: e.operationId,
      status: register ? "registered_primary" : "removed",
      ...proof,
    },
    receipt: receipt(e, {
      evidence: [
        {
          kind: "dispatch",
          id: register ? "native.agent.register" : "native.agent.remove",
        },
      ],
      result: {
        kind: register ? "agent_registered" : "agent_removed",
        workspaceId: "w",
        ...proof,
      },
    }),
  };
}

function agentRuntimeHarness({
  observation = agentRuntimeObservation(),
  mutate,
  lookup,
  fileText = agentRuntimeText,
  onRefocus,
} = {}) {
  const h = bridgeHarness((e) => {
    if (e.operation.type === "configuration.agent.list")
      return {
        ok: true,
        value: {
          workspaceId: "w",
          workspacePath: "/fixture",
          path: "/fixture/.opencode/agents",
          status: "available",
          entries: ["alpha", "beta"].map((sourceName) => ({
            sourceName,
            path: agentPath(sourceName),
          })),
          truncated: false,
        },
      };
    if (e.operation.type === "configuration.agent.read")
      return {
        ok: true,
        value: agentRead(e.operation.sourceName, fileText),
      };
    if (e.operation.type === "configuration.agent.runtime.read")
      return typeof observation === "function"
        ? observation(e)
        : { ok: true, value: observation };
    if (
      ["configuration.agent.register", "configuration.agent.remove"].includes(
        e.operation.type,
      )
    )
      return (
        mutate?.(e) ??
        agentRuntimeConfirmed(
          e,
          e.operation.type.endsWith("register") ? undefined : agentRuntimeRow(),
        )
      );
    if (e.operation.type === "operation.lookup" && lookup) return lookup(e);
    return readFallback(e);
  });
  const clock = fakeClock(),
    client = createWindowWorkbench(h.bridge, {
      clock,
      id,
      ...(onRefocus ? { onRefocus } : {}),
    });
  seed(client.store);
  return { ...h, client, clock };
}

test("Native Agent explicit actions register exact unchanged file without session scope and retire observation at receipt floor", async () => {
  const { client, calls } = agentRuntimeHarness();
  try {
    await loadAgent(client);
    assert.equal(
      calls.some(
        (e) => e.operation.type === "configuration.agent.runtime.read",
      ),
      false,
    );
    assert.equal(await client.actions.registerAgent(), false);
    assert.equal(await client.actions.observeAgentRuntime(), true);
    const read = calls.find(
      (e) => e.operation.type === "configuration.agent.runtime.read",
    );
    assert.equal(read.operation.sourceName, "alpha");
    assert.equal(Object.hasOwn(read.operation, "sessionId"), false);
    assert.equal(selectors.canRegisterAgent(client.store.getState()), true);
    assert.equal(await client.actions.registerAgent(), true);
    const sent = calls.find(
      (e) => e.operation.type === "configuration.agent.register",
    );
    assert.equal(sent.operation.requestId, sent.operationId);
    assert.equal(Object.hasOwn(sent.operation, "sessionId"), false);
    assert.equal(Object.hasOwn(sent.operation, "text"), false);
    assert.equal(sent.operation.digest, agentHash(agentRuntimeText));
    assert.equal(sent.operation.version, "a".repeat(64));
    assert.equal(sent.operation.directoryVersion, "d".repeat(64));
    assert.equal(
      selectors.currentAgentRuntimeObservation(client.store.getState()),
      undefined,
    );
    assert.equal(await client.actions.observeAgentRuntime(), false);
    seed(client.store, snapshot(2));
    assert.equal(
      calls.filter(
        (e) => e.operation.type === "configuration.agent.runtime.read",
      ).length,
      1,
    );
  } finally {
    client.dispose();
  }
});

function waitForAgentRuntimeState(client, predicate) {
  if (predicate(client.store.getState())) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      unsubscribe();
      reject(new Error("Agent runtime state checkpoint timed out"));
    }, 2000);
    const unsubscribe = client.store.subscribe((state) => {
      if (predicate(state)) {
        clearTimeout(timeout);
        unsubscribe();
        resolve();
      }
    });
  });
}
function changeAgentRuntimeScope(client, change) {
  if (change === "edit") client.actions.editAgentFile("# New draft\n");
  if (change === "discard") {
    client.actions.discardAgentFile();
    client.actions.editAgentFile("# Replacement\n");
  }
  if (change === "source") {
    client.actions.selectAgentFile("beta");
    client.actions.selectAgentFile("alpha");
  }
  if (change === "session") {
    client.actions.select("w", "b");
    client.actions.select("w", "a");
  }
  if (change === "workspace") client.actions.select("other", "other-a");
  if (change === "root")
    seed(
      client.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), path: "/changed" }] }),
    );
  if (change === "trust")
    seed(client.store, snapshot(1, "a", { workspaces: [workspace("w", 2)] }));
  if (change === "untrusted")
    seed(
      client.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), trusted: false }] }),
    );
  if (change === "epoch") {
    client.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(client.store.getState()), bootstrap: true },
      value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
    });
    assert.equal(client.store.getState().epoch, "epoch-b");
  }
  if (change === "floor") seed(client.store, snapshot(2));
  if (change === "cancel") client.actions.cancelAgentRuntimeObservation();
  if (change === "dispose") client.dispose();
  if (change === "running")
    seed(
      client.store,
      snapshot(1, "a", {
        sessions: [session("a"), session("b", "w", { status: "running" })],
      }),
    );
  if (change === "permission")
    seed(
      client.store,
      snapshot(1, "a", {
        permissions: [
          {
            id: "p",
            workspaceId: "w",
            sessionId: "a",
            permission: "read",
            patterns: [],
          },
        ],
      }),
    );
}

test("Native Agent late explicit observation drops selection ABA, draft edits/discard, epoch/root/trust/floor and cancellation", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "session",
    "workspace",
    "root",
    "trust",
    "untrusted",
    "epoch",
    "floor",
    "cancel",
    "dispose",
    "running",
    "permission",
  ])
    await t.test(change, async () => {
      const wait = deferred(),
        { client, calls } = agentRuntimeHarness({
          observation: () => wait.promise,
        });
      try {
        await loadAgent(client);
        const reading = client.actions.observeAgentRuntime();
        await flush();
        changeAgentRuntimeScope(client, change);
        wait.resolve({
          ok: true,
          value: agentRuntimeObservation([agentRuntimeRow()]),
        });
        assert.equal(await reading, false);
        assert.equal(
          selectors.currentAgentRuntimeObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          calls.some((e) =>
            [
              "configuration.agent.register",
              "configuration.agent.remove",
            ].includes(e.operation.type),
          ),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent changed file baseline and unsupported or dirty content cannot register", async (t) => {
  for (const change of [
    "version",
    "directoryVersion",
    "digest",
    "missing",
    "unsupported",
    "dirty",
    "no-read",
    "new-edit",
  ])
    await t.test(change, async () => {
      const observed = agentRuntimeObservation();
      if (["version", "directoryVersion", "digest"].includes(change))
        observed.file[change] = "e".repeat(64);
      if (change === "missing")
        observed.file = {
          sourceName: "alpha",
          status: "missing",
          reason: "missing_file",
        };
      if (change === "unsupported")
        observed.file = {
          sourceName: "alpha",
          status: "unsupported",
          reason: "unsupported_content",
        };
      const { client, calls } = agentRuntimeHarness({ observation: observed });
      try {
        if (change === "no-read") {
          await client.actions.listAgentFiles();
          client.actions.selectAgentFile("alpha");
        } else await loadAgent(client);
        if (change === "dirty") client.actions.editAgentFile("# Dirty\n");
        assert.equal(await client.actions.observeAgentRuntime(), true);
        if (change === "new-edit") {
          client.actions.editAgentFile("# Later\n");
          client.actions.editAgentFile(agentRuntimeText);
        }
        assert.equal(await client.actions.registerAgent(), false);
        assert.equal(
          calls.some(
            (e) => e.operation.type === "configuration.agent.register",
          ),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent closed observation rejects forged prefix ownership, wrong content/digest, scope, duplicates and unknown fields", async (t) => {
  const changes = {
    sparseOwned: (o) => (o.owned = Array(1)),
    sparseUnowned: (o) => (o.unowned = Array(1)),
    prefix: (o) => (o.owned[0].nativeId = `omoc-agent-${"0".repeat(64)}`),
    registration: (o) => (o.owned[0].registrationOperationId = "borrowed-key"),
    epoch: (o) => (o.owned[0].registrationRuntimeEpoch = "previous-epoch"),
    system: (o) => (o.owned[0].system = "Different Native system"),
    systemDigest: (o) => (o.owned[0].systemDigest = "0".repeat(64)),
    nativeDigest: (o) => (o.owned[0].nativeDigest = "0".repeat(64)),
    path: (o) => (o.owned[0].path = "/other/.opencode/agents/alpha/SKILL.md"),
    policy: (o) => (o.owned[0].permissions[0].effect = "allow"),
    duplicate: (o) => o.owned.push(o.owned[0]),
    extra: (o) => (o.owned[0].origin = "direct"),
    workspace: (o) => (o.workspaceId = "other"),
    root: (o) => (o.workspacePath = "/other"),
    session: (o) => (o.session = { sessionId: "b" }),
    file: (o) => (o.file.sourceName = "beta"),
    unownedCollision: (o) =>
      o.unowned.push({ nativeId: o.owned[0].nativeId, name: "Same ID" }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const observed = agentRuntimeObservation([agentRuntimeRow()]);
      change(observed);
      const { client } = agentRuntimeHarness({ observation: observed });
      try {
        await loadAgent(client);
        assert.equal(await client.actions.observeAgentRuntime(), false);
        assert.equal(
          await client.actions.removeAgent(agentRuntimeRow().nativeId),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent malformed mutation DTO or receipt never fabricates success or advances receipt floor", async (t) => {
  const both = (r, key, value) => {
    r.value[key] = value;
    r.receipt.result[key] = value;
  };
  const changes = {
    request: (r) => (r.value.requestId = "other"),
    extra: (r) => (r.value.content = "injected body"),
    unknownSuccess: (r) =>
      (r.value = { requestId: r.value.requestId, status: "unknown" }),
    source: (r) => both(r, "sourceName", "beta"),
    id: (r) => both(r, "nativeId", `omoc-agent-${"0".repeat(64)}`),
    digest: (r) => both(r, "digest", "0".repeat(64)),
    systemDigest: (r) => both(r, "systemDigest", "0".repeat(64)),
    nativeDigest: (r) => both(r, "nativeDigest", "0".repeat(64)),
    version: (r) => both(r, "version", "0".repeat(64)),
    directoryVersion: (r) => both(r, "directoryVersion", "0".repeat(64)),
    originalKey: (r) => both(r, "registrationOperationId", "other-key"),
    epoch: (r) => both(r, "registrationRuntimeEpoch", "other-epoch"),
    workspace: (r) => (r.receipt.workspaceId = "other"),
    session: (r) => (r.receipt.sessionId = "a"),
    admission: (r) => (r.receipt.admission = "admitted"),
    delivery: (r) => (r.receipt.delivery = "pending"),
    none: (r) => (r.receipt.effect = "none"),
    floor: (r) => (r.receipt.revision = 1),
    evidence: (r) => (r.receipt.evidence = []),
    kind: (r) => (r.receipt.result.kind = "agent_removed"),
    raw: (r) => (r.receipt.result.content = "injected body"),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { client } = agentRuntimeHarness({
        mutate: (e) => {
          const response = agentRuntimeConfirmed(e);
          change(response);
          return response;
        },
      });
      try {
        await loadAgent(client);
        await client.actions.observeAgentRuntime();
        assert.equal(await client.actions.registerAgent(), false);
        assert.equal(
          client.store.getState().agentRuntime.action.status,
          "unknown",
        );
        assert.equal(client.store.getState().revision, 1);
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent unknown retains original-key lookup only, blocks every matching session and keeps drafts editable", async () => {
  let original,
    resolved = false;
  const { client, calls, clock } = agentRuntimeHarness({
    mutate: (e) => {
      original = e;
      return {
        ok: true,
        value: { requestId: e.operationId, status: "unknown" },
      };
    },
    lookup: (e) =>
      resolved
        ? {
            ok: true,
            value: {
              status: "found",
              runtimeEpoch: original.runtimeEpoch,
              operationId: original.operationId,
              receipt: agentRuntimeConfirmed(original).receipt,
            },
          }
        : readFallback(e),
  });
  try {
    await loadAgent(client);
    await client.actions.observeAgentRuntime();
    assert.equal(await client.actions.registerAgent(), false);
    await flush();
    const key = operationKey(original.runtimeEpoch, original.operationId);
    const intent = client.store.getState().operations[key];
    assert.equal(intent.lookupOnly, true);
    assert.deepEqual(intent.operation, {
      type: "configuration.agent.register",
      workspaceId: "w",
    });
    assert.equal(intent.agentRuntimeMutation.request, undefined);
    assert.equal(intent.agentRuntimeMutation.target.content, undefined);
    client.actions.editAgentFile("# Editable after unknown\n");
    assert.equal(
      selectors.agentDraft(client.store.getState()).text,
      "# Editable after unknown\n",
    );
    assert.equal(
      selectors.canObserveAgentRuntime(client.store.getState()),
      false,
    );
    assert.equal(resourceMutationDisabled(client.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(client.store.getState()), true);
    client.actions.selectAgentFile("beta");
    assert.equal(client.store.getState().agentFiles.sourceName, "beta");
    client.actions.select("w", "b");
    assert.equal(
      await client.actions.mutate({ ...send(), sessionId: "b" }),
      false,
    );
    client.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(client.store.getState()), bootstrap: true },
      value: snapshot(1, "b", { runtimeEpoch: "epoch-b" }),
    });
    assert.equal(client.store.getState().epoch, "epoch-b");
    resolved = true;
    await clock.advance(5000);
    await waitForAgentRuntimeState(
      client,
      (state) => state.operations[key].status === "accepted",
    );
    assert.equal(client.store.getState().operations[key].status, "accepted");
    assert.equal(
      client.store.getState().revision,
      1,
      "historical ACK cannot advance current epoch floor",
    );
    const queries = calls.filter(
      (e) => e.operation.type === "operation.lookup",
    );
    const fresh = queries.find((e) => e.runtimeEpoch === "epoch-b");
    assert.equal(fresh.operation.runtimeEpoch, "epoch-a");
    assert.equal(fresh.operation.operationId, original.operationId);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.register")
        .length,
      1,
    );
    assert.equal(
      selectors.currentAgentRuntimeObservation(client.store.getState()),
      undefined,
    );
  } finally {
    client.dispose();
  }
});

test("Native Agent register rechecks authority after asynchronous SHA before any dispatch", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "session",
    "workspace",
    "root",
    "trust",
    "untrusted",
    "epoch",
    "floor",
    "dispose",
    "running",
    "permission",
  ])
    await t.test(change, async () => {
      const { client, calls } = agentRuntimeHarness();
      try {
        await loadAgent(client);
        await client.actions.observeAgentRuntime();
        const registering = client.actions.registerAgent();
        changeAgentRuntimeScope(client, change);
        assert.equal(await registering, false);
        assert.equal(
          calls.some(
            (e) => e.operation.type === "configuration.agent.register",
          ),
          false,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent late ACK records original action only and preserves later draft or changed scope", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "source",
    "session",
    "workspace",
    "root",
    "trust",
    "epoch",
    "floor",
  ])
    await t.test(change, async () => {
      let original;
      const dispatched = deferred();
      const wait = deferred(),
        { client } = agentRuntimeHarness({
          mutate: (e) => {
            original = e;
            dispatched.resolve();
            return wait.promise;
          },
        });
      try {
        await loadAgent(client);
        await client.actions.observeAgentRuntime();
        const registering = client.actions.registerAgent();
        await dispatched.promise;
        assert.ok(original);
        changeAgentRuntimeScope(client, change);
        wait.resolve(agentRuntimeConfirmed(original));
        assert.equal(await registering, true);
        assert.equal(
          client.store.getState().operations[
            operationKey(original.runtimeEpoch, original.operationId)
          ].status,
          "accepted",
        );
        assert.equal(
          selectors.currentAgentRuntimeObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.agentRuntimeActionCurrent(client.store.getState()),
          false,
        );
        if (change === "edit")
          assert.equal(
            selectors.agentDraft(client.store.getState()).text,
            "# New draft\n",
          );
        if (change === "discard")
          assert.equal(
            selectors.agentDraft(client.store.getState()).text,
            "# Replacement\n",
          );
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent pending actual IO stays held after timeout and receipt lookup, no mutation replay", async () => {
  let original,
    resolved = false;
  const dispatched = deferred();
  const pending = deferred(),
    { client, clock, calls } = agentRuntimeHarness({
      mutate: (e) => {
        original = e;
        dispatched.resolve();
        return pending.promise;
      },
      lookup: (e) =>
        resolved
          ? {
              ok: true,
              value: {
                status: "found",
                runtimeEpoch: original.runtimeEpoch,
                operationId: original.operationId,
                receipt: agentRuntimeConfirmed(original).receipt,
              },
            }
          : readFallback(e),
    });
  try {
    await loadAgent(client);
    await client.actions.observeAgentRuntime();
    const registering = client.actions.registerAgent();
    await dispatched.promise;
    assert.ok(original);
    await clock.advance(10000);
    assert.equal(await registering, false);
    assert.equal(client.store.getState().configurationIO.saves, 1);
    client.actions.discardAgentFile();
    client.actions.editAgentFile("# Replacement\n");
    resolved = true;
    await clock.advance(5000);
    const key = operationKey(original.runtimeEpoch, original.operationId);
    await waitForAgentRuntimeState(
      client,
      (state) => state.operations[key].status === "accepted",
    );
    assert.equal(client.store.getState().operations[key].status, "accepted");
    seed(client.store, snapshot(2));
    assert.equal(await client.actions.observeAgentRuntime(), false);
    pending.resolve(agentRuntimeConfirmed(original));
    await flush();
    assert.equal(client.store.getState().configurationIO.saves, 0);
    assert.equal(
      selectors.agentDraft(client.store.getState()).text,
      "# Replacement\n",
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.register")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Native Agent restored original keys are lookup-only and enforce exact workspace/session scope", () => {
  for (const type of [
    "configuration.agent.register",
    "configuration.agent.remove",
  ]) {
    const key = {
      authorityHold: true,
      runtimeEpoch: "original-epoch",
      operationId: "original-id",
      type,
      workspaceId: "w",
      ...(type.endsWith("apply") ? { sessionId: "a" } : {}),
    };
    const store = createWorkbenchStore();
    seed(store, snapshot(1, "a", { retainedOperations: [key] }));
    const retained =
      store.getState().operations[
        operationKey(key.runtimeEpoch, key.operationId)
      ];
    assert.equal(retained.lookupOnly, true);
    assert.equal(retained.agentRuntimeMutation, undefined);
    assert.equal(retained.operation.requestId, undefined);
    assert.equal(resourceMutationDisabled(store.getState(), "w"), true);
    for (const invalid of [
      { ...key, workspaceId: undefined },
      { ...key, sessionId: type.endsWith("apply") ? undefined : "a" },
    ]) {
      const wrong = createWorkbenchStore();
      seed(wrong, snapshot(1, "a", { retainedOperations: [invalid] }));
      assert.equal(wrong.getState().epoch, undefined);
    }
  }
});

test("Native Agent start, selection, poll, save/load and refocus never read or mutate Native automatically", async () => {
  let refocus;
  const { client, clock, calls } = agentRuntimeHarness({
    onRefocus: (listener) => {
      refocus = listener;
      return () => {};
    },
  });
  try {
    client.start();
    await flush();
    await loadAgent(client);
    client.actions.selectAgentFile("beta");
    client.actions.selectAgentFile("alpha");
    client.actions.refresh();
    refocus();
    await clock.advance(15000);
    assert.equal(
      calls.some((e) =>
        [
          "configuration.agent.runtime.read",
          "configuration.agent.register",
          "configuration.agent.remove",
        ].includes(e.operation.type),
      ),
      false,
    );
    assert.equal(
      await client.actions.mutate({
        type: "configuration.agent.register",
        workspaceId: "w",
        requestId: "bypass",
        sourceName: "alpha",
        observationId: "fake",
        version: "a".repeat(64),
        directoryVersion: "d".repeat(64),
        digest: agentHash(agentRuntimeText),
      }),
      false,
    );
  } finally {
    client.dispose();
  }
});

test("Native Agent removal requires zero complete global references and keeps default and sessions unchanged", async (t) => {
  for (const referenceCount of [0, 1, 1024])
    await t.test(String(referenceCount), async () => {
      const row = { ...agentRuntimeRow(), referenceCount };
      const { client, calls } = agentRuntimeHarness({
        observation: agentRuntimeObservation([row]),
      });
      try {
        await loadAgent(client);
        assert.equal(await client.actions.observeAgentRuntime(), true);
        assert.equal(
          selectors.canRegisterAgent(client.store.getState()),
          false,
        );
        assert.equal(
          selectors.canRemoveAgent(client.store.getState(), row.nativeId),
          referenceCount === 0,
        );
        assert.equal(
          await client.actions.removeAgent(row.nativeId),
          referenceCount === 0,
        );
        const sent = calls.find(
          (e) => e.operation.type === "configuration.agent.remove",
        );
        if (referenceCount === 0) {
          assert.equal(Object.hasOwn(sent.operation, "sessionId"), false);
          assert.equal(Object.hasOwn(sent.operation, "sourceName"), false);
          assert.equal(
            client.store.getState().agentRuntime.action.status,
            "removed",
          );
          assert.equal(
            selectors.currentAgentRuntimeObservation(client.store.getState()),
            undefined,
          );
          assert.equal(client.store.getState().selection.sessionId, "a");
          assert.equal(
            selectors.agentDraft(client.store.getState()).text,
            agentRuntimeText,
          );
          assert.equal(await client.actions.observeAgentRuntime(), false);
          seed(client.store, snapshot(2));
          assert.equal(await client.actions.observeAgentRuntime(), true);
        } else assert.equal(sent, undefined);
      } finally {
        client.dispose();
      }
    });
});

test("Native Agent unavailable reference proof and foreign rows never grant removal", async () => {
  const row = agentRuntimeRow();
  for (const observation of [
    {
      workspaceId: "w",
      workspacePath: "/fixture",
      runtimeEpoch: "epoch-a",
      status: "unavailable",
      reason: "references_unverified",
    },
    agentRuntimeObservation([], {
      unowned: [
        {
          nativeId: "builtin-default",
          name: "Default",
          mode: "primary",
          hidden: false,
        },
        {
          nativeId: row.nativeId,
          name: "Foreign",
          mode: "primary",
          hidden: false,
        },
      ],
    }),
  ]) {
    const { client, calls } = agentRuntimeHarness({ observation });
    try {
      await loadAgent(client);
      assert.equal(await client.actions.observeAgentRuntime(), true);
      assert.equal(await client.actions.removeAgent(row.nativeId), false);
      assert.equal(
        calls.some((e) => e.operation.type === "configuration.agent.remove"),
        false,
      );
    } finally {
      client.dispose();
    }
  }
});

test("Native Agent exact default preservation is checked in response and receipt", async () => {
  const { client } = agentRuntimeHarness({
    mutate: (e) => {
      const r = agentRuntimeConfirmed(e);
      r.value.defaultAgentId = "different-default";
      r.receipt.result.defaultAgentId = "different-default";
      return r;
    },
  });
  try {
    await loadAgent(client);
    await client.actions.observeAgentRuntime();
    assert.equal(await client.actions.registerAgent(), false);
    assert.equal(client.store.getState().revision, 1);
    assert.equal(client.store.getState().agentRuntime.action.status, "unknown");
  } finally {
    client.dispose();
  }
});

test("Agent held and untrusted drafts remain selectable and editable without granting IO authority", async () => {
  const { client, calls } = agentHarness();
  try {
    await loadAgent(client);
    client.actions.editAgentFile("# Alpha held\n");
    seed(
      client.store,
      snapshot(2, "a", {
        state: "unavailable",
        workspaces: [{ ...workspace(), trusted: false, trustRevision: 2 }],
        recovery: {
          store: { state: "recovery_required", reason: "owner_unverified" },
          resources: [],
        },
      }),
    );
    assert.equal(client.store.getState().lists.workspaces[0].trusted, false);
    assert.equal(
      client.store.getState().recovery.store.state,
      "recovery_required",
    );
    client.actions.selectAgentFile("beta");
    client.actions.editAgentFile("# Beta held\n");
    client.actions.selectAgentFile("alpha");
    assert.equal(
      selectors.agentDraft(client.store.getState()).text,
      "# Alpha held\n",
    );
    client.actions.validateAgentFile();
    assert.equal(
      selectors.agentDraft(client.store.getState()).validation.status,
      "valid",
    );
    assert.equal(await client.actions.readAgentFile(), false);
    assert.equal(await client.actions.saveAgentFile(), false);
    assert.equal(await client.actions.observeAgentRuntime(), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "configuration.agent.read")
        .length,
      1,
    );
  } finally {
    client.dispose();
  }
});

test("Native Agent browser file/system/Native digests match actual producer for BOM and line endings", async (t) => {
  for (const newline of ["\n", "\r\n"])
    await t.test(JSON.stringify(newline), async () => {
      const text = `\uFEFF---${newline}{"description":"한글","color":"#abc123"}${newline}---${newline}  Exact 한글 system.  ${newline}`;
      const row = agentRuntimeRow("original-register", text);
      const observation = agentRuntimeObservation([], {
        file: {
          sourceName: "alpha",
          status: "available",
          version: "a".repeat(64),
          directoryVersion: "d".repeat(64),
          digest: agentHash(text),
        },
      });
      const { client } = agentRuntimeHarness({
        observation,
        fileText: text,
        mutate: (e) =>
          agentRuntimeConfirmed(e, agentRuntimeRow(e.operationId, text)),
      });
      try {
        await loadAgent(client);
        assert.equal(await client.actions.observeAgentRuntime(), true);
        assert.equal(await client.actions.registerAgent(), true);
        const target =
          client.store.getState().agentRuntime.action.identity.target;
        assert.equal(target.systemDigest, row.systemDigest);
        assert.equal(
          target.nativeDigest,
          agentRuntimeRow(target.registrationOperationId, text).nativeDigest,
        );
      } finally {
        client.dispose();
      }
    });
});

const extensionsObservation = (extra = {}) => ({
  workspaceId: "w",
  workspacePath: "/fixture",
  runtimeEpoch: "epoch-a",
  revision: 1,
  status: "available",
  plugins: {
    status: "available",
    rows: [
      {
        id: "local-plugin",
        state: "active",
        source: { type: "local", path: "/fixture/plugins/full-path.mjs" },
        features: { server: true, tui: false, rpc: true },
      },
    ],
  },
  tools: {
    status: "available",
    rows: [{ id: "native-tool", name: "Native tool" }],
  },
  hooks: { status: "not_reported", reason: "inventory_not_supported" },
  ...extra,
});
function extensionsHarness({
  observe = () => ({ ok: true, value: extensionsObservation() }),
  ...options
} = {}) {
  const h = bridgeHarness((e) =>
    e.operation.type === "configuration.extensions.read"
      ? observe(e)
      : readFallback(e),
  );
  const clock = fakeClock();
  const client = createWindowWorkbench(h.bridge, { clock, id, ...options });
  seed(client.store);
  return { client, clock, ...h };
}

test("Extensions explicit workspace read uses the frozen envelope and detached current state", async () => {
  const value = extensionsObservation();
  const { client, calls } = extensionsHarness({
    observe: () => ({ ok: true, value }),
  });
  try {
    assert.equal(
      selectors.currentExtensionObservation(client.store.getState()),
      undefined,
    );
    assert.equal(selectors.canObserveExtensions(client.store.getState()), true);
    assert.equal(await client.actions.observeExtensions(), true);
    const e = calls.find(
      (e) => e.operation.type === "configuration.extensions.read",
    );
    assert.deepEqual(e.operation, {
      type: "configuration.extensions.read",
      workspaceId: "w",
    });
    assert.deepEqual(Object.keys(e).sort(), [
      "operation",
      "readId",
      "runtimeEpoch",
      "version",
    ]);
    const current = selectors.currentExtensionObservation(
      client.store.getState(),
    );
    assert.deepEqual(current, value);
    value.plugins.rows[0].id = "changed-after-read";
    assert.equal(current.plugins.rows[0].id, "local-plugin");
    assert.equal(
      selectors.extensions(client.store.getState()).request,
      undefined,
    );
    assert.equal(client.store.getState().configurationIO.reads, 0);
    assert.deepEqual(client.store.getState().operations, {});
  } finally {
    client.dispose();
  }
});

test("Extensions reject closed malformed, duplicate, sparse and scope/floor responses", async (t) => {
  const cases = {
    extra: (v) => {
      v.payload = {};
    },
    executable: (v) => {
      v.tools.rows[0].execute = () => {};
    },
    duplicate: (v) => {
      v.tools.rows.push({ ...v.tools.rows[0] });
    },
    sparse: (v) => {
      v.plugins.rows = new Array(1);
    },
    inconsistent: (v) => {
      v.status = "partial";
    },
    hooks: (v) => {
      v.hooks = { status: "available", rows: [] };
    },
    unavailableRows: (v) => {
      v.plugins = {
        status: "unavailable",
        reason: "invalid_response",
        rows: [],
      };
    },
    wrongWorkspace: (v) => {
      v.workspaceId = "other";
    },
    wrongRoot: (v) => {
      v.workspacePath = "/different";
    },
    wrongEpoch: (v) => {
      v.runtimeEpoch = "epoch-b";
    },
    oldFloor: (v) => {
      v.revision = 0;
    },
    aheadFloor: (v) => {
      v.revision = 2;
    },
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const value = extensionsObservation();
      change(value);
      const { client } = extensionsHarness({
        observe: () => ({ ok: true, value }),
      });
      try {
        assert.equal(await client.actions.observeExtensions(), false);
        assert.equal(
          selectors.currentExtensionObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.extensions(client.store.getState()).error,
          "EXTENSIONS_UNVERIFIED",
        );
        assert.equal(client.store.getState().revision, 1);
      } finally {
        client.dispose();
      }
    });
});

test("Extensions available empty, partial and unavailable inventories remain distinct", async (t) => {
  for (const status of ["available", "partial", "unavailable"])
    await t.test(status, async () => {
      const value = extensionsObservation({
        status,
        plugins:
          status === "unavailable"
            ? { status: "unavailable", reason: "runtime_unavailable" }
            : { status: "available", rows: [] },
        tools:
          status === "available"
            ? { status: "available", rows: [] }
            : { status: "unavailable", reason: "limit_reached" },
      });
      const { client } = extensionsHarness({
        observe: () => ({ ok: true, value }),
      });
      try {
        assert.equal(await client.actions.observeExtensions(), true);
        assert.deepEqual(
          selectors.currentExtensionObservation(client.store.getState()),
          value,
        );
        if (status !== "available")
          assert.equal(
            Object.hasOwn(
              selectors.currentExtensionObservation(client.store.getState())
                .tools,
              "rows",
            ),
            false,
          );
      } finally {
        client.dispose();
      }
    });
});

test("Extensions late reads are retired across epoch, trust, root, floor, workspace ABA, disconnect and hold", async (t) => {
  const changes = {
    epoch: (s) =>
      s.dispatch({
        type: "snapshot",
        scope: { ...scopeOf(s.getState()), bootstrap: true },
        value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
      }),
    trust: (s) =>
      seed(s, snapshot(1, "a", { workspaces: [workspace("w", 2)] })),
    rootABA: (s) => {
      seed(
        s,
        snapshot(1, "a", {
          workspaces: [{ ...workspace(), path: "/different" }],
        }),
      );
      seed(s);
    },
    floor: (s) => seed(s, snapshot(2)),
    workspaceABA: (s) => {
      s.dispatch({ type: "select", workspaceId: "other" });
      s.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
      seed(s);
    },
    disconnect: (s) => {
      s.dispatch({
        type: "health",
        scope: scopeOf(s.getState()),
        code: "UNAVAILABLE",
      });
      seed(s);
    },
    hold: (s) => {
      seed(
        s,
        snapshot(1, "a", {
          state: "unavailable",
          recovery: {
            store: { state: "recovery_required", reason: "owner_unverified" },
            resources: [],
          },
        }),
      );
      seed(s);
    },
    resourceHold: (s) =>
      seed(
        s,
        snapshot(1, "a", {
          recovery: {
            store: { state: "ready" },
            resources: [
              {
                workspaceId: "w",
                state: "unavailable",
                reason: "unresolved_operation",
              },
            ],
          },
        }),
      ),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const pending = deferred();
      const { client, cancellations } = extensionsHarness({
        observe: () => pending.promise,
      });
      try {
        const read = client.actions.observeExtensions();
        await flush();
        change(client.store);
        await flush();
        pending.resolve({ ok: true, value: extensionsObservation() });
        assert.equal(await read, false);
        assert.equal(
          selectors.currentExtensionObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.extensions(client.store.getState()).request,
          undefined,
        );
        assert.equal(cancellations.length, 1);
      } finally {
        client.dispose();
      }
    });
});

test("Extensions cancellation isolates the next read and never lets old finally clear its request", async () => {
  const old = deferred(),
    next = deferred();
  let count = 0;
  const { client, cancellations } = extensionsHarness({
    observe: () => (++count === 1 ? old.promise : next.promise),
  });
  try {
    const first = client.actions.observeExtensions();
    await flush();
    assert.equal(await client.actions.observeExtensions(), false);
    client.actions.cancelExtensionObservation();
    await flush();
    assert.equal(await first, false);
    assert.equal(
      selectors.extensions(client.store.getState()).error,
      "CANCELLED",
    );
    // The bounded transport keeps an unsettled cancelled slot busy.
    assert.equal(await client.actions.observeExtensions(), false);
    old.resolve({ ok: true, value: extensionsObservation({ revision: 99 }) });
    await flush();
    assert.equal(
      selectors.currentExtensionObservation(client.store.getState()),
      undefined,
    );
    const second = client.actions.observeExtensions();
    await flush();
    const identity = selectors.extensions(client.store.getState()).request;
    client.store.dispatch({
      type: "extensions.observed",
      identity: { ...identity },
      value: extensionsObservation({ revision: 99 }),
    });
    assert.equal(
      selectors.extensions(client.store.getState()).request,
      identity,
    );
    next.resolve({ ok: true, value: extensionsObservation() });
    assert.equal(await second, true);
    assert.equal(cancellations.length, 1);
  } finally {
    client.dispose();
  }
});

test("Extensions current history cannot revive after authority loss or a current receipt floor", async () => {
  const { client } = extensionsHarness();
  try {
    assert.equal(await client.actions.observeExtensions(), true);
    const history = selectors.extensions(client.store.getState()).observation;
    client.store.dispatch({
      type: "health",
      scope: scopeOf(client.store.getState()),
      code: "UNAVAILABLE",
    });
    seed(client.store);
    assert.equal(
      selectors.extensions(client.store.getState()).observation,
      history,
    );
    assert.equal(
      selectors.currentExtensionObservation(client.store.getState()),
      undefined,
    );
    assert.equal(await client.actions.observeExtensions(), true);
    const operation = send();
    client.store.dispatch({
      type: "intent",
      intent: {
        id: "extensions-receipt",
        epoch: "epoch-a",
        origin: client.store.getState().selection,
        key: selectionKey("w", "a"),
        operation,
        status: "pending",
        navigate: false,
      },
    });
    client.store.dispatch({
      type: "receipt",
      id: "extensions-receipt",
      receipt: receipt({
        runtimeEpoch: "epoch-a",
        operationId: "extensions-receipt",
        operation,
      }),
    });
    assert.equal(
      selectors.currentExtensionObservation(client.store.getState()),
      undefined,
    );
    assert.equal(await client.actions.observeExtensions(), false);
    assert.equal(client.store.getState().revision, 2);
  } finally {
    client.dispose();
  }
});

test("Extensions read never reconciles an original unknown mutation hold and drafts stay usable", async () => {
  const { client, calls } = extensionsHarness();
  try {
    client.store.dispatch({
      type: "intent",
      intent: {
        id: "original-unknown",
        epoch: "epoch-a",
        origin: client.store.getState().selection,
        key: selectionKey("w", "a"),
        operation: send(),
        status: "pending",
        navigate: false,
      },
    });
    client.store.dispatch({
      type: "unknown",
      id: "original-unknown",
      code: "UNKNOWN_OUTCOME",
    });
    const original = client.store.getState().operations;
    assert.equal(await client.actions.observeExtensions(), false);
    assert.equal(client.store.getState().operations, original);
    client.actions.editConfigurationDraft("instructions", "# Held draft");
    assert.equal(
      selectors.configurationDraft("instructions")(client.store.getState())
        .text,
      "# Held draft",
    );
    assert.equal(calls.length, 0);
  } finally {
    client.dispose();
  }
});

test("Extensions timeouts and read busy keep bounded errors and suppress late success", async (t) => {
  for (const code of [
    "READ_TIMEOUT",
    "READ_BUSY",
    "UNAVAILABLE",
    "secret raw error",
  ])
    await t.test(code, async () => {
      const pending = deferred();
      const { client, clock } = extensionsHarness({
        observe: () =>
          code === "READ_TIMEOUT"
            ? pending.promise
            : { ok: false, code, message: "private detail" },
      });
      try {
        const read = client.actions.observeExtensions();
        await flush();
        if (code === "READ_TIMEOUT") await clock.advance(10000);
        assert.equal(await read, false);
        assert.equal(
          selectors.extensions(client.store.getState()).error,
          ["READ_TIMEOUT", "READ_BUSY"].includes(code) ? code : "UNAVAILABLE",
        );
        pending.resolve({ ok: true, value: extensionsObservation() });
        await flush();
        assert.equal(
          selectors.currentExtensionObservation(client.store.getState()),
          undefined,
        );
      } finally {
        client.dispose();
      }
    });
});

test("Extensions startup, catalog, poll, selection, refocus, trust and draft load/save never auto-read", async () => {
  let refocus;
  const { client, clock, calls } = extensionsHarness({
    onRefocus: (listener) => {
      refocus = listener;
      return () => {};
    },
  });
  try {
    client.start();
    await flush();
    client.actions.openPanel("catalog");
    client.actions.refresh();
    refocus();
    client.actions.editConfigurationDraft("instructions", "# Inert");
    await client.actions.loadConfigurationDraft("instructions");
    await client.actions.saveConfigurationDraft("instructions");
    client.actions.select("w", "b");
    await flush();
    seed(client.store, snapshot(2, "b", { workspaces: [workspace("w", 2)] }));
    await clock.advance(15000);
    assert.equal(
      calls.some((e) =>
        e.operation.type.startsWith("configuration.extensions."),
      ),
      false,
    );
  } finally {
    client.dispose();
  }
});

test("Extensions reserves configuration admission synchronously before transport dispatch", async () => {
  const pending = deferred();
  const { client, calls } = extensionsHarness({
    observe: () => pending.promise,
  });
  try {
    const read = client.actions.observeExtensions();
    const competing = [
      client.actions.listSkillFiles(),
      client.actions.listAgentFiles(),
      client.actions.observeMcp(),
      client.actions.observeInstructions(),
      client.actions.loadConfigurationDraft("instructions"),
      client.actions.mutate(send()),
    ];
    assert.equal(client.store.getState().skillFiles.request, undefined);
    assert.equal(client.store.getState().agentFiles.request, undefined);
    assert.deepEqual(await Promise.all(competing), [
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    client.actions.editConfigurationDraft("instructions", "# Still editable");
    assert.equal(
      selectors.configurationDraft("instructions")(client.store.getState())
        .text,
      "# Still editable",
    );
    pending.resolve({ ok: true, value: extensionsObservation() });
    assert.equal(await read, true);
    assert.deepEqual(
      calls.map((e) => e.operation.type),
      ["configuration.extensions.read"],
    );
  } finally {
    client.dispose();
  }
});

test("Extensions successful read preserves a different workspace original unknown key exactly", async () => {
  const { client } = extensionsHarness();
  try {
    seed(
      client.store,
      snapshot(1, "a", {
        workspaces: [workspace(), { ...workspace("other"), path: "/other" }],
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "old-epoch",
            operationId: "original-other",
            type: "message.send",
            workspaceId: "other",
            sessionId: "other-a",
          },
        ],
      }),
    );
    const before = client.store.getState().operations;
    assert.equal(await client.actions.observeExtensions(), true);
    assert.equal(client.store.getState().operations, before);
    assert.equal(
      before[operationKey("old-epoch", "original-other")].status,
      "unknown",
    );
    assert.equal(
      before[operationKey("old-epoch", "original-other")].hostHeld,
      true,
    );
  } finally {
    client.dispose();
  }
});

test("Extensions store validates raw closed values before using properties or accepting direct events", async () => {
  const pending = deferred();
  const { client } = extensionsHarness({ observe: () => pending.promise });
  let getterCalls = 0;
  try {
    const read = client.actions.observeExtensions();
    await flush();
    const identity = selectors.extensions(client.store.getState()).request;
    const malformed = extensionsObservation();
    Object.defineProperty(malformed, "workspacePath", {
      enumerable: true,
      get() {
        getterCalls++;
        return "/fixture";
      },
    });
    client.store.dispatch({
      type: "extensions.observed",
      identity,
      value: malformed,
    });
    assert.equal(getterCalls, 0);
    assert.equal(
      selectors.currentExtensionObservation(client.store.getState()),
      undefined,
    );
    assert.equal(
      selectors.extensions(client.store.getState()).error,
      "EXTENSIONS_UNVERIFIED",
    );
    pending.resolve({ ok: true, value: extensionsObservation() });
    assert.equal(await read, false);
  } finally {
    client.dispose();
  }
});

test("Extensions blocks unavailable authority while keeping untrusted and disconnected drafts usable", async (t) => {
  const cases = {
    untrusted: snapshot(1, "a", {
      workspaces: [{ ...workspace(), trusted: false }],
    }),
    disconnected: snapshot(1, "a", { state: "disconnected" }),
    running: snapshot(1, "a", {
      sessions: [session("a", "w", { status: "running" }), session("b")],
    }),
    permission: snapshot(1, "a", {
      permissions: [{ id: "p", action: "read", resource: "file" }],
    }),
    held: snapshot(1, "a", {
      retainedOperations: [
        {
          authorityHold: true,
          runtimeEpoch: "epoch-a",
          operationId: "original",
          type: "message.send",
          workspaceId: "w",
          sessionId: "a",
        },
      ],
    }),
  };
  for (const [name, value] of Object.entries(cases))
    await t.test(name, async () => {
      const { client, calls } = extensionsHarness();
      try {
        seed(client.store, {
          ...value,
          observationSequence: ++snapshotSequence,
        });
        assert.equal(await client.actions.observeExtensions(), false);
        assert.equal(
          selectors.canObserveExtensions(client.store.getState()),
          false,
        );
        client.actions.editConfigurationDraft("instructions", `# ${name}`);
        client.actions.validateConfigurationDraft("instructions");
        assert.equal(
          selectors.configurationDraft("instructions")(client.store.getState())
            .text,
          `# ${name}`,
        );
        assert.equal(calls.length, 0);
      } finally {
        client.dispose();
      }
    });
});

test("Extensions feature exposes only observation controls and preserves truthful inventory labels", async () => {
  // Source contract only. Rendered layout/keyboard proof remains Main-owned.
  const source = await readFile(
    new URL(
      "./renderer/features/configuration-extensions/index.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.deepEqual(
    [
      ...new Set(
        [...source.matchAll(/actions\.(\w+)/gu)].map((match) => match[1]),
      ),
    ].sort(),
    ["cancelExtensionObservation", "observeExtensions"],
  );
  assert.equal([...source.matchAll(/<button\b/gu)].length, 2);
  for (const label of [
    "Native 확장 상태",
    "확장 상태 확인",
    "조회 취소",
    "Native 활성",
    "Native 실패",
    "Native에 등록됨",
    "hook 목록 확인 불가",
    "같은 시점의 권한 상태를 보장하지 않습니다",
    "사용 권한이나 실행 성공을 뜻하지 않습니다",
    "새 세션을 추가합니다",
  ])
    assert.ok(source.includes(label), label);
  assert.match(
    source,
    /current\.plugins\.status === "unavailable"[\s\S]*current\.plugins\.rows\.length === 0/u,
  );
  assert.match(
    source,
    /current\.tools\.status === "unavailable"[\s\S]*current\.tools\.rows\.length === 0/u,
  );
  assert.match(source, /row\.source\.path/u);
  assert.match(source, /row\.source\.target/u);
});

const workspaceFileObservation = (text = "original", extra = {}) => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  workspacePath: "/fixture",
  path: "notes.txt",
  targetPath: "/fixture/notes.txt",
  status: "available",
  content: text,
  version: "a".repeat(64),
  directoryVersion: "b".repeat(64),
  ...extra,
});
function workspaceFileHarness(
  handler = (_e) => ({ ok: true, value: workspaceFileObservation() }),
) {
  const clock = fakeClock();
  const h = bridgeHarness(handler);
  const api = createWindowWorkbench(h.bridge, { clock, id });
  seed(api.store);
  return { ...h, api, clock };
}
test("workspace file: preview is inert; explicit exact baseline preserves blank BOM and CRLF", async () => {
  for (const text of ["", "\uFEFF한글\r\n", "line\r\nnext\n"]) {
    const { api, calls } = workspaceFileHarness(() => ({
      ok: true,
      value: workspaceFileObservation(text),
    }));
    assert.equal(calls.length, 0);
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
    assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
    assert.equal(selectors.workspaceFileDraft(api.store.getState()).text, text);
    assert.equal(calls[0].operation.type, "file.edit.read");
    api.actions.editWorkspaceFile(`${text}changed`);
    api.actions.validateWorkspaceFile();
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), true);
    api.dispose();
  }
});
test("workspace file: late read cannot overwrite an edit or selection ABA", async () => {
  for (const change of ["edit", "ABA"]) {
    const pending = deferred();
    const { api } = workspaceFileHarness(() => pending.promise);
    const read = api.actions.readWorkspaceFile("notes.txt");
    await flush();
    if (change === "edit") api.actions.editWorkspaceFile("newer");
    else {
      api.actions.select("w", "b");
      api.actions.select("w", "a");
    }
    pending.resolve({ ok: true, value: workspaceFileObservation() });
    assert.equal(await read, false);
    assert.notEqual(
      selectors.workspaceFileDraft(api.store.getState()).text,
      "original",
    );
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
    api.dispose();
  }
});
test("workspace file: unavailable or protected file never creates a save baseline", async () => {
  for (const value of [
    workspaceFileObservation(undefined, {
      status: "unavailable",
      reason: "missing_file",
    }),
    workspaceFileObservation(undefined, {
      status: "unavailable",
      reason: "path_denied",
    }),
    workspaceFileObservation(undefined, {
      status: "unsupported",
      reason: "too_large",
    }),
  ]) {
    delete value.content;
    delete value.version;
    delete value.directoryVersion;
    const { api } = workspaceFileHarness(() => ({ ok: true, value }));
    assert.equal(await api.actions.readWorkspaceFile("notes.txt"), false);
    api.actions.editWorkspaceFile("draft");
    api.actions.validateWorkspaceFile();
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
    assert.equal(await api.actions.saveWorkspaceFile(), false);
    api.dispose();
  }
});

function workspaceFileSavedResponse(envelope) {
  const op = envelope.operation;
  const backupId = `.omoc-configuration-${createHash("sha256").update(operationKey(envelope.runtimeEpoch, envelope.operationId)).digest("hex")}.file.backup`;
  const admitted = {
    ...op,
    expectedRevision: envelope.expectedRevision ?? null,
  };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(admitted)
          .sort()
          .map((k) => [k, admitted[k]]),
      ),
    )
    .digest("hex");
  return {
    ok: true,
    value: {
      requestId: envelope.operationId,
      status: "saved",
      version: "c".repeat(64),
      backupId,
    },
    receipt: receipt(envelope, {
      evidence: [{ kind: "host-registry", id: op.workspaceId }],
      result: {
        kind: "file_saved",
        workspaceId: op.workspaceId,
        path: op.path,
        version: "c".repeat(64),
        digest,
        backupId,
      },
    }),
  };
}
function workspaceFileSavingHarness(saveHandler = workspaceFileSavedResponse) {
  return workspaceFileHarness((e) =>
    e.operation.type === "file.edit.read"
      ? { ok: true, value: workspaceFileObservation() }
      : e.operation.type === "file.save"
        ? saveHandler(e)
        : { ok: true, value: { status: "not_found" } },
  );
}
async function prepareWorkspaceFile(api, text = "\uFEFFnew\r\n") {
  assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
  api.actions.editWorkspaceFile(text);
  api.actions.validateWorkspaceFile();
  assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), true);
}
function changeWorkspaceFileScope(api, change) {
  if (change === "edit") {
    api.actions.editWorkspaceFile("different");
    api.actions.editWorkspaceFile("\uFEFFnew\r\n");
    api.actions.validateWorkspaceFile();
  }
  if (change === "discard") api.actions.discardWorkspaceFile();
  if (change === "fileABA") {
    api.actions.selectWorkspaceFile("other.txt");
    api.actions.selectWorkspaceFile("notes.txt");
  }
  if (change === "selectionABA") {
    api.actions.select("w", "b");
    api.actions.select("w", "a");
  }
  if (change === "floor") seed(api.store, snapshot(2));
  if (change === "rootABA") {
    seed(
      api.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), path: "/other" }] }),
    );
    seed(api.store);
  }
  if (change === "trust")
    seed(api.store, snapshot(1, "a", { workspaces: [workspace("w", 2)] }));
  if (change === "untrusted")
    seed(
      api.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), trusted: false }] }),
    );
  if (change === "epoch")
    api.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(api.store.getState()), bootstrap: true },
      value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
    });
  if (change === "hold")
    seed(
      api.store,
      snapshot(1, "a", {
        recovery: {
          store: { state: "recovery_required", reason: "owner_conflict" },
          resources: [],
        },
        state: "unavailable",
      }),
    );
  if (change === "resourceHold")
    seed(
      api.store,
      snapshot(1, "a", {
        recovery: {
          store: { state: "ready" },
          resources: [
            {
              workspaceId: "w",
              state: "unavailable",
              reason: "unresolved_operation",
            },
          ],
        },
      }),
    );
  if (change === "running")
    seed(
      api.store,
      snapshot(1, "a", {
        sessions: [session("a"), session("b", "w", { status: "running" })],
      }),
    );
  if (change === "permission")
    seed(
      api.store,
      snapshot(1, "a", {
        permissions: [
          {
            id: "p",
            workspaceId: "w",
            sessionId: "b",
            permission: "read",
            patterns: [],
          },
        ],
      }),
    );
  if (change === "disconnect")
    seed(api.store, snapshot(1, "a", { state: "unavailable" }));
  if (change === "cancel") api.actions.cancelWorkspaceFileRead();
  if (change === "dispose") api.dispose();
}
test("workspace file: save binds original outer identity and exact text; receipt advances floor without inventing baseline", async () => {
  for (const text of ["", "\uFEFFnew\r\n", "line\r\nnext\n"]) {
    const { api, calls } = workspaceFileSavingHarness();
    await prepareWorkspaceFile(api, text);
    assert.equal(await api.actions.saveWorkspaceFile(), true);
    const sent = calls.find((e) => e.operation.type === "file.save");
    assert.equal(sent.version, 2);
    assert.equal(sent.runtimeEpoch, "epoch-a");
    assert.equal(sent.operationId, sent.operation.requestId);
    assert.equal(sent.expectedRevision, 1);
    assert.equal(sent.operation.expectation, "version");
    assert.equal(sent.operation.version, "a".repeat(64));
    assert.equal(sent.operation.directoryVersion, "b".repeat(64));
    assert.equal(sent.operation.text, text);
    assert.equal(api.store.getState().revision, 2);
    assert.equal(selectors.workspaceFileDraft(api.store.getState()).text, text);
    assert.equal(
      selectors.workspaceFileDraft(api.store.getState()).baseline,
      "original",
    );
    assert.equal(
      selectors.workspaceFileDraft(api.store.getState()).observation,
      undefined,
    );
    assert.equal(
      selectors.workspaceFileSave(api.store.getState()).status,
      "saved",
    );
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
    api.dispose();
  }
});
test("workspace file: late reads are inert after every authority change", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "fileABA",
    "selectionABA",
    "floor",
    "rootABA",
    "trust",
    "untrusted",
    "epoch",
    "hold",
    "resourceHold",
    "running",
    "permission",
    "disconnect",
    "cancel",
    "dispose",
  ])
    await t.test(change, async () => {
      const pending = deferred(),
        { api } = workspaceFileHarness(() => pending.promise);
      const reading = api.actions.readWorkspaceFile("notes.txt");
      await flush();
      changeWorkspaceFileScope(api, change);
      pending.resolve({ ok: true, value: workspaceFileObservation() });
      assert.equal(await reading, false);
      assert.equal(
        selectors.workspaceFileDraft(api.store.getState()).observation,
        undefined,
      );
      assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
      api.dispose();
    });
});
test("workspace file: asynchronous hash rechecks draft and authority before admission", async (t) => {
  for (const change of [
    "edit",
    "discard",
    "fileABA",
    "selectionABA",
    "floor",
    "rootABA",
    "trust",
    "untrusted",
    "epoch",
    "hold",
    "resourceHold",
    "running",
    "permission",
    "disconnect",
    "dispose",
  ])
    await t.test(change, async () => {
      const { api, calls } = workspaceFileSavingHarness();
      await prepareWorkspaceFile(api);
      const saving = api.actions.saveWorkspaceFile();
      changeWorkspaceFileScope(api, change);
      assert.equal(await saving, false);
      assert.equal(
        calls.filter((e) => e.operation.type === "file.save").length,
        0,
      );
      api.dispose();
    });
});
test("workspace file: authority changed by admission subscriber prevents transport dispatch", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  await prepareWorkspaceFile(api);
  const unsubscribe = api.store.subscribe((next, prior) => {
    if (
      Object.keys(next.operations).length > Object.keys(prior.operations).length
    )
      api.actions.editWorkspaceFile("changed before actual dispatch");
  });
  assert.equal(await api.actions.saveWorkspaceFile(), false);
  assert.equal(calls.filter((e) => e.operation.type === "file.save").length, 0);
  unsubscribe();
  api.dispose();
});
test("workspace file: forged save DTO or receipt never confirms or raises floor", async (t) => {
  const changes = {
    request: (r) => (r.value.requestId = "wrong"),
    extra: (r) => (r.value.content = "smuggled"),
    version: (r) => (r.value.version = "bad"),
    missingBackup: (r) => {
      delete r.value.backupId;
      delete r.receipt.result.backupId;
    },
    wrongBackup: (r) => {
      r.value.backupId = `.omoc-configuration-${"f".repeat(64)}.file.backup`;
      r.receipt.result.backupId = r.value.backupId;
    },
    path: (r) => (r.receipt.result.path = "other.txt"),
    digest: (r) => (r.receipt.result.digest = "f".repeat(64)),
    workspace: (r) => (r.receipt.result.workspaceId = "other"),
    envelopeWorkspace: (r) => (r.receipt.workspaceId = "other"),
    session: (r) => (r.receipt.sessionId = "a"),
    type: (r) => (r.receipt.type = "configuration.save"),
    kind: (r) => (r.receipt.result.kind = "configuration_saved"),
    floor: (r) => (r.receipt.revision = 1),
    epoch: (r) => (r.receipt.runtimeEpoch = "epoch-b"),
    operation: (r) => (r.receipt.operationId = "other"),
    evidence: (r) => (r.receipt.evidence = []),
    admission: (r) => (r.receipt.admission = "admitted"),
    raw: (r) => (r.receipt.result.content = "smuggled"),
    unknownSuccess: (r) =>
      (r.value = { requestId: r.value.requestId, status: "unknown" }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { api } = workspaceFileSavingHarness((e) => {
        const response = workspaceFileSavedResponse(e);
        change(response);
        return response;
      });
      await prepareWorkspaceFile(api);
      assert.equal(await api.actions.saveWorkspaceFile(), false);
      assert.equal(
        selectors.workspaceFileSave(api.store.getState()).status,
        "unknown",
      );
      assert.equal(api.store.getState().revision, 1);
      api.dispose();
    });
});
test("workspace file: conflict keeps text and requires explicit fresh read; reread preserves newer draft", async () => {
  const { api } = workspaceFileSavingHarness((e) => ({
    ok: false,
    code: "FILE_CHANGED",
    receipt: receipt(e, {
      admission: "rejected",
      delivery: "pending",
      effect: "none",
      evidence: [],
      result: { kind: "rejected", code: "FILE_CHANGED" },
    }),
  }));
  await prepareWorkspaceFile(api);
  assert.equal(await api.actions.saveWorkspaceFile(), false);
  assert.equal(
    selectors.workspaceFileSave(api.store.getState()).status,
    "conflict",
  );
  assert.equal(
    selectors.workspaceFileDraft(api.store.getState()).text,
    "\uFEFFnew\r\n",
  );
  assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
  assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
  assert.equal(
    selectors.workspaceFileDraft(api.store.getState()).text,
    "\uFEFFnew\r\n",
  );
  api.actions.validateWorkspaceFile();
  assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), true);
  api.dispose();
});
test("workspace file: unknown looks up original key in current epoch; late ACK preserves newer text", async () => {
  const { api, calls, clock } = workspaceFileSavingHarness((e) => ({
    ok: true,
    value: { requestId: e.operationId, status: "unknown" },
  }));
  await prepareWorkspaceFile(api);
  assert.equal(await api.actions.saveWorkspaceFile(), false);
  await flush();
  const sent = calls.find((e) => e.operation.type === "file.save"),
    key = operationKey(sent.runtimeEpoch, sent.operationId);
  assert.deepEqual(api.store.getState().operations[key].operation, {
    type: "file.save",
    workspaceId: "w",
  });
  assert.equal(api.store.getState().operations[key].lookupOnly, true);
  assert.equal(resourceMutationDisabled(api.store.getState(), "w"), true);
  api.actions.editWorkspaceFile("newer");
  api.actions.validateWorkspaceFile();
  assert.equal(await api.actions.saveWorkspaceFile(), false);
  api.store.dispatch({
    type: "receipt",
    id: sent.operationId,
    receipt: workspaceFileSavedResponse(sent).receipt,
  });
  assert.equal(api.store.getState().operations[key].status, "unknown");
  api.store.dispatch({
    type: "snapshot",
    scope: { ...scopeOf(api.store.getState()), bootstrap: true },
    value: snapshot(1, "a", {
      runtimeEpoch: "epoch-b",
      retainedOperations: [
        {
          authorityHold: true,
          runtimeEpoch: "epoch-a",
          operationId: sent.operationId,
          type: "file.save",
          workspaceId: "w",
        },
      ],
    }),
  });
  await clock.advance(5000);
  const lookup = calls
    .filter((e) => e.operation.type === "operation.lookup")
    .at(-1);
  assert.equal(lookup.runtimeEpoch, "epoch-b");
  assert.equal(lookup.operation.runtimeEpoch, "epoch-a");
  assert.equal(lookup.operation.operationId, sent.operationId);
  api.store.dispatch({
    type: "receipt",
    id: key,
    receipt: workspaceFileSavedResponse(sent).receipt,
  });
  assert.equal(api.store.getState().operations[key].status, "accepted");
  const oldDraft = Object.values(api.store.getState().workspaceFileDrafts)[0];
  assert.equal(oldDraft.text, "newer");
  assert.equal(oldDraft.save.current, false);
  assert.equal(selectors.workspaceFileDraft(api.store.getState()).text, "");
  assert.equal(calls.filter((e) => e.operation.type === "file.save").length, 1);
  api.dispose();
});
test("workspace file: dispatched ACK records original draft without replacing newer edits or selected file", async () => {
  for (const change of [
    "edit",
    "fileABA",
    "selectionABA",
    "rootABA",
    "trust",
    "epoch",
    "floor",
  ]) {
    const pending = deferred(),
      entered = deferred();
    const { api } = workspaceFileSavingHarness((e) => {
      entered.resolve(e);
      return pending.promise;
    });
    await prepareWorkspaceFile(api);
    const saving = api.actions.saveWorkspaceFile(),
      sent = await entered.promise;
    if (change === "edit") api.actions.editWorkspaceFile("newer");
    else changeWorkspaceFileScope(api, change);
    pending.resolve(workspaceFileSavedResponse(sent));
    assert.equal(await saving, true);
    const original = Object.values(api.store.getState().workspaceFileDrafts)[0];
    assert.equal(original.text, change === "edit" ? "newer" : "\uFEFFnew\r\n");
    assert.equal(original.observation, undefined);
    assert.equal(original.save.current, change !== "edit");
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
    api.dispose();
  }
});
test("workspace file: held and untrusted drafts stay editable and selectable with zero IO", async () => {
  for (const change of ["hold", "resourceHold", "untrusted"]) {
    const { api, calls } = workspaceFileSavingHarness();
    await prepareWorkspaceFile(api);
    changeWorkspaceFileScope(api, change);
    const count = calls.length;
    api.actions.editWorkspaceFile("held draft");
    api.actions.selectWorkspaceFile("other.txt");
    api.actions.selectWorkspaceFile("notes.txt");
    assert.equal(
      selectors.workspaceFileDraft(api.store.getState()).text,
      "held draft",
    );
    assert.equal(await api.actions.readWorkspaceFile("notes.txt"), false);
    assert.equal(await api.actions.saveWorkspaceFile(), false);
    assert.equal(calls.length, count);
    api.dispose();
  }
});
test("workspace file: closed baseline rejects mismatched scope, future clocks and extra fields", async (t) => {
  const values = [
    { runtimeEpoch: "other" },
    { revision: 0 },
    { revision: 2 },
    { workspaceId: "other" },
    { workspacePath: "/other", targetPath: "/other/notes.txt" },
    { path: "other.txt", targetPath: "/fixture/other.txt" },
    { targetPath: "/fake/notes.txt" },
    { version: "bad" },
    { directoryVersion: "bad" },
    { extra: true },
    { content: "x".repeat(65537) },
    { content: "\u0000" },
    { content: "\uD800" },
  ];
  for (const [index, change] of values.entries())
    await t.test(String(index), async () => {
      const { api } = workspaceFileHarness(() => ({
        ok: true,
        value: workspaceFileObservation("original", change),
      }));
      assert.equal(await api.actions.readWorkspaceFile("notes.txt"), false);
      assert.equal(
        selectors.workspaceFileDraft(api.store.getState()).observation,
        undefined,
      );
      api.dispose();
    });
});
test("workspace file: protected paths explain refusal and invalid text remains correctable", async () => {
  const { api } = workspaceFileHarness((e) => ({
    ok: true,
    value: {
      runtimeEpoch: "epoch-a",
      revision: 1,
      workspaceId: "w",
      workspacePath: "/fixture",
      path: e.operation.path,
      targetPath: `/fixture/${e.operation.path}`,
      status: "unsupported",
      reason: "protected_source",
    },
  }));
  assert.equal(await api.actions.readWorkspaceFile("AGENTS.md"), false);
  assert.equal(
    selectors.workspaceFileDraft(api.store.getState()).read.reason,
    "protected_source",
  );
  api.actions.editWorkspaceFile("\u0000");
  api.actions.validateWorkspaceFile();
  assert.equal(
    selectors.workspaceFileDraft(api.store.getState()).validation.status,
    "invalid",
  );
  assert.equal(await api.actions.saveWorkspaceFile(), false);
  api.actions.editWorkspaceFile("x".repeat(65537));
  api.actions.validateWorkspaceFile();
  assert.deepEqual(
    selectors.workspaceFileDraft(api.store.getState()).validation.issues,
    ["too_large"],
  );
  api.dispose();
});
test("workspace file: restored identity is metadata only and never fabricates a path or body", () => {
  const store = createWorkbenchStore();
  seed(
    store,
    snapshot(1, "a", {
      retainedOperations: [
        {
          authorityHold: true,
          runtimeEpoch: "old",
          operationId: "original",
          type: "file.save",
          workspaceId: "w",
        },
      ],
    }),
  );
  const intent = store.getState().operations[operationKey("old", "original")];
  assert.equal(intent.lookupOnly, true);
  assert.deepEqual(intent.operation, { type: "file.save", workspaceId: "w" });
  assert.deepEqual(store.getState().workspaceFileDrafts, {});
  assert.equal(intent.workspaceFileSave, undefined);
});

test("workspace file: independent workspace baseline remains readable during another workspace save", async () => {
  const pending = deferred(),
    entered = deferred();
  const { api, calls } = workspaceFileHarness((e) => {
    if (e.operation.type === "file.save") {
      entered.resolve();
      return pending.promise;
    }
    if (e.operation.type === "file.edit.read")
      return {
        ok: true,
        value: workspaceFileObservation(
          "original",
          e.operation.workspaceId === "other"
            ? {
                workspaceId: "other",
                workspacePath: "/other",
                targetPath: "/other/notes.txt",
              }
            : {},
        ),
      };
    return { ok: true, value: { status: "not_found" } };
  });
  await prepareWorkspaceFile(api);
  const saving = api.actions.saveWorkspaceFile();
  await entered.promise;
  api.actions.select("other", "other-a");
  seed(
    api.store,
    snapshot(1, "other-a", {
      selectedWorkspaceId: "other",
      workspaces: [workspace(), { ...workspace("other"), path: "/other" }],
      sessions: [session("a"), session("other-a", "other")],
    }),
  );
  assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
  assert.equal(calls.filter((e) => e.operation.type === "file.save").length, 1);
  pending.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
  await saving;
  api.dispose();
});
test("workspace file: original epoch draft can be selected and edited after replacement with no revived authority", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  await prepareWorkspaceFile(api);
  const key = Object.keys(api.store.getState().workspaceFileDrafts)[0];
  changeWorkspaceFileScope(api, "epoch");
  api.actions.selectWorkspaceFileDraft(key);
  api.actions.editWorkspaceFile("retained original draft");
  assert.equal(
    selectors.workspaceFileDraft(api.store.getState()).text,
    "retained original draft",
  );
  assert.equal(
    selectors.workspaceFileTargetPath(api.store.getState()),
    "/fixture/notes.txt",
  );
  assert.equal(selectors.canReadWorkspaceFile(api.store.getState()), false);
  assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
  assert.equal(
    calls.filter((e) => e.operation.type === "file.edit.read").length,
    1,
  );
  api.dispose();
});
test("workspace file: real suspended SHA cannot dispatch after draft validation ABA", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  await prepareWorkspaceFile(api);
  const original = globalThis.crypto.subtle.digest,
    gate = deferred(),
    entered = deferred();
  globalThis.crypto.subtle.digest = async function (...args) {
    entered.resolve();
    await gate.promise;
    return original.apply(this, args);
  };
  try {
    const saving = api.actions.saveWorkspaceFile();
    await entered.promise;
    api.actions.editWorkspaceFile("different");
    api.actions.editWorkspaceFile("\uFEFFnew\r\n");
    api.actions.validateWorkspaceFile();
    gate.resolve();
    assert.equal(await saving, false);
    assert.equal(
      calls.filter((e) => e.operation.type === "file.save").length,
      0,
    );
  } finally {
    gate.resolve();
    globalThis.crypto.subtle.digest = original;
    api.dispose();
  }
});
test("workspace file: startup selection preview polling refocus and resizing never read or save editor automatically", async () => {
  const h = fileHarness();
  try {
    await flush();
    h.api.actions.openFiles("a.txt", "file");
    await flush();
    h.api.actions.editWorkspaceFile("preview draft");
    h.api.actions.validateWorkspaceFile();
    assert.equal(await h.api.actions.saveWorkspaceFile(), false);
    h.api.actions.layout({ wide: false });
    h.api.actions.layout({ wide: true });
    h.api.actions.refresh();
    h.api.actions.select("w", "b");
    await flush();
    await h.clock.advance(15000);
    assert.equal(
      h.h.calls.filter((e) =>
        ["file.edit.read", "file.save"].includes(e.operation.type),
      ).length,
      0,
    );
    assert.ok(h.h.calls.some((e) => e.operation.type === "file.read"));
  } finally {
    h.api.dispose();
  }
});

test("workspace file: production host admission digest includes exact expectedRevision in correlated receipt", async () => {
  let originalDigest, actualEnvelope;
  // In-memory registry stub isolates production admission hashing and receipt
  // redaction. This does not execute storage/publication or Native services.
  const registry = {
    status: () => ({ state: "ready" }),
    begin: async (identity) => {
      originalDigest = identity.digest;
      return {
        status: "admitted",
        receipt: {
          admission: "admitted",
          delivery: "pending",
          effect: "none",
          revision: 1,
          evidence: [],
        },
      };
    },
  };
  const host = createHostAdmission({
    runtimeEpoch: "epoch-a",
    revision: () => 1,
    ready: () => Promise.resolve(),
    registry: () => registry,
    execute: async (operation) => {
      if (operation.type === "file.edit.read")
        return { ok: true, value: workspaceFileObservation() };
      assert.equal(operation.type, "file.save");
      currentScope().markEffect();
      return {
        ok: true,
        value: {
          requestId: operation.requestId,
          status: "saved",
          version: "c".repeat(64),
          backupId: fileBackupId("epoch-a", operation.requestId),
        },
      };
    },
    projectReceipt: async (record, operation, result) => {
      Object.assign(record, {
        admission: "dispatched",
        delivery: "accepted",
        effect: "confirmed",
        revision: 2,
        evidence: [{ kind: "host-registry", id: "w" }],
        result: {
          kind: "file_saved",
          workspaceId: "w",
          path: operation.path,
          version: result.value.version,
          digest: record.digest,
          backupId: result.value.backupId,
        },
      });
    },
  });
  const clock = fakeClock(),
    api = createWindowWorkbench(
      {
        workbench: (envelope) => {
          if (envelope.operation.type === "file.save")
            actualEnvelope = envelope;
          return host.handle(envelope, "renderer-test");
        },
        cancelRead: (envelope) =>
          Promise.resolve(host.cancel(envelope, "renderer-test")),
      },
      { clock, id },
    );
  seed(api.store);
  try {
    await prepareWorkspaceFile(api);
    assert.equal(await api.actions.saveWorkspaceFile(), true);
    assert.equal(actualEnvelope.expectedRevision, 1);
    assert.equal(
      selectors.workspaceFileSave(api.store.getState()).identity.digest,
      originalDigest,
    );
    assert.equal(
      selectors.workspaceFileSave(api.store.getState()).status,
      "saved",
    );
    assert.equal(api.store.getState().revision, 2);
  } finally {
    api.dispose();
    await host.drain();
    host.close();
  }
});

test("workspace file: cancellation before queued read dispatch performs no editor IO", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  const reading = api.actions.readWorkspaceFile("notes.txt");
  api.actions.cancelWorkspaceFileRead();
  assert.equal(await reading, false);
  await flush();
  assert.equal(
    calls.filter((e) => e.operation.type === "file.edit.read").length,
    0,
  );
  api.dispose();
});
test("workspace file: IO admission subscriber authority loss prevents actual save dispatch", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  await prepareWorkspaceFile(api);
  const unsubscribe = api.store.subscribe((next, prior) => {
    if (next.configurationIO.saves > prior.configurationIO.saves)
      changeWorkspaceFileScope(api, "trust");
  });
  assert.equal(await api.actions.saveWorkspaceFile(), false);
  assert.equal(calls.filter((e) => e.operation.type === "file.save").length, 0);
  unsubscribe();
  api.dispose();
});

test("workspace file: lookup receipt cannot release matching actual IO hold before original save settles", async () => {
  const pending = deferred(),
    entered = deferred();
  let sent;
  const { api, clock } = workspaceFileHarness((e) => {
    if (e.operation.type === "file.edit.read")
      return {
        ok: true,
        value: workspaceFileObservation("original", {
          revision: api.store.getState().revision,
        }),
      };
    if (e.operation.type === "file.save") {
      sent = e;
      entered.resolve();
      return pending.promise;
    }
    if (e.operation.type === "operation.lookup")
      return {
        ok: true,
        value: {
          status: "found",
          runtimeEpoch: sent.runtimeEpoch,
          operationId: sent.operationId,
          receipt: workspaceFileSavedResponse(sent).receipt,
        },
      };
    return { ok: false, code: "UNAVAILABLE" };
  });
  await prepareWorkspaceFile(api);
  const saving = api.actions.saveWorkspaceFile();
  await entered.promise;
  await clock.advance(10000);
  assert.equal(await saving, false);
  await flush();
  assert.equal(
    api.store.getState().operations[
      operationKey(sent.runtimeEpoch, sent.operationId)
    ].status,
    "accepted",
  );
  seed(api.store, snapshot(2));
  assert.equal(api.store.getState().configurationIO.saves, 1);
  assert.equal(selectors.canReadWorkspaceFile(api.store.getState()), false);
  assert.equal(await api.actions.readWorkspaceFile("notes.txt"), false);
  pending.resolve(workspaceFileSavedResponse(sent));
  await flush();
  assert.equal(api.store.getState().configurationIO.saves, 0);
  assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
  api.dispose();
});

test("workspace file: restored lookup must verify deterministic original-key backup before confirming", async () => {
  for (const wrongBackup of [true, false]) {
    const original = {
      runtimeEpoch: "old",
      operationId: "original",
      operation: {
        type: "file.save",
        workspaceId: "w",
        path: "notes.txt",
        requestId: "original",
        expectation: "version",
        version: "a".repeat(64),
        directoryVersion: "b".repeat(64),
        text: "original",
      },
    };
    const response = workspaceFileSavedResponse(original);
    if (wrongBackup)
      response.receipt.result.backupId = `.omoc-configuration-${"f".repeat(64)}.file.backup`;
    const clock = fakeClock(),
      h = bridgeHarness((e) =>
        e.operation.type === "operation.lookup"
          ? {
              ok: true,
              value: {
                status: "found",
                runtimeEpoch: "old",
                operationId: "original",
                receipt: response.receipt,
              },
            }
          : {
              ok: true,
              value: snapshot(1, "a", {
                retainedOperations: [
                  {
                    authorityHold: true,
                    runtimeEpoch: "old",
                    operationId: "original",
                    type: "file.save",
                    workspaceId: "w",
                  },
                ],
              }),
            },
      );
    const api = createWindowWorkbench(h.bridge, { clock, id });
    seed(
      api.store,
      snapshot(1, "a", {
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "old",
            operationId: "original",
            type: "file.save",
            workspaceId: "w",
          },
        ],
      }),
    );
    api.start();
    await flush();
    // Backup derivation is asynchronous; allow actual WebCrypto to settle.
    for (let n = 0; n < 12; n++)
      await new Promise((resolve) => setImmediate(resolve));
    assert.equal(
      api.store.getState().operations[operationKey("old", "original")].status,
      wrongBackup ? "unknown" : "accepted",
    );
    assert.deepEqual(api.store.getState().workspaceFileDrafts, {});
    api.dispose();
  }
});

test("workspace file: preview remount during responsive layout preserves explicit editor baseline without new IO", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  try {
    await prepareWorkspaceFile(api);
    const observation = selectors.workspaceFileDraft(
      api.store.getState(),
    ).observation;
    const editorReads = () =>
      calls.filter((e) => e.operation.type === "file.edit.read").length;
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), true);
    const reads = editorReads();
    api.actions.closeFiles();
    api.actions.openFiles();
    await flush();
    assert.equal(
      selectors.workspaceFileDraft(api.store.getState()).observation,
      observation,
    );
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), true);
    assert.equal(editorReads(), reads);
    api.actions.openFiles("another.txt", "file");
    await flush();
    assert.equal(selectors.canSaveWorkspaceFile(api.store.getState()), false);
    assert.equal(editorReads(), reads);
  } finally {
    api.dispose();
  }
});

const gitReviewValue = (extra = {}) => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  workspacePath: "/fixture",
  status: "available",
  observationId: "a".repeat(64),
  repository: {
    worktreePath: "/fixture",
    gitDirectory: "/fixture/.git",
    commonDirectory: "/fixture/.git",
    objectFormat: "sha1",
    head: "1".repeat(40),
    branch: "main",
  },
  branches: [
    { name: "main", oid: "1".repeat(40) },
    { name: "base", oid: "2".repeat(40) },
  ],
  files: [
    { path: "a.txt", index: "modified", worktree: "modified", kind: "tracked" },
    { path: "new.txt", index: "none", worktree: "none", kind: "untracked" },
  ],
  ...extra,
});
const gitDiffValue = (operation, extra = {}) => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  workspacePath: "/fixture",
  observationId: operation.observationId,
  path: operation.path,
  mode: operation.mode,
  ...(operation.mode === "base"
    ? { baseRef: operation.baseRef, baseOid: "2".repeat(40) }
    : {}),
  status: "available",
  patch: "--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
  sourceDigest: "b".repeat(64),
  ...extra,
});
function gitWindow(
  handler = (e) => ({
    ok: true,
    value:
      e.operation.type === "git.review.read"
        ? gitReviewValue()
        : gitDiffValue(e.operation),
  }),
) {
  const clock = fakeClock(),
    h = bridgeHarness(handler),
    app = createWindowWorkbench(h.bridge, { clock, id });
  seed(app.store);
  return { app, clock, ...h };
}

test("Git review: explicit status and detail only, separate modes and original base OID", async () => {
  const { app, calls } = gitWindow();
  assert.equal(calls.length, 0);
  assert.equal(app.store.getState().gitReview.baseRef, "");
  assert.equal(await app.actions.observeGitReview(), true);
  app.actions.selectGitPath("a.txt");
  assert.equal(calls.length, 1, "selection performs no IO");
  assert.equal(await app.actions.readGitDiff(), true);
  assert.equal(app.store.getState().gitReview.detail.mode, "unstaged");
  app.actions.selectGitMode("base");
  assert.equal(await app.actions.readGitDiff(), false, "base must be explicit");
  app.actions.selectGitBase("base");
  assert.equal(await app.actions.readGitDiff(), true);
  assert.equal(app.store.getState().gitReview.detail.baseOid, "2".repeat(40));
  assert.equal(calls.length, 3);
  app.dispose();
});

test("Git review: untrusted registered root and Native running permit inert reads; preview remount keeps Git identity", async () => {
  const { app } = gitWindow();
  seed(
    app.store,
    snapshot(1, "a", {
      workspaces: [{ ...workspace(), trusted: false }],
      sessions: [session("a", "w", { status: "running" })],
    }),
  );
  assert.equal(await app.actions.observeGitReview(), true);
  const identity = app.store.getState().gitReview.observationIdentity;
  app.store.dispatch({ type: "files.open", path: "a.txt", kind: "file" });
  app.store.dispatch({ type: "files.close" });
  app.actions.layout({ wide: false });
  assert.equal(app.store.getState().gitReview.observationIdentity, identity);
  assert.equal(
    selectors.currentGitReviewObservation(app.store.getState()).observationId,
    "a".repeat(64),
  );
  app.dispose();
});

test("Git review: selected path ABA and status refresh retire late detail", async () => {
  const late = deferred();
  const { app, cancellations } = gitWindow((e) =>
    e.operation.type === "git.diff.read"
      ? late.promise
      : { ok: true, value: gitReviewValue() },
  );
  await app.actions.observeGitReview();
  app.actions.selectGitPath("a.txt");
  const pending = app.actions.readGitDiff();
  await flush();
  const operation = {
    observationId: "a".repeat(64),
    mode: "unstaged",
    path: "a.txt",
  };
  app.actions.selectGitPath("new.txt");
  app.actions.selectGitPath("a.txt");
  late.resolve({ ok: true, value: gitDiffValue(operation) });
  assert.equal(await pending, false);
  assert.equal(app.store.getState().gitReview.detail, undefined);
  assert.equal(cancellations.length, 1);
  await app.actions.observeGitReview();
  assert.equal(app.store.getState().gitReview.detail, undefined);
  app.dispose();
});

function changeGitAuthority(app, change) {
  if (change === "root")
    seed(
      app.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), path: "/other" }] }),
    );
  if (change === "trustRevision")
    seed(app.store, snapshot(1, "a", { workspaces: [workspace("w", 2)] }));
  if (change === "trustedBool")
    seed(
      app.store,
      snapshot(1, "a", { workspaces: [{ ...workspace(), trusted: false }] }),
    );
  if (change === "floor") seed(app.store, snapshot(2));
  if (change === "workspace") app.actions.select("other");
  if (change === "epoch")
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
    });
  if (change === "globalHold")
    seed(
      app.store,
      snapshot(1, "a", {
        state: "unavailable",
        recovery: {
          store: { state: "recovery_required", reason: "owner_conflict" },
          resources: [],
        },
      }),
    );
  if (change === "resourceHold")
    seed(
      app.store,
      snapshot(1, "a", {
        recovery: {
          store: { state: "ready" },
          resources: [
            {
              workspaceId: "w",
              state: "unavailable",
              reason: "unresolved_operation",
            },
          ],
        },
      }),
    );
  if (change === "mutation")
    app.store.dispatch({
      type: "intent",
      intent: {
        id: "git-hold",
        epoch: "epoch-a",
        operation: {
          type: "session.pin",
          workspaceId: "other",
          sessionId: "foreign",
          requestId: "git-hold",
          pinned: true,
        },
        origin: app.store.getState().selection,
        key: selectionKey("w", "a"),
        navigate: false,
        status: "pending",
      },
    });
  if (change === "saveIO")
    app.store.dispatch({ type: "configuration.io", lane: "saves", delta: 1 });
  if (change === "disconnect")
    app.store.dispatch({
      type: "health",
      scope: scopeOf(app.store.getState()),
      code: "UNAVAILABLE",
    });
}

test("Git review: scope clock/root/trust/epoch/hold changes reject late status, including ABA", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "workspace",
    "epoch",
    "globalHold",
    "resourceHold",
    "mutation",
    "saveIO",
    "disconnect",
  ]) {
    await t.test(change, async () => {
      const pending = deferred(),
        { app, calls, cancellations } = gitWindow(() => pending.promise);
      const read = app.actions.observeGitReview();
      await flush();
      changeGitAuthority(app, change);
      // Return to the original bytes/floor where allowed. Retired own generation must not revive.
      if (
        [
          "root",
          "trustedBool",
          "disconnect",
          "globalHold",
          "resourceHold",
        ].includes(change)
      )
        seed(app.store);
      if (change === "saveIO")
        app.store.dispatch({
          type: "configuration.io",
          lane: "saves",
          delta: -1,
        });
      pending.resolve({ ok: true, value: gitReviewValue() });
      assert.equal(await read, false);
      assert.equal(
        selectors.currentGitReviewObservation(app.store.getState()),
        undefined,
      );
      assert.equal(calls.length, 1, "scope changes do not request Git");
      assert.equal(cancellations.length, 1);
      app.dispose();
    });
  }
});

test("Git review: invalidation retains last status and plaintext detail with no revived IO authority", async (t) => {
  for (const change of [
    "root",
    "trustedBool",
    "trustRevision",
    "floor",
    "epoch",
    "globalHold",
    "resourceHold",
    "mutation",
    "disconnect",
  ]) {
    await t.test(change, async () => {
      const { app, calls } = gitWindow();
      await app.actions.observeGitReview();
      app.actions.selectGitPath("a.txt");
      await app.actions.readGitDiff();
      const prior = app.store.getState().gitReview;
      changeGitAuthority(app, change);
      assert.equal(
        app.store.getState().gitReview.observation,
        prior.observation,
      );
      assert.equal(app.store.getState().gitReview.detail, prior.detail);
      assert.equal(
        selectors.currentGitReviewObservation(app.store.getState()),
        undefined,
      );
      assert.equal(
        selectors.currentGitDiffObservation(app.store.getState()),
        undefined,
      );
      assert.equal(await app.actions.readGitDiff(), false);
      assert.equal(calls.length, 2);
      app.dispose();
    });
  }
});

test("Git review: global/matching recovery and app mutation hold block IO; other recovery and Native running do not", async (t) => {
  for (const change of ["globalHold", "resourceHold", "mutation", "saveIO"]) {
    await t.test(change, async () => {
      const { app, calls } = gitWindow();
      changeGitAuthority(app, change);
      app.actions.selectWorkspaceFile("a.txt");
      app.actions.editWorkspaceFile("draft under hold");
      assert.equal(
        selectors.workspaceFileDraft(app.store.getState()).text,
        "draft under hold",
      );
      assert.equal(await app.actions.observeGitReview(), false);
      assert.equal(await app.actions.readGitDiff(), false);
      assert.equal(calls.length, 0);
      app.dispose();
    });
  }
  const { app } = gitWindow();
  seed(
    app.store,
    snapshot(1, "a", {
      recovery: {
        store: { state: "ready" },
        resources: [
          {
            workspaceId: "other",
            state: "unavailable",
            reason: "unresolved_operation",
          },
        ],
      },
      sessions: [session("a", "w", { status: "running" })],
    }),
  );
  assert.equal(await app.actions.observeGitReview(), true);
  app.dispose();
});

test("Git review: READ_BUSY readiness is 400ms and retries require an explicit action", async () => {
  let reviewCount = 0,
    diffCount = 0;
  const { app, calls, clock } = gitWindow((e) => {
    const n =
      e.operation.type === "git.review.read" ? ++reviewCount : ++diffCount;
    return n === 1
      ? { ok: false, code: "READ_BUSY", message: "busy" }
      : {
          ok: true,
          value:
            e.operation.type === "git.review.read"
              ? gitReviewValue()
              : gitDiffValue(e.operation),
        };
  });
  assert.equal(await app.actions.observeGitReview(), false);
  assert.equal(selectors.canObserveGitReview(app.store.getState()), false);
  await clock.advance(399);
  assert.equal(await app.actions.observeGitReview(), false);
  assert.equal(calls.length, 1);
  await clock.advance(1);
  assert.equal(selectors.canObserveGitReview(app.store.getState()), true);
  assert.equal(calls.length, 1, "timer only releases retry readiness");
  await app.actions.observeGitReview();
  app.actions.selectGitPath("a.txt");
  assert.equal(await app.actions.readGitDiff(), false);
  assert.equal(selectors.canReadGitDiff(app.store.getState()), false);
  await clock.advance(400);
  assert.equal(calls.length, 3);
  assert.equal(await app.actions.readGitDiff(), true);
  assert.equal(calls.length, 4);
  app.dispose();
});

test("Git review: closed status validator rejects clock, shape, accessor, counts and aggregate overflow", async (t) => {
  for (const shape of [
    "root",
    "epoch",
    "workspace",
    "floor",
    "extra",
    "truncated",
    "sparse",
    "getter",
    "duplicate",
    "rows",
    "aggregate",
    "branchOID",
  ]) {
    await t.test(shape, async () => {
      const value = gitReviewValue();
      let getters = 0;
      if (shape === "root") {
        value.workspacePath = "/other";
        value.repository.worktreePath = "/other";
      }
      if (shape === "epoch") value.runtimeEpoch = "epoch-b";
      if (shape === "workspace") value.workspaceId = "other";
      if (shape === "floor") value.revision = 0;
      if (shape === "extra") value.secret = "untrusted";
      if (shape === "truncated") value.truncated = true;
      if (shape === "sparse") value.files = new Array(1);
      if (shape === "getter")
        Object.defineProperty(value.files[0], "path", {
          get() {
            getters++;
            return "a.txt";
          },
        });
      if (shape === "duplicate") value.files.push(value.files[0]);
      if (shape === "rows")
        value.files = Array.from({ length: 513 }, (_, n) => ({
          ...value.files[0],
          path: `${n}.txt`,
        }));
      if (shape === "aggregate")
        value.files = Array.from({ length: 512 }, (_, n) => ({
          ...value.files[0],
          path: `${n}/${"x".repeat(240)}/${"x".repeat(240)}`,
        }));
      if (shape === "branchOID") value.branches[0].oid = "3".repeat(40);
      const { app } = gitWindow(() => ({ ok: true, value }));
      assert.equal(await app.actions.observeGitReview(), false);
      assert.equal(getters, 0);
      assert.equal(
        selectors.currentGitReviewObservation(app.store.getState()),
        undefined,
      );
      assert.ok(
        ["STALE", "GIT_UNVERIFIED"].includes(
          app.store.getState().gitReview.error,
        ),
      );
      app.dispose();
    });
  }
});

test("Git review: detail identity and exact original base OID reject mismatches and unsafe patches", async (t) => {
  for (const shape of [
    "id",
    "path",
    "mode",
    "baseRef",
    "baseOID",
    "epoch",
    "root",
    "floor",
    "extra",
    "ansi",
    "bytes",
    "lines",
    "hunks",
  ]) {
    await t.test(shape, async () => {
      const { app } = gitWindow((e) => {
        if (e.operation.type === "git.review.read")
          return { ok: true, value: gitReviewValue() };
        const value = gitDiffValue(e.operation);
        if (shape === "id") value.observationId = "c".repeat(64);
        if (shape === "path") value.path = "other.txt";
        if (shape === "mode") {
          value.mode = "staged";
          delete value.baseOid;
          delete value.baseRef;
        }
        if (shape === "baseRef") value.baseRef = "main";
        if (shape === "baseOID") value.baseOid = "4".repeat(40);
        if (shape === "epoch") value.runtimeEpoch = "epoch-b";
        if (shape === "root") value.workspacePath = "/other";
        if (shape === "floor") value.revision = 0;
        if (shape === "extra") value.html = "<script>bad</script>";
        if (shape === "ansi") value.patch = "\u001b[31mred";
        if (shape === "bytes") value.patch = "x".repeat(65537);
        if (shape === "lines") value.patch = "x\n".repeat(2049);
        if (shape === "hunks") value.patch = "@@ -1 +1 @@\n".repeat(129);
        return { ok: true, value };
      });
      await app.actions.observeGitReview();
      app.actions.selectGitPath("a.txt");
      app.actions.selectGitMode("base");
      app.actions.selectGitBase("base");
      assert.equal(await app.actions.readGitDiff(), false);
      assert.equal(
        selectors.currentGitDiffObservation(app.store.getState()),
        undefined,
      );
      app.dispose();
    });
  }
});

test("Git review: mode/base ABA, status refresh and own generation retire active details", async (t) => {
  for (const change of ["modeABA", "baseABA", "refresh", "cancel"]) {
    await t.test(change, async () => {
      const pending = deferred();
      const { app, calls, cancellations } = gitWindow((e) =>
        e.operation.type === "git.diff.read"
          ? pending.promise
          : { ok: true, value: gitReviewValue() },
      );
      await app.actions.observeGitReview();
      app.actions.selectGitPath("a.txt");
      app.actions.selectGitMode("base");
      app.actions.selectGitBase("base");
      const read = app.actions.readGitDiff();
      await flush();
      const op = calls.at(-1).operation;
      if (change === "modeABA") {
        app.actions.selectGitMode("unstaged");
        app.actions.selectGitMode("base");
      }
      if (change === "baseABA") {
        app.actions.selectGitBase("main");
        app.actions.selectGitBase("base");
      }
      if (change === "refresh") {
        // Cancels detail immediately; bridge lane remains occupied until physical settlement.
        await app.actions.observeGitReview();
        assert.equal(app.store.getState().gitReview.detailIdentity, undefined);
      }
      if (change === "cancel") app.actions.cancelGitDiff();
      pending.resolve({ ok: true, value: gitDiffValue(op) });
      assert.equal(await read, false);
      assert.equal(
        selectors.currentGitDiffObservation(app.store.getState()),
        undefined,
      );
      assert.equal(cancellations.length, 1);
      app.dispose();
    });
  }
});

test("Git review: explicit refresh immediately retires completed detail and old observation authority", async () => {
  let count = 0;
  const pending = deferred();
  const { app } = gitWindow((e) =>
    e.operation.type === "git.review.read" && ++count === 2
      ? pending.promise
      : {
          ok: true,
          value:
            e.operation.type === "git.review.read"
              ? gitReviewValue()
              : gitDiffValue(e.operation),
        },
  );
  await app.actions.observeGitReview();
  app.actions.selectGitPath("a.txt");
  await app.actions.readGitDiff();
  const prior = app.store.getState().gitReview;
  const refresh = app.actions.observeGitReview();
  assert.equal(app.store.getState().gitReview.observation, prior.observation);
  assert.equal(app.store.getState().gitReview.detail, prior.detail);
  assert.equal(
    selectors.currentGitReviewObservation(app.store.getState()),
    undefined,
  );
  assert.equal(
    selectors.currentGitDiffObservation(app.store.getState()),
    undefined,
  );
  assert.equal(await app.actions.readGitDiff(), false);
  pending.resolve({
    ok: true,
    value: gitReviewValue({ observationId: "c".repeat(64) }),
  });
  assert.equal(await refresh, true);
  assert.equal(app.store.getState().gitReview.baseRef, "");
  assert.equal(app.store.getState().gitReview.path, "");
  app.dispose();
});

test("Git review: unavailable details retain exact semantics, including untracked staged refusal and expired original OID", async (t) => {
  for (const [mode, path, reason] of [
    ["staged", "new.txt", "not_staged"],
    ["base", "new.txt", "expired_observation"],
    ["unstaged", "a.txt", "protected_source"],
    ["unstaged", "a.txt", "binary"],
    ["unstaged", "a.txt", "conflict"],
  ]) {
    await t.test(reason, async () => {
      const { app } = gitWindow((e) => {
        if (e.operation.type === "git.review.read")
          return { ok: true, value: gitReviewValue() };
        const value = gitDiffValue(e.operation, {
          status: "unavailable",
          reason,
        });
        delete value.patch;
        delete value.sourceDigest;
        return { ok: true, value };
      });
      await app.actions.observeGitReview();
      app.actions.selectGitMode(mode);
      app.actions.selectGitPath(path);
      if (mode === "base") app.actions.selectGitBase("base");
      assert.equal(await app.actions.readGitDiff(), true);
      const value = app.store.getState().gitReview.detail;
      assert.equal(value.status, "unavailable");
      assert.equal(value.reason, reason);
      assert.equal("patch" in value, false);
      if (mode === "base") assert.equal(value.baseOid, "2".repeat(40));
      app.dispose();
    });
  }
});

test("Git review: accepted evidence is detached from caller objects and empty patch is a valid comparison", async () => {
  const original = gitReviewValue();
  const { app } = gitWindow((e) => ({
    ok: true,
    value:
      e.operation.type === "git.review.read"
        ? original
        : gitDiffValue(e.operation, { patch: "" }),
  }));
  await app.actions.observeGitReview();
  original.files[0].path = "replacement.txt";
  original.branches[1].oid = "9".repeat(40);
  assert.equal(
    app.store.getState().gitReview.observation.files[0].path,
    "a.txt",
  );
  app.actions.selectGitPath("new.txt");
  app.actions.selectGitMode("base");
  app.actions.selectGitBase("base");
  assert.equal(await app.actions.readGitDiff(), true);
  assert.equal(
    selectors.currentGitDiffObservation(app.store.getState()).patch,
    "",
  );
  app.dispose();
});

test("Git review: queued reentrant invalidation prevents bridge IO", async (t) => {
  for (const detail of [false, true]) {
    await t.test(detail ? "detail" : "status", async () => {
      const { app, calls } = gitWindow();
      if (detail) {
        await app.actions.observeGitReview();
        app.actions.selectGitPath("a.txt");
      }
      const count = calls.length;
      const unsubscribe = app.store.subscribe((next) => {
        if (detail ? next.gitReview.detailRequest : next.gitReview.request)
          changeGitAuthority(app, "trustedBool");
      });
      assert.equal(
        await (detail
          ? app.actions.readGitDiff()
          : app.actions.observeGitReview()),
        false,
      );
      await flush();
      assert.equal(calls.length, count);
      unsubscribe();
      app.dispose();
    });
  }
});

test("Git review: startup, selection, polling, visibility, refocus, resize and preview never query Git", async () => {
  const clock = fakeClock();
  let focus, visibility;
  const h = bridgeHarness((e) =>
    e.operation.type === "snapshot"
      ? {
          ok: true,
          value: snapshot(1, e.operation.sessionId ?? "a", {
            selectedWorkspaceId: e.operation.workspaceId ?? "w",
            workspaces: [workspace(), workspace("other")],
            sessions: [session("a"), session("b"), session("c", "other")],
          }),
        }
      : readFallback(e),
  );
  const app = createWindowWorkbench(h.bridge, {
    clock,
    id,
    onRefocus(listener) {
      focus = listener;
      return () => {};
    },
    onVisibility(listener) {
      visibility = listener;
      return () => {};
    },
  });
  app.start();
  await flush();
  app.actions.openFiles("a.txt", "file");
  await flush();
  app.actions.layout({ wide: false });
  app.actions.layout({ wide: true });
  app.actions.closeFiles();
  app.actions.openFiles();
  focus();
  visibility();
  await flush();
  app.actions.select("w", "b");
  await flush();
  app.actions.select("other", "c");
  await flush();
  await clock.advance(15000);
  assert.equal(
    h.calls.filter((e) => e.operation.type.startsWith("git.")).length,
    0,
  );
  app.dispose();
});

test("Git review: timeout and disposal cancel only read IDs and never dispatch mutations", async (t) => {
  for (const stop of ["timeout", "dispose", "cancel"]) {
    await t.test(stop, async () => {
      const pending = deferred(),
        { app, calls, cancellations, clock } = gitWindow(() => pending.promise);
      const read = app.actions.observeGitReview();
      await flush();
      if (stop === "timeout") await clock.advance(10000);
      if (stop === "dispose") app.dispose();
      if (stop === "cancel") app.actions.cancelGitReview();
      assert.equal(await read, false);
      await flush();
      assert.equal(cancellations.length, 1);
      assert.equal(cancellations[0].readId, calls[0].readId);
      assert.equal("operationId" in cancellations[0], false);
      assert.equal(calls.length, 1);
      pending.resolve({ ok: true, value: gitReviewValue() });
      await flush();
      assert.equal(
        selectors.currentGitReviewObservation(app.store.getState()),
        undefined,
      );
      app.dispose();
    });
  }
});

test("Git review: late detail is inert after every workspace authority change", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "workspace",
    "epoch",
    "globalHold",
    "resourceHold",
    "mutation",
    "saveIO",
    "disconnect",
  ]) {
    await t.test(change, async () => {
      const pending = deferred();
      const { app, calls, cancellations } = gitWindow((e) =>
        e.operation.type === "git.diff.read"
          ? pending.promise
          : { ok: true, value: gitReviewValue() },
      );
      await app.actions.observeGitReview();
      app.actions.selectGitPath("a.txt");
      const read = app.actions.readGitDiff();
      await flush();
      const op = calls.at(-1).operation;
      changeGitAuthority(app, change);
      if (
        [
          "root",
          "trustedBool",
          "disconnect",
          "globalHold",
          "resourceHold",
        ].includes(change)
      )
        seed(app.store);
      pending.resolve({ ok: true, value: gitDiffValue(op) });
      assert.equal(await read, false);
      assert.equal(
        selectors.currentGitDiffObservation(app.store.getState()),
        undefined,
      );
      assert.equal(calls.length, 2);
      assert.equal(cancellations.length, 1);
      app.dispose();
    });
  }
});

test("Git review: expired or changed metadata requires status refresh before more detail IO", async (t) => {
  for (const reason of [
    "expired_observation",
    "stale_observation",
    "metadata_changed",
    "path_changed",
    "process_unverified",
  ]) {
    await t.test(reason, async () => {
      const { app, calls } = gitWindow((e) => {
        if (e.operation.type === "git.review.read")
          return { ok: true, value: gitReviewValue() };
        const value = gitDiffValue(e.operation, {
          status: "unavailable",
          reason,
        });
        delete value.patch;
        delete value.sourceDigest;
        return { ok: true, value };
      });
      await app.actions.observeGitReview();
      app.actions.selectGitPath("a.txt");
      await app.actions.readGitDiff();
      assert.equal(
        selectors.currentGitReviewObservation(app.store.getState()),
        undefined,
      );
      app.actions.selectGitPath("new.txt");
      app.actions.selectGitPath("a.txt");
      assert.equal(
        await app.actions.readGitDiff(),
        false,
        "selection ABA must not restore expired status authority",
      );
      assert.equal(calls.length, 2);
      assert.equal(
        app.store.getState().gitReview.observation.status,
        "available",
      );
      assert.equal(await app.actions.observeGitReview(), true);
      app.dispose();
    });
  }
});

test("line feedback: explicit action appends loaded baseline to selected composer without IO", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  try {
    assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
    api.actions.editWorkspaceFile("unsaved replacement");
    api.actions.draft("keep this");
    api.actions.options({ agent: "reviewer", model: "chosen" });
    const before = selectors.draft(api.store.getState());
    const count = calls.length;
    assert.equal(
      typeof api.actions.selectLineFeedbackSource,
      "function",
      "missing explicit line feedback source action",
    );
    assert.equal(api.actions.selectLineFeedbackSource("file"), true);
    api.actions.editLineFeedback({
      start: 1,
      end: 1,
      comment: "Please check this line.",
    });
    assert.equal(api.actions.appendLineFeedback(), true);
    const after = selectors.draft(api.store.getState());
    assert.ok(after.text.startsWith("keep this\n\n"));
    const feedback = JSON.parse(after.text.slice(after.text.indexOf("{", 9)));
    assert.equal(feedback.excerpt, "original");
    assert.equal(feedback.reference.version, "a".repeat(64));
    assert.equal(feedback.reference.path, "notes.txt");
    assert.equal(after.revision, before.revision + 1);
    assert.equal(after.agent, before.agent);
    assert.equal(after.model, before.model);
    assert.equal(calls.length, count);
  } finally {
    api.dispose();
  }
});

async function prepareLineFeedback(api) {
  assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
  assert.equal(api.actions.selectLineFeedbackSource("file"), true);
  api.actions.editLineFeedback({ comment: "check\nthis line" });
  assert.equal(selectors.canAppendLineFeedback(api.store.getState()), true);
}
function capturedFeedbackAppend(api) {
  const s = api.store.getState();
  return {
    type: "line.feedback.append",
    draft: selectors.lineFeedbackDraft(s),
    key: selectionKey(s.selection.workspaceId, s.selection.sessionId),
    composer: selectors.draft(s),
  };
}

test("line feedback: exact production helper output preserves BOM CRLF and plaintext context", async () => {
  const content = "\uFEFF<script>not executable</script>\r\nnext\nlast";
  const { api, calls } = workspaceFileHarness(() => ({
    ok: true,
    value: workspaceFileObservation(content),
  }));
  try {
    await prepareLineFeedback(api);
    api.actions.editLineFeedback({
      start: 1,
      end: 3,
      comment: 'quote " and\n/tool x',
    });
    api.actions.editWorkspaceFile("different draft");
    const state = api.store.getState(),
      d = selectors.lineFeedbackDraft(state);
    const expected = formatLineFeedback(d.source, d.selection, d.comment);
    assert.equal(selectors.lineFeedbackPreview(state).excerpt, content);
    assert.equal(api.actions.appendLineFeedback(), true);
    assert.equal(
      selectors.draft(api.store.getState()).text,
      appendFeedbackText("", expected.text),
    );
    assert.equal(calls.length, 1);
    assert.equal(
      selectors.workspaceFileDraft(api.store.getState()).text,
      "different draft",
    );
    assert.equal(
      selectors.lineFeedbackDraft(api.store.getState()),
      d,
      "append keeps editable reference/comment draft",
    );
  } finally {
    api.dispose();
  }
});

test("line feedback: file scope changes keep historical drafts editable with no append authority or IO", async (t) => {
  for (const change of [
    "fileABA",
    "selectionABA",
    "floor",
    "rootABA",
    "trust",
    "untrusted",
    "epoch",
    "hold",
    "resourceHold",
  ])
    await t.test(change, async () => {
      const { api, calls } = workspaceFileSavingHarness();
      try {
        await prepareLineFeedback(api);
        const original = selectors.lineFeedbackDraft(api.store.getState());
        api.actions.draft("keep original composer");
        changeWorkspaceFileScope(api, change);
        const count = calls.length;
        api.actions.editLineFeedback({
          comment: `historical ${change}`,
          start: 1,
          end: 1,
        });
        const d = selectors.lineFeedbackDraft(api.store.getState());
        assert.equal(d.source, original.source);
        assert.equal(d.scope, original.scope);
        assert.equal(d.comment, `historical ${change}`);
        assert.equal(
          selectors.canAppendLineFeedback(api.store.getState()),
          false,
        );
        assert.equal(api.actions.appendLineFeedback(), false);
        assert.equal(
          selectors.draft(api.store.getState()).text,
          "keep original composer",
        );
        assert.equal(calls.length, count);
        api.actions.discardLineFeedback();
        assert.equal(
          selectors.lineFeedbackDraft(api.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.draft(api.store.getState()).text,
          "keep original composer",
        );
      } finally {
        api.dispose();
      }
    });
});

test("line feedback: refreshed identical metadata never relabels original source object", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  try {
    await prepareLineFeedback(api);
    const first = selectors.lineFeedbackDraft(api.store.getState());
    assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
    assert.notEqual(
      selectors.workspaceFileDraft(api.store.getState()).read,
      first.source.observation,
    );
    assert.equal(api.actions.appendLineFeedback(), false);
    assert.equal(
      selectors.lineFeedbackDraft(api.store.getState()).source,
      first.source,
    );
    assert.equal(api.actions.selectLineFeedbackSource("file"), true);
    const second = selectors.lineFeedbackDraft(api.store.getState());
    assert.notEqual(second.id, first.id);
    assert.equal(second.comment, "");
    api.actions.resumeLineFeedback(first.id);
    assert.equal(selectors.lineFeedbackDraft(api.store.getState()), first);
    assert.equal(api.actions.appendLineFeedback(), false);
    assert.equal(calls.length, 2);
  } finally {
    api.dispose();
  }
});

test("line feedback: reducer rejects stale captured events after composer/source/comment ABA", async (t) => {
  for (const change of [
    "composer",
    "options",
    "comment",
    "range",
    "discard",
    "source",
    "session",
    "root",
    "hold",
  ])
    await t.test(change, async () => {
      const { api, calls } = workspaceFileSavingHarness();
      try {
        await prepareLineFeedback(api);
        const event = capturedFeedbackAppend(api);
        if (change === "composer") {
          api.actions.draft("temporary");
          api.actions.draft("");
        }
        if (change === "options") {
          api.actions.options({ model: "temporary" });
          api.actions.options({ model: "" });
        }
        if (change === "comment") {
          api.actions.editLineFeedback({ comment: "temporary" });
          api.actions.editLineFeedback({ comment: event.draft.comment });
        }
        if (change === "range") {
          api.actions.editLineFeedback({ start: 2 });
          api.actions.editLineFeedback({ start: 1 });
        }
        if (change === "discard") {
          api.actions.discardLineFeedback();
          api.actions.selectLineFeedbackSource("file");
          api.actions.editLineFeedback({ comment: "replacement" });
        }
        if (change === "source")
          await api.actions.readWorkspaceFile("notes.txt");
        if (change === "session") {
          api.actions.select("w", "b");
          api.actions.select("w", "a");
        }
        if (change === "root") changeWorkspaceFileScope(api, "rootABA");
        if (change === "hold") changeWorkspaceFileScope(api, "hold");
        const before = api.store.getState().drafts,
          count = calls.length;
        assert.equal(api.store.dispatch(event), false);
        assert.equal(api.store.getState().drafts, before);
        assert.equal(calls.length, count);
      } finally {
        api.dispose();
      }
    });
});

test("line feedback: subscriber reentry cannot redirect atomic append or overwrite newer composer", async (t) => {
  for (const change of ["selection", "composer", "discard"])
    await t.test(change, async () => {
      const { api, calls } = workspaceFileSavingHarness();
      try {
        await prepareLineFeedback(api);
        api.actions.draft("original");
        const key = selectionKey("w", "a"),
          count = calls.length;
        let entered = false;
        const unsubscribe = api.store.subscribe((state) => {
          if (!entered && state.lineFeedback.notice === "ADDED") {
            entered = true;
            if (change === "selection") {
              api.actions.select("w", "b");
              api.actions.draft("other composer");
            }
            if (change === "composer")
              api.actions.draft("newer subscriber edit");
            if (change === "discard") api.actions.discardLineFeedback();
          }
        });
        assert.equal(
          api.actions.appendLineFeedback(),
          true,
          "reports atomic append even if subscriber changes state afterward",
        );
        unsubscribe();
        assert.equal(entered, true);
        const state = api.store.getState();
        if (change === "composer")
          assert.equal(state.drafts[key].text, "newer subscriber edit");
        else assert.ok(state.drafts[key].text.startsWith("original\n\n"));
        if (change === "selection")
          assert.equal(selectors.draft(state).text, "other composer");
        assert.equal(calls.length, count);
      } finally {
        api.dispose();
      }
    });
});

test("line feedback: old submitted revision ACK cannot clear appended composer", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  try {
    await prepareLineFeedback(api);
    api.actions.draft("original");
    const submitted = selectors.draft(api.store.getState());
    // The real intent is already pending before the local append.
    const intent = interruptIntent(api.store, "old-feedback-send", {
      operation: send(),
      submitted: { text: submitted.text, revision: submitted.revision },
    });
    assert.equal(selectors.canReadWorkspaceFile(api.store.getState()), false);
    assert.equal(api.actions.appendLineFeedback(), true);
    const appended = selectors.draft(api.store.getState());
    api.store.dispatch({
      type: "receipt",
      id: intent.id,
      receipt: receipt({
        runtimeEpoch: intent.epoch,
        operationId: intent.id,
        operation: intent.operation,
      }),
    });
    assert.equal(
      api.store.getState().operations[operationKey(intent.epoch, intent.id)]
        .status,
      "accepted",
    );
    assert.equal(selectors.draft(api.store.getState()), appended);
    assert.equal(calls.length, 1);
  } finally {
    api.dispose();
  }
});

test("line feedback: limits refuse without truncating comments or composer", async (t) => {
  for (const [name, content, edit, composer, reason] of [
    ["empty", "", {}, "", "INVALID_LINE_RANGE"],
    ["range", "line\n".repeat(201), { end: 201 }, "", "INVALID_LINE_RANGE"],
    ["missing line", "line", { start: 2, end: 2 }, "", "INVALID_LINE_RANGE"],
    ["reversed", "line\nnext", { start: 2, end: 1 }, "", "INVALID_LINE_RANGE"],
    ["fraction", "line", { start: 1.5 }, "", "INVALID_LINE_RANGE"],
    ["wrong side", "line", { side: "old" }, "", "INVALID_LINE_RANGE"],
    ["excerpt", "x".repeat(8193), {}, "", "FEEDBACK_TOO_LARGE"],
    [
      "blank comment",
      "line",
      { comment: " \n " },
      "",
      "INVALID_FEEDBACK_COMMENT",
    ],
    [
      "invalid unicode",
      "line",
      { comment: "\ud800" },
      "",
      "INVALID_FEEDBACK_COMMENT",
    ],
    ["composer", "line", {}, "c".repeat(32000), "DRAFT_TOO_LARGE"],
  ])
    await t.test(name, async () => {
      const { api, calls } = workspaceFileHarness(() => ({
        ok: true,
        value: workspaceFileObservation(content),
      }));
      try {
        assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
        api.actions.selectLineFeedbackSource("file");
        api.actions.editLineFeedback({ comment: "check", ...edit });
        api.actions.draft(composer);
        const before = selectors.draft(api.store.getState());
        assert.equal(
          selectors.lineFeedbackReason(api.store.getState()),
          reason,
        );
        assert.equal(api.actions.appendLineFeedback(), false);
        assert.equal(selectors.draft(api.store.getState()), before);
        assert.equal(calls.length, 1);
      } finally {
        api.dispose();
      }
    });
  const { api } = workspaceFileSavingHarness();
  try {
    await prepareLineFeedback(api);
    const d = selectors.lineFeedbackDraft(api.store.getState());
    api.actions.editLineFeedback({ comment: "x".repeat(2001) });
    assert.equal(selectors.lineFeedbackDraft(api.store.getState()), d);
    assert.equal(
      api.store.getState().lineFeedback.notice,
      "FEEDBACK_TOO_LARGE",
    );
    api.actions.editLineFeedback({ comment: "x".repeat(2000) });
    assert.equal(api.actions.appendLineFeedback(), true);
  } finally {
    api.dispose();
  }
});

test("line feedback: bounded retained draft cache refuses at 16 until explicit discard", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  try {
    for (let i = 1; i <= 16; i++) {
      assert.equal(await api.actions.readWorkspaceFile("notes.txt"), true);
      assert.equal(api.actions.selectLineFeedbackSource("file"), true);
      api.actions.editLineFeedback({ comment: `retain ${i}` });
    }
    const retained = api.store.getState().lineFeedback.drafts;
    assert.equal(Object.keys(retained).length, 16);
    await api.actions.readWorkspaceFile("notes.txt");
    assert.equal(api.actions.selectLineFeedbackSource("file"), false);
    assert.equal(api.store.getState().lineFeedback.notice, "CACHE_FULL");
    assert.equal(api.store.getState().lineFeedback.drafts, retained);
    api.actions.resumeLineFeedback("1");
    assert.equal(
      selectors.lineFeedbackDraft(api.store.getState()).comment,
      "retain 1",
    );
    api.actions.editLineFeedback({ comment: "historical edited" });
    assert.equal(api.actions.appendLineFeedback(), false);
    api.actions.discardLineFeedback();
    assert.equal(api.actions.selectLineFeedbackSource("file"), true);
    assert.equal(
      Object.keys(api.store.getState().lineFeedback.drafts).length,
      16,
    );
    assert.equal(calls.length, 17);
  } finally {
    api.dispose();
  }
});

async function prepareGitLineFeedback(app, mode = "unstaged", side = "new") {
  assert.equal(await app.actions.observeGitReview(), true);
  app.actions.selectGitPath("a.txt");
  app.actions.selectGitMode(mode);
  if (mode === "base") app.actions.selectGitBase("base");
  assert.equal(await app.actions.readGitDiff(), true);
  assert.equal(app.actions.selectLineFeedbackSource("git"), true);
  app.actions.editLineFeedback({ side, comment: "check Git" });
}

test("line feedback: Git old/new staged/unstaged/base references use exact accepted source and OID", async (t) => {
  for (const mode of ["staged", "unstaged", "base"])
    for (const side of ["old", "new"])
      await t.test(`${mode}/${side}`, async () => {
        const { app, calls } = gitWindow();
        try {
          await prepareGitLineFeedback(app, mode, side);
          const s = app.store.getState(),
            d = selectors.lineFeedbackDraft(s);
          assert.equal(
            d.source.observation,
            selectors.currentGitDiffObservation(s),
          );
          const expected = formatLineFeedback(d.source, d.selection, d.comment);
          assert.equal(app.actions.appendLineFeedback(), true);
          assert.equal(
            selectors.draft(app.store.getState()).text,
            expected.text,
          );
          assert.equal(expected.excerpt, side === "old" ? "old\n" : "new\n");
          assert.equal(expected.reference.observationId, "a".repeat(64));
          assert.equal(expected.reference.sourceDigest, "b".repeat(64));
          if (mode === "base")
            assert.equal(expected.reference.baseOid, "2".repeat(40));
          assert.equal(calls.length, 2);
        } finally {
          app.dispose();
        }
      });
});

test("line feedback: Git identity lifecycle keeps historical text but denies append", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "workspace",
    "epoch",
    "globalHold",
    "resourceHold",
    "mutation",
    "modeABA",
    "pathABA",
    "refresh",
    "detail",
  ])
    await t.test(change, async () => {
      const { app, calls } = gitWindow();
      try {
        await prepareGitLineFeedback(app);
        const original = selectors.lineFeedbackDraft(app.store.getState());
        if (change === "modeABA") {
          app.actions.selectGitMode("staged");
          app.actions.selectGitMode("unstaged");
        } else if (change === "pathABA") {
          app.actions.selectGitPath("new.txt");
          app.actions.selectGitPath("a.txt");
        } else if (change === "refresh") await app.actions.observeGitReview();
        else if (change === "detail") await app.actions.readGitDiff();
        else changeGitAuthority(app, change);
        const count = calls.length;
        app.actions.editLineFeedback({ comment: "historical Git" });
        assert.equal(
          selectors.lineFeedbackDraft(app.store.getState()).source,
          original.source,
        );
        assert.equal(
          selectors.lineFeedbackDraft(app.store.getState()).comment,
          "historical Git",
        );
        assert.equal(app.actions.appendLineFeedback(), false);
        assert.equal(selectors.draft(app.store.getState()).text, "");
        assert.equal(calls.length, count);
      } finally {
        app.dispose();
      }
    });
});

test("line feedback: Git missing side, empty and unsupported patch never append", async (t) => {
  for (const [name, patch, side, reason] of [
    ["empty", "", "new", "INVALID_LINE_RANGE"],
    ["missing old", "@@ -0,0 +1 @@\n+added\n", "old", "INVALID_LINE_RANGE"],
    [
      "false null header",
      "--- /dev/null\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
      "old",
      "UNSUPPORTED_DIFF",
    ],
    [
      "duplicate header",
      "--- a/a.txt\n--- a/a.txt\n+++ b/a.txt\n@@ -1 +1 @@\n-old\n+new\n",
      "new",
      "UNSUPPORTED_DIFF",
    ],
    [
      "unsupported",
      "@@@ -1,1 -1,1 +1,1 @@@\n line\n",
      "new",
      "UNSUPPORTED_DIFF",
    ],
  ])
    await t.test(name, async () => {
      const { app, calls } = gitWindow((e) => ({
        ok: true,
        value:
          e.operation.type === "git.review.read"
            ? gitReviewValue()
            : gitDiffValue(e.operation, { patch }),
      }));
      try {
        await prepareGitLineFeedback(app, "unstaged", side);
        assert.equal(
          selectors.lineFeedbackReason(app.store.getState()),
          reason,
        );
        assert.equal(app.actions.appendLineFeedback(), false);
        assert.equal(selectors.draft(app.store.getState()).text, "");
        assert.equal(calls.length, 2);
      } finally {
        app.dispose();
      }
    });
});

test("line feedback: missing source and selected session refuse; disposed actions stay inert", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  assert.equal(api.actions.selectLineFeedbackSource("file"), false);
  assert.equal(api.actions.selectLineFeedbackSource("git"), false);
  assert.equal(api.actions.appendLineFeedback(), false);
  assert.equal(calls.length, 0);
  await prepareLineFeedback(api);
  const original = selectors.lineFeedbackDraft(api.store.getState());
  api.actions.select("w");
  assert.equal(api.actions.appendLineFeedback(), false);
  assert.equal(
    selectors.lineFeedbackDraft(api.store.getState()).source,
    original.source,
  );
  const state = api.store.getState();
  api.dispose();
  assert.equal(api.actions.selectLineFeedbackSource("file"), false);
  assert.equal(api.actions.appendLineFeedback(), false);
  api.actions.editLineFeedback({ comment: "after disposal" });
  api.actions.discardLineFeedback();
  assert.equal(api.store.getState(), state);
});

test("line feedback: protected unavailable and malformed loaded sources cannot append", async (t) => {
  const unavailable = (status, reason) => {
    const value = workspaceFileObservation(undefined, { status, reason });
    delete value.content;
    delete value.version;
    delete value.directoryVersion;
    return value;
  };
  for (const value of [
    unavailable("unsupported", "protected_source"),
    unavailable("unavailable", "missing_file"),
    unavailable("unsupported", "unsupported_content"),
    workspaceFileObservation("content", { version: "invented" }),
  ])
    await t.test(value.reason ?? "malformed", async () => {
      const { api, calls } = workspaceFileHarness(() => ({ ok: true, value }));
      try {
        assert.equal(await api.actions.readWorkspaceFile("notes.txt"), false);
        assert.equal(api.actions.selectLineFeedbackSource("file"), false);
        assert.equal(api.actions.appendLineFeedback(), false);
        assert.equal(
          selectors.lineFeedbackDraft(api.store.getState()),
          undefined,
        );
        assert.equal(selectors.draft(api.store.getState()).text, "");
        assert.equal(calls.length, 1);
      } finally {
        api.dispose();
      }
    });
});

test("line feedback: invalid history IDs are inert and reselect preserves same-source comment", async () => {
  const { api, calls } = workspaceFileSavingHarness();
  try {
    await prepareLineFeedback(api);
    const d = selectors.lineFeedbackDraft(api.store.getState());
    api.actions.resumeLineFeedback("__proto__");
    api.actions.resumeLineFeedback("constructor");
    api.actions.resumeLineFeedback("absent");
    assert.equal(selectors.lineFeedbackDraft(api.store.getState()), d);
    assert.equal(api.actions.selectLineFeedbackSource("file"), true);
    assert.equal(selectors.lineFeedbackDraft(api.store.getState()), d);
    assert.equal(calls.length, 1);
  } finally {
    api.dispose();
  }
});

test("line feedback: pending Send cannot revive retired Git context or grant read authority", async (t) => {
  for (const variant of [
    "selected",
    "unknown",
    "hostHeld",
    "lookupOnly",
    "otherSession",
    "otherWorkspace",
    "otherEpoch",
    "otherOperation",
  ])
    await t.test(variant, async () => {
      const { app, calls } = gitWindow();
      try {
        await prepareGitLineFeedback(app, "unstaged", "new");
        app.actions.draft("keep submitted text");
        const s = app.store.getState();
        interruptIntent(app.store, "pending-feedback-test", {
          operation: {
            ...send(),
            workspaceId:
              variant === "otherWorkspace"
                ? "different-workspace"
                : s.selection.workspaceId,
            sessionId:
              variant === "otherSession"
                ? "different-session"
                : s.selection.sessionId,
            ...(variant === "otherOperation" && { type: "session.interrupt" }),
          },
          ...(variant === "unknown" && { status: "unknown" }),
          ...(variant === "hostHeld" && { hostHeld: true }),
          ...(variant === "lookupOnly" && { lookupOnly: true }),
          ...(variant === "otherEpoch" && { epoch: "previous-epoch" }),
        });
        assert.equal(selectors.canReadGitDiff(app.store.getState()), false);
        const count = calls.length;
        assert.equal(app.actions.appendLineFeedback(), false);
        assert.equal(calls.length, count);
        assert.equal(
          selectors.draft(app.store.getState()).text,
          "keep submitted text",
        );
      } finally {
        app.dispose();
      }
    });
});

const gitIndexPreviewValue = (operation, extra = {}) => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  workspacePath: "/fixture",
  status: "available",
  previewId: "c".repeat(64),
  previewDigest: "d".repeat(64),
  action: operation.action,
  paths: [...operation.paths],
  headOid: "1".repeat(40),
  indexExists: true,
  indexDigest: "e".repeat(64),
  nextIndexDigest: "f".repeat(64),
  objectFormat: "sha1",
  entries: operation.paths.map((path) => ({
    path,
    before: { mode: 0o100644, oid: "2".repeat(40) },
    after: { mode: 0o100755, oid: "3".repeat(40) },
  })),
  ...extra,
});
function gitIndexApplied(envelope, extra = {}) {
  const o = envelope.operation;
  const backupId = o.indexExists
    ? `.omoc-git-index-${createHash("sha256").update(operationKey(envelope.runtimeEpoch, envelope.operationId)).digest("hex")}.backup`
    : null;
  const admitted = { ...o, expectedRevision: envelope.expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(admitted)
          .sort()
          .map((k) => [k, admitted[k]]),
      ),
    )
    .digest("hex");
  return {
    ok: true,
    value: {
      requestId: envelope.operationId,
      status: "applied",
      indexDigest: o.nextIndexDigest,
      backupId,
    },
    receipt: receipt(envelope, {
      evidence: [{ kind: "host-registry", id: o.workspaceId }],
      result: {
        kind: "git_index_updated",
        workspaceId: o.workspaceId,
        action: o.action,
        paths: o.paths,
        indexDigest: o.nextIndexDigest,
        previewDigest: o.previewDigest,
        backupId,
        digest,
      },
    }),
    ...extra,
  };
}
function gitIndexWindow(handler) {
  return gitWindow(
    (e) =>
      handler?.(e) ??
      (e.operation.type === "git.review.read"
        ? { ok: true, value: gitReviewValue() }
        : e.operation.type === "git.index.preview.read"
          ? { ok: true, value: gitIndexPreviewValue(e.operation) }
          : e.operation.type === "git.index.apply"
            ? gitIndexApplied(e)
            : readFallback(e)),
  );
}
async function prepareGitIndex(app, action = "stage") {
  assert.equal(await app.actions.observeGitReview(), true);
  app.actions.toggleGitIndexPath("a.txt");
  app.actions.selectGitIndexAction(action);
  assert.equal(await app.actions.previewGitIndex(), true);
}
test("Git index: explicit selected preview and exact apply retire authority at confirmed floor", async () => {
  const { app, calls } = gitIndexWindow();
  try {
    assert.equal(await app.actions.applyGitIndex(), false);
    await app.actions.observeGitReview();
    app.actions.toggleGitIndexPath("new.txt");
    app.actions.toggleGitIndexPath("a.txt");
    assert.equal(calls.length, 1);
    assert.equal(await app.actions.previewGitIndex(), true);
    assert.deepEqual(calls[1].operation, {
      type: "git.index.preview.read",
      workspaceId: "w",
      observationId: "a".repeat(64),
      action: "stage",
      paths: ["a.txt", "new.txt"],
    });
    assert.equal(calls.length, 2);
    assert.equal(await app.actions.applyGitIndex(), true);
    const apply = calls.find((e) => e.operation.type === "git.index.apply");
    assert.equal(apply.operation.requestId, apply.operationId);
    assert.equal(apply.expectedRevision, 1);
    assert.equal("expectedRevision" in apply.operation, false);
    assert.equal("sessionId" in apply.operation, false);
    assert.equal(
      selectors.currentGitIndexPreview(app.store.getState()),
      undefined,
    );
    assert.equal(
      selectors.currentGitReviewObservation(app.store.getState()),
      undefined,
    );
    assert.equal(app.store.getState().revision, 2);
    assert.equal(await app.actions.previewGitIndex(), false);
    assert.equal(
      calls.filter((e) => e.operation.type === "git.review.read").length,
      1,
    );
    assert.ok(selectors.gitIndex(app.store.getState()).preview);
  } finally {
    app.dispose();
  }
});
test("Git index: protected selections and stale preview do not reach transport", async () => {
  const { app, calls } = gitIndexWindow();
  try {
    await app.actions.observeGitReview();
    for (const path of [
      ".git/config",
      ".GiT/index",
      "AGENTS.md",
      ".opencode/config.json",
      "../x",
    ])
      app.actions.toggleGitIndexPath(path);
    assert.deepEqual(selectors.gitIndex(app.store.getState()).paths, []);
    assert.equal(await app.actions.previewGitIndex(), false);
    app.actions.toggleGitIndexPath("a.txt");
    assert.equal(await app.actions.previewGitIndex(), true);
    app.actions.toggleGitIndexPath("a.txt");
    app.actions.toggleGitIndexPath("a.txt");
    assert.equal(await app.actions.applyGitIndex(), false);
    assert.equal(calls.length, 2);
  } finally {
    app.dispose();
  }
});

test("Git index: unchanged selected rows, SHA256 unborn HEAD and true index absence stay distinct", async (t) => {
  for (const indexExists of [true, false])
    await t.test(String(indexExists), async () => {
      const { app, calls } = gitIndexWindow((e) => {
        if (e.operation.type === "git.review.read")
          return {
            ok: true,
            value: gitReviewValue({
              repository: {
                ...gitReviewValue().repository,
                head: null,
                objectFormat: "sha256",
              },
              branches: [{ name: "main", oid: "1".repeat(64) }],
            }),
          };
        if (e.operation.type === "git.index.preview.read")
          return {
            ok: true,
            value: gitIndexPreviewValue(e.operation, {
              headOid: null,
              objectFormat: "sha256",
              indexExists,
              indexDigest: indexExists
                ? "e".repeat(64)
                : "1e805e1eec918accfc6bba36e68b1a5f77c81ec7f1a7a90ed99b688b7b141eae",
              entries: e.operation.paths.map((path, n) => ({
                path,
                before: indexExists
                  ? { mode: 0o100644, oid: "2".repeat(64) }
                  : null,
                after: {
                  mode: 0o100644,
                  oid: (n === 0 ? "3" : "2").repeat(64),
                },
              })),
            }),
          };
      });
      try {
        await app.actions.observeGitReview();
        app.actions.toggleGitIndexPath("new.txt");
        app.actions.toggleGitIndexPath("a.txt");
        app.actions.selectGitIndexAction("stage");
        assert.equal(await app.actions.previewGitIndex(), true);
        const p = selectors.currentGitIndexPreview(app.store.getState());
        if (indexExists)
          assert.deepEqual(p.entries[1].before, p.entries[1].after);
        else assert.equal(p.entries[1].before, null);
        assert.equal(p.headOid, null);
        assert.equal(p.indexExists, indexExists);
        assert.equal(await app.actions.applyGitIndex(), true);
        assert.equal(
          calls.find((e) => e.operation.type === "git.index.apply").operation
            .action,
          "stage",
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git index: no_changes and unsupported states are visible and cannot apply", async (t) => {
  for (const reason of [
    "no_changes",
    "lock_conflict",
    "platform_unavailable",
    "git_unavailable",
    "unsupported_configuration",
    "unsupported_index_mutation",
    "read_failed",
    "expired_observation",
  ])
    await t.test(reason, async () => {
      const { app, calls } = gitIndexWindow((e) =>
        e.operation.type === "git.index.preview.read"
          ? {
              ok: true,
              value: {
                runtimeEpoch: "epoch-a",
                revision: 1,
                workspaceId: "w",
                workspacePath: "/fixture",
                status: "unavailable",
                reason,
              },
            }
          : undefined,
      );
      try {
        await app.actions.observeGitReview();
        app.actions.toggleGitIndexPath("a.txt");
        await app.actions.previewGitIndex();
        assert.equal(
          selectors.gitIndex(app.store.getState()).preview.reason,
          reason,
        );
        assert.equal(await app.actions.applyGitIndex(), false);
        assert.equal(calls.length, 2);
      } finally {
        app.dispose();
      }
    });
});
test("Git index: malformed or unbound preview cannot supply apply authority", async (t) => {
  const changes = {
    epoch: (p) => (p.runtimeEpoch = "epoch-b"),
    floor: (p) => (p.revision = 2),
    root: (p) => (p.workspacePath = "/other"),
    workspace: (p) => (p.workspaceId = "other"),
    action: (p) => (p.action = "unstage"),
    paths: (p) => (p.paths = ["new.txt"]),
    head: (p) => (p.headOid = "4".repeat(40)),
    format: (p) => (p.objectFormat = "sha256"),
    extra: (p) => (p.expiresAt = 100),
    unchanged: (p) => (p.entries[0].after = p.entries[0].before),
    protected: (p) => {
      p.paths = [".GiT/index"];
      p.entries[0].path = p.paths[0];
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app } = gitIndexWindow((e) => {
        if (e.operation.type !== "git.index.preview.read") return;
        const p = gitIndexPreviewValue(e.operation);
        change(p);
        return { ok: true, value: p };
      });
      try {
        await app.actions.observeGitReview();
        app.actions.toggleGitIndexPath("a.txt");
        assert.equal(await app.actions.previewGitIndex(), false);
        assert.equal(await app.actions.applyGitIndex(), false);
      } finally {
        app.dispose();
      }
    });
});
test("Git index: late preview and retained metadata stay inert after scope and selection ABA", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "epoch",
    "globalHold",
    "resourceHold",
    "disconnect",
    "pathABA",
    "actionABA",
    "workspaceABA",
    "refresh",
  ])
    await t.test(change, async () => {
      const late = deferred();
      let op;
      const { app, calls } = gitIndexWindow((e) => {
        if (e.operation.type === "git.index.preview.read") {
          op = e.operation;
          return late.promise;
        }
      });
      try {
        await app.actions.observeGitReview();
        app.actions.toggleGitIndexPath("a.txt");
        const read = app.actions.previewGitIndex();
        await flush();
        if (change === "pathABA") {
          app.actions.toggleGitIndexPath("a.txt");
          app.actions.toggleGitIndexPath("a.txt");
        } else if (change === "actionABA") {
          app.actions.selectGitIndexAction("unstage");
          app.actions.selectGitIndexAction("stage");
        } else if (change === "workspaceABA") {
          app.actions.select("other");
          app.actions.select("w", "a");
        } else if (change === "refresh") {
          app.actions.cancelGitIndexPreview();
          await app.actions.observeGitReview();
        } else changeGitAuthority(app, change);
        late.resolve({ ok: true, value: gitIndexPreviewValue(op) });
        assert.equal(await read, false);
        assert.equal(await app.actions.applyGitIndex(), false);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.index.apply").length,
          0,
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git index: apply refuses drift during hash, admission and actual IO subscriber reentry", async (t) => {
  for (const phase of ["hash", "intent", "io", "previewRequest", "previewIO"])
    await t.test(phase, async () => {
      const { app, calls } = gitIndexWindow();
      let unsubscribe = () => {},
        changed = false;
      const original = globalThis.crypto.subtle.digest;
      try {
        if (phase.startsWith("preview")) {
          await app.actions.observeGitReview();
          app.actions.toggleGitIndexPath("a.txt");
          unsubscribe = app.store.subscribe((next) => {
            if (
              !changed &&
              (phase === "previewRequest"
                ? next.gitIndex.request
                : next.configurationIO.reads > 0)
            ) {
              changed = true;
              changeGitAuthority(app, "trustedBool");
            }
          });
          assert.equal(await app.actions.previewGitIndex(), false);
          assert.equal(
            calls.filter((e) => e.operation.type === "git.index.preview.read")
              .length,
            0,
          );
        } else {
          await prepareGitIndex(app);
          if (phase === "hash")
            globalThis.crypto.subtle.digest = async function (...args) {
              changeGitAuthority(app, "trustedBool");
              return original.apply(this, args);
            };
          else
            unsubscribe = app.store.subscribe((next) => {
              if (
                !changed &&
                (phase === "intent"
                  ? Object.values(next.operations).some(
                      (i) => i.operation.type === "git.index.apply",
                    )
                  : Object.keys(next.gitIndexIO).length > 0)
              ) {
                changed = true;
                changeGitAuthority(app, "trustedBool");
              }
            });
          assert.equal(await app.actions.applyGitIndex(), false);
          assert.equal(
            calls.filter((e) => e.operation.type === "git.index.apply").length,
            0,
          );
          assert.deepEqual(app.store.getState().gitIndexIO, {});
        }
      } finally {
        globalThis.crypto.subtle.digest = original;
        unsubscribe();
        app.dispose();
      }
    });
});
test("Git index: forged successful result or receipt becomes unknown without self-binding", async (t) => {
  const changes = {
    resultDigest: (r) => (r.value.indexDigest = "a".repeat(64)),
    resultBackup: (r) => (r.value.backupId = null),
    request: (r) => (r.value.requestId = "wrong"),
    receiptDigest: (r) => (r.receipt.result.digest = "a".repeat(64)),
    oldIndex: (r) => (r.receipt.result.indexDigest = "e".repeat(64)),
    preview: (r) => (r.receipt.result.previewDigest = "a".repeat(64)),
    action: (r) => (r.receipt.result.action = "unstage"),
    paths: (r) => (r.receipt.result.paths = ["new.txt"]),
    backup: (r) =>
      (r.receipt.result.backupId =
        ".omoc-git-index-" + "a".repeat(64) + ".backup"),
    workspace: (r) => (r.receipt.result.workspaceId = "other"),
    clock: (r) => (r.receipt.revision = 1),
    epoch: (r) => (r.receipt.runtimeEpoch = "epoch-b"),
    operation: (r) => (r.receipt.operationId = "wrong"),
    evidence: (r) => (r.receipt.evidence = []),
    unknownConfirmed: (r) =>
      (r.value = { requestId: r.value.requestId, status: "unknown" }),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app, calls } = gitIndexWindow((e) => {
        if (e.operation.type !== "git.index.apply") return;
        const r = gitIndexApplied(e);
        change(r);
        return r;
      });
      try {
        await prepareGitIndex(app);
        assert.equal(await app.actions.applyGitIndex(), false);
        await flush();
        const intent = Object.values(app.store.getState().operations).find(
          (i) => i.operation.type === "git.index.apply",
        );
        assert.equal(intent.status, "unknown");
        assert.equal(intent.lookupOnly, true);
        assert.deepEqual(intent.operation, {
          type: "git.index.apply",
          workspaceId: "w",
        });
        assert.equal(app.store.getState().revision, 1);
        assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
        assert.equal(await app.actions.applyGitIndex(), false);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.index.apply").length,
          1,
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git index: timeout and lookup confirmation keep actual IO hold until original finally", async () => {
  const late = deferred();
  let admitted;
  const { app, clock, calls } = gitIndexWindow((e) => {
    if (e.operation.type === "git.index.apply") {
      admitted = e;
      return late.promise;
    }
    if (e.operation.type === "operation.lookup")
      return {
        ok: true,
        value: {
          status: "found",
          runtimeEpoch: admitted.runtimeEpoch,
          operationId: admitted.operationId,
          receipt: gitIndexApplied(admitted).receipt,
        },
      };
  });
  try {
    await prepareGitIndex(app);
    const apply = app.actions.applyGitIndex();
    await flush();
    // SHA256 uses actual WebCrypto completion; wait only for the owned dispatch.
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    await clock.advance(10000);
    assert.equal(await apply, false);
    await flush();
    const key = operationKey(admitted.runtimeEpoch, admitted.operationId);
    assert.equal(app.store.getState().operations[key].status, "accepted");
    assert.equal(app.store.getState().gitIndexIO[key], "w");
    assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(app.store.getState()), true);
    seed(app.store, snapshot(2));
    assert.equal(await app.actions.observeGitReview(), false);
    late.resolve(gitIndexApplied(admitted));
    await flush();
    assert.deepEqual(app.store.getState().gitIndexIO, {});
    assert.equal(
      calls.filter((e) => e.operation.type === "git.index.apply").length,
      1,
    );
    assert.equal(
      selectors.currentGitIndexPreview(app.store.getState()),
      undefined,
    );
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});

test("Git index: retained preview is detached and stays historical across root, trust, epoch and generation", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "epoch",
    "workspace",
    "globalHold",
    "resourceHold",
    "disconnect",
    "refresh",
  ]) {
    await t.test(change, async () => {
      let original;
      const { app, calls } = gitIndexWindow((e) => {
        if (e.operation.type === "git.index.preview.read") {
          original = gitIndexPreviewValue(e.operation);
          return { ok: true, value: original };
        }
      });
      try {
        await prepareGitIndex(app);
        const accepted = app.store.getState().gitIndex.preview;
        original.entries[0].after.oid = "9".repeat(40);
        original.paths.push("injected.txt");
        assert.equal(accepted.entries[0].after.oid, "3".repeat(40));
        assert.deepEqual(accepted.paths, ["a.txt"]);
        if (change === "refresh") await app.actions.observeGitReview();
        else changeGitAuthority(app, change);
        assert.equal(
          selectors.currentGitIndexPreview(app.store.getState()),
          undefined,
        );
        assert.equal(app.store.getState().gitIndex.preview, accepted);
        assert.equal(await app.actions.applyGitIndex(), false);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.index.apply").length,
          0,
        );
        app.actions.draft("editable other draft");
        assert.equal(
          selectors.draft(app.store.getState()).text,
          "editable other draft",
        );
      } finally {
        app.dispose();
      }
    });
  }
});
test("Git index: actual IO in old epoch keeps original lookup key and permits independent workspace review", async () => {
  const late = deferred();
  let admitted;
  const { app, clock, calls } = gitIndexWindow((e) => {
    if (e.operation.type === "git.index.apply") {
      admitted = e;
      return late.promise;
    }
    if (
      e.operation.type === "git.review.read" &&
      e.operation.workspaceId === "other"
    )
      return {
        ok: true,
        value: gitReviewValue({
          runtimeEpoch: "epoch-b",
          workspaceId: "other",
          workspacePath: "/other",
          repository: {
            ...gitReviewValue().repository,
            worktreePath: "/other",
            gitDirectory: "/other/.git",
            commonDirectory: "/other/.git",
          },
        }),
      };
  });
  try {
    await prepareGitIndex(app);
    const pending = app.actions.applyGitIndex();
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "oa", {
        runtimeEpoch: "epoch-b",
        selectedWorkspaceId: "other",
        workspaces: [workspace(), { ...workspace("other"), path: "/other" }],
        sessions: [session("a"), session("oa", "other")],
      }),
    });
    assert.equal(await app.actions.observeGitReview(), true);
    assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(app.store.getState()), true);
    assert.equal(
      resourceMutationDisabled(app.store.getState(), "other"),
      false,
    );
    await clock.advance(10000);
    assert.equal(await pending, false);
    await flush();
    const query = calls.find((e) => e.operation.type === "operation.lookup");
    assert.equal(query.runtimeEpoch, "epoch-b");
    assert.equal(query.operation.runtimeEpoch, "epoch-a");
    assert.equal(query.operation.operationId, admitted.operationId);
    assert.equal(app.store.getState().selection.workspaceId, "other");
    assert.equal(
      app.store.getState().gitIndex.mutation.identity.workspaceId,
      "w",
    );
    app.actions.draft("other workspace text");
    late.resolve(gitIndexApplied(admitted));
    await flush();
    assert.equal(
      calls.filter((e) => e.operation.type === "git.index.apply").length,
      1,
    );
    assert.equal(
      selectors.draft(app.store.getState()).text,
      "other workspace text",
    );
    assert.equal(app.store.getState().selection.workspaceId, "other");
    assert.deepEqual(app.store.getState().gitIndexIO, {});
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});
test("Git index: reopened retained original key is lookup only and never restores mutation payload", async () => {
  const { app, clock, calls } = gitIndexWindow();
  try {
    seed(
      app.store,
      snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "old-index",
            type: "git.index.apply",
            workspaceId: "w",
          },
        ],
      }),
    );
    // A new epoch requires an explicit bootstrap projection.
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "old-index",
            type: "git.index.apply",
            workspaceId: "w",
          },
        ],
      }),
    });
    app.start();
    await flush();
    await clock.advance(1000);
    const intent =
      app.store.getState().operations[operationKey("epoch-a", "old-index")];
    assert.ok(intent);
    assert.equal(intent.lookupOnly, true);
    assert.equal(intent.gitIndexMutation, undefined);
    assert.deepEqual(intent.operation, {
      type: "git.index.apply",
      workspaceId: "w",
    });
    assert.equal(await app.actions.applyGitIndex(), false);
    const query = calls.find((e) => e.operation.type === "operation.lookup");
    assert.ok(query);
    assert.equal(query.runtimeEpoch, "epoch-b");
    assert.equal(query.operation.runtimeEpoch, "epoch-a");
    assert.equal(
      calls.filter((e) => e.operation.type.startsWith("git.index.")).length,
      0,
    );
  } finally {
    app.dispose();
  }
});
test("Git index: untrusted, Native running, permissions and recovery permit no index preview", async (t) => {
  const changes = {
    permission: {
      permissions: [{ id: "p", action: "read", resource: "file" }],
    },
    untrusted: { workspaces: [{ ...workspace(), trusted: false }] },
    running: { sessions: [session("a", "w", { status: "running" })] },
    unavailable: { sessions: [session("a", "w", { status: "unavailable" })] },
    disconnected: { state: "disconnected" },
    hold: {
      recovery: {
        store: { state: "ready" },
        resources: [
          {
            workspaceId: "w",
            state: "unavailable",
            reason: "unresolved_operation",
          },
        ],
      },
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app, calls } = gitIndexWindow();
      try {
        seed(app.store, snapshot(1, "a", change));
        await app.actions.observeGitReview();
        app.actions.toggleGitIndexPath("a.txt");
        assert.equal(await app.actions.previewGitIndex(), false);
        assert.equal(await app.actions.applyGitIndex(), false);
        assert.equal(
          calls.filter((e) => e.operation.type.startsWith("git.index.")).length,
          0,
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git index: cancellation and timeout retain physical preview read lane without auto retry", async (t) => {
  for (const action of ["cancel", "timeout", "dispose"])
    await t.test(action, async () => {
      const late = deferred();
      let operation;
      const { app, clock, calls, cancellations } = gitIndexWindow((e) => {
        if (e.operation.type === "git.index.preview.read") {
          operation = e.operation;
          return late.promise;
        }
      });
      try {
        await app.actions.observeGitReview();
        app.actions.toggleGitIndexPath("a.txt");
        const read = app.actions.previewGitIndex();
        await flush();
        if (action === "cancel") app.actions.cancelGitIndexPreview();
        else if (action === "timeout") await clock.advance(10000);
        else app.dispose();
        assert.equal(await read, false);
        assert.equal(cancellations.length, 1);
        assert.ok(cancellations[0].readId);
        assert.equal(cancellations[0].operationId, undefined);
        await clock.advance(1000);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.index.preview.read")
            .length,
          1,
        );
        late.resolve({ ok: true, value: gitIndexPreviewValue(operation) });
        await flush();
        assert.equal(
          selectors.currentGitIndexPreview(app.store.getState()),
          undefined,
        );
        assert.equal(
          calls.filter((e) => e.operation.type === "git.index.apply").length,
          0,
        );
      } finally {
        late.resolve({ ok: false, code: "UNAVAILABLE" });
        app.dispose();
      }
    });
});

test("Git index: unstage request preserves explicit action and confirmed denial has no effect", async (t) => {
  for (const denied of [false, true])
    await t.test(String(denied), async () => {
      const { app, calls } = gitIndexWindow((e) =>
        e.operation.type === "git.index.apply" && denied
          ? {
              ok: false,
              code: "CONFIRMATION_DENIED",
              message: "CONFIRMATION_DENIED",
              receipt: receipt(e, {
                admission: "rejected",
                delivery: "pending",
                effect: "none",
                revision: 1,
                evidence: [],
                result: { kind: "rejected", code: "CONFIRMATION_DENIED" },
              }),
            }
          : undefined,
      );
      try {
        await prepareGitIndex(app, "unstage");
        assert.equal(await app.actions.applyGitIndex(), !denied);
        const request = calls.find(
          (e) => e.operation.type === "git.index.apply",
        );
        assert.equal(request.operation.action, "unstage");
        assert.equal(
          app.store.getState().gitIndex.mutation.status,
          denied ? "denied" : "applied",
        );
        assert.equal(app.store.getState().revision, denied ? 1 : 2);
        assert.deepEqual(app.store.getState().gitIndexIO, {});
      } finally {
        app.dispose();
      }
    });
});

// Explicit commit fixtures are synthetic. No Git or filesystem publisher runs.
const commitAuthor = {
  name: "합성 사용자",
  email: "synthetic@example.invalid",
};
const commitMessage = "\ufeffSYNTHETIC\r\n";
const commitAbsent = createHash("sha256")
  .update("omoc-absent-git-commit-v1")
  .digest("hex");
function gitCommitPreviewValue(operation, extra = {}) {
  return {
    runtimeEpoch: "epoch-a",
    revision: 1,
    workspaceId: "w",
    workspacePath: "/fixture",
    status: "available",
    previewId: "c".repeat(64),
    previewDigest: "d".repeat(64),
    objectFormat: "sha1",
    indexDigest: "e".repeat(64),
    headOid: "1".repeat(40),
    treeOid: "2".repeat(40),
    treeDigest: "f".repeat(64),
    commitOid: "3".repeat(40),
    commitBodyDigest: "b".repeat(64),
    reference: {
      kind: "branch",
      name: "refs/heads/main",
      exists: false,
      digest: commitAbsent,
      nextDigest: "a".repeat(64),
    },
    logs: [
      {
        role: "head_log",
        exists: true,
        digest: "b".repeat(64),
        nextDigest: "c".repeat(64),
        nextBytes: 300,
      },
      {
        role: "branch_log",
        exists: false,
        digest: commitAbsent,
        nextDigest: "d".repeat(64),
        nextBytes: 150,
      },
    ],
    author: { ...operation.author },
    timestamp: 1234567890,
    canonicalMessage: operation.message.endsWith("\n")
      ? operation.message
      : operation.message + "\n",
    entries: [
      {
        path: "a.txt",
        before: { mode: 0o100644, oid: "2".repeat(40) },
        after: null,
      },
    ],
    ...extra,
  };
}
function gitCommitApplied(envelope) {
  const o = envelope.operation;
  const backups = [
    ...o.logs,
    {
      role: o.reference.kind === "head" ? "head_ref" : "branch_ref",
      exists: o.reference.exists,
    },
  ].map((x) => ({
    role: x.role,
    backupId: x.exists
      ? `.omoc-git-commit-${createHash("sha256")
          .update(
            JSON.stringify([
              envelope.runtimeEpoch,
              envelope.operationId,
              x.role,
            ]),
          )
          .digest("hex")}.backup`
      : null,
  }));
  const admitted = { ...o, expectedRevision: envelope.expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(admitted)
          .sort()
          .map((k) => [k, admitted[k]]),
      ),
    )
    .digest("hex");
  const result = {
    kind: "git_commit_created",
    workspaceId: o.workspaceId,
    commitOid: o.commitOid,
    treeOid: o.treeOid,
    parentOid: o.headOid,
    referenceDigest: o.reference.nextDigest,
    logDigests: o.logs.map((x) => ({ role: x.role, digest: x.nextDigest })),
    previewDigest: o.previewDigest,
    backups,
    digest,
  };
  return {
    ok: true,
    value: {
      requestId: envelope.operationId,
      status: "committed",
      commitOid: o.commitOid,
      treeOid: o.treeOid,
      referenceDigest: result.referenceDigest,
      logDigests: result.logDigests,
      backups,
    },
    receipt: receipt(envelope, {
      evidence: [{ kind: "host-registry", id: o.workspaceId }],
      result,
    }),
  };
}
function gitCommitWindow(handler) {
  return gitWindow(
    (e) =>
      handler?.(e) ??
      (e.operation.type === "git.review.read"
        ? { ok: true, value: gitReviewValue() }
        : e.operation.type === "git.commit.preview.read"
          ? { ok: true, value: gitCommitPreviewValue(e.operation) }
          : e.operation.type === "git.commit.apply"
            ? gitCommitApplied(e)
            : readFallback(e)),
  );
}
async function prepareGitCommit(app) {
  assert.equal(await app.actions.observeGitReview(), true);
  app.actions.editGitCommit({ ...commitAuthor, message: commitMessage });
  assert.equal(await app.actions.previewGitCommit(), true);
}
test("Git commit: explicit identity and all-staged deletion preview apply retire original read", async () => {
  const { app, calls } = gitCommitWindow();
  try {
    assert.equal(await app.actions.applyGitCommit(), false);
    assert.equal(await app.actions.previewGitCommit(), false);
    assert.equal(selectors.gitCommitDraft(app.store.getState()).name, "");
    await prepareGitCommit(app);
    assert.deepEqual(calls[1].operation, {
      type: "git.commit.preview.read",
      workspaceId: "w",
      observationId: "a".repeat(64),
      author: commitAuthor,
      message: commitMessage,
    });
    assert.equal(
      selectors.currentGitCommitPreview(app.store.getState()).entries[0].after,
      null,
    );
    assert.equal(await app.actions.applyGitCommit(), true);
    const e = calls.find((e) => e.operation.type === "git.commit.apply");
    assert.equal(e.operationId, e.operation.requestId);
    assert.equal(e.expectedRevision, 1);
    assert.equal("sessionId" in e.operation, false);
    assert.equal("author" in e.operation, false);
    assert.equal(
      selectors.gitCommit(app.store.getState()).mutation.status,
      "committed",
    );
    assert.equal(
      selectors.currentGitCommitPreview(app.store.getState()),
      undefined,
    );
    assert.equal(
      selectors.currentGitReviewObservation(app.store.getState()),
      undefined,
    );
    assert.equal(app.store.getState().revision, 2);
    assert.equal(await app.actions.previewGitCommit(), false);
    assert.equal(calls.length, 3);
    assert.equal(
      selectors.gitCommitDraft(app.store.getState()).message,
      commitMessage,
    );
  } finally {
    app.dispose();
  }
});
test("Git commit: empty invalid identity and malformed or refused preview never apply", async (t) => {
  for (const shape of [
    "empty",
    "author",
    "message",
    "entries",
    "head",
    "format",
    "root",
    "epoch",
    "floor",
    "extra",
    "no_changes",
    "unsupported_commit_state",
  ])
    await t.test(shape, async () => {
      const { app, calls } = gitCommitWindow((e) => {
        if (e.operation.type !== "git.commit.preview.read") return;
        const p = gitCommitPreviewValue(e.operation);
        if (shape === "author") p.author.name = "Forged";
        if (shape === "message") p.canonicalMessage = "Forged\n";
        if (shape === "entries") p.entries = [];
        if (shape === "head") p.headOid = "4".repeat(40);
        if (shape === "format") p.objectFormat = "sha256";
        if (shape === "root") p.workspacePath = "/other";
        if (shape === "epoch") p.runtimeEpoch = "epoch-b";
        if (shape === "floor") p.revision = 2;
        if (shape === "extra") p.secret = "x";
        if (["no_changes", "unsupported_commit_state"].includes(shape))
          return {
            ok: true,
            value: {
              runtimeEpoch: p.runtimeEpoch,
              revision: p.revision,
              workspaceId: p.workspaceId,
              workspacePath: p.workspacePath,
              status: "unavailable",
              reason: shape,
            },
          };
        return { ok: true, value: p };
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitCommit({
          ...commitAuthor,
          message: shape === "empty" ? " " : commitMessage,
        });
        await app.actions.previewGitCommit();
        assert.equal(await app.actions.applyGitCommit(), false);
        assert.equal(
          calls.some((e) => e.operation.type === "git.commit.apply"),
          false,
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git commit: timeout and lookup confirmation keep actual IO hold until original finally", async () => {
  const late = deferred();
  let admitted;
  const { app, clock, calls } = gitCommitWindow((e) => {
    if (e.operation.type === "git.commit.apply") {
      admitted = e;
      return late.promise;
    }
    if (e.operation.type === "operation.lookup")
      return {
        ok: true,
        value: {
          status: "found",
          runtimeEpoch: admitted.runtimeEpoch,
          operationId: admitted.operationId,
          receipt: gitCommitApplied(admitted).receipt,
        },
      };
  });
  try {
    await prepareGitCommit(app);
    const apply = app.actions.applyGitCommit();
    await flush();
    // SHA256 uses actual WebCrypto completion; wait only for the owned dispatch.
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    await clock.advance(10000);
    assert.equal(await apply, false);
    await flush();
    const key = operationKey(admitted.runtimeEpoch, admitted.operationId);
    assert.equal(app.store.getState().operations[key].status, "accepted");
    assert.equal(app.store.getState().gitCommitIO[key], "w");
    assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(app.store.getState()), true);
    seed(app.store, snapshot(2));
    assert.equal(await app.actions.observeGitReview(), false);
    late.resolve(gitCommitApplied(admitted));
    await flush();
    assert.deepEqual(app.store.getState().gitCommitIO, {});
    assert.equal(
      calls.filter((e) => e.operation.type === "git.commit.apply").length,
      1,
    );
    assert.equal(
      selectors.currentGitCommitPreview(app.store.getState()),
      undefined,
    );
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});

test("Git commit: actual IO in old epoch keeps original lookup key and permits independent workspace review", async () => {
  const late = deferred();
  let admitted;
  const { app, clock, calls } = gitCommitWindow((e) => {
    if (e.operation.type === "git.commit.apply") {
      admitted = e;
      return late.promise;
    }
    if (
      e.operation.type === "git.review.read" &&
      e.operation.workspaceId === "other"
    )
      return {
        ok: true,
        value: gitReviewValue({
          runtimeEpoch: "epoch-b",
          workspaceId: "other",
          workspacePath: "/other",
          repository: {
            ...gitReviewValue().repository,
            worktreePath: "/other",
            gitDirectory: "/other/.git",
            commonDirectory: "/other/.git",
          },
        }),
      };
  });
  try {
    await prepareGitCommit(app);
    const pending = app.actions.applyGitCommit();
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "oa", {
        runtimeEpoch: "epoch-b",
        selectedWorkspaceId: "other",
        workspaces: [workspace(), { ...workspace("other"), path: "/other" }],
        sessions: [session("a"), session("oa", "other")],
      }),
    });
    assert.equal(await app.actions.observeGitReview(), true);
    assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(app.store.getState()), true);
    assert.equal(
      resourceMutationDisabled(app.store.getState(), "other"),
      false,
    );
    await clock.advance(10000);
    assert.equal(await pending, false);
    await flush();
    const query = calls.find((e) => e.operation.type === "operation.lookup");
    assert.equal(query.runtimeEpoch, "epoch-b");
    assert.equal(query.operation.runtimeEpoch, "epoch-a");
    assert.equal(query.operation.operationId, admitted.operationId);
    assert.equal(app.store.getState().selection.workspaceId, "other");
    assert.equal(
      app.store.getState().gitCommit.mutation.identity.workspaceId,
      "w",
    );
    app.actions.draft("other workspace text");
    late.resolve(gitCommitApplied(admitted));
    await flush();
    assert.equal(
      calls.filter((e) => e.operation.type === "git.commit.apply").length,
      1,
    );
    assert.equal(
      selectors.draft(app.store.getState()).text,
      "other workspace text",
    );
    assert.equal(app.store.getState().selection.workspaceId, "other");
    assert.deepEqual(app.store.getState().gitCommitIO, {});
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});
test("Git commit: reopened retained original key is lookup only and never restores mutation payload", async () => {
  const { app, clock, calls } = gitCommitWindow();
  try {
    seed(
      app.store,
      snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "old-index",
            type: "git.commit.apply",
            workspaceId: "w",
          },
        ],
      }),
    );
    // A new epoch requires an explicit bootstrap projection.
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "old-index",
            type: "git.commit.apply",
            workspaceId: "w",
          },
        ],
      }),
    });
    app.start();
    await flush();
    await clock.advance(1000);
    const intent =
      app.store.getState().operations[operationKey("epoch-a", "old-index")];
    assert.ok(intent);
    assert.equal(intent.lookupOnly, true);
    assert.equal(intent.gitCommitMutation, undefined);
    assert.deepEqual(intent.operation, {
      type: "git.commit.apply",
      workspaceId: "w",
    });
    assert.equal(await app.actions.applyGitCommit(), false);
    const query = calls.find((e) => e.operation.type === "operation.lookup");
    assert.ok(query);
    assert.equal(query.runtimeEpoch, "epoch-b");
    assert.equal(query.operation.runtimeEpoch, "epoch-a");
    assert.equal(
      calls.filter((e) => e.operation.type.startsWith("git.commit.")).length,
      0,
    );
  } finally {
    app.dispose();
  }
});
test("Git commit: untrusted, Native running, permissions and recovery permit no commit preview", async (t) => {
  const changes = {
    permission: {
      permissions: [{ id: "p", action: "read", resource: "file" }],
    },
    untrusted: { workspaces: [{ ...workspace(), trusted: false }] },
    running: { sessions: [session("a", "w", { status: "running" })] },
    unavailable: { sessions: [session("a", "w", { status: "unavailable" })] },
    disconnected: { state: "disconnected" },
    hold: {
      recovery: {
        store: { state: "ready" },
        resources: [
          {
            workspaceId: "w",
            state: "unavailable",
            reason: "unresolved_operation",
          },
        ],
      },
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app, calls } = gitCommitWindow();
      try {
        seed(app.store, snapshot(1, "a", change));
        await app.actions.observeGitReview();
        app.actions.editGitCommit({ ...commitAuthor, message: commitMessage });
        assert.equal(await app.actions.previewGitCommit(), false);
        assert.equal(await app.actions.applyGitCommit(), false);
        assert.equal(
          calls.filter((e) => e.operation.type.startsWith("git.commit."))
            .length,
          0,
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git commit: cancellation and timeout retain physical preview read lane without auto retry", async (t) => {
  for (const action of ["cancel", "timeout", "dispose"])
    await t.test(action, async () => {
      const late = deferred();
      let operation;
      const { app, clock, calls, cancellations } = gitCommitWindow((e) => {
        if (e.operation.type === "git.commit.preview.read") {
          operation = e.operation;
          return late.promise;
        }
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitCommit({ ...commitAuthor, message: commitMessage });
        const read = app.actions.previewGitCommit();
        await flush();
        if (action === "cancel") app.actions.cancelGitCommitPreview();
        else if (action === "timeout") await clock.advance(10000);
        else app.dispose();
        assert.equal(await read, false);
        assert.equal(cancellations.length, 1);
        assert.ok(cancellations[0].readId);
        assert.equal(cancellations[0].operationId, undefined);
        await clock.advance(1000);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.commit.preview.read")
            .length,
          1,
        );
        late.resolve({ ok: true, value: gitCommitPreviewValue(operation) });
        await flush();
        assert.equal(
          selectors.currentGitCommitPreview(app.store.getState()),
          undefined,
        );
        assert.equal(
          calls.filter((e) => e.operation.type === "git.commit.apply").length,
          0,
        );
      } finally {
        late.resolve({ ok: false, code: "UNAVAILABLE" });
        app.dispose();
      }
    });
});

test("Git commit: late preview and retained drafts are inert across scope and ABA changes", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "epoch",
    "globalHold",
    "resourceHold",
    "disconnect",
    "workspaceABA",
    "draftABA",
    "rootABA",
    "refresh",
  ])
    await t.test(change, async () => {
      const late = deferred();
      let operation;
      const { app, calls } = gitCommitWindow((e) => {
        if (e.operation.type === "git.commit.preview.read") {
          operation = e.operation;
          return late.promise;
        }
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitCommit({ ...commitAuthor, message: commitMessage });
        const key = selectors.gitCommitDraftKey(app.store.getState());
        const pending = app.actions.previewGitCommit();
        await flush();
        if (change === "workspaceABA") {
          app.actions.select("other");
          app.actions.select("w", "a");
        } else if (change === "draftABA") {
          app.actions.editGitCommit({ message: "changed" });
          app.actions.editGitCommit({ message: commitMessage });
        } else if (change === "rootABA") {
          changeGitAuthority(app, "root");
          seed(app.store, snapshot());
        } else if (change === "refresh") {
          app.actions.cancelGitCommitPreview();
          await app.actions.observeGitReview();
        } else changeGitAuthority(app, change);
        late.resolve({ ok: true, value: gitCommitPreviewValue(operation) });
        assert.equal(await pending, false);
        assert.equal(await app.actions.applyGitCommit(), false);
        assert.equal(
          calls.some((e) => e.operation.type === "git.commit.apply"),
          false,
        );
        assert.equal(
          app.store.getState().gitCommitDrafts[key].message,
          commitMessage,
        );
        app.actions.selectGitCommitDraft(key);
        app.actions.editGitCommit({ message: "editable retained draft" });
        assert.equal(
          selectors.gitCommitDraft(app.store.getState()).message,
          "editable retained draft",
        );
        assert.equal(selectors.canApplyGitCommit(app.store.getState()), false);
      } finally {
        late.resolve({ ok: false, code: "CANCELLED" });
        app.dispose();
      }
    });
});
test("Git commit: apply rechecks async hash and every actual dispatch subscriber boundary", async (t) => {
  for (const phase of ["hash", "intent", "io", "previewRequest", "previewIO"])
    for (const change of [
      "trust",
      "draft",
      "draftABA",
      "selectionABA",
      "root",
      "epoch",
      "floor",
    ])
      await t.test(phase + ":" + change, async () => {
        const { app, calls } = gitCommitWindow();
        let changed = false,
          unsubscribe = () => {};
        const original = globalThis.crypto.subtle.digest;
        const alter = () => {
          if (changed) return;
          changed = true;
          if (change === "trust") changeGitAuthority(app, "trustedBool");
          if (["root", "epoch", "floor"].includes(change))
            changeGitAuthority(app, change);
          if (change === "draft")
            app.actions.editGitCommit({ name: "Another" });
          if (change === "draftABA") {
            app.actions.editGitCommit({ message: "changed" });
            app.actions.editGitCommit({ message: commitMessage });
          }
          if (change === "selectionABA") {
            app.actions.select("other");
            app.actions.select("w", "a");
          }
        };
        try {
          if (phase.startsWith("preview")) {
            await app.actions.observeGitReview();
            app.actions.editGitCommit({
              ...commitAuthor,
              message: commitMessage,
            });
            unsubscribe = app.store.subscribe((next) => {
              if (
                phase === "previewRequest"
                  ? next.gitCommit.request
                  : next.configurationIO.reads > 0
              )
                alter();
            });
            assert.equal(await app.actions.previewGitCommit(), false);
            assert.equal(
              calls.some((e) => e.operation.type === "git.commit.preview.read"),
              false,
            );
          } else {
            await prepareGitCommit(app);
            if (phase === "hash")
              globalThis.crypto.subtle.digest = async function (...args) {
                alter();
                return original.apply(this, args);
              };
            else
              unsubscribe = app.store.subscribe((next) => {
                if (
                  phase === "intent"
                    ? Object.values(next.operations).some(
                        (i) => i.operation.type === "git.commit.apply",
                      )
                    : Object.keys(next.gitCommitIO).length > 0
                )
                  alter();
              });
            assert.equal(await app.actions.applyGitCommit(), false);
            assert.equal(
              calls.some((e) => e.operation.type === "git.commit.apply"),
              false,
            );
            assert.deepEqual(app.store.getState().gitCommitIO, {});
          }
        } finally {
          globalThis.crypto.subtle.digest = original;
          unsubscribe();
          app.dispose();
        }
      });
});
test("Git commit: forged results and original-key backup substitutions remain unknown", async (t) => {
  const changes = {
    resultCommit: (r) => (r.value.commitOid = "4".repeat(40)),
    resultTree: (r) => (r.value.treeOid = "4".repeat(40)),
    resultRef: (r) => (r.value.referenceDigest = "f".repeat(64)),
    resultLog: (r) => (r.value.logDigests = []),
    resultBackup: (r) => (r.value.backups = []),
    resultId: (r) => (r.value.requestId = "other"),
    digest: (r) => (r.receipt.result.digest = "f".repeat(64)),
    parent: (r) => (r.receipt.result.parentOid = null),
    preview: (r) => (r.receipt.result.previewDigest = "f".repeat(64)),
    nullBackup: (r) => (r.receipt.result.backups[0].backupId = null),
    absentBackup: (r) =>
      (r.receipt.result.backups[1].backupId = `.omoc-git-commit-${"f".repeat(64)}.backup`),
    forgedBackup: (r) =>
      (r.receipt.result.backups[0].backupId = `.omoc-git-commit-${"f".repeat(64)}.backup`),
    order: (r) => r.receipt.result.backups.reverse(),
    logOrder: (r) => r.receipt.result.logDigests.reverse(),
    workspace: (r) => (r.receipt.workspaceId = "other"),
    floor: (r) => (r.receipt.revision = 1),
    epoch: (r) => (r.receipt.runtimeEpoch = "epoch-b"),
    operation: (r) => (r.receipt.operationId = "other"),
    evidence: (r) => (r.receipt.evidence = []),
    unknownConfirmed: (r) =>
      (r.value = { requestId: r.value.requestId, status: "unknown" }),
    extra: (r) => (r.value.rawBody = "private"),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app } = gitCommitWindow((e) => {
        if (e.operation.type !== "git.commit.apply") return;
        const r = globalThis.structuredClone(gitCommitApplied(e));
        change(r);
        return r;
      });
      try {
        await prepareGitCommit(app);
        assert.equal(await app.actions.applyGitCommit(), false);
        const intent = Object.values(app.store.getState().operations).find(
          (i) => i.operation.type === "git.commit.apply",
        );
        assert.equal(intent.status, "unknown");
        assert.equal(intent.lookupOnly, true);
        assert.deepEqual(intent.operation, {
          type: "git.commit.apply",
          workspaceId: "w",
        });
        assert.equal(app.store.getState().revision, 1);
      } finally {
        app.dispose();
      }
    });
});
test("Git commit: available preview expires without IO and copied draft stays editable while held", async () => {
  const { app, clock, calls } = gitCommitWindow();
  try {
    await prepareGitCommit(app);
    const preview = app.store.getState().gitCommit.preview;
    await clock.advance(59999);
    assert.equal(selectors.canApplyGitCommit(app.store.getState()), true);
    await clock.advance(1);
    assert.equal(selectors.canApplyGitCommit(app.store.getState()), false);
    assert.equal(app.store.getState().gitCommit.error, "EXPIRED");
    assert.equal(calls.length, 2);
    changeGitAuthority(app, "resourceHold");
    app.actions.editGitCommit({ name: "Edited", message: "still editable" });
    assert.equal(
      selectors.gitCommitDraft(app.store.getState()).message,
      "still editable",
    );
    assert.equal(app.store.getState().gitCommit.preview, preview);
    assert.equal(await app.actions.previewGitCommit(), false);
  } finally {
    app.dispose();
  }
});
test("Git commit: explicit default-cancel denial preserves original read and user draft", async () => {
  const { app } = gitCommitWindow((e) =>
    e.operation.type === "git.commit.apply"
      ? {
          ok: false,
          code: "CONFIRMATION_DENIED",
          message: "denied",
          receipt: receipt(e, {
            admission: "rejected",
            delivery: "pending",
            effect: "none",
            revision: 1,
            evidence: [],
            result: { kind: "rejected", code: "CONFIRMATION_DENIED" },
          }),
        }
      : undefined,
  );
  try {
    await prepareGitCommit(app);
    assert.equal(await app.actions.applyGitCommit(), false);
    assert.equal(app.store.getState().gitCommit.mutation.status, "denied");
    assert.equal(app.store.getState().revision, 1);
    assert.equal(
      selectors.gitCommitDraft(app.store.getState()).message,
      commitMessage,
    );
    assert.equal(
      selectors.currentGitReviewObservation(app.store.getState()).status,
      "available",
    );
  } finally {
    app.dispose();
  }
});

test("Git commit: production admission digest binds exact original request and expectedRevision", async () => {
  let originalDigest, actualEnvelope;
  const registry = {
    status: () => ({ state: "ready" }),
    begin: async (identity) => {
      originalDigest = identity.digest;
      return {
        status: "admitted",
        receipt: {
          admission: "admitted",
          delivery: "pending",
          effect: "none",
          revision: 1,
          evidence: [],
        },
      };
    },
  };
  const host = createHostAdmission({
    runtimeEpoch: "epoch-a",
    revision: () => 1,
    ready: () => Promise.resolve(),
    registry: () => registry,
    execute: async (operation) => {
      if (operation.type === "git.review.read")
        return { ok: true, value: gitReviewValue() };
      if (operation.type === "git.commit.preview.read")
        return { ok: true, value: gitCommitPreviewValue(operation) };
      assert.equal(operation.type, "git.commit.apply");
      currentScope().markEffect();
      return gitCommitApplied(actualEnvelope);
    },
    projectReceipt: async (record, _operation, _result) => {
      const correlated = gitCommitApplied(actualEnvelope).receipt;
      Object.assign(record, correlated, {
        result: { ...correlated.result, digest: record.digest },
      });
    },
  });
  const clock = fakeClock(),
    app = createWindowWorkbench(
      {
        workbench: (envelope) => {
          if (envelope.operation.type === "git.commit.apply")
            actualEnvelope = envelope;
          return host.handle(envelope, "renderer-test");
        },
        cancelRead: (envelope) =>
          Promise.resolve(host.cancel(envelope, "renderer-test")),
      },
      { clock, id },
    );
  seed(app.store);
  try {
    await prepareGitCommit(app);
    assert.equal(await app.actions.applyGitCommit(), true);
    assert.equal(actualEnvelope.expectedRevision, 1);
    const i = Object.values(app.store.getState().operations).find(
      (i) => i.operation.type === "git.commit.apply",
    );
    assert.equal(i.gitCommitMutation.digest, originalDigest);
    assert.deepEqual(
      i.gitCommitMutation.backups,
      gitCommitApplied(actualEnvelope).receipt.result.backups,
    );
  } finally {
    app.dispose();
  }
});
test("Git commit: SHA256 unborn and detached previews preserve exact closed roles and physical backup presence", async (t) => {
  for (const kind of ["unborn", "detached"])
    await t.test(kind, async () => {
      const head = kind === "unborn" ? null : "1".repeat(64);
      const { app, calls } = gitCommitWindow((e) => {
        if (e.operation.type === "git.review.read")
          return {
            ok: true,
            value: gitReviewValue({
              repository: {
                ...gitReviewValue().repository,
                objectFormat: "sha256",
                head,
                branch: kind === "unborn" ? "main" : null,
              },
              branches: [],
            }),
          };
        if (e.operation.type !== "git.commit.preview.read") return;
        const p = gitCommitPreviewValue(e.operation, {
          objectFormat: "sha256",
          headOid: head,
          treeOid: "2".repeat(64),
          commitOid: "3".repeat(64),
          entries: [
            {
              path: "a.txt",
              before: null,
              after: { mode: 0o100644, oid: "4".repeat(64) },
            },
          ],
        });
        if (kind === "detached") {
          p.reference = {
            kind: "head",
            name: null,
            exists: true,
            digest: "a".repeat(64),
            nextDigest: "b".repeat(64),
          };
          p.logs = p.logs.slice(0, 1);
        }
        return { ok: true, value: p };
      });
      try {
        await prepareGitCommit(app);
        assert.equal(await app.actions.applyGitCommit(), true);
        const e = calls.find((e) => e.operation.type === "git.commit.apply");
        const b = gitCommitApplied(e).receipt.result.backups;
        assert.equal(
          b.at(-1).role,
          kind === "detached" ? "head_ref" : "branch_ref",
        );
        assert.equal(b.at(-1).backupId === null, kind === "unborn");
        assert.equal(e.operation.headOid, head);
      } finally {
        app.dispose();
      }
    });
});
test("Git commit: source response mutation cannot alter stored author message or target", async () => {
  let original;
  const { app } = gitCommitWindow((e) => {
    if (e.operation.type === "git.commit.preview.read") {
      original = gitCommitPreviewValue(e.operation);
      return { ok: true, value: original };
    }
  });
  try {
    await prepareGitCommit(app);
    const preview = app.store.getState().gitCommit.preview;
    original.author.name = "Forged";
    original.canonicalMessage = "Forged\n";
    original.reference.nextDigest = "9".repeat(64);
    original.logs[0].exists = false;
    original.entries.length = 0;
    assert.equal(preview.author.name, commitAuthor.name);
    assert.equal(preview.canonicalMessage, commitMessage);
    assert.equal(preview.reference.nextDigest, "a".repeat(64));
    assert.equal(preview.entries.length, 1);
    assert.equal(await app.actions.applyGitCommit(), true);
  } finally {
    app.dispose();
  }
});
test("Git commit: mount polling refocus selection edits and receipt never start Git IO", async () => {
  const calls = [],
    clock = fakeClock();
  let refocus, visibility;
  const app = createWindowWorkbench(
    {
      workbench: (e) => {
        calls.push(e);
        return Promise.resolve(readFallback(e));
      },
      cancelRead: () => Promise.resolve(),
    },
    {
      clock,
      id,
      onRefocus: (f) => {
        refocus = f;
        return () => {};
      },
      onVisibility: (f) => {
        visibility = f;
        return () => {};
      },
    },
  );
  seed(app.store);
  try {
    app.start();
    await flush();
    refocus();
    visibility();
    await clock.advance(6000);
    app.actions.editGitCommit({ ...commitAuthor, message: commitMessage });
    app.actions.selectGitPath("a.txt");
    app.actions.selectGitMode("staged");
    app.actions.selectGitCommitDraft();
    app.actions.layout({ wide: false });
    await flush();
    assert.equal(
      calls.filter((e) => e.operation.type.startsWith("git.")).length,
      0,
    );
  } finally {
    app.dispose();
  }
});

test("Git commit: retained draft remains editable after its workspace disappears", async () => {
  const { app } = gitCommitWindow();
  try {
    await prepareGitCommit(app);
    const key = selectors.gitCommitDraftKey(app.store.getState());
    const removed = snapshot(1, null, { workspaces: [], sessions: [] });
    delete removed.selectedWorkspaceId;
    app.actions.select();
    seed(app.store, removed);
    assert.equal(app.store.getState().lists.workspaces.length, 0);
    app.actions.selectGitCommitDraft(key);
    app.actions.editGitCommit({ message: "edited after removal" });
    assert.equal(
      selectors.gitCommitDraft(app.store.getState()).message,
      "edited after removal",
    );
    assert.equal(selectors.canApplyGitCommit(app.store.getState()), false);
  } finally {
    app.dispose();
  }
});

test("Git commit: preview must cover all original staged paths and exact original branch target", async (t) => {
  for (const shape of [
    "missingStaged",
    "extraPath",
    "wrongBranch",
    "detachedMismatch",
  ])
    await t.test(shape, async () => {
      const { app, calls } = gitCommitWindow((e) => {
        if (e.operation.type === "git.review.read" && shape === "missingStaged")
          return {
            ok: true,
            value: gitReviewValue({
              files: [
                ...gitReviewValue().files,
                {
                  path: "z.txt",
                  index: "deleted",
                  worktree: "none",
                  kind: "tracked",
                },
              ],
            }),
          };
        if (e.operation.type !== "git.commit.preview.read") return;
        const p = gitCommitPreviewValue(e.operation);
        if (shape === "extraPath") p.entries[0].path = "z.txt";
        if (shape === "wrongBranch") p.reference.name = "refs/heads/other";
        if (shape === "detachedMismatch") {
          p.reference = {
            kind: "head",
            name: null,
            exists: true,
            digest: "a".repeat(64),
            nextDigest: "b".repeat(64),
          };
          p.logs = p.logs.slice(0, 1);
        }
        return { ok: true, value: p };
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitCommit({ ...commitAuthor, message: commitMessage });
        assert.equal(await app.actions.previewGitCommit(), false);
        assert.equal(await app.actions.applyGitCommit(), false);
        assert.equal(
          calls.some((e) => e.operation.type === "git.commit.apply"),
          false,
        );
      } finally {
        app.dispose();
      }
    });
});

test("Git commit: late ACK preserves original identity across root and epoch changes without draft replacement", async (t) => {
  for (const change of ["root", "rootABA", "epoch"])
    await t.test(change, async () => {
      const late = deferred();
      let admitted;
      const { app, calls } = gitCommitWindow((e) => {
        if (e.operation.type === "git.commit.apply") {
          admitted = e;
          return late.promise;
        }
      });
      try {
        await prepareGitCommit(app);
        const oldKey = selectors.gitCommitDraftKey(app.store.getState());
        const pending = app.actions.applyGitCommit();
        for (let n = 0; n < 50 && !admitted; n++)
          await new Promise((r) => setImmediate(r));
        assert.ok(admitted);
        changeGitAuthority(app, change === "rootABA" ? "root" : change);
        if (change === "rootABA") seed(app.store, snapshot());
        app.actions.editGitCommit({
          name: "Edited",
          message: "new current text",
        });
        late.resolve(gitCommitApplied(admitted));
        assert.equal(await pending, true);
        const i =
          app.store.getState().operations[
            operationKey("epoch-a", admitted.operationId)
          ];
        assert.equal(i.gitCommitMutation.epoch, "epoch-a");
        assert.equal(i.gitCommitMutation.workspacePath, "/fixture");
        assert.equal(i.gitCommitMutation.draft.message, commitMessage);
        assert.equal(
          selectors.gitCommitDraft(app.store.getState()).message,
          "new current text",
        );
        assert.equal(
          selectors.currentGitCommitPreview(app.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.currentGitReviewObservation(app.store.getState()),
          undefined,
        );
        assert.equal(app.store.getState().revision, change === "epoch" ? 1 : 2);
        if (change !== "rootABA")
          assert.equal(
            app.store.getState().gitCommitDrafts[oldKey].message,
            commitMessage,
          );
        assert.deepEqual(app.store.getState().gitCommitIO, {});
        assert.equal(
          calls.filter((e) => e.operation.type.startsWith("git.")).length,
          3,
        );
      } finally {
        late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
        app.dispose();
      }
    });
});
test("Git commit: absent reflogs and existing physical branch yield only the original reference backup", async () => {
  const { app, calls } = gitCommitWindow((e) =>
    e.operation.type === "git.commit.preview.read"
      ? {
          ok: true,
          value: gitCommitPreviewValue(e.operation, {
            reference: {
              kind: "branch",
              name: "refs/heads/main",
              exists: true,
              digest: "e".repeat(64),
              nextDigest: "a".repeat(64),
            },
            logs: [],
          }),
        }
      : undefined,
  );
  try {
    await prepareGitCommit(app);
    assert.equal(await app.actions.applyGitCommit(), true);
    const e = calls.find((e) => e.operation.type === "git.commit.apply");
    const r =
      app.store.getState().operations[
        operationKey(e.runtimeEpoch, e.operationId)
      ].receipt.result;
    assert.deepEqual(r.logDigests, []);
    assert.deepEqual(r.backups, [
      {
        role: "branch_ref",
        backupId: `.omoc-git-commit-${createHash("sha256")
          .update(JSON.stringify([e.runtimeEpoch, e.operationId, "branch_ref"]))
          .digest("hex")}.backup`,
      },
    ]);
  } finally {
    app.dispose();
  }
});

// Renderer-only synthetic branch/restore contract. No Git/native publisher runs.
function branchRestorePreview(operation, extra = {}) {
  const action = operation.action ?? "restore";
  return {
    runtimeEpoch: "epoch-a",
    revision: 1,
    workspaceId: "w",
    workspacePath: "/fixture",
    status: "available",
    previewId: "c".repeat(64),
    previewDigest: "d".repeat(64),
    occupancyDigest: "f".repeat(64),
    objectFormat: "sha1",
    action,
    branch: operation.branch ?? null,
    source: operation.source ?? null,
    currentBranch: "refs/heads/main",
    headOid: "1".repeat(40),
    nextHeadOid: action === "select" ? "2".repeat(40) : "1".repeat(40),
    treeOid: "3".repeat(40),
    headDigest: "a".repeat(64),
    indexExists: true,
    indexDigest: "b".repeat(64),
    identityDigest: action === "restore" ? null : "e".repeat(64),
    timestamp: action === "restore" ? null : 1234567890,
    author: operation.author ?? null,
    paths:
      action === "create"
        ? []
        : [
            {
              path: "a.txt",
              before: { bytes: 3, digest: "4".repeat(64), mode: 0o644 },
              after: { bytes: 4, digest: "5".repeat(64), mode: 0o644 },
              beforeEntry: { mode: 0o100644, oid: "6".repeat(40) },
              afterEntry: { mode: 0o100644, oid: "6".repeat(40) },
              ident: false,
            },
          ],
    metadata:
      action === "restore"
        ? []
        : action === "create"
          ? [
              {
                role: "branch_ref",
                before: null,
                after: { bytes: 41, digest: "7".repeat(64) },
              },
            ]
          : [
              {
                role: "index",
                before: { bytes: 100, digest: "b".repeat(64) },
                after: { bytes: 100, digest: "8".repeat(64) },
              },
              {
                role: "head_ref",
                before: { bytes: 21, digest: "a".repeat(64) },
                after: { bytes: 22, digest: "9".repeat(64) },
              },
            ],
    ...extra,
  };
}
function branchRestoreApplied(e) {
  const o = e.operation;
  const backups = [
    ...o.paths.map((x) => ({
      role: "worktree",
      path: x.path,
      exists: x.before !== null,
    })),
    ...o.metadata.map((x) => ({
      role: x.role,
      path: null,
      exists: x.before !== null,
    })),
  ].map((x) => ({
    role: x.role,
    path: x.path,
    backupId: x.exists
      ? `.omoc-git-branch-restore-${createHash("sha256")
          .update(
            JSON.stringify([e.runtimeEpoch, e.operationId, x.role, x.path]),
          )
          .digest("hex")}.backup`
      : null,
  }));
  const admitted = { ...o, expectedRevision: e.expectedRevision };
  const digest = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(admitted)
          .sort()
          .map((k) => [k, admitted[k]]),
      ),
    )
    .digest("hex");
  const completed = {
    action: o.action,
    previewDigest: o.previewDigest,
    paths: o.paths.map((x) => ({ path: x.path, after: x.after })),
    metadata: o.metadata.map((x) => ({ role: x.role, digest: x.after.digest })),
    backups,
  };
  return {
    ok: true,
    value: { requestId: e.operationId, status: "applied", ...completed },
    receipt: receipt(e, {
      evidence: [{ kind: "host-registry", id: o.workspaceId }],
      result: {
        kind: "git_branch_restore_applied",
        workspaceId: o.workspaceId,
        ...completed,
        digest,
      },
    }),
  };
}
function branchRestoreWindow(handler) {
  return gitWindow(
    (e) =>
      handler?.(e) ??
      (e.operation.type === "git.review.read"
        ? { ok: true, value: gitReviewValue() }
        : ["git.branch.preview.read", "git.restore.preview.read"].includes(
              e.operation.type,
            )
          ? { ok: true, value: branchRestorePreview(e.operation) }
          : ["git.branch.apply", "git.restore.apply"].includes(e.operation.type)
            ? branchRestoreApplied(e)
            : readFallback(e)),
  );
}
async function prepareBranchRestore(app, action = "create", source = "") {
  assert.equal(await app.actions.observeGitReview(), true);
  app.actions.editGitBranchRestore({
    action,
    branch: action === "select" ? "refs/heads/base" : "refs/heads/next",
    ...commitAuthor,
    source,
    paths: action === "restore" ? ["a.txt"] : [],
  });
  assert.equal(await app.actions.previewGitBranchRestore(), true);
}
test("Git branch restore: explicit create/select/INDEX/HEAD apply and retire observation", async (t) => {
  for (const [action, source] of [
    ["create", ""],
    ["select", ""],
    ["restore", "index"],
    ["restore", "head"],
  ])
    await t.test(`${action}/${source}`, async () => {
      const { app, calls } = branchRestoreWindow();
      try {
        assert.equal(await app.actions.previewGitBranchRestore(), false);
        await prepareBranchRestore(app, action, source);
        assert.equal(await app.actions.applyGitBranchRestore(), true);
        const e = calls.find((e) =>
          ["git.branch.apply", "git.restore.apply"].includes(e.operation.type),
        );
        assert.equal(e.operation.action, action);
        assert.equal(e.expectedRevision, 1);
        assert.equal("author" in e.operation, false);
        if (action === "restore") {
          assert.equal(e.operation.source, source);
          assert.equal("author" in calls[1].operation, false);
        }
        assert.equal(
          app.store.getState().gitBranchRestore.mutation.status,
          "applied",
        );
        assert.equal(app.store.getState().revision, 2);
        assert.equal(
          selectors.currentGitReviewObservation(app.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.currentGitBranchRestorePreview(app.store.getState()),
          undefined,
        );
        assert.equal(calls.length, 3);
      } finally {
        app.dispose();
      }
    });
});

test("Git branch restore: actual IO in old epoch keeps original lookup key and permits independent workspace review", async () => {
  const late = deferred();
  let admitted;
  const { app, clock, calls } = branchRestoreWindow((e) => {
    if (e.operation.type === "git.branch.apply") {
      admitted = e;
      return late.promise;
    }
    if (
      e.operation.type === "git.review.read" &&
      e.operation.workspaceId === "other"
    )
      return {
        ok: true,
        value: gitReviewValue({
          runtimeEpoch: "epoch-b",
          workspaceId: "other",
          workspacePath: "/other",
          repository: {
            ...gitReviewValue().repository,
            worktreePath: "/other",
            gitDirectory: "/other/.git",
            commonDirectory: "/other/.git",
          },
        }),
      };
  });
  try {
    await prepareBranchRestore(app);
    const pending = app.actions.applyGitBranchRestore();
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "oa", {
        runtimeEpoch: "epoch-b",
        selectedWorkspaceId: "other",
        workspaces: [workspace(), { ...workspace("other"), path: "/other" }],
        sessions: [session("a"), session("oa", "other")],
      }),
    });
    assert.equal(await app.actions.observeGitReview(), true);
    assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(app.store.getState()), true);
    assert.equal(
      resourceMutationDisabled(app.store.getState(), "other"),
      false,
    );
    await clock.advance(10000);
    assert.equal(await pending, false);
    await flush();
    const query = calls.find((e) => e.operation.type === "operation.lookup");
    assert.equal(query.runtimeEpoch, "epoch-b");
    assert.equal(query.operation.runtimeEpoch, "epoch-a");
    assert.equal(query.operation.operationId, admitted.operationId);
    assert.equal(app.store.getState().selection.workspaceId, "other");
    assert.equal(
      app.store.getState().gitBranchRestore.mutation.identity.workspaceId,
      "w",
    );
    app.actions.draft("other workspace text");
    late.resolve(branchRestoreApplied(admitted));
    await flush();
    assert.equal(
      calls.filter((e) => e.operation.type === "git.branch.apply").length,
      1,
    );
    assert.equal(
      selectors.draft(app.store.getState()).text,
      "other workspace text",
    );
    assert.equal(app.store.getState().selection.workspaceId, "other");
    assert.deepEqual(app.store.getState().gitBranchRestoreIO, {});
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});
test("Git branch restore: reopened retained original key is lookup only and never restores mutation payload", async () => {
  const { app, clock, calls } = branchRestoreWindow();
  try {
    seed(
      app.store,
      snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "old-index",
            type: "git.branch.apply",
            workspaceId: "w",
          },
        ],
      }),
    );
    // A new epoch requires an explicit bootstrap projection.
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "old-index",
            type: "git.branch.apply",
            workspaceId: "w",
          },
        ],
      }),
    });
    app.start();
    await flush();
    await clock.advance(1000);
    const intent =
      app.store.getState().operations[operationKey("epoch-a", "old-index")];
    assert.ok(intent);
    assert.equal(intent.lookupOnly, true);
    assert.equal(intent.gitBranchRestoreMutation, undefined);
    assert.deepEqual(intent.operation, {
      type: "git.branch.apply",
      workspaceId: "w",
    });
    assert.equal(await app.actions.applyGitBranchRestore(), false);
    const query = calls.find((e) => e.operation.type === "operation.lookup");
    assert.ok(query);
    assert.equal(query.runtimeEpoch, "epoch-b");
    assert.equal(query.operation.runtimeEpoch, "epoch-a");
    assert.equal(
      calls.filter((e) => e.operation.type.startsWith("git.branch.")).length,
      0,
    );
  } finally {
    app.dispose();
  }
});
test("Git branch restore: untrusted, Native running, permissions and recovery permit no commit preview", async (t) => {
  const changes = {
    permission: {
      permissions: [{ id: "p", action: "read", resource: "file" }],
    },
    untrusted: { workspaces: [{ ...workspace(), trusted: false }] },
    running: { sessions: [session("a", "w", { status: "running" })] },
    unavailable: { sessions: [session("a", "w", { status: "unavailable" })] },
    disconnected: { state: "disconnected" },
    hold: {
      recovery: {
        store: { state: "ready" },
        resources: [
          {
            workspaceId: "w",
            state: "unavailable",
            reason: "unresolved_operation",
          },
        ],
      },
    },
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app, calls } = branchRestoreWindow();
      try {
        seed(app.store, snapshot(1, "a", change));
        await app.actions.observeGitReview();
        app.actions.editGitBranchRestore({
          ...commitAuthor,
          branch: "refs/heads/next",
        });
        assert.equal(await app.actions.previewGitBranchRestore(), false);
        assert.equal(await app.actions.applyGitBranchRestore(), false);
        assert.equal(
          calls.filter((e) => e.operation.type.startsWith("git.branch."))
            .length,
          0,
        );
      } finally {
        app.dispose();
      }
    });
});
test("Git branch restore: cancellation and timeout retain physical preview read lane without auto retry", async (t) => {
  for (const action of ["cancel", "timeout", "dispose"])
    await t.test(action, async () => {
      const late = deferred();
      let operation;
      const { app, clock, calls, cancellations } = branchRestoreWindow((e) => {
        if (e.operation.type === "git.branch.preview.read") {
          operation = e.operation;
          return late.promise;
        }
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitBranchRestore({
          ...commitAuthor,
          branch: "refs/heads/next",
        });
        const read = app.actions.previewGitBranchRestore();
        await flush();
        if (action === "cancel") app.actions.cancelGitBranchRestorePreview();
        else if (action === "timeout") await clock.advance(10000);
        else app.dispose();
        assert.equal(await read, false);
        assert.equal(cancellations.length, 1);
        assert.ok(cancellations[0].readId);
        assert.equal(cancellations[0].operationId, undefined);
        await clock.advance(1000);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.branch.preview.read")
            .length,
          1,
        );
        late.resolve({ ok: true, value: branchRestorePreview(operation) });
        await flush();
        assert.equal(
          selectors.currentGitBranchRestorePreview(app.store.getState()),
          undefined,
        );
        assert.equal(
          calls.filter((e) => e.operation.type === "git.branch.apply").length,
          0,
        );
      } finally {
        late.resolve({ ok: false, code: "UNAVAILABLE" });
        app.dispose();
      }
    });
});

test("Git branch restore: late preview and retained drafts are inert across scope and ABA changes", async (t) => {
  for (const change of [
    "root",
    "trustRevision",
    "trustedBool",
    "floor",
    "epoch",
    "globalHold",
    "resourceHold",
    "disconnect",
    "workspaceABA",
    "draftABA",
    "rootABA",
    "refresh",
  ])
    await t.test(change, async () => {
      const late = deferred();
      let operation;
      const { app, calls } = branchRestoreWindow((e) => {
        if (e.operation.type === "git.branch.preview.read") {
          operation = e.operation;
          return late.promise;
        }
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitBranchRestore({
          ...commitAuthor,
          branch: "refs/heads/next",
        });
        const key = selectors.selectedGitBranchRestoreDraftKey(
          app.store.getState(),
        );
        const pending = app.actions.previewGitBranchRestore();
        await flush();
        if (change === "workspaceABA") {
          app.actions.select("other");
          app.actions.select("w", "a");
        } else if (change === "draftABA") {
          app.actions.editGitBranchRestore({ branch: "refs/heads/changed" });
          app.actions.editGitBranchRestore({ branch: "refs/heads/next" });
        } else if (change === "rootABA") {
          changeGitAuthority(app, "root");
          seed(app.store, snapshot());
        } else if (change === "refresh") {
          app.actions.cancelGitBranchRestorePreview();
          await app.actions.observeGitReview();
        } else changeGitAuthority(app, change);
        late.resolve({ ok: true, value: branchRestorePreview(operation) });
        assert.equal(await pending, false);
        assert.equal(await app.actions.applyGitBranchRestore(), false);
        assert.equal(
          calls.some((e) => e.operation.type === "git.branch.apply"),
          false,
        );
        assert.equal(
          app.store.getState().gitBranchRestoreDrafts[key].branch,
          "refs/heads/next",
        );
        app.actions.selectGitBranchRestoreDraft(key);
        app.actions.editGitBranchRestore({ branch: "refs/heads/editable" });
        assert.equal(
          selectors.gitBranchRestoreDraft(app.store.getState()).branch,
          "refs/heads/editable",
        );
        assert.equal(
          selectors.canApplyGitBranchRestore(app.store.getState()),
          false,
        );
      } finally {
        late.resolve({ ok: false, code: "CANCELLED" });
        app.dispose();
      }
    });
});
test("Git branch restore: apply rechecks async hash and every actual dispatch subscriber boundary", async (t) => {
  for (const phase of ["hash", "intent", "io", "previewRequest", "previewIO"])
    for (const change of [
      "trust",
      "draft",
      "draftABA",
      "selectionABA",
      "root",
      "epoch",
      "floor",
    ])
      await t.test(phase + ":" + change, async () => {
        const { app, calls } = branchRestoreWindow();
        let changed = false,
          unsubscribe = () => {};
        const original = globalThis.crypto.subtle.digest;
        const alter = () => {
          if (changed) return;
          changed = true;
          if (change === "trust") changeGitAuthority(app, "trustedBool");
          if (["root", "epoch", "floor"].includes(change))
            changeGitAuthority(app, change);
          if (change === "draft")
            app.actions.editGitBranchRestore({ name: "Another" });
          if (change === "draftABA") {
            app.actions.editGitBranchRestore({ branch: "refs/heads/changed" });
            app.actions.editGitBranchRestore({ branch: "refs/heads/next" });
          }
          if (change === "selectionABA") {
            app.actions.select("other");
            app.actions.select("w", "a");
          }
        };
        try {
          if (phase.startsWith("preview")) {
            await app.actions.observeGitReview();
            app.actions.editGitBranchRestore({
              ...commitAuthor,
              branch: "refs/heads/next",
            });
            unsubscribe = app.store.subscribe((next) => {
              if (
                phase === "previewRequest"
                  ? next.gitBranchRestore.request
                  : next.configurationIO.reads > 0
              )
                alter();
            });
            assert.equal(await app.actions.previewGitBranchRestore(), false);
            assert.equal(
              calls.some((e) => e.operation.type === "git.branch.preview.read"),
              false,
            );
          } else {
            await prepareBranchRestore(app);
            if (phase === "hash")
              globalThis.crypto.subtle.digest = async function (...args) {
                alter();
                return original.apply(this, args);
              };
            else
              unsubscribe = app.store.subscribe((next) => {
                if (
                  phase === "intent"
                    ? Object.values(next.operations).some(
                        (i) => i.operation.type === "git.branch.apply",
                      )
                    : Object.keys(next.gitBranchRestoreIO).length > 0
                )
                  alter();
              });
            assert.equal(await app.actions.applyGitBranchRestore(), false);
            assert.equal(
              calls.some((e) => e.operation.type === "git.branch.apply"),
              false,
            );
            assert.deepEqual(app.store.getState().gitBranchRestoreIO, {});
          }
        } finally {
          globalThis.crypto.subtle.digest = original;
          unsubscribe();
          app.dispose();
        }
      });
});
test("Git branch restore: available preview expires without IO and copied draft stays editable while held", async () => {
  const { app, clock, calls } = branchRestoreWindow();
  try {
    await prepareBranchRestore(app);
    const preview = app.store.getState().gitBranchRestore.preview;
    await clock.advance(59999);
    assert.equal(
      selectors.canApplyGitBranchRestore(app.store.getState()),
      true,
    );
    await clock.advance(1);
    assert.equal(
      selectors.canApplyGitBranchRestore(app.store.getState()),
      false,
    );
    assert.equal(app.store.getState().gitBranchRestore.error, "EXPIRED");
    assert.equal(calls.length, 2);
    changeGitAuthority(app, "resourceHold");
    app.actions.editGitBranchRestore({
      name: "Edited",
      branch: "refs/heads/editable",
    });
    assert.equal(
      selectors.gitBranchRestoreDraft(app.store.getState()).branch,
      "refs/heads/editable",
    );
    assert.equal(app.store.getState().gitBranchRestore.preview, preview);
    assert.equal(await app.actions.previewGitBranchRestore(), false);
  } finally {
    app.dispose();
  }
});
test("Git branch restore: explicit default-cancel denial preserves original read and user draft", async () => {
  const { app } = branchRestoreWindow((e) =>
    e.operation.type === "git.branch.apply"
      ? {
          ok: false,
          code: "CONFIRMATION_DENIED",
          message: "denied",
          receipt: receipt(e, {
            admission: "rejected",
            delivery: "pending",
            effect: "none",
            revision: 1,
            evidence: [],
            result: { kind: "rejected", code: "CONFIRMATION_DENIED" },
          }),
        }
      : undefined,
  );
  try {
    await prepareBranchRestore(app);
    assert.equal(await app.actions.applyGitBranchRestore(), false);
    assert.equal(
      app.store.getState().gitBranchRestore.mutation.status,
      "denied",
    );
    assert.equal(app.store.getState().revision, 1);
    assert.equal(
      selectors.gitBranchRestoreDraft(app.store.getState()).branch,
      "refs/heads/next",
    );
    assert.equal(
      selectors.currentGitReviewObservation(app.store.getState()).status,
      "available",
    );
  } finally {
    app.dispose();
  }
});

test("Git branch restore: production admission digest binds exact original request and expectedRevision", async () => {
  let originalDigest, actualEnvelope;
  const registry = {
    status: () => ({ state: "ready" }),
    begin: async (identity) => {
      originalDigest = identity.digest;
      return {
        status: "admitted",
        receipt: {
          admission: "admitted",
          delivery: "pending",
          effect: "none",
          revision: 1,
          evidence: [],
        },
      };
    },
  };
  const host = createHostAdmission({
    runtimeEpoch: "epoch-a",
    revision: () => 1,
    ready: () => Promise.resolve(),
    registry: () => registry,
    execute: async (operation) => {
      if (operation.type === "git.review.read")
        return { ok: true, value: gitReviewValue() };
      if (operation.type === "git.branch.preview.read")
        return { ok: true, value: branchRestorePreview(operation) };
      assert.equal(operation.type, "git.branch.apply");
      currentScope().markEffect();
      return branchRestoreApplied(actualEnvelope);
    },
    projectReceipt: async (record, _operation, _result) => {
      const correlated = branchRestoreApplied(actualEnvelope).receipt;
      Object.assign(record, correlated, {
        result: { ...correlated.result, digest: record.digest },
      });
    },
  });
  const clock = fakeClock(),
    app = createWindowWorkbench(
      {
        workbench: (envelope) => {
          if (envelope.operation.type === "git.branch.apply")
            actualEnvelope = envelope;
          return host.handle(envelope, "renderer-test");
        },
        cancelRead: (envelope) =>
          Promise.resolve(host.cancel(envelope, "renderer-test")),
      },
      { clock, id },
    );
  seed(app.store);
  try {
    await prepareBranchRestore(app);
    assert.equal(await app.actions.applyGitBranchRestore(), true);
    assert.equal(actualEnvelope.expectedRevision, 1);
    const i = Object.values(app.store.getState().operations).find(
      (i) => i.operation.type === "git.branch.apply",
    );
    assert.equal(i.gitBranchRestoreMutation.digest, originalDigest);
    assert.deepEqual(
      i.gitBranchRestoreMutation.backups,
      branchRestoreApplied(actualEnvelope).receipt.result.backups,
    );
  } finally {
    app.dispose();
  }
});
test("Git branch restore: mount polling refocus selection edits and receipt never start Git IO", async () => {
  const calls = [],
    clock = fakeClock();
  let refocus, visibility;
  const app = createWindowWorkbench(
    {
      workbench: (e) => {
        calls.push(e);
        return Promise.resolve(readFallback(e));
      },
      cancelRead: () => Promise.resolve(),
    },
    {
      clock,
      id,
      onRefocus: (f) => {
        refocus = f;
        return () => {};
      },
      onVisibility: (f) => {
        visibility = f;
        return () => {};
      },
    },
  );
  seed(app.store);
  try {
    app.start();
    await flush();
    refocus();
    visibility();
    await clock.advance(6000);
    app.actions.editGitBranchRestore({
      ...commitAuthor,
      branch: "refs/heads/next",
    });
    app.actions.selectGitPath("a.txt");
    app.actions.selectGitMode("staged");
    app.actions.selectGitBranchRestoreDraft();
    app.actions.layout({ wide: false });
    await flush();
    assert.equal(
      calls.filter((e) => e.operation.type.startsWith("git.")).length,
      0,
    );
  } finally {
    app.dispose();
  }
});

test("Git branch restore: retained draft remains editable after its workspace disappears", async () => {
  const { app } = branchRestoreWindow();
  try {
    await prepareBranchRestore(app);
    const key = selectors.selectedGitBranchRestoreDraftKey(
      app.store.getState(),
    );
    const removed = snapshot(1, null, { workspaces: [], sessions: [] });
    delete removed.selectedWorkspaceId;
    app.actions.select();
    seed(app.store, removed);
    assert.equal(app.store.getState().lists.workspaces.length, 0);
    app.actions.selectGitBranchRestoreDraft(key);
    app.actions.editGitBranchRestore({ branch: "refs/heads/removed" });
    assert.equal(
      selectors.gitBranchRestoreDraft(app.store.getState()).branch,
      "refs/heads/removed",
    );
    assert.equal(
      selectors.canApplyGitBranchRestore(app.store.getState()),
      false,
    );
  } finally {
    app.dispose();
  }
});

test("Git branch restore: timeout and lookup confirmation keep actual IO hold until original finally", async () => {
  const late = deferred();
  let admitted;
  const { app, clock, calls } = branchRestoreWindow((e) => {
    if (e.operation.type === "git.branch.apply") {
      admitted = e;
      return late.promise;
    }
    if (e.operation.type === "operation.lookup")
      return {
        ok: true,
        value: {
          status: "found",
          runtimeEpoch: admitted.runtimeEpoch,
          operationId: admitted.operationId,
          receipt: branchRestoreApplied(admitted).receipt,
        },
      };
  });
  try {
    await prepareBranchRestore(app);
    const apply = app.actions.applyGitBranchRestore();
    await flush();
    // SHA256 uses actual WebCrypto completion; wait only for the owned dispatch.
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    await clock.advance(10000);
    assert.equal(await apply, false);
    await flush();
    const key = operationKey(admitted.runtimeEpoch, admitted.operationId);
    assert.equal(app.store.getState().operations[key].status, "accepted");
    assert.equal(app.store.getState().gitBranchRestoreIO[key], "w");
    assert.equal(resourceMutationDisabled(app.store.getState(), "w"), true);
    assert.equal(resourceMutationDisabled(app.store.getState()), true);
    seed(app.store, snapshot(2));
    assert.equal(await app.actions.observeGitReview(), false);
    late.resolve(branchRestoreApplied(admitted));
    await flush();
    assert.deepEqual(app.store.getState().gitBranchRestoreIO, {});
    assert.equal(
      calls.filter((e) => e.operation.type === "git.branch.apply").length,
      1,
    );
    assert.equal(
      selectors.currentGitBranchRestorePreview(app.store.getState()),
      undefined,
    );
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});

test("Git branch restore: forged result receipt backups and source authority never become applied", async (t) => {
  const changes = {
    resultAction: (r) => (r.value.action = "create"),
    resultPreview: (r) => (r.value.previewDigest = "0".repeat(64)),
    resultPaths: (r) => (r.value.paths = []),
    resultMode: (r) => (r.value.paths[0].after.mode = 0o755),
    resultMetadata: (r) =>
      (r.value.metadata = [{ role: "head_ref", digest: "0".repeat(64) }]),
    resultBackup: (r) => (r.value.backups = []),
    resultId: (r) => (r.value.requestId = "other"),
    digest: (r) => (r.receipt.result.digest = "0".repeat(64)),
    preview: (r) => (r.receipt.result.previewDigest = "0".repeat(64)),
    nullBackup: (r) => (r.receipt.result.backups[0].backupId = null),
    forgedBackup: (r) =>
      (r.receipt.result.backups[0].backupId = `.omoc-git-branch-restore-${"0".repeat(64)}.backup`),
    backupPath: (r) => (r.receipt.result.backups[0].path = "other.txt"),
    receiptMode: (r) => (r.receipt.result.paths[0].after.mode = 0o755),
    workspace: (r) => (r.receipt.workspaceId = "other"),
    floor: (r) => (r.receipt.revision = 1),
    epoch: (r) => (r.receipt.runtimeEpoch = "epoch-b"),
    operation: (r) => (r.receipt.operationId = "other"),
    evidence: (r) => (r.receipt.evidence = []),
    unknownConfirmed: (r) =>
      (r.value = { requestId: r.value.requestId, status: "unknown" }),
    extra: (r) => (r.value.rawBody = "private"),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app, calls } = branchRestoreWindow((e) => {
        if (e.operation.type !== "git.restore.apply") return;
        const r = globalThis.structuredClone(branchRestoreApplied(e));
        change(r);
        return r;
      });
      try {
        await prepareBranchRestore(app, "restore", "head");
        assert.equal(await app.actions.applyGitBranchRestore(), false);
        const intent = Object.values(app.store.getState().operations).find(
          (i) => i.operation.type === "git.restore.apply",
        );
        assert.equal(intent.status, "unknown");
        assert.equal(intent.lookupOnly, true);
        assert.deepEqual(intent.operation, {
          type: "git.restore.apply",
          workspaceId: "w",
        });
        assert.equal(app.store.getState().revision, 1);
        assert.equal(await app.actions.applyGitBranchRestore(), false);
        assert.equal(
          calls.filter((e) => e.operation.type === "git.restore.apply").length,
          1,
        );
      } finally {
        app.dispose();
      }
    });
});

test("Git branch restore: preview correlates exact action branch identity source paths floor and root", async (t) => {
  const changes = {
    action: (p) => (p.action = "select"),
    source: (p) => (p.source = "index"),
    paths: (p) => (p.paths[0].path = "other.txt"),
    head: (p) => (p.headOid = "9".repeat(40)),
    branch: (p) => (p.currentBranch = "refs/heads/other"),
    root: (p) => (p.workspacePath = "/other"),
    epoch: (p) => (p.runtimeEpoch = "epoch-b"),
    floor: (p) => (p.revision = 2),
    extra: (p) => (p.body = "private"),
  };
  for (const [name, change] of Object.entries(changes))
    await t.test(name, async () => {
      const { app, calls } = branchRestoreWindow((e) => {
        if (e.operation.type !== "git.restore.preview.read") return;
        const p = branchRestorePreview(e.operation);
        change(p);
        return { ok: true, value: p };
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitBranchRestore({
          action: "restore",
          source: "head",
          paths: ["a.txt"],
        });
        assert.equal(await app.actions.previewGitBranchRestore(), false);
        assert.equal(await app.actions.applyGitBranchRestore(), false);
        assert.equal(
          calls.some((e) => e.operation.type.endsWith(".apply")),
          false,
        );
      } finally {
        app.dispose();
      }
    });
  for (const field of ["branch", "author", "targetOid"])
    await t.test(field, async () => {
      const { app } = branchRestoreWindow((e) => {
        if (e.operation.type !== "git.branch.preview.read") return;
        const p = branchRestorePreview(e.operation);
        if (field === "branch") p.branch = "refs/heads/other";
        if (field === "author") p.author = { ...commitAuthor, name: "Forged" };
        if (field === "targetOid") p.nextHeadOid = "9".repeat(40);
        return { ok: true, value: p };
      });
      try {
        await app.actions.observeGitReview();
        app.actions.editGitBranchRestore({
          action: "select",
          branch: "refs/heads/base",
          ...commitAuthor,
        });
        assert.equal(await app.actions.previewGitBranchRestore(), false);
        assert.equal(await app.actions.applyGitBranchRestore(), false);
      } finally {
        app.dispose();
      }
    });
});

test("Git branch restore: source branch identity and path ABA invalidate available previews while retaining drafts", async (t) => {
  for (const field of ["source", "paths", "branch", "name", "email", "action"])
    await t.test(field, async () => {
      const { app, calls } = branchRestoreWindow();
      try {
        await prepareBranchRestore(app, "restore", "head");
        const original = selectors.gitBranchRestoreDraft(app.store.getState());
        const edits = {
          source: "index",
          paths: ["other.txt"],
          branch: "refs/heads/other",
          name: "Other",
          email: "other@example.invalid",
          action: "create",
        };
        app.actions.editGitBranchRestore({ [field]: edits[field] });
        app.actions.editGitBranchRestore({ [field]: original[field] });
        assert.equal(
          selectors.currentGitBranchRestorePreview(app.store.getState()),
          undefined,
        );
        assert.equal(await app.actions.applyGitBranchRestore(), false);
        assert.equal(calls.length, 2);
        assert.deepEqual(
          selectors.gitBranchRestoreDraft(app.store.getState())[field],
          original[field],
        );
      } finally {
        app.dispose();
      }
    });
});

test("Git branch restore: absent restore source never defaults and explicit deletion creation and modes preserve nullable backups", async (t) => {
  const { app, calls } = branchRestoreWindow();
  try {
    await app.actions.observeGitReview();
    app.actions.editGitBranchRestore({ action: "restore", paths: ["a.txt"] });
    assert.equal(await app.actions.previewGitBranchRestore(), false);
    assert.equal(calls.length, 1);
  } finally {
    app.dispose();
  }
  for (const shape of ["delete", "create", "mode"])
    await t.test(shape, async () => {
      const { app, calls } = branchRestoreWindow((e) => {
        if (e.operation.type !== "git.restore.preview.read") return;
        const p = branchRestorePreview(e.operation),
          x = p.paths[0];
        if (shape === "delete") {
          x.after = null;
          x.afterEntry = null;
        }
        if (shape === "create") x.before = null;
        if (shape === "mode") {
          x.after.mode = 0o755;
          x.afterEntry.mode = 0o100755;
        }
        if (shape === "create") x.after.mode = 0o600;
        return { ok: true, value: p };
      });
      try {
        await prepareBranchRestore(app, "restore", "head");
        assert.equal(await app.actions.applyGitBranchRestore(), true);
        const e = calls.find((e) => e.operation.type === "git.restore.apply");
        assert.equal(e.operation.paths[0].after === null, shape === "delete");
        assert.equal(
          app.store.getState().gitBranchRestore.mutation.identity.backups[0]
            .backupId === null,
          shape === "create",
        );
      } finally {
        app.dispose();
      }
    });
});

test("Git branch restore: source response and caller path arrays cannot alter stored preview or draft", async () => {
  let original;
  const { app } = branchRestoreWindow((e) => {
    if (e.operation.type === "git.restore.preview.read") {
      original = branchRestorePreview(e.operation);
      return { ok: true, value: original };
    }
  });
  try {
    await app.actions.observeGitReview();
    const paths = ["a.txt"];
    app.actions.editGitBranchRestore({
      action: "restore",
      source: "head",
      paths,
    });
    paths.push("injected.txt");
    assert.equal(await app.actions.previewGitBranchRestore(), true);
    const preview = app.store.getState().gitBranchRestore.preview;
    original.paths[0].after.digest = "0".repeat(64);
    original.paths.push({ ...original.paths[0], path: "injected.txt" });
    assert.equal(preview.paths[0].after.digest, "5".repeat(64));
    assert.equal(preview.paths.length, 1);
    assert.equal(await app.actions.applyGitBranchRestore(), true);
  } finally {
    app.dispose();
  }
});

test("Git branch restore: canonical UTF8 selected paths retain unchanged selections while target includes only effects", async () => {
  const { app, calls } = branchRestoreWindow();
  try {
    await app.actions.observeGitReview();
    const paths = ["한글.txt", "a.txt", "unchanged.txt", "a.txt"];
    app.actions.editGitBranchRestore({
      action: "restore",
      source: "head",
      paths,
    });
    assert.equal(await app.actions.previewGitBranchRestore(), true);
    assert.deepEqual(calls[1].operation.paths, [
      "a.txt",
      "unchanged.txt",
      "한글.txt",
    ]);
    assert.deepEqual(
      app.store.getState().gitBranchRestore.previewPaths,
      calls[1].operation.paths,
    );
    assert.deepEqual(
      selectors.gitBranchRestoreDraft(app.store.getState()).paths,
      paths,
    );
    assert.equal(await app.actions.applyGitBranchRestore(), true);
    assert.deepEqual(
      calls[2].operation.paths.map((p) => p.path),
      ["a.txt"],
    );
  } finally {
    app.dispose();
  }
});

test("Git branch restore: late restore ACK preserves original draft and exact request across new root", async () => {
  const late = deferred();
  let admitted;
  const { app, calls } = branchRestoreWindow((e) => {
    if (e.operation.type === "git.restore.apply") {
      admitted = e;
      return late.promise;
    }
  });
  try {
    await prepareBranchRestore(app, "restore", "head");
    const oldKey = selectors.selectedGitBranchRestoreDraftKey(
      app.store.getState(),
    );
    const apply = app.actions.applyGitBranchRestore();
    for (let n = 0; n < 50 && !admitted; n++)
      await new Promise((r) => setImmediate(r));
    assert.ok(admitted);
    changeGitAuthority(app, "root");
    app.actions.editGitBranchRestore({
      action: "restore",
      source: "index",
      paths: ["other.txt"],
    });
    late.resolve(branchRestoreApplied(admitted));
    await apply;
    assert.deepEqual(
      selectors.gitBranchRestoreDraft(app.store.getState()).paths,
      ["other.txt"],
    );
    assert.deepEqual(
      app.store.getState().gitBranchRestoreDrafts[oldKey].paths,
      ["a.txt"],
    );
    assert.equal(
      selectors.currentGitBranchRestorePreview(app.store.getState()),
      undefined,
    );
    assert.equal(
      selectors.currentGitReviewObservation(app.store.getState()),
      undefined,
    );
    assert.equal(
      app.store.getState().gitBranchRestore.mutation.identity.workspacePath,
      "/fixture",
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "git.restore.apply").length,
      1,
    );
  } finally {
    late.resolve({ ok: false, code: "UNKNOWN_OUTCOME" });
    app.dispose();
  }
});

test("Git branch restore: reopened restore key rejects confirmed lookup without original payload authority", async () => {
  const p = branchRestorePreview({ source: "head" });
  const target = Object.fromEntries(
    Object.entries(p).filter(
      ([k]) =>
        ![
          "runtimeEpoch",
          "revision",
          "workspacePath",
          "status",
          "author",
        ].includes(k),
    ),
  );
  const e = {
    runtimeEpoch: "epoch-a",
    operationId: "retained-restore",
    expectedRevision: 1,
    operation: {
      ...target,
      type: "git.restore.apply",
      requestId: "retained-restore",
    },
  };
  const { app, calls, clock } = branchRestoreWindow((query) =>
    query.operation.type === "operation.lookup"
      ? {
          ok: true,
          value: {
            status: "found",
            runtimeEpoch: "epoch-a",
            operationId: "retained-restore",
            receipt: branchRestoreApplied(e).receipt,
          },
        }
      : undefined,
  );
  try {
    app.store.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(app.store.getState()), bootstrap: true },
      value: snapshot(1, "a", {
        runtimeEpoch: "epoch-b",
        retainedOperations: [
          {
            authorityHold: true,
            runtimeEpoch: "epoch-a",
            operationId: "retained-restore",
            type: "git.restore.apply",
            workspaceId: "w",
          },
        ],
      }),
    });
    app.start();
    await flush();
    await clock.advance(1000);
    const intent =
      app.store.getState().operations[
        operationKey("epoch-a", "retained-restore")
      ];
    assert.ok(calls.some((e) => e.operation.type === "operation.lookup"));
    assert.equal(intent.status, "unknown");
    assert.equal(intent.lookupOnly, true);
    assert.equal(intent.gitBranchRestoreMutation, undefined);
    assert.deepEqual(intent.operation, {
      type: "git.restore.apply",
      workspaceId: "w",
    });
    assert.equal(app.store.getState().revision, 1);
    assert.equal(await app.actions.applyGitBranchRestore(), false);
    assert.equal(
      calls.some((e) => e.operation.type === "git.restore.apply"),
      false,
    );
  } finally {
    app.dispose();
  }
});

test("Git branch restore: actual React preview renders closed backup plans", async (t) => {
  const { registerHooks } = await import("node:module");
  // Server-render the real component. Only CSS loading is inert here; native
  // captures remain responsible for actual pixels and browser interaction.
  const css = registerHooks({
    load(url, context, nextLoad) {
      return new URL(url).pathname.endsWith(".module.css")
        ? {
            format: "module",
            shortCircuit: true,
            source:
              "export default new Proxy({}, {get: (_value, key) => String(key)});",
          }
        : nextLoad(url, context);
    },
  });
  const { register } = await import("tsx/esm/api");
  const { fileURLToPath } = await import("node:url");
  const scoped = register({
    namespace: "branch-restore-react-regression",
    tsconfig: fileURLToPath(new URL("../tsconfig.json", import.meta.url)),
  });
  let GitBranchRestoreSection, WorkbenchProvider;
  try {
    ({ GitBranchRestoreSection } = await scoped.import(
      "./renderer/features/git-review/branch-restore.tsx",
      import.meta.url,
    ));
    ({ WorkbenchProvider } = await scoped.import(
      "./renderer/entities/workbench/index.ts",
      import.meta.url,
    ));
  } finally {
    css.deregister();
    await scoped.unregister();
  }
  const { createElement } = await import("react");
  const { renderToStaticMarkup } = await import("react-dom/server");
  for (const [action, source] of [
    ["create", ""],
    ["select", ""],
    ["restore", "index"],
    ["restore", "head"],
  ])
    await t.test(`${action}/${source}`, async () => {
      const { app, calls } = branchRestoreWindow();
      try {
        await prepareBranchRestore(app, action, source);
        const value = {
          ...app,
          store: { ...app.store, getInitialState: () => app.store.getState() },
        };
        const html = renderToStaticMarkup(
          createElement(
            WorkbenchProvider,
            { value },
            createElement(GitBranchRestoreSection),
          ),
        );
        assert.match(html, /Backup 계획/);
        assert.match(html, /data-git-branch-restore-state="available"/);
        assert.ok(html.includes("d".repeat(64)));
        assert.match(
          html,
          action === "create"
            ? /branch_ref \/ metadata \/ 원래 없음 · backup null/
            : /worktree \/ a.txt \/ 원래 epoch·operation·role·path/,
        );
        assert.equal(calls.length, 2, "Rendering never dispatches an effect");
        assert.equal(await app.actions.applyGitBranchRestore(), true);
        const resultHtml = renderToStaticMarkup(
          createElement(
            WorkbenchProvider,
            { value },
            createElement(GitBranchRestoreSection),
          ),
        );
        const backups =
          app.store.getState().gitBranchRestore.mutation.identity.backups;
        assert.equal(
          (resultHtml.match(/data-git-branch-restore-backup=/g) ?? []).length,
          backups.length,
          "Each original backup has its own complete selectable evidence block",
        );
        for (const backup of backups)
          assert.ok(resultHtml.includes(backup.backupId ?? "null · 원래 없음"));
      } finally {
        app.dispose();
      }
    });
});

const runtimeModel = (
  id = "historical-model",
  variant = "reported-variant",
) => ({
  providerId: "historical-provider",
  id,
  variant,
});
const runtimeReport = () => ({
  agent: "response-agent",
  model: runtimeModel(),
});
const runtimeCatalog = (
  variants = { status: "available", ids: ["careful", "fast"] },
) => ({
  ...catalog,
  agents: {
    status: "available",
    entries: [{ id: "next-agent", name: "Next agent" }],
  },
  models: {
    status: "available",
    entries: [
      { id: "next-model", name: "Next model", variants },
      {
        id: "other-model",
        name: "Other model",
        variants: { status: "unavailable", ids: [] },
      },
    ],
  },
});
function seedRuntimeCatalog(store, value = runtimeCatalog()) {
  store.dispatch({ type: "catalog", scope: scopeOf(store.getState()), value });
}
test("runtime options: explicit model change clears variant; background refresh preserves removed choice", () => {
  const store = createWorkbenchStore();
  seed(store);
  seedRuntimeCatalog(store);
  const key = selectionKey("w", "a");
  store.dispatch({
    type: "draft",
    key,
    agent: "next-agent",
    model: "next-model",
  });
  store.dispatch({ type: "draft", key, variant: "careful" });
  assert.equal(selectors.draft(store.getState()).variant, "careful");
  seedRuntimeCatalog(
    store,
    runtimeCatalog({ status: "available", ids: ["fast"] }),
  );
  assert.equal(selectors.draft(store.getState()).variant, "careful");
  store.dispatch({ type: "draft", key, model: "other-model" });
  assert.equal(selectors.draft(store.getState()).variant, "");
  assert.equal(selectors.draft(store.getState()).variantCleared, true);
});
test("runtime options: accept separate session and same-message reports; omission clears only session setting", () => {
  const store = createWorkbenchStore();
  const message = {
    id: "old-response",
    role: "assistant",
    text: "history",
    tools: [],
    runtime: runtimeReport(),
  };
  seed(
    store,
    snapshot(1, "a", {
      sessionSelection: {
        sessionId: "a",
        agent: "session-agent",
        model: runtimeModel("session-model"),
      },
      messages: [message],
    }),
  );
  assert.equal(
    store.getState().snapshot?.sessionSelection?.agent,
    "session-agent",
  );
  assert.deepEqual(store.getState().snapshot.messages[0], message);
  store.dispatch({
    type: "draft",
    key: selectionKey("w", "a"),
    model: "next-model",
    variant: "careful",
  });
  seed(store, snapshot(2, "a", { messages: [message] }));
  assert.equal(store.getState().snapshot.sessionSelection, undefined);
  assert.equal(selectors.draft(store.getState()).variant, "careful");
  assert.equal(
    store.getState().snapshot.messages[0].runtime.agent,
    "response-agent",
  );
});
test("runtime options: malformed closed assistant metadata and private canaries reject atomic snapshot", () => {
  const store = createWorkbenchStore();
  seed(store);
  const before = store.getState();
  for (const runtime of [
    { ...runtimeReport(), token: "PRIVATE_CANARY" },
    {
      ...runtimeReport(),
      model: {
        ...runtimeModel(),
        headers: { Authorization: "PRIVATE_CANARY" },
      },
    },
    { agent: "partial" },
  ]) {
    seed(
      store,
      snapshot(2, "a", {
        messages: [
          { id: "bad", role: "assistant", text: "", tools: [], runtime },
        ],
      }),
    );
    assert.equal(store.getState(), before);
  }
});
test("runtime options: malformed or private model catalog never enters public state", () => {
  const store = createWorkbenchStore();
  seed(store);
  for (const entry of [
    { id: "bad", name: "bad" },
    {
      id: "bad",
      name: "bad",
      variants: { status: "available", ids: ["same", "same"] },
    },
    {
      id: "bad",
      name: "bad",
      variants: { status: "unavailable", ids: ["invented"] },
    },
    {
      id: "bad",
      name: "bad",
      variants: { status: "available", ids: [] },
      settings: { key: "PRIVATE_CANARY" },
    },
  ]) {
    seedRuntimeCatalog(store, {
      ...catalog,
      models: { status: "available", entries: [entry] },
    });
    assert.equal(store.getState().catalog, null);
    assert.equal(store.getState().catalogError, "CATALOG_UNVERIFIED");
  }
});

function runtimeWindow(handler) {
  const clock = fakeClock();
  const h = bridgeHarness((e) => handler?.(e) ?? readFallback(e));
  const api = createWindowWorkbench(h.bridge, { clock, id, timeoutMs: 30 });
  seed(api.store);
  seedRuntimeCatalog(api.store);
  return { api, clock, ...h };
}
test("runtime options: running NEXT edits make no IO and retain original immutable send and production digest", async () => {
  const pending = deferred();
  let digest, admitted;
  const host = createHostAdmission({
    runtimeEpoch: "epoch-a",
    revision: () => 1,
    ready: () => Promise.resolve(),
    registry: () => ({
      status: () => ({ state: "ready" }),
      begin: async (identity) => {
        digest = identity.digest;
        return {
          status: "admitted",
          receipt: {
            admission: "admitted",
            delivery: "pending",
            effect: "none",
            revision: 1,
            evidence: [],
          },
        };
      },
    }),
    execute: async () => pending.promise,
  });
  const { api, calls } = runtimeWindow((e) => {
    if (e.operation.type === "message.send") {
      admitted = e;
      return host.handle(e, "runtime-renderer-test");
    }
  });
  try {
    api.actions.draft("original");
    api.actions.options({
      agent: "next-agent",
      model: "next-model",
      variant: "careful",
    });
    const operation = {
      ...send(),
      agent: "next-agent",
      model: "next-model",
      variant: "careful",
    };
    const done = api.actions.mutate(operation, false, "original");
    operation.variant = "fast";
    await flush();
    seed(
      api.store,
      snapshot(1, "a", {
        sessions: [session("a", "w", { status: "running" }), session("b")],
      }),
    );
    const count = calls.length;
    api.actions.options({ model: "other-model" });
    api.actions.options({ agent: "", variant: "" });
    api.actions.draft("next turn");
    await flush();
    assert.equal(calls.length, count);
    assert.equal(selectors.draft(api.store.getState()).model, "other-model");
    assert.equal(admitted.operation.variant, "careful");
    assert.ok(Object.isFrozen(admitted.operation));
    const canonicalDigest = (value) =>
      createHash("sha256")
        .update(
          JSON.stringify(
            Object.keys(value)
              .sort()
              .map((k) => [k, value[k]]),
          ),
        )
        .digest("hex");
    assert.equal(
      digest,
      canonicalDigest({
        ...admitted.operation,
        expectedRevision: admitted.expectedRevision ?? null,
      }),
    );
    assert.notEqual(
      digest,
      canonicalDigest({
        ...admitted.operation,
        variant: "fast",
        expectedRevision: admitted.expectedRevision ?? null,
      }),
    );
    pending.resolve({ ok: true, value: { status: "accepted" } });
    await done;
    assert.equal(selectors.draft(api.store.getState()).text, "next turn");
  } finally {
    api.dispose();
    pending.resolve({ ok: false, code: "CANCELLED" });
  }
});
test("runtime options: unavailable variants permit omitted request, removed explicit variant blocks send without IO", async () => {
  const { api, calls } = runtimeWindow((e) =>
    e.operation.type === "message.send"
      ? { ok: true, value: { status: "accepted" }, receipt: receipt(e) }
      : undefined,
  );
  try {
    api.actions.options({ model: "next-model", variant: "careful" });
    seedRuntimeCatalog(
      api.store,
      runtimeCatalog({ status: "unavailable", ids: [] }),
    );
    assert.equal(selectors.requestOptionsInvalid(api.store.getState()), true);
    assert.equal(
      await api.actions.mutate({
        ...send(),
        model: "next-model",
        variant: "careful",
      }),
      false,
    );
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      0,
    );
    api.actions.options({ variant: "" });
    assert.equal(selectors.requestOptionsInvalid(api.store.getState()), false);
    assert.equal(
      await api.actions.mutate({ ...send(), model: "next-model" }),
      true,
    );
    const operation = calls.find(
      (e) => e.operation.type === "message.send",
    ).operation;
    assert.equal(Object.hasOwn(operation, "variant"), false);
  } finally {
    api.dispose();
  }
});
test("runtime options: no model no variant, historical reports never authorize selection, missing model stays blocked", async () => {
  const { api, calls } = runtimeWindow();
  try {
    for (const options of [
      { variant: "careful" },
      { model: "historical-model" },
      { model: "other-model", variant: "careful" },
      { agent: "response-agent" },
    ]) {
      assert.equal(await api.actions.mutate({ ...send(), ...options }), false);
    }
    api.actions.options({ model: "next-model", variant: "careful" });
    seedRuntimeCatalog(api.store, catalog);
    assert.equal(selectors.draft(api.store.getState()).variant, "careful");
    assert.equal(selectors.requestOptionsInvalid(api.store.getState()), true);
    assert.equal(calls.length, 0);
  } finally {
    api.dispose();
  }
});
test("runtime options: late ACK after root trust floor and ABA preserves current draft and report", async (t) => {
  for (const change of [
    "root",
    "rootABA",
    "trust",
    "trusted",
    "floor",
    "epoch",
    "sessionABA",
  ])
    await t.test(change, async () => {
      const pending = deferred(),
        noRead = deferred();
      const { api, calls } = runtimeWindow((e) =>
        e.operation.type === "message.send"
          ? pending.promise
          : e.operation.type === "snapshot"
            ? noRead.promise
            : undefined,
      );
      try {
        api.actions.draft("original");
        const done = api.actions.mutate(send(), false, "original");
        await flush();
        const original = calls.find((e) => e.operation.type === "message.send");
        if (change.startsWith("root")) {
          seed(
            api.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), path: "/new-root" }],
            }),
          );
          if (change === "rootABA") seed(api.store, snapshot(1));
        } else if (change === "trust")
          seed(
            api.store,
            snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
          );
        else if (change === "trusted")
          seed(
            api.store,
            snapshot(1, "a", {
              workspaces: [{ ...workspace(), trusted: false }],
            }),
          );
        else if (change === "floor") seed(api.store, snapshot(5));
        else if (change === "epoch")
          api.store.dispatch({
            type: "snapshot",
            scope: { ...scopeOf(api.store.getState()), bootstrap: true },
            value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
          });
        else {
          api.store.dispatch({
            type: "select",
            workspaceId: "w",
            sessionId: "b",
          });
          api.store.dispatch({
            type: "select",
            workspaceId: "w",
            sessionId: "a",
          });
          seed(api.store);
        }
        const before = api.store.getState();
        pending.resolve({
          ok: true,
          value: { status: "accepted" },
          receipt: receipt(original, { revision: 9 }),
        });
        await done;
        assert.equal(selectors.draft(api.store.getState()).text, "original");
        assert.equal(api.store.getState().revision, before.revision);
        assert.equal(api.store.getState().notice, before.notice);
        assert.equal(
          api.store.getState().operations[
            operationKey(original.runtimeEpoch, original.operationId)
          ].status,
          "accepted",
        );
      } finally {
        api.dispose();
        noRead.resolve({ ok: false, code: "CANCELLED" });
      }
    });
});
test("runtime options: message ACK cannot supply current session setting", async () => {
  const noRead = deferred();
  const { api } = runtimeWindow((e) =>
    e.operation.type === "message.send"
      ? {
          ok: true,
          receipt: receipt(e),
          value: snapshot(2, "a", {
            sessionSelection: {
              sessionId: "a",
              agent: "ACK-IS-NOT-OBSERVATION",
            },
          }),
        }
      : e.operation.type === "snapshot"
        ? noRead.promise
        : undefined,
  );
  try {
    assert.equal(await api.actions.mutate(send()), true);
    assert.equal(api.store.getState().snapshot?.sessionSelection, undefined);
    assert.equal(
      selectors.currentSessionSetting(api.store.getState()),
      undefined,
    );
  } finally {
    api.dispose();
    noRead.resolve({ ok: false, code: "CANCELLED" });
  }
});

test("runtime options: late snapshot and catalog cannot revive report or catalog across epoch root trust floor ABA", async (t) => {
  for (const change of [
    "root",
    "rootABA",
    "trust",
    "trustABA",
    "trustedABA",
    "floor",
    "sessionABA",
    "epoch",
  ])
    await t.test(change, () => {
      const store = createWorkbenchStore();
      seed(store);
      const scope = scopeOf(store.getState());
      if (change.startsWith("root")) {
        seed(
          store,
          snapshot(1, "a", {
            workspaces: [{ ...workspace(), path: "/new-root" }],
          }),
        );
        if (change === "rootABA") seed(store, snapshot(1));
      } else if (change === "trust" || change === "trustABA") {
        seed(store, snapshot(1, "a", { workspaces: [workspace("w", 2)] }));
        if (change === "trustABA") seed(store, snapshot(1));
      } else if (change === "trustedABA") {
        seed(
          store,
          snapshot(1, "a", {
            workspaces: [{ ...workspace(), trusted: false }],
          }),
        );
        seed(store, snapshot(1));
      } else if (change === "floor") seed(store, snapshot(5));
      else if (change === "epoch")
        store.dispatch({
          type: "snapshot",
          scope: { ...scopeOf(store.getState()), bootstrap: true },
          value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
        });
      else {
        store.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
        store.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
        seed(store);
      }
      const before = store.getState();
      store.dispatch({
        type: "snapshot",
        scope,
        value: snapshot(10, "a", {
          sessionSelection: { sessionId: "a", agent: "STALE-REPORT" },
        }),
      });
      store.dispatch({ type: "catalog", scope, value: runtimeCatalog() });
      assert.equal(store.getState(), before);
      assert.equal(
        selectors.currentSessionSetting(store.getState()),
        undefined,
      );
    });
});
test("runtime options: session setting correlation and closedness reject absent trust unavailable and private data", () => {
  const store = createWorkbenchStore();
  seed(store);
  const before = store.getState();
  const reported = { sessionId: "a", model: runtimeModel() };
  for (const extra of [
    { sessionSelection: { ...reported, sessionId: "b" } },
    { sessionSelection: { ...reported, secret: "PRIVATE_CANARY" } },
    {
      sessionSelection: {
        ...reported,
        model: { ...runtimeModel(), body: "PRIVATE_CANARY" },
      },
    },
    { sessionSelection: { sessionId: "a" } },
    { sessionSelection: { ...reported, agent: "bad\u0000id" } },
    { sessionSelection: reported, state: "disconnected" },
    {
      sessionSelection: reported,
      workspaces: [{ ...workspace(), trusted: false }],
    },
    {
      sessionSelection: reported,
      sessions: [session("a", "w", { status: "unavailable" })],
    },
    {
      sessionSelection: reported,
      recovery: {
        store: { state: "ready" },
        resources: [
          {
            workspaceId: "w",
            state: "unavailable",
            reason: "unresolved_operation",
          },
        ],
      },
    },
    {
      messages: [
        {
          id: "user",
          role: "user",
          text: "",
          tools: [],
          runtime: runtimeReport(),
        },
      ],
    },
    {
      messages: [
        {
          id: "assistant",
          role: "assistant",
          text: "",
          tools: [],
          runtime: runtimeReport(),
          providerOptions: "PRIVATE_CANARY",
        },
      ],
    },
  ]) {
    seed(store, snapshot(2, "a", extra));
    assert.equal(store.getState(), before);
  }
});
test("runtime options: current session report waits for fresh snapshot at ACK floor; never copies NEXT request", async () => {
  const noRead = deferred();
  const { api } = runtimeWindow((e) =>
    e.operation.type === "message.send"
      ? {
          ok: true,
          value: { status: "accepted" },
          receipt: receipt(e, { revision: 3 }),
        }
      : e.operation.type === "snapshot"
        ? noRead.promise
        : undefined,
  );
  try {
    seed(
      api.store,
      snapshot(1, "a", {
        sessionSelection: { sessionId: "a", agent: "session-agent" },
      }),
    );
    api.actions.options({ agent: "next-agent" });
    assert.equal(
      selectors.currentSessionSetting(api.store.getState()).agent,
      "session-agent",
    );
    assert.equal(
      await api.actions.mutate({ ...send(), agent: "next-agent" }),
      true,
    );
    assert.equal(
      selectors.currentSessionSetting(api.store.getState()),
      undefined,
    );
    seed(
      api.store,
      snapshot(3, "a", {
        sessionSelection: {
          sessionId: "a",
          model: runtimeModel("actual-session-model"),
        },
      }),
    );
    assert.equal(
      selectors.currentSessionSetting(api.store.getState()).model.id,
      "actual-session-model",
    );
    seed(api.store, snapshot(3));
    assert.equal(
      selectors.currentSessionSetting(api.store.getState()),
      undefined,
    );
    assert.equal(selectors.draft(api.store.getState()).agent, "next-agent");
  } finally {
    api.dispose();
    noRead.resolve({ ok: false, code: "CANCELLED" });
  }
});
test("runtime options: unknown original key lookup never replays or restores option payload into NEXT draft", async () => {
  const pending = deferred();
  const { api, calls, clock } = runtimeWindow((e) =>
    e.operation.type === "message.send" ? pending.promise : undefined,
  );
  try {
    api.actions.options({ model: "next-model", variant: "careful" });
    api.actions.draft("original");
    const done = api.actions.mutate(
      { ...send(), model: "next-model", variant: "careful" },
      false,
      "original",
    );
    await flush();
    api.actions.options({ model: "other-model" });
    api.actions.draft("next");
    await clock.advance(30);
    assert.equal(await done, false);
    const original = calls.find((e) => e.operation.type === "message.send");
    const intent =
      api.store.getState().operations[
        operationKey(original.runtimeEpoch, original.operationId)
      ];
    assert.equal(intent.operation.variant, "careful");
    assert.equal(intent.submitted.variant, "careful");
    const lookups = calls.filter(
      (e) => e.operation.type === "operation.lookup",
    );
    assert.ok(lookups.length);
    assert.equal(lookups[0].operation.operationId, original.operationId);
    assert.equal(lookups[0].operation.runtimeEpoch, original.runtimeEpoch);
    assert.equal(selectors.draft(api.store.getState()).model, "other-model");
    assert.equal(selectors.draft(api.store.getState()).variant, "");
    assert.equal(selectors.draft(api.store.getState()).text, "next");
    assert.equal(await api.actions.mutate(send()), false);
    await clock.advance(5000);
    assert.equal(
      calls.filter((e) => e.operation.type === "message.send").length,
      1,
    );
    const reopened = createWorkbenchStore();
    seed(
      reopened,
      snapshot(3, "a", {
        retainedOperations: [
          retainedKey(original.runtimeEpoch, original.operationId),
        ],
      }),
    );
    const retained =
      reopened.getState().operations[
        operationKey(original.runtimeEpoch, original.operationId)
      ];
    assert.equal(retained.lookupOnly, true);
    assert.equal(retained.submitted, undefined);
    assert.deepEqual(retained.operation, {
      type: "message.send",
      workspaceId: "w",
      sessionId: "a",
    });
    assert.equal(selectors.draft(reopened.getState()).variant, "");
  } finally {
    api.dispose();
    pending.resolve({ ok: false, code: "CANCELLED" });
  }
});
test("runtime options: explicit blank fields stay omitted and pre-admission option edits cannot clear newer draft", async () => {
  const pending = deferred(),
    noRead = deferred();
  const { api, calls } = runtimeWindow((e) =>
    e.operation.type === "message.send"
      ? pending.promise
      : e.operation.type === "snapshot"
        ? noRead.promise
        : undefined,
  );
  try {
    api.actions.draft("original");
    api.actions.options({ model: "next-model", variant: "careful" });
    const done = api.actions.mutate(send(), false, "original");
    await flush();
    const original = calls.find((e) => e.operation.type === "message.send");
    for (const key of ["agent", "model", "variant"])
      assert.equal(Object.hasOwn(original.operation, key), false);
    const intent =
      api.store.getState().operations[
        operationKey(original.runtimeEpoch, original.operationId)
      ];
    assert.equal(intent.submitted.variant, "");
    assert.equal(intent.submitted.revision, null);
    pending.resolve({
      ok: true,
      value: { status: "accepted" },
      receipt: receipt(original),
    });
    await done;
    assert.equal(selectors.draft(api.store.getState()).text, "original");
    assert.equal(selectors.draft(api.store.getState()).variant, "careful");
  } finally {
    api.dispose();
    noRead.resolve({ ok: false, code: "CANCELLED" });
  }
});
test("runtime options: actual bridge dispatch rechecks catalog and root after intent subscriber reentry", async (t) => {
  for (const change of ["catalog", "root", "trust", "floor", "sessionABA"])
    await t.test(change, async () => {
      const { api, calls } = runtimeWindow();
      try {
        api.actions.options({ model: "next-model", variant: "careful" });
        const stop = api.store.subscribe((state) => {
          if (
            !Object.values(state.operations).some((i) => i.status === "pending")
          )
            return;
          stop();
          if (change === "catalog")
            seedRuntimeCatalog(
              api.store,
              runtimeCatalog({ status: "available", ids: ["fast"] }),
            );
          else if (change === "root")
            seed(
              api.store,
              snapshot(1, "a", {
                workspaces: [{ ...workspace(), path: "/changed" }],
              }),
            );
          else if (change === "trust")
            seed(
              api.store,
              snapshot(1, "a", { workspaces: [workspace("w", 2)] }),
            );
          else if (change === "floor") seed(api.store, snapshot(5));
          else {
            api.store.dispatch({
              type: "select",
              workspaceId: "w",
              sessionId: "b",
            });
            api.store.dispatch({
              type: "select",
              workspaceId: "w",
              sessionId: "a",
            });
            seed(api.store);
          }
        });
        assert.equal(
          await api.actions.mutate({
            ...send(),
            model: "next-model",
            variant: "careful",
          }),
          false,
        );
        assert.equal(
          calls.filter((e) => e.operation.type === "message.send").length,
          0,
        );
      } finally {
        api.dispose();
      }
    });
});

test("runtime options: model option subrecord accepts entry metadata and unknown capabilities without widening authority", () => {
  const store = createWorkbenchStore();
  seed(store);
  const value = runtimeCatalog();
  Object.assign(value.models.entries[0], {
    status: "enabled",
    description: "catalog description",
    capabilities: { tools: true, input: ["future-input"], output: ["text"] },
  });
  seedRuntimeCatalog(store, value);
  assert.equal(store.getState().catalog, value);
  assert.equal(
    selectors.requestOptionsInvalid(store.getState(), {
      model: "next-model",
      variant: "careful",
    }),
    false,
  );
  assert.equal(
    selectors.requestOptionsInvalid(store.getState(), {
      model: "next-model",
      variant: "future-input",
    }),
    true,
  );
});
test("runtime options: bounded closed model catalog rejects malformed variants capabilities duplicates accessors and symbols", () => {
  const store = createWorkbenchStore();
  seed(store);
  let getterCalls = 0;
  const accessor = Object.defineProperty(
    { id: "bad", name: "Bad" },
    "variants",
    {
      enumerable: true,
      get() {
        getterCalls++;
        return { status: "available", ids: [] };
      },
    },
  );
  const base = {
    id: "bad",
    name: "Bad",
    variants: { status: "available", ids: [] },
  };
  const entries = [
    accessor,
    { ...base, [Symbol("private")]: "PRIVATE_CANARY" },
    {
      ...base,
      variants: {
        status: "available",
        ids: Array.from({ length: 65 }, (_, n) => String(n)),
      },
    },
    { ...base, variants: { status: "available", ids: ["x".repeat(257)] } },
    { ...base, variants: { status: "available", ids: ["bad\u0000id"] } },
    { ...base, variants: { status: "available", ids: ["\ud800"] } },
    {
      ...base,
      variants: { status: "available", ids: [], default: "PRIVATE_CANARY" },
    },
    {
      ...base,
      capabilities: { tools: true, input: ["text", "text"], output: [] },
    },
    {
      ...base,
      capabilities: {
        tools: true,
        input: Array.from({ length: 33 }, (_, n) => String(n)),
        output: [],
      },
    },
    {
      ...base,
      capabilities: {
        tools: true,
        input: [],
        output: [],
        headers: "PRIVATE_CANARY",
      },
    },
    { ...base, capabilities: { tools: "yes", input: [], output: [] } },
  ];
  for (const entry of entries) {
    seedRuntimeCatalog(store, {
      ...catalog,
      models: { status: "available", entries: [entry] },
    });
    assert.equal(store.getState().catalog, null);
    assert.equal(store.getState().catalogError, "CATALOG_UNVERIFIED");
  }
  for (const value of [
    { ...catalog, models: { status: "available", entries: [base, base] } },
    { ...catalog, models: { status: "unavailable", entries: [base] } },
    {
      ...catalog,
      models: {
        status: "available",
        entries: Array.from({ length: 301 }, (_, n) => ({
          ...base,
          id: String(n),
        })),
      },
    },
    { ...catalog, token: "PRIVATE_CANARY" },
  ]) {
    seedRuntimeCatalog(store, value);
    assert.equal(store.getState().catalog, null);
  }
  assert.equal(getterCalls, 0);
});

test("runtime options: catalog configuration cannot carry private overlay outside the closed public shape", () => {
  const store = createWorkbenchStore();
  seed(store);
  const base = {
    status: "available",
    runtimeStatus: "not_reported",
    entries: [],
  };
  for (const configuration of [
    { ...base, headers: { Authorization: "PRIVATE_CANARY" } },
    { ...base, runtimeStatus: "guessed" },
    {
      ...base,
      entries: [
        {
          id: "config",
          kind: "configuration",
          source: "workspace",
          scope: "workspace",
          state: "discovered",
          settings: "PRIVATE_CANARY",
        },
      ],
    },
  ]) {
    seedRuntimeCatalog(store, { ...catalog, configuration });
    assert.equal(store.getState().catalog, null);
  }
});

test("runtime options: changing caller type and next options cannot turn a message ACK into a snapshot", async () => {
  const pending = deferred(),
    noRead = deferred();
  const { api, calls } = runtimeWindow((e) =>
    e.operation.type === "message.send"
      ? pending.promise
      : e.operation.type === "snapshot"
        ? noRead.promise
        : undefined,
  );
  try {
    api.actions.draft("original");
    api.actions.options({ model: "next-model", variant: "careful" });
    const caller = { ...send(), model: "next-model", variant: "careful" };
    const done = api.actions.mutate(caller, false, "original");
    caller.type = "session.create";
    caller.variant = "fast";
    api.actions.options({ model: "other-model" });
    await flush();
    const actual = calls.find((e) => e.operation.type === "message.send");
    assert.equal(actual.operation.variant, "careful");
    pending.resolve({
      ok: true,
      receipt: receipt(actual),
      value: snapshot(2, "a", {
        sessionSelection: { sessionId: "a", agent: "FORGED-ACK-REPORT" },
      }),
    });
    assert.equal(await done, true);
    assert.equal(api.store.getState().snapshot.sessionSelection, undefined);
    assert.equal(selectors.draft(api.store.getState()).model, "other-model");
    assert.equal(selectors.draft(api.store.getState()).text, "original");
  } finally {
    api.dispose();
    noRead.resolve({ ok: false, code: "CANCELLED" });
  }
});

// Permission-policy renderer contract: explicit reads, never permission authority.
import { BASELINE_POLICY as permissionBaseline } from "./renderer/shared/configuration-draft/policy.mjs";
const permissionObservation = (extra = {}) => ({
  runtimeEpoch: "epoch-a",
  revision: 1,
  workspaceId: "w",
  workspacePath: "/fixture",
  sessionId: "a",
  status: "available",
  sessionRulesState: "present",
  sessionRules: permissionBaseline.map((row) => ({ ...row })),
  requiredBaselineRules: permissionBaseline.map((row) => ({ ...row })),
  baselineMatches: true,
  evaluation: "not_evaluated",
  ...extra,
});
function permissionHarness({
  observe = () => ({ ok: true, value: permissionObservation() }),
  ...options
} = {}) {
  const h = bridgeHarness((e) =>
    e.operation.type === "permission.policy.read"
      ? observe(e)
      : readFallback(e),
  );
  const clock = fakeClock();
  const client = createWindowWorkbench(h.bridge, { clock, id, ...options });
  seed(client.store);
  return { client, clock, ...h };
}
test("Permission policy explicit public API reads frozen envelope and detaches ordered original rules", async () => {
  const value = permissionObservation({
    sessionRules: [
      { action: "custom", resource: "original/*", effect: "ask" },
      { action: "custom", resource: "original/*", effect: "deny" },
    ],
    baselineMatches: false,
  });
  const { client, calls } = permissionHarness({
    observe: () => ({ ok: true, value }),
  });
  try {
    assert.equal(typeof client.actions.observePermissionPolicy, "function");
    assert.equal(
      typeof client.actions.cancelPermissionPolicyObservation,
      "function",
    );
    assert.equal(
      selectors.canObservePermissionPolicy(client.store.getState()),
      true,
    );
    client.actions.draft("still editable");
    assert.equal(calls.length, 0);
    assert.equal(await client.actions.observePermissionPolicy(), true);
    assert.deepEqual(calls[0].operation, {
      type: "permission.policy.read",
      workspaceId: "w",
      sessionId: "a",
    });
    assert.equal(calls[0].version, 2);
    assert.equal(calls[0].runtimeEpoch, "epoch-a");
    assert.ok(calls[0].readId);
    const current = selectors.currentPermissionPolicyObservation(
      client.store.getState(),
    );
    assert.deepEqual(current, value);
    value.sessionRules[0].resource = "changed outside";
    assert.equal(current.sessionRules[0].resource, "original/*");
    assert.equal(
      selectors.draft(client.store.getState()).text,
      "still editable",
    );
  } finally {
    client.dispose();
  }
});

test("Permission policy malformed and miscorrelated responses never become current", async (t) => {
  const cases = [
    { unexpected: true },
    { sessionId: "b" },
    { workspaceId: "other" },
    { workspacePath: "/other" },
    { runtimeEpoch: "epoch-b" },
    { revision: 0 },
    { revision: 2 },
    { baselineMatches: false },
    { evaluation: "effective" },
    { sessionRulesState: "absent" },
    { sessionRules: [{ action: "read", resource: "*", effect: "grant" }] },
  ];
  for (const [i, extra] of cases.entries())
    await t.test(String(i), async () => {
      const { client } = permissionHarness({
        observe: () => ({ ok: true, value: permissionObservation(extra) }),
      });
      try {
        assert.equal(await client.actions.observePermissionPolicy(), false);
        assert.equal(
          selectors.currentPermissionPolicyObservation(client.store.getState()),
          undefined,
        );
        assert.equal(
          selectors.permissionPolicy(client.store.getState()).error,
          "POLICY_UNVERIFIED",
        );
      } finally {
        client.dispose();
      }
    });
});

test("Permission policy absent, present empty and unavailable remain distinct", async (t) => {
  for (const extra of [
    { sessionRulesState: "absent", sessionRules: [], baselineMatches: false },
    { sessionRules: [], baselineMatches: false },
    { status: "unavailable", reason: "native_policy_unverified" },
  ])
    await t.test(
      extra.sessionRulesState ?? extra.status ?? "empty",
      async () => {
        const value = permissionObservation(extra);
        if (value.status === "unavailable")
          for (const key of [
            "sessionRulesState",
            "sessionRules",
            "requiredBaselineRules",
            "baselineMatches",
            "evaluation",
          ])
            delete value[key];
        const { client } = permissionHarness({
          observe: () => ({ ok: true, value }),
        });
        try {
          assert.equal(await client.actions.observePermissionPolicy(), true);
          assert.deepEqual(
            selectors.currentPermissionPolicyObservation(
              client.store.getState(),
            ),
            value,
          );
        } finally {
          client.dispose();
        }
      },
    );
});

test("Permission policy cancellation and reentry reject late and copied request identities", async () => {
  const old = deferred(),
    fresh = deferred();
  let n = 0;
  const { client, cancellations } = permissionHarness({
    observe: () => (++n === 1 ? old.promise : fresh.promise),
  });
  try {
    const first = client.actions.observePermissionPolicy();
    await flush();
    assert.equal(await client.actions.observePermissionPolicy(), false);
    const original = selectors.permissionPolicy(
      client.store.getState(),
    ).request;
    assert.equal(Object.isFrozen(original), true);
    client.actions.cancelPermissionPolicyObservation();
    await flush();
    assert.equal(await first, false);
    assert.equal(cancellations.length, 1);
    assert.equal(
      selectors.permissionPolicy(client.store.getState()).error,
      "CANCELLED",
    );
    assert.equal(await client.actions.observePermissionPolicy(), false);
    old.resolve({ ok: true, value: permissionObservation() });
    await flush();
    assert.equal(
      selectors.currentPermissionPolicyObservation(client.store.getState()),
      undefined,
    );
    const second = client.actions.observePermissionPolicy();
    await flush();
    const identity = selectors.permissionPolicy(
      client.store.getState(),
    ).request;
    client.store.dispatch({
      type: "permission.policy.observed",
      identity: { ...identity },
      value: permissionObservation(),
    });
    client.store.dispatch({
      type: "permission.policy.observed",
      identity: original,
      value: permissionObservation(),
    });
    assert.equal(
      selectors.permissionPolicy(client.store.getState()).request,
      identity,
    );
    fresh.resolve({ ok: true, value: permissionObservation() });
    assert.equal(await second, true);
  } finally {
    client.dispose();
  }
});

const permissionChanges = {
  epoch: (s) =>
    s.dispatch({
      type: "snapshot",
      scope: { ...scopeOf(s.getState()), bootstrap: true },
      value: snapshot(1, "a", { runtimeEpoch: "epoch-b" }),
    }),
  trust: (s) => seed(s, snapshot(1, "a", { workspaces: [workspace("w", 2)] })),
  untrusted: (s) =>
    seed(
      s,
      snapshot(1, "a", { workspaces: [{ ...workspace(), trusted: false }] }),
    ),
  rootABA: (s) => {
    seed(
      s,
      snapshot(1, "a", {
        workspaces: [{ ...workspace(), path: "/different" }],
      }),
    );
    seed(s);
  },
  sessionABA: (s) => {
    s.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
    s.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
    seed(s);
  },
  workspaceABA: (s) => {
    s.dispatch({ type: "select", workspaceId: "other" });
    s.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
    seed(s);
  },
  floor: (s) => seed(s, snapshot(2)),
  disconnect: (s) => {
    s.dispatch({
      type: "health",
      scope: scopeOf(s.getState()),
      code: "UNAVAILABLE",
    });
    seed(s);
  },
  hold: (s) => {
    seed(
      s,
      snapshot(1, "a", {
        state: "unavailable",
        recovery: {
          store: { state: "recovery_required", reason: "owner_unverified" },
          resources: [],
        },
      }),
    );
    seed(s);
  },
  resourceHold: (s) =>
    seed(
      s,
      snapshot(1, "a", {
        recovery: {
          store: { state: "ready" },
          resources: [
            {
              workspaceId: "w",
              state: "unavailable",
              reason: "unresolved_operation",
            },
          ],
        },
      }),
    ),
  activeSession: (s) =>
    seed(
      s,
      snapshot(1, "a", {
        sessions: [session("a", "w", { status: "running" }), session("b")],
      }),
    ),
};
test("Permission policy pending and completed observations retire on authority races without revival", async (t) => {
  for (const [name, change] of Object.entries(permissionChanges))
    for (const pendingRead of [true, false])
      await t.test(
        `${name}/${pendingRead ? "pending" : "observed"}`,
        async () => {
          const pending = deferred();
          const { client, cancellations } = permissionHarness({
            observe: () =>
              pendingRead
                ? pending.promise
                : { ok: true, value: permissionObservation() },
          });
          try {
            const read = client.actions.observePermissionPolicy();
            await flush();
            if (!pendingRead) assert.equal(await read, true);
            change(client.store);
            await flush();
            pending.resolve({ ok: true, value: permissionObservation() });
            if (pendingRead) {
              assert.equal(await read, false);
              assert.equal(cancellations.length, 1);
            }
            assert.equal(
              selectors.currentPermissionPolicyObservation(
                client.store.getState(),
              ),
              undefined,
            );
            assert.equal(
              selectors.permissionPolicy(client.store.getState()).request,
              undefined,
            );
            assert.equal(
              selectors.permissionPolicy(client.store.getState()).error,
              "STALE",
            );
          } finally {
            client.dispose();
          }
        },
      );
});

test("Permission policy never auto reads on start, polling, focus, selection, draft, send or decision", async () => {
  let focus, visible;
  const { client, clock, calls } = permissionHarness({
    onRefocus: (f) => {
      focus = f;
      return () => {};
    },
    onVisibility: (f) => {
      visible = f;
      return () => {};
    },
  });
  try {
    client.start();
    await flush();
    await clock.advance(5000);
    await flush();
    focus();
    visible();
    await flush();
    client.store.dispatch({ type: "select", workspaceId: "w", sessionId: "b" });
    await flush();
    client.store.dispatch({ type: "select", workspaceId: "w", sessionId: "a" });
    seed(client.store);
    await flush();
    client.actions.draft("keep composer");
    await client.actions.mutate(send());
    await flush();
    await client.actions.mutate({
      type: "permission.respond",
      workspaceId: "w",
      sessionId: "a",
      requestId: "missing",
      decision: "reject",
    });
    await flush();
    assert.equal(
      calls.filter((e) => e.operation.type === "permission.policy.read").length,
      0,
    );
  } finally {
    client.dispose();
  }
});

test("Permission policy missing, stale, held and untrusted authority performs zero read IO", async (t) => {
  const cases = {
    empty: (s) =>
      s.dispatch({
        type: "select",
        workspaceId: "missing",
        sessionId: "missing",
      }),
    staleSnapshot: (s) =>
      s.dispatch({ type: "select", workspaceId: "w", sessionId: "b" }),
    untrusted: permissionChanges.untrusted,
    resourceHold: permissionChanges.resourceHold,
    activeSession: permissionChanges.activeSession,
    disconnected: (s) =>
      s.dispatch({
        type: "health",
        scope: scopeOf(s.getState()),
        code: "UNAVAILABLE",
      }),
    archived: (s) =>
      seed(
        s,
        snapshot(1, "a", {
          sessions: [session("a", "w", { archived: true }), session("b")],
        }),
      ),
  };
  for (const [name, change] of Object.entries(cases))
    await t.test(name, async () => {
      const { client, calls } = permissionHarness();
      try {
        change(client.store);
        assert.equal(
          selectors.canObservePermissionPolicy(client.store.getState()),
          false,
        );
        assert.equal(await client.actions.observePermissionPolicy(), false);
        assert.equal(calls.length, 0);
      } finally {
        client.dispose();
      }
    });
});

test("Permission policy reducer independently refuses malformed raw response and copied request identity", async () => {
  const pending = deferred();
  const { client } = permissionHarness({ observe: () => pending.promise });
  try {
    const read = client.actions.observePermissionPolicy();
    await flush();
    const identity = selectors.permissionPolicy(
      client.store.getState(),
    ).request;
    client.store.dispatch({
      type: "permission.policy.observed",
      identity: { ...identity },
      value: permissionObservation(),
    });
    assert.equal(
      selectors.permissionPolicy(client.store.getState()).request,
      identity,
    );
    client.store.dispatch({
      type: "permission.policy.observed",
      identity,
      value: permissionObservation({ evaluation: "effective" }),
    });
    assert.equal(
      selectors.currentPermissionPolicyObservation(client.store.getState()),
      undefined,
    );
    assert.equal(
      selectors.permissionPolicy(client.store.getState()).error,
      "POLICY_UNVERIFIED",
    );
    pending.resolve({ ok: true, value: permissionObservation() });
    assert.equal(await read, false);
  } finally {
    client.dispose();
  }
});

test("Permission policy original receipt advances floor and cannot revive old observation", async () => {
  const { client } = permissionHarness();
  try {
    assert.equal(await client.actions.observePermissionPolicy(), true);
    const operation = send();
    client.store.dispatch({
      type: "intent",
      intent: {
        id: "permission-floor",
        epoch: "epoch-a",
        origin: client.store.getState().selection,
        key: selectionKey("w", "a"),
        operation,
        status: "pending",
        navigate: false,
      },
    });
    client.store.dispatch({
      type: "receipt",
      id: "permission-floor",
      receipt: receipt({
        runtimeEpoch: "epoch-a",
        operationId: "permission-floor",
        operation,
      }),
    });
    assert.equal(client.store.getState().revision, 2);
    assert.equal(
      selectors.currentPermissionPolicyObservation(client.store.getState()),
      undefined,
    );
    assert.equal(await client.actions.observePermissionPolicy(), false);
    seed(client.store, snapshot(2));
    assert.equal(
      selectors.currentPermissionPolicyObservation(client.store.getState()),
      undefined,
    );
  } finally {
    client.dispose();
  }
});

test("Permission policy timeout cannot publish late result or change draft", async () => {
  const pending = deferred();
  const { client, clock, cancellations } = permissionHarness({
    observe: () => pending.promise,
    timeoutMs: 30,
  });
  try {
    const read = client.actions.observePermissionPolicy();
    await flush();
    client.actions.draft("editable during read");
    await clock.advance(31);
    assert.equal(await read, false);
    assert.equal(
      selectors.permissionPolicy(client.store.getState()).error,
      "READ_TIMEOUT",
    );
    assert.equal(cancellations.length, 1);
    pending.resolve({ ok: true, value: permissionObservation() });
    await flush();
    assert.equal(
      selectors.currentPermissionPolicyObservation(client.store.getState()),
      undefined,
    );
    assert.equal(
      selectors.draft(client.store.getState()).text,
      "editable during read",
    );
  } finally {
    client.dispose();
  }
});

test("Permission policy cancellation affects only its read and uses the frozen cancel key", async () => {
  const pending = deferred();
  const { client, calls, cancellations } = permissionHarness({
    observe: () => pending.promise,
  });
  try {
    client.actions.draft("keep text");
    const read = client.actions.observePermissionPolicy();
    await flush();
    client.actions.cancelPermissionPolicyObservation();
    await flush();
    assert.equal(await read, false);
    assert.deepEqual(cancellations, [
      {
        version: 2,
        runtimeEpoch: calls[0].runtimeEpoch,
        readId: calls[0].readId,
      },
    ]);
    assert.deepEqual(
      calls.map((e) => e.operation.type),
      ["permission.policy.read"],
    );
    assert.equal(selectors.draft(client.store.getState()).text, "keep text");
    pending.resolve({ ok: true, value: permissionObservation() });
    await flush();
  } finally {
    client.dispose();
  }
});

test("Permission policy accepted send and decision paths never schedule a policy read", async (t) => {
  for (const operation of [
    send(),
    {
      type: "permission.respond",
      workspaceId: "w",
      sessionId: "a",
      requestId: "permission",
      decision: "reject",
    },
  ])
    await t.test(operation.type, async () => {
      const h = bridgeHarness((e) =>
        e.operationId ? { ok: true, value: receipt(e) } : readFallback(e),
      );
      const client = createWindowWorkbench(h.bridge, {
        clock: fakeClock(),
        id,
      });
      try {
        seed(
          client.store,
          snapshot(
            1,
            "a",
            operation.type === "permission.respond"
              ? {
                  permissions: [
                    {
                      id: "permission",
                      sessionId: "a",
                      title: "Tool",
                      detail: "Original request",
                    },
                  ],
                }
              : {},
          ),
        );
        await client.actions.mutate(operation);
        await flush();
        assert.equal(
          h.calls.filter((e) => e.operation.type === operation.type).length,
          1,
        );
        assert.equal(
          h.calls.filter((e) => e.operation.type === "permission.policy.read")
            .length,
          0,
        );
      } finally {
        client.dispose();
      }
    });
});

test("a snapshot whose workspaces carry the host's read-only probe metadata is accepted, malformed metadata is not", () => {
  const s = createWorkbenchStore();
  seed(
    s,
    snapshot(1, "a", {
      workspaces: [{ ...workspace(), branch: "main", writable: true }],
    }),
  );
  assert.equal(s.getState().connection, "connected");
  assert.equal(s.getState().snapshot.workspaces[0].writable, true);
  const before = s.getState().snapshot;
  for (const extra of [{ writable: "yes" }, { branch: 7 }, { shell: "x" }])
    seed(s, snapshot(2, "a", { workspaces: [{ ...workspace(), ...extra }] }));
  assert.equal(s.getState().snapshot, before);
});
