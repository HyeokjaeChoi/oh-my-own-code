// Fixed Read-only auxiliary IO over one original claimed descriptor resource.
// Promise methods are not an installed Native FS service or a permission grant.
import { types } from "node:util";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  normalize,
  relative,
} from "node:path";
import {
  createNativeDescriptorFiles,
  assertNativeDescriptorReadCurrent,
} from "./native-descriptor-read-resource.mjs";
import {
  validWorkspaceFilePath,
  validWorkspaceFileRoot,
} from "../renderer/shared/workspace-file/index.mjs";

const need = (condition) => {
  if (!condition)
    throw new Error("native_permission_read_auxiliary_unverified");
};
function capture(value, fields) {
  need(value && typeof value === "object" && !types.isProxy(value));
  need(Object.getPrototypeOf(value) === Object.prototype);
  const keys = Reflect.ownKeys(value);
  need(
    keys.length === fields.length && fields.every((key) => keys.includes(key)),
  );
  const result = {};
  for (const key of fields) {
    const field = Object.getOwnPropertyDescriptor(value, key);
    need(field.enumerable && Object.hasOwn(field, "value"));
    result[key] = field.value;
  }
  return Object.freeze(result);
}

export function createNativeReadAuxiliary(resource, root) {
  need(
    validWorkspaceFileRoot(root) &&
      isAbsolute(root) &&
      normalize(root) === root,
  );
  const original = createNativeDescriptorFiles(resource);
  const current = () => assertNativeDescriptorReadCurrent(resource);
  let tail = Promise.resolve(),
    queued = 0,
    calls = 0;
  let instructionBytes = 0;
  const instructions = new Set();
  const target = (absolute) => {
    need(
      typeof absolute === "string" &&
        isAbsolute(absolute) &&
        normalize(absolute) === absolute,
    );
    const path = relative(root, absolute);
    need(
      (path === "" || validWorkspaceFilePath(path)) &&
        join(root, path) === absolute,
    );
    return absolute;
  };
  const enqueue = (body) => {
    need(queued < 32 && calls < 256);
    queued++;
    calls++;
    const result = tail.then(async () => {
      current();
      const value = await body();
      try {
        current();
      } catch (error) {
        value?.bytes?.fill(0);
        throw error;
      }
      return value;
    });
    tail = result.then(
      () => {},
      () => {},
    );
    return result.then(
      (value) => {
        queued--;
        try {
          current();
        } catch (error) {
          value?.bytes?.fill(0);
          throw error;
        }
        return value;
      },
      (error) => {
        queued--;
        throw error;
      },
    );
  };
  const directory = async (absolute) => {
    const rows = await original.list(absolute);
    current();
    return rows;
  };
  async function resolve(absolute) {
    if (absolute === root) {
      await directory(root);
      return root;
    }
    const rows = await directory(dirname(absolute));
    const row = rows.find((entry) => entry.name === basename(absolute));
    need(row && (row.type === "file" || row.type === "directory"));
    if (row.type === "directory") await directory(absolute);
    else {
      const result = await original.read(absolute, { length: 1 });
      result.bytes.fill(0);
      current();
    }
    return absolute;
  }
  const files = Object.freeze({
    read(absolute, page) {
      target(absolute);
      let detached;
      if (page !== undefined) {
        need(page && typeof page === "object" && !types.isProxy(page));
        const keys = Reflect.ownKeys(page);
        need(keys.every((key) => key === "offset" || key === "length"));
        detached = capture(page, keys);
      }
      return enqueue(() => original.read(absolute, detached));
    },
    list(absolute) {
      target(absolute);
      return enqueue(() => directory(absolute));
    },
  });
  const fs = Object.freeze({
    resolve(absolute) {
      target(absolute);
      return enqueue(() => resolve(absolute));
    },
    readDirectory(absolute) {
      target(absolute);
      return enqueue(async () =>
        Object.freeze((await directory(absolute)).map((row) => row.name)),
      );
    },
    up(input) {
      const value = capture(input, ["targets", "start", "stop"]);
      target(value.start);
      need(value.stop === root);
      // Native Read discovers only this fixed instruction filename. Do not
      // accept caller-controlled glob expansion, external stop or recursion.
      need(Array.isArray(value.targets) && !types.isProxy(value.targets));
      need(
        Reflect.ownKeys(value.targets).length === 2 &&
          value.targets.length === 1,
      );
      const item = Object.getOwnPropertyDescriptor(value.targets, "0");
      need(item && Object.hasOwn(item, "value") && item.value === "AGENTS.md");
      const distance = relative(root, value.start);
      need(distance === "" || distance.split("/").length <= 32);
      return enqueue(async () => {
        const found = [];
        for (let current = value.start; ; current = dirname(current)) {
          const rows = await directory(current);
          const row = rows.find((entry) => entry.name === "AGENTS.md");
          if (row) {
            need(row.type === "file");
            found.push(join(current, row.name));
          }
          if (current === root) break;
        }
        return Object.freeze(found);
      });
    },
    readFileStringSafe(absolute) {
      target(absolute);
      need(basename(absolute) === "AGENTS.md");
      need(instructions.has(absolute) || instructions.size < 32);
      return enqueue(async () => {
        const rows = await directory(dirname(absolute));
        const row = rows.find((entry) => entry.name === "AGENTS.md");
        if (!row) return undefined;
        need(row.type === "file");
        // Reserve requested bytes before IO; failed reads consume the budget.
        const length = 64 * 1024;
        need(instructionBytes + length <= 256 * 1024);
        instructionBytes += length;
        instructions.add(absolute);
        const result = await original.read(absolute, { length });
        try {
          current();
          need(
            result.info.size <= length &&
              result.bytes.length === result.info.size,
          );
          return new globalThis.TextDecoder("utf-8", {
            fatal: true,
            ignoreBOM: true,
          }).decode(result.bytes);
        } finally {
          result.bytes.fill(0);
        }
      });
    },
  });
  return Object.freeze({ files, fs });
}
