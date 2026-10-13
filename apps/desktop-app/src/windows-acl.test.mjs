import assert from "node:assert/strict";
import test from "node:test";
import {
  SID_ADMINISTRATORS,
  SID_SYSTEM,
  WINDOWS_ACL_SCRIPT,
  assertWindowsPrivateDirectories,
  assertWindowsPrivateDirectoriesSync,
  judgeWindowsAcl,
  parseWindowsAcl,
  resetWindowsAclCache,
} from "./windows-acl.mjs";

const ME = "S-1-5-21-111-222-333-1001";
const rule = (sid, allow = true) => ({ sid, allow });
const good = {
  path: "C:\\Users\\u\\AppData\\Roaming\\OhMyOwnCode",
  owner: ME,
  rules: [rule(ME), rule(SID_SYSTEM), rule(SID_ADMINISTRATORS)],
};

test("private: owner is me or Administrators and only trusted principals are allowed", () => {
  assert.equal(judgeWindowsAcl(good, ME), true);
  assert.equal(
    judgeWindowsAcl({ ...good, owner: SID_ADMINISTRATORS }, ME),
    true,
  );
  // single rule serialized as an object (PowerShell JSON quirk)
  assert.equal(judgeWindowsAcl({ ...good, rules: rule(ME) }, ME), true);
  // deny ACEs for others never make a directory non-private
  assert.equal(
    judgeWindowsAcl(
      { ...good, rules: [...good.rules, rule("S-1-1-0", false)] },
      ME,
    ),
    true,
  );
});

test("refused: foreign owner, Everyone/Users/Authenticated Users allow, odd or missing data", () => {
  for (const owner of ["S-1-5-21-9-9-9-1002", SID_SYSTEM, undefined, ""])
    assert.throws(
      () => judgeWindowsAcl({ ...good, owner }, ME),
      /storage_denied/,
    );
  for (const sid of [
    "S-1-1-0",
    "S-1-5-32-545",
    "S-1-5-11",
    "S-1-5-21-9-9-9-1002",
    "S-1-5-4",
  ])
    assert.throws(
      () => judgeWindowsAcl({ ...good, rules: [...good.rules, rule(sid)] }, ME),
      /storage_denied/,
      sid,
    );
  assert.throws(
    () => judgeWindowsAcl({ ...good, rules: [] }, ME),
    /storage_denied/,
  );
  assert.throws(
    () => judgeWindowsAcl({ ...good, rules: [rule("Everyone")] }, ME),
    /storage_denied/,
  );
  assert.throws(() => judgeWindowsAcl(good, "not-a-sid"), /storage_denied/);
  assert.throws(() => judgeWindowsAcl(null, ME), /storage_denied/);
});

test("parse requires the same ordered paths and valid JSON", () => {
  const paths = [good.path];
  assert.equal(
    parseWindowsAcl(JSON.stringify({ me: ME, items: [good] }), paths),
    true,
  );
  assert.equal(
    parseWindowsAcl(JSON.stringify({ me: ME, items: good }), paths),
    true,
  );
  assert.throws(() => parseWindowsAcl("garbage", paths), /storage_denied/);
  assert.throws(
    () => parseWindowsAcl(JSON.stringify({ me: ME, items: [] }), paths),
    /storage_denied/,
  );
  assert.throws(
    () =>
      parseWindowsAcl(
        JSON.stringify({ me: ME, items: [{ ...good, path: "C:\\other" }] }),
        paths,
      ),
    /storage_denied/,
  );
});

test("runner: win32 only, one batched PowerShell call, cached verdicts, fail closed", async () => {
  resetWindowsAclCache();
  const calls = [];
  const out = (paths) =>
    JSON.stringify({ me: ME, items: paths.map((path) => ({ ...good, path })) });
  const run = (file, args, options) => {
    calls.push({ file, args, options });
    return out(options.env.OMOC_ACL_PATHS.split("|"));
  };
  const a = "C:\\s\\a",
    b = "C:\\s\\b";
  assert.equal(
    assertWindowsPrivateDirectoriesSync([a, b], {
      platform: "win32",
      run,
      env: { SystemRoot: "D:\\W" },
    }),
    true,
  );
  assert.equal(calls.length, 1);
  assert.match(
    calls[0].file,
    /^D:\\W\\System32\\WindowsPowerShell\\v1\.0\\powershell\.exe$/,
  );
  assert.equal(calls[0].options.env.OMOC_ACL_PATHS, `${a}|${b}`);
  assert.ok(calls[0].args.includes(WINDOWS_ACL_SCRIPT));
  assertWindowsPrivateDirectoriesSync([a], { platform: "win32", run });
  assert.equal(calls.length, 1); // cached
  assertWindowsPrivateDirectoriesSync([a, "C:\\s\\c"], {
    platform: "win32",
    run,
  });
  assert.equal(calls.length, 2);
  assert.equal(calls[1].options.env.OMOC_ACL_PATHS, "C:\\s\\c");
  // not win32: no call
  assert.equal(
    assertWindowsPrivateDirectoriesSync(["/x"], { platform: "darwin", run }),
    true,
  );
  assert.equal(calls.length, 2);
  // async variant, failure => storage_denied
  await assert.rejects(
    assertWindowsPrivateDirectories(["C:\\z"], {
      platform: "win32",
      run: (f, a2, o, cb) => cb(new Error("spawn")),
    }),
    /storage_denied/,
  );
  await assert.rejects(
    assertWindowsPrivateDirectories(["C:\\y"], {
      platform: "win32",
      run: (f, a2, o, cb) =>
        cb(
          null,
          JSON.stringify({
            me: ME,
            items: [
              {
                ...good,
                path: "C:\\y",
                rules: [...good.rules, rule("S-1-1-0")],
              },
            ],
          }),
        ),
    }),
    /storage_denied/,
  );
  // unsafe inputs are refused before any process starts
  for (const bad of ["relative", "C:\\a|b", ""])
    assert.throws(
      () =>
        assertWindowsPrivateDirectoriesSync([bad], { platform: "win32", run }),
      /storage_denied/,
    );
  assert.equal(calls.length, 2);
});
