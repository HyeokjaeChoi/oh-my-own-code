import assert from "node:assert/strict";
import test from "node:test";
import { SyntheticSnapshotSchema } from "@workbench/contracts/source";
import { syntheticSnapshot } from "../../../../test-fixtures/synthetic-snapshot.js";
import {
  projectSnapshotEvents,
  toAssistantThreadMessages,
} from "./assistant-thread.js";

test("snapshot projection applies ordered, deduplicated synthetic events", () => {
  const [statusEvent, appendedEvent] = syntheticSnapshot.events;
  assert.ok(statusEvent && appendedEvent);
  const projected = projectSnapshotEvents(syntheticSnapshot, [
    appendedEvent,
    statusEvent,
    appendedEvent,
  ]);

  assert.equal(projected.run.status, "complete");
  assert.equal(projected.events.length, 2);
  assert.equal(projected.messages.at(-1)?.id, "synthetic-event-message");
});

test("a completed event is authoritative over a stale running snapshot", () => {
  const runningSnapshot = {
    ...syntheticSnapshot,
    run: { ...syntheticSnapshot.run, status: "running" as const },
  };
  const projected = projectSnapshotEvents(runningSnapshot);

  assert.equal(projected.run.status, "complete");
});

test("snapshot projection retains appended messages from earlier runs in the same session", () => {
  const appendedEvent = syntheticSnapshot.events.find(
    (event) => event.type === "message.appended",
  );
  assert.ok(appendedEvent && appendedEvent.type === "message.appended");
  const projected = projectSnapshotEvents(syntheticSnapshot, [
    ...syntheticSnapshot.events,
    {
      ...appendedEvent,
      id: "other-run-message-event",
      sequence: 3,
      message: {
        ...appendedEvent.message,
        id: "other-run-message",
        runId: "other-run",
      },
    },
  ]);

  assert.equal(
    projected.messages.some((message) => message.id === "other-run-message"),
    true,
  );
  assert.equal(projected.eventCursor, 3);
});

test("snapshot messages and appended events are isolated by session identity", () => {
  const foreignBaselineMessage = {
    ...syntheticSnapshot.messages[0]!,
    id: "foreign-session-baseline",
    sessionId: "other-session",
  };
  const sameSessionEarlierRunMessage = {
    ...syntheticSnapshot.messages[1]!,
    id: "earlier-run-baseline",
    runId: "earlier-run",
  };
  const sameSessionEarlierRunEvent = {
    id: "earlier-run-appended-event",
    sequence: 3,
    type: "message.appended" as const,
    sessionId: "synthetic-session",
    message: {
      ...syntheticSnapshot.messages[1]!,
      id: "earlier-run-event-message",
      runId: "earlier-run",
    },
  };
  const foreignEvent = {
    ...sameSessionEarlierRunEvent,
    id: "foreign-session-appended-event",
    sequence: 4,
    sessionId: "other-session",
    message: {
      ...sameSessionEarlierRunEvent.message,
      id: "foreign-session-event-message",
      sessionId: "other-session",
    },
  };
  const foreignStatusEvent = {
    id: "foreign-session-status-event",
    sequence: 5,
    type: "run.status" as const,
    sessionId: "other-session",
    runId: "synthetic-run",
    status: "running" as const,
  };
  const mismatchedMessageEvent = {
    ...sameSessionEarlierRunEvent,
    id: "mismatched-message-session-event",
    sequence: 4,
    message: {
      ...sameSessionEarlierRunEvent.message,
      id: "mismatched-message-session",
      sessionId: "other-session",
    },
  };
  const mixedSnapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    messages: [
      ...syntheticSnapshot.messages,
      foreignBaselineMessage,
      sameSessionEarlierRunMessage,
    ],
  });
  const projected = projectSnapshotEvents(mixedSnapshot, [
    ...syntheticSnapshot.events,
    sameSessionEarlierRunEvent,
    foreignEvent,
    foreignStatusEvent,
    mismatchedMessageEvent,
  ]);

  assert.ok(
    projected.messages.some((message) => message.id === "earlier-run-baseline"),
  );
  assert.ok(
    projected.messages.some(
      (message) => message.id === "earlier-run-event-message",
    ),
  );
  assert.equal(
    projected.messages.some(
      (message) =>
        message.id === "foreign-session-baseline" ||
        message.id === "foreign-session-event-message" ||
        message.id === "mismatched-message-session",
    ),
    false,
  );
  assert.equal(projected.run.status, "complete");
  assert.equal(projected.eventCursor, 5);
});

