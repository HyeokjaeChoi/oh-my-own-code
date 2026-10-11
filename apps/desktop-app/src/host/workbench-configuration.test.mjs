import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { mkdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  discoverConfiguration,
  metadataPath,
  metadataScope,
  skillProvenance,
} from "./workbench-configuration.mjs";

async function fixture(t) {
  const parent = await realpath(
    await mkdtemp(join(tmpdir(), "omoc-config-metadata-")),
  );
  const root = join(parent, "workspace");
  await mkdir(root);
  t.after(() => rm(parent, { recursive: true, force: true }));
  return { parent, root };
}

test("actual instruction/config markers are inert metadata, never contents or active state", async (t) => {
  const { root } = await fixture(t);
  const secret = "SYNTHETIC_SECRET_CONFIG_CANARY";
  const inputs = {
    "AGENTS.md": `Run a script that writes a marker. ${secret}`,
    "opencode.json": JSON.stringify({ headers: { Authorization: secret } }),
  };
  for (const [name, contents] of Object.entries(inputs))
    await writeFile(join(root, name), contents);
  await mkdir(join(root, ".claude"));
  await mkdir(join(root, ".codex"));
  await writeFile(join(root, ".codex/config.toml"), `token='${secret}'`);
  const result = await discoverConfiguration(root);
  assert.equal(result.status, "available");
  assert.equal(result.runtimeStatus, "not_reported");
  assert.equal(result.entries.length, 4);
  assert.ok(result.entries.every((entry) => entry.state === "discovered"));
  assert.equal(JSON.stringify(result).includes(secret), false);
  assert.equal(JSON.stringify(result).includes("active"), false);
  assert.equal(
    result.entries.find((entry) => entry.path.endsWith("config.toml")).reason,
    "not_reported",
  );
  for (const [name, contents] of Object.entries(inputs))
    assert.equal(await readFile(join(root, name), "utf8"), contents);
  assert.equal(
    result.entries.some((entry) => entry.path.endsWith("marker")),
    false,
  );
});

test("no linked root, linked marker or linked intermediate directory is traversed", async (t) => {
  const { parent, root } = await fixture(t);
  const outside = join(parent, "outside");
  await mkdir(outside);
  await writeFile(join(outside, "config.toml"), "PRIVATE_SYNTHETIC_TARGET");
  await symlink(outside, join(root, ".codex"), "dir");
  await symlink(join(outside, "config.toml"), join(root, "AGENTS.md"));
  const result = await discoverConfiguration(root);
  assert.equal(result.status, "partial");
  assert.equal(result.entries.length, 2);
  assert.ok(
    result.entries.every(
      (entry) =>
        entry.state === "unavailable" && entry.reason === "path_denied",
    ),
  );
  assert.equal(
    JSON.stringify(result).includes("PRIVATE_SYNTHETIC_TARGET"),
    false,
  );
  assert.equal(
    await readFile(join(outside, "config.toml"), "utf8"),
    "PRIVATE_SYNTHETIC_TARGET",
  );
  const alias = join(parent, "alias");
  await symlink(root, alias, "dir");
  assert.deepEqual((await discoverConfiguration(alias)).entries, []);
  assert.equal((await discoverConfiguration(alias)).status, "unavailable");
});

test("root replacement during metadata discovery invalidates the entire result", async (t) => {
  const { parent, root } = await fixture(t);
  await writeFile(join(root, "AGENTS.md"), "Original");
  let checks = 0;
  const result = await discoverConfiguration(root, () => {
    if (++checks === 4) {
      renameSync(root, join(parent, "original"));
      mkdirSync(root);
    }
  });
  assert.equal(result.status, "unavailable");
  assert.deepEqual(result.entries, []);
  assert.equal(
    await readFile(join(parent, "original/AGENTS.md"), "utf8"),
    "Original",
  );
});

test("caller deadline/shutdown failure is propagated instead of disguised as absent configuration", async (t) => {
  const { root } = await fixture(t);
  let checks = 0;
  const error = Object.assign(new Error("bounded caller"), {
    appCode: "READ_TIMEOUT",
  });
  await assert.rejects(
    discoverConfiguration(root, () => {
      if (++checks === 5) throw error;
    }),
    (actual) => actual === error,
  );
});

test("missing and malformed roots fail closed; absent markers remain discovered-empty not runtime-empty", async (t) => {
  const { parent, root } = await fixture(t);
  assert.equal(
    (await discoverConfiguration(join(parent, "missing"))).status,
    "unavailable",
  );
  assert.deepEqual(await discoverConfiguration(root), {
    status: "available",
    runtimeStatus: "not_reported",
    entries: [],
  });
  for (const value of [null, "relative", "/bad\npath", "/" + "x".repeat(4096)])
    assert.equal((await discoverConfiguration(value)).status, "unavailable");
});

test("reported skill metadata copies only path and source; getters/content/secrets are never inspected", () => {
  let touched = 0;
  const secret = "SYNTHETIC_SECRET_SKILL";
  const item = {
    path: "/synthetic/workspace/.agents/skills/review/SKILL.md",
    content: secret,
    environment: { API_KEY: secret },
    url: `https://example.invalid/${secret}`,
  };
  assert.deepEqual(skillProvenance("/synthetic/workspace", item), {
    source: "runtime",
    scope: "workspace",
    path: item.path,
  });
  assert.equal(
    JSON.stringify(skillProvenance("/synthetic/workspace", item)).includes(
      secret,
    ),
    false,
  );
  const accessor = Object.defineProperty({}, "path", {
    get() {
      touched++;
      return secret;
    },
  });
  assert.deepEqual(skillProvenance("/synthetic/workspace", accessor), {
    source: "runtime",
    scope: "runtime",
  });
  assert.equal(touched, 0);
});

test("scope is lexical location only, with prefix escapes/URLs/control/oversize paths rejected", () => {
  assert.equal(
    metadataScope("/synthetic/workspace", "/synthetic/workspace/skill.md"),
    "workspace",
  );
  for (const path of [
    "/synthetic/workspace-other/skill.md",
    "/synthetic/workspace/../external/skill.md",
  ])
    assert.equal(metadataScope("/synthetic/workspace", path), "external");
  for (const path of [
    undefined,
    "relative",
    "https://example.invalid/token",
    "/bad\u0085path",
    "/" + "x".repeat(4096),
  ]) {
    assert.equal(metadataPath(path), false);
    assert.equal(metadataScope("/synthetic/workspace", path), "runtime");
    assert.deepEqual(skillProvenance("/synthetic/workspace", { path }), {
      source: "runtime",
      scope: "runtime",
    });
  }
});
