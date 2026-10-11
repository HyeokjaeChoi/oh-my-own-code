import { randomUUID } from "node:crypto";
import { AUTOMATION_LIMITS } from "../renderer/shared/automation/index.mjs";

const OWNER = "automation";
const BUSY = new Set(["running", "stopping"]);
const sleep = (ms) =>
  new Promise((r) => {
    setTimeout(r, ms).unref?.();
  });

// Runs one job through the same paths the UI uses: workbench service (session.create ->
// permission.mode.set -> message.send) or the terminal host. Never bypasses trust checks.
export function createAutomationRunner({
  service,
  terminals,
  terminalRoot,
  wait = sleep,
  now = Date.now,
  promptTimeoutMs = AUTOMATION_LIMITS.promptTimeoutMs,
  scriptTimeoutMs = 10 * 60 * 1000,
  pollMs = 1000,
  busyRetries = 6,
  interruptGraceMs = 2 * 60 * 1000,
}) {
  let epoch;
  // `closed` aborts once the host has given up on us: nothing may reach the service after that.
  async function send(operation, closed, retries = busyRetries) {
    const gate = () => {
      if (closed?.aborted) throw new Error("CLOSED");
    };
    for (let i = 0; ; i++) {
      gate();
      if (!epoch) {
        const snap = await service().handle(
          { version: 2, readId: randomUUID(), operation: { type: "snapshot" } },
          OWNER,
        );
        epoch = snap?.value?.runtimeEpoch;
        if (!epoch) throw new Error("UNAVAILABLE");
      }
      gate();
      const operationId = randomUUID();
      const op =
        "requestId" in operation
          ? { ...operation, requestId: operationId }
          : operation;
      const res = await service().handle(
        { version: 2, runtimeEpoch: epoch, operationId, operation: op },
        OWNER,
      );
      if (res?.ok) return res;
      if (res?.code === "STALE_EPOCH") epoch = undefined;
      else if (res?.code !== "BUSY")
        throw new Error(res?.code ?? "RUNTIME_ERROR");
      if (i >= retries) throw new Error(res?.code ?? "RUNTIME_ERROR");
      await wait(1000);
      gate();
    }
  }
  async function runPrompt(job, signal, closed) {
    if (signal?.aborted) throw new Error("ABORTED");
    const { workspaceId, prompt } = job.target;
    const created = await send(
      {
        type: "session.create",
        workspaceId,
        title: `자동화: ${job.name}`.slice(0, 120),
      },
      closed,
    );
    const sessionId =
      created.receipt?.result?.sessionId ?? created.value?.selectedSessionId;
    if (!sessionId) throw new Error("NO_SESSION");
    try {
      await send(
        {
          type: "permission.mode.set",
          workspaceId,
          sessionId,
          requestId: "",
          mode: job.permissionMode,
        },
        closed,
      );
      await send(
        {
          type: "message.send",
          workspaceId,
          sessionId,
          requestId: "",
          text: prompt,
        },
        closed,
      );
    } catch (e) {
      throw Object.assign(e, { sessionId }); // still retained/archived later
    }
    // Stay running until the agent run ends so the next occurrence cannot overlap it.
    const deadline = now() + promptTimeoutMs;
    let busySeen = false;
    let idleReads = 0;
    const done = (r) => ({ ...r, sessionId });
    for (;;) {
      if (signal?.aborted) {
        if (
          !closed?.aborted &&
          (await ownsTurn(workspaceId, sessionId, prompt, closed))
        )
          await send(
            { type: "session.interrupt", workspaceId, sessionId },
            closed,
          ).catch(() => {});
        return done({ result: "failed", reason: "앱 종료로 중단되었습니다." });
      }
      if (now() > deadline)
        return done(
          await interruptAndWait(
            workspaceId,
            sessionId,
            prompt,
            signal,
            closed,
          ),
        );
      await wait(pollMs);
      let status;
      try {
        status = await sessionStatus(sessionId);
      } catch (e) {
        if (e?.missing)
          return done({ result: "failed", reason: "세션을 찾을 수 없습니다." });
        // Transient read failure: keep polling until the deadline.
      }
      if (status === "running" || status === "stopping") {
        busySeen = true;
        idleReads = 0;
      } else if (status === "unavailable")
        return done({ result: "failed", reason: "세션을 사용할 수 없습니다." });
      else if (status === "idle" && (busySeen || ++idleReads >= 3))
        return done({ result: "ok", reason: "세션 작업이 끝났습니다." });
    }
  }
  async function sessionStatus(sessionId) {
    const snap = await service().handle(
      { version: 2, readId: randomUUID(), operation: { type: "snapshot" } },
      OWNER,
    );
    const s = snap?.value?.sessions?.find((x) => x.id === sessionId);
    if (snap?.ok && !s)
      throw Object.assign(new Error("MISSING"), { missing: true });
    return s?.status;
  }
  // On timeout: interrupt the agent and stay "running" until it is idle (bounded), so the next
  // occurrence cannot overlap and the session is never archived while still working.
  // False only when the session's last user message is no longer the job's prompt (the user
  // continued it); unreadable counts as ours.
  async function ownsTurn(workspaceId, sessionId, prompt, closed) {
    try {
      if (closed?.aborted) return false;
      const snap = await service().handle(
        {
          version: 2,
          readId: randomUUID(),
          operation: { type: "snapshot", workspaceId, sessionId },
        },
        OWNER,
      );
      const last = snap?.value?.messages?.findLast?.((m) => m.role === "user");
      if (!last) return true;
      return last.text?.trim() === prompt.trim();
    } catch {
      return true;
    }
  }
  async function interruptAndWait(
    workspaceId,
    sessionId,
    prompt,
    signal,
    closed,
  ) {
    const timeout = {
      result: "timeout",
      reason: "제한 시간(2시간) 안에 끝나지 않아 중단했습니다.",
    };
    if (!(await ownsTurn(workspaceId, sessionId, prompt, closed)))
      return { result: "timeout", reason: "사용자가 이어서 사용 중" };
    try {
      await send({ type: "session.interrupt", workspaceId, sessionId }, closed);
    } catch {
      // Best effort; the idle check below decides.
    }
    const until = now() + interruptGraceMs;
    while (now() <= until && !signal?.aborted && !closed?.aborted) {
      await wait(pollMs);
      try {
        if (!BUSY.has(await sessionStatus(sessionId))) return timeout;
      } catch (e) {
        if (e?.missing) return timeout;
      }
    }
    return {
      ...timeout,
      reason: `${timeout.reason} 세션이 아직 실행 중일 수 있습니다.`,
    };
  }
  // False only when the session is known to be working; unknown/missing counts as idle.
  async function isIdle(sessionId) {
    try {
      return !BUSY.has(await sessionStatus(sessionId));
    } catch {
      return true;
    }
  }
  // Archives (never deletes) an old automation session.
  async function archive(
    job,
    sessionId,
    workspaceId = job.target.workspaceId,
    closed,
  ) {
    await send(
      {
        type: "session.archive",
        workspaceId,
        sessionId,
        requestId: "",
        archived: true,
      },
      closed,
    );
  }
  async function runScript(job, signal) {
    if (signal?.aborted) throw new Error("ABORTED");
    const { workspaceId, script } = job.target;
    const t = await terminals.startScript(OWNER, { workspaceId, script });
    const deadline = now() + scriptTimeoutMs;
    try {
      for (;;) {
        const cur = terminals
          .list(OWNER, workspaceId)
          .find((x) => x.terminalId === t.terminalId);
        if (!cur)
          return { result: "failed", reason: "터미널을 찾을 수 없습니다." };
        if (signal?.aborted) {
          await terminals.stop(OWNER, t.terminalId);
          return { result: "failed", reason: "앱 종료로 중단되었습니다." };
        }
        if (cur.status === "exited")
          return cur.exitCode === 0
            ? { result: "ok", reason: "종료 코드 0" }
            : {
                result: "failed",
                reason: `종료 코드 ${cur.exitCode ?? "없음"}`,
              };
        if (now() > deadline) {
          await terminals.stop(OWNER, t.terminalId);
          return { result: "failed", reason: "제한 시간 초과로 중지했습니다." };
        }
        await wait(pollMs);
      }
    } finally {
      await terminals.close(OWNER, t.terminalId).catch(() => {});
    }
  }
  async function run(job, signal, closed) {
    if (!terminalRoot(job.target.workspaceId))
      return {
        result: "failed",
        reason: "작업 공간이 등록·신뢰되어 있지 않습니다.",
      };
    try {
      return job.target.kind === "prompt"
        ? await runPrompt(job, signal, closed)
        : await runScript(job, signal);
    } catch (e) {
      return {
        result: "failed",
        reason: `실행 실패 (${e?.terminalCode ?? e?.message ?? "오류"})`,
        ...(e?.sessionId ? { sessionId: e.sessionId } : {}),
      };
    }
  }
  run.archive = archive;
  run.isIdle = isIdle;
  return run;
}
