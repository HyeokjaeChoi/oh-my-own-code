import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  nextOccurrence,
  normalizeStoredJob,
  planTick,
  validateAutomationRequest,
  validateJobInput,
} from "./renderer/shared/automation/index.mjs";
import {
  deriveJobNotices,
  deriveSessionNotices,
  jobNoticeMark,
  mergeNotices,
  unionNotices,
} from "./renderer/shared/notifications/index.mjs";
import { createAutomationHost } from "./host/automation-host.mjs";
import { createNotifyHost } from "./host/notify-host.mjs";
import { createAutomationRunner } from "./host/automation-runners.mjs";

const MIN = 60000;
const job = (over = {}) => ({
  name: "야간",
  target: { workspaceId: "w1", kind: "script", script: "test" },
  schedule: { every: 15 },
  permissionMode: null,
  ...over,
});

test("validation", () => {
  assert.ok(validateJobInput(job()));
  assert.equal(validateJobInput(job({ schedule: { every: 14 } })), undefined);
  assert.equal(
    validateJobInput(job({ schedule: { daily: "24:00" } })),
    undefined,
  );
  const prompt = (over = {}) =>
    job({
      target: { workspaceId: "w1", kind: "prompt", prompt: "p" },
      permissionMode: "read_plan",
      ...over,
    });
  assert.equal(validateJobInput(prompt({ permissionMode: "yolo" })), undefined);
  assert.equal(validateJobInput(prompt({ permissionMode: null })), undefined);
  // scripts: mode must be null/absent, stored as null
  assert.equal(
    validateJobInput(job({ permissionMode: "read_plan" })),
    undefined,
  );
  const { permissionMode: _drop, ...noMode } = job();
  assert.equal(validateJobInput(noMode).permissionMode, null);
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
  await host2.runNow(created.id);
  await new Promise((r) => setImmediate(r));
  assert.equal(runs.length, 1);
  await host2.runNow(created.id);
  [v] = (await host2.list()).jobs;
  assert.equal(v.running, true);
  assert.equal(v.history[0].result, "skipped");
  assert.equal(v.history[0].reason, "이전 실행 진행 중");
  release();
  await new Promise((r) => setTimeout(r, 20));
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
  for (let i = 0; i < 60; i++) {
    await host.runNow(j.id);
    await new Promise((r) => setImmediate(r));
  }
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

const mkService = (calls, statuses, errs = []) => ({
  async handle(env) {
    calls.push(env.operation.type);
    if (env.operation.type === "snapshot")
      return {
        ok: true,
        value: {
          runtimeEpoch: "e",
          sessions: [{ id: "s1", status: statuses.shift() ?? "idle" }],
        },
      };
    const e = errs.shift();
    if (e) return { ok: false, code: e };
    return { ok: true, receipt: { result: { sessionId: "s1" } } };
  },
});
const promptJob = {
  name: "n",
  permissionMode: "ask",
  target: { workspaceId: "w1", kind: "prompt", prompt: "p" },
};

test("runner: untrusted workspace fails; prompt runs until session idle", async () => {
  const calls = [];
  const run = createAutomationRunner({
    service: (
      (svc) => () =>
        svc
    )(mkService(calls, ["running", "running", "idle"])),
    terminals: {},
    terminalRoot: (id) => (id === "w1" ? "/x" : undefined),
    wait: async () => {},
  });
  const bad = await run({
    ...promptJob,
    target: { ...promptJob.target, workspaceId: "zz" },
  });
  assert.equal(bad.result, "failed");
  const ok = await run(promptJob);
  assert.equal(ok.result, "ok");
  assert.equal(ok.sessionId, "s1");
  assert.deepEqual(calls, [
    "snapshot",
    "session.create",
    "permission.mode.set",
    "message.send",
    "snapshot",
    "snapshot",
  ]);
});

test("runner: prompt timeout, unavailable, archive, STALE_EPOCH counts as retry", async () => {
  const clock = { t: 0 };
  const base = {
    terminals: {},
    terminalRoot: () => "/x",
    wait: async () => {
      clock.t += 60 * 60 * 1000;
    },
    now: () => clock.t,
  };
  const hang = createAutomationRunner({
    ...base,
    service: (
      (svc) => () =>
        svc
    )(mkService([], Array(10).fill("running"))),
  });
  assert.equal((await hang(promptJob)).result, "timeout");
  const dead = createAutomationRunner({
    ...base,
    service: (
      (svc) => () =>
        svc
    )(mkService([], ["idle", "unavailable"])),
  });
  assert.equal((await dead(promptJob)).result, "failed");
  const calls = [];
  const arch = createAutomationRunner({
    ...base,
    service: (
      (svc) => () =>
        svc
    )(mkService(calls, [])),
  });
  await arch.archive(promptJob, "old");
  assert.ok(calls.includes("session.archive"));
  const stale = createAutomationRunner({
    ...base,
    service: (
      (svc) => () =>
        svc
    )(mkService([], [], Array(50).fill("STALE_EPOCH"))),
    busyRetries: 2,
  });
  const r = await stale(promptJob);
  assert.equal(r.result, "failed");
  assert.match(r.reason, /STALE_EPOCH/);
});

test("host: prompt sessions beyond the cap are archived oldest first", async () => {
  const clock = { t: 1_000_000 };
  const archived = [];
  let n = 0;
  const dir = await mkdtemp(join(tmpdir(), "auto-"));
  const host = createAutomationHost({
    storeFile: () => join(dir, "jobs.json"),
    run: async () => ({ result: "ok", reason: "", sessionId: `s${++n}` }),
    archive: async (_j, id) => void archived.push(id),
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  const j = await host.create(
    job({
      target: { workspaceId: "w1", kind: "prompt", prompt: "p" },
      permissionMode: "ask",
    }),
  );
  for (let i = 0; i < 7; i++) {
    await host.runNow(j.id);
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.deepEqual(archived, ["s1", "s2"]);
});

test("host: corrupt file is quarantined, invalid jobs dropped, valid kept and migrated", async () => {
  const clock = { t: 1_000_000 };
  const make = async (content) => {
    const dir = await mkdtemp(join(tmpdir(), "auto-"));
    const file = join(dir, "jobs.json");
    await writeFile(file, content);
    return {
      dir,
      file,
      host: createAutomationHost({
        storeFile: () => file,
        run: async () => ({ result: "ok", reason: "" }),
        now: () => clock.t,
        setTimer: () => ({}),
        clearTimer() {},
      }),
    };
  };
  const c = await make("{not json");
  await c.host.start();
  assert.deepEqual((await c.host.list()).jobs, []);
  const files = await readdir(c.dir);
  assert.ok(files.some((f) => f.startsWith("jobs.json.corrupt-")));
  const good = {
    id: "g",
    ...job({ permissionMode: "read_plan" }),
    enabled: true,
    anchor: 1,
    history: [],
  };
  const bad = { ...good, id: "b", history: undefined };
  const m = await make(JSON.stringify({ lastCheck: 0, jobs: [good, bad] }));
  await m.host.start();
  const { jobs, storeError } = await m.host.list();
  assert.equal(storeError, undefined);
  assert.deepEqual(
    jobs.map((x) => [x.id, x.permissionMode]),
    [["g", null]],
  );
  assert.ok(
    (await readdir(m.dir)).some((f) => f.startsWith("jobs.json.corrupt-")),
  );
  assert.equal(normalizeStoredJob({ ...good, history: "x" }), undefined);
});

test("host: unreadable file blocks saves; clock moving back does not re-run; stop blocks saves", async () => {
  const clock = { t: 10_000_000 };
  const runs = [];
  const dir = await mkdtemp(join(tmpdir(), "auto-"));
  const file = join(dir, "jobs.json");
  const host = createAutomationHost({
    storeFile: () => file,
    run: async (j) => (runs.push(j.name), { result: "ok", reason: "" }),
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  await host.create(job());
  await host.tick();
  clock.t -= 60 * MIN;
  await host.tick();
  assert.equal(JSON.parse(await readFile(file, "utf8")).lastCheck, 10_000_000);
  await host.stop();
  const before = await readFile(file, "utf8");
  await host.create(job({ name: "after-stop" }));
  assert.equal(await readFile(file, "utf8"), before);
  // directory where the file should be: read error is not ENOENT -> blocked
  const dir2 = await mkdtemp(join(tmpdir(), "auto-"));
  const h2 = createAutomationHost({
    storeFile: () => dir2,
    run: async () => ({ result: "ok", reason: "" }),
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  assert.equal((await h2.list()).storeError, true);
});

test("notify host: one OS notification per entry across windows", () => {
  const shown = [];
  const clock = { t: 0 };
  const host = createNotifyHost({
    Notification: class {
      static isSupported() {
        return true;
      }
      constructor(o) {
        this.o = o;
      }
      on() {}
      show() {
        shown.push(this.o.body);
      }
    },
    isFocused: () => false,
    focusWindow() {},
    now: () => clock.t,
  });
  host.show({ id: "n1", text: "a" });
  host.show({ id: "n1", text: "a" });
  host.show({ id: "n2", text: "a" });
  assert.equal(shown.length, 2);
  clock.t += 20000;
  host.show({ id: "n1", text: "a" });
  assert.equal(shown.length, 3);
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

test("notifications: OS text has no title; job notices honor persisted mark", () => {
  const s = (status) => ({
    sessions: [{ id: "a", workspaceId: "w", title: "비밀 제목", status }],
    permissions: [],
  });
  const [done] = deriveSessionNotices(s("running"), s("idle"), 1);
  assert.ok(done.text.includes("비밀 제목"));
  assert.ok(!done.os.includes("비밀 제목"));
  const jobs = [
    {
      name: "J",
      target: { workspaceId: "w" },
      history: [
        { id: "h1", recordedAt: 10, result: "ok" },
        { id: "h2", recordedAt: 20, result: "ok" },
      ],
    },
  ];
  assert.equal(deriveJobNotices(jobs, 5).length, 2);
  const mark = jobNoticeMark(jobs);
  assert.equal(mark, 20);
  // cleared center / reload: already-notified entries never come back
  assert.equal(deriveJobNotices(jobs, 5, mark).length, 0);
  jobs[0].history.push({ id: "h3", recordedAt: 30, result: "failed" });
  assert.deepEqual(
    deriveJobNotices(jobs, 5, mark).map((n) => n.id),
    ["job:h3"],
  );
});

test("runner: timeout interrupts and waits for idle; stop aborts", async () => {
  const clock = { t: 0 };
  const calls = [];
  const base = {
    terminals: {},
    terminalRoot: () => "/x",
    wait: async () => {
      clock.t += 60 * 60 * 1000;
    },
    now: () => clock.t,
  };
  // 2 busy reads (past 2h deadline), interrupt, then still running once, then idle.
  const run = createAutomationRunner({
    ...base,
    interruptGraceMs: 10 * 60 * 60 * 1000,
    service: () => mkService(calls, ["running", "running", "stopping", "idle"]),
  });
  const r = await run(promptJob);
  assert.equal(r.result, "timeout");
  assert.ok(calls.includes("session.interrupt"));
  assert.equal(calls.filter((c) => c === "snapshot").length >= 5, true);
  // never goes idle within grace: reason notes it may still run
  const stuck = createAutomationRunner({
    ...base,
    interruptGraceMs: 2 * 60 * 60 * 1000,
    service: () => mkService([], Array(50).fill("running")),
  });
  assert.match((await stuck(promptJob)).reason, /실행 중일 수/);
  const ac = new AbortController();
  ac.abort();
  const ab = await createAutomationRunner({
    ...base,
    service: () => mkService([], ["running"]),
  })(promptJob, ac.signal);
  assert.equal(ab.result, "failed");
  assert.equal(ab.sessionId, "s1");
  // injected clock for script timeout
  let stopped = false;
  const script = createAutomationRunner({
    ...base,
    terminals: {
      startScript: async () => ({ terminalId: "t" }),
      list: () => [{ terminalId: "t", status: "running" }],
      stop: async () => void (stopped = true),
      close: async () => {},
    },
    scriptTimeoutMs: 1000,
  });
  const sr = await script(job());
  assert.equal(sr.result, "failed");
  assert.equal(stopped, true);
});

test("host: busy retained session skips run and is never archived; legacy ids migrate", async () => {
  const clock = { t: 1_000_000 };
  const dir = await mkdtemp(join(tmpdir(), "auto-"));
  const file = join(dir, "jobs.json");
  const busy = new Set(["s1"]);
  const archived = [];
  const runs = [];
  const prompt = { workspaceId: "w1", kind: "prompt", prompt: "p" };
  await writeFile(
    file,
    JSON.stringify({
      lastCheck: 0,
      jobs: [
        {
          id: "j",
          ...job({ target: prompt, permissionMode: "ask" }),
          enabled: true,
          anchor: 1,
          history: [],
          sessionIds: ["s1", "s2", "s3", "s4", "s5"],
        },
      ],
    }),
  );
  const host = createAutomationHost({
    storeFile: () => file,
    run: async () => (
      runs.push(1),
      { result: "ok", reason: "", sessionId: "s6" }
    ),
    archive: async (_j, id, ws) => void archived.push([id, ws]),
    isIdle: async (id) => !busy.has(id),
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  await host.runNow("j");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs.length, 0);
  assert.equal((await host.list()).jobs[0].history[0].result, "skipped");
  busy.clear();
  busy.add("s1");
  // s1 idle again but another session busy -> still skipped; free all -> runs, archives s1 with its workspace
  busy.clear();
  await host.runNow("j");
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(runs.length, 1);
  assert.deepEqual(archived, [["s1", "w1"]]);
  const saved = JSON.parse(await readFile(file, "utf8")).jobs[0].sessionIds;
  assert.deepEqual(saved[0], { sessionId: "s2", workspaceId: "w1" });
});

test("host: recovered info, STORE_BLOCKED, clock moved far back, stop aborts runners", async () => {
  const clock = { t: 100 * 60 * MIN };
  const dir = await mkdtemp(join(tmpdir(), "auto-"));
  const file = join(dir, "jobs.json");
  const good = {
    id: "g",
    ...job(),
    enabled: true,
    anchor: 1,
    history: [],
  };
  await writeFile(
    file,
    JSON.stringify({
      lastCheck: clock.t,
      jobs: [good, { ...good, id: "b", history: 1 }],
    }),
  );
  let signal;
  const host = createAutomationHost({
    storeFile: () => file,
    run: (_j, s) => ((signal = s), new Promise(() => {})),
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  const l = await host.list();
  assert.equal(l.recovered.count, 1);
  assert.match(l.recovered.backup, /^jobs\.json\.corrupt-/);
  clock.t -= 3 * 60 * MIN;
  await host.tick();
  assert.equal(JSON.parse(await readFile(file, "utf8")).lastCheck, clock.t);
  assert.match((await host.list()).jobs[0].history[0].reason, /시계/);
  await host.runNow("g");
  await new Promise((r) => setImmediate(r));
  await host.stop();
  assert.equal(signal.aborted, true);
  const blocked = createAutomationHost({
    storeFile: () => dir,
    run: async () => ({ result: "ok", reason: "" }),
    now: () => clock.t,
    setTimer: () => ({}),
    clearTimer() {},
  });
  for (const f of [
    () => blocked.create(job()),
    () => blocked.update("x", job()),
    () => blocked.remove("x"),
  ])
    await assert.rejects(f, { automationCode: "STORE_BLOCKED" });
});

test("notifications: union keeps both windows' entries", () => {
  const n = (id, at, read = false) => ({
    id,
    at,
    read,
    kind: "done",
    text: id,
  });
  const u = unionNotices([n("a", 1), n("b", 3)], [n("a", 1, true), n("c", 2)]);
  assert.deepEqual(
    u.map((x) => [x.id, x.read]),
    [
      ["b", false],
      ["c", false],
      ["a", true],
    ],
  );
});
