import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { join, isAbsolute } from "node:path";
import { directorySyncSupported, renameWithRetry } from "../platform-paths.mjs";

const VERSION = 5;
const MAX_BYTES = 16384;
const token = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,256}$/.test(v);
const exact = (v, keys) =>
  v !== null &&
  typeof v === "object" &&
  !Array.isArray(v) &&
  Object.keys(v).length === keys.length &&
  keys.every((k) => Object.hasOwn(v, k));
const identityKeys = ["pid", "platform", "bootId", "startToken"];
function validIdentity(v) {
  return (
    exact(v, identityKeys) &&
    Number.isSafeInteger(v.pid) &&
    v.pid > 0 &&
    ["darwin", "linux", "win32"].includes(v.platform) &&
    token(v.bootId) &&
    token(v.startToken)
  );
}
function sameIdentity(a, b) {
  return (
    validIdentity(a) &&
    validIdentity(b) &&
    identityKeys.every((k) => a[k] === b[k])
  );
}
const ready = () => Object.freeze({ state: "ready" });
const recovery = (reason) =>
  Object.freeze({ state: "recovery_required", reason });
const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
function payload(r) {
  return Object.fromEntries(
    [
      "version",
      "root",
      "rootIdentity",
      "nonce",
      "app",
      "child",
      "spawnIntent",
      "childExitConfirmed",
      "cleanShutdown",
    ].map((k) => [k, r[k]]),
  );
}
function validRecord(r) {
  return (
    exact(r, [...Object.keys(payload({})), "checksum"]) &&
    r.version === VERSION &&
    typeof r.root === "string" &&
    isAbsolute(r.root) &&
    /^[0-9]+:[0-9]+$/.test(r.rootIdentity) &&
    token(r.nonce) &&
    validIdentity(r.app) &&
    (r.child === null ||
      (validIdentity(r.child) &&
        !sameIdentity(r.child, r.app) &&
        r.child.platform === r.app.platform &&
        r.child.bootId === r.app.bootId)) &&
    typeof r.spawnIntent === "boolean" &&
    typeof r.childExitConfirmed === "boolean" &&
    typeof r.cleanShutdown === "boolean" &&
    r.checksum === hash(payload(r)) &&
    (!r.child || r.spawnIntent) &&
    (!r.childExitConfirmed || r.child !== null) &&
    (!r.cleanShutdown ||
      !r.spawnIntent ||
      (r.child !== null && r.childExitConfirmed))
  );
}

/**
 * Production adapter boundary, NOT a portable OS process probe.
 * captureCurrent() -> {pid, platform, bootId, startToken} from an OS-backed probe.
 * inspect(expected) -> {state: 'alive'|'exited'|'unverified'|'identity_conflict',
 *   identity: exact expected identity, evidence: 'os_identity'|'owned_exit'}.
 * 'exited' requires conclusive termination of THAT identity. ESRCH, age,
 * heartbeat, or a replacement process at the same PID are never sufficient.
 * owned_exit must come from the retained child handle's observed exit event.
 * On Linux use boot ID + start ticks and an authoritative lifetime probe;
 * macOS/Windows require native start/boot identity or process-handle adapters.
 * Missing capability/permissions must return unverified. No default PID probe.
 */
export function createProcessVerifier({ captureCurrent, inspect } = {}) {
  return Object.freeze({
    async currentIdentity() {
      try {
        const value = await captureCurrent?.();
        return validIdentity(value) ? Object.freeze({ ...value }) : null;
      } catch {
        return null;
      }
    },
    async verify(expected) {
      if (!validIdentity(expected)) return "unverified";
      try {
        const result = await inspect?.(Object.freeze({ ...expected }));
        if (result?.state === "identity_conflict") return "identity_conflict";
        if (!sameIdentity(result?.identity, expected)) return "unverified";
        if (!["os_identity", "owned_exit"].includes(result.evidence))
          return "unverified";
        if (result.evidence === "owned_exit" && result.state !== "exited")
          return "unverified";
        return ["alive", "exited"].includes(result.state)
          ? result.state
          : "unverified";
      } catch {
        return "unverified";
      }
    },
  });
}

/** Acquire before ephemeral userData overrides, journal or native startup.
 * The Electron singleton belongs to the canonical root used at acquisition.
 * Inject app: this module neither imports Electron nor opens a window/process.
 * Main may synchronously acquire a provisioned canonical root before app.ready,
 * then inject this SAME adapter into async record acquisition. Repeating acquire
 * for the exact held root only checks ownership; it never requests again.
 * Main owns synchronous provisioning/canonicalization and OS identity adapters.
 * One adapter per Electron app. Additional independently rooted owners require
 * separate app processes; Electron's singleton API is process-wide.
 */
