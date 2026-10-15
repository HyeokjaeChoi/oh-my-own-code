import assert from "node:assert/strict";
import { test } from "node:test";
import { isPlaceholderTitle, nativeSessionTitle } from "./session-title.mjs";

test("only app placeholders are replaceable", () => {
  for (const t of ["Workbench", "Untitled session", "", "  ", undefined])
    assert.equal(isPlaceholderTitle(t), true);
  for (const t of ["hello", "My rename", "Workbench 2"])
    assert.equal(isPlaceholderTitle(t), false);
});

test("native titles are cleaned, redacted and bounded", () => {
  assert.equal(nativeSessionTitle("  Fix\n the\tbug  "), "Fix the bug");
  assert.equal(nativeSessionTitle("Untitled session"), undefined);
  assert.equal(nativeSessionTitle("\u0007\u0000"), undefined);
  assert.equal(nativeSessionTitle(42), undefined);
  assert.equal(
    nativeSessionTitle("New session - 2026-10-15T05:33:17.421Z"),
    undefined,
  );
  assert.equal(
    nativeSessionTitle("Child session - 2026-10-15T05:33:17.421Z"),
    undefined,
  );
  const secret = `use sk-${"a".repeat(32)} now`;
  assert.ok(!nativeSessionTitle(secret).includes("sk-aaaa"));
  const long = nativeSessionTitle("가".repeat(500));
  assert.equal(long.length, 120);
  const emoji = nativeSessionTitle("😀".repeat(100));
  assert.ok(emoji.length <= 120 && !/[\ud800-\udbff]$/.test(emoji));
});
