import { randomUUID, createHash } from "node:crypto";
import { spawn, execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  rm,
  writeFile,
  readFile,
  realpath,
  lstat,
  open,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import {
  delimiter,
  join,
  relative,
  isAbsolute,
  win32 as win32Path,
} from "node:path";
import { OpenCode } from "@opencode/client";
import { directorySyncSupported, killProcessTree } from "./platform-paths.mjs";

export const OPEN_CODE_VERSION = "2.0.18";
// Event host re-verifies its ~35k-file (~485MB) resource tree itself (~14s per
// pass, at least two passes), so startup needs far more than 20s.
const STARTUP_TIMEOUT_MS = 90_000;
const REQUEST_TIMEOUT_MS = 5_000;
const STOP_TIMEOUT_MS = 5_000;
const MAX_STARTUP_OUTPUT = 32 * 1024;

function executableForResources(resourcesPath, platform, arch) {
  const file = platform === "win32" ? "opencode.exe" : "opencode";
  return join(resourcesPath, "opencode", `${platform}-${arch}`, file);
}

export function childEnvironment(
  root,
  platform,
  systemRoot = process.env.SystemRoot,
  namespace,
) {
  const joinProfilePath = platform === "win32" ? win32Path.join : join;
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: namespace?.config ?? join(root, "config"),
    XDG_DATA_HOME: namespace?.data ?? join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: namespace?.state ?? join(root, "state"),
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
    OPENCODE_CONFIG_DIR: join(
      namespace?.config ?? join(root, "config"),
      "opencode",
    ),
    OPENCODE_DISABLE_AUTOUPDATE: "true",
    PATH:
      platform === "win32"
        ? join(systemRoot ?? "C:\\Windows", "System32")
        : ["/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(delimiter),
  };
  if (platform === "win32") {
    env.USERPROFILE = root;
    env.APPDATA = joinProfilePath(root, "AppData", "Roaming");
    env.LOCALAPPDATA = joinProfilePath(root, "AppData", "Local");
    if (systemRoot) env.SystemRoot = systemRoot;
  }
  return env;
}

export function endpointFrom(output) {
  const urlText = output.match(/https?:\/\/127\.0\.0\.1:\d+/)?.[0];
  const password = output.match(/server password\s+(\S+)/i)?.[1];
  if (!urlText || !password) return null;
  const url = new URL(urlText);
  const port = Number(url.port);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !port) {
    return null;
  }
  return { url: url.origin, password };
}

