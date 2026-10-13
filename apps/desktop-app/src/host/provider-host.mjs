import { renameReplacing } from "../platform-paths.mjs";
import { randomBytes } from "node:crypto";
import { readFile, rm, writeFile } from "node:fs/promises";

// Main-side model provider settings. The API key goes renderer -> Main -> Native's
// `integration.connect.key`; Native persists the credential. Main never stores,
// logs or returns it: results carry closed codes and connected flags only.
const ok = (value) => ({ ok: true, value });
const err = (code) => ({ ok: false, code });
const POPULAR = ["openai", "anthropic", "google", "openrouter"];
const LOCAL_ID = "lmstudio";

export const validProviderId = (v) =>
  typeof v === "string" && /^[A-Za-z0-9_.:-]{1,64}$/u.test(v);
// Printable, no whitespace: real keys never contain either.
export const validApiKey = (v) =>
  typeof v === "string" && /^[\x21-\x7e]{8,512}$/u.test(v);
export function validBaseUrl(v) {
  if (typeof v !== "string" || v.length > 200) return false;
  try {
    const u = new URL(v);
    return (
      ["http:", "https:"].includes(u.protocol) &&
      /^(localhost|127(\.\d{1,3}){3}|\[::1\])$/u.test(u.hostname) &&
      !u.username &&
      !u.password &&
      !u.search &&
      !u.hash
    );
  } catch {
    return false;
  }
}

function failure(error) {
  const tag = error?._tag;
  if (tag === "InvalidRequestError") return err("INVALID_KEY");
  if (tag === "IntegrationNotFoundError") return err("NOT_FOUND");
  return err("UNAVAILABLE");
}

const plain = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

export function createProviderHost({
  context,
  configFile,
  owned = () => true,
}) {
  let writes = Promise.resolve();
  const ready = () => {
    const c = context();
    return c?.client && c.directory ? c : undefined;
  };
  const location = (c) => ({ location: { directory: c.directory } });
  async function readConfig() {
    try {
      const parsed = JSON.parse(await readFile(configFile(), "utf8"));
      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? parsed
        : {};
    } catch (error) {
      if (error?.code === "ENOENT") return {};
      throw error;
    }
  }
  return {
    async list() {
      const c = ready();
      if (!c) return err("UNAVAILABLE");
      try {
        const [integrations, config] = await Promise.all([
          c.client.integration.list(location(c)),
          readConfig(),
        ]);
        const providers = integrations.data
          .filter((i) => i.methods.some((m) => m.type === "key"))
          .map((i) => ({
            id: i.id,
            name: String(i.name).slice(0, 80),
            connected: i.connections.length > 0,
            source: i.connections.some((x) => x.type === "credential")
              ? "credential"
              : i.connections.length
                ? "env"
                : "none",
          }))
          .sort(
            (a, b) =>
              (POPULAR.indexOf(a.id) + 1 || 99) -
                (POPULAR.indexOf(b.id) + 1 || 99) ||
              a.name.localeCompare(b.name),
          )
          .slice(0, 300);
        const baseUrl = plain(
          plain(plain(config.providers)[LOCAL_ID]).settings,
        ).baseURL;
        return ok({
          providers,
          local: {
            id: LOCAL_ID,
            baseUrl: typeof baseUrl === "string" ? baseUrl : "",
          },
        });
      } catch (error) {
        return failure(error);
      }
    },
    async connect(integrationID, key) {
      const c = ready();
      if (!c || !owned()) return err("UNAVAILABLE");
      try {
        await c.client.integration.connect.key({
          ...location(c),
          integrationID,
          key,
          label: "OhMyOwnCode",
        });
        return ok({ connected: true });
      } catch (error) {
        return failure(error);
      }
    },
    async remove(integrationID) {
      const c = ready();
      if (!c || !owned()) return err("UNAVAILABLE");
      try {
        const info = await c.client.integration.get({
          ...location(c),
          integrationID,
        });
        for (const x of info.data.connections)
          if (x.type === "credential")
            await c.client.credential.remove({ credentialID: x.id });
        return ok({ connected: false });
      } catch (error) {
        return failure(error);
      }
    },
    // Native reads local provider endpoints from its opencode.json (no key involved).
    async setLocalBaseUrl(baseUrl) {
      if (!owned()) return err("UNAVAILABLE");
      const run = async () => {
        const file = configFile();
        const temp = `${file}.${randomBytes(8).toString("hex")}.tmp`;
        try {
          const config = await readConfig();
          const providers = { ...plain(config.providers) };
          const entry = { ...plain(providers[LOCAL_ID]) };
          const url = baseUrl ? new URL(baseUrl).href : "";
          if (url) {
            providers[LOCAL_ID] = {
              ...entry,
              settings: { ...plain(entry.settings), baseURL: url },
            };
          } else {
            const { baseURL: _drop, ...settings } = plain(entry.settings);
            const { settings: _s, ...rest } = entry;
            const next = Object.keys(settings).length
              ? { ...rest, settings }
              : rest;
            if (Object.keys(next).length) providers[LOCAL_ID] = next;
            else delete providers[LOCAL_ID];
          }
          await writeFile(
            temp,
            `${JSON.stringify({ ...config, providers }, null, 2)}\n`,
            { mode: 0o600, flag: "wx" },
          );
          await renameReplacing(temp, file);
          return ok({ baseUrl: url });
        } catch {
          await rm(temp, { force: true }).catch(() => {});
          return err("UNAVAILABLE");
        }
      };
      // Serialize read-modify-write so concurrent saves never interleave.
      const result = writes.then(run);
      writes = result.catch(() => {});
      return result;
    },
  };
}
