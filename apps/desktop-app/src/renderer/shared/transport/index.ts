/* eslint-disable no-unused-vars -- Type parameter names describe callbacks; TypeScript unused checks remain enabled. */
import type {
  WorkbenchRequest,
  WorkbenchResult,
  WorkbenchEnvelope,
  ReadType,
} from "../api/index.js";

export type Bridge = Window["desktopBridge"];
export type Clock = Pick<typeof globalThis, "setTimeout" | "clearTimeout">;
const readTypes = new Set([
  "permission.policy.read",
  "context.observe",
  "session.inbox",
  "git.branch.preview.read",
  "git.restore.preview.read",
  "git.commit.preview.read",
  "git.index.preview.read",
  "git.review.read",
  "git.diff.read",
  "file.edit.read",
  "configuration.extensions.read",
  "configuration.agent.runtime.read",
  "configuration.agent.list",
  "configuration.agent.read",
  "configuration.skill.runtime.read",
  "configuration.skill.list",
  "configuration.skill.read",
  "snapshot",
  "diagnostics.list",
  "catalog.list",
  "file.list",
  "file.read",
  "file.search",
  "configuration.read",
  "configuration.instructions.read",
  "configuration.mcp.read",
  "operation.lookup",
]);
export const isRead = (operation: WorkbenchRequest) =>
  readTypes.has(operation.type);
export type ReadRequest = Extract<WorkbenchRequest, { type: ReadType }>;
export type MutationRequest = Exclude<WorkbenchRequest, ReadRequest>;
const fail = (code: string): WorkbenchResult<never> => ({
  ok: false,
  code,
  message: code,
});
const canonical = (value: object) =>
  JSON.stringify(value, Object.keys(value).sort());
const lane = (operation: ReadRequest) =>
  operation.type === "operation.lookup"
    ? "lookup"
    : operation.type === "file.search"
      ? "search"
      : operation.type === "permission.policy.read" ||
          operation.type === "git.branch.preview.read" ||
          operation.type === "git.restore.preview.read" ||
          operation.type === "git.commit.preview.read" ||
          operation.type === "git.index.preview.read" ||
          operation.type === "git.review.read" ||
          operation.type === "git.diff.read" ||
          operation.type.startsWith("file.") ||
          operation.type === "context.observe" ||
          operation.type === "session.inbox" ||
          operation.type === "configuration.read" ||
          operation.type === "configuration.skill.runtime.read" ||
          operation.type === "configuration.agent.runtime.read" ||
          operation.type === "configuration.extensions.read" ||
          operation.type === "configuration.agent.list" ||
          operation.type === "configuration.agent.read" ||
          operation.type === "configuration.skill.list" ||
          operation.type === "configuration.skill.read" ||
          operation.type === "configuration.instructions.read" ||
          operation.type === "configuration.mcp.read"
        ? "files"
        : operation.type === "catalog.list"
          ? "catalog"
          : "snapshot";
export function createTransport(
  bridge: Bridge,
  {
    timeoutMs = 10000,
    clock = globalThis,
    id = () => crypto.randomUUID(),
  }: { timeoutMs?: number; clock?: Clock; id?: () => string } = {},
) {
  type Subscriber = { finish: (_result: WorkbenchResult<unknown>) => void };
  type Task = {
    key: string;
    readId: string;
    epoch: string | undefined;
    open: boolean;
    subscribers: Set<Subscriber>;
    timer?: ReturnType<typeof setTimeout>;
  };
  const tasks = new Map<string, Task>();
  const mutationWaits = new Set<() => void>();
  let disposed = false;
  const cancel = (task: Task) => {
    if (!task.open) return;
    task.open = false;
    clock.clearTimeout(task.timer);
    if (task.epoch)
      void Promise.resolve()
        .then(() =>
          bridge.cancelRead({
            version: 2,
            runtimeEpoch: task.epoch!,
            readId: task.readId,
          }),
        )
        .catch(() => {});
  };
  function read<T>(
    operation: ReadRequest,
    epoch?: string,
    signal?: AbortSignal,
  ): Promise<WorkbenchResult<T>> {
    if (disposed || signal?.aborted) return Promise.resolve(fail("CANCELLED"));
    if (!epoch && operation.type !== "snapshot")
      return Promise.resolve(fail("STALE_EPOCH"));
    const group = lane(operation),
      key = `${epoch ?? "bootstrap"}:${canonical(operation)}`;
    let task = tasks.get(group);
    if (task && (!task.open || task.key !== key || task.subscribers.size >= 8))
      return Promise.resolve(fail("READ_BUSY"));
    const fresh = !task;
    if (!task) {
      task = { key, epoch, readId: id(), open: true, subscribers: new Set() };
      tasks.set(group, task);
    }
    const current = task;
    const promise = new Promise<WorkbenchResult<T>>((resolve) => {
      let done = false;
      const subscriber: Subscriber = {
        finish(result) {
          if (done) return;
          done = true;
          signal?.removeEventListener("abort", abort);
          current.subscribers.delete(subscriber);
          resolve(result as WorkbenchResult<T>);
        },
      };
      const abort = () => {
        subscriber.finish(fail("CANCELLED"));
        if (!current.subscribers.size) cancel(current);
      };
      current.subscribers.add(subscriber);
      signal?.addEventListener("abort", abort, { once: true });
    });
    if (fresh) {
      current.timer = clock.setTimeout(() => {
        for (const item of [...current.subscribers])
          item.finish(fail("READ_TIMEOUT"));
        cancel(current);
      }, timeoutMs);
      const envelope = {
        version: 2,
        operation,
        readId: current.readId,
        ...(epoch ? { runtimeEpoch: epoch } : {}),
      } as WorkbenchEnvelope;
      void Promise.resolve()
        .then(() => bridge.workbench(envelope))
        .catch(() => fail("UNAVAILABLE"))
        .then((result) => {
          clock.clearTimeout(current.timer);
          if (current.open && !disposed)
            for (const item of [...current.subscribers]) item.finish(result);
          if (tasks.get(group) === current) tasks.delete(group);
        });
    }
    return promise;
  }
  function mutate<T>(
    operation: MutationRequest,
    runtimeEpoch: string,
    operationId: string,
    expectedRevision?: number,
  ): Promise<WorkbenchResult<T>> {
    if (disposed) return Promise.resolve(fail("CANCELLED"));
    if (!runtimeEpoch) return Promise.resolve(fail("STALE_EPOCH"));
    return new Promise((resolve) => {
      let done = false;
      const finish = (result: WorkbenchResult<unknown>) => {
        if (done) return;
        done = true;
        clock.clearTimeout(timer);
        mutationWaits.delete(stop);
        resolve(result as WorkbenchResult<T>);
      };
      const stop = () => finish(fail("UNKNOWN_OUTCOME"));
      const timer = clock.setTimeout(stop, timeoutMs);
      mutationWaits.add(stop);
      void Promise.resolve()
        .then(() =>
          done || disposed
            ? fail("UNKNOWN_OUTCOME")
            : bridge.workbench({
                version: 2,
                runtimeEpoch,
                operationId,
                operation,
                ...(expectedRevision !== undefined ? { expectedRevision } : {}),
              } as WorkbenchEnvelope),
        )
        .then(finish, stop);
    });
  }
  return {
    read,
    mutate,
    dispose() {
      disposed = true;
      for (const task of tasks.values()) {
        for (const item of [...task.subscribers])
          item.finish(fail("CANCELLED"));
        cancel(task);
      }
      for (const stop of mutationWaits) stop();
    },
  };
}
export type Transport = ReturnType<typeof createTransport>;
