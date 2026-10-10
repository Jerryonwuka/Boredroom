/**
 * Deletes every screen recording Boredroom ever kept (owner decisions, 8 October 2026: phase 8). Screen recording for
 * tasks is taken out entirely and replaced by calls; the owner decided that the existing recordings are all deleted, by
 * the owner, with this script. It is the ONLY thing that deletes recording data: no migration, job or page does.
 *
 *   pnpm db:delete-recordings                                    the dry run (the default): reads, prints, changes nothing
 *   pnpm db:delete-recordings --confirm=<host>/<database>        deletes, from that database on that host only
 *   pnpm db:delete-recordings --confirm=<host>/<database> --keep-audit
 *                                                                deletes, but keeps the audit trail about recordings
 *
 * What it removes, in one transaction: the rows of recordings, recording_chunks, recording_access_log,
 * privacy_incidents, recording_grants, capture_exceptions and deletion_tombstones (every tombstone, whatever its
 * subject: the table only ever held recording tombstones and migration 0055 drops it, so the dry run's count, this
 * deletion and 0055's guard all mean the same rows; fix review, 10 October 2026); work sessions' links to capture
 * exceptions (set to NULL); the recording jobs; the notifications and session events that only exist because of
 * recording; the audit rows about recordings (unless --keep-audit). It writes one `recordings.purged` audit row per
 * organisation it touched and one global row, with counts only (no ids, no names). Then, after the commit, it deletes
 * the stored video files through the storage provider and, for the local provider, the `org/<org>/recordings/` folders
 * (orphan files and empty folders included).
 *
 * How to run it (docs/runbooks.md, "Deleting the old recordings (phase 8)"): deploy the new web app and worker first,
 * run the dry run, read the counts, then run the exact `--confirm=<host>/<database>` command the dry run prints. It must
 * name both the host of DATABASE_ADMIN_URL and the database that connection reaches (PostgreSQL's own
 * current_database()), so a command pasted from somewhere else can never delete from another database, also where
 * several share one host (dev and test on localhost, several databases on one Neon endpoint; fix review, 10 October
 * 2026: it named the host only). It connects with DATABASE_ADMIN_URL (the database owner: the app role may not delete
 * audit rows) and never prints it, only its host and database. Safe to run again: a second run finds nothing and only
 * sweeps empty folders. Any failure rolls the database part back whole; files are only touched after the commit.
 * Migration 0055 (db/pending) drops the tables afterwards and refuses while any of these rows remain.
 */
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { Client } from "pg";
import { storage } from "../../src/server/lib/storage";

// ---- What counts as recording data (the same words for counting and deleting) ------------------------------------------

const JOB_WHERE = `type LIKE 'recording.%'`;
const NOTIFICATION_WHERE = `(type IN ('capture.exception', 'capture.exception.accepted', 'capture.exception.rejected', 'incident.opened', 'incident.resolved')
  OR resource_type IN ('recording', 'privacy_incident', 'capture_exception')
  OR (type = 'policy.updated' AND title = 'Recording rules updated'))`;
const SESSION_EVENT_WHERE = `event_type IN ('capture_gap', 'capture_allowed')`;
const AUDIT_ACTIONS = ["recording.started", "recording.finalised", "recording.assembled", "recording.playback", "recording.deleted", "incident.opened",
  "incident.deleted", "incident.released", "capture_exception.requested", "capture_exception.accepted", "capture_exception.rejected",
  "recording_grant.created", "recording_grant.revoked"];
const AUDIT_WHERE = (a: string) => `(${a}.subject_type IN ('recording', 'recording_grant', 'privacy_incident', 'capture_exception')
  OR ${a}.action IN (${AUDIT_ACTIONS.map((x) => `'${x}'`).join(", ")}))`;

