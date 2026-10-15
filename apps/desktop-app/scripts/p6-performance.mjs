// Test-only background measurement. No production store instrumentation.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { constants } from "node:fs";
import {
  lstat,
  mkdtemp,
  open,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { createRequire } from "node:module";
import { cpus, release, tmpdir, version } from "node:os";
import { basename, dirname, join, parse, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";
import { _electron as electron } from "@playwright/test";
import { captureProvenance } from "./build-provenance.mjs";
import { prepareDestination } from "./run-evidence.mjs";

const scriptPath = fileURLToPath(import.meta.url);
const desktop = resolve(dirname(scriptPath), "..");
const root = resolve(desktop, "../..");
const require = createRequire(import.meta.url);
const hash = async () =>
  createHash("sha256")
    .update(await readFile(scriptPath))
    .digest("hex");
const stats = (samples) => {
  const sorted = samples.map((s) => s.ms).sort((a, b) => a - b);
  const at = (p) =>
    sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] ?? null;
  return {
    count: sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    max: sorted.at(-1) ?? null,
  };
};

const RESOURCE_METRICS = Object.freeze([
  "JSHeapUsedSize",
  "JSHeapTotalSize",
  "Nodes",
  "JSEventListeners",
]);

// Test-only Node summary: the mixed160 flag is evidence, never a replacement
// for either phase's unchanged 10% total/last-batch acceptance criterion.
export function summarizeResourceScopes({
  preparationResources,
  switchResources,
}) {
  const failures = [];
  const validMetric = (value) => Number.isSafeInteger(value) && value > 0;
  const growth = (baseline, final) =>
    validMetric(baseline) && validMetric(final)
      ? 100 * (final / baseline - 1)
      : null;
  const summarize = (baseline, final, previous) =>
    Object.fromEntries(
      RESOURCE_METRICS.map((key) => {
        const start = baseline?.metrics?.[key],
          end = final?.metrics?.[key],
          prior = previous?.metrics?.[key];
        return [
          key,
          {
            baseline: validMetric(start) ? start : null,
            final: validMetric(end) ? end : null,
            growthPercent: growth(start, end),
            lastBatchBaseline: validMetric(prior) ? prior : null,
            lastBatchGrowthPercent: growth(prior, end),
          },
        ];
      }),
    );
  const validate = (captures, scope, counts, countKey) => {
    if (!Array.isArray(captures) || captures.length !== counts.length) {
      failures.push(`${scope} resource boundaries incomplete`);
      return;
    }
    Array.from(captures).forEach((capture, index) => {
      if (
        capture?.[countKey] !== counts[index] ||
        capture?.switches !== (scope === "preparation60" ? 0 : counts[index]) ||
        (scope === "switch100" && capture?.preparationOperations !== 60)
      )
        failures.push(`${scope} capture${index} operation boundary invalid`);
      for (const key of RESOURCE_METRICS)
        if (!validMetric(capture?.metrics?.[key]))
          failures.push(
            `${scope} capture${index} ${key} missing/invalid; stabilization unverified`,
          );
      if (capture?.metrics?.JSHeapTotalSize < capture?.metrics?.JSHeapUsedSize)
        failures.push(
          `${scope} capture${index} allocated heap below used heap`,
        );
      if (capture?.gc !== "CDP HeapProfiler.collectGarbage completed")
        failures.push(
          `${scope} capture${index} post-GC observation unverified`,
        );
      if (
        capture?.pendingReturnedToBaseline !== true ||
        !Array.isArray(capture?.requests) ||
        capture.requests.length !== 3 ||
        capture.requests.some(
          (request) =>
            !request ||
            request.pending !== 0 ||
            request.active !== 0 ||
            !Number.isSafeInteger(request.admitted) ||
            request.admitted < 0 ||
            request.admitted !== request.settled,
        )
      )
        failures.push(
          `${scope} capture${index} synthetic pending reads did not return to zero baseline`,
        );
    });
  };
  validate(
    preparationResources,
    "preparation60",
    [0, 20, 40, 60],
    "preparationOperations",
  );
  validate(switchResources, "switch100", [0, 25, 50, 75, 100], "switches");
  const preparation = Array.isArray(preparationResources)
      ? preparationResources
      : [],
    switches = Array.isArray(switchResources) ? switchResources : [];
  for (const key of RESOURCE_METRICS)
    if (preparation.at(-1)?.metrics?.[key] !== switches[0]?.metrics?.[key])
      failures.push(
        `switch100 ${key} baseline differs from preparation60 final`,
      );
  const preparation60 = {
    operations: 60,
    metrics: summarize(preparation[0], preparation.at(-1), preparation.at(-2)),
    batches: Array.from(preparation.slice(1)).map((capture, index) => ({
      operations: (index + 1) * 20,
      metrics: summarize(preparation[0], capture, preparation[index]),
    })),
  };
  const switch100 = {
    operations: 100,
    metrics: summarize(switches[0], switches.at(-1), switches.at(-2)),
  };
  const enforce = (scope, metrics) => {
    for (const [key, value] of Object.entries(metrics)) {
      if (value.growthPercent === null || value.lastBatchGrowthPercent === null)
        failures.push(
          `${scope} ${key} growth unavailable; stabilization unverified`,
        );
      if (value.growthPercent > 10)
        failures.push(
          `${scope} ${key} growth >10%; resource stabilization unresolved, profile retained counts`,
        );
      if (value.lastBatchGrowthPercent > 10)
        failures.push(
          `${scope} ${key} last batch growth >10%; resource stabilization unresolved, profile retained counts`,
        );
    }
  };
  enforce("preparation60", preparation60.metrics);
  // Preserve failures in all three auxiliary stages, including a spike that
  // later stages reverse. Captures run after each latency window has closed.
  for (const batch of preparation60.batches)
    enforce(`preparation60 batch${batch.operations}`, batch.metrics);
  enforce("switch100", switch100.metrics);
  const combined160 = {
    operations: 160,
    resources: [...preparation, ...switches.slice(1)].map((capture) => ({
      ...capture,
      combinedOperations: capture?.preparationOperations + capture?.switches,
    })),
    metrics: Object.fromEntries(
      RESOURCE_METRICS.map((key) => {
        const baseline = preparation[0]?.metrics?.[key],
          final = switches.at(-1)?.metrics?.[key],
          growthPercent = growth(baseline, final);
        return [
          key,
          {
            baseline: validMetric(baseline) ? baseline : null,
            final: validMetric(final) ? final : null,
            growthPercent,
            exceeds10Percent:
              growthPercent === null ? null : growthPercent > 10,
          },
        ];
      }),
    ),
    criterion:
      "Mixed160 evidence only; both independent phase criteria remain mandatory. Growth flags do not establish leak absence or zero growth.",
  };
  return { preparation60, switch100, combined160, failures };
}

const HEAP_BOUNDS = Object.freeze({
  bytes: 64 * 1024 * 1024,
  nodes: 400000,
  edges: 2000000,
  groups: 32,
  pathDepth: 16,
  pathNodes: 256,
});
const digestName = (name) => createHash("sha256").update(name).digest("hex");
const nodeTypes = new Set([
  "hidden",
  "array",
  "string",
  "object",
  "code",
  "closure",
  "regexp",
  "number",
  "native",
  "synthetic",
  "concatenated string",
  "sliced string",
  "symbol",
  "bigint",
  "object shape",
]);
const edgeTypes = new Set([
  "context",
  "element",
  "property",
  "internal",
  "hidden",
  "shortcut",
  "weak",
]);

// These exports are test-only Node APIs, never renderer globals. A graph holds
// only IDs/types/name hashes/self bytes. Snapshot strings/edge names are dropped.
export function summarizeSyntheticHeap(snapshot, baseline, previous) {
  const meta = snapshot?.snapshot?.meta;
  const fields = meta?.node_fields,
    edgeFields = meta?.edge_fields;
  assert.ok(
    Array.isArray(fields) && Array.isArray(edgeFields),
    "Heap schema required",
  );
  const field = (names, name) => {
    const index = names.indexOf(name);
    assert.ok(index >= 0, "Required heap field absent");
    return index;
  };
  const nt = field(fields, "type"),
    nn = field(fields, "name"),
    ni = field(fields, "id"),
    ns = field(fields, "self_size"),
    ne = field(fields, "edge_count"),
    et = field(edgeFields, "type"),
    to = field(edgeFields, "to_node");
  const nodes = snapshot.nodes,
    edges = snapshot.edges,
    strings = snapshot.strings;
  assert.ok(
    Array.isArray(nodes) && Array.isArray(edges) && Array.isArray(strings),
    "Heap tables required",
  );
  assert.equal(nodes.length % fields.length, 0, "Malformed heap nodes");
  assert.equal(edges.length % edgeFields.length, 0, "Malformed heap edges");
  const count = nodes.length / fields.length,
    edgeCount = edges.length / edgeFields.length;
  assert.ok(
    count > 0 && count <= HEAP_BOUNDS.nodes && edgeCount <= HEAP_BOUNDS.edges,
    "Heap graph bound exceeded",
  );
  const names = new Map(),
    graph = new Map(),
    records = [],
    offsets = new Int32Array(count + 1);
  let cursor = 0;
  for (let i = 0; i < count; i++) {
    const start = i * fields.length;
    const type = meta.node_types[nt][nodes[start + nt]];
    const nameIndex = nodes[start + nn],
      id = nodes[start + ni],
      selfBytes = nodes[start + ns],
      outgoing = nodes[start + ne];
    assert.ok(
      Number.isSafeInteger(id) && id >= 0 && !graph.has(id),
      "Invalid heap identity",
    );
    assert.ok(
      Number.isSafeInteger(selfBytes) &&
        selfBytes >= 0 &&
        Number.isSafeInteger(outgoing) &&
        outgoing >= 0,
      "Invalid heap counts",
    );
    assert.equal(typeof strings[nameIndex], "string", "Heap name absent");
    if (!names.has(nameIndex))
      names.set(nameIndex, digestName(strings[nameIndex]));
    const record = {
      type: nodeTypes.has(type) ? type : "other",
      nameSha256: names.get(nameIndex),
      selfBytes,
    };
    records.push({ id, ...record });
    graph.set(id, record);
    offsets[i] = cursor;
    cursor += outgoing;
    assert.ok(cursor <= edgeCount, "Invalid heap adjacency");
  }
  offsets[count] = cursor;
  assert.equal(cursor, edgeCount, "Heap edge count mismatch");
  const targets = new Int32Array(edgeCount),
    types = [];
  for (let e = 0; e < edgeCount; e++) {
    const start = e * edgeFields.length,
      target = edges[start + to];
    assert.ok(
      Number.isSafeInteger(target) &&
        target >= 0 &&
        target % fields.length === 0 &&
        target < nodes.length,
      "Invalid heap target",
    );
    targets[e] = target / fields.length;
    const type = meta.edge_types[et][edges[start + et]];
    assert.ok(edgeTypes.has(type), "Unsupported heap edge semantics");
    types.push(type);
  }
  // One shortest strong path from snapshot root. This is a reference path,
  // not a dominator/retained-size calculation or proof of application ownership.
  const parent = new Int32Array(count).fill(-1),
    queue = new Int32Array(count);
  queue[0] = 0;
  parent[0] = 0;
  let tail = 1;
  for (let head = 0; head < tail; head++) {
    const source = queue[head];
    for (let e = offsets[source]; e < offsets[source + 1]; e++) {
      const target = targets[e];
      if (types[e] === "weak" || parent[target] !== -1) continue;
      parent[target] = source;
      queue[tail++] = target;
    }
  }
  const added = (id) => baseline && !baseline.has(id);
  const persistent = (id) => added(id) && previous?.has(id);
  const pathCandidates = records
    .map((record, index) => ({ record, index }))
    .filter(({ record, index }) => added(record.id) && parent[index] !== -1)
    .sort(
      (a, b) =>
        Number(persistent(b.record.id)) - Number(persistent(a.record.id)) ||
        b.record.selfBytes - a.record.selfBytes ||
        a.index - b.index,
    );
  const pathSelection = new Set(
    pathCandidates.slice(0, HEAP_BOUNDS.pathNodes).map(({ index }) => index),
  );
  const classes = new Map(),
    references = new Map(),
    paths = new Map();
  for (let i = 0; i < records.length; i++) {
    const record = records[i],
      key = `${record.type}:${record.nameSha256}`;
    if (!classes.has(key))
      classes.set(key, {
        type: record.type,
        nameSha256: record.nameSha256,
        count: 0,
        selfBytes: 0,
        addedCount: 0,
        addedSelfBytes: 0,
        persistentAddedCount: 0,
        persistentAddedSelfBytes: 0,
      });
    const group = classes.get(key);
    group.count++;
    group.selfBytes += record.selfBytes;
    if (!added(record.id)) continue;
    group.addedCount++;
    group.addedSelfBytes += record.selfBytes;
    if (persistent(record.id)) {
      group.persistentAddedCount++;
      group.persistentAddedSelfBytes += record.selfBytes;
    }
    if (!pathSelection.has(i)) continue;
    const chain = [];
    let current = i;
    while (chain.length < HEAP_BOUNDS.pathDepth) {
      chain.push({
        type: records[current].type,
        nameSha256: records[current].nameSha256,
      });
      if (current === 0 || chain.length === HEAP_BOUNDS.pathDepth) break;
      current = parent[current];
    }
    const truncated = current !== 0;
    chain.reverse();
    const signature = digestName(JSON.stringify({ chain, truncated }));
    if (!paths.has(signature))
      paths.set(signature, {
        signatureSha256: signature,
        chain,
        truncated,
        count: 0,
        selfBytes: 0,
        persistentAddedCount: 0,
      });
    const path = paths.get(signature);
    path.count++;
    path.selfBytes += record.selfBytes;
    if (persistent(record.id)) path.persistentAddedCount++;
  }
  for (let source = 0; source < count; source++)
    for (let e = offsets[source]; e < offsets[source + 1]; e++) {
      const target = records[targets[e]],
        owner = records[source];
      if (types[e] === "weak" || !added(target.id)) continue;
      const key = `${owner.type}:${owner.nameSha256}:${types[e]}:${target.type}:${target.nameSha256}`;
      if (!references.has(key))
        references.set(key, {
          sourceType: owner.type,
          sourceNameSha256: owner.nameSha256,
          edgeType: types[e],
          targetType: target.type,
          targetNameSha256: target.nameSha256,
          edgeCount: 0,
          persistentTargetEdgeCount: 0,
        });
      references.get(key).edgeCount++;
      if (persistent(target.id))
        references.get(key).persistentTargetEdgeCount++;
    }
  const top = (groups, by) => {
    const all = [...groups.values()].sort(
      (a, b) =>
        b[by] - a[by] || JSON.stringify(a).localeCompare(JSON.stringify(b)),
    );
    return {
      groupCount: all.length,
      omittedGroupCount: Math.max(0, all.length - HEAP_BOUNDS.groups),
      groups: all.slice(0, HEAP_BOUNDS.groups),
    };
  };
  const sum = (items) => items.reduce((n, r) => n + r.selfBytes, 0);
  const born = records.filter((r) => added(r.id)),
    survived = born.filter((r) => persistent(r.id));
  const removed = baseline
    ? [...baseline].filter(([id]) => !graph.has(id)).map(([, r]) => r)
    : [];
  return {
    graph,
    publicSummary: {
      nodes: count,
      edges: edgeCount,
      strongRootReachableNodes: tail,
      selfBytes: sum(records),
      addedSinceBaselineCount: born.length,
      addedSinceBaselineSelfBytes: sum(born),
      removedSinceBaselineCount: removed.length,
      removedSinceBaselineSelfBytes: sum(removed),
      persistentAddedCount: survived.length,
      persistentAddedSelfBytes: sum(survived),
      rootPathEligibleNodes: pathCandidates.length,
      rootPathSampledNodes: pathSelection.size,
      rootPathOmittedNodes: pathCandidates.length - pathSelection.size,
      classes: top(classes, baseline ? "addedSelfBytes" : "selfBytes"),
      strongIncomingReferencesToAdded: top(references, "edgeCount"),
      strongRootPathsToAdded: top(paths, "selfBytes"),
      limits:
        "Stable CDP IDs in one renderer; self bytes and strong references only, no dominator retained sizes. Persistence across snapshots does not by itself prove a leak. Names are SHA256; no edge names, raw IDs, values, filesystem paths or snapshot exported. Root paths sample up to256 reachable added nodes, preferring persistent nodes then larger self bytes. Top groups are bounded; omitted counts are explicit.",
    },
  };
}

export async function captureSyntheticHeap(cdp, baseline, previous) {
  const chunks = [];
  let bytes = 0,
    overflow = false,
    timer;
  const receive = ({ chunk }) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > HEAP_BOUNDS.bytes) overflow = true;
    if (!overflow) chunks.push(chunk);
  };
  cdp.on("HeapProfiler.addHeapSnapshotChunk", receive);
  try {
    await Promise.race([
      cdp.send("HeapProfiler.takeHeapSnapshot", {
        reportProgress: false,
        captureNumericValue: false,
      }),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Synthetic heap capture timeout")),
          60000,
        );
      }),
    ]);
    assert.ok(!overflow, "Synthetic heap byte bound exceeded");
    const raw = chunks.join("");
    chunks.length = 0;
    const summary = summarizeSyntheticHeap(JSON.parse(raw), baseline, previous);
    summary.publicSummary.snapshotBytes = bytes;
    summary.publicSummary.snapshotSha256 = digestName(raw);
    return summary;
  } catch {
    // Protocol/schema errors can contain strings from snapshots. Never export them.
    throw new Error(
      "Synthetic heap capture/schema/bound unavailable; analysis incomplete",
    );
  } finally {
    clearTimeout(timer);
    chunks.length = 0;
    cdp.off("HeapProfiler.addHeapSnapshotChunk", receive);
  }
}

