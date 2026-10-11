import assert from "node:assert/strict";
import test from "node:test";
import {
  validatePermissionControlObservation,
  validatePermissionSavedObservation,
} from "./permission-control-observations.mjs";

const DIGEST = "a".repeat(64);
const HANDLE = "0123456789abcdef0123456789abcdef";
const HANDLE_B = "fedcba9876543210fedcba9876543210";
const MAX_BYTES = 1024 * 1024;
const clone = (value) => globalThis.structuredClone(value);
const clockScope = () => ({
  runtimeEpoch: "epoch-1",
  revision: 0,
  observationSequence: 1,
  workspaceId: "workspace-1",
  sessionId: "session-1",
});
const generations = () => ({
  control: 1,
  inventory: 1,
  pending: 1,
  saved: 1,
  locations: 1,
});
const session = (overrides = {}) => ({
  workspaceId: "workspace-1",
  sessionId: "session-1",
  locationId: HANDLE,
  mode: "ask",
  modeGeneration: 1,
  policyDigest: DIGEST,
  state: "idle",
  ...overrides,
});
const capability = (overrides = {}) => ({
  capabilityId: "file.read",
  label: "Read files",
  category: "file_read",
  support: "verified",
  effect: "ask",
  source: "builtin",
  ...overrides,
});
function control() {
  return {
    ...clockScope(),
    status: "available",
    complete: true,
    observationId: HANDLE,
    scopeDigest: DIGEST,
    generations: generations(),
    policy: {
      mode: "ask",
      modeGeneration: 1,
      settings: [],
      floorDigest: DIGEST,
      compilerVersion: 1,
      policyDigest: DIGEST,
      rules: [{ action: "read", resource: "src/**", effect: "ask" }],
    },
    capabilities: [capability()],
    locations: [
      {
        locationId: HANDLE,
        workspaceId: "workspace-1",
        incarnation: 1,
        state: "ready",
      },
    ],
    sessions: [session()],
    pending: [
      {
        permissionId: "permission-1",
        workspaceId: "workspace-1",
        sessionId: "session-1",
        locationId: HANDLE,
        action: "read",
        resources: ["src/b", "src/a"],
        savePatterns: ["src/**", "**/*.mjs"],
        requestDigest: DIGEST,
      },
    ],
    hold: "none",
  };
}
function saved() {
  return {
    ...clockScope(),
    status: "available",
    complete: true,
    observationId: HANDLE,
    scopeDigest: DIGEST,
    generations: generations(),
    saved: [
      {
        savedId: "saved-1",
        action: "read",
        resource: "src/**",
        effect: "allow",
        ruleDigest: DIGEST,
        createdAt: 0,
        updatedAt: 1,
      },
    ],
  };
}
// Independent fixture-only ordering for valid sets of ASCII wire identities.
const setIdentity = {
  locations: (row) => [row.locationId, row.incarnation],
  sessions: (row) => [row.workspaceId, row.sessionId],
  pending: (row) => [row.locationId, row.sessionId, row.permissionId],
  capabilities: (row) => row.capabilityId,
  saved: (row) => row.savedId,
};
function sortSet(rows, identity) {
  rows.sort((a, b) =>
    Buffer.compare(
      Buffer.from(JSON.stringify(identity(a)), "utf8"),
      Buffer.from(JSON.stringify(identity(b)), "utf8"),
    ),
  );
}

const validators = [
  ["control", validatePermissionControlObservation, control],
  ["saved", validatePermissionSavedObservation, saved],
];
function invalid(validate, value) {
  assert.throws(() => validate(value), {
    name: "Error",
    message: "permission_control_invalid_data",
  });
}
function detachedFrozen(input, output) {
  if (input === null || typeof input !== "object") return;
  assert.notEqual(output, input);
  assert.ok(Object.isFrozen(output));
  for (const key of Object.keys(input)) detachedFrozen(input[key], output[key]);
}

