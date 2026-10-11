// Private journal correlation only. Verified metadata is not Native settlement.
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { validWireId } from "../workbench-contract.mjs";
import { permissionCanonicalJSON } from "../permission-control-canonical.mjs";
import {
  permissionGrantDigest,
  permissionSavedRuleDigest,
  permissionPolicyDigest,
} from "../permission-control-digests.mjs";
export const PERMISSION_FEATURE = "permission_control_v1";
const types = {
  "permission.mode.apply": "mode",
  "permission.reply.apply": "reply",
  "permission.remember.apply": "remember",
  "permission.saved.revoke": "revoke",
};
export const PERMISSION_TYPES = Object.freeze(Object.keys(types));
export const PERMISSION_STEPS = Object.freeze(
  [
    "hold",
    "interrupt",
    "cancel_pending",
    "policy",
    "grant",
    "reply",
    "revoke",
    "activate",
  ].map((x) => `native.permission.${x}`),
);
export const isPermissionControl = (type) => Object.hasOwn(types, type);
function need(ok, code = "identity_conflict") {
  if (!ok) {
    const e = new Error(code);
    e.code = code;
    throw e;
  }
}
function exact(v, fields, optional = []) {
  need(v && Object.getPrototypeOf(v) === Object.prototype);
  need(
    fields.every((k) => Object.hasOwn(v, k)) &&
      Reflect.ownKeys(v).every(
        (k) =>
          typeof k === "string" &&
          [...fields, ...optional].includes(k) &&
          Object.hasOwn(Object.getOwnPropertyDescriptor(v, k), "value"),
      ),
  );
}
const uint = (v) => Number.isSafeInteger(v) && v >= 0 && !Object.is(v, -0);
const digest = (v) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
// Runtime owner verifies entropy and ownership; persisted shape uses bridge IDs.
const handle = validWireId;
const list = (v, max) => need(Array.isArray(v) && v.length <= max);
const detach = (v) => JSON.parse(permissionCanonicalJSON(v));
const equal = (a, b) => isDeepStrictEqual(a, b);
function uniqueSorted(rows, identity) {
  let previous;
  for (const row of rows) {
    const current = Buffer.from(permissionCanonicalJSON(identity(row)));
    need(!previous || Buffer.compare(previous, current) < 0);
    previous = current;
  }
}
export function validatePermissionScope(v) {
  if (isPermissionControl(v.type))
    need(validWireId(v.workspaceId) && validWireId(v.sessionId));
}
export function validatePermissionControl(input) {
  const v = detach(input);
  exact(v, [
    "version",
    "mode",
    "modeGeneration",
    "settings",
    "floorDigest",
    "compilerVersion",
    "policyDigest",
  ]);
  need(
    v.version === 1 &&
      v.compilerVersion === 1 &&
      digest(v.floorDigest) &&
      digest(v.policyDigest) &&
      uint(v.modeGeneration) &&
      v.modeGeneration > 0 &&
      ["ask", "read_plan", "scoped_edit", "custom"].includes(v.mode),
  );
  // This persisted subset has no Agent/inventory/rules inputs. Validate shape
  // only; it cannot establish the policy hash or actual Native readback.
  list(v.settings, 256);
  uniqueSorted(v.settings, (s) => s.capabilityId);
  for (const setting of v.settings) {
    exact(setting, ["capabilityId", "effect"]);
    need(
      validWireId(setting.capabilityId) &&
        ["deny", "ask", "allow"].includes(setting.effect),
    );
  }
  need(v.mode === "custom" || v.settings.length === 0);
  return v;
}
export function permissionControlFromBinding(after) {
  const body = detach(after);
  const policyDigest = permissionPolicyDigest(body);
  return {
    version: 1,
    mode: body.mode,
    modeGeneration: body.modeGeneration,
    settings: body.settings,
    floorDigest: body.floorDigest,
    compilerVersion: body.compilerVersion,
    policyDigest,
  };
}
export function validatePermissionTarget(input, type) {
  const v = detach(input);
  exact(v, [
    "version",
    "kind",
    "previewId",
    "previewDigest",
    "scopeDigest",
    "projectIdentityDigest",
    "generations",
    "targets",
    "plan",
    "ruleBindings",
    "policyBindings",
  ]);
  need(
    v.version === 1 &&
      v.kind === types[type] &&
      handle(v.previewId) &&
      digest(v.previewDigest) &&
      digest(v.scopeDigest) &&
      digest(v.projectIdentityDigest),
  );
  exact(v.generations, [
    "control",
    "inventory",
    "pending",
    "saved",
    "locations",
  ]);
  need(Object.values(v.generations).every((x) => uint(x) && x > 0));
  // Each branch has at most 1024 sessions/grants plus 1024 pending and one project.
  list(v.targets, 1024 + 1024 + 1);
  list(v.plan, 8192);
  list(v.ruleBindings, 1024);
  list(v.policyBindings, 1024);
  need(v.targets.length > 0 && v.plan.length >= 2);
  const byKind = (kind) => v.targets.filter((t) => t.kind === kind);
  for (const t of v.targets) {
    switch (t.kind) {
      case "project":
        exact(t, ["kind", "scopeDigest"]);
        need(t.scopeDigest === v.scopeDigest);
        break;
      case "session":
        exact(t, [
          "kind",
          "workspaceId",
          "sessionId",
          "beforePolicyDigest",
          "afterPolicyDigest",
        ]);
        need(
          validWireId(t.workspaceId) &&
            validWireId(t.sessionId) &&
            digest(t.beforePolicyDigest) &&
            digest(t.afterPolicyDigest),
        );
        break;
      case "pending":
        exact(t, [
          "kind",
          "workspaceId",
          "sessionId",
          "locationId",
          "permissionId",
          "requestDigest",
          "resolution",
        ]);
        need(
          validWireId(t.workspaceId) &&
            validWireId(t.sessionId) &&
            handle(t.locationId) &&
            validWireId(t.permissionId) &&
            digest(t.requestDigest) &&
            ["once", "reject"].includes(t.resolution),
        );
        break;
      case "grant":
        exact(t, ["kind", "grantDigest"], ["existingSaved"]);
        need(digest(t.grantDigest));
        if (Object.hasOwn(t, "existingSaved")) {
          exact(t.existingSaved, ["savedId", "ruleDigest"]);
          need(
            validWireId(t.existingSaved.savedId) &&
              digest(t.existingSaved.ruleDigest),
          );
        }
        break;
      case "saved":
        exact(t, ["kind", "savedId", "ruleDigest"]);
        need(validWireId(t.savedId) && digest(t.ruleDigest));
        break;
      default:
        need(false);
    }
  }
  need(
    byKind("project").length === 1 &&
      byKind("session").length <= 1024 &&
      byKind("pending").length <= 1024 &&
      byKind("grant").length <= 1024,
  );
  const identities = v.targets.map((t) =>
    permissionCanonicalJSON(
      t.kind === "session"
        ? [t.kind, t.workspaceId, t.sessionId]
        : t.kind === "pending"
          ? [t.kind, t.locationId, t.sessionId, t.permissionId]
          : [t.kind, t.grantDigest ?? t.savedId ?? t.scopeDigest],
    ),
  );
  need(new Set(identities).size === identities.length);
  if (v.kind === "mode")
    need(
      byKind("session").length > 0 &&
        !byKind("grant").length &&
        !byKind("saved").length &&
        byKind("pending").every((t) => t.resolution === "reject"),
    );
  if (v.kind === "reply")
    need(
      byKind("pending").length > 0 &&
        !byKind("session").length &&
        !byKind("grant").length &&
        !byKind("saved").length &&
        new Set(byKind("pending").map((t) => t.resolution)).size === 1 &&
        (byKind("pending")[0].resolution !== "once" ||
          byKind("pending").length === 1),
    );
  if (v.kind === "remember")
    need(
      byKind("grant").length > 0 &&
        byKind("pending").length > 0 &&
        !byKind("session").length &&
        !byKind("saved").length &&
        byKind("pending").every((t) => t.resolution === "once"),
    );
  if (v.kind === "revoke")
    need(
      byKind("saved").length === 1 &&
        !byKind("session").length &&
        !byKind("grant").length &&
        !byKind("pending").length,
    );
  for (const b of v.ruleBindings) {
    exact(b, ["grantDigest", "action", "resource"]);
    need(
      b.grantDigest ===
        permissionGrantDigest({
          projectIdentityDigest: v.projectIdentityDigest,
          action: b.action,
          resource: b.resource,
          effect: "allow",
        }),
    );
  }
  uniqueSorted(v.ruleBindings, (b) => [b.action, b.resource]);
  need(
    new Set(v.ruleBindings.map((b) => b.grantDigest)).size ===
      v.ruleBindings.length,
  );
  if (v.kind === "revoke") need(v.ruleBindings.length === 1);
  else
    need(
      v.ruleBindings.length === byKind("grant").length &&
        byKind("grant").every((t) =>
          v.ruleBindings.some((b) => b.grantDigest === t.grantDigest),
        ),
    );
  const sessionIndexes = v.targets.flatMap((t, i) =>
    t.kind === "session" ? [i] : [],
  );
  need(
    v.policyBindings.length === (v.kind === "mode" ? sessionIndexes.length : 0),
  );
  v.policyBindings.forEach((b, i) => {
    exact(b, ["targetIndex", "after"]);
    need(b.targetIndex === sessionIndexes[i]);
    need(
      permissionPolicyDigest(b.after) ===
        v.targets[b.targetIndex].afterPolicyDigest,
    );
  });
  const seen = new Set();
  v.plan.forEach((slot, i) => {
    exact(slot, ["ordinal", "step", "targetIndex"]);
    need(
      slot.ordinal === i &&
        uint(slot.targetIndex) &&
        slot.targetIndex < v.targets.length &&
        PERMISSION_STEPS.includes(slot.step),
    );
    const t = v.targets[slot.targetIndex];
    const step = slot.step.slice("native.permission.".length);
    need(
      i === 0
        ? step === "hold" && t.kind === "project"
        : i === v.plan.length - 1
          ? step === "activate" && t.kind === "project"
          : !["hold", "activate"].includes(step),
    );
    const allowed = {
      interrupt: ["mode", "session"],
      cancel_pending: ["mode", "pending"],
      policy: ["mode", "session"],
      grant: ["remember", "grant"],
      revoke: ["revoke", "saved"],
    };
    if (allowed[step])
      need(v.kind === allowed[step][0] && t.kind === allowed[step][1]);
    if (step === "reply")
      need(
        ["remember", "reply"].includes(v.kind) &&
          t.kind === "pending" &&
          (v.kind !== "remember" ||
            byKind("grant").every(
              (g) =>
                v.plan.findIndex(
                  (s) =>
                    s.step === "native.permission.grant" &&
                    v.targets[s.targetIndex] === g,
                ) < i,
            )),
      );
    if (step === "grant")
      need(
        !v.plan.slice(0, i).some((s) => s.step === "native.permission.reply"),
      );
    const key = permissionCanonicalJSON([step, slot.targetIndex]);
    seen.add(key);
  });
  for (const [i, t] of v.targets.entries()) {
    const step = {
      pending: v.kind === "mode" ? "cancel_pending" : "reply",
      grant: "grant",
      saved: "revoke",
    }[t.kind];
    if (step) need(seen.has(permissionCanonicalJSON([step, i])));
    if (t.kind === "session" && t.beforePolicyDigest !== t.afterPolicyDigest)
      need(seen.has(permissionCanonicalJSON(["policy", i])));
  }
  return v;
}
export function validatePermissionAdmission(v, sessions) {
  if (!isPermissionControl(v.identity.type)) {
    need(!Object.hasOwn(v, "permissionTarget"));
    return;
  }
  validatePermissionScope(v.identity);
  const target = validatePermissionTarget(v.permissionTarget, v.identity.type);
  if (target.kind !== "revoke")
    need(
      target.targets.some(
        (t) =>
          t.kind === (target.kind === "mode" ? "session" : "pending") &&
          t.workspaceId === v.identity.workspaceId &&
          t.sessionId === v.identity.sessionId,
      ),
    );
  for (const name of [
    "inboxTarget",
    "forkTarget",
    "fileTarget",
    "gitBranchRestoreTarget",
    "gitCommitTarget",
    "gitIndexTarget",
    "agentRuntime",
    "skillRuntime",
    "nativeServerName",
    "agentSourceName",
    "skillSourceName",
  ])
    need(!Object.hasOwn(v, name));
  if (sessions && target.kind === "mode")
    for (const t of target.targets.filter((t) => t.kind === "session")) {
      const session = sessions.get(t.sessionId);
      need(
        session &&
          session.workspaceId === t.workspaceId &&
          session.permissionControl?.policyDigest === t.beforePolicyDigest,
        "POLICY_UNVERIFIED",
      );
    }
  return target;
}
export function validatePermissionDispatchPayload(v) {
  const stepField = Object.getOwnPropertyDescriptor(v ?? {}, "step");
  need(stepField && Object.hasOwn(stepField, "value"));
  const permission = PERMISSION_STEPS.includes(stepField.value);
  need(permission === Object.hasOwn(v, "permissionEffect"));
  if (!permission) return;
  v = detach(v);
  exact(
    v,
    ["runtimeEpoch", "operationId", "step", "permissionEffect"],
    ["kind", "revision"],
  );
  need(validWireId(v.runtimeEpoch) && validWireId(v.operationId));
  if (Object.hasOwn(v, "kind")) need(v.kind === "dispatch");
  if (Object.hasOwn(v, "revision")) need(uint(v.revision) && v.revision > 0);
  const e = detach(v.permissionEffect);
  exact(e, ["ordinal", "targetIndex", "previewDigest"]);
  need(
    uint(e.ordinal) &&
      e.ordinal < 8192 &&
      uint(e.targetIndex) &&
      digest(e.previewDigest),
  );
  need(
    Object.keys(v).every((k) =>
      [
        "kind",
        "revision",
        "runtimeEpoch",
        "operationId",
        "step",
        "permissionEffect",
      ].includes(k),
    ),
  );
}
export function validatePermissionDispatch(op, v) {
  if (!isPermissionControl(op.identity.type)) {
    need(
      !Object.hasOwn(v, "permissionEffect") &&
        !PERMISSION_STEPS.includes(v.step),
    );
    return;
  }
  validatePermissionDispatchPayload(v);
  need(
    v.runtimeEpoch === op.identity.runtimeEpoch &&
      v.operationId === op.identity.operationId,
  );
  const slot = op.permissionTarget.plan[op.dispatches.length];
  need(
    !op.completedDelta &&
      slot &&
      equal(v.permissionEffect, {
        ordinal: slot.ordinal,
        targetIndex: slot.targetIndex,
        previewDigest: op.permissionTarget.previewDigest,
      }) &&
      v.step === slot.step,
  );
  if (op.dispatches.length)
    need(
      op.permissionProgress?.length === op.dispatches.length &&
        op.permissionProgress.every((p) => p.outcome === "verified"),
    );
}
export function validatePermissionProgressPayload(input) {
  const v = detach(input);
  exact(v, [
    "kind",
    "runtimeEpoch",
    "operationId",
    "ordinal",
    "outcome",
    "observation",
  ]);
  need(
    v.kind === "permission_progress" &&
      validWireId(v.runtimeEpoch) &&
      validWireId(v.operationId) &&
      uint(v.ordinal) &&
      v.ordinal < 8192 &&
      ["verified", "unverified"].includes(v.outcome),
  );
  const o = v.observation;
  if (o.kind === "state") {
    exact(o, ["kind", "stateDigest"]);
    need(digest(o.stateDigest));
  } else {
    exact(o, [
      "kind",
      "grantDigest",
      "savedId",
      "ruleDigest",
      "createdAt",
      "updatedAt",
    ]);
    need(
      o.kind === "grant" &&
        v.outcome === "verified" &&
        digest(o.grantDigest) &&
        validWireId(o.savedId) &&
        digest(o.ruleDigest) &&
        uint(o.createdAt) &&
        uint(o.updatedAt),
    );
  }
  return v;
}
export function validatePermissionProgress(op, v) {
  validatePermissionProgressPayload(v);
  need(
    v.runtimeEpoch === op.identity.runtimeEpoch &&
      v.operationId === op.identity.operationId,
  );
  need(
    isPermissionControl(op.identity.type) &&
      !op.completedDelta &&
      v.ordinal === op.permissionProgress.length &&
      v.ordinal === op.dispatches.length - 1,
  );
  const slot = op.permissionTarget.plan[v.ordinal];
  need(slot && op.dispatches[v.ordinal]);
  const t = op.permissionTarget.targets[slot.targetIndex],
    o = v.observation;
  if (slot.step === "native.permission.grant" && v.outcome === "verified") {
    need(o.kind === "grant" && o.grantDigest === t.grantDigest);
    const b = op.permissionTarget.ruleBindings.find(
      (b) => b.grantDigest === t.grantDigest,
    );
    need(
      o.ruleDigest ===
        permissionSavedRuleDigest({
          projectIdentityDigest: op.permissionTarget.projectIdentityDigest,
          savedId: o.savedId,
          action: b.action,
          resource: b.resource,
          effect: "allow",
          createdAt: o.createdAt,
          updatedAt: o.updatedAt,
        }),
    );
    if (Object.hasOwn(t, "existingSaved"))
      need(
        t.existingSaved.savedId === o.savedId &&
          t.existingSaved.ruleDigest === o.ruleDigest,
      );
  } else need(o.kind === "state");
}
const metadataDigest = (domain, body) =>
  createHash("sha256")
    .update(`omoc.permission.${domain}.v1\n`)
    .update(permissionCanonicalJSON(body))
    .digest("hex");
