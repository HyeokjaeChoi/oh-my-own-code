import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  nextOccurrence,
  planTick,
  validateAutomationRequest,
  validateJobInput,
} from "./renderer/shared/automation/index.mjs";
import {
  deriveJobNotices,
  deriveSessionNotices,
  mergeNotices,
} from "./renderer/shared/notifications/index.mjs";
import { createAutomationHost } from "./host/automation-host.mjs";
import { createAutomationRunner } from "./host/automation-runners.mjs";

const MIN = 60000;
const job = (over = {}) => ({
  name: "야간",
  target: { workspaceId: "w1", kind: "script", script: "test" },
  schedule: { every: 15 },
  permissionMode: "read_plan",
  ...over,
});

test("validation", () => {
  assert.ok(validateJobInput(job()));
  assert.equal(validateJobInput(job({ schedule: { every: 14 } })), undefined);
  assert.equal(
    validateJobInput(job({ schedule: { daily: "24:00" } })),
    undefined,
  );
  assert.equal(validateJobInput(job({ permissionMode: "yolo" })), undefined);
  assert.equal(validateJobInput({ ...job(), extra: 1 }), undefined);
  assert.equal(
    validateJobInput(
      job({ target: { workspaceId: "w", kind: "script", script: "a b" } }),
    ),
    undefined,
  );
  assert.equal(
    validateAutomationRequest({ type: "automation.create" }),
    undefined,
  );
  assert.ok(validateAutomationRequest({ type: "automation.list" }));
});

test("next occurrence every/daily", () => {
  assert.equal(
    nextOccurrence({ every: 15 }, 100 * MIN + 1, 100 * MIN),
    115 * MIN,
  );
  assert.equal(nextOccurrence({ every: 15 }, 0, 100 * MIN), 115 * MIN);
  const after = new Date(2026, 2, 8, 12, 0).getTime();
  const next = new Date(nextOccurrence({ daily: "09:30" }, after, 0));
  assert.deepEqual(
    [next.getDate(), next.getHours(), next.getMinutes()],
    [9, 9, 30],
  );
  const same = new Date(nextOccurrence({ daily: "13:00" }, after, 0));
  assert.equal(same.getDate(), 8);
});

test("planTick: missed never due on startup; grace runs newest only", () => {
  const s = { every: 15 };
  const off = planTick({
    schedule: s,
    anchor: 0,
    lastCheck: 0,
    now: 100 * MIN,
    startup: true,
  });
  assert.equal(off.due, undefined);
  assert.equal(off.missed.count, 6);
  const live = planTick({
    schedule: s,
    anchor: 0,
    lastCheck: 0,
    now: 91 * MIN,
  });
  assert.equal(live.due, 90 * MIN);
  assert.equal(live.missed.count, 5);
  const none = planTick({
    schedule: s,
    anchor: 0,
    lastCheck: 91 * MIN,
    now: 92 * MIN,
  });
  assert.deepEqual(none, { due: undefined, missed: undefined });
});