for (const [name, validate, fixture] of validators) {
  test(`${name}: synchronous API returns exact detached deeply frozen observation`, () => {
    const input = fixture();
    const output = validate(input);
    assert.deepEqual(output, input);
    detachedFrozen(input, output);
    input.generations.control = 9;
    assert.equal(output.generations.control, 1);
    assert.throws(() => {
      output.generations.control = 2;
    }, TypeError);
  });

  test(`${name}: available union rejects missing, extra and wrong discriminator fields`, () => {
    for (const key of Object.keys(fixture())) {
      const input = fixture();
      delete input[key];
      invalid(validate, input);
    }
    for (const patch of [
      { extra: true },
      { complete: false },
      { status: "partial" },
      { reason: "runtime_unavailable" },
      { previewId: HANDLE },
    ])
      invalid(validate, { ...fixture(), ...patch });
  });
}

const reasons = [
  "inventory_unverified",
  "identity_unverified",
  "policy_unverified",
  "settlement_unverified",
  "unsupported_capability",
  "scope_unverified",
  "stale_preview",
  "expired_preview",
  "limit_exceeded",
  "runtime_unavailable",
];
function at(value, path) {
  return path.reduce((row, key) => row[key], value);
}
function put(value, path, replacement) {
  at(value, path.slice(0, -1))[path.at(-1)] = replacement;
}
function custom() {
  const input = control();
  input.policy.mode = input.sessions[0].mode = "custom";
  input.capabilities = [
    capability({ capabilityId: "z", effect: "deny" }),
    capability({ capabilityId: "a", effect: "allow" }),
  ];
  sortSet(input.capabilities, setIdentity.capabilities);
  input.policy.settings = [
    { capabilityId: "a", effect: "allow" },
    { capabilityId: "z", effect: "deny" },
  ];
  return input;
}

for (const [name, validate, fixture] of validators) {
  test(`${name}: every unavailable Reason is closed, detached and inert`, () => {
    for (const reason of reasons) {
      const input = { ...clockScope(), status: "unavailable", reason };
      const output = validate(input);
      assert.deepEqual(output, input);
      detachedFrozen(input, output);
      for (const key of Object.keys(input)) {
        const missing = clone(input);
        delete missing[key];
        invalid(validate, missing);
      }
      for (const [key, value] of Object.entries(fixture())) {
        if (!Object.hasOwn(input, key))
          invalid(validate, { ...input, [key]: value });
      }
      for (const patch of [
        { reason: "unknown" },
        { reason: null },
        { previewId: HANDLE },
        { targets: [] },
      ])
        invalid(validate, { ...input, ...patch });
    }
  });

  test(`${name}: clock/generations use safe integers with exact zero rules`, () => {
    const positive = [
      ["observationSequence"],
      ...Object.keys(generations()).map((key) => ["generations", key]),
    ];
    for (const path of [["revision"], ...positive]) {
      for (const bad of [
        -1,
        -0,
        0.5,
        NaN,
        Infinity,
        -Infinity,
        Number.MAX_SAFE_INTEGER + 1,
        "1",
        null,
        true,
      ]) {
        const input = fixture();
        put(input, path, bad);
        invalid(validate, input);
      }
      for (const good of [1, Number.MAX_SAFE_INTEGER]) {
        const input = fixture();
        put(input, path, good);
        assert.equal(at(validate(input), path), good);
      }
    }
    for (const path of positive) {
      const input = fixture();
      put(input, path, 0);
      invalid(validate, input);
    }
  });

  test(`${name}: wire identifiers and handles have existing ID syntax, not claimed entropy`, () => {
    for (const path of [
      ["runtimeEpoch"],
      ["workspaceId"],
      ["sessionId"],
      ["observationId"],
    ]) {
      for (const bad of [
        "",
        "a".repeat(129),
        "with space",
        "slash/path",
        "한글",
        "a\n",
        1,
        null,
      ]) {
        const input = fixture();
        put(input, path, bad);
        invalid(validate, input);
      }
    }
    const input = fixture();
    input.observationId = "a";
    input.runtimeEpoch = "A_.:-0";
    assert.equal(validate(input).observationId, "a");
  });

  test(`${name}: digest format is lowercase hex only, without pretending to verify its content`, () => {
    for (const bad of [
      "a".repeat(63),
      "a".repeat(65),
      "A".repeat(64),
      "g".repeat(64),
      "",
      null,
      0,
    ]) {
      invalid(validate, { ...fixture(), scopeDigest: bad });
    }
    const input = fixture();
    input.scopeDigest = "0".repeat(64);
    assert.equal(validate(input).scopeDigest, input.scopeDigest);
  });
}

