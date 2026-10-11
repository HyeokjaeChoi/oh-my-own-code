import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import * as context from "./renderer/shared/conversation-context/index.mjs";
import { validateRequest } from "./workbench-contract.mjs";
const hash = (text) => createHash("sha256").update(text).digest("hex");
const descriptor = () => ({
  capabilityId: "cap-1",
  workspaceId: "w1",
  workspacePath: "/tmp/work",
  path: "src/a.txt",
  name: "a.txt",
  source: "file",
  version: hash("source"),
  digest: hash("\ufeffa\r\n"),
  mime: "text/plain",
  size: 6,
});
const send = () => ({
  type: "message.send",
  workspaceId: "w1",
  sessionId: "s1",
  requestId: "op1",
  text: "read this",
  model: "provider:model",
  attachments: [descriptor()],
});
test("checked context descriptor rejects forged authority and protected paths", () => {
  assert.equal(context.validContextDescriptor(descriptor()), true);
  for (const patch of [
    { uri: "file:///tmp/secret" },
    { mime: "image/svg+xml" },
    { path: ".env" },
    { name: "../a.txt" },
    { size: 8388609 },
    { range: { start: 0, end: 1 } },
    { source: "selection" },
    { workspacePath: "relative" },
  ])
    assert.equal(
      context.validContextDescriptor({ ...descriptor(), ...patch }),
      false,
    );
  const getter = { ...descriptor() };
  Object.defineProperty(getter, "mime", {
    get() {
      throw Error("getter executed");
    },
    enumerable: true,
  });
  assert.equal(context.validContextDescriptor(getter), false);
});
test("ordered context list is bounded and cannot repeat a capability", () => {
  assert.equal(context.validContextList([descriptor()]), true);
  assert.equal(context.validContextList([descriptor(), descriptor()]), false);
  assert.equal(
    context.validContextList(
      Array.from({ length: 9 }, (_, i) => ({
        ...descriptor(),
        capabilityId: `cap-${i}`,
      })),
    ),
    false,
  );
  const image = { ...descriptor(), mime: "image/png", size: 8388608 };
  assert.equal(
    context.validContextList([
      image,
      { ...image, capabilityId: "cap-2" },
      { ...descriptor(), capabilityId: "cap-3" },
    ]),
    false,
  );
});
test("checked preview preserves exact BOM CRLF and refuses arbitrary URLs", () => {
  const value = {
    runtimeEpoch: "epoch1",
    revision: 0,
    workspaceId: "w1",
    workspacePath: "/tmp/work",
    path: "src/a.txt",
    status: "available",
    descriptor: descriptor(),
    preview: { kind: "text", text: "\ufeffa\r\n" },
  };
  assert.equal(context.validateContextObservation(value), value);
  for (const patch of [
    { revision: -1 },
    { preview: { kind: "text", text: "a\n" } },
    { preview: { kind: "image", dataUrl: "https://example.com/a.png" } },
    { uri: "file:///tmp/a" },
  ])
    assert.throws(
      () => context.validateContextObservation({ ...value, ...patch }),
      /INVALID_REQUEST/,
    );
});
test("explicit actual model capability is required, using Native modality prefixes", () => {
  const options = {
    variants: { status: "available", ids: [] },
    capabilities: {
      tools: true,
      input: ["text/plain", "image/png", "pdf"],
      output: ["text"],
    },
  };
  assert.equal(context.contextModelSupports(options, [descriptor()]), true);
  assert.equal(
    context.contextModelSupports(options, [
      { ...descriptor(), mime: "application/pdf" },
    ]),
    true,
  );
  assert.equal(
    context.contextModelSupports(
      { variants: { status: "available", ids: [] } },
      [descriptor()],
    ),
    false,
  );
  assert.equal(
    context.contextModelSupports(
      { ...options, capabilities: { ...options.capabilities, input: [] } },
      [descriptor()],
    ),
    false,
  );
});
test("actual wire request preserves attachments and blocks absent model or mixed running switches", () => {
  assert.equal(
    validateRequest(send()).attachments[0].digest,
    descriptor().digest,
  );
  const noModel = send();
  delete noModel.model;
  assert.throws(() => validateRequest(noModel), /Invalid workbench request/);
  for (const patch of [
    { attachments: [{ ...descriptor(), uri: "file:///a" }] },
    { delivery: "steer", agent: "a" },
    { delivery: "queue", model: "m" },
    { delivery: "other" },
  ])
    assert.throws(
      () => validateRequest({ ...send(), ...patch }),
      /Invalid workbench request/,
    );
  const queued = {
    type: "message.send",
    workspaceId: "w1",
    sessionId: "s1",
    requestId: "op2",
    text: "next",
    delivery: "queue",
  };
  assert.equal(validateRequest(queued).delivery, "queue");
  assert.equal(
    validateRequest({
      type: "session.fork",
      workspaceId: "w1",
      sessionId: "s1",
      requestId: "op3",
      before: "message1",
    }).before,
    "message1",
  );
  assert.equal(
    validateRequest({
      type: "session.inbox.cancel",
      workspaceId: "w1",
      sessionId: "s1",
      requestId: "op4",
      inboxId: "inbox1",
    }).inboxId,
    "inbox1",
  );
});
test("inbox observation refuses cross-session/oversized Native rows and exports no source bytes", async () => {
  const { projectContextInbox } = await import(
    "./host/conversation-context-native.mjs"
  );
  const input = {
    id: "in1",
    sessionID: "native1",
    type: "user",
    delivery: "queue",
    payload: {
      text: "next",
      files: [
        {
          data: "SECRET_BYTES",
          source: { type: "file", path: "/private/secret" },
          mime: "text/plain",
        },
      ],
      metadata: { secret: "PRIVATE" },
    },
  };
  const value = projectContextInbox([input], "native1");
  assert.deepEqual(value, {
    entries: [
      {
        id: "in1",
        delivery: "queue",
        textPreview: "next",
        textTruncated: false,
        attachmentCount: 1,
      },
    ],
    otherCount: 0,
  });
  assert.equal(JSON.stringify(value).includes("SECRET"), false);
  for (const rows of [
    [{ ...input, sessionID: "foreign" }],
    [input, input],
    Array.from({ length: 65 }, (_, i) => ({ ...input, id: `in${i}` })),
    [{ ...input, delivery: "other" }],
  ])
    assert.throws(
      () => projectContextInbox(rows, "native1"),
      /INVALID_REQUEST/,
    );
});
test("large valid image metadata stays bounded without recursive base64 matching", () => {
  const data = Buffer.alloc(8 * 1024 * 1024, 1).toString("base64");
  const d = { ...descriptor(), mime: "image/png", size: 8 * 1024 * 1024 };
  const value = {
    runtimeEpoch: "e",
    revision: 1,
    workspaceId: d.workspaceId,
    workspacePath: d.workspacePath,
    path: d.path,
    status: "available",
    descriptor: d,
    preview: { kind: "image", dataUrl: `data:image/png;base64,${data}` },
  };
  assert.equal(context.validateContextObservation(value), value);
  assert.throws(
    () =>
      context.validateContextObservation({
        ...value,
        preview: { ...value.preview, dataUrl: "data:image/png;base64,AB==" },
      }),
    /INVALID_REQUEST/,
  );
});
test("Native attachment ACK preserves checked text bytes and cannot claim file-path input", async () => {
  const { validContextPromptReceipt } = await import(
    "./host/conversation-context-native.mjs"
  );
  const files = [
    { name: "a.txt", uri: "data:text/plain;base64,77u/ YQ0K".replace(" ", "") },
  ];
  const result = {
    id: "in",
    sessionID: "ns",
    type: "user",
    delivery: "queue",
    payload: {
      text: "read",
      files: [
        {
          name: "a.txt",
          data: files[0].uri.split(",")[1],
          mime: "text/plain",
          source: { type: "inline" },
        },
      ],
    },
  };
  assert.equal(
    validContextPromptReceipt(result, "ns", "read", "queue", files),
    true,
  );
  for (const patch of [
    { source: { type: "file", path: "/tmp/a" } },
    { data: "Yg==" },
    { name: "different" },
    { mime: "application/pdf" },
  ])
    assert.equal(
      validContextPromptReceipt(
        {
          ...result,
          payload: {
            ...result.payload,
            files: [{ ...result.payload.files[0], ...patch }],
          },
        },
        "ns",
        "read",
        "queue",
        files,
      ),
      false,
    );
  assert.equal(
    validContextPromptReceipt(result, "ns", "read", "steer", files),
    false,
  );
});

test("inbox preview truncation preserves Unicode at the public observation boundary", async () => {
  const { projectContextInbox } = await import(
    "./host/conversation-context-native.mjs"
  );
  const text = "a".repeat(1999) + "😀tail";
  const projected = projectContextInbox(
    [
      {
        id: "pending",
        sessionID: "native1",
        type: "user",
        delivery: "queue",
        payload: { text },
      },
    ],
    "native1",
  );
  const value = {
    runtimeEpoch: "epoch",
    revision: 1,
    workspaceId: "w1",
    sessionId: "s1",
    ...projected,
  };
  assert.equal(context.validateInboxObservation(value), value);
  assert.equal(projected.entries[0].textPreview, "a".repeat(1999));
  assert.equal(projected.entries[0].textTruncated, true);
});
