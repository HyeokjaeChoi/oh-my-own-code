import assert from "node:assert/strict";
import test from "node:test";
import { childPids, windowsChildQuery } from "./process-tree.mjs";

test("windows child query is a quoted CIM filter on the parent pid", () => {
  const q = windowsChildQuery(12, "event-host|opencode.*serve");
  assert.match(q, /ParentProcessId = 12"/);
  assert.match(q, /-match 'event-host\|opencode\.\*serve'/);
  assert.match(windowsChildQuery(1, "a'b"), /'a''b'/);
  for (const bad of [0, -1, "x", 1.5])
    assert.throws(() => windowsChildQuery(bad, "x"));
});

test("childPids parses PowerShell output on win32 and pgrep elsewhere", () => {
  const calls = [];
  const win = childPids(5, "x", {
    platform: "win32",
    run: (file, args) => (calls.push([file, args]), "101\r\n202\r\n"),
  });
  assert.deepEqual(win, [101, 202]);
  assert.match(calls[0][0], /powershell\.exe$/);
  assert.deepEqual(calls[0][1].slice(0, 2), ["-NoProfile", "-NonInteractive"]);
  const posix = childPids(5, "p", {
    platform: "darwin",
    run: (file, args) => (calls.push([file, args]), "7\n8\n"),
  });
  assert.deepEqual(posix, [7, 8]);
  assert.deepEqual(calls[1], ["pgrep", ["-P", "5", "-f", "p"]]);
  assert.deepEqual(
    childPids(5, "p", {
      platform: "linux",
      run: () => {
        throw Object.assign(new Error("x"), { status: 1 });
      },
    }),
    [],
  );
});