const nested = [
  [validatePermissionControlObservation, control, ["generations"]],
  [validatePermissionControlObservation, control, ["policy"]],
  [validatePermissionControlObservation, custom, ["policy", "settings", 0]],
  [validatePermissionControlObservation, control, ["policy", "rules", 0]],
  [validatePermissionControlObservation, control, ["capabilities", 0]],
  [validatePermissionControlObservation, control, ["locations", 0]],
  [validatePermissionControlObservation, control, ["sessions", 0]],
  [validatePermissionControlObservation, control, ["pending", 0]],
  [validatePermissionSavedObservation, saved, ["saved", 0]],
];
for (const [validate, fixture, path] of nested) {
  test(`closed nested shape ${path.join(".")}: required fields, extras, null and wrong container`, () => {
    for (const key of Object.keys(at(fixture(), path))) {
      const input = fixture();
      delete at(input, path)[key];
      invalid(validate, input);
    }
    const extra = fixture();
    at(extra, path).extra = true;
    invalid(validate, extra);
    for (const bad of [null, [], "row", 0]) {
      const input = fixture();
      put(input, path, bad);
      invalid(validate, input);
    }
  });
}

test("control: accepted modes, holds, session/location states and inventory enums", () => {
  for (const mode of ["ask", "read_plan", "scoped_edit", "custom"]) {
    const input = control();
    input.policy.mode = input.sessions[0].mode = mode;
    assert.equal(validatePermissionControlObservation(input).policy.mode, mode);
  }
  const fields = [
    [["hold"], ["none", "transition", "recovery", "actual_call"]],
    [
      ["sessions", 0, "state"],
      ["idle", "running", "held", "unknown"],
    ],
    [
      ["locations", 0, "state"],
      ["ready", "building", "finalizing"],
    ],
    [
      ["capabilities", 0, "category"],
      [
        "file_read",
        "file_write",
        "shell",
        "network",
        "mcp",
        "delegation",
        "other",
      ],
    ],
    [
      ["capabilities", 0, "source"],
      ["builtin", "trusted_adapter"],
    ],
    [
      ["policy", "rules", 0, "effect"],
      ["deny", "ask", "allow"],
    ],
    [
      ["capabilities", 0, "effect"],
      ["deny", "ask", "allow"],
    ],
  ];
  for (const [path, accepted] of fields) {
    for (const value of accepted) {
      const input = control();
      put(input, path, value);
      assert.equal(
        at(validatePermissionControlObservation(input), path),
        value,
      );
    }
    for (const value of ["invalid", null, 1]) {
      const input = control();
      put(input, path, value);
      invalid(validatePermissionControlObservation, input);
    }
  }
  for (const path of [
    ["policy", "mode"],
    ["sessions", 0, "mode"],
    ["capabilities", 0, "support"],
    ["policy", "compilerVersion"],
  ]) {
    const input = control();
    put(input, path, "unknown");
    invalid(validatePermissionControlObservation, input);
  }
  for (const path of [
    ["locations", 0, "incarnation"],
    ["sessions", 0, "modeGeneration"],
    ["policy", "modeGeneration"],
  ]) {
    for (const value of [0, -1, -0, 1.5, "1", Number.MAX_SAFE_INTEGER + 1]) {
      const input = control();
      put(input, path, value);
      invalid(validatePermissionControlObservation, input);
    }
  }
});

