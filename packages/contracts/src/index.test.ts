import assert from "node:assert/strict";
import test from "node:test";
import { MAX_TOOL_RESULT_BYTES, parseSafeLinkPreview } from "./index.js";

test("Tool UI payload validation accepts only bounded plain text and HTTP(S) destinations", () => {
  assert.deepEqual(
    parseSafeLinkPreview({
      id: "preview-1",
      href: "https://example.invalid/item",
      title: "Synthetic result",
    }),
    {
      id: "preview-1",
      href: "https://example.invalid/item",
      title: "Synthetic result",
    },
  );
  assert.equal(
    parseSafeLinkPreview({ id: "x", href: "javascript:alert(1)" }),
    null,
  );
  assert.equal(
    parseSafeLinkPreview({
      id: "x",
      href: "https://example.invalid",
      title: "<img src=x onerror=alert(1)>",
    }),
    null,
  );
  assert.equal(
    parseSafeLinkPreview({
      id: "x",
      href: "https://example.invalid",
      description: "x".repeat(MAX_TOOL_RESULT_BYTES),
    }),
    null,
  );
});
