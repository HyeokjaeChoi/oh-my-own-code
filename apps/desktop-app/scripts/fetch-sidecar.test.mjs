import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile, appendFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { gzipSync } from "node:zlib";
import {
  SIDECAR_RECEIPT,
  assertSidecarManifest,
  lockedIntegrity,
  unpackSidecar,
  verifySidecarReceipt,
} from "./fetch-sidecar.mjs";

function tarFile(name, content) {
  const header = Buffer.alloc(512);
  header.write(name, 0, "utf8");
  header.write("0000755\0", 100);
  header.write(`${content.length.toString(8).padStart(11, "0")}\0`, 124);
  header.write("00000000000\0", 136);
  header.write("        ", 148);
  header[156] = 48;
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, "0")}\0 `, 148);
  const pad = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, pad]);
}
const archive = (entries) =>
  gzipSync(
    Buffer.concat([
      ...entries.map(([n, c]) => tarFile(n, Buffer.from(c))),
      Buffer.alloc(1024),
    ]),
  );
const integrityOf = (buffer) =>
  `sha512-${createHash("sha512").update(buffer).digest("base64")}`;
const manifest = JSON.stringify({
  name: "@opencode/cli-windows-x64",
  version: "2.0.18",
  os: ["win32"],
  cpu: ["x64"],
});
const identity = {
  name: "@opencode/cli-windows-x64",
  version: "2.0.18",
  platform: "win32",
  arch: "x64",
};

test("lockfile integrity lookup is exact", () => {
  const lock = `  '@opencode/cli-windows-x64@2.0.18':\n    resolution: {integrity: sha512-${"A".repeat(86)}==}\n`;
  assert.equal(
    lockedIntegrity(lock, "@opencode/cli-windows-x64", "2.0.18"),
    `sha512-${"A".repeat(86)}==`,
  );
  assert.throws(
    () => lockedIntegrity(lock, "@opencode/cli-windows-x64", "2.0.19"),
    /not pinned/,
  );
});

test("archive: integrity first, then closed entry list", () => {
  const good = archive([
    ["package/package.json", manifest],
    ["package/bin/opencode.exe", "MZ-binary"],
  ]);
  const files = unpackSidecar(good, integrityOf(good), "opencode.exe");
  assert.equal(files.get("package/bin/opencode.exe").toString(), "MZ-binary");
  assert.throws(
    () => unpackSidecar(good, integrityOf(Buffer.from("x")), "opencode.exe"),
    /integrity mismatch/,
  );
  for (const extra of [
    ["package/../evil", "x"],
    ["package/bin/other.exe", "x"],
  ]) {
    const bad = archive([
      ["package/package.json", manifest],
      ["package/bin/opencode.exe", "x"],
      extra,
    ]);
    assert.throws(
      () => unpackSidecar(bad, integrityOf(bad), "opencode.exe"),
      /Unsafe sidecar archive entry/,
    );
  }
  const partial = archive([["package/package.json", manifest]]);
  assert.throws(
    () => unpackSidecar(partial, integrityOf(partial), "opencode.exe"),
    /Incomplete/,
  );
});

test("unpacked package.json must be the requested name, version, os and cpu", () => {
  assertSidecarManifest(Buffer.from(manifest), identity);
  for (const patch of [
    { name: "@opencode/cli-darwin-arm64" },
    { version: "2.0.17" },
    { os: ["darwin"] },
    { cpu: ["arm64"] },
    { os: ["win32", "linux"] },
  ])
    assert.throws(
      () =>
        assertSidecarManifest(
          Buffer.from(JSON.stringify({ ...JSON.parse(manifest), ...patch })),
          identity,
        ),
      /identity mismatch/,
    );
  assert.throws(
    () => assertSidecarManifest(Buffer.from("nope"), identity),
    /not JSON/,
  );
});

test("override directory needs a receipt that matches the lockfile and the bytes on disk", async (t) => {
  const dir = await mkdtemp(join(tmpdir(), "omoc-sidecar-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, "bin"));
  const binary = Buffer.from("MZ-binary");
  await writeFile(join(dir, "bin", "opencode.exe"), binary);
  await writeFile(join(dir, "package.json"), manifest);
  const sha = (b) => createHash("sha256").update(b).digest("hex");
  const integrity = `sha512-${"B".repeat(86)}==`;
  const lockText = `  '@opencode/cli-windows-x64@2.0.18':\n    resolution: {integrity: ${integrity}}\n`;
  const options = {
    lockText,
    name: "@opencode/cli-windows-x64",
    version: "2.0.18",
    binary: "opencode.exe",
  };
  await assert.rejects(verifySidecarReceipt(dir, options)); // no receipt
  const receipt = {
    name: options.name,
    version: options.version,
    integrity,
    binarySha256: sha(binary),
    manifestSha256: sha(Buffer.from(manifest)),
  };
  await writeFile(join(dir, SIDECAR_RECEIPT), JSON.stringify(receipt));
  assert.deepEqual(await verifySidecarReceipt(dir, options), receipt);
  await appendFile(join(dir, "bin", "opencode.exe"), "tamper");
  await assert.rejects(
    verifySidecarReceipt(dir, options),
    /not the verified lockfile package/,
  );
  await writeFile(join(dir, "bin", "opencode.exe"), binary);
  await assert.rejects(
    verifySidecarReceipt(dir, {
      ...options,
      lockText: lockText.replace("BBBB", "CCCC"),
    }),
    /not the verified/,
  );
});