/** Every count, per organisation (NULL: rows no organisation can be found for) and per kind. */
const COUNTS_SQL = (keepAudit: boolean) => `
  SELECT organisation_id::text AS org, 'recordings' AS what, 'state ' || upload_state || CASE WHEN deleted_at IS NULL THEN '' ELSE ', marked deleted' END AS k, count(*)::int AS n FROM recordings GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'recording_chunks', state, count(*)::int FROM recording_chunks GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'recording_access_log', '', count(*)::int FROM recording_access_log GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'privacy_incidents', disposition, count(*)::int FROM privacy_incidents GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'recording_grants', CASE WHEN revoked_at IS NULL THEN 'active' ELSE 'revoked' END, count(*)::int FROM recording_grants GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'capture_exceptions', status, count(*)::int FROM capture_exceptions GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'deletion_tombstones', subject_type, count(*)::int FROM deletion_tombstones GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'work_sessions', 'linked to a capture exception', count(*)::int FROM work_sessions WHERE capture_exception_id IS NOT NULL GROUP BY 1, 2, 3
  UNION ALL SELECT r.organisation_id::text, 'jobs', j.type || ', ' || j.state, count(*)::int FROM jobs j LEFT JOIN recordings r ON r.id::text = j.payload->>'recordingId' WHERE j.${JOB_WHERE} GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'notifications', type, count(*)::int FROM notifications WHERE ${NOTIFICATION_WHERE} GROUP BY 1, 2, 3
  UNION ALL SELECT organisation_id::text, 'session_events', event_type, count(*)::int FROM session_events WHERE ${SESSION_EVENT_WHERE} GROUP BY 1, 2, 3
  ${keepAudit ? "" : `UNION ALL SELECT COALESCE(a.organisation_id, r.organisation_id)::text, 'audit_events', a.action, count(*)::int FROM audit_events a
    LEFT JOIN recordings r ON a.organisation_id IS NULL AND r.id = a.subject_id WHERE ${AUDIT_WHERE("a")} GROUP BY 1, 2, 3`}`;

/** The stored files the database knows about: every chunk and every assembled video, with the size it declared. */
const KEYS_SQL = `
  SELECT organisation_id::text AS org, storage_key AS key, size_bytes::bigint AS bytes FROM recording_chunks
  UNION ALL SELECT organisation_id::text, assembled_key, received_bytes::bigint FROM recordings WHERE assembled_key IS NOT NULL`;

// ---- Types -----------------------------------------------------------------------------------------------------------

export type StorageFigures = { known: number; present: number; declaredBytes: number; foundBytes: number; orphanFiles: number; orphanBytes: number; emptyDirs: number };
export type OrgReport = { orgId: string | null; name: string; slug: string | null; counts: Record<string, Record<string, number>>; rows: number; storage: StorageFigures };
export type RemovedFigures = { files: number; bytes: number; orphanFiles: number; orphanBytes: number; dirs: number };
export type DeleteRecordingsResult = {
  status: "dry_run" | "deleted" | "nothing" | "refused" | "no_tables";
  host: string;
  /** The database the connection reached (current_database()), and `<host>/<database>`: what --confirm must name. */
  database: string;
  target: string;
  provider: string;
  root: string | null;
  orgs: OrgReport[];
  totals: Record<string, number>;
  rows: number;
  storage: StorageFigures;
  removed: Record<string, RemovedFigures>;
  backups: { file: string; bytes: number }[];
};
export type DeleteRecordingsOptions = {
  /** The database owner's connection (DATABASE_ADMIN_URL). Never printed. */
  adminUrl: string;
  /** The database to delete from (`--confirm=<host>/<database>`); `true` for a bare `--confirm`; absent for the dry run. */
  confirm?: string | boolean | null;
  keepAudit?: boolean;
  log?: (line: string) => void;
  /** Where local backups are listed from (never touched). Default var/backups. */
  backupsDir?: string;
};

// ---- Helpers ---------------------------------------------------------------------------------------------------------

/** The host of a connection string, without user, password, port or database. */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return u.hostname || u.searchParams.get("host") || "localhost";
  } catch {
    return "unknown";
  }
}