export function createElectronOwnerKernel(app) {
  let root = null;
  let held = false;
  return Object.freeze({
    acquire(canonicalRoot) {
      if (root !== null)
        return root === canonicalRoot && held && app.hasSingleInstanceLock();
      if (app.hasSingleInstanceLock()) return false;
      root = canonicalRoot;
      app.setPath("userData", canonicalRoot);
      held = app.requestSingleInstanceLock();
      return held;
    },
    isHeld() {
      return held && app.hasSingleInstanceLock();
    },
    release() {
      if (!held || !app.hasSingleInstanceLock())
        throw new Error("Owner unavailable");
      app.releaseSingleInstanceLock();
      if (app.hasSingleInstanceLock())
        throw new Error("Owner release unconfirmed");
      held = false;
    },
  });
}

/**
 * Host-only API. Every effect must await assertOwned(nonce) in the host lane.
 * acquire({initialize:true}) is only for an explicitly provisioned empty root;
 * missing records in an existing store are NEVER silently recreated.
 * io is node:fs/promises compatible, injectable for synthetic failure tests.
 * Record replacement: flushed guard -> flushed staged record -> rename ->
 * directory sync -> remove guard -> directory sync. An uncertain transaction
 * retains/restores the guard and blocks reopen when storage permits that write.
 * Never truncate/delete failed record bytes.
 * Directory sync failure (including unsupported Windows behavior) fails closed.
 * Flush calls are not a power-loss, hostile same-user, or physical-disk proof.
 * Frozen public handle:
 * status() -> closed v5 store DTO; getNonce() -> string|null (host only).
 * acquire({initialize?:boolean}), assertOwned(nonce), markSpawnIntent(nonce),
 * recordChild(nonce, identity) -> Promise<closed v5 store DTO>.
 * release(nonce) -> Promise<{released:true}|closed recovery-required DTO>.
 * After release, status is owner_unverified; that handle can never write again.
 * Reasons: owner_conflict, owner_unverified, unsupported_version,
 * identity_conflict, writer_poisoned, storage_denied. No paths/raw errors.
 * Retain the acquired nonce for teardown; getNonce returns null when blocked.
 * A premature release blocks effects but permits exit-verified teardown retry.
 * Persist failure is terminal; operator recovery is outside this module.
 */
