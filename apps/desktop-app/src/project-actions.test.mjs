import test from "node:test";
import assert from "node:assert/strict";
import { spawn as realSpawn } from "node:child_process";
import { mkdtempSync, writeFileSync, realpathSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readProjectActions } from "./host/project-actions.mjs";
import { createTerminalHost } from "./host/terminal-host.mjs";
import {
  detectPackageManager,
  parsePackageScripts,
} from "./renderer/shared/project-actions/index.mjs";
import { validateTerminalRequest } from "./renderer/shared/terminal/index.mjs";
import {
  buildPaletteEntries,
  filterPaletteEntries,
} from "./renderer/shared/palette/index.mjs";

const dir = () => realpathSync(mkdtempSync(join(tmpdir(), "pa-")));
const pkg = (root, value) =>
  writeFileSync(
    join(root, "package.json"),
    typeof value === "string" ? value : JSON.stringify(value),
  );

test("package manager detection by lockfile, npm default", () => {
  assert.equal(detectPackageManager(["pnpm-lock.yaml"]), "pnpm");
  assert.equal(detectPackageManager(["yarn.lock"]), "yarn");
  assert.equal(detectPackageManager(["bun.lockb"]), "bun");
  assert.equal(detectPackageManager(["bun.lock"]), "bun");
  assert.equal(detectPackageManager(["package-lock.json"]), "npm");
  assert.equal(detectPackageManager(["package.json"]), "npm");
  assert.equal(
    detectPackageManager(["package-lock.json", "pnpm-lock.yaml"]),
    "pnpm",
  );
});

test("script parsing tolerates malformed input and filters bad names", () => {
  assert.deepEqual(parsePackageScripts("{bad"), []);
  assert.deepEqual(parsePackageScripts("[]"), []);
  assert.deepEqual(parsePackageScripts('{"scripts":[1]}'), []);
  assert.deepEqual(parsePackageScripts('{"name":"x"}'), []);
  assert.deepEqual(
    parsePackageScripts(
      JSON.stringify({
        scripts: {
          test: "node --test",
          "--flag": "x",
          "a b": "x",
          "x;id": "x",
          num: 3,
          "build:app": "vite",
        },
      }),
    ),
    [
      { name: "test", command: "node --test" },
      { name: "build:app", command: "vite" },
    ],
  );
});

test("readProjectActions reads scripts; missing/malformed/oversized yield none", async () => {
  const root = dir();
  assert.deepEqual(await readProjectActions(root), {
    packageManager: "npm",
    scripts: [],
  });
  writeFileSync(join(root, "yarn.lock"), "");
  pkg(root, { scripts: { dev: "vite" } });
  assert.deepEqual(await readProjectActions(root), {
    packageManager: "yarn",
    scripts: [{ name: "dev", command: "vite" }],
  });
  pkg(root, "{nope");
  assert.deepEqual((await readProjectActions(root)).scripts, []);
  pkg(root, JSON.stringify({ scripts: { a: "x".repeat(300000) } }));
  assert.deepEqual((await readProjectActions(root)).scripts, []);
  assert.deepEqual((await readProjectActions(join(root, "gone"))).scripts, []);
});

test("readProjectActions ignores a symlinked package.json", async () => {
  const root = dir();
  const other = dir();
  pkg(other, { scripts: { evil: "x" } });
  symlinkSync(join(other, "package.json"), join(root, "package.json"));
  assert.deepEqual((await readProjectActions(root)).scripts, []);
});

test("terminal start validation: script name shape", () => {
  const ok = { type: "terminal.start", workspaceId: "w1", script: "build:app" };
  assert.ok(validateTerminalRequest(ok));
  for (const script of ["--help", "a b", "x;id", "$(id)", "a\nb", "", 1])
    assert.equal(validateTerminalRequest({ ...ok, script }), undefined);
  assert.ok(
    validateTerminalRequest({ type: "terminal.scripts", workspaceId: "w1" }),
  );
});

test("startScript spawns argv of the detected package manager, attributed", async () => {
  const root = dir();
  writeFileSync(join(root, "pnpm-lock.yaml"), "");
  pkg(root, { scripts: { test: "echo hi" } });
  const calls = [];
  const host = createTerminalHost({
    resolveWorkspace: (id) => (id === "w1" ? root : undefined),
    spawn: (file, args, options) => {
      calls.push({ file, args, shell: options.shell });
      return realSpawn("/bin/sh", ["-c", "exit 0"], options);
    },
    killGraceMs: 100,
  });
  const t = await host.startScript("o", { workspaceId: "w1", script: "test" });
  assert.deepEqual(calls, [
    { file: "pnpm", args: ["run", "test"], shell: undefined },
  ]);
  assert.equal(t.script, "test");
  assert.equal(t.label, "pnpm run test");
  assert.deepEqual(
    host.list("o", "w1").map((x) => x.label),
    ["pnpm run test"],
  );
  await host.closeAll();
});

