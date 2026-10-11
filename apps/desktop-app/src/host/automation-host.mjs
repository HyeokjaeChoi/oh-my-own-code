import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { basename, dirname } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import {
  AUTOMATION_LIMITS,
  nextOccurrence,
  normalizeStoredJob,
  planTick,
} from "../renderer/shared/automation/index.mjs";

const fail = (code) => Object.assign(new Error(code), { automationCode: code });

// Main-owned scheduler for local recurring jobs. Runs only while the app runs.
// Elapsed occurrences while the app was off (or asleep past the grace) are recorded as `missed`, never run.
// run(job) -> Promise<{ result: "ok" | "failed" | "timeout", reason: string, sessionId?: string }>
// archive(job, sessionId, workspaceId) archives an old prompt-run session (never deletes).
export function createAutomationHost({
  storeFile,
  run,
  archive = run.archive ?? (async () => {}),
  isIdle = run.isIdle ?? (async () => true),
  now = Date.now,
  tickMs = 30000,
  setTimer = setInterval,
  clearTimer = clearInterval,
}) {
  let state = { lastCheck: 0, jobs: [] };
  let loaded;
  let startedAt = 0;
  let startup = true;
  let timer;
  const running = new Set();
  const inflight = new Set();
  let queue = Promise.resolve();
  const serial = (fn) => {
    const r = queue.then(fn, fn);
    queue = r.then(
      () => undefined,
      () => undefined,
    );
    return r;
  };
  let stopped = false;
  let blocked = false;
  let recovered;
  let abort = new AbortController();
  // Set once stop() has settled: nothing may touch the service or the store after that.
  let closed = new AbortController();
  // Corrupt data is moved aside, never overwritten; if that fails, saving is refused.
  const quarantine = async (content) => {
    try {
      const file = `${storeFile()}.corrupt-${now()}`;
      await writeFile(file, content);
      return basename(file);
    } catch {
      blocked = true;
    }
  };
  const load = () =>
    (loaded ??= (async () => {
      let raw;
      try {
        raw = await readFile(storeFile(), "utf8");
      } catch (e) {
        if (e?.code !== "ENOENT") blocked = true;
        return;
      }
      let v;
      try {
        v = JSON.parse(raw);
      } catch {
        v = undefined;
      }
      if (!v || !Array.isArray(v.jobs)) {
        const backup = await quarantine(raw);
        if (backup) recovered = { count: 0, backup };
        return;
      }
      const jobs = v.jobs.map(normalizeStoredJob);
      const dropped = v.jobs.filter((_, i) => !jobs[i]);
      if (dropped.length) {
        const backup = await quarantine(JSON.stringify(dropped));
        if (backup) recovered = { count: dropped.length, backup };
      }
      state = {
        lastCheck: Number.isFinite(v.lastCheck) ? v.lastCheck : 0,
        jobs: jobs.filter(Boolean).slice(0, AUTOMATION_LIMITS.jobs),
      };
    })());
  const save = (force = false) =>
    serial(async () => {
      if (closed.signal.aborted || (stopped && !force) || blocked) return;
      const file = storeFile();
      await mkdir(dirname(file), { recursive: true });
      await writeFile(`${file}.tmp`, JSON.stringify(state));
      await rename(`${file}.tmp`, file);
    });
  const record = (job, entry) => {
    job.history.push({ id: randomUUID(), recordedAt: now(), ...entry });
    if (job.history.length > AUTOMATION_LIMITS.history)
      job.history.splice(0, job.history.length - AUTOMATION_LIMITS.history);
  };
  const find = (jobId) => {
    const job = state.jobs.find((j) => j.id === jobId);
    if (!job) throw fail("NOT_FOUND");
    return job;
  };
  const view = (j) => ({
    id: j.id,
    name: j.name,
    target: j.target,
    schedule: j.schedule,
    permissionMode: j.permissionMode,
    enabled: j.enabled,
    running: running.has(j.id),
    nextAt: j.enabled ? nextOccurrence(j.schedule, now(), j.anchor) : null,
    history: j.history.slice().reverse(),
  });

  const execute = (job, scheduledAt) => {
    const p = executeJob(job, scheduledAt);
    inflight.add(p);
    const done = () => inflight.delete(p);
    p.then(done, done);
    return p;
  };
  async function executeJob(job, scheduledAt) {
    if (running.has(job.id)) {
      record(job, {
        scheduledAt,
        startedAt: null,
        result: "skipped",
        reason: "이전 실행 진행 중",
      });
      return save();
    }
    // A retained session that is still working (e.g. a timed-out run) blocks a new prompt run.
    if (job.target.kind === "prompt") {
      // Only the latest run's session counts: one the user adopted earlier must not block forever.
      const s = job.sessionIds?.at(-1);
      if (s && !(await isIdle(s.sessionId, s.workspaceId))) {
        record(job, {
          scheduledAt,
          startedAt: null,
          result: "skipped",
          reason: "이전 세션이 아직 실행 중",
        });
        return save();
      }
    }
    running.add(job.id);
    const startedAt = now();
    let outcome;
    try {
      outcome = await run(
        globalThis.structuredClone(job),
        abort.signal,
        closed.signal,
      );
    } catch {
      outcome = { result: "failed", reason: "실행 중 오류가 발생했습니다." };
    } finally {
      running.delete(job.id);
    }
    if (stopped) {
      // Keep the session reachable for later archiving; no archiving or history while shutting down.
      if (outcome.sessionId) {
        job.sessionIds = [
          ...(job.sessionIds ?? []),
          { sessionId: outcome.sessionId, workspaceId: job.target.workspaceId },
        ];
        return save(true);
      }
      return;
    }
    if (outcome.sessionId) {
      job.sessionIds = [
        ...(job.sessionIds ?? []),
        { sessionId: outcome.sessionId, workspaceId: job.target.workspaceId },
      ];
      while (job.sessionIds.length > AUTOMATION_LIMITS.retainedSessions) {
        const [old] = job.sessionIds;
        // Never archive a session that is still working; retry on a later run.
        if (!(await isIdle(old.sessionId, old.workspaceId))) break;
        job.sessionIds.shift();
        await archive(
          globalThis.structuredClone(job),
          old.sessionId,
          old.workspaceId,
        ).catch(() => {});
      }
    }
    record(job, {
      scheduledAt,
      startedAt,
      result: ["ok", "timeout"].includes(outcome.result)
        ? outcome.result
        : "failed",
      reason: String(outcome.reason ?? "").slice(0, 200),
    });
    return save();
  }

  async function tick() {
    await load();
    if (stopped) return;
    const t = now();
    // Clock moved far back: re-base instead of silently stalling until it catches up.
    if (t < state.lastCheck - AUTOMATION_LIMITS.clockBackMs) {
      state.lastCheck = t;
      for (const job of state.jobs)
        if (job.enabled)
          record(job, {
            scheduledAt: t,
            startedAt: null,
            result: "skipped",
            reason: "시스템 시계가 과거로 이동해 기준 시각을 재설정했습니다.",
          });
    }
    for (const job of state.jobs)
      if (job.anchor > t + AUTOMATION_LIMITS.clockBackMs) job.anchor = t;
    const wasStartup = startup;
    startup = false;
    const due = [];
    for (const job of state.jobs) {
      if (!job.enabled) continue;
      const plan = planTick({
        schedule: job.schedule,
        anchor: job.anchor,
        lastCheck: state.lastCheck,
        now: t,
        startup: wasStartup,
      });
      if (plan.missed)
        record(job, {
          scheduledAt: plan.missed.first,
          startedAt: null,
          result: "missed",
          reason:
            "앱이 꺼져 있어 실행되지 않았습니다. 자동으로 다시 실행하지 않습니다.",
          count: plan.missed.count,
          last: plan.missed.last,
        });
      if (plan.due !== undefined) due.push([job, plan.due]);
    }
    state.lastCheck = Math.max(state.lastCheck, t);
    await save();
    // Fire and forget: overlap is handled per job inside execute().
    for (const [job, at] of due) void execute(job, at).catch(() => {});
  }

  return {
    async start() {
      stopped = false;
      if (abort.signal.aborted) {
        abort = new AbortController();
        closed = new AbortController();
      }
      startedAt = now();
      startup = true;
      await tick();
      timer = setTimer(() => void tick().catch(() => {}), tickMs);
      timer.unref?.();
    },
    // Blocks further saves, then waits for the write already in flight. Running jobs are not awaited
    // (a prompt run may last hours); their results are discarded.
    async stop() {
      stopped = true;
      abort.abort();
      clearTimer(timer);
      timer = undefined;
      // Runners notice the abort within one poll; bounded so a stuck runner cannot hang quit.
      await Promise.race([
        Promise.allSettled([...inflight]),
        new Promise((r) => {
          setTimeout(r, 3000).unref();
        }),
      ]);
      closed.abort();
      await queue;
    },
    tick,
    async list() {
      await load();
      return {
        startedAt,
        jobs: state.jobs.map(view),
        ...(blocked ? { storeError: true } : {}),
        ...(recovered ? { recovered } : {}),
      };
    },
    async create(input) {
      await load();
      if (blocked) throw fail("STORE_BLOCKED");
      if (state.jobs.length >= AUTOMATION_LIMITS.jobs)
        throw fail("LIMIT_REACHED");
      const job = {
        id: randomUUID(),
        ...input,
        enabled: true,
        anchor: now(),
        history: [],
        sessionIds: [],
      };
      state.jobs.push(job);
      await save();
      return view(job);
    },
    async update(jobId, input) {
      await load();
      if (blocked) throw fail("STORE_BLOCKED");
      const job = find(jobId);
      Object.assign(job, input, { anchor: now() });
      await save();
      return view(job);
    },
    async setEnabled(jobId, enabled) {
      await load();
      if (blocked) throw fail("STORE_BLOCKED");
      const job = find(jobId);
      if (job.enabled !== enabled) {
        job.enabled = enabled;
        // Resuming starts a fresh phase: the paused span is neither run nor reported missed.
        if (enabled) job.anchor = now();
        await save();
      }
      return view(job);
    },
    async remove(jobId) {
      await load();
      if (blocked) throw fail("STORE_BLOCKED");
      find(jobId);
      state.jobs = state.jobs.filter((j) => j.id !== jobId);
      await save();
      return true;
    },
    async runNow(jobId) {
      await load();
      const job = find(jobId);
      // Fire and forget: the result lands in history; prompt runs can last hours.
      void execute(job, now()).catch(() => {});
      return view(job);
    },
  };
}
