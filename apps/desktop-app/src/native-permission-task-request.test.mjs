import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createNativeTaskRequestContext,
  NATIVE_TASK_HANDOFF_HEADER,
} from "./native-permission-task-request.mjs";
test("Main request handoff correlates concurrent actual fetches without leaking headers", async () => {
  const context = createNativeTaskRequestContext();
  const rows = [];
  const fetch = context.wrapFetch(async (request, init) => {
    rows.push([request, init]);
    return init.headers.get(NATIVE_TASK_HANDOFF_HEADER);
  });
  const first = randomUUID(),
    second = randomUUID();
  const a = context.invoke(context.issue(first), async () => {
    await Promise.resolve();
    return fetch("http://127.0.0.1/a", {
      headers: { authorization: "synthetic-only" },
    });
  });
  const b = context.invoke(context.issue(second), async () => {
    await Promise.resolve();
    return fetch("http://127.0.0.1/b");
  });
  assert.deepEqual(await Promise.all([a, b]), [first, second]);
  assert.equal(await fetch("http://127.0.0.1/read"), null);
  assert.equal(rows[0][1].headers.get("authorization"), "synthetic-only");
  assert.ok(rows.every(([, init]) => init.redirect === "error"));
});
test("Main request handoff rejects forged handles, reuse, nesting and caller headers", async () => {
  const context = createNativeTaskRequestContext();
  const id = randomUUID(),
    handle = context.issue(id);
  assert.throws(() => context.invoke({}, () => {}));
  assert.throws(() => context.issue(id));
  context.invoke(handle, () =>
    assert.throws(() => context.invoke(context.issue(randomUUID()), () => {})),
  );
  assert.throws(() => context.invoke(handle, () => {}));
  const fetch = context.wrapFetch(() => {
    throw new Error("must not fetch");
  });
  assert.throws(() =>
    fetch("http://127.0.0.1", {
      headers: { [NATIVE_TASK_HANDOFF_HEADER]: randomUUID() },
    }),
  );
});
test("Main request close revokes pending fetch without claiming actual-call settlement", async () => {
  const context = createNativeTaskRequestContext();
  let release;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const fetch = context.wrapFetch(() => {
    throw new Error("must not fetch");
  });
  const actual = context.invoke(context.issue(randomUUID()), async () => {
    await wait;
    return fetch("http://127.0.0.1");
  });
  context.close();
  release();
  await assert.rejects(actual, /native_permission_task_request/);
  assert.throws(() => context.issue(randomUUID()));
});
test("Main request wrapper preserves Request headers and payload without mutation", async () => {
  const context = createNativeTaskRequestContext();
  const request = new globalThis.Request("http://127.0.0.1", {
    method: "POST",
    body: "exact",
    headers: { authorization: "synthetic-only" },
  });
  const id = randomUUID();
  let captured;
  const fetch = context.wrapFetch((r, init) => {
    captured = [r, init];
    return Promise.resolve();
  });
  await context.invoke(context.issue(id), () => fetch(request));
  assert.equal(captured[0], request);
  assert.equal(captured[1].headers.get(NATIVE_TASK_HANDOFF_HEADER), id);
  assert.equal(request.headers.has(NATIVE_TASK_HANDOFF_HEADER), false);
  assert.equal(await request.text(), "exact");
});
test("Main request correlation cannot leak into detached callbacks after original RPC returns", async () => {
  const context = createNativeTaskRequestContext();
  let release,
    tail,
    calls = 0;
  const wait = new Promise((resolve) => {
    release = resolve;
  });
  const fetch = context.wrapFetch(() => {
    calls++;
    return Promise.resolve();
  });
  await context.invoke(context.issue(randomUUID()), () => {
    tail = wait.then(() => fetch("http://127.0.0.1"));
    return "returned";
  });
  release();
  await assert.rejects(tail, /native_permission_task_request/);
  assert.equal(calls, 0);
});

test("actual supervisor fetch refuses lost owner and stop during asynchronous ownership check", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(
    new URL("./event-host-supervisor.mjs", import.meta.url),
    "utf8",
  );
  const marker = "fetch: nativeTaskRequests.wrapFetch(";
  const begin = source.indexOf(marker);
  const end = source.indexOf("\n        });", begin);
  assert.ok(begin >= 0 && end > begin);
  const expression = source
    .slice(begin + "fetch: ".length, end)
    .trim()
    .replace(/,$/u, "");
  const extract = new Function(
    "nativeTaskRequests",
    "owner",
    "live",
    "fetch",
    "fail",
    `let stopping = false, uncertain = false; return { fetch: (${expression}), stop() { stopping = true; } };`,
  );
  let calls = 0;
  const effect = () => {
    calls++;
    return Promise.resolve();
  };
  const lost = extract(
    createNativeTaskRequestContext(),
    {
      getNonce: () => "synthetic",
      assertOwned: async () => ({ state: "recovery_required" }),
    },
    () => {},
    effect,
    () => {},
  );
  await assert.rejects(lost.fetch("http://127.0.0.1"), /owner_unverified/);
  assert.equal(calls, 0);
  let resolve;
  const owned = new Promise((r) => {
    resolve = r;
  });
  const stopping = extract(
    createNativeTaskRequestContext(),
    { getNonce: () => "synthetic", assertOwned: () => owned },
    () => {},
    effect,
    () => {},
  );
  const pending = stopping.fetch("http://127.0.0.1");
  stopping.stop();
  resolve({ state: "ready" });
  await assert.rejects(pending, /event_host_held/);
  assert.equal(calls, 0);
  // Ownership verification itself can yield beyond the original invocation.
  // A header already copied before that wait is not continuing authority.
  const context = createNativeTaskRequestContext();
  let releaseOwner, detached;
  const ownerWait = new Promise((r) => {
    releaseOwner = r;
  });
  const late = extract(
    context,
    { getNonce: () => "synthetic", assertOwned: () => ownerWait },
    () => {},
    effect,
    () => {},
  );
  await context.invoke(context.issue(randomUUID()), () => {
    detached = late.fetch("http://127.0.0.1");
    return "original RPC returned";
  });
  releaseOwner({ state: "ready" });
  await assert.rejects(detached, /native_permission_task_request/);
  assert.equal(calls, 0);
});
