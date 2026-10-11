// Main-only contained actual public service proof. Never launches production Main or a model.
import assert from "node:assert/strict";
import * as fs from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { dirname, join, resolve, relative, isAbsolute, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { captureProvenance } from "./build-provenance.mjs";
import { createOwnerHost, cleanupOwnerHost } from "./p7-storage-probe.mjs";
import {
  eventHostForResources,
  verifyEventHostResources,
  resourceFileSha256,
} from "../src/event-host-resources.mjs";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function identities() {
  const provenance = await captureProvenance(repository, {
      script: "smoke",
      mode: "dev",
      platform: "darwin",
    }),
    resources = join(repository, "apps/desktop-app/dist/resources"),
    eventHost = eventHostForResources(resources, "darwin", "arm64");
  const manifest = await verifyEventHostResources(eventHost, {
    platform: "darwin",
    arch: "arm64",
  });
  const paths = [
    fileURLToPath(import.meta.url),
    ...[
      "scripts/fixtures/native-extensions-public.mjs",
      "scripts/fixtures/p7-storage-owner-host.mjs",
      "scripts/p7-storage-probe.mjs",
      "src/native-extensions-client.mjs",
      "src/native-extensions-protocol.mjs",
    ].map((p) => join(repository, "apps/desktop-app", p)),
    process.execPath,
    await fs.realpath(createRequire(import.meta.url)("electron")),
  ];
  return {
    provenance,
    resources,
    eventHost,
    manifestSha256: sha(JSON.stringify(manifest)),
    hashes: await Promise.all(
      paths.map(async (path) => ({
        path,
        sha256: await resourceFileSha256(path),
      })),
    ),
  };
}
async function claim(out) {
  const base = join(repository, "docs/runs/configuration-extensions/evidence"),
    path = resolve(repository, out),
    rel = relative(base, path);
  assert.ok(!isAbsolute(rel) && /^native-r[1-9][0-9]*$/u.test(rel));
  let current = repository;
  for (const part of relative(repository, path).split(sep)) {
    current = join(current, part);
    try {
      await fs.mkdir(current, { mode: 0o700 });
    } catch (error) {
      if (error.code !== "EEXIST" || current === path) throw error;
    }
    assert.equal(await fs.realpath(current), current);
    assert.ok((await fs.lstat(current)).isDirectory());
  }
  return path;
}
export async function runExtensionsProbe(args = process.argv.slice(2)) {
  assert.equal(process.platform, "darwin");
  assert.equal(process.arch, "arm64");
  assert.equal(args.length, 2);
  assert.equal(args[0], "--out");
  const output = await claim(args[1]),
    tracked = [],
    report = {
      result: "fail",
      scope:
        "Actual contained production owner/preflight/fixed-plugin/public extension read; no provider or foreground",
      cases: [],
      limits: [
        "Synthetic auth-free store only; no private store/provider/production Main",
        "Node negative-call counters and pinned source supplement actual sentinel/state preservation; no filesystem isolation claim",
        "Native Tool registry presence is not permission or execution; hooks inventory unsupported",
        "Owned namespaces retained on success and failure; no Windows or power-loss acceptance",
      ],
    };
  let phase = "identity",
    failed = false;
  try {
    report.before = await identities();
    const namespace = await fs.realpath(
      await fs.mkdtemp(join(output, "synthetic-")),
    );
    report.retainedNamespace = namespace;
    const host = await createOwnerHost(namespace, tracked);
    assert.equal(
      (
        await host.request("acquire", {
          productionAuthority: true,
          resourcesPath: report.before.resources,
          initialize: host.record.durable.fresh,
        })
      ).state,
      "ready",
    );
    phase = "fresh-start";
    const started = await host.request(
      "start",
      {
        eventHost: report.before.eventHost,
        binaryPath: join(
          report.before.resources,
          "opencode/darwin-arm64/opencode",
        ),
        runtimeEpoch: "extension-observation-one",
        useProductionPreflight: true,
        bootstrap: true,
      },
      { timeoutMs: 480000 },
    );
    assert.equal(started.blocked, false);
    assert.equal(started.spawned, 1);
    assert.equal(started.fresh, true);
    assert.equal(started.windows, 0);
    assert.equal(started.activationPolicy, "prohibited");
    let ready = false;
    for (let n = 0; n < 300; n++) {
      const response = await host.request("handle", {
        envelope: {
          version: 2,
          runtimeEpoch: "extension-observation-one",
          readId: `extension-ready-${n}`,
          operation: { type: "snapshot" },
        },
      });
      assert.equal(response.ok, true);
      if (
        response.value.state === "connected" &&
        response.value.selectedWorkspaceId
      ) {
        ready = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }
    assert.equal(ready, true);
    phase = "actual-public-extension-observation";
    report.observation = await host.request(
      "extensions-public",
      {},
      { timeoutMs: 120000 },
    );
    report.cases.push(...report.observation.cases);
    report.cases.push({
      name: "fresh-production-preflight-bootstrap-one-Native-zero-window",
      result: "pass",
    });
  } catch (error) {
    failed = true;
    report.failure = {
      phase,
      reason: "bounded-extension-proof-failed",
      ...(error.extensionPhase && { extensionPhase: error.extensionPhase }),
      ...(error.extensionAssertion && {
        extensionAssertion: error.extensionAssertion,
      }),
      ...(error.code === "ERR_ASSERTION" && {
        assertion: {
          operator: error.operator,
          location: String(error.stack).match(
            /configuration-extensions-probe\.mjs:\d+:\d+/u,
          )?.[0],
        },
      }),
    };
    process.stdout.write(
      JSON.stringify({ boundedFailure: report.failure }) + "\n",
    );
  } finally {
    for (const record of tracked) {
      if (!record.exited) await cleanupOwnerHost(record, { timeoutMs: 60000 });
      if (
        !record.exited ||
        !record.nativeExitConfirmed ||
        record.exit?.code !== 0 ||
        record.cleanup?.fallbackDisconnect
      )
        failed = true;
    }
    try {
      report.after = await identities();
      assert.deepEqual(report.after, report.before);
    } catch {
      failed = true;
      report.identityFailure = true;
    }
    report.cleanup = tracked.map(
      ({
        namespace,
        identity,
        exited,
        exit,
        nativeExitConfirmed,
        nativeStopResult,
        cleanup,
      }) => ({
        namespace,
        identity,
        exited,
        exit,
        nativeExitConfirmed,
        nativeStopResult,
        cleanup,
      }),
    );
    report.result = failed ? "fail" : "pass";
    await fs.writeFile(
      join(output, "extension-evidence.json"),
      JSON.stringify(report, null, 2) + "\n",
      { flag: "wx", mode: 0o600 },
    );
  }
  assert.equal(
    report.result,
    "pass",
    `Extension proof failed at ${report.failure?.phase ?? "cleanup-or-identity"}`,
  );
  return report;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  runExtensionsProbe().then(
    (r) =>
      process.stdout.write(
        JSON.stringify({ result: r.result, cases: r.cases.length }) + "\n",
      ),
    () => {
      process.exitCode = 1;
    },
  );
