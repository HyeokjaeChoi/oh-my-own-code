// Explicit synthetic staging ONLY. No operator migration, cutover or native SQL.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, relative, resolve, sep } from "node:path";
import { openStorageJournal } from "../../src/host/storage-journal.mjs";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function contained(root, path) {
  const rel = relative(root, path);
  assert.ok(rel && rel !== ".." && !rel.startsWith(`..${sep}`));
  let current = root;
  for (const part of rel.split(sep)) {
    current = join(current, part);
    const stat = await fs.lstat(current);
    assert.equal(stat.isSymbolicLink(), false);
  }
}
export async function syntheticInventory(root) {
  assert.equal(await fs.realpath(root), root);
  const files = [];
  let bytes = 0;
  async function walk(directory, depth = 0) {
    assert.ok(depth <= 12);
    for (const entry of (await fs.readdir(directory)).sort()) {
      const path = join(directory, entry);
      await contained(root, path);
      const stat = await fs.lstat(path);
      if (stat.isDirectory()) await walk(path, depth + 1);
      else {
        assert.ok(stat.isFile() && stat.nlink === 1);
        assert.ok(
          files.length < 256 && (bytes += stat.size) <= 16 * 1024 * 1024,
        );
        files.push({
          path: relative(root, path).split(sep).join("/"),
          bytes: stat.size,
          sha256: hash(await fs.readFile(path)),
        });
      }
    }
  }
  await walk(root);
  return files;
}
export async function probeSyntheticMigration({
  root,
  explicitlyAuthorized = false,
}) {
  assert.equal(
    explicitlyAuthorized,
    true,
    "Synthetic migration requires explicit authorization",
  );
  assert.equal(await fs.realpath(root), root);
  const source = join(root, "source-retained");
  const destination = join(root, "destination-staged");
  const collision = join(root, "destination-collision");
  const journalDirectory = join(root, "migration-journal");
  for (const path of [source, collision, journalDirectory])
    await fs.mkdir(path, { mode: 0o700 });
  await fs.mkdir(join(source, "native"), { mode: 0o700 });
  // Inert sentinels exercise full-file-set retention. They are not SQLite files.
  for (const [name, text] of [
    ["database-sentinel", "database synthetic"],
    ["wal-sentinel", "WAL synthetic"],
    ["shm-sentinel", "SHM synthetic"],
    ["history-sentinel", "history synthetic"],
    ["inbox-sentinel", "pending synthetic"],
  ])
    await fs.writeFile(join(source, "native", name), text, {
      flag: "wx",
      mode: 0o600,
    });
  await fs.writeFile(join(collision, "keep.txt"), "collision retained", {
    flag: "wx",
    mode: 0o600,
  });
  const original = await syntheticInventory(source);
  const collisionBefore = await syntheticInventory(collision);
  const inventoryHash = hash(JSON.stringify(original));
  const journal = await openStorageJournal({
    directory: journalDirectory,
    storeId: "synthetic-migration",
  });
  const phases = [];
  let revision = 0;
  const phase = async (name) => {
    await journal.append({
      kind: "migration_phase",
      revision: ++revision,
      migrationId: "synthetic-migration-one",
      sourceStoreId: "source",
      destinationStoreId: "staged",
      phase: name,
      inventoryHash,
    });
    await journal.checkpoint();
    phases.push(name);
  };
  try {
    await phase("retained");
    // Owned inert namespace, no live processes or imported paths.
    await phase("quiesced");
    await assert.rejects(fs.mkdir(collision, { mode: 0o700 }), {
      code: "EEXIST",
    });
    assert.deepEqual(await syntheticInventory(collision), collisionBefore);
    await fs.mkdir(destination, { mode: 0o700 }); // Exclusive; never overwrite.
    for (const file of original) {
      const target = resolve(destination, file.path);
      assert.ok(target.startsWith(`${destination}${sep}`));
      await fs.mkdir(resolve(target, ".."), { recursive: true, mode: 0o700 });
      await fs.copyFile(
        join(source, file.path),
        target,
        fs.constants.COPYFILE_EXCL,
      );
    }
    await phase("copied");
    assert.deepEqual(await syntheticInventory(destination), original);
    assert.deepEqual(await syntheticInventory(source), original);
    await phase("verified");
    // Native transfer/location preservation is unproved; never record cutover.
    await fs.writeFile(
      join(destination, "new-durable-sentinel"),
      "new data retained",
      { flag: "wx", mode: 0o600 },
    );
    const rollbackBefore = await syntheticInventory(destination);
    await phase("rollback");
    assert.deepEqual(await syntheticInventory(source), original);
    assert.deepEqual(await syntheticInventory(destination), rollbackBefore);
    return {
      provenance:
        "explicit synthetic staged-copy fixture using production journal",
      phases,
      sourceInventory: original,
      retainedDestinationInventory: rollbackBefore,
      collisionInventory: collisionBefore,
      cutover: "held; native mapping transfer unproved",
    };
  } finally {
    await journal.close();
  }
}
