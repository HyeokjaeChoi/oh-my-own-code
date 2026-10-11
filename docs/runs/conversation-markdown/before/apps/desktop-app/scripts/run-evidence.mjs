import { spawn } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:os";
import {
  dirname,
  isAbsolute,
  join,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const evidenceRoots = [
  "docs/runs/frontend-architecture-redesign",
  "docs/runs/configuration-provenance/evidence",
  "docs/runs/configuration-drafts/evidence",
  "docs/runs/configuration-files/evidence",
  "docs/runs/configuration-save/evidence",
  "docs/runs/configuration-instructions/evidence",
  "docs/runs/configuration-mcp/evidence",
  "docs/runs/configuration-skill-files/evidence",
  "docs/runs/configuration-skill-runtime/evidence",
  "docs/runs/configuration-agents/evidence",
  "docs/runs/configuration-extensions/evidence",
  "docs/runs/workspace-file-editing/evidence",
  "docs/runs/git-review-observation/evidence",
  "docs/runs/version-bound-line-feedback/evidence",
  "docs/runs/git-index-mutations/evidence",
  "docs/runs/git-explicit-commit/evidence",
  "docs/runs/git-branch-restore/evidence",
  "docs/runs/event-host-app-integration/evidence",
  "docs/runs/durable-workbench-storage/evidence",
];

export function evidenceRootForOutput(sourceRoot, out) {
  const output = resolve(out);
  const root = evidenceRoots
    .map((entry) => join(sourceRoot, entry))
    .find((candidate) => {
      const within = relative(candidate, output);
      return (
        within &&
        within !== ".." &&
        !within.startsWith(`..${sep}`) &&
        !isAbsolute(within)
      );
    });
  if (!root) throw new Error("Evidence path outside registered run roots");
  return root;
}
const scripts = {
  sessions: ["e2e-session-lifecycle.mjs", "session-lifecycle-evidence.json"],
  "ui-states": ["e2e-workbench-states.mjs", "ui-states-evidence.json"],
  feedback: ["e2e-line-feedback.mjs", "line-feedback-evidence.json"],
  "git-index": ["e2e-git-index.mjs", "git-index-evidence.json"],
  "git-branch-restore": [
    "e2e-git-branch-restore.mjs",
    "git-branch-restore-evidence.json",
  ],
  "git-commit": ["e2e-git-commit.mjs", "git-commit-evidence.json"],
  workbench: ["e2e-workbench.mjs", "electron-evidence.json"],
  smoke: ["e2e-smoke.mjs", null],
};

export function parseArgs(argv, nativePlatform = process.platform) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index]?.slice(2);
    const value = argv[index + 1];
    if (
      !["--out", "--script", "--mode", "--platform"].includes(argv[index]) ||
      !value ||
      value.startsWith("--") ||
      Object.hasOwn(parsed, key)
    ) {
      throw new Error(
        "Usage: run-evidence.mjs --out <fresh-run-directory> --script <sessions|ui-states|feedback|git-index|git-commit|git-branch-restore|workbench|smoke> [--mode dev|packaged --platform darwin|win32]",
      );
    }
    parsed[key] = value;
  }
  if (!parsed.out || !Object.hasOwn(scripts, parsed.script ?? ""))
    throw new Error("Required --out and enumerated --script");
  if (parsed.script !== "smoke") {
    if (parsed.mode || parsed.platform)
      throw new Error("--mode and --platform require --script smoke");
  } else {
    parsed.mode ??= "dev";
    parsed.platform ??= nativePlatform;
    if (
      !["dev", "packaged"].includes(parsed.mode) ||
      !["darwin", "win32"].includes(parsed.platform)
    )
      throw new Error(
        "Smoke requires mode dev|packaged and platform darwin|win32",
      );
  }
  return parsed;
}

function assertWithin(parent, target) {
  const rel = relative(parent, target);
  if (!rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel))
    throw new Error(`Evidence path must be strictly under ${parent}`);
}

// Walk each component instead of recursive mkdir through a potential symlink.
// The run tree is trusted local storage; this rejects pre-existing redirects.
async function checkedPath(path, create = false) {
  let current = parse(path).root;
  for (const part of path.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    if (create) {
      try {
        await mkdir(current);
      } catch (error) {
        if (error.code !== "EEXIST") throw error;
      }
    }
    const stat = await lstat(current);
    if (stat.isSymbolicLink())
      throw new Error(`Evidence symlink rejected: ${current}`);
    if (current !== path && !stat.isDirectory())
      throw new Error(`Evidence parent is not a directory: ${current}`);
  }
  return lstat(path);
}