const textFields = [
  [
    control,
    validatePermissionControlObservation,
    ["policy", "rules", 0, "action"],
    4096,
  ],
  [
    control,
    validatePermissionControlObservation,
    ["policy", "rules", 0, "resource"],
    4096,
  ],
  [
    control,
    validatePermissionControlObservation,
    ["pending", 0, "action"],
    4096,
  ],
  [
    control,
    validatePermissionControlObservation,
    ["pending", 0, "resources", 0],
    4096,
  ],
  [
    control,
    validatePermissionControlObservation,
    ["pending", 0, "savePatterns", 0],
    4096,
  ],
  [
    control,
    validatePermissionControlObservation,
    ["capabilities", 0, "label"],
    256,
  ],
  [saved, validatePermissionSavedObservation, ["saved", 0, "action"], 4096],
  [saved, validatePermissionSavedObservation, ["saved", 0, "resource"], 4096],
];
for (const [fixture, validate, path, limit] of textFields) {
  test(`public safe text ${path.join(".")}: lexical exclusions and UTF8 ${limit} byte boundary`, () => {
    for (const value of [
      "",
      null,
      1,
      "a\0b",
      "a\nb",
      "a\rb",
      "a\tb",
      "a\u007fb",
      "a\u0085b",
      "a\ufeffb",
      "a\u200bb",
      "a\u2028b",
      "a\u2029b",
      "\ud800",
      "\udc00",
    ]) {
      const input = fixture();
      put(input, path, value);
      invalid(validate, input);
    }
    for (const value of [
      "x".repeat(limit),
      "가".repeat(Math.floor(limit / 3)) + "x".repeat(limit % 3),
      "é é 😀 <read> /tmp/** ",
    ]) {
      const input = fixture();
      put(input, path, value);
      assert.equal(at(validate(input), path), value);
    }
    for (const value of [
      "x".repeat(limit + 1),
      "가".repeat(Math.floor(limit / 3) + 1),
    ]) {
      const input = fixture();
      put(input, path, value);
      invalid(validate, input);
    }
  });
}

test("custom settings: canonical distinct listed identities and matching effects including unsupported deny", () => {
  assert.deepEqual(validatePermissionControlObservation(custom()), custom());
  const unsupported = custom();
  unsupported.capabilities[1].support = "unsupported";
  assert.deepEqual(
    validatePermissionControlObservation(unsupported),
    unsupported,
  );
  const badCases = [
    (v) => v.policy.settings.reverse(),
    (v) => v.policy.settings.push(clone(v.policy.settings[1])),
    (v) => {
      v.policy.settings[0].capabilityId = "missing";
    },
    (v) => {
      v.policy.settings[0].effect = "ask";
    },
    (v) => {
      v.policy.settings[0].effect = "invalid";
    },
    (v) => {
      v.capabilities[0].support = "unsupported";
      v.capabilities[0].effect = "allow";
    },
    (v) => {
      v.capabilities[0].support = "unsupported";
      v.capabilities[0].effect = "ask";
    },
  ];
  for (const mutate of badCases) {
    const input = custom();
    mutate(input);
    invalid(validatePermissionControlObservation, input);
  }
  for (const mode of ["ask", "read_plan", "scoped_edit"]) {
    const input = custom();
    input.policy.mode = input.sessions[0].mode = mode;
    invalid(validatePermissionControlObservation, input);
  }
});

function twoWorkspaces() {
  const input = control();
  input.locations.push({
    locationId: HANDLE_B,
    workspaceId: "workspace-2",
    incarnation: 1,
    state: "ready",
  });
  input.sessions.push(
    session({
      workspaceId: "workspace-2",
      sessionId: "session-2",
      locationId: HANDLE_B,
      parentSessionId: "session-1",
    }),
  );
  return input;
}

