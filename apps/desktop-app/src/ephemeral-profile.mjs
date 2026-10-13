import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  realpathSync,
  lstatSync,
} from "node:fs";
import { assertWindowsPrivateDirectoriesSync } from "./windows-acl.mjs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";

export function configureEphemeralProfile(
  app,
  parent = tmpdir(),
  durableRoots = [],
) {
  const root = mkdtempSync(join(parent, "oh-my-own-code-electron-"));
  if (durableRoots.some((path) => overlaps(root, path)))
    throw new Error("disposable_root_overlap");
  const paths = {
    userData: join(root, "user-data"),
    sessionData: join(root, "session-data"),
    crashDumps: join(root, "crash-dumps"),
    logs: join(root, "logs"),
  };
  for (const [name, path] of Object.entries(paths)) {
    mkdirSync(path, { recursive: true, mode: 0o700 });
    app.setPath(name, path);
  }

  let cleaned = false;
  return {
    root,
    paths,
    cleanup() {
      if (cleaned) return;
      if (durableRoots.some((path) => overlaps(root, path)))
        throw new Error("disposable_root_overlap");
      rmSync(root, { recursive: true, force: false });
      cleaned = true;
    },
  };
}

// Resolve stable locations and acquire the kernel before Electron readiness or
// profile override. These synchronous operations do not open the journal/native.
export function prepareDurableNamespace(app) {
  const documents = realpathSync(app.getPath("documents"));
  const parent = realpathSync(app.getPath("appData"));
  const product = join(parent, "OhMyOwnCode");
  const root = join(product, "storage-v1");
  let fresh = false;
  for (const directory of [product, root]) {
    try {
      mkdirSync(directory, { mode: 0o700 });
      if (directory === root) fresh = true;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
    }
    const stat = lstatSync(directory);
    if (
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid() || stat.mode & 0o022))
    )
      throw new Error("storage_denied");
  }
  if (realpathSync(root) !== root) throw new Error("storage_denied");
  // Windows has no uid/mode: the ACL of the durable root must be private to this user.
  assertWindowsPrivateDirectoriesSync([product, root]);
  return Object.freeze({
    root,
    documents,
    fresh,
    metadata: join(root, "metadata"),
    config: join(root, "native", "config"),
    data: join(root, "native", "data"),
    state: join(root, "native", "state"),
  });
}

function overlaps(a, b) {
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return !path || (!path.startsWith("..") && !isAbsolute(path));
  };
  return contains(a, b) || contains(b, a);
}