const emptyStorage = (): StorageFigures => ({ known: 0, present: 0, declaredBytes: 0, foundBytes: 0, orphanFiles: 0, orphanBytes: 0, emptyDirs: 0 });
const emptyRemoved = (): RemovedFigures => ({ files: 0, bytes: 0, orphanFiles: 0, orphanBytes: 0, dirs: 0 });
const uuidFromDir = (d: string) => (/^[0-9a-f]{32}$/i.test(d) ? `${d.slice(0, 8)}-${d.slice(8, 12)}-${d.slice(12, 16)}-${d.slice(16, 20)}-${d.slice(20)}`.toLowerCase() : null);
const fmtBytes = (n: number) => (n >= 1073741824 ? `${(n / 1073741824).toFixed(2)} GB` : n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${(n / 1024).toFixed(1)} KB` : `${n} bytes`);
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The local provider's root, read the way storage() reads it; null for any other provider. */
function localRoot(): { provider: string; root: string | null } {
  const provider = process.env.STORAGE_PROVIDER ?? "local";
  return { provider, root: provider === "local" ? resolve(process.env.STORAGE_LOCAL_DIR ?? "./var/storage") : null };
}

type Walk = { files: { key: string; bytes: number }[]; emptyDirs: number; dirs: string[] };
/** Every file and every empty folder under one `org/<org>/recordings` folder (the folder itself included). */
function walk(root: string, dir: string): Walk {
  const out: Walk = { files: [], emptyDirs: 0, dirs: [] };
  const visit = (d: string): boolean => {
    let hasFile = false;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (visit(p)) hasFile = true; }
      else { hasFile = true; out.files.push({ key: relative(root, p).split(sep).join("/"), bytes: statSync(p).size }); }
    }
    out.dirs.push(d);
    if (!hasFile) out.emptyDirs += 1;
    return hasFile;
  };
  visit(dir);
  return out;
}

/** The local `org/<org>/recordings` folders, by organisation id (null: a folder name that is not an organisation's). */
function recordingFolders(root: string | null): { orgId: string | null; dir: string }[] {
  if (!root) return [];
  const orgs = join(root, "org");
  if (!existsSync(orgs)) return [];
  return readdirSync(orgs, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(orgs, e.name, "recordings")))
    .map((e) => ({ orgId: uuidFromDir(e.name), dir: join(orgs, e.name, "recordings") }));
}

function listBackups(dir: string): { file: string; bytes: number }[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((f) => /\.(dump|sql)$/.test(f)).sort().map((f) => ({ file: join(dir, f), bytes: statSync(join(dir, f)).size }));
}

// ---- The run ---------------------------------------------------------------------------------------------------------

/**
 * The dry run (default) or the deletion (`confirm` equal to `<host>/<database>`: the host of the connection string and
 * the database PostgreSQL says the connection reached). The CLI below wraps it; the integration test
 * (tests/integration/recording-purge.test.ts) calls it on its own throwaway database.
 */
export async function runDeleteRecordings(o: DeleteRecordingsOptions): Promise<DeleteRecordingsResult> {
  const log = o.log ?? ((l: string) => console.log(l));
  const host = hostOf(o.adminUrl);
  const keepAudit = !!o.keepAudit;
  const { provider, root } = localRoot();
  const backups = listBackups(o.backupsDir ?? resolve("var/backups"));
  const deleting = o.confirm !== undefined && o.confirm !== null && o.confirm !== false;

  const db = new Client({ connectionString: o.adminUrl });
  await db.connect();
  try {
    // Which database this is, as PostgreSQL itself says (fix review, 10 October 2026): the host alone does not say it
    // when several databases share one (dev and test on localhost, several on one Neon endpoint). Read-only.
    const database = (await db.query<{ d: string }>(`SELECT current_database() AS d`)).rows[0].d;
    const target = `${host}/${database}`;
    const result: DeleteRecordingsResult = { status: "dry_run", host, database, target, provider, root, orgs: [], totals: {}, rows: 0, storage: emptyStorage(), removed: {}, backups };
    log(`Database: ${database}, on host ${host}`);
    if (deleting && (o.confirm === true || o.confirm === "")) {
      log("To delete, name the database host and the database, exactly like this (nothing was changed):");
      log(`  pnpm db:delete-recordings --confirm=${target}${keepAudit ? " --keep-audit" : ""}`);
      return { ...result, status: "refused" };
    }
    if (deleting && o.confirm !== target) {
      log(`That doesn't match the database this would delete from (${target}). Nothing was changed.`);
      return { ...result, status: "refused" };
    }

    const present = (await db.query<{ ok: boolean }>(`SELECT to_regclass('public.recordings') IS NOT NULL AS ok`)).rows[0].ok;
    if (!present) {
      log("Nothing to delete: the recording tables are gone (migration 0055 already ran).");
      if (deleting) result.removed = sweepFolders(root, new Map(), log);
      return { ...result, status: "no_tables" };
    }

    await db.query(deleting ? "BEGIN" : "BEGIN READ ONLY");
    try {
      // A still-running old app cannot add a recording, a chunk or an exception while this runs.
      if (deleting) await db.query("LOCK TABLE recordings, recording_chunks, capture_exceptions IN EXCLUSIVE MODE");
      const counts = (await db.query<{ org: string | null; what: string; k: string; n: number }>(COUNTS_SQL(keepAudit))).rows;
      const keys = (await db.query<{ org: string; key: string; bytes: string }>(KEYS_SQL)).rows;
      const folders = recordingFolders(root);
      const orgIds = [...new Set([...counts.map((c) => c.org), ...keys.map((k) => k.org), ...folders.map((f) => f.orgId)].filter((x): x is string => !!x))];
      const names = new Map((await db.query<{ id: string; name: string; slug: string }>(`SELECT id::text, name, slug FROM organisations WHERE id::text = ANY($1)`, [orgIds])).rows.map((r) => [r.id, r]));

      const reports = new Map<string | null, OrgReport>();
      const report = (org: string | null) => {
        let r = reports.get(org);
        if (!r) {
          const n = org ? names.get(org) : null;
          r = { orgId: org, name: n?.name ?? (org ? "Unknown organisation" : "No organisation"), slug: n?.slug ?? null, counts: {}, rows: 0, storage: emptyStorage() };
          reports.set(org, r);
        }
        return r;
      };
      for (const c of counts) {
        const r = report(c.org);
        (r.counts[c.what] ??= {})[c.k || "rows"] = c.n;
        r.rows += c.n;
        result.totals[c.what] = (result.totals[c.what] ?? 0) + c.n;
        result.rows += c.n;
      }

      // Storage, through the provider: what the database knows about, and what is really there.
      const known = new Map<string, { org: string; bytes: number }>();
      for (const k of keys) known.set(k.key, { org: k.org, bytes: Number(k.bytes) });
      const store = storage();
      const found = new Map<string, number>();
      for (const [key, k] of known) {
        const s = report(k.org).storage;
        s.known += 1;
        s.declaredBytes += k.bytes;
        let size: number | null = null;
        try { size = (await store.exists(key)) ? await store.size(key) : null; } catch { size = null; }
        if (size !== null) { s.present += 1; s.foundBytes += size; found.set(key, size); }
      }
      for (const f of folders) {
        const w = walk(root!, f.dir);
        const s = report(f.orgId).storage;
        s.emptyDirs += w.emptyDirs;
        for (const file of w.files) if (!known.has(file.key)) { s.orphanFiles += 1; s.orphanBytes += file.bytes; }
      }
      result.orgs = [...reports.values()].sort((a, b) => (a.orgId === null ? 1 : b.orgId === null ? -1 : a.name.localeCompare(b.name)));
      for (const r of result.orgs) for (const [k, v] of Object.entries(r.storage) as [keyof StorageFigures, number][]) result.storage[k] += v;

      printReport(result, keepAudit, log);
      const anything = result.rows > 0 || result.storage.known > 0;

      if (!deleting) {
        await db.query("ROLLBACK");
        printDryRunTail(result, keepAudit, log);
        return result;
      }

      if (!anything) {
        await db.query("ROLLBACK");
        log("Nothing to delete: no recording data is left in the database.");
        result.removed = sweepFolders(root, new Map(), log);
        return { ...result, status: "nothing" };
      }

      // The deletion, in the order the foreign keys need (none of them cascades).
      missingFilesNote(result, log);
      const del = async (label: string, sql: string) => { const r = await db.query(sql); log(`  ${label}: ${r.rowCount ?? 0}`); };
      log("Deleting:");
      await del("recording jobs", `DELETE FROM jobs WHERE ${JOB_WHERE}`);
      await del("recording access log", `DELETE FROM recording_access_log`);
      await del("privacy incidents", `DELETE FROM privacy_incidents`);
      await del("recording chunks", `DELETE FROM recording_chunks`);
      await del("recordings", `DELETE FROM recordings`);
      await del("work sessions unlinked from capture exceptions", `UPDATE work_sessions SET capture_exception_id = NULL WHERE capture_exception_id IS NOT NULL`);
      await del("capture exceptions", `DELETE FROM capture_exceptions`);
      await del("recording grants", `DELETE FROM recording_grants`);
      // Every tombstone, as the dry run counted them and as 0055's guard counts them (the header says why).
      await del("deletion tombstones", `DELETE FROM deletion_tombstones`);
      await del("notifications", `DELETE FROM notifications WHERE ${NOTIFICATION_WHERE}`);
      await del("session events", `DELETE FROM session_events WHERE ${SESSION_EVENT_WHERE}`);
      if (!keepAudit) await del("audit rows about recordings", `DELETE FROM audit_events a WHERE ${AUDIT_WHERE("a")}`);
      else log("  audit rows about recordings: kept (--keep-audit)");

      // One marker per organisation touched, and one for the whole run: counts only, no ids, no names.
      for (const r of result.orgs) {
        if (!r.orgId || !names.has(r.orgId) || (!r.rows && !r.storage.known)) continue;
        const flat = Object.fromEntries(Object.entries(r.counts).map(([what, by]) => [what, Object.values(by).reduce((a, b) => a + b, 0)]));
        await db.query(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id, metadata) VALUES ($1, 'recordings.purged', 'organisation', $1, $2)`,
          [r.orgId, JSON.stringify({ rows: flat, files: r.storage.known, keptAudit: keepAudit })]);
      }
      await db.query(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id, metadata) VALUES (NULL, 'recordings.purged', 'system', NULL, $1)`,
        [JSON.stringify({ rows: result.totals, files: result.storage.known, organisations: result.orgs.filter((r) => r.orgId && (r.rows || r.storage.known)).length, keptAudit: keepAudit })]);
      await db.query("COMMIT");
      log("The database part is done and committed.");

      // Files, only now (idempotent: a file already gone is not an error).
      const byOrg = new Map<string | null, RemovedFigures>();
      for (const [key, k] of known) {
        const rem = byOrg.get(k.org) ?? emptyRemoved();
        byOrg.set(k.org, rem);
        try {
          await store.delete(key);
          if (found.has(key)) { rem.files += 1; rem.bytes += found.get(key)!; }
        } catch (err) { log(`  Could not delete one stored file: ${(err as Error).message}`); }
      }
      result.removed = sweepFolders(root, byOrg, log, (id) => (id ? names.get(id)?.name ?? id : "No organisation"));
      return { ...result, status: "deleted" };
    } catch (err) {
      await db.query("ROLLBACK").catch(() => undefined);
      throw err;
    }
  } finally {
    await db.end();
  }
}