test("membership: cross-workspace ancestry resolves by unique project sessionId", () => {
  const input = twoWorkspaces();
  input.pending.push({
    ...clone(input.pending[0]),
    workspaceId: "workspace-2",
    sessionId: "session-2",
    locationId: HANDLE_B,
  });
  assert.deepEqual(validatePermissionControlObservation(input), input);
  // A repeated sessionId without ancestry references is valid composite membership.
  delete input.sessions[1].parentSessionId;
  input.sessions[1].sessionId = "session-1";
  input.pending[1].sessionId = "session-1";
  assert.deepEqual(validatePermissionControlObservation(input), input);
});

test("membership: root scope, location ownership and pending session location must all match", () => {
  const mutations = [
    (v) => {
      v.workspaceId = "missing";
    },
    (v) => {
      v.sessionId = "missing";
    },
    (v) => {
      v.sessions = [];
    },
    (v) => {
      v.locations = [];
    },
    (v) => {
      v.sessions[0].locationId = "missing";
    },
    (v) => {
      v.locations[0].workspaceId = "workspace-2";
    },
    (v) => {
      v.pending[0].workspaceId = "workspace-2";
    },
    (v) => {
      v.pending[0].sessionId = "missing";
    },
    (v) => {
      v.pending[0].locationId = HANDLE_B;
    },
    (v) => {
      v.sessions[0].parentSessionId = "missing";
    },
    (v) => {
      v.sessions[0].parentSessionId = null;
    },
  ];
  for (const mutate of mutations) {
    const input = control();
    mutate(input);
    invalid(validatePermissionControlObservation, input);
  }
  const input = twoWorkspaces();
  input.pending[0].locationId = HANDLE_B;
  invalid(validatePermissionControlObservation, input);
});

test("ancestry: reject self, indirect and disconnected cycles and ambiguous parent IDs", () => {
  const self = control();
  self.sessions[0].parentSessionId = self.sessionId;
  invalid(validatePermissionControlObservation, self);
  const cycle = twoWorkspaces();
  cycle.sessions[0].parentSessionId = "session-2";
  invalid(validatePermissionControlObservation, cycle);
  const disconnected = control();
  disconnected.sessions.push(
    session({ sessionId: "a", parentSessionId: "b" }),
    session({ sessionId: "b", parentSessionId: "a" }),
  );
  sortSet(disconnected.sessions, setIdentity.sessions);
  invalid(validatePermissionControlObservation, disconnected);
  const ambiguous = twoWorkspaces();
  ambiguous.sessions.push(
    session({
      workspaceId: "workspace-2",
      sessionId: "session-1",
      locationId: HANDLE_B,
    }),
  );
  sortSet(ambiguous.sessions, setIdentity.sessions);
  invalid(validatePermissionControlObservation, ambiguous);
});

test("uniqueness: global location handles and composite session/pending IDs, distinct capability/saved IDs", () => {
  for (const field of ["locations", "sessions", "pending", "capabilities"]) {
    const input = control();
    input[field].push(clone(input[field][0]));
    invalid(validatePermissionControlObservation, input);
  }
  const locations = twoWorkspaces();
  locations.locations[1].locationId = HANDLE;
  locations.locations[1].incarnation = 2;
  locations.sessions[1].locationId = HANDLE;
  invalid(validatePermissionControlObservation, locations);
  const input = saved();
  input.saved.push(clone(input.saved[0]));
  invalid(validatePermissionSavedObservation, input);
  input.saved[1].savedId = "saved-2";
  assert.deepEqual(validatePermissionSavedObservation(input), input);
});

test("root policy projection agrees with root session mode, generation and policy digest", () => {
  for (const [field, value] of [
    ["mode", "custom"],
    ["modeGeneration", 2],
    ["policyDigest", "b".repeat(64)],
  ]) {
    const input = control();
    input.sessions[0][field] = value;
    invalid(validatePermissionControlObservation, input);
  }
});

