import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { searchFiles, SEARCH_LIMITS } from "./workbench-file-search.mjs";
import { validateRequest } from "../workbench-contract.mjs";

async function fixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "search-")));
  await mkdir(join(root, "src"));
  await mkdir(join(root, "node_modules"));
  await mkdir(join(root, ".git"));
  await writeFile(join(root, "src", "alpha.txt"), "one\nNeedle here\nthree\n");
  await writeFile(join(root, "bin.dat"), Buffer.from("needle\0binary"));
  await writeFile(join(root, "node_modules", "n.txt"), "needle");
  await writeFile(join(root, ".git", "g.txt"), "needle");
  return root;
}
const find = (root, query, mode, extra = {}, signal) =>
  searchFiles(root, { query, mode, ...extra }, signal);

test("name search is case-insensitive by default and skips .git/node_modules", async () => {
  const root = await fixture();
  assert.deepEqual((await find(root, "ALPHA", "name")).results, [
    { path: "src/alpha.txt" },
  ]);
  assert.equal(
    (await find(root, "ALPHA", "name", { caseSensitive: true })).results.length,
    0,
  );
  assert.equal((await find(root, "g.txt", "name")).results.length, 0);
});

test("content search reports line numbers and skips binary and ignored dirs", async () => {
  const root = await fixture();
  const { results } = await find(root, "needle", "content");
  assert.deepEqual(results, [
    { path: "src/alpha.txt", line: 2, snippet: "Needle here" },
  ]);
});

test("files over the size cap are skipped", async () => {
  const root = await fixture();
  await writeFile(
    join(root, "big.txt"),
    "needle" + "x".repeat(SEARCH_LIMITS.fileBytes),
  );
  const { results } = await find(root, "needle", "content");
  assert.ok(!results.some((r) => r.path === "big.txt"));
});

test("results are capped and flagged truncated", async () => {
  const root = await fixture();
  for (let i = 0; i < SEARCH_LIMITS.results + 5; i++)
    await writeFile(join(root, `f${i}.txt`), "x");
  const out = await find(root, "f", "name");
  assert.equal(out.results.length, SEARCH_LIMITS.results);
  assert.equal(out.truncated, true);
});

test("an aborted search is cancelled", async () => {
  const root = await fixture();
  const abort = new AbortController();
  abort.abort();
  await assert.rejects(find(root, "a", "name", {}, abort.signal), {
    appCode: "CANCELLED",
  });
});

test("symlinks are never followed out of the workspace", async () => {
  const root = await fixture();
  const outside = await realpath(await mkdtemp(join(tmpdir(), "outside-")));
  await writeFile(join(outside, "secret.txt"), "needle");
  await symlink(outside, join(root, "link"));
  await symlink(join(outside, "secret.txt"), join(root, "file-link.txt"));
  const { results } = await find(root, "needle", "content");
  assert.ok(results.every((r) => r.path === "src/alpha.txt"));
  assert.equal((await find(root, "secret", "name")).results.length, 0);
  const alias = join(outside, "alias");
  await symlink(root, alias);
  await assert.rejects(find(alias, "needle", "content"), {
    appCode: "FILE_DENIED",
  });
});

test("contract validates file.search input", () => {
  const ok = {
    type: "file.search",
    workspaceId: "w",
    query: "q",
    mode: "name",
  };
  assert.deepEqual(validateRequest(ok), ok);
  validateRequest({ ...ok, caseSensitive: true });
  for (const bad of [
    { ...ok, mode: "regex" },
    { ...ok, query: "  " },
    { ...ok, query: "x".repeat(201) },
    { ...ok, caseSensitive: "yes" },
    { ...ok, extra: 1 },
    { type: "file.search", workspaceId: "w", mode: "name" },
  ])
    assert.throws(() => validateRequest(bad), { appCode: "INVALID_REQUEST" });
});
