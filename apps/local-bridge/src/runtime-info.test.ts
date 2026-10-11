import assert from "node:assert/strict";
import test from "node:test";
import {
  observeRuntimeInfo,
  projectRuntimeDiagnostic,
  validateRuntimeInfo,
} from "./runtime-info.js";

function runtimeInfo(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: "1.2.3",
    pid: 42,
    urls: ["http://127.0.0.1:5318"],
    paths: { tmp: "/tmp/runtime" },
    ...overrides,
  };
}

test("validates required metadata and returns a fresh version-only copy", () => {
  const input = runtimeInfo({
    version: "v2.0.18+local",
    pid: Number.MAX_SAFE_INTEGER,
    urls: [],
    paths: { tmp: "/private/canary/path", other: "ignored" },
    extra: "SECRET_EXTRA_CANARY",
  });

  const result = validateRuntimeInfo(input);

  assert.deepEqual(result, { version: "v2.0.18+local" });
  assert.notStrictEqual(result, input);
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.deepEqual(Object.keys(result ?? {}), ["version"]);
  assert.equal(JSON.stringify(result).includes("SECRET_EXTRA_CANARY"), false);
  assert.equal(JSON.stringify(result).includes("/private/canary/path"), false);
  assert.equal(
    JSON.stringify(result).includes(String(Number.MAX_SAFE_INTEGER)),
    false,
  );
});

test("rejects null, arrays, and non-object top-level values", () => {
  for (const input of [null, [], "response", 1, true, undefined]) {
    assert.equal(validateRuntimeInfo(input), null);
  }
});

test("requires every public field as an own property", () => {
  for (const field of ["version", "pid", "urls", "paths"]) {
    const input = runtimeInfo();
    delete input[field];
    assert.equal(validateRuntimeInfo(input), null, `missing ${field}`);
  }

  const inherited = Object.assign(Object.create({ version: "1.2.3" }), {
    pid: 42,
    urls: [],
    paths: { tmp: "/tmp" },
  });
  assert.equal(validateRuntimeInfo(inherited), null);
});

test("rejects wrong primitive and nested field shapes", () => {
  const invalidCases: Array<Record<string, unknown>> = [
    runtimeInfo({ version: 1 }),
    runtimeInfo({ pid: "42" }),
    runtimeInfo({ urls: "http://127.0.0.1" }),
    runtimeInfo({ urls: ["http://127.0.0.1", 42] }),
    runtimeInfo({ urls: [null] }),
    runtimeInfo({ paths: null }),
    runtimeInfo({ paths: [] }),
    runtimeInfo({ paths: { tmp: 42 } }),
    runtimeInfo({ paths: {} }),
  ];

  for (const input of invalidCases) {
    assert.equal(validateRuntimeInfo(input), null);
  }
});

test("rejects accessors without invoking them", () => {
  let topLevelReads = 0;
  const topLevel = runtimeInfo();
  Object.defineProperty(topLevel, "version", {
    get() {
      topLevelReads += 1;
      throw new Error("ACCESSOR_CANARY");
    },
  });
  assert.equal(validateRuntimeInfo(topLevel), null);
  assert.equal(topLevelReads, 0);

  let nestedReads = 0;
  const paths = {};
  Object.defineProperty(paths, "tmp", {
    get() {
      nestedReads += 1;
      throw new Error("NESTED_ACCESSOR_CANARY");
    },
  });
  assert.equal(validateRuntimeInfo(runtimeInfo({ paths })), null);
  assert.equal(nestedReads, 0);
});

test("turns throwing proxy inspection into invalid schema", () => {
  const topLevel = new Proxy(runtimeInfo(), {
    getOwnPropertyDescriptor() {
      throw new Error("PROXY_DESCRIPTOR_CANARY");
    },
  });
  assert.equal(validateRuntimeInfo(topLevel), null);

  const nested = new Proxy(
    { tmp: "/tmp" },
    {
      getOwnPropertyDescriptor() {
        throw new Error("NESTED_PROXY_CANARY");
      },
    },
  );
  assert.equal(validateRuntimeInfo(runtimeInfo({ paths: nested })), null);
});