for (const [field, limit] of [
  ["locations", 32],
  ["sessions", 1024],
  ["pending", 1024],
  ["capabilities", 256],
  ["saved", 1024],
]) {
  test(`count boundary ${field}: ${limit} accepted, ${limit + 1} rejected`, () => {
    const input = field === "saved" ? saved() : control();
    const validate =
      field === "saved"
        ? validatePermissionSavedObservation
        : validatePermissionControlObservation;
    for (let i = 1; i <= limit; i++) {
      const row = clone(input[field][0]);
      if (field === "locations") row.locationId = `location-${i}`;
      if (field === "sessions") row.sessionId = `session-${i + 1}`;
      if (field === "pending") row.permissionId = `permission-${i + 1}`;
      if (field === "capabilities") row.capabilityId = `capability-${i}`;
      if (field === "saved") row.savedId = `saved-${i + 1}`;
      input[field].push(row);
    }
    const overflow = input[field].pop();
    sortSet(input[field], setIdentity[field]);
    assert.equal(validate(input)[field].length, limit);
    input[field].push(overflow);
    invalid(validate, input);
  });
}

test("maximal acyclic ancestry counts every descendant without requiring parent-before-child order", () => {
  const input = control();
  for (let i = 2; i <= 1024; i++)
    input.sessions.push(
      session({
        sessionId: `session-${i}`,
        parentSessionId: `session-${i - 1}`,
      }),
    );
  sortSet(input.sessions, setIdentity.sessions);
  assert.deepEqual(
    validatePermissionControlObservation(input).sessions,
    input.sessions,
  );
  input.sessions.find(
    (row) => row.sessionId === input.sessionId,
  ).parentSessionId = "session-1024";
  invalid(validatePermissionControlObservation, input);
});

test("ordered rules/resources/savePatterns retain repetitions and exceed legacy array caps", () => {
  const input = control();
  input.policy.rules = Array.from({ length: 258 }, (_, i) => ({
    action: "read",
    resource: i % 2 ? "z/**" : "a/**",
    effect: i % 2 ? "allow" : "deny",
  }));
  input.pending[0].resources = Array.from({ length: 2050 }, (_, i) =>
    i % 2 ? "z" : "a",
  );
  input.pending[0].savePatterns = [...input.pending[0].resources].reverse();
  assert.deepEqual(validatePermissionControlObservation(input), input);
  const reordered = clone(input);
  reordered.policy.rules.reverse();
  reordered.pending[0].resources.reverse();
  reordered.pending[0].savePatterns.reverse();
  const output = validatePermissionControlObservation(reordered);
  assert.deepEqual(output, reordered);
  assert.notDeepEqual(output, input);
});

test("empty inventories are accepted when root membership remains, saved empty needs no invented session list", () => {
  const input = control();
  input.capabilities = [];
  input.pending = [];
  input.policy.rules = [];
  assert.deepEqual(validatePermissionControlObservation(input), input);
  input.pending = control().pending;
  input.pending[0].resources = [];
  input.pending[0].savePatterns = [];
  assert.deepEqual(validatePermissionControlObservation(input), input);
  const empty = saved();
  empty.saved = [];
  assert.deepEqual(validatePermissionSavedObservation(empty), empty);
});

test("Saved: allow only and timestamps are independent UInt without invented expiry or clock ordering", () => {
  for (const effect of ["ask", "deny", "invalid", null]) {
    const input = saved();
    input.saved[0].effect = effect;
    invalid(validatePermissionSavedObservation, input);
  }
  for (const field of ["createdAt", "updatedAt"]) {
    for (const bad of [
      -1,
      -0,
      1.5,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
      "1",
      null,
    ]) {
      const input = saved();
      input.saved[0][field] = bad;
      invalid(validatePermissionSavedObservation, input);
    }
  }
  const input = saved();
  input.saved[0].createdAt = Number.MAX_SAFE_INTEGER;
  input.saved[0].updatedAt = 0;
  assert.deepEqual(validatePermissionSavedObservation(input), input);
});