function safeError(error) {
  return error instanceof Error ? error.name : "RuntimeError";
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function startSidecar({
  binaryPath,
  eventHost,
  runtimeEpoch,
  spawnProcess = spawn,
  createDirectory = mkdir,
  writeConfig = writeFile,
  removeRoot = rm,
  makeClient = (baseUrl, password) =>
    OpenCode.make({
      baseUrl,
      fetch: (url, init) => fetch(url, { ...init, redirect: "error" }),
      headers: {
        authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}`,
      },
    }),
  platform = process.platform,
  systemRoot = process.env.SystemRoot,
  startupTimeoutMs = STARTUP_TIMEOUT_MS,
  stopTimeoutMs = STOP_TIMEOUT_MS,
  port = 0,
  signal,
  namespace,
  owner,
  processIdentity,
  preflight,
  onTaskAuthorityLoss,
  onDiagnostic,
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("invalid_sidecar_port");
  }
  if (eventHost !== undefined) {
    const { startEventHost } = await import("./event-host-supervisor.mjs");
    return startEventHost({
      eventHost,
      runtimeEpoch,
      namespace,
      owner,
      processIdentity,
      preflight,
      signal,
      port,
      platform,
      startupTimeoutMs,
      stopTimeoutMs,
      spawnProcess,
      createDirectory,
      writeConfig,
      removeRoot,
      makeClient,
      onTaskAuthorityLoss,
      onDiagnostic,
    });
  }
  const requireOwner = async () => {
    if (!owner || (await owner.assertOwned(owner.getNonce())).state !== "ready")
      throw new Error("owner_unverified");
  };
  if (namespace) {
    await requireOwner();
    if (typeof preflight !== "function" || (await preflight()) !== true)
      throw new Error("native_startup_unverified");
  }
  const root = await mkdtemp(join(tmpdir(), "oh-my-own-code-desktop-"));
  const workspace = join(root, "workspace");

  let child;
  let startupOutput = "";
  let collectingStartupOutput = true;
  let exitResult;
  let resolveExit;
  let cleanupDone = false;
  let stopPromise;
  const exited = new Promise((resolve) => {
    resolveExit = resolve;
  });

  const stopOwnedChild = () => {
    if (cleanupDone) {
      return Promise.resolve({
        exited: true,
        forced: false,
        cleanup: "already_stopped",
      });
    }
    if (stopPromise) return stopPromise;
    stopPromise = (async () => {
      if (child && !exitResult) killProcessTree(child, "SIGTERM", { platform });
      let forced = false;
      if (child && !exitResult) {
        let result = await Promise.race([
          exited,
          delay(stopTimeoutMs).then(() => null),
        ]);
        if (result === null) {
          forced = true;
          killProcessTree(child, "SIGKILL", { platform });
          result = await Promise.race([
            exited,
            delay(stopTimeoutMs).then(() => null),
          ]);
        }
        if (result === null)
          return { exited: false, forced, cleanup: "incomplete" };
      }
      try {
        if (
          namespace &&
          Object.values(namespace).some(
            (path) =>
              typeof path === "string" &&
              isAbsolute(path) &&
              pathsOverlap(root, path),
          )
        )
          throw new Error("disposable_root_overlap");
        await removeRoot(root, { recursive: true, force: false });
        cleanupDone = true;
        return { exited: true, forced, cleanup: "complete" };
      } catch {
        return { exited: true, forced, cleanup: "failed", recoveryPath: root };
      }
    })().finally(() => {
      stopPromise = undefined;
    });
    return stopPromise;
  };

  const throwIfAborted = () => {
    if (signal?.aborted) throw new Error("startup_aborted");
  };

  const requestSignal = () => {
    const timeout = AbortSignal.timeout(REQUEST_TIMEOUT_MS);
    return signal ? AbortSignal.any([signal, timeout]) : timeout;
  };

  try {
    // Finish every setup operation before cleanup can begin on a failed setup.
    const setupDirectories = [
      "config/opencode",
      "data",
      "cache",
      "state",
      "tmp",
      "workspace",
    ];
    if (platform === "win32") {
      setupDirectories.push("AppData/Roaming", "AppData/Local");
    }
    for (const relative of setupDirectories) {
      await createDirectory(join(root, relative), {
        recursive: true,
        mode: 0o700,
      });
    }
    if (namespace) {
      await requireOwner();
      for (const path of [
        namespace.config,
        namespace.data,
        namespace.state,
        join(namespace.config, "opencode"),
      ]) {
        await createDirectory(path, { recursive: true, mode: 0o700 });
        if (
          (await realpath(path)) !== path ||
          (await lstat(path)).isSymbolicLink()
        )
          throw new Error("storage_denied");
      }
    }
    try {
      await writeConfig(
        join(
          namespace?.config ?? join(root, "config"),
          "opencode",
          "opencode.json",
        ),
        "{}\n",
        {
          mode: 0o600,
          flag: "wx",
        },
      );
    } catch (error) {
      if (!namespace || error.code !== "EEXIST") throw error;
      const existing = await lstat(
        join(namespace.config, "opencode", "opencode.json"),
      );
      if (
        !existing.isFile() ||
        existing.isSymbolicLink() ||
        (platform !== "win32" &&
          (existing.uid !== process.getuid() || existing.mode & 0o077))
      )
        throw new Error("storage_denied");
    }
    throwIfAborted();
    if (namespace) {
      await requireOwner();
      const result = await owner.markSpawnIntent(owner.getNonce());
      if (result.state !== "ready") throw new Error(result.reason);
    }
    child = spawnProcess(
      binaryPath,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: workspace,
        env: childEnvironment(root, platform, systemRoot, namespace),
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
    child.once("error", (error) => {
      // A failed spawn has no PID. A later process error (including a failed
      // signal) does not prove that the owned process has exited.
      if (child.pid === undefined) {
        exitResult = { kind: "error", error };
        resolveExit(exitResult);
      }
    });
    child.once("exit", (code, signal) => {
      processIdentity?.observeExit?.(child.pid);
      exitResult = { kind: "exit", code, signal };
      resolveExit(exitResult);
    });
    const collect = (chunk) => {
      if (!collectingStartupOutput) return;
      startupOutput += chunk.toString("utf8");
      if (startupOutput.length > MAX_STARTUP_OUTPUT) {
        killProcessTree(child, "SIGTERM", { platform });
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);
    if (namespace) {
      const identity = await processIdentity?.capture?.(child.pid);
      if (
        !identity ||
        (await owner.recordChild(owner.getNonce(), identity)).state !== "ready"
      )
        throw new Error("owner_unverified");
    }

    const deadline = Date.now() + startupTimeoutMs;
    let endpoint = null;
    while (Date.now() < deadline && !exitResult) {
      throwIfAborted();
      if (startupOutput.length > MAX_STARTUP_OUTPUT)
        throw new Error("startup_output_limit");
      endpoint = endpointFrom(startupOutput);
      if (endpoint) break;
      await delay(50);
    }
    if (!endpoint)
      throw new Error(
        exitResult ? "sidecar_exited_early" : "sidecar_start_timeout",
      );

    collectingStartupOutput = false;
    startupOutput = "";
    const client = makeClient(endpoint.url, endpoint.password);
    const info = await client.server.info({ signal: requestSignal() });
    if (info.pid !== child.pid || info.version !== OPEN_CODE_VERSION) {
      throw new Error("sidecar_identity_mismatch");
    }
    throwIfAborted();
    const session = namespace
      ? undefined
      : await client.session.create(
          {
            title: "임시 데스크톱 작업 공간",
            location: { directory: workspace },
          },
          { signal: requestSignal() },
        );
    throwIfAborted();

    return {
      snapshot() {
        return {
          ...(exitResult
            ? { state: "disconnected" }
            : {
                state: "connected",
                serverVersion: OPEN_CODE_VERSION,
                ...(session && {
                  sessionTitle: "임시 데스크톱 작업 공간",
                  sessionId: session.id,
                }),
              }),
        };
      },
      // Trusted main-process accessor; never included in a renderer snapshot.
      workbenchContext() {
        return { client, session };
      },
      stop: stopOwnedChild,
      processId: child.pid,
      workspace,
    };
  } catch (error) {
    const cleanup = await stopOwnedChild();
    const failure = new Error(
      `OpenCode sidecar unavailable (${safeError(error)})`,
    );
    failure.cleanupComplete = cleanup.exited && cleanup.cleanup === "complete";
    failure.stopOwnedSidecar = stopOwnedChild;
    if (cleanup.recoveryPath) failure.recoveryPath = cleanup.recoveryPath;
    throw failure;
  }
}

export { executableForResources };

function pathsOverlap(a, b) {
  const contains = (parent, child) => {
    const path = relative(parent, child);
    return !path || (!path.startsWith("..") && !isAbsolute(path));
  };
  return contains(a, b) || contains(b, a);
}

// Called only after the canonical store owner is acquired. Validate rather than
// replacing an existing manifest; a mismatched native namespace cannot launch.
export async function openDurableManifest(
  namespace,
  owner,
  { nativeDatabase } = {},
) {
  if ((await owner.assertOwned(owner.getNonce())).state !== "ready")
    throw new Error("owner_unverified");
  const manifestPath = join(namespace.root, "manifest.json");
  const paths = {
    root: namespace.root,
    metadata: namespace.metadata,
    config: namespace.config,
    data: namespace.data,
    state: namespace.state,
  };
  if (nativeDatabase !== undefined) {
    // Bind the selected new backend before launch; never adopt an arbitrary DB.
    if (nativeDatabase !== join(namespace.data, "event-host.sqlite"))
      throw new Error("identity_conflict");
    paths.database = nativeDatabase;
  }
  let manifest;
  try {
    const stat = await lstat(manifestPath);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 16384 ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid() || stat.mode & 0o077))
    )
      throw new Error("identity_conflict");
    manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    if (
      !manifest ||
      Object.keys(manifest).sort().join() !==
        [
          "schemaVersion",
          "storeId",
          "nativeVersion",
          "storageGeneration",
          "paths",
        ]
          .sort()
          .join() ||
      manifest.schemaVersion !== 5 ||
      manifest.nativeVersion !== OPEN_CODE_VERSION ||
      manifest.storageGeneration !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
        manifest.storeId,
      ) ||
      JSON.stringify(manifest.paths) !== JSON.stringify(paths)
    )
      throw new Error("identity_conflict");
  } catch (error) {
    if (error.code !== "ENOENT" || !namespace.fresh) throw error;
    manifest = {
      schemaVersion: 5,
      storeId: randomUUID(),
      nativeVersion: OPEN_CODE_VERSION,
      storageGeneration: 1,
      paths,
    };
    const handle = await open(manifestPath, "wx", 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(manifest)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    if (directorySyncSupported()) {
      const directory = await open(namespace.root, "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  }
  for (const path of [
    namespace.metadata,
    namespace.config,
    namespace.data,
    namespace.state,
  ]) {
    await mkdir(path, { recursive: true, mode: 0o700 });
    const stat = await lstat(path);
    if (
      (await realpath(path)) !== path ||
      !stat.isDirectory() ||
      stat.isSymbolicLink() ||
      (process.platform !== "win32" &&
        (stat.uid !== process.getuid() || stat.mode & 0o077))
    )
      throw new Error("storage_denied");
  }
  return Object.freeze(manifest);
}

const runProbe = (command, args) =>
  new Promise((resolve, reject) =>
    execFile(
      command,
      args,
      {
        timeout: 2000,
        maxBuffer: 16384,
        env:
          process.platform === "win32"
            ? { SystemRoot: process.env.SystemRoot ?? "C:\\Windows" }
            : { PATH: "/usr/bin:/bin:/usr/sbin:/sbin" },
        windowsHide: true,
      },
      (error, stdout) => (error ? reject(error) : resolve(stdout.trim())),
    ),
  );
// Fixed, argument-free PowerShell scripts; pid is validated as a safe integer.
const powershellPath = () =>
  `${process.env.SystemRoot ?? "C:\\Windows"}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
const powershellArgs = (script) => [
  "-NoProfile",
  "-NonInteractive",
  "-ExecutionPolicy",
  "Bypass",
  "-Command",
  script,
];
export const WINDOWS_BOOT_SCRIPT =
  "(Get-CimInstance Win32_OperatingSystem).LastBootUpTime.ToUniversalTime().ToFileTimeUtc()";
// CIM enumerates every process regardless of access rights, so "no row" is an
// authoritative absence (unlike a failed open), and CreationDate is the exact
// kernel creation FILETIME that makes a PID reuse distinguishable.
export const windowsStartScript = (pid) =>
  `$p=Get-CimInstance Win32_Process -Filter "ProcessId = ${Number(pid)}";if($p){$p.CreationDate.ToUniversalTime().ToFileTimeUtc()}else{'ABSENT'}`;
const digestIdentity = (value) =>
  createHash("sha256").update(value).digest("hex");
export function createOSProcessIdentityAdapter({
  platform = process.platform,
  probe = runProbe,
} = {}) {
  const captured = new Map();
  const exits = new Set();
  async function bootId() {
    let value;
    if (platform === "darwin")
      value = await probe("/usr/sbin/sysctl", ["-n", "kern.bootsessionuuid"]);
    if (platform === "win32") {
      // Boot time (FILETIME) stands in for a boot UUID; callers hash it.
      const boot = await probe(
        powershellPath(),
        powershellArgs(WINDOWS_BOOT_SCRIPT),
      );
      if (/^\d{15,19}$/.test(boot)) return boot;
      throw new Error("process_identity_unavailable");
    }
    if (platform === "linux")
      value = (
        await readFile("/proc/sys/kernel/random/boot_id", "utf8")
      ).trim();
    if (
      typeof value === "string" &&
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      return value;
    throw new Error("process_identity_unavailable");
  }
  const ABSENT = Symbol("absent");
  async function sample(pid = process.pid) {
    if (!Number.isSafeInteger(pid) || pid <= 0) return null;
    try {
      let token;
      if (platform === "darwin") {
        // libproc returns kernel birth seconds AND microseconds. ps/PID/random
        // tokens do not supply this proof. Missing system Python fails closed.
        const source =
          'import ctypes,sys\nclass Info(ctypes.Structure):\n _fields_=[("prefix",ctypes.c_uint32*12),("comm",ctypes.c_char*16),("name",ctypes.c_char*32),("nfiles",ctypes.c_uint32),("pgid",ctypes.c_uint32),("pjobc",ctypes.c_uint32),("e_tdev",ctypes.c_uint32),("e_tpgid",ctypes.c_uint32),("nice",ctypes.c_int32),("sec",ctypes.c_uint64),("usec",ctypes.c_uint64)]\nx=Info(); lib=ctypes.CDLL("/usr/lib/libproc.dylib",use_errno=True); n=lib.proc_pidinfo(int(sys.argv[1]),3,0,ctypes.byref(x),ctypes.sizeof(x)); assert n==ctypes.sizeof(x) and x.sec>0; print(str(x.sec)+":"+str(x.usec))';
        token = await probe("/usr/bin/python3", ["-c", source, String(pid)]);
        if (!/^\d+:\d+$/.test(token)) return null;
      } else if (platform === "linux") {
        const stat = await readFile(`/proc/${pid}/stat`, "utf8");
        token = stat.slice(stat.lastIndexOf(")") + 2).split(" ")[19];
        if (!/^\d+$/.test(token)) return null;
      } else if (platform === "win32") {
        token = await probe(
          powershellPath(),
          powershellArgs(windowsStartScript(pid)),
        );
        if (token === "ABSENT") return ABSENT;
        if (!/^\d{15,19}$/.test(token)) return null;
      } else return null;
      const identity = Object.freeze({
        pid,
        platform,
        bootId: digestIdentity(await bootId()),
        startToken: digestIdentity(token),
      });
      return identity;
    } catch {
      return null;
    }
  }
  async function capture(pid = process.pid) {
    const identity = await sample(pid);
    if (identity === ABSENT) return null;
    if (identity) captured.set(pid, identity);
    return identity;
  }
  return Object.freeze({
    capture,
    captureCurrent: () => capture(process.pid),
    observeExit(pid) {
      const identity = captured.get(pid);
      if (identity) exits.add(JSON.stringify(identity));
    },
    async inspect(expected) {
      const identity = expected;
      if (exits.has(JSON.stringify(expected)))
        return { state: "exited", identity, evidence: "owned_exit" };
      try {
        if (
          expected.platform === platform &&
          digestIdentity(await bootId()) !== expected.bootId
        )
          return { state: "exited", identity, evidence: "os_identity" };
        const actual = await sample(expected.pid);
        // Windows: CIM lists every process, so no row (or another creation
        // FILETIME under the same PID within one boot) proves THIS identity is gone.
        if (platform === "win32" && expected.platform === "win32") {
          if (actual === ABSENT)
            return { state: "exited", identity, evidence: "os_identity" };
          if (actual && actual.startToken !== expected.startToken)
            return { state: "exited", identity, evidence: "os_identity" };
        }
        if (!actual || actual === ABSENT) return { state: "unverified" }; // PID absence alone is not exit proof.
        if (JSON.stringify(actual) !== JSON.stringify(expected))
          return { state: "identity_conflict" };
        return { state: "alive", identity, evidence: "os_identity" };
      } catch {
        return { state: "unverified" };
      }
    },
  });
}

// Production has no verified provider-compatible read-only inbox preflight.
// A new, host-provisioned empty namespace is the only admitted native startup.
// Registry idleness is never proof about native SQLite/inbox/execution state.
export function freshNativePreflight(namespace, registry) {
  return (
    namespace?.fresh === true &&
    registry?.status().state === "ready" &&
    registry.readView().retainedOperations.length === 0
  );
}
