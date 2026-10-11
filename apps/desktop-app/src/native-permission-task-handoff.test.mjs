import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { createNativeTaskHandoffs } from "./native-permission-task-handoff.mjs";
const uuid = (name) => {
  const hex = createHash("sha256").update(name).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
};
const taskScopeId = uuid("task-1");
const digest = "a".repeat(64);
const input = (id = "handoff-1") => ({
  handoffId: uuid(id),
  taskScopeId,
  originalKey: { runtimeEpoch: "epoch-1", operationId: "operation-1" },
  originalDigest: digest,
  step: "native.send",
  stageArgumentDigest: digest,
  targetIdentity: {
    taskScopeId,
    origin: {
      runtimeEpoch: "epoch-1",
      operationId: "operation-1",
      type: "message.send",
      digest,
    },
    originKind: "prompt",
    workspaceId: "workspace-1",
    appSessionId: "session-1",
    nativeSessionId: "native-1",
    projectId: "project-1",
    locationId: uuid("location-1"),
    modeGeneration: 1,
    inventoryGeneration: 1,
  },
  currentLaunchIdentity: "launch-1",
  expiresAt: 5000,
});
const make = (now = () => 0) =>
  createNativeTaskHandoffs({
    runtimeEpoch: "epoch-1",
    launchIdentity: "launch-1",
    now,
  });
test("task handoff refuses unknown Native stages and non-UUID registered locations", () => {
  const handoffs = make();
  assert.throws(() =>
    handoffs.arm({ ...input(), step: "native.unregistered" }),
  );
  assert.throws(() =>
    handoffs.arm({
      ...input(),
      targetIdentity: { ...input().targetIdentity, locationId: "location-1" },
    }),
  );
});
test("task handoff compares actual detached body/target before one-use consumption", () => {
  const handoffs = make();
  const row = input();
  handoffs.arm(row);
  assert.throws(() =>
    handoffs.consume({ ...row, stageArgumentDigest: "b".repeat(64) }),
  );
  assert.equal(handoffs.consume(row).taskScopeId, taskScopeId);
  assert.throws(() => handoffs.consume(row));
});
test("task handoff refuses substituted launch/epoch/target and closed-shape accessors", () => {
  const handoffs = make();
  for (const row of [
    { ...input(), currentLaunchIdentity: "other-launch" },
    {
      ...input(),
      originalKey: { runtimeEpoch: "old-epoch", operationId: "operation-1" },
    },
    { ...input(), extra: true },
  ])
    assert.throws(() => handoffs.arm(row));
  const row = input();
  Object.defineProperty(row, "step", {
    get() {
      throw new Error("accessor executed");
    },
    enumerable: true,
  });
  assert.throws(() => handoffs.arm(row), /native_permission_task_handoff/);
  handoffs.arm(input());
  assert.throws(() =>
    handoffs.consume({
      ...input(),
      targetIdentity: { ...input().targetIdentity, nativeSessionId: "other" },
    }),
  );
  assert.equal(handoffs.consume(input()).taskScopeId, taskScopeId);
});
test("task handoff expiry and revocation never restore consumed/revoked IDs", () => {
  let now = 0;
  const handoffs = make(() => now);
  handoffs.arm(input());
  now = 5000;
  assert.throws(() => handoffs.consume(input()));
  assert.throws(() => handoffs.arm(input()));
  const second = make();
  second.arm(input("handoff-2"));
  second.revoke(uuid("handoff-2"));
  assert.throws(() => second.consume(input("handoff-2")));
  second.close();
  assert.throws(() => second.arm(input("handoff-3")));
});
test("task handoff detached immutable target survives caller mutation; bounded lifetime/capacity", () => {
  const handoffs = make();
  const row = input();
  handoffs.arm(row);
  row.targetIdentity.projectId = "changed";
  assert.equal(handoffs.consume(input()).targetIdentity.projectId, "project-1");
  assert.throws(() => handoffs.arm({ ...input("long"), expiresAt: 5001 }));
  for (let n = 0; n < 32; n++) handoffs.arm(input(`next-${n}`));
  assert.throws(() => handoffs.arm(input("overflow")));
});

test("task handoff refuses non-UUID task/handoff IDs and regressing clock", () => {
  const handoffs = make();
  assert.throws(() => handoffs.arm({ ...input(), handoffId: "invented" }));
  assert.throws(() => handoffs.arm({ ...input(), taskScopeId: "invented" }));
  let time = 10;
  const clocked = make(() => time);
  clocked.arm(input());
  time = 9;
  assert.throws(() => clocked.consume(input()));
});

