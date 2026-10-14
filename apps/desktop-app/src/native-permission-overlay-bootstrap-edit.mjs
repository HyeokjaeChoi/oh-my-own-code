// Test-only: the sanctioned differences between a prechange overlay recipe and
// the current one are the Session.create gate (held -> bootstrap handoff) and
// the parent admission for child creates, the fork wrapper that hands its input to Control.enter (parent-bound consume),
// and the Permission.assert .git/.hg edit guard.
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";

const CHUNK = "node_modules/@opencode/core/dist/chunks/config-zyp346xr.js";
const PERMISSION_CHUNK =
  "node_modules/@opencode/core/dist/chunks/config-vgpkvtp0.js";
const FIND = '    create: Effect.fn("Session.create")(function* (input) {\n';

export function assertOnlyCreateGateChanged(current, baseline) {
  assert.equal(current.length, baseline.length);
  baseline.forEach((old, index) => {
    const file = current[index];
    if (old.path === PERMISSION_CHUNK) {
      // Permission.assert gained the .git/.hg edit guard; nothing else moved.
      assert.equal(file.beforeSha256, old.beforeSha256);
      assert.notEqual(file.afterSha256, old.afterSha256);
      assert.equal(file.edits.length, old.edits.length);
      const diff = old.edits
        .map((edit, at) => [edit, file.edits[at]])
        .filter(([was, now]) => !isDeepStrictEqual(was, now));
      assert.equal(diff.length, 1, "only the Permission.assert edit differs");
      assert.equal(diff[0][0].find, diff[0][1].find);
      assert.match(diff[0][1].replace, /control\.assertNotVcsMetadataPath\(/u);
      return;
    }
    if (old.path !== CHUNK) return assert.deepEqual(file, old);
    assert.equal(file.path, old.path);
    // Same source bytes, a different (re-pinned) result.
    assert.equal(file.beforeSha256, old.beforeSha256);
    assert.notEqual(file.afterSha256, old.afterSha256);
    assert.equal(file.edits.length, old.edits.length);
    const changed = old.edits
      .map((edit, at) => [edit, file.edits[at]])
      .filter(([was, now]) => !isDeepStrictEqual(was, now));
    assert.equal(changed.length, 2, "only the create and fork edits differ");
    const [[was, now], [wasFork, nowFork]] = changed;
    assert.equal(wasFork.find, nowFork.find);
    assert.match(wasFork.replace, /for \(const name of \["fork", "remove"/u);
    assert.match(nowFork.replace, /const forkOriginal = result\.fork;/u);
    // The fork parent is checked against its handoff, never merely existing.
    assert.match(
      nowFork.replace,
      /result\.fork = \(input, \.\.\.args\) => enter\(input\?\.sessionID, \(\) => Effect\.void, input\)/u,
    );
    assert.equal(nowFork.replace.includes('"fork", "remove"'), false);
    assert.equal(was.find, FIND);
    assert.equal(now.find, FIND);
    assert.match(
      was.replace,
      /Effect\.fail\(new Error\("native_permission_held"\)\)/u,
    );
    // The gate is the first statement, then the child-parent admission, and
    // nothing else is added: the whole replacement is pinned exactly.
    assert.equal(
      now.replace,
      FIND +
        "      // Only a private bootstrap handoff armed for exactly this input may create.\n" +
        "      // Direct HTTP callers, other methods and duplicate-ID probes are refused.\n" +
        "      yield* control.consumeBootstrap(input);\n" +
        "      // A child may only be created under a parent whose project is admitted (same gate as fork).\n" +
        "      if (input?.parentID !== undefined) yield* enter(input.parentID, () => Effect.void);\n",
    );
    assert.equal(now.replace.includes("native_permission_held"), false);
  });
}