export function permissionPartialOutcomes(op) {
  return op.dispatches.map((d, ordinal) => {
    const slot = op.permissionTarget.plan[ordinal],
      p = op.permissionProgress[ordinal];
    return {
      ordinal,
      targetIndex: slot.targetIndex,
      state: p?.outcome === "verified" ? "verified" : "unknown",
      stateDigest:
        p?.outcome === "verified"
          ? p.observation.kind === "state"
            ? p.observation.stateDigest
            : metadataDigest("progress", p.observation)
          : metadataDigest("slot", {
              runtimeEpoch: op.identity.runtimeEpoch,
              operationId: op.identity.operationId,
              previewDigest: op.permissionTarget.previewDigest,
              ...slot,
            }),
    };
  });
}
const commonResult = [
  "kind",
  "workspaceId",
  "sessionId",
  "previewDigest",
  "scopeDigest",
  "digest",
];
export const PERMISSION_RESULT_FIELDS = Object.freeze(
  Object.fromEntries(
    Object.entries({
      permission_mode_applied: [...commonResult, "changes"],
      permission_replied: [...commonResult, "decision", "resolved"],
      permission_remembered: [...commonResult, "saved", "resolved"],
      permission_revoked: [...commonResult, "absentSavedId", "ruleDigest"],
      permission_partial: [...commonResult, "outcomes", "hold"],
    }).map(([kind, fields]) => [kind, Object.freeze(fields)]),
  ),
);
export function validatePermissionReceipt(v) {
  if (!isPermissionControl(v.type)) {
    need(!Object.hasOwn(PERMISSION_RESULT_FIELDS, v.result?.kind));
    return;
  }
  validatePermissionScope(v);
  if (!v.result) {
    need(v.effect !== "confirmed");
    return;
  }
  const r = detach(v.result);
  if (r.kind === "rejected") {
    need(
      v.admission === "rejected" &&
        v.effect === "none" &&
        v.delivery === "accepted",
    );
    return;
  }
  need(Object.hasOwn(PERMISSION_RESULT_FIELDS, r.kind));
  exact(r, PERMISSION_RESULT_FIELDS[r.kind]);
  need(
    r.workspaceId === v.workspaceId &&
      r.sessionId === v.sessionId &&
      digest(r.previewDigest) &&
      digest(r.scopeDigest) &&
      digest(r.digest),
  );
  if (r.kind === "permission_partial") {
    need(
      v.delivery === "unknown" &&
        v.effect === "unknown" &&
        r.hold === "project",
    );
    list(r.outcomes, 8192);
    r.outcomes.forEach((o, i) => {
      exact(o, ["ordinal", "targetIndex", "state", "stateDigest"]);
      need(
        o.ordinal === i &&
          uint(o.targetIndex) &&
          ["verified", "unknown"].includes(o.state) &&
          digest(o.stateDigest),
      );
    });
    return;
  }
  need(
    v.admission === "dispatched" &&
      v.delivery === "accepted" &&
      v.effect === "confirmed" &&
      r.kind ===
        {
          mode: "permission_mode_applied",
          reply: "permission_replied",
          remember: "permission_remembered",
          revoke: "permission_revoked",
        }[types[v.type]],
  );
  if (r.changes) {
    list(r.changes, 1024);
    uniqueSorted(r.changes, (x) => [x.workspaceId, x.sessionId]);
    for (const c of r.changes) {
      exact(c, [
        "workspaceId",
        "sessionId",
        "mode",
        "modeGeneration",
        "policyDigest",
      ]);
      need(
        validWireId(c.workspaceId) &&
          validWireId(c.sessionId) &&
          ["ask", "read_plan", "scoped_edit", "custom"].includes(c.mode) &&
          uint(c.modeGeneration) &&
          c.modeGeneration > 0 &&
          digest(c.policyDigest),
      );
    }
  }
  if (r.resolved) {
    list(r.resolved, 1024);
    uniqueSorted(r.resolved, (x) => [
      x.locationId,
      x.sessionId,
      x.permissionId,
    ]);
    for (const c of r.resolved) {
      exact(c, ["locationId", "sessionId", "permissionId"]);
      need(
        handle(c.locationId) &&
          validWireId(c.sessionId) &&
          validWireId(c.permissionId),
      );
    }
  }
  if (r.kind === "permission_replied")
    need(["once", "reject"].includes(r.decision));
  if (r.saved) {
    list(r.saved, 1024);
    need(new Set(r.saved.map((s) => s.grantDigest)).size === r.saved.length);
    for (const s of r.saved) {
      exact(s, ["grantDigest", "savedId", "ruleDigest"]);
      need(
        digest(s.grantDigest) && validWireId(s.savedId) && digest(s.ruleDigest),
      );
    }
  }
  if (r.kind === "permission_revoked")
    need(validWireId(r.absentSavedId) && digest(r.ruleDigest));
}
function savedGrantResults(operation) {
  return operation.permissionTarget.targets
    .filter((t) => t.kind === "grant")
    .map((target) => {
      const progress = operation.permissionProgress.findLast(
        (p) =>
          p.outcome === "verified" &&
          p.observation.kind === "grant" &&
          p.observation.grantDigest === target.grantDigest,
      );
      need(progress);
      const o = progress.observation;
      return {
        grantDigest: o.grantDigest,
        savedId: o.savedId,
        ruleDigest: o.ruleDigest,
      };
    });
}
export function validatePermissionCompletion(op, payload, sessions) {
  const { receipt: r, delta } = payload;
  if (!isPermissionControl(op.identity.type)) {
    for (const s of delta.sessions)
      need(
        equal(
          s.permissionControl,
          sessions.get(s.appSessionId)?.permissionControl,
        ),
      );
    return;
  }
  validatePermissionReceipt(r);
  for (const field of [
    "runtimeEpoch",
    "operationId",
    "type",
    "workspaceId",
    "sessionId",
  ])
    need(r[field] === op.identity[field]);
  const t = op.permissionTarget,
    result = r.result;
  need(
    !op.completedDelta && !delta.workspaces.length && !delta.tombstones.length,
  );
  need(op.permissionProgress.length <= op.dispatches.length);
  for (const [ordinal, progress] of op.permissionProgress.entries()) {
    validatePermissionProgress(
      {
        ...op,
        dispatches: op.dispatches.slice(0, ordinal + 1),
        permissionProgress: op.permissionProgress.slice(0, ordinal),
      },
      progress,
    );
  }
  if (result && result.kind !== "rejected")
    need(
      result.digest === op.identity.digest &&
        result.previewDigest === t.previewDigest &&
        result.scopeDigest === t.scopeDigest,
    );
  if (r.effect !== "confirmed") {
    need(!delta.sessions.length);
    if (op.dispatches.length)
      need(
        r.effect === "unknown" &&
          r.delivery === "unknown" &&
          r.admission === "dispatched" &&
          (!result ||
            (result.kind === "permission_partial" &&
              equal(result.outcomes, permissionPartialOutcomes(op)))),
      );
    else need(!result || result.kind === "rejected");
    return;
  }
  need(
    op.dispatches.length === t.plan.length &&
      op.permissionProgress.length === t.plan.length &&
      op.permissionProgress.every((p) => p.outcome === "verified"),
  );
  const targets = (kind) => t.targets.filter((x) => x.kind === kind);
  const resolved = targets("pending")
    .map((x) => ({
      locationId: x.locationId,
      sessionId: x.sessionId,
      permissionId: x.permissionId,
    }))
    .sort((a, b) =>
      Buffer.compare(
        Buffer.from(
          permissionCanonicalJSON([a.locationId, a.sessionId, a.permissionId]),
        ),
        Buffer.from(
          permissionCanonicalJSON([b.locationId, b.sessionId, b.permissionId]),
        ),
      ),
    );
  if (t.kind === "mode") {
    const changes = t.policyBindings
      .map((b) => {
        const s = t.targets[b.targetIndex],
          a = b.after;
        return {
          workspaceId: s.workspaceId,
          sessionId: s.sessionId,
          mode: a.mode,
          modeGeneration: a.modeGeneration,
          policyDigest: permissionPolicyDigest(a),
        };
      })
      .sort((a, b) =>
        Buffer.compare(
          Buffer.from(permissionCanonicalJSON([a.workspaceId, a.sessionId])),
          Buffer.from(permissionCanonicalJSON([b.workspaceId, b.sessionId])),
        ),
      );
    need(
      equal(result.changes, changes) &&
        delta.sessions.length === changes.length,
    );
    for (const b of t.policyBindings) {
      const target = t.targets[b.targetIndex],
        old = sessions.get(target.sessionId),
        updated = delta.sessions.find(
          (s) => s.appSessionId === target.sessionId,
        );
      need(
        old &&
          old.permissionControl?.policyDigest === target.beforePolicyDigest &&
          updated &&
          equal(
            updated.permissionControl,
            permissionControlFromBinding(b.after),
          ),
      );
      const { revision: _old, ...before } = old;
      const { revision: _new, ...after } = updated;
      need(
        equal(
          {
            ...before,
            permissionControl: permissionControlFromBinding(b.after),
          },
          after,
        ),
      );
    }
  } else need(!delta.sessions.length);
  if (t.kind === "reply")
    need(
      result.decision === targets("pending")[0].resolution &&
        equal(result.resolved, resolved),
    );
  if (t.kind === "remember") {
    need(equal(result.resolved, resolved));
    const saved = savedGrantResults(op);
    need(
      saved.length === targets("grant").length && equal(result.saved, saved),
    );
  }
  if (t.kind === "revoke")
    need(
      result.absentSavedId === targets("saved")[0].savedId &&
        result.ruleDigest === targets("saved")[0].ruleDigest,
    );
}
function correlatedProgress(record, target) {
  const dispatches = detach(record.dispatches),
    progress = detach(record.permissionProgress);
  list(dispatches, target.plan.length);
  list(progress, dispatches.length);
  const operation = {
    identity: record,
    permissionTarget: target,
    dispatches: [],
    permissionProgress: [],
  };
  for (const [ordinal, dispatch] of dispatches.entries()) {
    validatePermissionDispatch(operation, dispatch);
    operation.dispatches.push(dispatch);
    if (progress[ordinal]) {
      validatePermissionProgress(operation, progress[ordinal]);
      operation.permissionProgress.push(progress[ordinal]);
    }
  }
  return operation;
}
export function validPermissionResult(record, target, digestValue) {
  try {
    validatePermissionReceipt(record);
    if (!record.result || record.result.kind === "rejected") return false;
    validatePermissionTarget(target, record.type);
    need(
      record.result.digest === digestValue &&
        record.result.previewDigest === target.previewDigest &&
        record.result.scopeDigest === target.scopeDigest,
    );
    const r = record.result,
      targets = (kind) => target.targets.filter((t) => t.kind === kind);
    if (r.kind === "permission_partial") {
      const correlation = correlatedProgress(record, target);
      need(equal(r.outcomes, permissionPartialOutcomes(correlation)));
    }
    if (r.kind === "permission_mode_applied") {
      const expected = target.policyBindings.map((b) => {
        const t = target.targets[b.targetIndex];
        return {
          workspaceId: t.workspaceId,
          sessionId: t.sessionId,
          mode: b.after.mode,
          modeGeneration: b.after.modeGeneration,
          policyDigest: permissionPolicyDigest(b.after),
        };
      });
      expected.sort((a, b) =>
        Buffer.compare(
          Buffer.from(permissionCanonicalJSON([a.workspaceId, a.sessionId])),
          Buffer.from(permissionCanonicalJSON([b.workspaceId, b.sessionId])),
        ),
      );
      need(equal(r.changes, expected));
    }
    if (r.resolved) {
      const expected = targets("pending")
        .map((t) => ({
          locationId: t.locationId,
          sessionId: t.sessionId,
          permissionId: t.permissionId,
        }))
        .sort((a, b) =>
          Buffer.compare(
            Buffer.from(
              permissionCanonicalJSON([
                a.locationId,
                a.sessionId,
                a.permissionId,
              ]),
            ),
            Buffer.from(
              permissionCanonicalJSON([
                b.locationId,
                b.sessionId,
                b.permissionId,
              ]),
            ),
          ),
        );
      need(equal(r.resolved, expected));
    }
    if (r.kind === "permission_replied")
      need(r.decision === targets("pending")[0].resolution);
    if (r.kind === "permission_remembered") {
      need(record.permissionProgress && record.dispatches);
      const correlation = correlatedProgress(record, target);
      need(
        correlation.permissionProgress.length === target.plan.length &&
          correlation.permissionProgress.every((p) => p.outcome === "verified"),
      );
      const saved = savedGrantResults(correlation);
      need(saved.length === targets("grant").length && equal(r.saved, saved));
    }
    if (r.kind === "permission_revoked")
      need(
        r.absentSavedId === targets("saved")[0].savedId &&
          r.ruleDigest === targets("saved")[0].ruleDigest,
      );
    return true;
  } catch {
    return false;
  }
}
