// Contained synthetic route proof. Never imported by production Main.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as fs from "node:fs/promises";
import { join, relative, isAbsolute } from "node:path";
import {
  NATIVE_SKILLS_RPC,
  nativeSkillId,
  nativeSkillDigest,
} from "../../src/native-skills-protocol.mjs";

// The pinned message endpoint returns a cursor for every nonempty page,
// including its last data page. Only a terminal cursor proves completion.
export async function readNativeSkillHistory(client, sessionID) {
  const rows = [],
    cursors = new Set(),
    ids = new Set();
  let cursor;
  for (let page = 0; page < 16; page++) {
    const result = await client.message.list(
      {
        sessionID,
        type: "skill",
        limit: 64,
        ...(cursor === undefined ? { order: "asc" } : { cursor }),
      },
      { signal: AbortSignal.timeout(10000) },
    );
    assert.ok(result && Array.isArray(result.data) && result.data.length <= 64);
    assert.ok(
      result.cursor &&
        typeof result.cursor === "object" &&
        !Array.isArray(result.cursor),
    );
    for (const row of result.data) {
      assert.ok(
        row &&
          row.type === "skill" &&
          typeof row.id === "string" &&
          row.id.length > 0 &&
          row.id.length <= 256 &&
          !ids.has(row.id),
      );
      assert.ok(
        typeof row.skill === "string" &&
          typeof row.name === "string" &&
          typeof row.text === "string",
      );
      ids.add(row.id);
      rows.push(row);
    }
    const next = result.cursor.next;
    if (next === null || next === undefined) return rows;
    assert.ok(
      typeof next === "string" &&
        next.length > 0 &&
        next.length <= 8192 &&
        ![...next].some(
          (char) =>
            char.charCodeAt(0) < 32 ||
            (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159),
        ) &&
        !cursors.has(next),
    );
    cursors.add(next);
    cursor = next;
  }
  throw new Error("Incomplete bounded Skill history.");
}