export async function prepareDestination(boundRoot, out, selector) {
  const root = resolve(boundRoot);
  const output = resolve(out);
  assertWithin(root, output);
  if (
    !/^(sessions|ui-states|feedback|git-index|git-commit|git-branch-restore|workbench|smoke-(dev|packaged)-(darwin|win32))$/.test(
      selector,
    )
  )
    throw new Error("Invalid evidence destination selector");
  await checkedPath(root);
  await checkedPath(output, true);
  const destination = join(output, selector);
  const stat = await checkedPath(destination, true);
  if (!stat.isDirectory())
    throw new Error("Evidence destination is not a directory");
  if ((await readdir(destination)).length)
    throw new Error(`Refusing nonempty evidence destination: ${destination}`);
  // Exclusive claim prevents concurrent wrappers from both adopting an empty directory.
  const claim = await open(
    join(destination, ".run-evidence-claim"),
    "wx",
    0o600,
  );
  await claim.close();
  return destination;
}

async function validateEvidence(destination, script) {
  const reportName = scripts[script][1];
  if (!reportName) {
    const stdout = await readFile(join(destination, "stdout.log"), "utf8");
    if (!stdout.trim()) throw new Error("Smoke produced no stdout evidence");
    return ["stdout.log", "stderr.log"];
  }
  const reportPath = join(destination, reportName);
  const stat = await checkedPath(reportPath);
  if (!stat.isFile() || !stat.size)
    throw new Error("Evidence report is empty or not a file");
  const report = JSON.parse(await readFile(reportPath, "utf8"));
  if (
    report.result !== "pass" ||
    !Array.isArray(report.screenshots) ||
    !report.screenshots.length
  )
    throw new Error("Evidence report must pass and list captures");
  if (
    ["feedback", "git-index", "git-commit", "git-branch-restore"].includes(
      script,
    ) &&
    (report.teardown?.exited !== true || report.teardown?.code !== 0)
  )
    throw new Error("Feedback requires confirmed owned Electron exit zero");
  const captures = [];
  for (const capture of report.screenshots) {
    const path = typeof capture === "string" ? capture : capture?.path;
    if (typeof path !== "string" || !isAbsolute(path))
      throw new Error("Capture must contain an absolute path");
    const absolute = resolve(path);
    assertWithin(destination, absolute);
    const captureStat = await checkedPath(absolute);
    if (!captureStat.isFile() || captureStat.size <= 8)
      throw new Error("Capture is empty or not a file");
    const handle = await open(absolute, "r");
    try {
      const header = Buffer.alloc(
        ["feedback", "git-index", "git-commit", "git-branch-restore"].includes(
          script,
        )
          ? 24
          : 8,
      );
      const { bytesRead } = await handle.read(header, 0, header.length, 0);
      if (
        bytesRead !== header.length ||
        !header.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))
      )
        throw new Error("Capture is not a PNG");
      if (
        ["feedback", "git-index", "git-commit", "git-branch-restore"].includes(
          script,
        )
      ) {
        if (
          typeof capture !== "object" ||
          capture === null ||
          capture.captureMethod !==
            "BrowserWindow.webContents.capturePage().toPNG()" ||
          [
            capture.osWindowVisible,
            capture.osWindowFocused,
            capture.osWindowFocusable,
            capture.beforeCapture?.visible,
            capture.beforeCapture?.focused,
            capture.beforeCapture?.focusable,
          ].some((value) => value !== false)
        )
          throw new Error(
            "Feedback capture must prove hidden nonfocusable window",
          );
        const width = header.readUInt32BE(16),
          height = header.readUInt32BE(20);
        if (
          !width ||
          !height ||
          capture.pixelDimensions?.width !== width ||
          capture.pixelDimensions?.height !== height
        )
          throw new Error("Feedback capture dimensions mismatch");
        const scale = capture.displayScaleFactor,
          zoom = capture.zoomFactor;
        if (
          !Number.isFinite(scale) ||
          scale <= 0 ||
          !Number.isFinite(zoom) ||
          zoom <= 0 ||
          !Number.isFinite(capture.viewport?.pixelRatio) ||
          Math.abs(capture.viewport.pixelRatio - scale * zoom) > 0.01
        )
          throw new Error("Feedback capture scale mismatch");
        for (const [key, pixels] of [
          ["width", width],
          ["height", height],
        ])
          if (
            !Number.isFinite(capture.contentBounds?.[key]) ||
            capture.contentBounds[key] <= 0 ||
            !Number.isFinite(capture.viewport?.[key]) ||
            capture.viewport[key] <= 0 ||
            Math.abs(capture.contentBounds[key] * scale - pixels) > 1 ||
            Math.abs(
              capture.viewport[key] * zoom - capture.contentBounds[key],
            ) > zoom
          )
            throw new Error(
              "Feedback capture does not cover whole hidden viewport",
            );
      }
    } finally {
      await handle.close();
    }
    captures.push(relative(destination, absolute));
  }
  return [reportName, ...captures];
}

