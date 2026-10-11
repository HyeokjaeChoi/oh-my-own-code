import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../../..",
);
const child = spawn(process.execPath, ["apps/local-bridge/dist/server.js"], {
  cwd: repositoryRoot,
  env: { ...process.env, BRIDGE_PORT: "0" },
  stdio: ["ignore", "pipe", "pipe"],
});

let stdout = "";
let stderr = "";
child.stdout.setEncoding("utf8");
child.stderr.setEncoding("utf8");
child.stdout.on("data", (chunk) => {
  stdout += chunk;
});
child.stderr.on("data", (chunk) => {
  stderr += chunk;
});

function waitForPort() {
  return new Promise((resolvePort, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`Bridge startup timed out. ${stderr}`)),
      10_000,
    );
    const readPort = () => {
      const match = stdout.match(
        /Synthetic bridge listening on http:\/\/127\.0\.0\.1:(\d+)/,
      );
      if (match) {
        clearTimeout(timeout);
        resolvePort(Number(match[1]));
      }
    };
    child.stdout.on("data", readPort);
    child.once("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timeout);
      reject(new Error(`Compiled bridge exited with code ${code}. ${stderr}`));
    });
    readPort();
  });
}

try {
  const port = await waitForPort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const [health, snapshot, mutation] = await Promise.all([
    fetch(`${baseUrl}/health`),
    fetch(`${baseUrl}/api/snapshot`),
    fetch(`${baseUrl}/api/mutations/message.send`, { method: "POST" }),
  ]);

  assert.equal(health.status, 200);
  assert.deepEqual(await health.json(), {
    status: "ok",
    source: "synthetic-fixture",
  });
  assert.equal(snapshot.status, 200);
  assert.equal((await snapshot.json()).source, "synthetic-fixture");
  assert.equal(mutation.status, 403);
  assert.equal((await mutation.json()).error, "POLICY_DENY");
  process.stdout.write(
    "PASS compiled bridge launch and synthetic HTTP smoke\n",
  );
} finally {
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((resolveExit) =>
      child.once("exit", resolveExit),
    );
    child.kill("SIGTERM");
    await Promise.race([
      exited,
      new Promise((resolveTimeout) => setTimeout(resolveTimeout, 2_000)),
    ]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGKILL");
      await exited;
    }
  }
}
