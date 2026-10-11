import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import {
  PERMISSION_DATA_MAX_BYTES,
  permissionCanonicalJSON,
  permissionDomainDigest,
} from "./permission-control-canonical.mjs";

test("canonical permission data preserves exact strings and list order", () => {
  assert.equal(
    permissionCanonicalJSON({ z: ["\ufeffa\r\nb", "second"], a: 1 }),
    '{"a":1,"z":["﻿a\\r\\nb","second"]}',
  );
  assert.equal(
    permissionCanonicalJSON({ "\u{10000}": 2, "\ue000": 1 }),
    '{"":1,"𐀀":2}',
  );
});

test("object permutations agree but ordered arrays and Unicode bytes differ", () => {
  const a = { z: [{ resource: "*", action: "read", effect: "ask" }], a: true };
  const b = { a: true, z: [{ effect: "ask", action: "read", resource: "*" }] };
  assert.equal(permissionCanonicalJSON(a), permissionCanonicalJSON(b));
  assert.notEqual(
    permissionCanonicalJSON([1, 2]),
    permissionCanonicalJSON([2, 1]),
  );
  assert.notEqual(permissionCanonicalJSON("é"), permissionCanonicalJSON("é"));
  assert.notEqual(
    permissionCanonicalJSON("a\n"),
    permissionCanonicalJSON("a\r\n"),
  );
  assert.equal(
    permissionCanonicalJSON({ empty: [], no: false, zero: 0 }),
    '{"empty":[],"no":false,"zero":0}',
  );
});

test("canonical output has exact UTF8 byte budget including JSON escaping", () => {
  assert.equal(
    Buffer.byteLength(
      permissionCanonicalJSON("a".repeat(PERMISSION_DATA_MAX_BYTES - 2)),
    ),
    PERMISSION_DATA_MAX_BYTES,
  );
  assert.throws(() =>
    permissionCanonicalJSON("a".repeat(PERMISSION_DATA_MAX_BYTES - 1)),
  );
  assert.throws(() =>
    permissionCanonicalJSON("\n".repeat(PERMISSION_DATA_MAX_BYTES / 2)),
  );
  assert.throws(() =>
    permissionCanonicalJSON("가".repeat(PERMISSION_DATA_MAX_BYTES / 3)),
  );
});

test("closed data rejects dangerous values without invoking accessors or hooks", () => {
  let effects = 0;
  const getter = Object.defineProperty({}, "action", {
    enumerable: true,
    get() {
      effects++;
      return "read";
    },
  });
  const proxy = new Proxy(
    {},
    {
      ownKeys() {
        effects++;
        return [];
      },
    },
  );
  const revoked = Proxy.revocable({}, {});
  revoked.revoke();
  const arrayGetter = [1];
  Object.defineProperty(arrayGetter, "0", {
    enumerable: true,
    get() {
      effects++;
      return 1;
    },
  });
  const hidden = Object.defineProperty({}, "action", { value: "read" });
  const tagged = {
    toJSON() {
      effects++;
      return {};
    },
  };
  const extraArray = [1];
  extraArray.extra = true;
  const values = [
    getter,
    { nested: getter },
    proxy,
    revoked.proxy,
    arrayGetter,
    hidden,
    tagged,
    Object.create({ action: "read" }),
    Object.create(null),
    new Date(),
    new Uint8Array([1]),
    { [Symbol("action")]: 1 },
    extraArray,
    new Array(1),
    undefined,
    NaN,
    Infinity,
    -Infinity,
    -1,
    -0,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
    1n,
    Symbol(),
    () => {},
    "\ud800",
    "\udc00",
    "a\0b",
    { "a\0b": true },
    { "\ud800": true },
  ];
  for (const value of values)
    assert.throws(() => permissionCanonicalJSON(value));
  assert.equal(effects, 0);
});

test("cycles and excess depth fail; a shared inert row is ordinary repeated data", () => {
  const loop = {};
  loop.self = loop;
  assert.throws(() => permissionCanonicalJSON(loop));
  const row = { effect: "deny" };
  assert.equal(
    permissionCanonicalJSON([row, row]),
    '[{"effect":"deny"},{"effect":"deny"}]',
  );
  let value = 0;
  for (let i = 0; i < 32; i++) value = [value];
  assert.doesNotThrow(() => permissionCanonicalJSON(value));
  assert.throws(() => permissionCanonicalJSON([value]));
});

test("domain separation hashes exact ASCII prefix and never admission tuples", () => {
  const value = { z: "\ufefftext\r\n", a: 1 };
  const canonical = '{"a":1,"z":"﻿text\\r\\n"}';
  for (const domain of ["grant", "saved", "policy", "scope", "preview"]) {
    const expected = createHash("sha256")
      .update(`omoc.permission.${domain}.v1\n${canonical}`, "utf8")
      .digest("hex");
    assert.equal(permissionDomainDigest(domain, value), expected);
  }
  const hashes = ["grant", "saved", "policy", "scope", "preview"].map(
    (domain) => permissionDomainDigest(domain, value),
  );
  assert.equal(new Set(hashes).size, hashes.length);
  const admitted = createHash("sha256")
    .update(
      JSON.stringify(
        Object.keys(value)
          .sort()
          .map((key) => [key, value[key]]),
      ),
    )
    .digest("hex");
  assert.ok(hashes.every((hash) => hash !== admitted));
  for (const domain of ["", "admission", "preview.v1\n", null, {}, undefined])
    assert.throws(() => permissionDomainDigest(domain, value));
});