/** Local provider: removes every `org/<org>/recordings` tree (orphans and empty folders), then prints what went. */
function sweepFolders(root: string | null, byOrg: Map<string | null, RemovedFigures>, log: (l: string) => void, nameOf: (id: string | null) => string = (id) => id ?? "No organisation"): Record<string, RemovedFigures> {
  for (const f of recordingFolders(root)) {
    const w = walk(root!, f.dir);
    const rem = byOrg.get(f.orgId) ?? emptyRemoved();
    byOrg.set(f.orgId, rem);
    rem.orphanFiles += w.files.length;
    rem.orphanBytes += w.files.reduce((a, x) => a + x.bytes, 0);
    rem.dirs += w.dirs.length;
    rmSync(f.dir, { recursive: true, force: true });
  }
  const out: Record<string, RemovedFigures> = {};
  if (!byOrg.size) { log(root ? "Storage: no recording folders left." : "Storage: not the local provider; nothing to sweep."); return out; }
  log("Storage removed:");
  for (const [org, r] of byOrg) {
    out[org ?? "none"] = r;
    log(`  ${nameOf(org)}: ${plural(r.files, "stored file")} (${fmtBytes(r.bytes)}), ${plural(r.orphanFiles, "orphan file")} (${fmtBytes(r.orphanBytes)}), ${plural(r.dirs, "folder")}; ${fmtBytes(r.bytes + r.orphanBytes)} freed.`);
  }
  return out;
}