export async function runEvidence(options, dependencies = {}) {
  const sourceRoot = dependencies.repoRoot ?? repoRoot;
  // Validate exported entrypoint too: injection is limited to test dependencies.
  const selected = parseArgs(
    Object.entries(options).flatMap(([key, value]) => [`--${key}`, value]),
  );
  const selector =
    selected.script === "smoke"
      ? `smoke-${selected.mode}-${selected.platform}`
      : selected.script;
  const destination = await prepareDestination(
    dependencies.runRoot ?? evidenceRootForOutput(sourceRoot, selected.out),
    selected.out,
    selector,
  );
  const argv = [
    join(sourceRoot, "apps/desktop-app/scripts", scripts[selected.script][0]),
    ...(selected.script === "smoke" ? [selected.mode, selected.platform] : []),
  ];
  const manifest = {
    script: selected.script,
    mode: selected.mode ?? null,
    platform: selected.platform ?? process.platform,
    runnerPlatform: process.platform,
    runnerArch: process.arch,
    runnerNode: process.version,
    destination,
    command: [process.execPath, ...argv],
    startedAt: new Date().toISOString(),
    status: "running",
    exitCode: null,
    signal: null,
    evidence: [],
    provenance: null,
    provenanceVerifiedAfter: false,
  };
  let stdout;
  let stderr;
  try {
    stdout = await open(join(destination, "stdout.log"), "wx", 0o600);
    stderr = await open(join(destination, "stderr.log"), "wx", 0o600);
    // No native launch may precede this real byte/stamp validation.
    manifest.provenance = await captureProvenance(sourceRoot, selected);
    const childResult = await new Promise((resolveResult, reject) => {
      const child = (dependencies.spawnChild ?? spawn)(process.execPath, argv, {
        cwd: sourceRoot,
        shell: false,
        env: {
          ...(dependencies.env ?? process.env),
          OMOC_EVIDENCE_DIR: destination,
        },
        stdio: ["ignore", stdout.fd, stderr.fd],
      });
      let spawnError;
      const forward = (signal) => child.kill(signal);
      const onInterrupt = () => forward("SIGINT");
      const onTerminate = () => forward("SIGTERM");
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onTerminate);
      child.once("error", (error) => {
        spawnError = error;
      });
      child.once("close", (code, signal) => {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
        if (spawnError) reject(spawnError);
        else resolveResult({ code, signal });
      });
    });
    manifest.exitCode = childResult.code;
    manifest.signal = childResult.signal;
    const after = await captureProvenance(sourceRoot, selected);
    if (JSON.stringify(after) !== JSON.stringify(manifest.provenance))
      throw new Error("Capture provenance changed during evidence run");
    manifest.provenanceVerifiedAfter = true;
    if (childResult.code === 0 && !childResult.signal) {
      manifest.evidence = await validateEvidence(destination, selected.script);
      manifest.status = "pass";
    } else manifest.status = "fail";
  } catch (error) {
    manifest.status = "fail";
    manifest.error = String(error);
  } finally {
    await stdout?.close();
    await stderr?.close();
  }
  const exitCode = manifest.signal
    ? 128 + (constants.signals[manifest.signal] ?? 1)
    : manifest.exitCode || (manifest.status === "pass" ? 0 : 1);
  manifest.wrapperExitCode = exitCode;
  manifest.finishedAt = new Date().toISOString();
  await writeFile(
    join(destination, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return { destination, manifest, exitCode };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const result = await runEvidence(parseArgs(process.argv.slice(2)));
    console.log(JSON.stringify(result.manifest));
    process.exitCode = result.exitCode;
  } catch (error) {
    console.error(String(error));
    process.exitCode = 1;
  }
}
