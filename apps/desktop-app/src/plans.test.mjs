import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  symlinkSync,
  realpathSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  parseChecklist,
  toggleChecklistItem,
  parseFindings,
  appendFinding,
  setFindingStatus,
  summarizeFindings,
  approvalState,
  nextApprovalVersion,
  checkStatusFromTerminal,
  checkStale,
  verificationSummary,
  workspaceFingerprint,
  sha256Hex,
  planSlug,
  isPlanPath,
  validatePlansRequest,
} from "./renderer/shared/plans/index.mjs";
import { createPlansHost } from "./host/plans-host.mjs";

const PLAN = [
  "# Title",
  "",
  "- [ ] one",
  "* [x] two",
  "```",
  "- [ ] in fence",
  "```",
  "  1. [ ] nested",
  "",
  "## Review",
  "",
  "- [ ] **reviewer**: missing test",
  "- [x] **implementer**: fixed -- resolved by user",
  "- [ ] not a finding but in review",
  "",
].join("\n");

test("checklist ignores fences and Review section", () => {
  const c = parseChecklist(PLAN);
  assert.deepEqual(
    c.items.map((i) => [i.line, i.checked, i.text]),
    [
      [2, false, "one"],
      [3, true, "two"],
      [7, false, "nested"],
    ],
  );
  assert.equal(c.done, 1);
  assert.equal(c.total, 3);
});

test("toggle flips exactly one byte and round-trips (LF, CRLF, no EOL)", () => {
  for (const text of [PLAN, PLAN.replace(/\n/g, "\r\n"), "- [ ] a"]) {
    const line = parseChecklist(text).items[0].line;
    const on = toggleChecklistItem(text, line);
    assert.equal(on.length, text.length);
    let diff = 0;
    for (let i = 0; i < text.length; i++) if (on[i] !== text[i]) diff++;
    assert.equal(diff, 1);
    assert.equal(toggleChecklistItem(on, line), text);
  }
  assert.equal(toggleChecklistItem(PLAN, 5), undefined); // in fence
  assert.equal(toggleChecklistItem(PLAN, 11), undefined); // review finding
  assert.equal(toggleChecklistItem(PLAN, 0), undefined);
});

test("findings parse, append, resolve preserving the rest", () => {
  const f = parseFindings(PLAN);
  assert.deepEqual(
    f.map((x) => [x.author, x.status, x.resolvedBy]),
    [
      ["reviewer", "open", undefined],
      ["implementer", "resolved", "user"],
    ],
  );
  const added = appendFinding(PLAN, { author: "reviewer", text: " a\n b " });
  assert.ok(added.includes("- [ ] **reviewer**: a b"));
  assert.equal(parseFindings(added).length, 3);
  assert.equal(
    added.replace("- [ ] **reviewer**: a b\n", ""),
    PLAN.replace(
      "- [ ] not a finding but in review\n",
      "- [ ] not a finding but in review\n",
    ),
  );
  const closed = setFindingStatus(PLAN, 11, "resolved", "implementer");
  assert.match(
    closed,
    /\*\*reviewer\*\*: missing test -- resolved by implementer/,
  );
  assert.equal(
    setFindingStatus(closed, 11, "open"),
    closed
      .replace(" -- resolved by implementer", "")
      .replace("[x] **reviewer", "[ ] **reviewer"),
  );
  assert.equal(setFindingStatus(PLAN, 2, "resolved"), undefined);
  assert.equal(appendFinding(PLAN, { author: "bot", text: "x" }), undefined);
  assert.equal(
    appendFinding(PLAN, { author: "reviewer", text: "  " }),
    undefined,
  );
});

test("append creates Review section and honours CRLF", () => {
  const out = appendFinding("# T\r\n- [ ] a", {
    author: "implementer",
    text: "x",
  });
  assert.equal(
    out,
    "# T\r\n- [ ] a\r\n\r\n## Review\r\n\r\n- [ ] **implementer**: x\r\n",
  );
  assert.deepEqual(
    parseChecklist(out).items.map((i) => i.text),
    ["a"],
  );
  assert.equal(
    appendFinding("", { author: "reviewer", text: "x" }),
    "## Review\n\n- [ ] **reviewer**: x\n",
  );
});

