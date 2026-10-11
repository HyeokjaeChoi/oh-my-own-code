// Test-only stdio MCP peer. No shell, subprocess, provider or network.
import assert from "node:assert/strict";
import { appendFile, realpath, lstat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { createInterface } from "node:readline";

export function syntheticMcpResponse(message) {
  const invalid = (id, code) => ({
    jsonrpc: "2.0",
    id,
    error: { code, message: "Synthetic MCP request refused" },
  });
  if (
    !message ||
    typeof message !== "object" ||
    message.jsonrpc !== "2.0" ||
    typeof message.method !== "string"
  )
    return invalid(null, -32600);
  if (!Object.hasOwn(message, "id")) return undefined;
  const reply = (result) => ({ jsonrpc: "2.0", id: message.id, result });
  switch (message.method) {
    case "initialize":
      if (typeof message.params?.protocolVersion !== "string")
        return invalid(message.id, -32602);
      // Negotiate the actual client's requested version; only the stable subset below is used.
      return reply({
        protocolVersion: message.params.protocolVersion,
        capabilities: { tools: {} },
        serverInfo: { name: "omoc-synthetic-mcp", version: "1.0.0" },
      });
    case "ping":
      return reply({});
    case "tools/list":
      return reply({
        tools: [
          {
            name: "synthetic_echo",
            description: "Synthetic constant only",
            inputSchema: {
              type: "object",
              properties: {},
              additionalProperties: false,
            },
          },
        ],
      });
    case "tools/call":
      return message.params?.name === "synthetic_echo"
        ? reply({
            content: [{ type: "text", text: "SYNTHETIC_MCP_ONLY" }],
            isError: false,
          })
        : invalid(message.id, -32602);
    default:
      return invalid(message.id, -32601);
  }
}
export async function runSyntheticMcpServer(args = process.argv.slice(2)) {
  assert.equal(args.length, 4);
  assert.equal(args[0], "--startup");
  assert.equal(args[2], "--marker");
  const startup = resolve(args[1]),
    marker = args[3];
  assert.equal(startup, args[1]);
  assert.match(marker, /^[a-zA-Z0-9-]{1,80}$/);
  const directory = dirname(startup);
  assert.equal(await realpath(directory), directory);
  assert.equal((await lstat(directory)).isSymbolicLink(), false);
  // Append one PID/marker per explicit connection; preserve prior attempts.
  try {
    assert.equal((await lstat(startup)).isSymbolicLink(), false);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  await appendFile(
    startup,
    JSON.stringify({ pid: process.pid, marker }) + "\n",
    { mode: 0o600 },
  );
  const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of lines) {
    if (Buffer.byteLength(line) > 65536) {
      process.exitCode = 1;
      lines.close();
      process.stdin.destroy();
      break;
    }
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      message = null;
    }
    const response = syntheticMcpResponse(message);
    if (response) process.stdout.write(JSON.stringify(response) + "\n");
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  runSyntheticMcpServer().catch(() => {
    process.exitCode = 1;
    process.stdin.destroy();
  });