export function parsePerformanceOptions(argv) {
  const modes = [
    "repeat-retainers",
    "repeat-retainers-no-observer",
    "phase-task",
    "phase-control",
  ];
  if (
    ![2, 4, 6].includes(argv.length) ||
    argv[0] !== "--out" ||
    !argv[1] ||
    argv[1].startsWith("--") ||
    (argv.length >= 4 &&
      (argv[2] !== "--analysis" || !modes.includes(argv[3]))) ||
    (argv[3] === "phase-control" && argv.length !== 6) ||
    (argv.length === 6 &&
      (argv[3] !== "phase-control" ||
        argv[4] !== "--task-report" ||
        !argv[5] ||
        argv[5].startsWith("--")))
  )
    throw new Error(
      "Usage: p6-performance.mjs --out <fresh-directory> [--analysis repeat-retainers|repeat-retainers-no-observer|phase-task|phase-control [--task-report <task-performance-evidence.json>]]",
    );
  const out = resolve(root, argv[1]),
    analysis = argv[3] ?? null;
  if (
    analysis &&
    (dirname(out) !==
      join(root, "docs/runs/frontend-architecture-redesign/execution") ||
      !/^p6-worker-[a-z0-9][a-z0-9-]*$/.test(basename(out)))
  )
    throw new Error(
      "Analysis requires a fresh execution/p6-worker-* destination",
    );
  return {
    out,
    analysis,
    ...(analysis === "phase-control" && { taskReport: resolve(root, argv[5]) }),
  };
}

