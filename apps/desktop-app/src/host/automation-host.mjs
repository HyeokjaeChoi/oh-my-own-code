import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
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
// archive(job, sessionId) archives an old prompt-run session (never deletes).
export function createAutomationHost({
  storeFile,
  run,
  archive = async () => {},
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
  // Corrupt data is moved aside, never overwritten; if that fails, saving is refused.
  const quarantine = async (content) => {
    try {
      await writeFile(`${storeFile()}.corrupt-${now()}`, content);
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
        await quarantine(raw);
        return;
      }
      const jobs = v.jobs.map(normalizeStoredJob);
      const dropped = v.jobs.filter((_, i) => !jobs[i]);
      if (dropped.length) await quarantine(JSON.stringify(dropped));
      state = {
        lastCheck: Number.isFinite(v.lastCheck) ? v.lastCheck : 0,
        jobs: jobs.filter(Boolean).slice(0, AUTOMATION_LIMITS.jobs),
      };
    })());
  const save = () =>
    serial(async () => {
      if (stopped || blocked) return;
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

  async function execute(job, scheduledAt) {
    if (running.has(job.id)) {
      record(job, {
        scheduledAt,
        startedAt: null,
        result: "skipped",
        reason: "이전 실행 진행 중",
      });
      return save();
    }
    running.add(job.id);
    const startedAt = now();
    let outcome;
    try {
      outcome = await run(globalThis.structuredClone(job));
    } catch {
      outcome = { result: "failed", reason: "실행 중 오류가 발생했습니다." };
    } finally {
      running.delete(job.id);
    }
    if (stopped) return;
    if (outcome.sessionId) {
      job.sessionIds = [...(job.sessionIds ?? []), outcome.sessionId];
      while (job.sessionIds.length > AUTOMATION_LIMITS.retainedSessions) {
        const old = job.sessionIds.shift();
        await archive(globalThis.structuredClone(job), old).catch(() => {});
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
      clearTimer(timer);
      timer = undefined;
      await queue;
    },
    tick,
    async list() {
      await load();
      return {
        startedAt,
        jobs: state.jobs.map(view),
        ...(blocked ? { storeError: true } : {}),
      };
    },
    async create(input) {
      await load();
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
      const job = find(jobId);
      Object.assign(job, input, { anchor: now() });
      await save();
      return view(job);
    },
    async setEnabled(jobId, enabled) {
      await load();
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
