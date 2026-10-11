import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { bindWorkbenchIpc } from "./workbench-ipc.mjs";
import { admitsRendererRequest } from "../renderer-admission.mjs";

test("production IPC checks sender AND main frame before passing v2 payload or cancel scope", async () => {
  const channels = new Map();
  const calls = [];
  const sender = { id: 42 };
  sender.mainFrame = { url: "app://approved" };
  const event = { sender, senderFrame: sender.mainFrame };
  const ipcMain = {
    handle: (channel, handler) => channels.set(channel, handler),
  };
  const service = {
    handle: (...args) => {
      calls.push(["handle", ...args]);
      return { ok: true };
    },
    cancelRead: (...args) => {
      calls.push(["cancel", ...args]);
      return { ok: true };
    },
  };
  bindWorkbenchIpc({
    ipcMain,
    admit: (event) =>
      admitsRendererRequest(event, sender, (url) => url === "app://approved"),
    service: () => service,
  });
  assert.deepEqual(
    [...channels.keys()],
    ["desktop:v2:workbench", "desktop:v2:cancel-read"],
  );
  const payload = {
    get version() {
      throw new Error("unadmitted payload accessed");
    },
  };
  for (const channel of channels.values()) {
    for (const denied of [
      {
        sender: { id: 43, mainFrame: sender.mainFrame },
        senderFrame: sender.mainFrame,
      },
      { sender, senderFrame: { url: "app://approved" } },
      { sender, senderFrame: undefined },
    ])
      assert.equal((await channel(denied, payload)).code, "INVALID_REQUEST");
    assert.equal(
      (await channel(event, payload, "extra")).code,
      "INVALID_REQUEST",
    );
    assert.equal((await channel(event)).code, "INVALID_REQUEST");
  }
  assert.equal(calls.length, 0);
  const envelope = {
    version: 2,
    runtimeEpoch: "epoch",
    readId: "read",
    operation: { type: "snapshot" },
  };
  await channels.get("desktop:v2:workbench")(event, envelope);
  const cancel = { version: 2, runtimeEpoch: "epoch", readId: "read" };
  await channels.get("desktop:v2:cancel-read")(event, cancel);
  assert.deepEqual(calls, [
    ["handle", envelope, "42"],
    ["cancel", cancel, "42"],
  ]);
});

test("preload exposes v2 only to the main frame, without legacy envelope adaptation", async () => {
  const source = await readFile(
    new URL("../preload.cjs", import.meta.url),
    "utf8",
  );
  const calls = [];
  let bridge;
  const electron = {
    contextBridge: {
      exposeInMainWorld: (_name, value) => {
        bridge = value;
      },
    },
    ipcRenderer: {
      invoke: (...args) => {
        calls.push(args);
        return Promise.resolve({ ok: true });
      },
    },
  };
  const require = (name) => {
    assert.equal(name, "electron");
    return electron;
  };
  runInNewContext(source, { process: { isMainFrame: false }, require });
  assert.equal(bridge, undefined);
  runInNewContext(source, { process: { isMainFrame: true }, require });
  const envelope = { version: 2, readId: "r", operation: { type: "snapshot" } };
  await bridge.workbench(envelope);
  await bridge.cancelRead({ version: 2, runtimeEpoch: "e", readId: "r" });
  assert.equal(calls[0][0], "desktop:v2:workbench");
  assert.equal(calls[0][1], envelope);
  assert.equal(calls[1][0], "desktop:v2:cancel-read");
  assert.equal(source.includes("desktop:v1:workbench"), false);
});

import { createWorkbenchService } from "../workbench-service.mjs";
test("native-ready rejection retains actual recovery facade while missing IPC service remains UNAVAILABLE", async () => {
  const channels = new Map();
  let service = createWorkbenchService({
    registry: Promise.reject(
      Object.assign(new Error("owner"), { storageReason: "owner_conflict" }),
    ),
    runtimeEpoch: "current",
  });
  bindWorkbenchIpc({
    ipcMain: { handle: (name, handler) => channels.set(name, handler) },
    admit: () => true,
    service: () => service,
  });
  try {
    const response = await channels.get("desktop:v2:workbench")(
      { sender: { id: 1 } },
      { version: 2, readId: "boot", operation: { type: "snapshot" } },
    );
    assert.equal(response.ok, true);
    assert.equal(response.value.recovery.store.reason, "owner_conflict");
    assert.equal(response.value.observationSequence, 1);
    service.close();
    await service.drain();
    service = undefined;
    assert.equal(
      channels.get("desktop:v2:workbench")(
        { sender: { id: 1 } },
        { version: 2, readId: "missing", operation: { type: "snapshot" } },
      ).code,
      "UNAVAILABLE",
    );
  } finally {
    service?.close();
  }
});
