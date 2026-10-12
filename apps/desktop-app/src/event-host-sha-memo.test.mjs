import assert from "node:assert/strict";
import { mkdtemp, readFile, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { resourceFileSha256 } from "./event-host-resources.mjs";

test("resourceFileSha256 memoizes on identical stat and rehashes on change", async () => {
  const dir = await mkdtemp(join(tmpdir(), "sha-memo-"));
  const path = join(dir, "f");
  await writeFile(path, "aaaa");
  const first = await resourceFileSha256(path);
  assert.equal(await resourceFileSha256(path), first);
  // Same size, new content: ctime/mtime change forces a rehash.
  await new Promise((r) => setTimeout(r, 20));
  await writeFile(path, "bbbb");
  const second = await resourceFileSha256(path);
  assert.notEqual(second, first);
  assert.equal(await readFile(path, "utf8"), "bbbb");
  await utimes(path, new Date(1e12), new Date(1e12));
  assert.equal(await resourceFileSha256(path), second);
});
