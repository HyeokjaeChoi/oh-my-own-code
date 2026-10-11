import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { clearInterval, setInterval } from "node:timers";
import {
  AUTOMATION_LIMITS,
  nextOccurrence,
  planTick,
} from "../renderer/shared/automation/index.mjs";

const fail = (code) => Object.assign(new Error(code), { automationCode: code });

// Main-owned scheduler for local recurring jobs. Runs only while the app runs.
// Elapsed occurrences while the app was off (or asleep past the grace) are recorded as `missed`, never run.
// run(job) -> Promise<{ result: "ok" | "failed", reason: string }>
export function createAutomationHost({
  storeFile,
  run,
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
  const load = () =>
    (loaded ??= (async () => {
      try {
        const v = JSON.parse(await readFile(storeFile(), "utf8"));
        if (v && Array.isArray(v.jobs))
          state = {
            lastCheck: Number.isFinite(v.lastCheck) ? v.lastCheck : 0,
            jobs: v.jobs.slice(0, AUTOMATION_LIMITS.jobs),
          };
      } catch {
        // Missing or corrupt file: start empty.
      }
    })());
  const save = () =>
    serial(async () => {
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
        reason: "이전 실행이 아직 진행 중입니다.",
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
    record(job, {
      scheduledAt,
      startedAt,
      result: outcome.result === "ok" ? "ok" : "failed",
      reason: String(outcome.reason ?? "").slice(0, 200),
    });
    return save();
  }

  async function tick() {
    await load();
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
    state.lastCheck = t;
    await save();
    // Fire and forget: overlap is handled per job inside execute().
    for (const [job, at] of due) void execute(job, at);
  }

  return {
    async start() {
      startedAt = now();
      startup = true;
      await tick();
      timer = setTimer(() => void tick().catch(() => {}), tickMs);
      timer.unref?.();
    },
    stop() {
      clearTimer(timer);
      timer = undefined;
    },
    tick,
    async list() {
      await load();
      return { startedAt, jobs: state.jobs.map(view) };
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
      await execute(job, now());
      return view(job);
    },
  };
}
