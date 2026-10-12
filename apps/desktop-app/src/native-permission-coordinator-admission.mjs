// Private coordinator scope checks. This does not enable execution or mint a
// lease: positive original-operation/task authority is a later prerequisite.
import { isAbsolute, normalize } from "node:path";
import { types } from "node:util";
import { Effect } from "effect";
import { record, text } from "./native-permission-control-input.mjs";

const failure = () => new Error("native_permission_scope_unverified");
function field(value, key, optional = false) {
  if (!value || typeof value !== "object" || types.isProxy(value))
    throw failure();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor && optional) return undefined;
  if (!descriptor?.enumerable || !Object.hasOwn(descriptor, "value"))
    throw failure();
  return descriptor.value;
}
function identity(value, sessionID) {
  const id = text(field(value, "id"));
  const projectID = text(field(value, "projectID"));
  const location = field(value, "location");
  const directory = text(field(location, "directory"));
  const workspaceID = field(location, "workspaceID", true);
  if (workspaceID !== undefined) text(workspaceID);
  if (
    id !== sessionID ||
    !isAbsolute(directory) ||
    normalize(directory) !== directory
  )
    throw failure();
  return Object.freeze({
    id,
    projectID,
    directory,
    ...(workspaceID !== undefined && { workspaceID }),
  });
}
const observed = (value, sessionID) =>
  Effect.try({
    try: () => identity(value, sessionID),
    catch: () => failure(),
  });

// Capture only an own data property. A caller getter or Proxy must not run
// before the execution guard, including raw Tool runtime callers.
export function toolSessionID(context) {
  return text(field(context, "sessionID"));
}

export function createCoordinatorAdmission(input) {
  const { control, store } = record(input, ["control", "store"]);
  const get = field(store, "get");
  const transaction = field(control, "transaction");
  const assertExecution = field(control, "assertExecution");
  if (
    [get, transaction, assertExecution].some((fn) => typeof fn !== "function")
  )
    throw failure();
  // `bootstrap` is the actual fork input. It swaps the always-held execution
  // assertion for a private one-shot handoff consume under the same parent
  // transaction; it never admits execution.
  return (sessionID, body, bootstrap) =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: () => {
          text(sessionID);
          if (typeof body !== "function") throw failure();
        },
        catch: () => failure(),
      });
      // Resolve only the actual Native store identity, never a pathname or nonce.
      const before = yield* observed(yield* get(sessionID), sessionID);
      return yield* transaction([before.projectID], (tx) =>
        Effect.gen(function* () {
          const current = yield* observed(yield* get(sessionID), sessionID);
          if (
            Object.keys(before).length !== Object.keys(current).length ||
            Object.keys(before).some((key) => before[key] !== current[key])
          )
            return yield* Effect.fail(failure());
          if (bootstrap === undefined)
            yield* assertExecution(tx, before.projectID);
          else {
            const enterBootstrap = field(control, "enterBootstrap");
            if (typeof enterBootstrap !== "function")
              return yield* Effect.fail(failure());
            yield* enterBootstrap(tx, current, bootstrap);
          }
          return yield* body(tx, current);
        }),
      );
    });
}
