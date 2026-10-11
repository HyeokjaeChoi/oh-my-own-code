import assert from "node:assert/strict";
import { test } from "node:test";
import { createGitMetadataKernel } from "./git-metadata-kernel.mjs";
test("shared core import has only its closed factory", async () => {
  assert.deepEqual(Object.keys(await import("./git-metadata-kernel.mjs")), [
    "createGitMetadataKernel",
  ]);
  await assert.rejects(createGitMetadataKernel(), {
    message: "unsupported_runtime",
  });
});
test("shared core refuses extension hooks and excessive deadlines", async () => {
  for (const v of [
    null,
    { policy: {} },
    { timeoutMs: 10001 },
    { timeoutMs: 0 },
    { check: 3 },
  ])
    await assert.rejects(createGitMetadataKernel(v), {
      message: "invalid_request",
    });
});