for (const [name, validate, fixture] of validators) {
  test(`${name}: rejects hooks/descriptors/Proxy before invoking user code at root and nested paths`, () => {
    let effects = 0;
    const hook = () => {
      effects++;
      throw new Error("unexpected_hook_execution");
    };
    const proxy = new Proxy(
      {},
      {
        get: hook,
        ownKeys: hook,
        getPrototypeOf: hook,
        getOwnPropertyDescriptor: hook,
      },
    );
    const revoked = Proxy.revocable({}, {});
    revoked.revoke();
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get: hook,
    });
    const setter = Object.defineProperty({}, "value", {
      enumerable: true,
      set: hook,
    });
    const getterArray = ["a"];
    Object.defineProperty(getterArray, "0", { enumerable: true, get: hook });
    const extraArray = ["a"];
    extraArray.extra = true;
    const badValues = [
      proxy,
      revoked.proxy,
      getter,
      setter,
      getterArray,
      extraArray,
      new Array(1),
      Object.create(null),
      Object.create({ inherited: 1 }),
      new Date(),
      new Uint8Array([1]),
      { [Symbol("hidden")]: 1 },
      Object.defineProperty({}, "hidden", { value: 1 }),
      { toJSON: hook },
      undefined,
      () => {},
      Symbol("bad"),
      1n,
    ];
    for (const bad of badValues) {
      invalid(validate, bad);
      const input = fixture();
      input.generations = bad;
      invalid(validate, input);
    }
    for (const key of ["status", "observationId"]) {
      const input = fixture();
      Object.defineProperty(input, key, { enumerable: true, get: hook });
      invalid(validate, input);
    }
    const hiddenRequired = fixture();
    Object.defineProperty(hiddenRequired, "status", { enumerable: false });
    invalid(validate, hiddenRequired);
    const deep = fixture();
    if (name === "control")
      deep.pending[0].resources = new Proxy(["safe"], {
        get: hook,
        ownKeys: hook,
      });
    else deep.saved[0] = new Proxy(deep.saved[0], { get: hook, ownKeys: hook });
    invalid(validate, deep);
    assert.equal(effects, 0);
  });

  test(`${name}: cycles and excessive nesting reject with the exact synchronous error`, () => {
    const input = fixture();
    input.extra = input;
    invalid(validate, input);
    let nestedValue = "text";
    for (let i = 0; i < 40; i++) nestedValue = [nestedValue];
    input.extra = nestedValue;
    invalid(validate, input);
  });
}

test("canonical whole-observation boundary includes escaping and accepts exactly 1MiB", () => {
  const input = control();
  const resources = input.pending[0].resources;
  resources.length = 0;
  resources.push("x".repeat(4096));
  while (MAX_BYTES - Buffer.byteLength(JSON.stringify(input), "utf8") > 4099)
    resources.push("x".repeat(4096));
  const remaining =
    MAX_BYTES - Buffer.byteLength(JSON.stringify(input), "utf8");
  resources.push("x".repeat(remaining - 3));
  assert.equal(Buffer.byteLength(JSON.stringify(input), "utf8"), MAX_BYTES);
  assert.deepEqual(validatePermissionControlObservation(input), input);
  assert.ok(resources.at(-1).length < 4096);
  resources[resources.length - 1] += "x";
  assert.equal(Buffer.byteLength(JSON.stringify(input), "utf8"), MAX_BYTES + 1);
  invalid(validatePermissionControlObservation, input);
  const escaped = control();
  escaped.pending[0].resources = Array(200).fill('"'.repeat(4096));
  assert.ok(Buffer.byteLength(JSON.stringify(escaped), "utf8") > MAX_BYTES);
  invalid(validatePermissionControlObservation, escaped);
});

