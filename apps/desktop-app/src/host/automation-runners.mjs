import { randomUUID } from "node:crypto";

const OWNER = "automation";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Runs one job through the same paths the UI uses: workbench service (session.create ->
// permission.mode.set -> message.send) or the terminal host. Never bypasses trust checks.
export function createAutomationRunner({
  service,
  terminals,
  terminalRoot,
  wait = sleep,
  scriptTimeoutMs = 10 * 60 * 1000,
  pollMs = 1000,
  busyRetries = 6,
}) {
  let epoch;
  async function send(operation, retries = busyRetries) {
    for (let i = 0; ; i++) {
      if (!epoch) {
        const snap = await service().handle(
          { version: 2, readId: randomUUID(), operation: { type: "snapshot" } },
          OWNER,
        );
        epoch = snap?.value?.runtimeEpoch;
        if (!epoch) throw new Error("UNAVAILABLE");
      }
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
      else if (res?.code !== "BUSY" || i >= retries)
        throw new Error(res?.code ?? "RUNTIME_ERROR");
      await wait(1000);
    }
  }
  async function runPrompt(job) {
    const { workspaceId, prompt } = job.target;
    const created = await send({
      type: "session.create",
      workspaceId,
      title: `자동화: ${job.name}`.slice(0, 120),
    });
    const sessionId =
      created.receipt?.result?.sessionId ?? created.value?.selectedSessionId;
    if (!sessionId) throw new Error("NO_SESSION");
    await send({
      type: "permission.mode.set",
      workspaceId,
      sessionId,
      requestId: "",
      mode: job.permissionMode,
    });
    await send({
      type: "message.send",
      workspaceId,
      sessionId,
      requestId: "",
      text: prompt,
    });
    return { result: "ok", reason: "새 세션에 프롬프트를 전달했습니다." };
  }
  async function runScript(job) {
    const { workspaceId, script } = job.target;
    const t = await terminals.startScript(OWNER, { workspaceId, script });
    const deadline = Date.now() + scriptTimeoutMs;
    try {
      for (;;) {
        const cur = terminals
          .list(OWNER, workspaceId)
          .find((x) => x.terminalId === t.terminalId);
        if (!cur)
          return { result: "failed", reason: "터미널을 찾을 수 없습니다." };
        if (cur.status === "exited")
          return cur.exitCode === 0
            ? { result: "ok", reason: "종료 코드 0" }
            : {
                result: "failed",
                reason: `종료 코드 ${cur.exitCode ?? "없음"}`,
              };
        if (Date.now() > deadline) {
          await terminals.stop(OWNER, t.terminalId);
          return { result: "failed", reason: "제한 시간 초과로 중지했습니다." };
        }
        await wait(pollMs);
      }
    } finally {
      await terminals.close(OWNER, t.terminalId).catch(() => {});
    }
  }
  return async function run(job) {
    if (!terminalRoot(job.target.workspaceId))
      return {
        result: "failed",
        reason: "작업 공간이 등록·신뢰되어 있지 않습니다.",
      };
    try {
      return job.target.kind === "prompt"
        ? await runPrompt(job)
        : await runScript(job);
    } catch (e) {
      return {
        result: "failed",
        reason: `실행 실패 (${e?.terminalCode ?? e?.message ?? "오류"})`,
      };
    }
  };
}
