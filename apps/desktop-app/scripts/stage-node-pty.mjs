import {
  chmod,
  cp,
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

// node-pty is a native module and cannot live in the esbuild bundle or the asar.
// Stage the pinned package's JS plus only the current target's prebuilt binaries beside the other
// resources (outside the asar), where the host loads it with require(). No install scripts run.
// Targets node-pty 1.1.0 ships prebuilt binaries for. Elsewhere (e.g. linux) the build skips staging
// and the terminal reports PTY_UNAVAILABLE at runtime.
export const NODE_PTY_TARGETS = new Set([
  "darwin-arm64",
  "darwin-x64",
  "win32-x64",
  "win32-arm64",
]);
export const nodePtySupported = (platform, arch) =>
  NODE_PTY_TARGETS.has(`${platform}-${arch}`);

export async function stageNodePty({
  resources,
  platform = process.platform,
  arch = process.arch,
} = {}) {
  if (!nodePtySupported(platform, arch)) {
    console.warn(
      `node-pty: no prebuilt binary for ${platform}-${arch}; skipping (terminals will be unavailable in this build)`,
    );
    return { skipped: true };
  }
  const require = createRequire(import.meta.url);
  const source = dirname(require.resolve("node-pty/package.json"));
  const pkg = JSON.parse(await readFile(join(source, "package.json"), "utf8"));
  const target = join(resources, "node-pty");
  const prebuild = join(source, "prebuilds", `${platform}-${arch}`);
  await stat(join(prebuild, "pty.node")).catch(() => {
    throw new Error(`node-pty has no prebuilt binary for ${platform}-${arch}`);
  });
  await rm(target, { recursive: true, force: true });
  await mkdir(target, { recursive: true });
  await cp(join(source, "package.json"), join(target, "package.json"));
  await cp(join(source, "LICENSE"), join(target, "LICENSE"));
  await cp(join(source, "lib"), join(target, "lib"), {
    recursive: true,
    filter: (path) => !/\.(?:test\.js|map)$/.test(path),
  });
  await cp(prebuild, join(target, "prebuilds", `${platform}-${arch}`), {
    recursive: true,
    filter: (path) => !path.endsWith(".pdb"),
  });
  if (platform !== "win32") {
    // pnpm skips node-pty's postinstall, which is what normally marks the helper executable.
    for (const dir of await readdir(join(target, "prebuilds")))
      await chmod(join(target, "prebuilds", dir, "spawn-helper"), 0o755);
  }
  return { version: pkg.version, target };
}
