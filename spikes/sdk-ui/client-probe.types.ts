import { OpenCode, type ServerInfo } from "@opencode/client";

const injectedFetch: typeof globalThis.fetch = async (input, init) => {
  const url = input instanceof Request ? input.url : input.toString();
  const method = init?.method ?? (input instanceof Request ? input.method : "GET");
  const body = init?.body ?? (input instanceof Request ? input.body : undefined);

  if (
    url !== "https://synthetic.invalid/api/info" ||
    method !== "GET" ||
    (body !== undefined && body !== null)
  ) {
    throw new Error("Unexpected request shape in compile-only probe");
  }

  const syntheticInfo: ServerInfo = {
    version: "synthetic-v2",
    pid: 1,
    urls: [],
    paths: { tmp: "/synthetic" },
  };

  return new Response(JSON.stringify(syntheticInfo), {
    headers: { "content-type": "application/json" },
  });
};

const client = OpenCode.make({ baseUrl: "https://synthetic.invalid", fetch: injectedFetch });
const serverInfo: Promise<ServerInfo> = client.server.info();
void serverInfo;