async function fixture({ run, clock }) {
  const dir = await mkdtemp(join(tmpdir(), "auto-"));
  const file = join(dir, "jobs.json");
  const host = createAutomationHost({
    storeFile: () => file,
    run,
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  return { host, file };
}

test("host: missed on restart is recorded, not run; overlap skipped", async () => {
  const clock = { t: 1_000_000 };
  const runs = [];
  let release;
  const run = (j) => {
    runs.push(j.name);
    return new Promise(
      (r) => (release = () => r({ result: "ok", reason: "x" })),
    );
  };
  const { host, file } = await fixture({ run, clock });
  const created = await host.create(job());
  await host.tick();
  clock.t += 100 * MIN;
  const host2 = createAutomationHost({
    storeFile: () => file,
    run,
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  await host2.start();
  assert.equal(runs.length, 0);
  let [v] = (await host2.list()).jobs;
  assert.equal(v.history[0].result, "missed");
  assert.ok(v.history[0].count >= 6);
  // overlap: first run-now hangs, second is skipped
  const first = host2.runNow(created.id);
  await new Promise((r) => setImmediate(r));
  await host2.runNow(created.id);
  [v] = (await host2.list()).jobs;
  assert.equal(v.running, true);
  assert.equal(v.history[0].result, "skipped");
  release();
  await first;
  [v] = (await host2.list()).jobs;
  assert.equal(v.history[0].result, "ok");
  assert.equal(
    JSON.parse(await readFile(file, "utf8")).jobs[0].history.length,
    3,
  );
});

test("host: pause/resume resets phase, history capped", async () => {
  const clock = { t: 5_000_000 };
  const { host } = await fixture({
    run: async () => ({ result: "ok", reason: "" }),
    clock,
  });
  const j = await host.create(job());
  for (let i = 0; i < 60; i++) await host.runNow(j.id);
  assert.equal((await host.list()).jobs[0].history.length, 50);
  await host.setEnabled(j.id, false);
  assert.equal((await host.list()).jobs[0].nextAt, null);
  clock.t += 500 * MIN;
  await host.setEnabled(j.id, true);
  await host.tick();
  assert.equal(
    (await host.list()).jobs[0].history.some((h) => h.result === "missed"),
    false,
  );
});

test("runner: untrusted workspace fails; prompt goes through service in order", async () => {
  const calls = [];
  const service = () => ({
    async handle(env) {
      calls.push(env.operation.type);
      if (env.operation.type === "snapshot")
        return { ok: true, value: { runtimeEpoch: "e" } };
      return { ok: true, receipt: { result: { sessionId: "s1" } } };
    },
  });
  const run = createAutomationRunner({
    service,
    terminals: {},
    terminalRoot: (id) => (id === "w1" ? "/x" : undefined),
    wait: async () => {},
  });
  const bad = await run({
    name: "n",
    permissionMode: "ask",
    target: { workspaceId: "zz", kind: "prompt", prompt: "p" },
  });
  assert.equal(bad.result, "failed");
  const ok = await run({
    name: "n",
    permissionMode: "ask",
    target: { workspaceId: "w1", kind: "prompt", prompt: "p" },
  });
  assert.equal(ok.result, "ok");
  assert.deepEqual(calls, [
    "snapshot",
    "session.create",
    "permission.mode.set",
    "message.send",
  ]);
});

test("notifications: transitions and no content in text", () => {
  const s = (status, title = "내 작업") => ({
    sessions: [{ id: "a", workspaceId: "w", title, status }],
    permissions: [],
  });
  assert.deepEqual(deriveSessionNotices(undefined, s("idle"), 1), []);
  assert.deepEqual(deriveSessionNotices(s("idle"), s("running"), 1), []);
  const [done] = deriveSessionNotices(s("running"), s("idle"), 1);
  assert.equal(done.text, "세션 '내 작업' 작업 완료");
  assert.equal(
    deriveSessionNotices(s("running"), s("unavailable"), 1)[0].kind,
    "error",
  );
  const withPerm = {
    ...s("running"),
    permissions: [
      { id: "p1", sessionId: "a", title: "SECRET", detail: "rm -rf /secret" },
    ],
  };
  const [ap] = deriveSessionNotices(s("running"), withPerm, 1);
  assert.equal(ap.kind, "approval");
  assert.ok(
    !JSON.stringify(ap).includes("SECRET") &&
      !JSON.stringify(ap).includes("secret"),
  );
  assert.equal(deriveSessionNotices(withPerm, withPerm, 2).length, 0);
  const jobs = [
    {
      name: "J",
      target: { workspaceId: "w" },
      history: [
        {
          id: "h1",
          recordedAt: 10,
          result: "missed",
          count: 3,
          reason: "/path/secret",
        },
        { id: "h0", recordedAt: 1, result: "ok" },
      ],
    },
  ];
  const jn = deriveJobNotices(jobs, 5);
  assert.equal(jn.length, 1);
  assert.equal(jn[0].text, "자동화 'J' 놓친 실행 3건");
  const m1 = mergeNotices([], jn, 9);
  assert.equal(mergeNotices(m1.list, jn, 10).added.length, 0);
});