test("closeOwner during the scripts read cancels startScript", async () => {
  const root = dir();
  pkg(root, { scripts: { test: "echo hi" } });
  let spawned = 0;
  const host = createTerminalHost({
    resolveWorkspace: () => root,
    spawn: (file, args, options) => {
      spawned++;
      return realSpawn("/bin/sh", ["-c", "exit 0"], options);
    },
    killGraceMs: 100,
  });
  const p = host.startScript("o", { workspaceId: "w1", script: "test" });
  await host.closeOwner("o");
  await assert.rejects(p, { terminalCode: "NOT_FOUND" });
  assert.equal(spawned, 0);
  await host.closeAll();
});

test("startScript rejects unknown scripts and workspaces without spawning", async () => {
  const root = dir();
  pkg(root, { scripts: { test: "echo hi" } });
  const calls = [];
  const host = createTerminalHost({
    resolveWorkspace: (id) => (id === "w1" ? root : undefined),
    spawn: (...a) => calls.push(a),
  });
  for (const script of ["nope", "test; id", "--version", "constructor"])
    await assert.rejects(host.startScript("o", { workspaceId: "w1", script }), {
      terminalCode: "UNKNOWN_SCRIPT",
    });
  await assert.rejects(
    host.startScript("o", { workspaceId: "w2", script: "test" }),
    { terminalCode: "NOT_FOUND" },
  );
  assert.equal(calls.length, 0);
});

const catalog = {
  commands: {
    status: "available",
    entries: [{ id: "c1", name: "review", description: "Review code" }],
  },
  skills: {
    status: "available",
    entries: [{ id: "s1", name: "tdd", description: "" }],
  },
};
const base = {
  hasWorkspace: true,
  pending: false,
  workspaceBlocked: false,
  resourceBlocked: false,
  connected: true,
  sessions: [
    { id: "a", title: "First" },
    { id: "b", title: "Second" },
  ],
  currentSessionId: "a",
  catalog,
  scripts: [{ name: "test", command: "node --test" }],
  packageManager: "pnpm",
};

test("palette entries cover app, runtime and project sources", () => {
  const entries = buildPaletteEntries(base);
  const by = (id) => entries.find((e) => e.id === id);
  assert.equal(by("app:settings").source, "app");
  assert.equal(by("app:session:a"), undefined);
  assert.equal(by("app:session:b").action.sessionId, "b");
  assert.deepEqual(by("runtime:command:c1").action, {
    type: "draft",
    text: "/review ",
  });
  assert.equal(by("runtime:command:c1").source, "runtime");
  assert.match(by("runtime:skill:s1").action.text, /tdd/);
  assert.equal(by("project:script:test").label, "pnpm run test");
  assert.equal(by("app:new-session").disabled, undefined);
});

test("palette disabled states carry reasons; unavailable catalog adds no runtime entries", () => {
  const e = buildPaletteEntries({
    ...base,
    hasWorkspace: false,
    pending: true,
    catalog: { commands: { status: "unavailable" }, skills: null },
  });
  const by = (id) => e.find((x) => x.id === id);
  assert.ok(by("app:new-session").reason);
  assert.ok(by("app:panel:terminal").disabled);
  assert.equal(by("app:panel:files").disabled, undefined);
  assert.ok(by("app:import-folder").reason);
  assert.equal(e.filter((x) => x.source === "runtime").length, 0);
  assert.equal(
    buildPaletteEntries({ ...base, connected: false }).find(
      (x) => x.id === "app:new-session",
    ).disabled,
    true,
  );
});

test("palette filtering is case-insensitive, multi-term, and matches source/detail", () => {
  const entries = buildPaletteEntries(base);
  assert.equal(filterPaletteEntries(entries, "").length, entries.length);
  assert.deepEqual(
    filterPaletteEntries(entries, "REVIEW").map((e) => e.id),
    ["runtime:command:c1"],
  );
  assert.deepEqual(
    filterPaletteEntries(entries, "node test").map((e) => e.id),
    ["project:script:test"],
  );
  assert.ok(
    filterPaletteEntries(entries, "런타임").every(
      (e) => e.source === "runtime",
    ),
  );
  assert.equal(filterPaletteEntries(entries, "zzz").length, 0);
});
