import assert from "node:assert/strict";
import test from "node:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  MAX_TOOL_RESULT_BYTES,
  parseSafeLinkPreview,
  SyntheticSnapshotSchema,
  type LinkPreviewPayload,
} from "@workbench/contracts/source";
import { LinkPreview } from "@workbench/ui";
import { syntheticSnapshot } from "../../../../test-fixtures/synthetic-snapshot.js";
import { projectSnapshotEvents } from "../../../entities/session/index.js";
import {
  AssistantTranscript,
  PreviewLinkToolRenderer,
} from "./AssistantTranscript.js";

test("ExternalStoreRuntime renders message provenance and an inert summarized preview", () => {
  const markup = renderToStaticMarkup(
    <AssistantTranscript
      projectedSnapshot={projectSnapshotEvents(syntheticSnapshot)}
    />,
  );
  assert.match(markup, /합성 링크 결과를 확인해 주세요/);
  assert.match(markup, /고정된 로컬 fixture/);
  assert.match(markup, /이 메시지는 합성 이벤트 fixture에서 왔습니다/);
  assert.match(markup, /data-provenance="event"/);
  assert.match(markup, /사용자/);
  assert.match(markup, /도우미/);
  assert.match(markup, /previewLink/);
  assert.match(markup, /확인 완료/);
  assert.match(markup, /data-tone="success"/);
  assert.match(markup, /lang="ko-KR"/);
  assert.match(markup, /example\.invalid\/synthetic/);
  assert.match(markup, /검증된 미리보기/);
  assert.doesNotMatch(markup, /href="javascript:/i);
  assert.doesNotMatch(markup, /role="link"/);
});

function snapshotWithPreviewResult(result: unknown) {
  const snapshot = structuredClone(syntheticSnapshot);
  const assistant = snapshot.messages.find(
    (message) => message.id === "synthetic-assistant-message",
  );
  const preview = assistant?.content.find((part) => part.type === "tool");
  assert.ok(preview && preview.type === "tool");
  preview.result = result;
  return SyntheticSnapshotSchema.parse(snapshot);
}

function previewResultFrom(
  snapshot: ReturnType<typeof snapshotWithPreviewResult>,
) {
  const assistant = snapshot.messages.find(
    (message) => message.id === "synthetic-assistant-message",
  );
  const preview = assistant?.content.find((part) => part.type === "tool");
  assert.ok(preview && preview.type === "tool");
  return preview.result;
}

test("registered previewLink renderer displays a summary and a validated inert card", () => {
  const safe = parseSafeLinkPreview({
    id: "registered-safe-preview",
    href: "https://example.invalid/registered",
    title: "등록된 렌더러 카드",
  });
  assert.ok(safe);
  const markup = renderToStaticMarkup(
    <PreviewLinkToolRenderer result={safe} status={{ type: "complete" }} />,
  );

  assert.match(markup, /data-tool-ui-id="registered-safe-preview"/);
  assert.match(markup, /등록된 렌더러 카드/);
  assert.match(markup, /previewLink/);
  assert.match(markup, /확인 완료/);
  assert.match(markup, /data-tone="success"/);
  assert.match(markup, /example\.invalid\/registered/);
  assert.doesNotMatch(markup, /role="link"/);
  assert.doesNotMatch(markup, /tabindex=/i);
  assert.doesNotMatch(markup, /href=/i);
});

test("a validated result without execution status does not claim success", () => {
  const safe = parseSafeLinkPreview({
    id: "unconfirmed-safe-preview",
    href: "https://example.invalid/unconfirmed",
  });
  assert.ok(safe);

  const markup = renderToStaticMarkup(
    <PreviewLinkToolRenderer result={safe} />,
  );

  assert.match(markup, /상태 확인 중/);
  assert.match(markup, /data-tone="neutral"/);
  assert.doesNotMatch(markup, /확인 완료/);
});

test("registered previewLink renderer preserves malformed results as inert text", () => {
  const snapshot = snapshotWithPreviewResult({
    id: "malformed-preview",
    href: "javascript:alert(1)",
    title: "safe fallback context",
  });
  const markup = renderToStaticMarkup(
    <PreviewLinkToolRenderer result={previewResultFrom(snapshot)} />,
  );

  assert.match(markup, /data-tool-fallback="previewLink"/);
  assert.match(markup, /결과를 표시할 수 없습니다/);
  assert.doesNotMatch(markup, /safe fallback context/);
  assert.doesNotMatch(markup, /href="javascript:/i);
});

test("registered previewLink renderer gives oversized results a bounded generic fallback", () => {
  const snapshot = snapshotWithPreviewResult(
    "x".repeat(MAX_TOOL_RESULT_BYTES + 1),
  );
  const markup = renderToStaticMarkup(
    <PreviewLinkToolRenderer result={previewResultFrom(snapshot)} />,
  );

  assert.match(markup, /data-tool-fallback="previewLink"/);
  assert.match(markup, /결과를 표시할 수 없습니다/);
  assert.doesNotMatch(markup, /x{1000}/);
  assert.doesNotMatch(markup, /<a\b/i);
});

test("invalid preview fallback hides synthetic secret canaries and query values", () => {
  const secretCanary = "SYNTHETIC_SECRET_CANARY_8fd2";
  const snapshot = snapshotWithPreviewResult({
    token: secretCanary,
    nested: { password: "fixture-password-canary" },
  });
  const markup = renderToStaticMarkup(
    <PreviewLinkToolRenderer
      args={{ href: `https://example.invalid/private?token=${secretCanary}` }}
      result={previewResultFrom(snapshot)}
    />,
  );

  assert.match(markup, /대상 확인 불가/);
  assert.doesNotMatch(markup, /example\.invalid\/private/);
  assert.doesNotMatch(markup, /SYNTHETIC_SECRET_CANARY_8fd2/);
  assert.doesNotMatch(markup, /fixture-password-canary/);
  assert.doesNotMatch(markup, /token=/);
  assert.doesNotMatch(markup, /password/);
});

test("Tool UI LinkPreview card renders only a schema-validated safe web destination", () => {
  const safe = parseSafeLinkPreview({
    id: "safe-preview",
    href: "https://example.invalid/synthetic",
    title: "합성 카드",
    description: "검증된 텍스트만 렌더링합니다.",
    domain: "example.invalid",
  });
  assert.ok(safe);
  const card = renderToStaticMarkup(
    <LinkPreview {...safe} className="omoc-link-preview" />,
  );
  assert.match(card, /data-tool-ui-id="safe-preview"/);
  assert.match(card, /role="link"/);
  assert.match(card, /합성 카드/);
  assert.doesNotMatch(card, /\slang=/);
  assert.equal(safe.href, "https://example.invalid/synthetic");

  const unsafe = parseSafeLinkPreview({
    id: "unsafe",
    href: "javascript:alert(1)",
  });
  assert.equal(unsafe, null);
  const unsafeCard = renderToStaticMarkup(
    <LinkPreview
      {...({ id: "unsafe", href: "javascript:alert(1)" } as LinkPreviewPayload)}
      className="omoc-link-preview"
    />,
  );
  assert.doesNotMatch(unsafeCard, /role="link"/);
  assert.doesNotMatch(unsafeCard, /href="javascript:/i);
});

test("LinkPreview inherits the document language when locale is omitted and preserves explicit locale", () => {
  const korean = parseSafeLinkPreview({
    id: "explicit-korean-preview",
    href: "https://example.invalid/korean",
    title: "한국어 미리보기",
  });
  assert.ok(korean);

  const card = renderToStaticMarkup(<LinkPreview {...korean} locale="ko-KR" />);
  assert.match(card, /lang="ko-KR"/);
});

test("LinkPreview keeps navigation available when explicitly interactive", () => {
  const safe = parseSafeLinkPreview({
    id: "interactive-preview",
    href: "https://example.invalid/safe",
    title: "안전한 이동 대상",
  });
  assert.ok(safe);
  const card = renderToStaticMarkup(
    <LinkPreview {...safe} interactive className="omoc-link-preview" />,
  );
  assert.match(card, /role="link"/);
  assert.match(card, /tabindex="0"/);
});
