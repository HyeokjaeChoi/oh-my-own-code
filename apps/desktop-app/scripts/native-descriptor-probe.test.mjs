// Node-only probe diagnostics. Does not prepare or execute a Bun child.
import assert from "node:assert/strict";
import * as fs from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const current = new URL("./native-descriptor-probe.mjs", import.meta.url);
const prior = new URL(
  "../../../docs/runs/permission-task-lifetime-integration/prechange/descriptor-probe-diagnostic-before-r1/apps/desktop-app/scripts/native-descriptor-probe.mjs",
  import.meta.url,
);
const text = fs.readFileSync(
  process.env.OMOC_DESCRIPTOR_PROBE_DIAGNOSTIC_PRECHANGE === "1"
    ? prior
    : current,
  "utf8",
);
const start = text.indexOf("function fds() {");
const end = text.indexOf("async function fixture(root)", start);
assert.ok(start >= 0 && end > start);
const createInventory = (io) =>
  new Function("fs", text.slice(start, end) + "\nreturn fds;")(io);

test("probe inventory uses the original numeric FD, never descriptor-path stat", () => {
  let paths = 0;
  const descriptors = [];
  const inventory = createInventory({
    readdirSync: () => ["7", "8", "not-a-descriptor"],
    fstatSync(fd, options) {
      descriptors.push(fd);
      assert.equal(options.bigint, true);
      if (fd === 8) throw new Error("already closed enumeration FD");
      return { dev: 1n, ino: 2n, mode: 3n };
    },
    statSync() {
      paths++;
      throw new Error("descriptor path is not physical FD proof");
    },
  });
  assert.deepEqual(inventory(), [["7", "1", "2", "3"]]);
  assert.deepEqual(descriptors, [7, 8]);
  assert.equal(paths, 0);
});

test("probe inventory observes an actual held directory FD and drops it after close", () => {
  const root = fs.mkdtempSync(join(tmpdir(), "omoc-descriptor-inventory-"));
  const fd = fs.openSync(
    root,
    fs.constants.O_RDONLY | fs.constants.O_DIRECTORY,
  );
  const stat = fs.fstatSync(fd, { bigint: true });
  const inventory = createInventory(fs);
  const row = [
    String(fd),
    String(stat.dev),
    String(stat.ino),
    String(stat.mode),
  ];
  try {
    assert.ok(
      inventory().some((item) => JSON.stringify(item) === JSON.stringify(row)),
    );
  } finally {
    fs.closeSync(fd);
  }
  assert.ok(
    !inventory().some((item) => JSON.stringify(item) === JSON.stringify(row)),
  );
  fs.rmdirSync(root);
});