const workerOutputRoot = join(
  root,
  "docs/runs/frontend-architecture-redesign/execution",
);
const PHASE_BOUNDS = Object.freeze({
  reportBytes: 4 * 1024 * 1024,
  stageMs: 120000,
  totalMs: 600000,
  framesPerOperation: 4096,
  timingToleranceMs: 50,
});
const phaseStages = [
  ["initial", "initial", 0, 0],
  ["after20input", "input", 20, 0],
  ["after20menu", "menu", 20, 0],
  ["after20panel", "panel", 20, 0],
  ...[25, 50, 75, 100].map((n) => [`after${n}switch`, "switch", 25, n]),
];
const phaseIdentityKeys = [
  "performanceScriptSha256",
  "buildStampSha256",
  "buildInputsSha256",
  "selectedScriptsAndFixturesSha256",
  "launchArtifactsSha256",
  "relevantSourceSha256",
];
function phaseIdentity(provenance, scriptSha256) {
  return {
    performanceScriptSha256: scriptSha256,
    buildStampSha256: provenance?.buildStampSha256,
    buildInputsSha256: provenance?.currentBuildInputs?.sha256,
    selectedScriptsAndFixturesSha256:
      provenance?.selectedScriptsAndFixtures?.sha256,
    launchArtifactsSha256: provenance?.launchArtifacts?.sha256,
    relevantSourceSha256: provenance?.currentRelevantSource?.sha256,
  };
}
function closed(value, keys) {
  assert.ok(
    value && typeof value === "object" && !Array.isArray(value),
    "Phase object required",
  );
  assert.deepEqual(
    Object.keys(value).sort(),
    [...keys].sort(),
    "Closed phase schema required",
  );
}
function bounded(value, max, integer = false) {
  assert.ok(
    Number.isFinite(value) &&
      value >= 0 &&
      value <= max &&
      (!integer || Number.isSafeInteger(value)),
    "Phase numerical bound exceeded",
  );
}
function validateIdentity(identity, expected) {
  closed(identity, phaseIdentityKeys);
  for (const key of phaseIdentityKeys) {
    assert.match(identity[key], /^[a-f0-9]{64}$/, "Phase hash required");
    assert.equal(
      identity[key],
      expected[key],
      "Phase source/build identity mismatch",
    );
  }
}
function validatePhasePlan(plan, expected) {
  closed(plan, ["schemaVersion", "selector", "identity", "stages"]);
  assert.equal(plan.schemaVersion, 1);
  assert.equal(plan.selector, "phase-task");
  validateIdentity(plan.identity, expected);
  assert.ok(
    Array.isArray(plan.stages) && plan.stages.length === phaseStages.length,
    "Eight ordered phase stages required",
  );
  let total = 0;
  plan.stages.forEach((stage, index) => {
    closed(stage, [
      "name",
      "kind",
      "operations",
      "elapsedMs",
      "evaluateCalls",
      "frameCounts",
    ]);
    const [name, kind, operations] = phaseStages[index];
    assert.equal(stage.name, name);
    assert.equal(stage.kind, kind);
    assert.equal(stage.operations, operations);
    assert.equal(stage.evaluateCalls, operations ? operations + 2 : 0);
    bounded(stage.elapsedMs, PHASE_BOUNDS.stageMs);
    assert.ok(operations ? stage.elapsedMs > 0 : stage.elapsedMs === 0);
    assert.ok(
      Array.isArray(stage.frameCounts) &&
        stage.frameCounts.length === operations,
      "Exact phase operation/frame schedule required",
    );
    for (const frames of stage.frameCounts) {
      bounded(frames, PHASE_BOUNDS.framesPerOperation, true);
      assert.ok(
        frames >= 2,
        "Measurement includes an observed and a closing frame",
      );
    }
    total += stage.elapsedMs;
  });
  bounded(total, PHASE_BOUNDS.totalMs);
}
function validatePhaseResource(resource, index) {
  closed(resource, [
    "switches",
    "phase",
    "gc",
    "metrics",
    "requests",
    "pendingReturnedToBaseline",
    "beforeCapture",
    "afterCapture",
  ]);
  assert.equal(resource.phase, phaseStages[index][0]);
  assert.equal(resource.switches, phaseStages[index][3]);
  assert.equal(
    resource.gc,
    "CDP HeapProfiler.collectGarbage completed",
    "Phase post-GC capture required",
  );
  closed(resource.metrics, [
    "JSHeapUsedSize",
    "JSHeapTotalSize",
    "Nodes",
    "JSEventListeners",
  ]);
  for (const value of Object.values(resource.metrics))
    bounded(value, Number.MAX_SAFE_INTEGER, true);
  assert.ok(
    resource.metrics.JSHeapUsedSize > 0 &&
      resource.metrics.JSHeapTotalSize >= resource.metrics.JSHeapUsedSize,
    "Phase heap baseline invalid",
  );
  assert.ok(Array.isArray(resource.requests) && resource.requests.length === 3);
  for (const request of resource.requests) {
    closed(request, [
      "requests",
      "active",
      "pending",
      "admitted",
      "max",
      "settled",
      "deduplicated",
      "cancelled",
    ]);
    for (const value of Object.values(request))
      bounded(value, Number.MAX_SAFE_INTEGER, true);
    assert.equal(request.active, 0, "Phase active reads did not settle");
    assert.equal(request.pending, 0, "Phase pending reads did not settle");
    assert.equal(
      request.admitted,
      request.settled,
      "Phase admissions did not settle",
    );
  }
  assert.equal(resource.pendingReturnedToBaseline, true);
  for (const window of [resource.beforeCapture, resource.afterCapture])
    assert.deepEqual(window, {
      count: 1,
      visible: false,
      focused: false,
      focusable: false,
    });
}

