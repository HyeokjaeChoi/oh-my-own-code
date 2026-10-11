// Private fixed-source projection. These hashes confer no execution authority.
import { createHash } from "node:crypto";
import { types } from "node:util";
import { FIXED_TOOL_DECLARATIONS } from "./native-permission-inventory.mjs";

const fail = () => {
  throw Error("native_permission_declaration_unverified");
};
const own = (object, key) => {
  const field = Object.getOwnPropertyDescriptor(object, key);
  if (!field?.enumerable || !Object.hasOwn(field, "value")) fail();
  return field.value;
};
const plain = (value) => {
  if (
    !value ||
    typeof value !== "object" ||
    types.isProxy(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  )
    fail();
};
const callable = (value) => {
  if (
    typeof value !== "function" ||
    types.isProxy(value) ||
    types.isAsyncFunction(value) ||
    types.isGeneratorFunction(value)
  )
    fail();
};

// JSON Schema permits negative and fractional numbers. Do not use the permission
// request encoder, whose intentionally narrower number grammar is unchanged.
function canonical(value) {
  const chunks = [],
    active = new WeakSet();
  let bytes = 0;
  const append = (text) => {
    bytes += Buffer.byteLength(text, "utf8");
    if (bytes > 1024 * 1024) fail();
    chunks.push(text);
  };
  const string = (text) => {
    if (
      !text.isWellFormed() ||
      text.includes("\0") ||
      Buffer.byteLength(text, "utf8") > 1024 * 1024
    )
      fail();
    return JSON.stringify(text);
  };
  const visit = (current, depth) => {
    if (depth > 32) fail();
    if (current === null || typeof current === "boolean")
      return append(JSON.stringify(current));
    if (typeof current === "string") return append(string(current));
    if (typeof current === "number") {
      if (!Number.isFinite(current)) fail();
      return append(JSON.stringify(current));
    }
    if (
      !current ||
      typeof current !== "object" ||
      types.isProxy(current) ||
      active.has(current)
    )
      fail();
    const array = Array.isArray(current);
    if (
      Object.getPrototypeOf(current) !==
      (array ? Array.prototype : Object.prototype)
    )
      fail();
    const keys = Reflect.ownKeys(current);
    if (keys.length > 16384 || keys.some((key) => typeof key !== "string"))
      fail();
    active.add(current);
    if (array) {
      const length = Object.getOwnPropertyDescriptor(current, "length").value;
      if (keys.length !== length + 1) fail();
      append("[");
      for (let index = 0; index < length; index++) {
        if (index) append(",");
        visit(own(current, String(index)), depth + 1);
      }
      append("]");
    } else {
      append("{");
      keys.sort((left, right) =>
        Buffer.compare(Buffer.from(left), Buffer.from(right)),
      );
      keys.forEach((key, index) => {
        if (index) append(",");
        append(string(key));
        append(":");
        visit(own(current, key), depth + 1);
      });
      append("}");
    }
    active.delete(current);
  };
  visit(value, 0);
  return chunks.join("");
}
const digest = (domain, value) =>
  createHash("sha256")
    .update(`omoc.permission.tool.${domain}.v1\n`)
    .update(canonical(value))
    .digest("hex");

export function createBuiltinDeclarationProjector(input) {
  plain(input);
  if (Reflect.ownKeys(input).length !== 4) fail();
  const pluginId = own(input, "pluginId"),
    sourceSha256 = own(input, "sourceSha256");
  const accepts = own(input, "accepts"),
    definition = own(input, "definition");
  if (
    !Object.hasOwn(FIXED_TOOL_DECLARATIONS, pluginId) ||
    typeof sourceSha256 !== "string" ||
    !/^[a-f0-9]{64}$/u.test(sourceSha256)
  )
    fail();
  callable(accepts);
  callable(definition);
  const expected = FIXED_TOOL_DECLARATIONS[pluginId];
  const bundle =
    pluginId === "opencode.tools" ||
    pluginId === "opencode.tools.mcp-resources";
  return (result) => {
    // The predicate is supplied only by the verified graph's fixed source module.
    // In particular, no schema getter or converter runs on caller lookalikes.
    if (accepts(result) !== true) fail();
    plain(result);
    if (!Object.isFrozen(result)) fail();
    const namespace = bundle ? own(result, "namespace") : null;
    const declarations = bundle ? own(result, "declarations") : [result];
    if (
      !Array.isArray(declarations) ||
      types.isProxy(declarations) ||
      declarations.length !== expected.length ||
      (bundle &&
        (!Object.isFrozen(declarations) ||
          Reflect.ownKeys(result).length !== 2))
    )
      fail();
    if (namespace !== null) {
      plain(namespace);
      if (!Object.isFrozen(namespace)) fail();
    }
    return Object.freeze(
      expected.map((row, index) => {
        const tool = own(declarations, String(index));
        plain(tool);
        if (!Object.isFrozen(tool)) fail();
        // Check data descriptors before the original, fixed converter can read them.
        for (const key of Reflect.ownKeys(tool)) {
          if (typeof key !== "string") fail();
          own(tool, key);
        }
        callable(own(tool, "execute"));
        const options = Object.hasOwn(tool, "options")
          ? own(tool, "options")
          : null;
        if (options !== null) {
          plain(options);
          if (!Object.isFrozen(options)) fail();
        }
        const observed = definition(tool);
        plain(observed);
        const fields = Reflect.ownKeys(observed);
        if (
          fields.length < 4 ||
          fields.length > 5 ||
          fields.some(
            (key) =>
              ![
                "type",
                "name",
                "description",
                "inputSchema",
                "outputSchema",
              ].includes(key),
          ) ||
          own(observed, "type") !== "tool" ||
          own(observed, "name") !== row.toolId
        )
          fail();
        own(observed, "description");
        own(observed, "inputSchema");
        return Object.freeze({
          toolId: row.toolId,
          sourceSha256,
          schemaDigest: digest("schema", observed),
          optionsDigest: digest("options", { options, namespace }),
        });
      }),
    );
  };
}