function printReport(r: DeleteRecordingsResult, keepAudit: boolean, log: (l: string) => void) {
  log(`Storage provider: ${r.provider}${r.root ? `, root ${r.root}` : ""}`);
  if (!r.orgs.length) { log("No recording data found."); return; }
  for (const o of r.orgs) {
    log("");
    log(o.orgId ? `${o.name} (${o.slug ?? "no slug"}, ${o.orgId})` : `${o.name} (rows no organisation could be found for)`);
    for (const [what, by] of Object.entries(o.counts)) {
      const total = Object.values(by).reduce((a, b) => a + b, 0);
      const detail = Object.entries(by).filter(([k]) => k !== "rows").map(([k, n]) => `${k} ${n}`).join(", ");
      log(`  ${what}: ${total}${detail ? ` (${detail})` : ""}`);
    }
    const s = o.storage;
    if (s.known || s.orphanFiles || s.emptyDirs) {
      log(`  files the database knows: ${s.known}, found ${s.present}; ${fmtBytes(s.declaredBytes)} declared, ${fmtBytes(s.foundBytes)} found`);
      if (r.root) log(`  orphan files: ${s.orphanFiles} (${fmtBytes(s.orphanBytes)}); empty folders: ${s.emptyDirs}`);
    }
  }
  log("");
  log(`In total: ${plural(r.rows, "row")}${keepAudit ? " (audit rows not counted: --keep-audit)" : ""}; ${plural(r.storage.known, "stored file")} known (${r.storage.present} found, ${fmtBytes(r.storage.foundBytes)}), ${plural(r.storage.orphanFiles, "orphan file")}, ${plural(r.storage.emptyDirs, "empty folder")}.`);
}