// Only hashes, numerical schedules and raw counters are admitted for replay.
// Primary failures (including >10% growth) do not invalidate a completed task
// diagnostic, but an incomplete diagnostic or moving provenance does.
export function validatePhaseTaskReport(report, expectedIdentity) {
  assert.equal(report?.schemaVersion, 1);
  assert.equal(report.kind, "p6-background-performance");
  assert.ok(["fail", "diagnostic-only"].includes(report.result));
  assert.deepEqual(report.acceptance, {
    eligible: false,
    reason: "phase-diagnostic",
    primaryBaselinePerturbed: true,
  });
  const phase = report.phaseDiagnostic;
  closed(phase, [
    "selector",
    "status",
    "controlPlan",
    "resources",
    "comparison",
    "inputSha256",
    "limits",
  ]);
  assert.equal(phase.selector, "phase-task");
  assert.equal(phase.status, "captured-not-causal-verdict");
  assert.equal(phase.inputSha256, null);
  assert.deepEqual(phase.comparison, []);
  assert.deepEqual(phase.limits, phaseLimits);
  validatePhasePlan(phase.controlPlan, expectedIdentity);
  assert.ok(
    Array.isArray(phase.resources) &&
      phase.resources.length === phaseStages.length,
  );
  phase.resources.forEach(validatePhaseResource);
  assert.equal(report.teardown, "test process exit confirmed");
  assert.deepEqual(report.rendererErrors, []);
  const provenance = report.provenance;
  assert.ok(
    provenance?.before && provenance?.after,
    "Complete task provenance required",
  );
  assert.deepEqual(
    provenance.before,
    provenance.after,
    "Moving task provenance rejected",
  );
  validateIdentity(
    phaseIdentity(provenance.before, provenance.performanceScriptSha256Before),
    expectedIdentity,
  );
  validateIdentity(
    phaseIdentity(provenance.after, provenance.performanceScriptSha256After),
    expectedIdentity,
  );
  return globalThis.structuredClone(phase.controlPlan);
}

async function checkedTaskFile(input, allowedRoot) {
  const target = resolve(input),
    allowed = resolve(allowedRoot);
  assert.equal(
    dirname(dirname(dirname(target))),
    allowed,
    "Task report must be in the guarded worker output root",
  );
  assert.match(
    basename(dirname(dirname(target))),
    /^p6-worker-[a-z0-9][a-z0-9-]*$/,
  );
  assert.equal(basename(dirname(target)), "ui-states");
  assert.equal(basename(target), "performance-evidence.json");
  let current = parse(target).root;
  for (const part of target.slice(current.length).split(sep).filter(Boolean)) {
    current = join(current, part);
    const stat = await lstat(current);
    assert.ok(!stat.isSymbolicLink(), "Task report symlink rejected");
    assert.ok(
      current === target ? stat.isFile() : stat.isDirectory(),
      "Task report path type rejected",
    );
  }
  return { target, stat: await lstat(target) };
}
const sameTaskFile = (a, b) =>
  ["dev", "ino", "size", "mtimeMs", "ctimeMs"].every(
    (key) => a[key] === b[key],
  );
export async function readPhaseTaskReport(
  input,
  expectedIdentity,
  allowedRoot = workerOutputRoot,
) {
  let handle;
  try {
    const { target, stat } = await checkedTaskFile(input, allowedRoot);
    assert.ok(
      stat.size > 0 && stat.size <= PHASE_BOUNDS.reportBytes,
      "Task report byte bound exceeded",
    );
    handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    const opened = await handle.stat();
    assert.ok(sameTaskFile(stat, opened), "Task report moved before reading");
    const bytes = Buffer.alloc(stat.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const read = await handle.read(
        bytes,
        length,
        bytes.length - length,
        length,
      );
      if (!read.bytesRead) break;
      length += read.bytesRead;
    }
    assert.equal(length, stat.size, "Task report changed size during reading");
    assert.ok(
      sameTaskFile(opened, await handle.stat()) &&
        sameTaskFile(opened, (await checkedTaskFile(input, allowedRoot)).stat),
      "Task report moved during reading",
    );
    const raw = bytes.subarray(0, length);
    return {
      plan: validatePhaseTaskReport(
        JSON.parse(raw.toString("utf8")),
        expectedIdentity,
      ),
      sha256: createHash("sha256").update(raw).digest("hex"),
    };
  } catch {
    // JSON/parser/assertion errors can echo input; do not persist their payloads.
    throw new Error(
      "Phase task input/path/schema/bounds/identity invalid; diagnostic incomplete",
    );
  } finally {
    await handle?.close();
  }
}
export async function assertPhaseTaskUnchanged(
  input,
  expectedIdentity,
  sha256,
  allowedRoot = workerOutputRoot,
) {
  const current = await readPhaseTaskReport(
    input,
    expectedIdentity,
    allowedRoot,
  );
  assert.equal(
    current.sha256,
    sha256,
    "Phase task input changed after validation; diagnostic incomplete",
  );
}
const phaseLimits = [
  "Diagnostic only, before the primary baseline; subsequent ordinary100 is perturbed and never contractual acceptance. No snapshots in either phase selector.",
  "Task/control use separate fresh renderers, same frozen build, ordinary warmup and long-task initialization. Every stage has one GC/getMetrics capture, three page timer evaluations, three main counter reads and two hidden-window checks.",
  "Control matches action evaluation/frame counts and browser-local elapsed duration, including automation gaps; code differs (frame-only control versus handlers/MutationObserver). Frame spacing, JIT, GC cost, polling and task-induced state still differ. No perfect causal isolation.",
  "Elapsed differences are raw observations; 50ms tolerance describes mismatch only, never an acceptance threshold. Browser stage limit120s, total600s, <=4096frames/action; report<=4MiB.",
];

