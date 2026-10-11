import { createRequire } from "node:module";
import { readFile, realpath, copyFile, mkdir, chmod } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { copyPackagedResources } from "./stage-event-host.mjs";
import {
  ownerLifetimeForResources,
  verifyOwnerLifetimeResources,
} from "../src/owner-lifetime-resources.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const [platform, arch] = process.argv.slice(2);
if (!platform || !arch)
  throw new Error("Usage: package.mjs <darwin|win32> <arm64|x64>");
if (platform !== process.platform || arch !== process.arch) {
  throw new Error(
    "Build each desktop target on its native OS and architecture",
  );
}

const require = createRequire(import.meta.url);
const appMetadata = JSON.parse(
  await readFile(join(root, "apps", "desktop-app", "package.json"), "utf8"),
);
const electronVersion = require("electron/package.json").version;
if (electronVersion !== appMetadata.devDependencies.electron) {
  throw new Error(
    "Installed Electron does not match the pinned desktop version",
  );
}
const packagerPath = require.resolve("@electron/packager");
const { packager } = await import(pathToFileURL(packagerPath).href);
const output = join(root, "apps", "desktop-app", "dist", "packages");
const appDir = join(root, "apps", "desktop-app", "dist", "app");
const resources = join(root, "apps", "desktop-app", "dist", "resources");
const appPath = await packager({
  dir: appDir,
  name: "OhMyOwnCode",
  platform,
  arch,
  electronVersion,
  // A caller may supply an already downloaded, trusted Electron distribution.
  // Packager verifies the exact version/platform/architecture archive filename.
  ...(process.env.OMOC_ELECTRON_ZIP_DIR && {
    electronZipDir: resolve(process.env.OMOC_ELECTRON_ZIP_DIR),
  }),
  out: output,
  overwrite: true,
  prune: false,
  asar: true,
  // Use the resource hook so the complete tree keeps its exact relative links.
  extraResource: [],
  afterCopyExtraResources: [
    async ({ buildPath }) => {
      const destination =
        platform === "darwin"
          ? join(buildPath, "OhMyOwnCode.app", "Contents", "Resources")
          : join(buildPath, "resources");
      // macOS Packager uses /var/folders; validate its canonical /private path.
      await copyPackagedResources({
        resources,
        destination: await realpath(destination),
        platform,
        arch,
      });
      const canonicalDestination = await realpath(destination);
      const sourceWitness = await verifyOwnerLifetimeResources({
        resourcesPath: resources,
        platform,
        arch,
      });
      const sourceDescriptor = ownerLifetimeForResources(
        resources,
        platform,
        arch,
      );
      const targetDescriptor = ownerLifetimeForResources(
        canonicalDestination,
        platform,
        arch,
      );
      await mkdir(join(canonicalDestination, "owner-lifetime"), {
        mode: 0o755,
      });
      await mkdir(targetDescriptor.root, { mode: 0o755 });
      await copyFile(
        sourceDescriptor.executable,
        targetDescriptor.executable,
        constants.COPYFILE_EXCL,
      );
      await chmod(targetDescriptor.executable, 0o755);
      await copyFile(
        sourceDescriptor.manifestPath,
        targetDescriptor.manifestPath,
        constants.COPYFILE_EXCL,
      );
      const packagedWitness = await verifyOwnerLifetimeResources({
        resourcesPath: canonicalDestination,
        platform,
        arch,
      });
      const sourceWitnessAfter = await verifyOwnerLifetimeResources({
        resourcesPath: resources,
        platform,
        arch,
      });
      if (
        JSON.stringify(packagedWitness.manifest) !==
          JSON.stringify(sourceWitness.manifest) ||
        JSON.stringify(sourceWitnessAfter.manifest) !==
          JSON.stringify(sourceWitness.manifest)
      )
        throw new Error("Lifetime witness changed during package copy");
    },
  ],
});
console.log(`Packaged local personal-use app: ${appPath[0]}`);