test("foreign session events advance the global cursor before selected events", () => {
  const snapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    eventCursor: 0,
    events: [],
    run: { ...syntheticSnapshot.run, status: "complete" },
  });
  const foreignEvent = {
    id: "foreign-session-first-event",
    sequence: 1,
    type: "message.appended" as const,
    sessionId: "other-session",
    message: {
      ...syntheticSnapshot.messages[1]!,
      id: "foreign-session-first-message",
      sessionId: "other-session",
    },
  };
  const selectedEvent = {
    id: "selected-session-second-event",
    sequence: 2,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "running" as const,
  };

  const projected = projectSnapshotEvents(snapshot, [
    selectedEvent,
    foreignEvent,
  ]);

  assert.equal(projected.eventCursor, 2);
  assert.equal(projected.eventReconciliationNeeded, false);
  assert.equal(projected.run.status, "running");
  assert.equal(
    projected.messages.some(
      (message) => message.id === "foreign-session-first-message",
    ),
    false,
  );
  assert.deepEqual(
    projected.events.map((event) => event.id),
    [selectedEvent.id],
  );
});

test("pending global events survive gaps without entering the selected transcript", () => {
  const snapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    eventCursor: 0,
    events: [],
    run: { ...syntheticSnapshot.run, status: "running" },
  });
  const selectedFirst = {
    id: "selected-session-sequence-one",
    sequence: 1,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "running" as const,
  };
  const selectedSecond = {
    id: "selected-session-sequence-two",
    sequence: 2,
    type: "message.appended" as const,
    sessionId: "synthetic-session",
    message: {
      ...syntheticSnapshot.messages[1]!,
      id: "selected-session-sequence-two-message",
    },
  };
  const foreignThird = {
    id: "foreign-session-sequence-three",
    sequence: 3,
    type: "run.status" as const,
    sessionId: "other-session",
    runId: "synthetic-run",
    status: "complete" as const,
  };
  const selectedFourth = {
    id: "selected-session-sequence-four",
    sequence: 4,
    type: "message.appended" as const,
    sessionId: "synthetic-session",
    message: {
      ...syntheticSnapshot.messages[1]!,
      id: "selected-session-sequence-four-message",
    },
  };

  const awaitingGap = projectSnapshotEvents(snapshot, [
    foreignThird,
    selectedFirst,
  ]);
  assert.equal(awaitingGap.eventCursor, 1);
  assert.equal(awaitingGap.eventReconciliationNeeded, true);
  assert.equal(awaitingGap.run.status, "unknown");
  assert.deepEqual(
    awaitingGap.pendingGlobalEvents.map((event) => event.id),
    [foreignThird.id],
  );
  assert.deepEqual(
    awaitingGap.events.map((event) => event.id),
    [selectedFirst.id],
  );

  const recovered = projectSnapshotEvents(awaitingGap, [selectedSecond]);
  assert.equal(recovered.eventCursor, 3);
  assert.equal(recovered.eventReconciliationNeeded, false);
  assert.equal(recovered.run.status, "running");
  assert.deepEqual(recovered.pendingGlobalEvents, []);
  assert.equal(
    recovered.messages.filter(
      (message) => message.id === selectedSecond.message.id,
    ).length,
    1,
  );

  const advanced = projectSnapshotEvents(recovered, [
    selectedSecond,
    selectedFourth,
  ]);
  assert.equal(advanced.eventCursor, 4);
  assert.equal(advanced.eventReconciliationNeeded, false);
  assert.deepEqual(advanced.pendingGlobalEvents, []);
  assert.equal(
    advanced.messages.filter(
      (message) => message.id === selectedSecond.message.id,
    ).length,
    1,
  );
  assert.equal(
    advanced.messages.some(
      (message) => message.id === selectedFourth.message.id,
    ),
    true,
  );
});

test("pending global events are validated and sequence ordered", () => {
  const snapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    eventCursor: 0,
    events: [],
  });
  const selectedSecond = {
    id: "selected-session-sequence-two",
    sequence: 2,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "complete" as const,
  };
  const foreignFirst = {
    id: "foreign-session-sequence-one",
    sequence: 1,
    type: "run.status" as const,
    sessionId: "other-session",
    runId: "synthetic-run",
    status: "running" as const,
  };
  const pending = projectSnapshotEvents(snapshot, [selectedSecond]);
  const ordered = projectSnapshotEvents({
    ...pending,
    pendingGlobalEvents: [foreignFirst],
  });

  assert.equal(ordered.eventCursor, 2);
  assert.equal(ordered.eventReconciliationNeeded, false);
  assert.deepEqual(
    ordered.events.map((event) => event.id),
    [selectedSecond.id],
  );
  assert.throws(() =>
    projectSnapshotEvents({
      ...snapshot,
      pendingGlobalEvents: [{ ...foreignFirst, sequence: 0 }],
    }),
  );
});

test("fresh events win over stale events regardless of arrival order", () => {
  const staleRunningEvent = {
    id: "stale-running-event",
    sequence: 1,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "running" as const,
  };
  const freshCompleteEvent = {
    id: "fresh-complete-event",
    sequence: 3,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "complete" as const,
  };
  const snapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    run: { ...syntheticSnapshot.run, status: "unknown" },
  });

  for (const events of [
    [staleRunningEvent, freshCompleteEvent],
    [freshCompleteEvent, staleRunningEvent],
  ]) {
    const projected = projectSnapshotEvents(snapshot, events);
    assert.equal(projected.run.status, "complete");
    assert.equal(projected.eventCursor, 3);
  }
});