// Dependency injection here is a test-only Node seam. Production passes the
// existing measure/resources functions; no new renderer globals or store APIs.
export async function runPhaseDiagnostic({
  page,
  resources,
  identity,
  controlInput = null,
  measureAction = measure,
}) {
  validateIdentity(identity, identity);
  if (controlInput) validatePhasePlan(controlInput.plan, identity);
  const phase = {
    selector: controlInput ? "phase-control" : "phase-task",
    status: "incomplete",
    controlPlan: {
      schemaVersion: 1,
      selector: "phase-task",
      identity,
      stages: [],
    },
    resources: [],
    comparison: [],
    inputSha256: controlInput?.sha256 ?? null,
    limits: [...phaseLimits],
  };
  try {
    let elapsedTotal = 0;
    for (let index = 0; index < phaseStages.length; index++) {
      const [name, kind, operations, switches] = phaseStages[index];
      const target = controlInput?.plan.stages[index];
      const stage = {
        name,
        kind,
        operations,
        elapsedMs: 0,
        evaluateCalls: operations ? operations + 2 : 0,
        frameCounts: [],
      };
      if (operations) {
        const wallStart = globalThis.performance.now();
        const start = await page.evaluate(() => globalThis.performance.now());
        for (let n = 0; n < operations; n++) {
          bounded(
            globalThis.performance.now() - wallStart,
            PHASE_BOUNDS.stageMs,
          );
          let frames;
          if (target) {
            frames = await page.evaluate(
              async ({ count, deadline }) => {
                for (let i = 0; i < count; i++) {
                  if (globalThis.performance.now() > deadline)
                    throw new Error(
                      "Phase control stage duration bound exceeded",
                    );
                  await new Promise((resolve) =>
                    globalThis.requestAnimationFrame(resolve),
                  );
                }
                if (globalThis.performance.now() > deadline)
                  throw new Error(
                    "Phase control stage duration bound exceeded",
                  );
                return count;
              },
              {
                count: target.frameCounts[n],
                deadline: start + PHASE_BOUNDS.stageMs,
              },
            );
          } else {
            const sample = await measureAction(
              page,
              kind,
              kind === "switch" ? switches - 25 + n : n + 10,
            );
            assert.equal(sample.correct, true, "Phase action condition failed");
            bounded(sample.ms, PHASE_BOUNDS.stageMs);
            frames = sample.observedFrames + 1; // measure always awaits a closing frame
          }
          bounded(frames, PHASE_BOUNDS.framesPerOperation, true);
          assert.ok(frames >= 2);
          stage.frameCounts.push(frames);
        }
        stage.elapsedMs = await page.evaluate(
          async ({ start, targetMs }) => {
            const remaining = targetMs - (globalThis.performance.now() - start);
            if (remaining > 0)
              await new Promise((resolve) =>
                globalThis.setTimeout(resolve, remaining),
              );
            return globalThis.performance.now() - start;
          },
          { start, targetMs: target?.elapsedMs ?? 0 },
        );
      }
      phase.controlPlan.stages.push(stage);
      bounded(stage.elapsedMs, PHASE_BOUNDS.stageMs);
      elapsedTotal += stage.elapsedMs;
      bounded(elapsedTotal, PHASE_BOUNDS.totalMs);
      await resources(switches, phase.resources, { phase: name });
      assert.equal(
        phase.resources.length,
        index + 1,
        "One phase capture per stage required",
      );
      validatePhaseResource(phase.resources[index], index);
      if (target)
        phase.comparison.push({
          name,
          targetElapsedMs: target.elapsedMs,
          actualElapsedMs: stage.elapsedMs,
          deltaMs: stage.elapsedMs - target.elapsedMs,
          matchedWithinTolerance:
            Math.abs(stage.elapsedMs - target.elapsedMs) <=
            PHASE_BOUNDS.timingToleranceMs,
          evaluateCallsMatch: stage.evaluateCalls === target.evaluateCalls,
          frameCountsMatch:
            JSON.stringify(stage.frameCounts) ===
            JSON.stringify(target.frameCounts),
        });
    }
    validatePhasePlan(phase.controlPlan, identity);
    phase.status = "captured-not-causal-verdict";
  } catch {
    // Preserve partial numerical observations without input/protocol payloads.
    phase.status = "incomplete";
  }
  return phase;
}

// Every timestamp and condition in a sample lives in this one renderer call.
// Returned metadata contains neither transcript/draft text nor bridge payloads.
async function measure(page, kind, index, observeMutations = true) {
  return page.evaluate(
    async ({ kind, index, observeMutations }) => {
      const frame = () =>
        new Promise((resolve) => globalThis.requestAnimationFrame(resolve));
      const button = (label) =>
        globalThis.document.querySelector(`button[aria-label="${label}"]`);
      const composer = globalThis.document.querySelector(
        '[aria-label="메시지 작성"]',
      );
      const heading = () =>
        globalThis.document.querySelector(".workbench-header strong");
      const transcript = () =>
        globalThis.document.querySelector(".transcript")?.textContent ?? "";
      const targetB = index % 2 === 0;
      const title = targetB ? "P6 Session B" : "P6 Session A";
      const marker = targetB ? "P6_MARKER_B" : "P6_MARKER_A";
      const oldMarker = targetB ? "P6_MARKER_A" : "P6_MARKER_B";
      let oldTranscriptFrames = 0,
        pendingFrames = 0,
        observedFrames = 0;
      let shellMs = null,
        projectionMs = null;
      const inspect = () => {
        if (kind !== "switch" || heading()?.textContent !== title) return;
        if (transcript().includes(oldMarker)) oldTranscriptFrames++;
      };
      const observer = observeMutations
        ? new globalThis.MutationObserver(inspect)
        : null;
      if (kind === "switch" && observer)
        observer.observe(globalThis.document.body, {
          subtree: true,
          childList: true,
          characterData: true,
        });
      const start = globalThis.performance.now();
      let ready;
      try {
        if (kind === "input") {
          const text = `synthetic draft ${index}`;
          const setter = Object.getOwnPropertyDescriptor(
            globalThis.HTMLTextAreaElement.prototype,
            "value",
          ).set;
          setter.call(composer, text);
          composer.dispatchEvent(
            new globalThis.Event("input", { bubbles: true }),
          );
          ready = () =>
            composer.value === text &&
            button("메시지 보내기")?.disabled === false;
        } else if (kind === "menu") {
          const trigger = button("앱 동작과 명령 열기");
          trigger.click();
          ready = () =>
            trigger.getAttribute("aria-expanded") === "true" &&
            globalThis.document.querySelector(
              '[aria-label="앱 동작 및 런타임 명령"]',
            );
        } else if (kind === "panel") {
          const trigger = button("파일·확장");
          trigger.click();
          ready = () =>
            trigger.getAttribute("aria-expanded") === "true" &&
            globalThis.document.querySelector(
              '[aria-label="읽기 전용 파일 탐색"]',
            );
        } else {
          if (heading()?.textContent === title)
            throw new Error("Switch must change actual selection");
          const target = globalThis.document.querySelector(
            `button[title="${title}"]`,
          );
          if (!target) throw new Error("Registered session button missing");
          target.click();
          ready = () => {
            inspect();
            if (
              heading()?.textContent !== title ||
              globalThis.document
                .querySelector(`button[title="${title}"]`)
                ?.getAttribute("aria-current") !== "page"
            )
              return false;
            if (shellMs === null)
              shellMs = globalThis.performance.now() - start;
            if (!transcript().includes(marker)) {
              pendingFrames++;
              return false;
            }
            projectionMs = globalThis.performance.now() - start;
            return true;
          };
        }
        let done = false;
        while (globalThis.performance.now() - start < 6000) {
          await frame();
          observedFrames++;
          inspect();
          if (ready()) {
            done = true;
            break;
          }
        }
        const ms = globalThis.performance.now() - start;
        if (kind === "menu") button("명령 목록 닫기")?.click();
        if (kind === "panel") button("상세 패널 닫기")?.click();
        await frame();
        inspect();
        return {
          kind,
          index,
          ms,
          shellMs,
          projectionMs,
          observedFrames,
          pendingFrames,
          oldTranscriptFrames,
          correct: done && oldTranscriptFrames === 0,
        };
      } finally {
        observer?.disconnect();
      }
    },
    { kind, index, observeMutations },
  );
}

