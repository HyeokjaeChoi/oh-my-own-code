import test from "node:test";
import assert from "node:assert/strict";
import {
  createUiFixture,
  createFixtureTransport,
} from "./fixtures/workbench-host.mjs";

function harness() {
  const fixture = createUiFixture();
  fixture.enableRevert();
  const frame = { url: "app://x" };
  const sender = { mainFrame: frame };
  frame.sender = sender;
  const transport = createFixtureTransport(fixture, {
    webContents: sender,
    allowedUrl: () => true,
  });
  const event = { sender, senderFrame: frame };
  const ids = {
    workspaceId: fixture.snapshot.selectedWorkspaceId,
    sessionId: fixture.snapshot.selectedSessionId,
  };
  let n = 0;
  const call = (operation) =>
    transport.handle(event, {
      version: 2,
      runtimeEpoch: fixture.snapshot.runtimeEpoch,
      operationId: `op-${++n}`,
      operation: { ...ids, requestId: `op-${n}`, ...operation },
    });
  return { fixture, call, ids };
}

test("fixture revert hides the boundary, reapply restores, a send commits", async () => {
  const { fixture, call } = harness();
  const staged = await call({ type: "session.revert", messageId: "revert-m3" });
  assert.equal(staged.ok, true, JSON.stringify(staged));
  assert.deepEqual(
    staged.value.messages.map((m) => m.id),
    ["revert-m1", "revert-m2"],
  );
  assert.deepEqual(staged.value.revert, {
    messageId: "revert-m3",
    fileCount: 1,
    files: ["src/synthetic.txt"],
    filesRestored: true,
  });
  assert.equal(staged.receipt.result.kind, "metadata");
  const cleared = await call({
    type: "session.revert.clear",
    messageId: "revert-m3",
  });
  assert.equal(cleared.value.messages.length, 6);
  assert.equal(Object.hasOwn(cleared.value, "revert"), false);
  await call({ type: "session.revert", messageId: "revert-m5" });
  assert.equal((await call({ type: "message.send", text: "next" })).ok, true);
  assert.equal(fixture.sessionRevert.size, 0);
  assert.deepEqual(
    fixture.sessionMessages
      .get("fixture-s")
      .map((m) => m.id)
      .slice(0, 4),
    ["revert-m1", "revert-m2", "revert-m3", "revert-m4"],
  );
  assert.equal(fixture.sessionMessages.get("fixture-s").length, 5);
});

test("fixture revert refuses assistant targets, stale clears and simulates denial and non-git", async () => {
  const { fixture, call } = harness();
  assert.equal(
    (await call({ type: "session.revert", messageId: "revert-m2" })).code,
    "INVALID_SELECTION",
  );
  assert.equal(
    (await call({ type: "session.revert.clear", messageId: "revert-m1" })).code,
    "INVALID_SELECTION",
  );
  fixture.nextRevert = "denied";
  assert.equal(
    (await call({ type: "session.revert", messageId: "revert-m1" })).code,
    "CANCELLED",
  );
  fixture.revertFilesRestored = false;
  const plain = await call({ type: "session.revert", messageId: "revert-m1" });
  assert.equal(plain.value.revert.filesRestored, false);
  assert.equal(plain.value.messages.length, 0);
});