test("an out-of-order 1, 3 stream waits at 1 and replays 2, 3 after the gap closes", () => {
  const snapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    eventCursor: 0,
    events: [],
    run: { ...syntheticSnapshot.run, status: "running" },
  });
  const eventOne = {
    id: "gap-status-one",
    sequence: 1,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "running" as const,
  };
  const eventTwo = {
    id: "gap-message-two",
    sequence: 2,
    type: "message.appended" as const,
    sessionId: "synthetic-session",
    message: {
      ...syntheticSnapshot.messages[1]!,
      id: "gap-message-two-content",
      runId: "synthetic-run",
    },
  };
  const eventThree = {
    id: "gap-message-three",
    sequence: 3,
    type: "message.appended" as const,
    sessionId: "synthetic-session",
    message: {
      ...syntheticSnapshot.messages[1]!,
      id: "gap-message-three-content",
      runId: "earlier-run",
    },
  };

  const awaitingGap = projectSnapshotEvents(snapshot, [eventThree, eventOne]);
  assert.equal(awaitingGap.eventCursor, 1);
  assert.equal(awaitingGap.eventReconciliationNeeded, true);
  assert.equal(awaitingGap.run.status, "unknown");
  assert.equal(
    awaitingGap.messages.some(
      (message) => message.id === "gap-message-three-content",
    ),
    false,
  );

  const recovered = projectSnapshotEvents(awaitingGap, [eventTwo]);
  assert.equal(recovered.eventCursor, 3);
  assert.equal(recovered.eventReconciliationNeeded, false);
  assert.equal(recovered.run.status, "running");
  assert.equal(
    recovered.messages.some(
      (message) => message.id === "gap-message-two-content",
    ),
    true,
  );
  assert.equal(
    recovered.messages.some(
      (message) =>
        message.id === "gap-message-three-content" &&
        message.runId === "earlier-run",
    ),
    true,
  );
});

test("an event beyond an absent sequence keeps the cursor and status unknown", () => {
  const snapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    eventCursor: 0,
    events: [],
    run: { ...syntheticSnapshot.run, status: "complete" },
  });
  const eventThree = {
    id: "missing-first-and-second-status",
    sequence: 3,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "complete" as const,
  };

  const projected = projectSnapshotEvents(snapshot, [eventThree]);

  assert.equal(projected.eventCursor, 0);
  assert.equal(projected.eventReconciliationNeeded, true);
  assert.equal(projected.run.status, "unknown");
  assert.equal(
    projected.events.some((event) => event.id === eventThree.id),
    true,
  );
});

test("events older than a completed snapshot cursor cannot roll status backward", () => {
  const completedSnapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    eventCursor: 2,
    run: { ...syntheticSnapshot.run, status: "complete" },
  });
  const staleRunningEvent = {
    id: "stale-running-event",
    sequence: 1,
    type: "run.status" as const,
    sessionId: "synthetic-session",
    runId: "synthetic-run",
    status: "running" as const,
  };

  const projected = projectSnapshotEvents(completedSnapshot, [
    staleRunningEvent,
  ]);

  assert.equal(projected.run.status, "complete");
  assert.equal(projected.eventCursor, 2);
});

test("ordered run events override a stale snapshot status for every projection consumer", () => {
  const staleSnapshot = SyntheticSnapshotSchema.parse({
    ...syntheticSnapshot,
    run: { ...syntheticSnapshot.run, status: "running" },
  });
  const projected = projectSnapshotEvents(staleSnapshot);

  assert.equal(staleSnapshot.run.status, "running");
  assert.equal(projected.run.status, "complete");
  assert.equal(projected.eventCursor, 2);
  assert.equal(
    toAssistantThreadMessages(projected).some(
      (message) => message.id === "synthetic-event-message",
    ),
    true,
  );
});

test("assistant-ui projection preserves text and maps a tool part without enabling a callback", () => {
  const messages = toAssistantThreadMessages(
    projectSnapshotEvents(syntheticSnapshot),
  );
  const assistant = messages.find(
    (message) => message.id === "synthetic-assistant-message",
  );
  assert.ok(assistant);
  assert.deepEqual(assistant.content[0], {
    type: "text",
    text: "아래 도구 결과는 고정된 로컬 fixture이며 외부 실행을 하지 않았습니다.",
  });
  assert.deepEqual(assistant.content[1], {
    type: "tool-call",
    toolCallId: "synthetic-preview-call",
    toolName: "previewLink",
    args: { href: "https://example.invalid/synthetic" },
    result: {
      id: "synthetic-link-preview",
      href: "https://example.invalid/synthetic",
      title: "안전한 합성 링크",
      description: "실제 프로젝트 데이터 없이 만든 고정 fixture입니다.",
      domain: "example.invalid",
    },
  });
  assert.equal(assistant.metadata?.custom?.provenance, "message");
  assert.equal(
    messages.find((message) => message.id === "synthetic-event-message")
      ?.metadata?.custom?.provenance,
    "event",
  );
});