test("actual pinned SDK prompt builder preserves private reserved Native inbox ID and exact body", async () => {
  const manifest = JSON.parse(
    readFileSync(
      new URL(
        "../../../docs/runs/permission-task-lifetime-integration/sdk-prompt-source-inputs-r1.json",
        import.meta.url,
      ),
    ),
  );
  const root = new URL("../../../", import.meta.url);
  for (const [path, pin] of Object.entries(manifest.files)) {
    const raw = readFileSync(new URL(path, root));
    assert.equal(raw.length, pin.bytes);
    assert.equal(createHash("sha256").update(raw).digest("hex"), pin.sha256);
  }
  const source = readFileSync(
    new URL(
      "apps/desktop-app/runtime-event-host/.generated/install/node_modules/@opencode/client/dist/chunks/contract-n8g24fq8.js",
      root,
    ),
    "utf8",
  );
  const start = source.indexOf("prompt: (input, requestOptions) => request({");
  const end = source.indexOf("      command:", start);
  assert.ok(start >= 0 && end > start);
  const expression = source
    .slice(start + "prompt: ".length, end)
    .trim()
    .replace(/,$/u, "");
  let captured;
  const prompt = new Function("request", `return (${expression});`)((body) => {
    captured = body;
    return Promise.resolve({ data: { id: "msg_private_reserved" } });
  });
  const body = {
    sessionID: "ses_actual",
    id: "msg_private_reserved",
    text: "\uFEFFline1\r\nline2",
    files: [{ uri: "data:text/plain;base64,YQ==", name: "exact.txt" }],
    delivery: "queue",
  };
  const result = await prompt(body);
  assert.equal(result.id, body.id);
  assert.equal(captured.path, "/api/session/ses_actual/prompt");
  const serialized = JSON.parse(JSON.stringify(captured.body));
  assert.equal(serialized.id, body.id);
  assert.equal(serialized.text, body.text);
  assert.deepEqual(serialized.files, body.files);
  assert.equal(serialized.delivery, "queue");
});

function completeTarget(row, originKind, targetKind) {
  const target = {
    ...row.targetIdentity,
    taskScopeId: row.taskScopeId,
    origin: {
      ...row.originalKey,
      type:
        originKind === "bootstrap"
          ? "session.create"
          : "configuration.mcp.connect",
      digest: row.originalDigest,
    },
    originKind,
  };
  if (originKind === "bootstrap" || targetKind === "workspace") {
    delete target.appSessionId;
    delete target.nativeSessionId;
  }
  if (originKind === "mutation") target.targetKind = targetKind;
  return target;
}

test("handoff uses actual shared bootstrap task identity without fabricated session IDs", () => {
  const row = input("bootstrap");
  row.step = "native.create";
  row.targetIdentity = completeTarget(row, "bootstrap");
  const handoffs = make();
  handoffs.arm(row);
  const consumed = handoffs.consume(row);
  assert.equal(consumed.targetIdentity.originKind, "bootstrap");
  assert.equal(
    Object.hasOwn(consumed.targetIdentity, "nativeSessionId"),
    false,
  );
  assert.equal(Object.hasOwn(consumed.targetIdentity, "appSessionId"), false);
  assert.throws(() => handoffs.consume(row));
});

test("handoff uses actual workspace mutation task identity and compares its complete original scope", () => {
  const row = input("workspace");
  row.step = "native.mcp.connect";
  row.targetIdentity = completeTarget(row, "mutation", "workspace");
  const handoffs = make();
  handoffs.arm(row);
  assert.throws(() =>
    handoffs.consume({
      ...row,
      targetIdentity: { ...row.targetIdentity, targetKind: "session" },
    }),
  );
  assert.throws(() =>
    handoffs.consume({
      ...row,
      targetIdentity: {
        ...row.targetIdentity,
        origin: { ...row.targetIdentity.origin, digest: "b".repeat(64) },
      },
    }),
  );
  assert.equal(handoffs.consume(row).targetIdentity.targetKind, "workspace");
});

test("handoff refuses old partial targets, different original task identity and fabricated bootstrap target", () => {
  const row = input();
  const old = { ...row.targetIdentity };
  delete old.taskScopeId;
  delete old.origin;
  delete old.originKind;
  const invalid = [
    old,
    { ...row.targetIdentity, taskScopeId: uuid("different-task") },
    {
      ...row.targetIdentity,
      origin: { ...row.targetIdentity.origin, operationId: "other-operation" },
    },
    {
      ...row.targetIdentity,
      origin: { ...row.targetIdentity.origin, runtimeEpoch: "old-epoch" },
    },
    {
      ...row.targetIdentity,
      origin: { ...row.targetIdentity.origin, digest: "b".repeat(64) },
    },
    { ...row.targetIdentity, modeGeneration: 0 },
    { ...row.targetIdentity, inventoryGeneration: 0 },
  ];
  for (const targetIdentity of invalid)
    assert.throws(() => make().arm({ ...row, targetIdentity }));
  assert.throws(() => make().arm({ ...row, step: "native.create" }));
  assert.throws(() => make().arm({ ...row, step: "native.fork" }));
  const workspace = completeTarget(row, "mutation", "workspace");
  for (const field of ["appSessionId", "nativeSessionId"])
    assert.throws(() =>
      make().arm({
        ...row,
        targetIdentity: { ...workspace, [field]: "invented" },
      }),
    );
});

test("handoff preserves complete detached origin and rejects changed bootstrap stage on consumption", () => {
  const row = input("bootstrap-frozen");
  row.step = "native.fork";
  row.targetIdentity = completeTarget(row, "bootstrap");
  row.targetIdentity.origin.type = "session.fork";
  const original = globalThis.structuredClone(row);
  const handoffs = make();
  handoffs.arm(row);
  row.targetIdentity.origin.type = "session.create";
  assert.throws(() => handoffs.consume(row));
  assert.throws(() => handoffs.consume({ ...original, step: "native.create" }));
  const consumed = handoffs.consume(original);
  assert.equal(consumed.targetIdentity.origin.type, "session.fork");
  assert.ok(Object.isFrozen(consumed.targetIdentity));
  assert.ok(Object.isFrozen(consumed.targetIdentity.origin));
});
