import { randomUUID } from "node:crypto";
import {
  lstatSync,
  readdirSync,
  realpathSync,
  rmSync,
  rmdirSync,
} from "node:fs";
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, parse, resolve, sep } from "node:path";
import {
  DATA_LIMITS,
  RETENTION_OPTIONS,
  buildExport,
  parseImport,
  retentionCandidates,
} from "../renderer/shared/data-transfer/index.mjs";

const fail = (code) => Object.assign(new Error(code), { dataCode: code });
const ARCHIVE_ID = /^[A-Za-z0-9-]{8,64}$/;

// Refuses anything but a real (non-symlink), non-shallow directory that is not home.
// Only the entries inside are removed; symlinks inside are unlinked, never followed.
export function wipeAppDataSync(root) {
  if (typeof root !== "string" || !isAbsolute(root))
    return refuse("NOT_ABSOLUTE");
  let real;
  try {
    if (lstatSync(root).isSymbolicLink()) return refuse("SYMLINK_ROOT");
    if (!lstatSync(root).isDirectory()) return refuse("NOT_DIRECTORY");
    real = realpathSync(root);
  } catch {
    return refuse("NOT_FOUND");
  }
  const depth = real
    .slice(parse(real).root.length)
    .split(sep)
    .filter(Boolean).length;
  if (resolve(root) !== real) return refuse("SYMLINK_ROOT");
  if (depth < 3 || real === realpathSync(homedir())) return refuse("TOO_BROAD");
  for (const name of readdirSync(real)) {
    rmSync(join(real, name), { recursive: true, force: true });
  }
  rmdirSync(real);
  return { ok: true };
}
const refuse = (reason) => ({ ok: false, reason });

// metadataDir: app metadata (settings + archives live here). Pure host state, no workspace files.
export function createDataHost({
  metadataDir,
  now = () => new Date().toISOString(),
  home = homedir(),
  appVersion = "unknown",
}) {
  const archiveDir = () => join(metadataDir(), "archives");
  const settingsFile = () => join(metadataDir(), "data-settings.json");
  let queue = Promise.resolve();
  const serial = (fn) => {
    const run = queue.then(fn, fn);
    queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  };
  const writeAtomic = async (file, text) => {
    await mkdir(dirname(file), { recursive: true, mode: 0o700 });
    const tmp = `${file}.${randomUUID()}.tmp`;
    await writeFile(tmp, text, { mode: 0o600 });
    await rename(tmp, file);
  };
  const info = (a) => ({
    id: a.id,
    importedAt: a.importedAt,
    exportedAt: a.doc.exportedAt,
    sessions: a.doc.sessions.length,
    messages: a.doc.sessions.reduce((n, s) => n + s.messages.length, 0),
    title: a.doc.sessions[0]?.meta.title ?? "",
  });
  async function readOne(name) {
    const id = name.replace(/\.json$/, "");
    if (!name.endsWith(".json") || !ARCHIVE_ID.test(id)) return undefined;
    try {
      const v = JSON.parse(await readFile(join(archiveDir(), name), "utf8"));
      const parsed = parseImport(JSON.stringify(v.doc));
      if (v.id === id && parsed.doc && typeof v.importedAt === "string")
        return { id, importedAt: v.importedAt, doc: parsed.doc };
    } catch {
      // Unreadable archive files are skipped, not repaired.
    }
    return undefined;
  }
  async function readAll() {
    let names = [];
    try {
      names = await readdir(archiveDir());
    } catch {
      return [];
    }
    const out = [];
    for (const name of names) {
      const a = await readOne(name);
      if (a) out.push(a);
    }
    return out.sort((a, b) => b.importedAt.localeCompare(a.importedAt));
  }
  async function days() {
    try {
      const v = JSON.parse(await readFile(settingsFile(), "utf8"));
      return RETENTION_OPTIONS.includes(v?.retentionDays) ? v.retentionDays : 0;
    } catch {
      return 0;
    }
  }
  const dueRows = async (d) =>
    retentionCandidates(
      (await readAll()).map((a) => ({
        id: a.id,
        at: a.importedAt,
        title: info(a).title,
      })),
      d,
      now(),
    );
  async function removeArchive(id) {
    if (!ARCHIVE_ID.test(id)) throw fail("INVALID_REQUEST");
    await rm(join(archiveDir(), `${id}.json`), { force: true });
  }

  return {
    exportPreview: (r) =>
      buildExport({ ...r, now: now(), home, appVersion }).summary,
    exportBuild: (r) => buildExport({ ...r, now: now(), home, appVersion }),
    importText: (text) =>
      serial(async () => {
        const parsed = parseImport(text);
        if (!parsed.doc) throw fail(parsed.error);
        if ((await readAll()).length >= DATA_LIMITS.archives)
          throw fail("TOO_MANY");
        const id = randomUUID();
        const record = { id, importedAt: now(), doc: parsed.doc };
        await writeAtomic(
          join(archiveDir(), `${id}.json`),
          JSON.stringify(record),
        );
        return info(record);
      }),
    list: () => serial(async () => (await readAll()).map(info)),
    get: (id) =>
      serial(async () => {
        if (!ARCHIVE_ID.test(id)) throw fail("INVALID_REQUEST");
        const a = await readOne(`${id}.json`);
        if (!a) throw fail("NOT_FOUND");
        return { ...info(a), doc: a.doc };
      }),
    remove: (id) => serial(() => removeArchive(id)),
    retention: () => serial(async () => ({ days: await days() })),
    retentionPreview: (d) => serial(async () => ({ due: await dueRows(d) })),
    retentionSet: (d) =>
      serial(async () => {
        await writeAtomic(settingsFile(), JSON.stringify({ retentionDays: d }));
        return sweepLocked(d);
      }),
    // Applied at start and daily. Deletes only imported archives inside archiveDir.
    sweep: () => serial(async () => sweepLocked(await days())),
  };
  async function sweepLocked(d) {
    const due = await dueRows(d);
    for (const row of due) await removeArchive(row.id);
    return { days: d, removed: due.length };
  }
}