/**
 * Files the database knows that are not where this machine looks (fix review, 10 October 2026): the script deletes files
 * through the storage provider of the machine it runs on, so run anywhere else, the rows go and the real files stay
 * behind with nothing pointing at them. Said in the dry run and again before deleting.
 */
function missingFilesNote(r: DeleteRecordingsResult, log: (l: string) => void) {
  const missing = r.storage.known - r.storage.present;
  if (missing <= 0) return;
  log("");
  log(`${missing} of the ${plural(r.storage.known, "stored file")} the database knows ${missing === 1 ? "was" : "were"} not found here (${r.provider}${r.root ? `, root ${r.root}` : ""}).`);
  log("Either they were deleted already (retention deleted most recordings), or they are kept on another machine. Run this");
  log("script on the machine that serves the web app's files, with its STORAGE_* settings. If they are on another machine,");
  log("run the --confirm command there too: once the rows are gone, it still sweeps the org/*/recordings/ folders there.");
}

function printDryRunTail(r: DeleteRecordingsResult, keepAudit: boolean, log: (l: string) => void) {
  missingFilesNote(r, log);
  log("");
  log("This was a dry run: nothing was changed.");
  if (r.backups.length) {
    log("Local backups that may still hold recording rows (listed, never touched):");
    for (const b of r.backups) log(`  ${b.file} (${fmtBytes(b.bytes)})`);
  }
  log("Browsers clear the boredroom-capture buffer of unsent video on their next workspace page, by themselves.");
  log("A hosted database's point-in-time history (Neon) keeps deleted rows until its restore window passes.");
  log("To delete everything listed above (the host and the database, so only this database can be named):");
  log(`  pnpm db:delete-recordings --confirm=${r.target}${keepAudit ? " --keep-audit" : ""}`);
}

// ---- The command line ------------------------------------------------------------------------------------------------

async function main() {
  const { config } = await import("dotenv");
  config({ path: [".env.local", ".env"], quiet: true });
  const args = process.argv.slice(2);
  const confirmArg = args.find((a) => a === "--confirm" || a.startsWith("--confirm="));
  const confirm = confirmArg === undefined ? null : confirmArg === "--confirm" ? true : confirmArg.slice("--confirm=".length);
  const adminUrl = process.env.DATABASE_ADMIN_URL;
  if (!adminUrl) {
    console.error("DATABASE_ADMIN_URL is not set. This script needs the database owner's connection.");
    process.exit(1);
  }
  const r = await runDeleteRecordings({ adminUrl, confirm, keepAudit: args.includes("--keep-audit") });
  process.exit(r.status === "refused" ? 1 : 0);
}

if (process.argv[1] && process.argv[1].endsWith("delete-recordings.ts")) {
  main().catch((err) => {
    console.error(`Stopped: ${(err as Error).message}`);
    console.error("If it stopped before \"The database part is done\", the database was rolled back and nothing was deleted. Running it again is safe.");
    process.exit(1);
  });
}