test("accepts only finite positive safe integer process identifiers", () => {
  for (const pid of [
    0,
    -1,
    1.5,
    NaN,
    Infinity,
    -Infinity,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    assert.equal(
      validateRuntimeInfo(runtimeInfo({ pid })),
      null,
      `pid ${String(pid)}`,
    );
  }

  assert.deepEqual(
    validateRuntimeInfo(runtimeInfo({ pid: Number.MAX_SAFE_INTEGER })),
    { version: "1.2.3" },
  );
});

test("enforces version grammar and UTF-8 byte limits", () => {
  for (const version of [
    "",
    " ",
    " leading",
    "v1/secret",
    "1.0\n",
    "é",
    "1".repeat(129),
  ]) {
    assert.equal(
      validateRuntimeInfo(runtimeInfo({ version })),
      null,
      `version ${JSON.stringify(version)}`,
    );
  }

  assert.deepEqual(
    validateRuntimeInfo(runtimeInfo({ version: "A".repeat(128) })),
    {
      version: "A".repeat(128),
    },
  );
});

test("enforces URL count, string, and UTF-8 byte limits", () => {
  assert.deepEqual(validateRuntimeInfo(runtimeInfo({ urls: [] })), {
    version: "1.2.3",
  });
  assert.deepEqual(
    validateRuntimeInfo(
      runtimeInfo({ urls: Array.from({ length: 16 }, () => "x") }),
    ),
    { version: "1.2.3" },
  );

  for (const urls of [
    Array.from({ length: 17 }, () => "x"),
    [""],
    ["x".repeat(2049)],
    ["界".repeat(683)],
  ]) {
    assert.equal(validateRuntimeInfo(runtimeInfo({ urls })), null);
  }

  assert.deepEqual(
    validateRuntimeInfo(
      runtimeInfo({ urls: ["x".repeat(2048), "界".repeat(682)] }),
    ),
    { version: "1.2.3" },
  );
});

test("enforces temporary path UTF-8 byte limits", () => {
  assert.equal(validateRuntimeInfo(runtimeInfo({ paths: { tmp: "" } })), null);
  assert.equal(
    validateRuntimeInfo(runtimeInfo({ paths: { tmp: "x".repeat(4097) } })),
    null,
  );
  assert.equal(
    validateRuntimeInfo(runtimeInfo({ paths: { tmp: "界".repeat(1366) } })),
    null,
  );

  assert.deepEqual(
    validateRuntimeInfo(runtimeInfo({ paths: { tmp: "x".repeat(4096) } })),
    { version: "1.2.3" },
  );
  assert.deepEqual(
    validateRuntimeInfo(runtimeInfo({ paths: { tmp: "界".repeat(1365) } })),
    { version: "1.2.3" },
  );
});

test("ignores extra fields without reading their accessors", () => {
  let extraReads = 0;
  const input = runtimeInfo();
  Object.defineProperty(input, "secret", {
    enumerable: true,
    get() {
      extraReads += 1;
      return "SECRET_EXTRA_CANARY";
    },
  });

  assert.deepEqual(validateRuntimeInfo(input), { version: "1.2.3" });
  assert.equal(extraReads, 0);
});

test("observes one injected read and validates its resolved value", async () => {
  let reads = 0;
  const observation = await observeRuntimeInfo(async () => {
    reads += 1;
    return runtimeInfo({ extra: "SECRET_RESPONSE_CANARY" });
  });

  assert.equal(reads, 1);
  assert.deepEqual(observation, {
    kind: "info_validated",
    info: { version: "1.2.3" },
  });
});

test("maps resolved invalid data to the fixed invalid-schema outcome", async () => {
  let reads = 0;
  const observation = await observeRuntimeInfo(async () => {
    reads += 1;
    return runtimeInfo({ version: "INVALID/SECRET_CANARY" });
  });

  assert.equal(reads, 1);
  assert.deepEqual(observation, {
    kind: "invalid_response",
    code: "INVALID_SCHEMA",
  });
});

test("maps rejected reads to a fixed outcome without exposing the error", async () => {
  let reads = 0;
  const rejection = new Error(
    "https://secret.example/PATH_CANARY HTML_CANARY PROMPT_CANARY",
  );
  rejection.stack = "STACK_CANARY";
  const observation = await observeRuntimeInfo(async () => {
    reads += 1;
    throw rejection;
  });

  assert.equal(reads, 1);
  assert.deepEqual(observation, {
    kind: "read_failed",
    code: "RUNTIME_UNAVAILABLE",
  });
  const serialized = JSON.stringify(observation);
  for (const canary of [
    "secret.example",
    "PATH_CANARY",
    "HTML_CANARY",
    "PROMPT_CANARY",
    "STACK_CANARY",
  ]) {
    assert.equal(serialized.includes(canary), false);
  }
});

test("projects diagnostics with only fixed outcome fields and synthetic provenance", async () => {
  const valid = await observeRuntimeInfo(async () =>
    runtimeInfo({
      version: "Safe+Version",
      pid: 987654321,
      urls: ["https://URL_CANARY.example"],
      paths: { tmp: "/PATH_CANARY" },
      secret: "SECRET_CANARY",
    }),
  );
  const invalid = await observeRuntimeInfo(async () =>
    runtimeInfo({
      version: "INVALID/RESPONSE_CANARY",
      secret: "SECRET_CANARY",
    }),
  );
  const failed = await observeRuntimeInfo(async () => {
    throw new Error("ERROR_CANARY STACK_CANARY");
  });

  const diagnostics = [valid, invalid, failed].map((result) =>
    projectRuntimeDiagnostic(result, "synthetic-injected-client"),
  );
  assert.deepEqual(diagnostics, [
    { kind: "info_validated", provenance: "synthetic-injected-client" },
    {
      kind: "invalid_response",
      code: "INVALID_SCHEMA",
      provenance: "synthetic-injected-client",
    },
    {
      kind: "read_failed",
      code: "RUNTIME_UNAVAILABLE",
      provenance: "synthetic-injected-client",
    },
  ]);

  const serialized = JSON.stringify(diagnostics);
  for (const canary of [
    "Safe+Version",
    "URL_CANARY",
    "PATH_CANARY",
    "SECRET_CANARY",
    "RESPONSE_CANARY",
    "ERROR_CANARY",
    "STACK_CANARY",
    "987654321",
  ]) {
    assert.equal(serialized.includes(canary), false);
  }
  for (const diagnostic of diagnostics) {
    assert.deepEqual(
      Object.keys(diagnostic).sort(),
      ("code" in diagnostic
        ? ["code", "kind", "provenance"]
        : ["kind", "provenance"]
      ).sort(),
    );
  }
});