test("implementer-closed reviewer finding awaits re-check", () => {
  const s = summarizeFindings([
    { author: "reviewer", status: "resolved", resolvedBy: "implementer" },
    { author: "reviewer", status: "resolved", resolvedBy: "reviewer" },
    { author: "reviewer", status: "resolved", resolvedBy: "user" },
    { author: "implementer", status: "resolved", resolvedBy: "implementer" },
    { author: "reviewer", status: "open" },
  ]);
  assert.deepEqual(s, { open: 1, resolved: 3, awaitingRecheck: 1 });
});

test("approval staleness and versions", () => {
  const rec = [
    { path: "a.md", sha256: "h1", version: 1, approvedAt: "t" },
    { path: "a.md", sha256: "h2", version: 2, approvedAt: "t" },
    { path: "b.md", sha256: "h9", version: 1, approvedAt: "t" },
  ];
  assert.equal(approvalState(rec, "c.md", "h1").state, "none");
  assert.deepEqual(
    [
      approvalState(rec, "a.md", "h2").state,
      approvalState(rec, "a.md", "h2").version,
    ],
    ["approved", 2],
  );
  assert.equal(approvalState(rec, "a.md", "h1").version, 1);
  const stale = approvalState(rec, "a.md", "h3");
  assert.deepEqual([stale.state, stale.version], ["stale", 2]);
  assert.equal(nextApprovalVersion(rec, "a.md"), 3);
  assert.equal(nextApprovalVersion(rec, "z.md"), 1);
});

test("check status only from terminal exit; staleness; summary", () => {
  assert.equal(checkStatusFromTerminal(undefined), "not-run");
  assert.equal(
    checkStatusFromTerminal({ status: "running", exitCode: null }),
    "running",
  );
  assert.equal(
    checkStatusFromTerminal({ status: "exited", exitCode: 0, signal: null }),
    "passed",
  );
  assert.equal(
    checkStatusFromTerminal({ status: "exited", exitCode: 1, signal: null }),
    "failed",
  );
  assert.equal(
    checkStatusFromTerminal({
      status: "exited",
      exitCode: null,
      signal: "SIGTERM",
    }),
    "failed",
  );
  assert.equal(
    checkStatusFromTerminal({
      status: "exited",
      exitCode: 0,
      signal: "SIGKILL",
    }),
    "failed",
  );
  const pass = { status: "passed", planSha: "p", fingerprint: "f" };
  const cur0 = { planSha: "p", fingerprint: "f" };
  assert.equal(checkStale(pass, { planSha: "p", fingerprint: "f" }), false);
  assert.equal(checkStale(pass, { planSha: "q", fingerprint: "f" }), true);
  assert.equal(checkStale(pass, { planSha: "p", fingerprint: "g" }), true);
  assert.equal(checkStale(pass, { planSha: "p" }), false);
  // no recorded fingerprint (unverifiable) is never a plain pass
  assert.equal(
    checkStale({ status: "passed", planSha: "p", fingerprint: null }, cur0),
    true,
  );
  assert.equal(
    checkStale({ status: "running", planSha: "x" }, { planSha: "p" }),
    false,
  );
  const cur = { planSha: "p", fingerprint: "f" };
  assert.equal(verificationSummary([], cur), "none");
  assert.equal(verificationSummary([pass], cur), "passed");
  assert.equal(
    verificationSummary([pass, { ...pass, status: "failed" }], cur),
    "failed",
  );
  assert.equal(verificationSummary([pass], { planSha: "z" }), "stale");
  assert.equal(
    verificationSummary([pass, { ...pass, status: "running" }], cur),
    "running",
  );
  assert.equal(
    verificationSummary([pass, { ...pass, status: "not-run" }], cur),
    "pending",
  );
});

