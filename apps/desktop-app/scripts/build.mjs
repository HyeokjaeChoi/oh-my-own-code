import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";
import { stageEventHost } from "./stage-event-host.mjs";
import { stageOwnerLifetime } from "./stage-owner-lifetime.mjs";
import { sidecarPackageName } from "../src/sidecar-package.mjs";
import {
  beginBuildProvenance,
  finishBuildProvenance,
} from "./build-provenance.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const appDir = join(root, "apps", "desktop-app");
const buildInputs = await beginBuildProvenance(root);
const distApp = join(appDir, "dist", "app");
const resources = join(appDir, "dist", "resources");
const require = createRequire(import.meta.url);
const target = `${process.platform}-${process.arch}`;
const packageName = sidecarPackageName(process.platform, process.arch);
const sidecarPackage = require.resolve(`${packageName}/package.json`);
const sidecarSource = join(
  dirname(sidecarPackage),
  "bin",
  process.platform === "win32" ? "opencode.exe" : "opencode",
);
const sidecarFolder = join(resources, "opencode", target);

await buildRenderer({ configFile: join(appDir, "vite.config.ts") });

await mkdir(join(distApp, "renderer"), { recursive: true });
await mkdir(sidecarFolder, { recursive: true });
await copyFile(
  sidecarSource,
  join(
    sidecarFolder,
    process.platform === "win32" ? "opencode.exe" : "opencode",
  ),
);
if (process.platform !== "win32") {
  const { chmod } = await import("node:fs/promises");
  await chmod(join(sidecarFolder, "opencode"), 0o755);
}

await stageEventHost({ resources });
await stageOwnerLifetime({ resources });

await build({
  entryPoints: [join(appDir, "src", "main.mjs")],
  outfile: join(distApp, "main.mjs"),
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node24",
  external: ["electron"],
  sourcemap: false,
});
await copyFile(
  join(appDir, "src", "preload.cjs"),
  join(distApp, "preload.cjs"),
);
const appPackage = JSON.parse(
  await readFile(join(appDir, "package.json"), "utf8"),
);
await writeFile(
  join(distApp, "package.json"),
  `${JSON.stringify(
    {
      name: appPackage.name,
      version: appPackage.version,
      type: "module",
      main: "main.mjs",
    },
    null,
    2,
  )}\n`,
);
await finishBuildProvenance(root, buildInputs);
