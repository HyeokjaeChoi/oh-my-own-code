import { constants, openSync, closeSync, readFileSync, writeFileSync, writeSync } from "node:fs";
import { spawn } from "node:child_process";
import { createConnection, createServer } from "node:net";

const [input, scratch, outsideRead, outsideWrite, runtime, portText, safeCwd] = process.argv.slice(1);
const port = Number(portText);
const results = {};
const closeSocketBounded = (socket, timeoutMs = 500) => new Promise((resolve) => {
  if (socket.closed === true) return resolve(true);
  const timer = setTimeout(() => resolve(false), timeoutMs);
  socket.once("close", () => { clearTimeout(timer); resolve(true); });
  socket.destroy();
});
const describe = (error) => {
  const call = String(error?.syscall ?? "");
  const syscall = ["open", "read", "write", "listen", "connect", "spawn"].find((name) => call.startsWith(name)) ?? "unknown";
  return { kind: "error", code: String(error?.code ?? "UNKNOWN"), syscall };
};

try {
  results.allowed_read = readFileSync(input, "utf8") === "synthetic-input\n" ? { kind: "allowed" } : { kind: "mismatch" };
} catch (error) {
  results.allowed_read = describe(error);
}

try {
  writeFileSync(scratch, "synthetic-scratch\n", { flag: "wx", mode: 0o600 });
  results.allowed_write = { kind: "allowed" };
} catch (error) {
  results.allowed_write = describe(error);
}

try {
  readFileSync(outsideRead);
  results.outside_read = { kind: "allowed" };
} catch (error) {
  results.outside_read = describe(error);
}

let outsideFd;
try {
  outsideFd = openSync(outsideWrite, constants.O_WRONLY);
  writeSync(outsideFd, Buffer.from("X"), 0, 1, 0);
  results.outside_write = { kind: "allowed" };
} catch (error) {
  results.outside_write = describe(error);
} finally {
  if (outsideFd !== undefined) {
    try { closeSync(outsideFd); } catch { /* the exact owned handle was already closed */ }
  }
}

results.loopback_listen = await new Promise((resolve) => {
  const server = createServer((socket) => socket.destroy());
  let settled = false;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    if (!server.listening) return resolve(value);
    const closeTimer = setTimeout(() => resolve({ kind: "cleanup_error" }), 500);
    server.close((error) => {
      clearTimeout(closeTimer);
      resolve(error ? { kind: "cleanup_error" } : value);
    });
  };
  server.once("error", (error) => finish(describe(error)));
  server.once("listening", () => finish({ kind: "allowed" }));
  const timer = setTimeout(() => finish({ kind: "timeout" }), 1200);
  try { server.listen({ host: "127.0.0.1", port: 0 }); }
  catch (error) { finish(describe(error)); }
});

results.loopback_connect = await new Promise((resolve) => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) return resolve({ kind: "unavailable" });
  let socket;
  try { socket = createConnection({ host: "127.0.0.1", port }); }
  catch (error) { return resolve(describe(error)); }
  let settled = false;
  const finish = async (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    resolve(await closeSocketBounded(socket) ? value : { kind: "cleanup_error" });
  };
  socket.once("error", (error) => finish(describe(error)));
  socket.once("connect", () => finish({ kind: "allowed" }));
  const timer = setTimeout(() => finish({ kind: "timeout" }), 1200);
});

results.child_exec = await new Promise((resolve) => {
  let child;
  let settled = false;
  let spawned = false;
  let timedOut = false;
  let killTimer;
  let timer;
  const finish = (value) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    clearTimeout(killTimer);
    resolve(value);
  };
  const terminateAndWait = () => {
    if (!child?.pid) return finish({ kind: "error", code: "EPERM", syscall: "spawn", target_match: true });
    try { child.kill("SIGKILL"); } catch { /* bounded close wait below */ }
    killTimer = setTimeout(() => finish({ kind: "unreaped" }), 800);
  };
  try {
    child = spawn(runtime, ["--version"], { cwd: safeCwd, env: {}, detached: false, stdio: ["ignore", "ignore", "ignore"], shell: false });
  } catch (error) {
    const result = describe(error);
    return resolve({ ...result, target_match: error?.path === runtime });
  }
  child.once("error", (error) => {
    const result = describe(error);
    finish({ ...result, target_match: error?.path === runtime });
  });
  child.once("spawn", () => { spawned = true; terminateAndWait(); });
  child.once("close", () => {
    if (timedOut) finish({ kind: "timeout" });
    else if (spawned) finish({ kind: "allowed" });
  });
  timer = setTimeout(() => {
    timedOut = true;
    try {
      child.kill("SIGKILL");
    } catch { /* bounded close wait below */ }
    killTimer = setTimeout(() => finish({ kind: "unreaped" }), 800);
  }, 1200);
});

process.stdout.write(`${JSON.stringify({ schema: 1, results })}\n`);