export async function runSkillsPrerequisite({ runtime, registry, namespace }) {
  const view = registry.readView();
  const workspace = view.workspaces[0];
  const session = view.sessions.find(
    (row) => row.workspaceId === workspace?.workspaceId,
  );
  assert.ok(workspace && session?.nativeSessionId);
  const root = workspace.canonicalPath;
  const rel = relative(namespace, root);
  assert.ok(rel && !rel.startsWith("..") && !isAbsolute(rel));
  const { client, nativeSkills } = runtime.workbenchContext();
  const counts = { observe: 0, registerDisabled: 0, removeOwned: 0 };
  let nonce;
  // Observe actual inputs without replacing Native outcomes. Authority remains
  // local to this helper and is never serialized in the evidence response.
  const originalRpc = client.rpc;
  client.rpc = (definition) => {
    const rpc = originalRpc(definition);
    if (definition.id !== NATIVE_SKILLS_RPC.id) return rpc;
    return Object.fromEntries(
      Object.keys(counts).map((method) => [
        method,
        (...args) => {
          nonce = args[0].nonce;
          counts[method]++;
          return rpc[method](...args);
        },
      ]),
    );
  };
  const cases = [];
  const pass = (name) => cases.push({ name, result: "pass" });
  const options = () => ({ signal: AbortSignal.timeout(10000) });
  const list = async () => {
    const response = await client.skill.list(
      { location: { directory: root } },
      options(),
    );
    assert.equal(response.location?.directory, root);
    assert.ok(Array.isArray(response.data));
    return response.data;
  };
  const history = () => readNativeSkillHistory(client, session.nativeSessionId);
  let phase = "OBSERVE";
  let assertion = "initial-observation";
  try {
    const observed = await nativeSkills.observe({
      workspaceId: workspace.workspaceId,
      workspacePath: root,
    });
    assert.equal(observed.status, "ready");
    assert.deepEqual(observed.rows, []);
    assert.deepEqual(await list(), observed.native);
    assert.match(nonce, /^[a-f0-9]{64}$/u);
    pass("fixed-directory-plugin-closed-rpc-ready-no-automatic-registration");
    phase = "SECURITY_REFUSALS";
    const beforeHistory = await history();
    const raw = (method, input, directory = root) =>
      originalRpc(
        method === "unknown"
          ? {
              ...NATIVE_SKILLS_RPC,
              methods: { unknown: NATIVE_SKILLS_RPC.methods.observe },
            }
          : NATIVE_SKILLS_RPC,
      )[method](input, { ...options(), location: { directory } });
    await assert.rejects(
      raw("observe", {
        nonce: "0".repeat(64),
        workspaceId: workspace.workspaceId,
        workspacePath: root,
      }),
    );
    await assert.rejects(
      raw("observe", {
        nonce,
        workspaceId: workspace.workspaceId,
        workspacePath: root,
        extra: true,
      }),
    );
    await assert.rejects(
      raw("unknown", {
        nonce,
        workspaceId: workspace.workspaceId,
        workspacePath: root,
      }),
    );
    await assert.rejects(
      raw("observe", {
        nonce,
        workspaceId: workspace.workspaceId,
        workspacePath: join(namespace, "wrong-context"),
      }),
    );
    assert.deepEqual(await list(), observed.native);
    assert.deepEqual(await history(), beforeHistory);
    pass(
      "wrong-nonce-extra-field-unknown-method-cross-location-zero-skill-effect",
    );
    const sourceName = "runtime-proof";
    const file = join(root, ".opencode/skills", sourceName, "SKILL.md");
    const text =
      '---\nname: "Contained Skill"\ndescription: "Synthetic route proof"\nmetadata:\n  opencode/autoinvoke: true\n---\n# Synthetic body\n';
    await fs.mkdir(join(root, ".opencode/skills", sourceName), {
      recursive: true,
      mode: 0o700,
    });
    await fs.writeFile(file, text, { flag: "wx", mode: 0o600 });
    const digest = createHash("sha256").update(text).digest("hex");
    const owner = {
      runtimeEpoch: view.runtimeEpoch,
      operationId: "prerequisite-register",
      workspaceId: workspace.workspaceId,
      workspacePath: root,
      sourceName,
      digest,
    };
    const record = {
      id: nativeSkillId(owner),
      name: "Contained Skill",
      description: "Synthetic route proof",
      autoinvoke: false,
      path: file,
      content: "# Synthetic body\n",
    };
    const recordDigest = nativeSkillDigest(record);
    const request = { owner, record, recordDigest, expectedNativeId: null };
    phase = "REGISTER";
    const registered = await nativeSkills.registerDisabled(request);
    assert.equal(registered.status, "registered_disabled");
    assert.deepEqual(registered.record, record);
    assert.deepEqual(await nativeSkills.registerDisabled(request), registered);
    const current = await nativeSkills.observe({
      workspaceId: workspace.workspaceId,
      workspacePath: root,
    });
    assert.equal(current.status, "ready");
    assert.equal(current.rows.length, 1);
    assert.deepEqual(current.rows[0], { owner, record, recordDigest });
    assert.deepEqual(
      (await list()).find((row) => row.id === record.id),
      record,
    );
    assert.equal(await fs.readFile(file, "utf8"), text);
    assert.deepEqual(await history(), beforeHistory);
    pass(
      "disabled-register-transform-reload-public-list-exact-file-unchanged-original-key-duplicate",
    );
    phase = "SESSION_APPLY";
    await client.session.skill(
      { sessionID: session.nativeSessionId, id: record.id, resume: false },
      options(),
    );
    assertion = "history-after-apply";
    const applied = await history();
    const newMessages = applied.filter(
      (row) => !beforeHistory.some((old) => old.id === row.id),
    );
    assertion = "new-message-count";
    assert.equal(newMessages.length, 1);
    assertion = "new-message-type";
    assert.equal(newMessages[0].type, "skill");
    assertion = "new-message-native-id";
    assert.equal(newMessages[0].skill, record.id);
    assertion = "new-message-name";
    assert.equal(newMessages[0].name, record.name);
    assertion = "new-message-content";
    assert.equal(newMessages[0].text, record.content);
    assertion = "empty-inbox";
    assert.deepEqual(
      await client.session.inbox.list(
        { sessionID: session.nativeSessionId },
        options(),
      ),
      [],
    );
    assertion = "idle-session";
    const active = await client.session.active(options());
    assert.equal(active[session.nativeSessionId], undefined);
    pass(
      "explicit-resume-false-appends-one-exact-native-skill-message-no-inbox",
    );
    const removal = {
      owner: { ...owner, operationId: "prerequisite-remove" },
      registration: owner,
      nativeId: record.id,
      recordDigest,
    };
    phase = "REMOVE";
    const removed = await nativeSkills.removeOwned(removal);
    assert.equal(removed.status, "removed");
    assert.deepEqual(await nativeSkills.removeOwned(removal), removed);
    const after = await nativeSkills.observe({
      workspaceId: workspace.workspaceId,
      workspacePath: root,
    });
    assert.equal(after.status, "ready");
    assert.deepEqual(after.rows, []);
    assert.ok(!(await list()).some((row) => row.id === record.id));
    assert.deepEqual(await history(), applied);
    assert.equal(await fs.readFile(file, "utf8"), text);
    pass("owned-remove-reload-no-session-history-undo-file-unchanged");
    return {
      cases,
      counts,
      nativeId: record.id,
      messageId: newMessages[0].id,
      fileDigest: digest,
      authority:
        "actual-production-supervisor-and-private-plugin; synthetic-direct-preconsumer-route-proof",
    };
  } catch (error) {
    let pluginStates;
    try {
      const result = await client.plugin.list(
        { location: { directory: root } },
        options(),
      );
      if (Array.isArray(result.data))
        pluginStates = result.data.slice(0, 16).map((row) => ({
          id:
            typeof row.id === "string" &&
            /^[a-zA-Z0-9_.-]{1,128}$/u.test(row.id)
              ? row.id
              : "unknown",
          status: row.state?.status === "active" ? "active" : "failed",
          server: row.features?.server === true,
        }));
    } catch {
      /* Never copy raw Native diagnostics or credentials. */
    }
    throw Object.assign(new Error("Contained Skill prerequisite failed."), {
      code: `SKILL_PREREQUISITE_${phase}`,
      skillDiagnostic: {
        phase,
        assertion,
        completedCases: cases,
        ...(pluginStates && { pluginStates }),
        kind:
          typeof error?.type === "string" &&
          /^(?:[A-Za-z]{1,64}|rpc\.(?:unavailable|method_not_found|invalid_input|invalid_output|internal))$/u.test(
            error.type,
          )
            ? error.type
            : error?.code === "ERR_ASSERTION"
              ? "Assertion"
              : "RuntimeError",
        ...(typeof error?.data?.code === "string" &&
          [
            "invalid_context",
            "nonce_mismatch",
            "identity_conflict",
            "retained_limit",
            "collision",
            "changed",
          ].includes(error.data.code) && { refusal: error.data.code }),
      },
    });
  } finally {
    client.rpc = originalRpc;
    nonce = undefined;
  }
}
