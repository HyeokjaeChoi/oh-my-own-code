import assert from "node:assert/strict";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { startSidecar } from "../../src/sidecar-supervisor.mjs";
import { createWorkbenchService } from "../../src/workbench-service.mjs";

// Production service + actual SDK. Imported messages are synthetic stored data,
// not model output. This probe is separate from the production Electron UI.
export async function probeSessionHistory(root) {
  const binary = process.platform === "win32" ? "opencode.exe" : "opencode";
  const runtime = await startSidecar({
    binaryPath: join(
      root,
      "apps/desktop-app/dist/resources/opencode",
      `${process.platform}-${process.arch}`,
      binary,
    ),
  });
  let service;
  try {
    const { client, session } = runtime.workbenchContext();
    const transfer = await client.session.export({ sessionID: session.id });
    transfer.messages = [
      {
        id: "msg_fixture001",
        type: "user",
        time: { created: Date.now() },
        text: "Synthetic history retained through fork.",
      },
    ];
    await client.session.remove({ sessionID: session.id });
    await client.session.import(transfer);
    const sentinel = join(runtime.workspace, "keep.txt");
    await writeFile(sentinel, "preserved");
    let dialogs = 0;
    service = createWorkbenchService({
      runtime,
      // Service-only legacy fixture adapter; never admitted by main/preload.
      trustedTestAdapter: true,
      pickDirectory: async () => undefined,
      confirmTrust: async () => false,
      confirmSessionRemoval: async () => {
        dialogs++;
        return true;
      },
    });
    const unwrap = (result) => {
      assert.equal(result.ok, true, JSON.stringify(result));
      return result.value;
    };
    const initial = unwrap(await service.handle({ type: "snapshot" }));
    const target = {
      workspaceId: initial.selectedWorkspaceId,
      sessionId: initial.selectedSessionId,
    };
    assert.equal(initial.messages[0].text, transfer.messages[0].text);
    const request = {
      type: "session.fork",
      ...target,
      requestId: "populated-fork",
      title: "Retained history",
    };
    const fork = unwrap(await service.handle(request));
    const childId = fork.selectedSessionId;
    assert.notEqual(childId, target.sessionId);
    assert.equal(
      fork.sessions.find((s) => s.id === childId).parentSessionId,
      target.sessionId,
    );
    const child = unwrap(
      await service.handle({
        type: "snapshot",
        workspaceId: target.workspaceId,
        sessionId: childId,
      }),
    );
    assert.deepEqual(
      child.messages.map((m) => [m.role, m.text]),
      initial.messages.map((m) => [m.role, m.text]),
    );
    assert.equal(
      unwrap(await service.handle(request)).sessions.length,
      fork.sessions.length,
    );
    assert.equal(
      (
        await service.handle({
          type: "session.remove",
          ...target,
          requestId: "registered-child-refusal",
        })
      ).code,
      "HAS_DESCENDANTS",
    );
    assert.equal(dialogs, 0);
    const remove = {
      type: "session.remove",
      workspaceId: target.workspaceId,
      sessionId: childId,
      requestId: "remove-history-child",
    };
    unwrap(await service.handle(remove));
    unwrap(await service.handle(remove));
    assert.equal(dialogs, 1);
    // A child created after a lost reply is not in the app registry. SDK fork
    // lineage must protect it even though the SDK's parentID field is absent.
    const unregistered = await client.session.fork({ sessionID: session.id });
    assert.equal(unregistered.fork.sessionID, session.id);
    assert.equal(
      (
        await service.handle({
          type: "session.remove",
          ...target,
          requestId: "unregistered-fork-refusal",
        })
      ).code,
      "HAS_DESCENDANTS",
    );
    assert.equal(dialogs, 1);
    await client.session.remove({ sessionID: unregistered.id });
    unwrap(
      await service.handle({
        type: "session.remove",
        ...target,
        requestId: "remove-history-parent",
      }),
    );
    assert.equal(await readFile(sentinel, "utf8"), "preserved");
    return "Production service with real SDK preserves imported synthetic history through fork, blocks registered/unregistered fork descendants, prevents duplicate effects and preserves project files";
  } finally {
    service?.close();
    const cleanup = await runtime.stop();
    assert.equal(cleanup.exited, true);
    assert.equal(cleanup.cleanup, "complete");
  }
}
