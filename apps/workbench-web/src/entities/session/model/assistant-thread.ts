import type { ThreadMessageLike } from "@assistant-ui/react";
import {
  MAX_TOOL_RESULT_BYTES,
  SyntheticSnapshotSchema,
  type SyntheticSnapshot,
} from "@workbench/contracts/source";

export type SyntheticEvent = SyntheticSnapshot["events"][number];
export type ProjectedSyntheticSnapshot = SyntheticSnapshot & {
  eventReconciliationNeeded: boolean;
  lastKnownRunStatus: SyntheticSnapshot["run"]["status"];
  pendingGlobalEvents: SyntheticEvent[];
};
type SnapshotProjectionInput = SyntheticSnapshot &
  Partial<
    Pick<
      ProjectedSyntheticSnapshot,
      "eventReconciliationNeeded" | "lastKnownRunStatus" | "pendingGlobalEvents"
    >
  >;
type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };
type JsonObject = { readonly [key: string]: JsonValue };

function isJsonObject(value: JsonValue): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function serializeToolValue(value: unknown): JsonValue | null {
  try {
    const serialized = JSON.stringify(value);
    if (
      serialized === undefined ||
      new TextEncoder().encode(serialized).byteLength > MAX_TOOL_RESULT_BYTES
    )
      return null;
    return JSON.parse(serialized) as JsonValue;
  } catch {
    return null;
  }
}

function serializeToolArgs(value: Record<string, unknown>): JsonObject {
  const serialized = serializeToolValue(value);
  return serialized && isJsonObject(serialized) ? serialized : {};
}

export function projectSnapshotEvents(
  snapshot: SnapshotProjectionInput,
  events: readonly SyntheticEvent[] = [],
): ProjectedSyntheticSnapshot {
  const {
    eventReconciliationNeeded: _previousGap,
    lastKnownRunStatus,
    pendingGlobalEvents = [],
    ...snapshotFields
  } = snapshot;
  void _previousGap;
  const checked = SyntheticSnapshotSchema.parse({
    ...snapshotFields,
    events: [...snapshot.events, ...pendingGlobalEvents, ...events],
  });
  const seenIds = new Set<string>();
  const seenSequences = new Set<number>();
  const allEvents = [...checked.events]
    .filter(
      (event) =>
        event.type !== "message.appended" ||
        event.message.sessionId === event.sessionId,
    )
    .sort((left, right) => left.sequence - right.sequence)
    .filter((event) => {
      if (seenIds.has(event.id) || seenSequences.has(event.sequence))
        return false;
      seenIds.add(event.id);
      seenSequences.add(event.sequence);
      return true;
    });
  const selectedSessionEvents = allEvents.filter(
    (event) => event.sessionId === checked.session.id,
  );
  const ordered = allEvents.filter(
    (event) => event.sequence > checked.eventCursor,
  );

  let eventCursor = checked.eventCursor;
  let eventReconciliationNeeded = false;
  const contiguousEvents: SyntheticEvent[] = [];
  for (const event of ordered) {
    if (event.sequence !== eventCursor + 1) {
      eventReconciliationNeeded = true;
      break;
    }
    contiguousEvents.push(event);
    eventCursor = event.sequence;
  }

  let runStatus = lastKnownRunStatus ?? snapshot.run.status;
  const messages = new Map(
    checked.messages
      .filter((message) => message.sessionId === checked.session.id)
      .map((message) => [message.id, message]),
  );
  for (const event of contiguousEvents) {
    if (event.sessionId !== checked.session.id) continue;
    if (event.type === "run.status" && event.runId === checked.run.id) {
      runStatus = event.status;
    } else if (
      event.type === "message.appended" &&
      event.message.sessionId === checked.session.id &&
      event.message.sessionId === event.sessionId &&
      !messages.has(event.message.id)
    ) {
      messages.set(event.message.id, event.message);
    }
  }

  return {
    ...checked,
    eventCursor,
    run: {
      ...checked.run,
      status: eventReconciliationNeeded ? "unknown" : runStatus,
    },
    eventReconciliationNeeded,
    lastKnownRunStatus: runStatus,
    pendingGlobalEvents: allEvents.filter(
      (event) => event.sequence > eventCursor,
    ),
    messages: [...messages.values()],
    events: selectedSessionEvents,
  };
}

export function toAssistantThreadMessages(
  snapshot: SyntheticSnapshot,
): ThreadMessageLike[] {
  const eventMessageIds = new Set(
    snapshot.events.flatMap((event) =>
      event.type === "message.appended" &&
      event.sessionId === snapshot.session.id &&
      event.message.sessionId === snapshot.session.id
        ? [event.message.id]
        : [],
    ),
  );
  return snapshot.messages
    .filter((message) => message.sessionId === snapshot.session.id)
    .map((message) => ({
      id: message.id,
      role: message.role,
      metadata: {
        custom: {
          provenance: eventMessageIds.has(message.id) ? "event" : "message",
        },
      },
      content: message.content.map((part) =>
        part.type === "text"
          ? { type: "text" as const, text: part.text }
          : {
              type: "tool-call" as const,
              toolCallId: part.toolCallId,
              toolName: part.toolName,
              args: serializeToolArgs(part.args),
              result: serializeToolValue(part.result),
              ...(part.status === "error" ? { isError: true } : {}),
            },
      ),
    }));
}