export function createStorageOwner({
  root,
  kernel,
  processVerifier = createProcessVerifier(),
  lifetimeWitness,
  io = fs,
  nonce = randomUUID,
} = {}) {
  let canonical;
  let rootIdentity;
  let record;
  let ownedNonce = null;
  let acquired = false;
  let attempted = false;
  let released = false;
  let shutdownPending = false;
  let state = recovery("owner_unverified");
  let lane = Promise.resolve();
  const serial = (fn) => {
    const next = lane.then(fn);
    lane = next.catch(() => {});
    return next;
  };
  const block = (reason) => {
    state = recovery(reason);
    return state;
  };
  const file = (name) => join(canonical, name);
  async function syncDirectory() {
    if (!directorySyncSupported()) return;
    const handle = await io.open(canonical, constants.O_RDONLY);
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  async function readRecord() {
    const entry = await io.lstat(file("owner.json"));
    if (!entry.isFile() || entry.isSymbolicLink() || entry.nlink !== 1)
      return { invalid: true };
    const handle = await io.open(
      file("owner.json"),
      constants.O_RDONLY | constants.O_NOFOLLOW,
    );
    try {
      const stat = await handle.stat();
      if (
        !stat.isFile() ||
        stat.nlink !== 1 ||
        stat.dev !== entry.dev ||
        stat.ino !== entry.ino ||
        stat.size > MAX_BYTES ||
        stat.size === 0
      )
        return { invalid: true };
      if (
        process.platform !== "win32" &&
        ((stat.mode & 0o077) !== 0 || stat.uid !== process.getuid())
      )
        return { denied: true };
      const bytes = await handle.readFile("utf8");
      const after = await handle.stat();
      const pathStat = await io.lstat(file("owner.json"));
      if (
        [after, pathStat].some(
          (v) =>
            v.dev !== stat.dev ||
            v.ino !== stat.ino ||
            v.size !== stat.size ||
            v.nlink !== 1 ||
            v.mode !== stat.mode ||
            v.mtimeMs !== stat.mtimeMs ||
            v.ctimeMs !== stat.ctimeMs,
        )
      )
        return { invalid: true };
      try {
        return { value: JSON.parse(bytes) };
      } catch {
        return { invalid: true };
      }
    } finally {
      await handle.close();
    }
  }
  async function exists(name) {
    try {
      await io.lstat(file(name));
      return true;
    } catch (error) {
      if (error.code === "ENOENT") return false;
      throw error;
    }
  }
  async function guard() {
    const handle = await io.open(file("owner.pending"), "wx", 0o600);
    try {
      await handle.writeFile(ownedNonce);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await syncDirectory();
  }
  async function persist(candidate) {
    const next = payload(candidate);
    next.checksum = hash(next);
    try {
      await guard();
      const handle = await io.open(file("owner.next"), "wx", 0o600);
      try {
        await handle.writeFile(`${JSON.stringify(next)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await renameWithRetry(io, file("owner.next"), file("owner.json"));
      await syncDirectory();
      await io.unlink(file("owner.pending"));
      await syncDirectory();
      record = next;
      return ready();
    } catch {
      // Best-effort restore after an uncertain guard-unlink directory sync.
      // If storage itself is unavailable, no code can promise this write works.
      try {
        if (!(await exists("owner.pending"))) await guard();
      } catch {
        /* Keep kernel held and reject all effects. */
      }
      return block("writer_poisoned");
    }
  }
  async function verify(identity) {
    try {
      const result = await processVerifier.verify(
        Object.freeze({ ...identity }),
      );
      return ["alive", "exited", "identity_conflict"].includes(result)
        ? result
        : "unverified";
    } catch {
      return "unverified";
    }
  }
  function witnessContext(owner, role, identity) {
    return Object.freeze({
      root: canonical,
      rootIdentity,
      ownerNonce: owner.nonce,
      role,
      identity: Object.freeze({ ...identity }),
    });
  }
  async function register(owner, role, identity) {
    if (!lifetimeWitness) return true;
    try {
      return (
        (await lifetimeWitness.register(witnessContext(owner, role, identity)))
          ?.state === "ready"
      );
    } catch {
      return false;
    }
  }
  // Awaited attachment must not publish across a lost kernel, moved root, or
  // changed prior owner snapshot. This also covers the previously empty root.
  async function publicationCheck(old) {
    if (!(await kernel.isHeld())) return block("owner_unverified");
    if ((await io.realpath(root)) !== canonical)
      return block("identity_conflict");
    const stat = await io.stat(canonical, { bigint: true });
    if (`${stat.dev}:${stat.ino}` !== rootIdentity)
      return block("identity_conflict");
    if ((await exists("owner.pending")) || (await exists("owner.next")))
      return block("writer_poisoned");
    if (!old)
      return (await exists("owner.json"))
        ? block("identity_conflict")
        : ready();
    const saved = await readRecord();
    if (!validRecord(saved.value) || saved.value.checksum !== old.checksum)
      return block("identity_conflict");
    return ready();
  }
  async function check(n, teardown = false) {
    if (
      state.state !== "ready" &&
      !(teardown && shutdownPending && state.reason === "owner_unverified")
    )
      return state;
    if (released || !acquired || n !== ownedNonce)
      return block("identity_conflict");
    try {
      if (!(await kernel.isHeld())) return block("owner_unverified");
      if ((await io.realpath(root)) !== canonical)
        return block("identity_conflict");
      const stat = await io.stat(canonical, { bigint: true });
      if (`${stat.dev}:${stat.ino}` !== rootIdentity)
        return block("identity_conflict");
      if ((await exists("owner.pending")) || (await exists("owner.next")))
        return block("writer_poisoned");
      const saved = await readRecord();
      if (saved.denied) return block("storage_denied");
      if (saved.value?.version !== undefined && saved.value.version !== VERSION)
        return block("unsupported_version");
      if (!validRecord(saved.value)) return block("owner_unverified");
      if (
        saved.value.nonce !== ownedNonce ||
        saved.value.checksum !== record.checksum
      )
        return block("identity_conflict");
      return ready();
    } catch {
      return block("owner_unverified");
    }
  }
  return Object.freeze({
    status: () => state,
    getNonce: () => (state.state === "ready" && !released ? ownedNonce : null),
    acquire: ({ initialize = false } = {}) =>
      serial(async () => {
        if (attempted) return state;
        attempted = true;
        try {
          if (typeof root !== "string" || !isAbsolute(root))
            return block("storage_denied");
          canonical = await io.realpath(root);
          const stat = await io.stat(canonical, { bigint: true });
          if (
            !stat.isDirectory() ||
            (process.platform !== "win32" && (stat.mode & 0o022n) !== 0n)
          )
            return block("storage_denied");
          rootIdentity = `${stat.dev}:${stat.ino}`;
          if (!(await kernel.acquire(canonical)))
            return block("owner_conflict");
          acquired = true;
          if (!(await kernel.isHeld())) return block("owner_unverified");
          if ((await exists("owner.pending")) || (await exists("owner.next")))
            return block("writer_poisoned");
          let old;
          try {
            const saved = await readRecord();
            if (saved.denied) return block("storage_denied");
            if (
              saved.value?.version !== undefined &&
              saved.value.version !== VERSION
            )
              return block("unsupported_version");
            if (!validRecord(saved.value)) return block("owner_unverified");
            old = saved.value;
          } catch (error) {
            if (error.code !== "ENOENT") return block("storage_denied");
            const allowed = new Set([
              "SingletonLock",
              "SingletonCookie",
              "SingletonSocket",
            ]);
            if (
              !initialize ||
              (await io.readdir(canonical)).some((name) => !allowed.has(name))
            )
              return block("owner_unverified");
          }
          if (old) {
            if (old.root !== canonical || old.rootIdentity !== rootIdentity)
              return block("identity_conflict");
            if (old.spawnIntent && old.child === null)
              return block("owner_unverified");
            const expectedRegistrations = Object.freeze({
              app: Object.freeze({ ...old.app }),
              child: old.child ? Object.freeze({ ...old.child }) : null,
            });
            for (const role of ["app", ...(old.child ? ["child"] : [])]) {
              const prior = old[role];
              let result = await verify(prior);
              if (result === "unverified" && lifetimeWitness) {
                try {
                  result = await lifetimeWitness.verify(
                    Object.freeze({
                      ...witnessContext(old, role, prior),
                      expectedRegistrations,
                    }),
                  );
                } catch {
                  result = "unverified";
                }
              }
              if (result !== "exited")
                return block(
                  result === "identity_conflict"
                    ? "identity_conflict"
                    : "owner_unverified",
                );
            }
          }
          const appIdentity = await processVerifier.currentIdentity();
          if (
            !validIdentity(appIdentity) ||
            (await verify(appIdentity)) !== "alive"
          )
            return block("owner_unverified");
          ownedNonce = nonce();
          if (!token(ownedNonce) || ownedNonce === old?.nonce)
            return block("identity_conflict");
          const candidate = {
            version: VERSION,
            root: canonical,
            rootIdentity,
            nonce: ownedNonce,
            app: { ...appIdentity },
            child: null,
            spawnIntent: false,
            childExitConfirmed: false,
            cleanShutdown: false,
          };
          if (!(await register(candidate, "app", appIdentity)))
            return block("owner_unverified");
          if ((await verify(appIdentity)) !== "alive")
            return block("owner_unverified");
          if ((await publicationCheck(old)).state !== "ready") return state;
          // Do not publish ready before the full durability sequence completes.
          const result = await persist(candidate);
          if (result.reason === "writer_poisoned") return result;
          state = ready();
          return state;
        } catch {
          return block("storage_denied");
        }
      }),
    assertOwned: (n) => serial(() => check(n)),
    markSpawnIntent: (n) =>
      serial(async () => {
        if ((await check(n)).state !== "ready") return state;
        if (record.spawnIntent) return block("owner_unverified");
        return persist({ ...record, spawnIntent: true });
      }),
    recordChild: (n, child) =>
      serial(async () => {
        if ((await check(n)).state !== "ready") return state;
        if (
          !record.spawnIntent ||
          record.child ||
          !validIdentity(child) ||
          sameIdentity(child, record.app) ||
          child.platform !== record.app.platform ||
          child.bootId !== record.app.bootId
        )
          return block("identity_conflict");
        const frozenChild = { ...child };
        const result = await verify(frozenChild);
        if (!["alive", "exited"].includes(result))
          return block(
            result === "identity_conflict"
              ? "identity_conflict"
              : "owner_unverified",
          );
        if (!(await register(record, "child", frozenChild)))
          return block("owner_unverified");
        if ((await check(n)).state !== "ready") return state;
        return persist({ ...record, child: frozenChild });
      }),
    release: (n) =>
      serial(async () => {
        if ((await check(n, true)).state !== "ready") return state;
        if (record.spawnIntent && !record.child)
          return block("owner_unverified");
        if (record.child) {
          const result = await verify(record.child);
          if (result !== "exited") {
            shutdownPending = result !== "identity_conflict";
            return block(
              result === "identity_conflict"
                ? "identity_conflict"
                : "owner_unverified",
            );
          }
        }
        shutdownPending = true;
        if (lifetimeWitness) {
          try {
            if ((await lifetimeWitness.closeRegistration(n))?.state !== "ready")
              return block("owner_unverified");
          } catch {
            return block("owner_unverified");
          }
          if ((await check(n, true)).state !== "ready") return state;
        }
        if (
          (
            await persist({
              ...record,
              childExitConfirmed: record.child !== null,
              cleanShutdown: true,
            })
          ).state !== "ready"
        )
          return state;
        try {
          await kernel.release();
          if (await kernel.isHeld()) return block("owner_unverified");
        } catch {
          return block("owner_unverified");
        }
        released = true;
        ownedNonce = null;
        block("owner_unverified"); // Released handles are permanently non-writable.
        return Object.freeze({ released: true });
      }),
  });
}