test("fingerprint is order independent; sha256Hex known vector; slugs and paths", async () => {
  const a = workspaceFingerprint(
    { head: "abc" },
    [
      { path: "b", index: "M", worktree: "." },
      { path: "a", index: ".", worktree: "M" },
    ],
    "d",
  );
  const b = workspaceFingerprint(
    { head: "abc" },
    [
      { path: "a", index: ".", worktree: "M" },
      { path: "b", index: "M", worktree: "." },
    ],
    "d",
  );
  assert.equal(a, b);
  assert.equal(workspaceFingerprint(undefined, [], "d"), undefined);
  assert.equal(workspaceFingerprint({ head: "abc" }, []), undefined);
  assert.equal(
    await sha256Hex("abc"),
    "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
  );
  assert.equal(planSlug("  Add Login / OAuth!! "), "add-login-oauth");
  assert.equal(planSlug("!!!"), "plan");
  assert.ok(isPlanPath(".omoc/plans/x.md"));
  assert.ok(!isPlanPath("x.txt"));
  assert.ok(!isPlanPath("../x.md"));
  assert.ok(!isPlanPath("CLAUDE.md"));
  assert.ok(!isPlanPath(".git/x.md"));
});

test("request validation is closed", () => {
  const h = "a".repeat(64);
  const ok = {
    type: "plans.approve",
    workspaceId: "w1",
    path: "a.md",
    sha256: h,
  };
  assert.ok(validatePlansRequest(ok));
  assert.ok(validatePlansRequest({ type: "plans.list", workspaceId: "w1" }));
  for (const bad of [
    { ...ok, extra: 1 },
    { ...ok, sha256: "zz" },
    { ...ok, path: "../a.md" },
    {
      type: "plans.check",
      workspaceId: "w",
      path: "a.md",
      kind: "rm",
      terminalId: "t",
    },
    {
      type: "plans.check",
      workspaceId: "w",
      path: "a.md",
      kind: "test",
      terminalId: "t",
      fingerprint: "x",
    },
    { type: "plans.create", workspaceId: "w", title: "  " },
    { type: "nope" },
    null,
    [],
  ])
    assert.equal(validatePlansRequest(bad), undefined);
});

function hostFixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "plans-")));
  const meta = realpathSync(mkdtempSync(join(tmpdir(), "plans-meta-")));
  let views = [];
  let clock = 0;
  const host = createPlansHost({
    resolveWorkspace: (id) => (id === "w1" ? root : undefined),
    storeFile: () => join(meta, "sub", "plans.json"),
    terminals: () => views,
    now: () => `t${++clock}`,
  });
  return { root, meta, host, setViews: (v) => (views = v) };
}

test("host: create, list, approve, stale, link", async () => {
  const { root, host } = hostFixture();
  const made = await host.create("o", { workspaceId: "w1", title: "My Plan" });
  assert.equal(made.created, ".omoc/plans/my-plan.md");
  assert.equal(
    (await host.create("o", { workspaceId: "w1", title: "My Plan" })).created,
    ".omoc/plans/my-plan-2.md",
  );
  const [p] = made.plans;
  await assert.rejects(
    host.approve("o", {
      workspaceId: "w1",
      path: p.path,
      sha256: "0".repeat(64),
    }),
    { plansCode: "STALE" },
  );
  await assert.rejects(
    host.link("o", {
      workspaceId: "w1",
      path: p.path,
      sha256: p.sha256,
      sessionId: "s",
    }),
    { plansCode: "NOT_APPROVED" },
  );
  const a = await host.approve("o", {
    workspaceId: "w1",
    path: p.path,
    sha256: p.sha256,
  });
  assert.equal(a.approvals[0].version, 1);
  const again = await host.approve("o", {
    workspaceId: "w1",
    path: p.path,
    sha256: p.sha256,
  });
  assert.equal(again.approvals.length, 1);
  const l = await host.link("o", {
    workspaceId: "w1",
    path: p.path,
    sha256: p.sha256,
    sessionId: "s1",
  });
  assert.deepEqual([l.links[0].sessionId, l.links[0].version], ["s1", 1]);
  writeFileSync(
    join(root, p.path),
    readFileSync(join(root, p.path), "utf8") + "x",
  );
  const after = await host.list("o", "w1");
  const cur = after.plans.find((x) => x.path === p.path);
  assert.notEqual(cur.sha256, p.sha256);
  assert.equal(
    approvalState(after.approvals, p.path, cur.sha256).state,
    "stale",
  );
  await assert.rejects(host.list("o", "nope"), { plansCode: "NOT_FOUND" });
});