async function bundle(provenance) {
  const baseline = JSON.parse(
    await readFile(
      join(
        root,
        "docs/runs/frontend-architecture-redesign/execution/p6-pre-migration-bundle.json",
      ),
      "utf8",
    ),
  );
  const files = provenance.launchArtifacts.files.filter((f) =>
    /\/renderer\/assets\/index-[^/]+\.(js|css)$/.test(f.path),
  );
  assert.ok(
    files.some((f) => f.path.endsWith(".js")) &&
      files.some((f) => f.path.endsWith(".css")),
    "Entry JS/CSS required",
  );
  const current = await Promise.all(
    files.map(async (f) => {
      const bytes = await readFile(join(root, f.path));
      return {
        extension: f.path.endsWith(".js") ? "js" : "css",
        sha256: f.sha256,
        rawBytes: bytes.length,
        gzipBytes: gzipSync(bytes, { level: 6 }).length,
      };
    }),
  );
  const rawTotal = current.reduce((n, f) => n + f.rawBytes, 0);
  return {
    current,
    rawTotal,
    gzipTotal: current.reduce((n, f) => n + f.gzipBytes, 0),
    gzipMethod:
      "node:zlib gzipSync level6; current Node version in environment",
    historicalRawTotal: baseline.rawTotal,
    historicalReportedGzipTotal: baseline.gzipTotal,
    rawDeltaBytes: rawTotal - baseline.rawTotal,
    rawDeltaPercent: 100 * (rawTotal / baseline.rawTotal - 1),
    gzipDelta: null,
    gzipComparison:
      "unverified: baseline compressor settings/exact bytes unavailable",
  };
}

