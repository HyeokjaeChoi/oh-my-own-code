import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { build as buildRenderer } from "vite";
import { stageEventHost } from "./stage-event-host.mjs";
import { verifySidecarReceipt } from "./fetch-sidecar.mjs";
import { stageOwnerLifetime } from "./stage-owner-lifetime.mjs";
import {
  sidecarBinaryName,
  sidecarPackageName,
} from "../src/sidecar-package.mjs";
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
// OMOC_BUILD_TARGET=<platform>-<arch> builds the resources of ANOTHER target
// (layout/provenance verification only; nothing is executed). The sidecar then
// comes from OMOC_SIDECAR_PACKAGE_DIR (see scripts/fetch-sidecar.mjs).
const [targetPlatform, targetArch] = (
  process.env.OMOC_BUILD_TARGET ?? `${process.platform}-${process.arch}`
).split("-");
const target = `${targetPlatform}-${targetArch}`;
const packageName = sidecarPackageName(targetPlatform, targetArch);
// An override directory is honoured ONLY for a cross-target build and ONLY if
// fetch-sidecar's receipt proves it is the lockfile-pinned package; a native
// (shippable) build always uses the installed dependency.
const crossBuild = target !== `${process.platform}-${process.arch}`;
if (process.env.OMOC_SIDECAR_PACKAGE_DIR && !crossBuild)
  throw new Error(
    "OMOC_SIDECAR_PACKAGE_DIR is only valid with OMOC_BUILD_TARGET for another target",
  );
const sidecarPackageDir = process.env.OMOC_SIDECAR_PACKAGE_DIR
  ? resolve(process.env.OMOC_SIDECAR_PACKAGE_DIR)
  : dirname(require.resolve(`${packageName}/package.json`));
const sidecarReceipt = process.env.OMOC_SIDECAR_PACKAGE_DIR
  ? await verifySidecarReceipt(sidecarPackageDir, {
      lockText: await readFile(join(root, "pnpm-lock.yaml"), "utf8"),
      name: packageName,
      version: JSON.parse(await readFile(join(appDir, "package.json"), "utf8"))
        .dependencies["@opencode/client"],
      binary: sidecarBinaryName(targetPlatform),
    })
  : undefined;
const sidecarSource = join(
  sidecarPackageDir,
  "bin",
  sidecarBinaryName(targetPlatform),
);
const sidecarFolder = join(resources, "opencode", target);

await buildRenderer({ configFile: join(appDir, "vite.config.ts") });

await mkdir(join(distApp, "renderer"), { recursive: true });
await mkdir(sidecarFolder, { recursive: true });
await copyFile(
  sidecarSource,
  join(sidecarFolder, sidecarBinaryName(targetPlatform)),
);
if (targetPlatform !== "win32") {
  const { chmod } = await import("node:fs/promises");
  await chmod(join(sidecarFolder, "opencode"), 0o755);
}

await stageEventHost({
  resources,
  platform: targetPlatform,
  arch: targetArch,
});
// Windows uses the identity-mode witness: no helper binary to stage.
if (targetPlatform === "darwin") await stageOwnerLifetime({ resources });

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
await finishBuildProvenance(root, buildInputs, { sidecarReceipt });