test("host: check status comes only from terminal exit; missing terminal is not-run", async () => {
  const { host, setViews } = hostFixture();
  const made = await host.create("o", { workspaceId: "w1", title: "Chk" });
  const path = made.created;
  const term = (extra) => ({
    terminalId: "t1",
    workspaceId: "w1",
    status: "running",
    exitCode: null,
    signal: null,
    script: "test",
    label: "pnpm run test",
    ...extra,
  });
  await assert.rejects(
    host.check("o", {
      workspaceId: "w1",
      path,
      kind: "test",
      terminalId: "t1",
    }),
    { plansCode: "NOT_A_SCRIPT_RUN" },
  );
  setViews([term({ script: null })]);
  await assert.rejects(
    host.check("o", {
      workspaceId: "w1",
      path,
      kind: "test",
      terminalId: "t1",
    }),
    { plansCode: "NOT_A_SCRIPT_RUN" },
  );
  setViews([term()]);
  let v = await host.check("o", {
    workspaceId: "w1",
    path,
    kind: "test",
    terminalId: "t1",
    fingerprint: "f".repeat(64),
  });
  assert.equal(v.checks[0].status, "running");
  assert.equal(v.checks[0].source, "실행 결과");
  setViews([term({ status: "exited", exitCode: 0 })]);
  v = await host.list("o", "w1");
  assert.deepEqual([v.checks[0].status, v.checks[0].exitCode], ["passed", 0]);
  // Re-run replaces same kind+script; failing exit is failed.
  setViews([term({ terminalId: "t2", status: "exited", exitCode: 2 })]);
  v = await host.check("o", {
    workspaceId: "w1",
    path,
    kind: "test",
    terminalId: "t2",
  });
  assert.equal(v.checks.length, 1);
  assert.equal(v.checks[0].status, "failed");
  // Running check whose terminal vanished never becomes passed.
  setViews([term({ terminalId: "t3" })]);
  await host.check("o", {
    workspaceId: "w1",
    path,
    kind: "lint",
    terminalId: "t3",
  });
  setViews([]);
  v = await host.list("o", "w1");
  assert.equal(v.checks.find((c) => c.kind === "lint").status, "not-run");
});

test("host: symlinked plan files are not followed", async () => {
  const { root, host } = hostFixture();
  mkdirSync(join(root, ".omoc/plans"), { recursive: true });
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "outside-")));
  writeFileSync(join(outside, "secret.md"), "secret");
  symlinkSync(join(outside, "secret.md"), join(root, ".omoc/plans/leak.md"));
  const v = await host.list("o", "w1");
  assert.deepEqual(v.plans, []);
});

test("fences follow CommonMark: same char, length >= opener", () => {
  const text = ["````", "```", "- [ ] inside", "````", "- [ ] outside"].join(
    "\n",
  );
  assert.deepEqual(
    parseChecklist(text).items.map((i) => i.text),
    ["outside"],
  );
  const tilde = ["~~~", "```", "- [ ] still inside", "~~~", "- [ ] out"].join(
    "\n",
  );
  assert.deepEqual(
    parseChecklist(tilde).items.map((i) => i.text),
    ["out"],
  );
});

test("dirty tree: fresh check is a plain pass; plan dir ignored; status change goes stale", async () => {
  const repo = { head: "h" };
  const dirty = [{ path: "src/a.ts", index: ".", worktree: "M" }];
  const plan = { path: ".omoc/plans/p.md", index: ".", worktree: "?" };
  const fp = workspaceFingerprint(repo, dirty, "c1");
  assert.equal(workspaceFingerprint(repo, [...dirty, plan], "c1"), fp);
  const pass = { status: "passed", planSha: "p", fingerprint: fp };
  const cur = { planSha: "p", fingerprint: fp };
  assert.equal(checkStale(pass, cur), false);
  assert.equal(verificationSummary([pass], cur), "passed");
  const changed = workspaceFingerprint(
    repo,
    [...dirty, { path: "b.ts", index: ".", worktree: "?" }],
    "c1",
  );
  assert.equal(checkStale(pass, { planSha: "p", fingerprint: changed }), true);
  // same status rows, re-edited content: stale
  const reedited = workspaceFingerprint(repo, dirty, "c2");
  assert.equal(checkStale(pass, { planSha: "p", fingerprint: reedited }), true);
});