export async function runPerformance(argv = process.argv.slice(2)) {
  const options = parsePerformanceOptions(argv);
  const phaseMode = ["phase-task", "phase-control"].includes(options.analysis);
  const destination = await prepareDestination(
    join(root, "docs/runs/frontend-architecture-redesign"),
    options.out,
    "ui-states",
  );
  const report = {
    schemaVersion: 1,
    kind: "p6-background-performance",
    result: "unverified",
    failures: [],
    instrumentation: {
      scope:
        "Test-only valid read tasks; requests counts all workbench handle calls, admitted/settled/max/active/pending count logical read tasks only; deduplicated does not add admission. Cancellation detaches a logical read and cannot prove underlying/provider promise termination.",
      noPayloads: true,
    },
    samples: { input: [], menu: [], panel: [], switches: [], scroll: [] },
    preparationResources: [],
    resources: [],
    limits: [
      "Synthetic hidden/nonfocusable main with actual built renderer/preload; no provider, foreground perceived latency, packaged startup or Windows claim.",
      "Timings combine synthetic DOM handler/store/render and local IPC; shell is local selection UI, not cached transcript or pure-store latency.",
      "DOM listeners do not establish store subscription counts; canonical disposal is covered by separate Node tests.",
      "Sampled frames and DOM mutations cannot prove every compositor frame or screen-reader announcement; synthetic typing is not physical Korean IME.",
      "Before/after byte identities are observations, not filesystem isolation.",
      "Preparation60 has post-GC captures initially and after each20 input/menu/panel operations. Each capture includes CDP GC/getMetrics, three50ms polling waits/counter reads and hidden-window checks; these perturb timing/allocation. Switch100 starts at the saved preparation final; mixed160 growth remains separately flagged. This reviewed method does not reinterpret historical failures or establish leak absence.",
    ],
  };
  if (options.analysis)
    report.acceptance = {
      eligible: false,
      reason: phaseMode ? "phase-diagnostic" : "retainer-diagnostic",
      primaryBaselinePerturbed: phaseMode,
    };
  if (phaseMode) {
    report.phaseDiagnostic = {
      selector: options.analysis,
      status: "incomplete",
      controlPlan: null,
      resources: [],
      comparison: [],
      inputSha256: null,
      limits: [...phaseLimits],
    };
  }
  let application,
    processHandle,
    fixtureRoot,
    fixtureIdentity,
    before,
    beforeHash,
    cdp,
    controlInput;
  const fail = (message) => report.failures.push(message);
  const background = async () => {
    const state = await application.evaluate(({ BrowserWindow }) => {
      const windows = BrowserWindow.getAllWindows();
      return {
        count: windows.length,
        visible: windows.some((w) => w.isVisible()),
        focused: windows.some((w) => w.isFocused()),
        focusable: windows.some((w) => w.isFocusable()),
      };
    });
    assert.deepEqual(state, {
      count: 1,
      visible: false,
      focused: false,
      focusable: false,
    });
    return state;
  };
  try {
    beforeHash = await hash();
    before = await captureProvenance(root, { script: "ui-states" });
    if (options.analysis === "phase-control")
      controlInput = await readPhaseTaskReport(
        options.taskReport,
        phaseIdentity(before, beforeHash),
      );
    report.bundle = await bundle(before);
    if (report.bundle.rawDeltaPercent > 10)
      fail("Entry raw bundle growth exceeds 10%; source analysis required");
    fixtureRoot = await realpath(
      await mkdtemp(join(tmpdir(), "omoc-p6-performance-")),
    );
    fixtureIdentity = await lstat(fixtureRoot);
    const launcherStart = globalThis.performance.now();
    application = await electron.launch({
      timeout: 20000,
      executablePath: require("electron"),
      args: [join(desktop, "scripts/fixtures/workbench-host.mjs")],
      env: {
        PATH: process.env.PATH ?? "/usr/bin:/bin",
        HOME: fixtureRoot,
        TMPDIR: fixtureRoot,
        TMP: fixtureRoot,
        TEMP: fixtureRoot,
        OMOC_UI_TEST_ROOT: fixtureRoot,
        OMOC_P6_PERFORMANCE: "1",
        ...(process.platform === "win32" && {
          SystemRoot: process.env.SystemRoot ?? "C:\\Windows",
          USERPROFILE: fixtureRoot,
        }),
      },
    });
    processHandle = application.process();
    const page = await application.firstWindow({ timeout: 15000 });
    const errors = [];
    page.on("pageerror", () =>
      errors.push("Renderer page error observed; payload omitted"),
    );
    report.cold = await page.evaluate(async () => {
      const start = globalThis.performance.now();
      while (
        globalThis.document
          .querySelector(".workbench-header [data-connection]")
          ?.getAttribute("data-connection") !== "connected"
      ) {
        if (globalThis.performance.now() - start > 15000)
          throw new Error("Cold connected DOM timeout");
        await new Promise((resolve) =>
          globalThis.requestAnimationFrame(resolve),
        );
      }
      return {
        rendererNavigationToConnectedDomMs: globalThis.performance.now(),
        rendererObserverInstalledAtMs: start,
        observations: 1,
        boundary:
          "navigation time origin to observed connected DOM; late attachment gives upper bound, not first paint",
      };
    });
    report.cold.launcherDispatchToObservedConnectedDomMs =
      globalThis.performance.now() - launcherStart;
    report.cold.launcherBoundary =
      "Node launcher dispatch through Playwright connection/observation return; one cold observation, includes automation overhead";
    report.environment = {
      platform: process.platform,
      arch: process.arch,
      osRelease: release(),
      osVersion: version(),
      cpuModel: cpus()[0]?.model,
      logicalCpus: cpus().length,
      node: process.version,
      runtime: await application.evaluate(() => ({
        electron: process.versions.electron,
        chrome: process.versions.chrome,
        node: process.versions.node,
      })),
      viewport: await page.evaluate(() => ({
        width: window.innerWidth,
        height: window.innerHeight,
        dpr: window.devicePixelRatio,
      })),
      zoom: await application.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].webContents.getZoomFactor(),
      ),
    };
    report.fixture = await application.evaluate(() => {
      const f = globalThis.__omocUiFixture;
      return {
        sessions: f.snapshot.sessions.length,
        messagesPerSession: [...f.sessionMessages.values()].map(
          (v) => v.length,
        ),
        transcriptCharactersPerSession: [...f.sessionMessages.values()].map(
          (v) => v.reduce((n, m) => n + m.text.length, 0),
        ),
        tools: 0,
        permissions: f.snapshot.permissions.length,
      };
    });
    await background();
    report.limits.push(
      "Input is a synthetic controlled-textarea value/send-enabled DOM proxy after a frame, not independently timed store commit. Scroll uses scrollTop and a synthetic scroll event, not physical wheel input.",
    );
    report.warmup = {
      input: 5,
      menu: 5,
      panel: 5,
      switches: 10,
      excludedFromSamples: true,
      samples: [],
    };
    for (const kind of ["input", "menu", "panel", "switch"])
      for (let i = 0; i < (kind === "switch" ? 10 : 5); i++) {
        const sample = await measure(page, kind, i);
        report.warmup.samples.push(sample);
        if (!sample.correct) fail(`Warmup ${kind} ${i} condition failed`);
      }
    await page.evaluate(() => {
      globalThis.__p6LongTasks = [];
      globalThis.__p6LongTasksDropped = 0;
      globalThis.__p6LongTaskSupported =
        globalThis.PerformanceObserver?.supportedEntryTypes?.includes(
          "longtask",
        ) === true;
      if (globalThis.__p6LongTaskSupported) {
        globalThis.__p6LongTaskObserver = new globalThis.PerformanceObserver(
          (list) => {
            for (const entry of list.getEntries())
              if (entry.duration > 50) {
                if (globalThis.__p6LongTasks.length < 2048)
                  globalThis.__p6LongTasks.push({
                    startMs: entry.startTime,
                    durationMs: entry.duration,
                  });
                else globalThis.__p6LongTasksDropped++;
              }
          },
        );
        globalThis.__p6LongTaskObserver.observe({ type: "longtask" });
      }
      globalThis.__p6TaskWindows = [];
    });
    cdp = await page.context().newCDPSession(page);
    await cdp.send("Performance.enable");
    const resources = async (
      switches,
      target = report.resources,
      metadata = {},
    ) => {
      const beforeCapture = await background();
      let gc = "not performed";
      try {
        await cdp.send("HeapProfiler.collectGarbage");
        gc = "CDP HeapProfiler.collectGarbage completed";
      } catch {
        gc = "unsupported/unavailable; no post-GC claim";
      }
      const { metrics } = await cdp.send("Performance.getMetrics");
      const selected = Object.fromEntries(
        metrics
          .filter((m) =>
            [
              "JSHeapUsedSize",
              "JSHeapTotalSize",
              "Nodes",
              "JSEventListeners",
            ].includes(m.name),
          )
          .map((m) => [m.name, m.value]),
      );
      const requests = [];
      for (let i = 0; i < 3; i++) {
        await page.evaluate(
          () => new Promise((resolve) => globalThis.setTimeout(resolve, 50)),
        );
        requests.push(
          await application.evaluate(() => globalThis.__omocUiMetrics()),
        );
      }
      target.push({
        switches,
        ...metadata,
        gc,
        metrics: selected,
        requests,
        pendingReturnedToBaseline: requests.every((r) => r.pending === 0),
        beforeCapture,
        afterCapture: await background(),
      });
    };
    if (phaseMode) {
      if (report.warmup.samples.some((sample) => !sample.correct)) {
        fail("Phase warmup invalid; diagnostic incomplete");
      } else {
        report.phaseDiagnostic = await runPhaseDiagnostic({
          page,
          resources,
          identity: phaseIdentity(before, beforeHash),
          controlInput,
        });
        if (report.phaseDiagnostic.status === "incomplete")
          fail(
            "Phase capture/action/baseline/bounds invalid; diagnostic incomplete",
          );
      }
    }
    await resources(0, report.preparationResources, {
      phase: "preparation-baseline",
      preparationOperations: 0,
    });
    for (const kind of ["input", "menu", "panel"]) {
      const start = await page.evaluate(() => globalThis.performance.now());
      for (let i = 0; i < 20; i++)
        report.samples[kind].push(await measure(page, kind, i + 10));
      await page.evaluate(
        ({ kind, start }) =>
          globalThis.__p6TaskWindows.push({
            kind: kind === "input" ? "typing" : kind,
            start,
            end: globalThis.performance.now(),
          }),
        { kind, start },
      );
      await resources(0, report.preparationResources, {
        phase: `after20${kind}`,
        preparationOperations: report.preparationResources.length * 20,
      });
    }
    // Reuse the same post-panel capture, without another GC/polling round.
    report.resources.push({
      ...report.preparationResources.at(-1),
      phase: "switch-baseline",
    });
    for (let batch = 0; batch < 4; batch++) {
      for (let i = batch * 25; i < (batch + 1) * 25; i++)
        report.samples.switches.push(await measure(page, "switch", i));
      await resources((batch + 1) * 25, report.resources, {
        preparationOperations: 60,
      });
    }
    report.samples.scroll = await page.evaluate(async () => {
      const target = globalThis.document.querySelector(".transcript");
      const start = globalThis.performance.now(),
        samples = [];
      for (let index = 0; index < 20; index++) {
        const before = globalThis.performance.now();
        target.scrollTop = index % 2 ? 0 : target.scrollHeight;
        target.dispatchEvent(new globalThis.Event("scroll"));
        await new Promise((resolve) =>
          globalThis.requestAnimationFrame(resolve),
        );
        samples.push({
          index,
          ms: globalThis.performance.now() - before,
          scrollTop: target.scrollTop,
          scrollHeight: target.scrollHeight,
          clientHeight: target.clientHeight,
          scrollable: target.scrollHeight > target.clientHeight,
        });
      }
      globalThis.__p6TaskWindows.push({
        kind: "scroll",
        start,
        end: globalThis.performance.now(),
      });
      return samples;
    });
    report.longTasks = await page.evaluate(async () => {
      await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
      if (!globalThis.__p6LongTaskSupported)
        return {
          status: "unverified",
          reason: "PerformanceObserver longtask unsupported",
        };
      const observer = globalThis.__p6LongTaskObserver;
      for (const e of observer.takeRecords())
        if (e.duration > 50) {
          if (globalThis.__p6LongTasks.length < 2048)
            globalThis.__p6LongTasks.push({
              startMs: e.startTime,
              durationMs: e.duration,
            });
          else globalThis.__p6LongTasksDropped++;
        }
      observer.disconnect();
      return {
        status: "observed",
        thresholdMs: 50,
        dropped: globalThis.__p6LongTasksDropped,
        entries: globalThis.__p6LongTasks,
        phases: globalThis.__p6TaskWindows.map((w) => ({
          ...w,
          count: globalThis.__p6LongTasks.filter(
            (e) => e.startMs >= w.start && e.startMs <= w.end,
          ).length,
        })),
      };
    });
    if (report.longTasks.dropped > 0)
      fail(
        "Long-task metadata limit reached; complete repetition counts unverified",
      );
    if (
      report.longTasks.status === "observed" &&
      report.longTasks.phases.some(
        (p) => ["typing", "scroll"].includes(p.kind) && p.count > 1,
      )
    )
      fail(
        "Repeated typing/scroll long tasks >50ms; profiling required, unresolved",
      );
    if (!report.samples.scroll.every((s) => s.scrollable))
      report.limits.push(
        "Scroll fixture was not scrollable in all samples; effective scroll long-task behavior unverified.",
      );
    report.switchValidation = {
      requested: 100,
      correctTitleSelectionAndMarker: report.samples.switches.filter(
        (s) => s.correct,
      ).length,
      oldTranscriptObservations: report.samples.switches.reduce(
        (n, s) => n + s.oldTranscriptFrames,
        0,
      ),
      blankPendingObservations: report.samples.switches.reduce(
        (n, s) => n + s.pendingFrames,
        0,
      ),
      boundary:
        "Title, aria-current and target transcript marker verified in sampled DOM frames; MutationObserver also checks old marker while target title is active.",
    };
    report.summary = Object.fromEntries(
      ["input", "menu", "panel"].map((k) => [
        k,
        { ...stats(report.samples[k]), p95GoalMs: 100 },
      ]),
    );
    report.summary.shell = {
      ...stats(report.samples.switches.map((s) => ({ ms: s.shellMs ?? s.ms }))),
      p95GoalMs: 150,
    };
    report.summary.projection = {
      ...stats(
        report.samples.switches.map((s) => ({ ms: s.projectionMs ?? s.ms })),
      ),
      p95GoalMs: 100,
      includes: "selection through scoped snapshot IPC and transcript DOM",
    };
    for (const [kind, summary] of Object.entries(report.summary))
      if (summary.p95 > summary.p95GoalMs)
        fail(
          `${kind} p95 ${summary.p95}ms exceeds ${summary.p95GoalMs}ms; profiling/amendment required`,
        );
    for (const [kind, samples] of Object.entries(report.samples))
      if (kind !== "scroll" && samples.some((s) => !s.correct))
        fail(`${kind}: condition/session/title/transcript check failed`);
    report.resourceScopes = summarizeResourceScopes({
      preparationResources: report.preparationResources,
      switchResources: report.resources,
    });
    report.stabilization = report.resourceScopes.switch100.metrics;
    for (const failure of report.resourceScopes.failures) fail(failure);
    report.rendererErrors = errors;
    if (errors.length) fail("Renderer errors observed");
    await background();
    if (
      ["repeat-retainers", "repeat-retainers-no-observer"].includes(
        options.analysis,
      )
    ) {
      // All contracted samples/resources/verdict criteria are already computed.
      // Profiling cannot replace baseline, discard failures or make primary pass.
      const analysis = (report.analysis = {
        selector: options.analysis,
        status: "incomplete",
        bounds: HEAP_BOUNDS,
        primarySwitches: 100,
        primaryFailures: [...report.failures],
        additionalSwitches: 200,
        idleControlMs: 1000,
        mutationObserverEnabled: options.analysis === "repeat-retainers",
        samples: [],
        resources: [],
        heaps: [],
        limits: [
          "Runs after contracted primary100 and scroll/longtask observation, with snapshot/GC perturbation. Extra samples never enter primary summary or stabilization.",
          "Compare separate unique runs of both selectors under one frozen build. Same browser-local timestamps/title/aria-current/marker/frame checks; no-observer removes only MutationObserver coverage in additional samples. Primary always retains it.",
          "Idle is a no-switch control, not a matched elapsed-time causal control. Snapshot overhead, polling, execution order and JIT remain confounders. Persistent strong paths identify candidates, not proof of dominator ownership or a product leak.",
          "Idle heap compares with analysis-baseline; repeat heaps compare with the saved idle-control graph. This isolates the repeat-created cohort without replacing any primary resource baseline. All four heap summaries are retained.",
        ],
      });
      let baselineGraph, previousGraph, baselineStage, previousStage;
      try {
        await cdp.send("HeapProfiler.enable");
        // Establish stable IDs for this synthetic renderer only; primary is finished.
        await cdp.send("HeapProfiler.startTrackingHeapObjects", {
          trackAllocations: false,
        });
        const capture = async (stage, additionalSwitches) => {
          await resources(additionalSwitches, analysis.resources, {
            phase: `${stage}-before-snapshot`,
            additionalSwitches,
          });
          const heap = await captureSyntheticHeap(
            cdp,
            baselineGraph,
            previousGraph,
          );
          analysis.heaps.push({
            stage,
            additionalSwitches,
            comparisonBaselineStage: baselineStage ?? null,
            comparisonPreviousStage: previousStage ?? null,
            ...heap.publicSummary,
          });
          if (!baselineGraph || stage === "idle-control") {
            baselineGraph = heap.graph;
            baselineStage = stage;
          }
          previousGraph = heap.graph;
          previousStage = stage;
          // Expose snapshot perturbation with a second post-GC metric sample.
          await resources(additionalSwitches, analysis.resources, {
            phase: `${stage}-after-snapshot`,
            additionalSwitches,
          });
        };
        await capture("analysis-baseline", 0);
        await page.evaluate(
          () => new Promise((resolve) => globalThis.setTimeout(resolve, 1000)),
        );
        await capture("idle-control", 0);
        for (let batch = 0; batch < 8; batch++) {
          for (let i = batch * 25; i < (batch + 1) * 25; i++) {
            const sample = await measure(
              page,
              "switch",
              100 + i,
              analysis.mutationObserverEnabled,
            );
            analysis.samples.push(sample);
            if (!sample.correct) fail(`Analysis switch ${i} condition failed`);
          }
          await resources((batch + 1) * 25, analysis.resources, {
            phase: "repeat-batch",
            additionalSwitches: (batch + 1) * 25,
          });
          if ((batch + 1) % 4 === 0)
            await capture(`repeat-${(batch + 1) / 4}`, (batch + 1) * 25);
        }
        if (analysis.resources.some((r) => !r.pendingReturnedToBaseline))
          fail("Analysis synthetic pending reads did not return to zero");
        analysis.correctSwitches = analysis.samples.filter(
          (s) => s.correct,
        ).length;
        analysis.status = "captured-not-causal-verdict";
      } catch {
        fail(
          "Synthetic analysis capture/protocol/bounds unavailable; analysis incomplete",
        );
      } finally {
        baselineGraph = previousGraph = undefined;
        // stopTrackingHeapObjects emits another snapshot. Disable the agent
        // instead; native teardown also destroys the isolated renderer.
        try {
          await cdp.send("HeapProfiler.disable");
        } catch {
          analysis.status = "incomplete";
          fail("Synthetic heap agent cleanup unavailable; analysis incomplete");
        }
      }
      await background();
      if (errors.length) fail("Renderer errors observed during analysis");
    }
  } catch (error) {
    fail(String(error));
  } finally {
    let timer;
    try {
      if (application) {
        processHandle ??= application.process();
        const exited =
          processHandle.exitCode !== null
            ? Promise.resolve([processHandle.exitCode])
            : once(processHandle, "exit");
        if (processHandle.exitCode === null)
          await application.evaluate(({ app }) => app.quit());
        const [code] = await Promise.race([
          exited,
          new Promise((_, reject) => {
            timer = setTimeout(
              () =>
                reject(
                  new Error("Test host exit unconfirmed; temp root retained"),
                ),
              15000,
            );
          }),
        ]);
        assert.equal(code, 0);
        report.teardown = "test process exit confirmed";
        const current = await lstat(fixtureRoot);
        assert.ok(
          current.isDirectory() &&
            !current.isSymbolicLink() &&
            current.ino === fixtureIdentity.ino &&
            (await realpath(fixtureRoot)) === fixtureRoot,
        );
        await rm(fixtureRoot, { recursive: true, force: false });
      } else if (fixtureRoot)
        report.teardown =
          "launch failed; owned temp root retained because process exit unconfirmed";
    } catch (error) {
      fail(String(error));
      report.teardown = "unconfirmed or cleanup failed; temp root retained";
    } finally {
      clearTimeout(timer);
    }
    try {
      const after = await captureProvenance(root, { script: "ui-states" });
      const afterHash = await hash();
      assert.deepEqual(after, before);
      assert.equal(afterHash, beforeHash);
      report.provenance = {
        before,
        after,
        performanceScriptSha256Before: beforeHash,
        performanceScriptSha256After: afterHash,
      };
      if (controlInput)
        await assertPhaseTaskUnchanged(
          options.taskReport,
          phaseIdentity(after, afterHash),
          controlInput.sha256,
        );
    } catch (error) {
      fail(`Provenance: ${String(error)}`);
      report.provenance = { before, performanceScriptSha256Before: beforeHash };
      if (phaseMode) report.phaseDiagnostic.status = "incomplete";
    }
    report.result = report.failures.length
      ? "fail"
      : options.analysis
        ? "diagnostic-only"
        : "pass";
    await writeFile(
      join(destination, "performance-evidence.json"),
      `${JSON.stringify(report, null, 2)}\n`,
      { flag: "wx" },
    );
    await writeFile(
      join(destination, "performance-manifest.json"),
      `${JSON.stringify({ kind: "standalone-performance-not-ui-states", result: report.result, report: "performance-evidence.json", performanceScriptSha256: beforeHash, noFinalGateApproval: true }, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  console.log(
    JSON.stringify({
      result: report.result,
      destination,
      failures: report.failures,
      summary: report.summary,
    }),
  );
  if (report.result !== "pass" && report.result !== "diagnostic-only")
    process.exitCode = 1;
  return report;
}

if (process.argv[1] && resolve(process.argv[1]) === scriptPath)
  await runPerformance();