test("nested IDs and digests reject malformed data in every structural row", () => {
  const fields = [
    [
      control,
      validatePermissionControlObservation,
      ["policy", "floorDigest"],
      "digest",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["policy", "policyDigest"],
      "digest",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["sessions", 0, "policyDigest"],
      "digest",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "requestDigest"],
      "digest",
    ],
    [
      saved,
      validatePermissionSavedObservation,
      ["saved", 0, "ruleDigest"],
      "digest",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["capabilities", 0, "capabilityId"],
      "id",
    ],
    [
      custom,
      validatePermissionControlObservation,
      ["policy", "settings", 0, "capabilityId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["locations", 0, "locationId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["locations", 0, "workspaceId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["sessions", 0, "workspaceId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["sessions", 0, "sessionId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["sessions", 0, "locationId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "workspaceId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "sessionId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "locationId"],
      "id",
    ],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "permissionId"],
      "id",
    ],
    [saved, validatePermissionSavedObservation, ["saved", 0, "savedId"], "id"],
  ];
  for (const [fixture, validate, path, kind] of fields) {
    for (const bad of kind === "digest"
      ? ["A".repeat(64), "a".repeat(63), "g".repeat(64), null]
      : ["", "a".repeat(129), "x/y", null]) {
      const input = fixture();
      put(input, path, bad);
      invalid(validate, input);
    }
  }
});

test("every list rejects wrong containers, sparse elements, extra keys and null rows", () => {
  const fields = [
    ...["capabilities", "locations", "sessions", "pending"].map((key) => [
      control,
      validatePermissionControlObservation,
      [key],
    ]),
    [control, validatePermissionControlObservation, ["policy", "rules"]],
    [custom, validatePermissionControlObservation, ["policy", "settings"]],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "resources"],
    ],
    [
      control,
      validatePermissionControlObservation,
      ["pending", 0, "savePatterns"],
    ],
    [saved, validatePermissionSavedObservation, ["saved"]],
  ];
  for (const [fixture, validate, path] of fields) {
    for (const bad of [
      null,
      {},
      "list",
      0,
      new Array(1),
      [null],
      [undefined],
    ]) {
      const input = fixture();
      put(input, path, bad);
      invalid(validate, input);
    }
    const input = fixture();
    at(input, path).extra = true;
    invalid(validate, input);
  }
});

test("Saved whole-response budget rejects oversized valid rows below count limits", () => {
  const input = saved();
  input.saved = Array.from({ length: 300 }, (_, i) => ({
    ...input.saved[0],
    savedId: `saved-${i}`,
    resource: "x".repeat(4096),
  }));
  assert.ok(input.saved.length < 1024);
  assert.ok(Buffer.byteLength(JSON.stringify(input), "utf8") > MAX_BYTES);
  invalid(validatePermissionSavedObservation, input);
});

// CODE-R2-01: set identities have canonical byte ordering; ordered Native lists do not.
test("canonical set order: rejects every noncanonical set without normalizing input", () => {
  const cases = [
    [
      "locations",
      control,
      validatePermissionControlObservation,
      (row) => ({ ...row, locationId: "z-location" }),
    ],
    [
      "sessions",
      control,
      validatePermissionControlObservation,
      (row) => ({ ...row, sessionId: "z-session" }),
    ],
    [
      "pending",
      control,
      validatePermissionControlObservation,
      (row) => ({ ...row, permissionId: "z-permission" }),
    ],
    [
      "capabilities",
      control,
      validatePermissionControlObservation,
      (row) => ({ ...row, capabilityId: "z-capability" }),
    ],
    [
      "saved",
      saved,
      validatePermissionSavedObservation,
      (row) => ({ ...row, savedId: "z-saved" }),
    ],
  ];
  for (const [field, fixture, validate, another] of cases) {
    const input = fixture();
    input[field].push(another(input[field][0]));
    validate(input);
    input[field].reverse();
    const before = clone(input);
    invalid(validate, input);
    assert.deepEqual(input, before);
  }
});
