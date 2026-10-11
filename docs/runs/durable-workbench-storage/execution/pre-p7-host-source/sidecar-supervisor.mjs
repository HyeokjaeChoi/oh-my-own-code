import { spawn } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { delimiter, join, win32 as win32Path } from "node:path";
import { OpenCode } from "@opencode/client";

const OPEN_CODE_VERSION = "2.0.18";
const STARTUP_TIMEOUT_MS = 20_000;
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
) {
  const joinProfilePath = platform === "win32" ? win32Path.join : join;
  const env = {
    HOME: root,
    XDG_CONFIG_HOME: join(root, "config"),
    XDG_DATA_HOME: join(root, "data"),
    XDG_CACHE_HOME: join(root, "cache"),
    XDG_STATE_HOME: join(root, "state"),
    TMPDIR: join(root, "tmp"),
    TMP: join(root, "tmp"),
    TEMP: join(root, "tmp"),
    OPENCODE_CONFIG_DIR: join(root, "config", "opencode"),
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
  spawnProcess = spawn,
  createDirectory = mkdir,
  writeConfig = writeFile,
  removeRoot = rm,
  makeClient = (baseUrl, password) =>
    OpenCode.make({
      baseUrl,
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
} = {}) {
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error("invalid_sidecar_port");
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
      if (child && !exitResult) child.kill("SIGTERM");
      let forced = false;
      if (child && !exitResult) {
        let result = await Promise.race([
          exited,
          delay(stopTimeoutMs).then(() => null),
        ]);
        if (result === null) {
          forced = true;
          child.kill("SIGKILL");
          result = await Promise.race([
            exited,
            delay(stopTimeoutMs).then(() => null),
          ]);
        }
        if (result === null)
          return { exited: false, forced, cleanup: "incomplete" };
      }
      try {
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
    await writeConfig(
      join(root, "config", "opencode", "opencode.json"),
      "{}\n",
      {
        mode: 0o600,
        flag: "wx",
      },
    );
    throwIfAborted();
    child = spawnProcess(
      binaryPath,
      ["serve", "--hostname", "127.0.0.1", "--port", String(port)],
      {
        cwd: workspace,
        env: childEnvironment(root, platform, systemRoot),
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
      exitResult = { kind: "exit", code, signal };
      resolveExit(exitResult);
    });
    const collect = (chunk) => {
      if (!collectingStartupOutput) return;
      startupOutput += chunk.toString("utf8");
      if (startupOutput.length > MAX_STARTUP_OUTPUT) {
        child.kill("SIGTERM");
      }
    };
    child.stdout.on("data", collect);
    child.stderr.on("data", collect);

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
    const session = await client.session.create(
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
                sessionTitle: "임시 데스크톱 작업 공간",
                sessionId: session.id,
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
