// Pure Effect boundary for the fixed already-claimed original Read resource.
// Construction does not install a Native service or issue a Task/lease/grant.
import { Effect } from "effect";
import { types } from "node:util";
import { array, record } from "./native-permission-control-input.mjs";
import { Failed, NotFound, WrongKind } from "@opencode/core/environment/files";
import { createNativeReadAuxiliary } from "./host/native-read-auxiliary.mjs";
import { assertNativeDescriptorReadCurrent } from "./host/native-descriptor-read-resource.mjs";
import {
  nativeDescriptorFailureKind,
  nativeDescriptorPathKind,
} from "./host/native-descriptor-read.mjs";

export function createNativeReadEffects(resource, root) {
  const original = createNativeReadAuxiliary(resource, root);
  const current = () => assertNativeDescriptorReadCurrent(resource);
  const failure = (path, cause) => {
    const kind = nativeDescriptorPathKind(cause);
    if (kind) return new WrongKind({ path, actual: kind });
    if (nativeDescriptorFailureKind(cause) === "missing")
      return new NotFound({ path });
    return new Failed({ path, cause });
  };
  const captured = (path, capture, call) => {
    try {
      const input = capture();
      return run(path, () => call(input));
    } catch (cause) {
      return Effect.fail(new Failed({ path, cause }));
    }
  };
  const run = (path, call) =>
    Effect.gen(function* () {
      yield* Effect.try({
        try: current,
        catch: (cause) => new Failed({ path, cause }),
      });
      const value = yield* Effect.tryPromise({
        try: async (signal) => {
          if (signal.aborted)
            throw new Error("native_permission_read_cancelled");
          const result = await call();
          try {
            if (signal.aborted)
              throw new Error("native_permission_read_cancelled");
            current();
          } catch (cause) {
            result?.bytes?.fill(0);
            throw new Failed({ path, cause });
          }
          return result;
        },
        catch: (cause) => failure(path, cause),
      });
      yield* Effect.try({
        try: current,
        catch: (cause) => {
          value?.bytes?.fill(0);
          return new Failed({ path, cause });
        },
      });
      return value;
    });
  return Object.freeze({
    files: Object.freeze({
      read: (path, page) =>
        captured(
          path,
          () => {
            if (page === undefined) return undefined;
            if (!page || typeof page !== "object" || types.isProxy(page))
              throw new Error("invalid_request");
            const keys = Reflect.ownKeys(page);
            if (!keys.every((key) => key === "offset" || key === "length"))
              throw new Error("invalid_request");
            return Object.freeze(record(page, keys));
          },
          (page) => original.files.read(path, page),
        ),
      list: (path) => run(path, () => original.files.list(path)),
    }),
    fs: Object.freeze({
      resolve: (path) => run(path, () => original.fs.resolve(path)),
      readDirectory: (path) => run(path, () => original.fs.readDirectory(path)),
      up: (input) =>
        captured(
          root,
          () => {
            const row = record(input, ["targets", "start", "stop"]);
            return Object.freeze({
              ...row,
              targets: Object.freeze(array(row.targets, 1)),
            });
          },
          (input) => original.fs.up(input),
        ),
      readFileStringSafe: (path) =>
        run(path, () => original.fs.readFileStringSafe(path)),
    }),
  });
}
