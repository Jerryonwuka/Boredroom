/**
 * The owner's deletion of the old screen recordings (owner decisions, 8 October 2026: phase 8, contract A.5–A.7, G.1).
 * Company A and Company B each get recording data written straight into the tables (as the old feature left it), with
 * real files in the test storage, next to rows that are not about recording and must survive. Then:
 * - the dry run counts per organisation, files and bytes included, and changes nothing; it says when files the database
 *   knows are not on this machine (fix review, 10 October 2026: run it where the web app keeps its files);
 * - every tombstone is counted and deleted, whatever its subject, as migration 0055's guard counts them (fix review,
 *   10 October 2026);
 * - a wrong host, the host alone, another database on the same host and a bare --confirm are refused and change nothing
 *   (fix review, 10 October 2026: --confirm names the host AND the database, as PostgreSQL says it);
 * - --confirm=<host>/<database> --keep-audit deletes everything but the audit trail; --confirm=<host>/<database> deletes
 *   the rest; a marker per
 *   organisation and a global one are written; the files and the recording folders are gone; a second run finds nothing;
 * - migration 0055 (db/pending) then applies by hand, twice; on a fresh database with one recording left it refuses;
 * - creating a workspace and publishing a notice work before and after 0055 (schema-0055), with a stale cache too.
 * Runs only on the throwaway test database (TEST_DATABASE_ADMIN_URL).
 */
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { adminQuery, adminUrl, resetTestDatabase } from "../helpers/db";
import { buildCompany, contextFor, createVerifiedUser, type CompanyFixture } from "@/server/services/fixtures";
import { startSession, stopSession } from "@/server/services/sessions";
import { createOrganisation, publishPolicy, DEFAULT_NOTICE } from "@/server/services/orgs";
import { storage, tenantKey } from "@/server/lib/storage";
import { forget0055, noteSchema0055 } from "@/server/lib/schema-0055";
import { runDeleteRecordings, hostOf, type DeleteRecordingsResult } from "../../db/scripts/delete-recordings";

const ROOT = resolve(process.env.STORAGE_LOCAL_DIR ?? "./var/test-storage");
const PENDING_0055 = readFileSync(join(process.cwd(), "db/pending/0055_remove_screen_recording.sql"), "utf8");
const RECORDING_TABLES = ["recordings", "recording_chunks", "recording_access_log", "privacy_incidents", "recording_grants", "capture_exceptions", "deletion_tombstones"];
const silent = () => undefined;

let a: CompanyFixture;
let b: CompanyFixture;
let lines: string[] = [];
const log = (l: string) => { lines.push(l); };

const orgIdOf = (c: CompanyFixture) => c.ownerCtx.org.id;
const one = async <T>(sql: string, params: unknown[] = []) => (await adminQuery<T>(sql, params))[0];
const count = async (sql: string, params: unknown[] = []) => Number((await one<{ n: string }>(`SELECT count(*) AS n FROM ${sql}`, params)).n);

/** Recording data for one company, the way the old feature left it. Returns what the dry run should report. */
async function seedRecordings(c: CompanyFixture, o: { chunks: number[]; assembled?: number; withExtras: boolean }) {
  const org = orgIdOf(c);
  const s = await startSession(c.employeeCtx, { taskId: c.taskIds.homepage });
  await stopSession(c.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
  const recId = randomUUID();
  const prefix = tenantKey(org, "recordings", s.id, recId);
  const assembledKey = o.assembled ? `${prefix}/assembled.webm` : null;
  await adminQuery(`INSERT INTO recordings(id, organisation_id, session_id, membership_id, policy_id, recorder_instance, segment_index, mime_type, upload_state, storage_prefix, assembled_key, received_bytes, expires_at, deleted_at)
    VALUES ($1, $2, $3, $4, $5, $6, 0, 'video/webm', $7, $8, $9, $10, now() + interval '7 days', NULL)`,
    [recId, org, s.id, c.employeeCtx.membership.id, c.ownerCtx.org.current_policy_id, `rec-${recId}`, o.assembled ? "ready" : "processing", prefix, assembledKey, o.chunks.reduce((x, y) => x + y, 0)]);
  for (const [i, size] of o.chunks.entries()) {
    const key = `${prefix}/chunk-${String(i).padStart(6, "0")}.part`;
    await storage().put(key, Buffer.alloc(size, i + 1), "video/webm");
    await adminQuery(`INSERT INTO recording_chunks(organisation_id, recording_id, sequence, checksum, size_bytes, storage_key, state) VALUES ($1, $2, $3, 'x', $4, $5, 'verified')`, [org, recId, i, size, key]);
  }
  if (assembledKey) await storage().put(assembledKey, Buffer.alloc(o.assembled!, 9), "video/webm");
  await adminQuery(`INSERT INTO jobs(type, payload, dedup_key, state) VALUES ('recording.assemble', $1, $2, 'pending')`, [JSON.stringify({ recordingId: recId }), `assemble:${recId}`]);
  await adminQuery(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id) VALUES ($1, 'recording.started', 'recording', $2)`, [org, recId]);
  // Written by the worker without an organisation; the script finds it through the recording.
  await adminQuery(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id) VALUES (NULL, 'recording.assembled', 'recording', $1)`, [recId]);
  if (!o.withExtras) return { recId, sessionId: s.id, prefix };

  const mgr = c.managerCtx.membership.id;
  await adminQuery(`INSERT INTO recording_access_log(organisation_id, recording_id, actor_membership_id, action) VALUES ($1, $2, $3, 'playback_authorised')`, [org, recId, mgr]);
  await adminQuery(`INSERT INTO privacy_incidents(organisation_id, recording_id, reporter_membership_id, reason) VALUES ($1, $2, $3, 'A password was on screen')`, [org, recId, c.employeeCtx.membership.id]);
  await adminQuery(`INSERT INTO recording_grants(organisation_id, grantee_membership_id, scope_type, granted_by) VALUES ($1, $2, 'organisation', $3)`, [org, mgr, c.ownerCtx.membership.id]);
  const ex = await one<{ id: string }>(`INSERT INTO capture_exceptions(organisation_id, membership_id, session_id, reason_code, reason) VALUES ($1, $2, $3, 'other', 'No screen to share') RETURNING id`, [org, c.employeeCtx.membership.id, s.id]);
  await adminQuery(`UPDATE work_sessions SET capture_exception_id = $1 WHERE id = $2`, [ex.id, s.id]);
  await adminQuery(`INSERT INTO deletion_tombstones(organisation_id, subject_type, subject_id, reason) VALUES ($1, 'recording', $2, 'retention')`, [org, randomUUID()]);
  // A tombstone of another subject (none was ever written, but the table is dropped with everything in it).
  await adminQuery(`INSERT INTO deletion_tombstones(organisation_id, subject_type, subject_id, reason) VALUES ($1, 'evidence', $2, 'offboarding')`, [org, randomUUID()]);
  await adminQuery(`INSERT INTO jobs(type, payload, dedup_key, state) VALUES ('recording.retention_delete', $1, $2, 'succeeded')`, [JSON.stringify({ recordingId: recId, reason: "retention" }), `recording.delete:${recId}`]);
  const kinds: [string, string | null][] = [["capture.exception", "capture_exception"], ["capture.exception.accepted", null], ["capture.exception.rejected", null], ["incident.opened", "privacy_incident"], ["incident.resolved", null]];
  for (const [type, resource] of kinds) {
    await adminQuery(`INSERT INTO notifications(organisation_id, recipient_membership_id, type, title, resource_type, deduplication_key) VALUES ($1, $2, $3, 'Old recording notice', $4, $5)`, [org, mgr, type, resource, `${type}:${randomUUID()}`]);
  }
  await adminQuery(`INSERT INTO notifications(organisation_id, recipient_membership_id, type, title, deduplication_key) VALUES ($1, $2, 'policy.updated', 'Recording rules updated', $3)`, [org, mgr, `policy:${randomUUID()}`]);
  for (const t of ["capture_gap", "capture_allowed"]) {
    await adminQuery(`INSERT INTO session_events(organisation_id, session_id, actor_user_id, event_type, metadata) VALUES ($1, $2, $3, $4, $5)`, [org, s.id, c.employee.profileId, t, JSON.stringify({ recordingId: recId })]);
  }
  await adminQuery(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id) VALUES ($1, 'capture_exception.requested', 'capture_exception', $2)`, [org, ex.id]);
  await adminQuery(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id) VALUES ($1, 'recording_grant.created', 'recording_grant', $2)`, [org, randomUUID()]);
  return { recId, sessionId: s.id, prefix };
}

/** Everything the dry run must leave exactly as it was. */
async function snapshot() {
  const tables = [...RECORDING_TABLES, "jobs", "notifications", "session_events", "audit_events", "work_sessions"];
  const rows: Record<string, number> = {};
  for (const t of tables) rows[t] = await count(t);
  rows.linked = await count(`work_sessions WHERE capture_exception_id IS NOT NULL`);
  const files: string[] = [];
  const walk = (d: string) => { if (!existsSync(d)) return; for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p); else files.push(`${p}:${statSync(p).size}`); } };
  walk(join(ROOT, "org"));
  return { rows, files: files.sort() };
}

const orgReport = (r: DeleteRecordingsResult, c: CompanyFixture) => r.orgs.find((o) => o.orgId === orgIdOf(c))!;
const total = (by: Record<string, number> | undefined) => Object.values(by ?? {}).reduce((x, y) => x + y, 0);

let voiceKey = "";
let orphanKey = "";
let emptyDir = "";
const host = () => hostOf(adminUrl());
/** The test database's name (from its connection string), and what --confirm must name: the host and the database. */
const dbName = () => decodeURIComponent(new URL(adminUrl()).pathname.slice(1));
const target = () => `${host()}/${dbName()}`;

beforeAll(async () => {
  forget0055();
  await resetTestDatabase();
  a = await buildCompany("a");
  b = await buildCompany("b");
  await seedRecordings(a, { chunks: [1000, 1500], assembled: 2400, withExtras: true });
  await seedRecordings(b, { chunks: [700], withExtras: false });
  // A file the database does not know (an orphan) and two empty folders under A's recordings.
  orphanKey = tenantKey(orgIdOf(a), "recordings", randomUUID(), randomUUID(), "chunk-000009.part");
  await storage().put(orphanKey, Buffer.alloc(333, 7), "video/webm");
  emptyDir = join(ROOT, "org", orgIdOf(a).replace(/-/g, ""), "recordings", randomUUID(), randomUUID());
  mkdirSync(emptyDir, { recursive: true });
  // Not recording data: they must all survive.
  voiceKey = tenantKey(orgIdOf(a), "voice", randomUUID(), "note.webm");
  await storage().put(voiceKey, Buffer.alloc(500, 3), "audio/webm");
  await adminQuery(`INSERT INTO notifications(organisation_id, recipient_membership_id, type, title, resource_type, deduplication_key) VALUES ($1, $2, 'message.new', 'Ada sent you a message', 'conversation', 'keep:message')`, [orgIdOf(a), a.managerCtx.membership.id]);
  await adminQuery(`INSERT INTO audit_events(organisation_id, action, subject_type, subject_id) VALUES ($1, 'task.created', 'task', $2)`, [orgIdOf(a), a.taskIds.homepage]);
});

describe("db:delete-recordings, the dry run", () => {
  it("counts per organisation, files and bytes included, and changes nothing", async () => {
    const before = await snapshot();
    lines = [];
    const r = await runDeleteRecordings({ adminUrl: adminUrl(), log });
    expect(r.status).toBe("dry_run");
    expect(r.host).toBe(host());
    expect(r.database).toBe(dbName());
    expect(r.target).toBe(target());
    expect(lines[0]).toBe(`Database: ${r.database}, on host ${r.host}`);
    const ra = orgReport(r, a);
    expect(ra).toMatchObject({ name: "Company A", slug: "company-a" });
    expect(total(ra.counts.recordings)).toBe(1);
    expect(ra.counts.recording_chunks).toEqual({ verified: 2 });
    for (const t of ["recording_access_log", "privacy_incidents", "recording_grants", "capture_exceptions"]) expect(total(ra.counts[t]), t).toBe(1);
    // Every tombstone, by subject: what the deletion removes and what 0055's guard counts.
    expect(ra.counts.deletion_tombstones).toEqual({ recording: 1, evidence: 1 });
    expect(total(ra.counts.work_sessions)).toBe(1);
    expect(ra.counts.jobs).toEqual({ "recording.assemble, pending": 1, "recording.retention_delete, succeeded": 1 });
    expect(total(ra.counts.notifications)).toBe(6);
    expect(ra.counts.session_events).toEqual({ capture_gap: 1, capture_allowed: 1 });
    // recording.assembled had no organisation: it is A's through its recording.
    expect(ra.counts.audit_events).toEqual({ "recording.started": 1, "recording.assembled": 1, "capture_exception.requested": 1, "recording_grant.created": 1 });
    expect(ra.storage).toMatchObject({ known: 3, present: 3, declaredBytes: 1000 + 1500 + 2500, foundBytes: 1000 + 1500 + 2400, orphanFiles: 1, orphanBytes: 333 });
    expect(ra.storage.emptyDirs).toBeGreaterThanOrEqual(2);

    const rb = orgReport(r, b);
    expect(rb).toMatchObject({ name: "Company B", slug: "company-b" });
    expect(rb.counts.recording_chunks).toEqual({ verified: 1 });
    expect(rb.counts.audit_events).toEqual({ "recording.started": 1, "recording.assembled": 1 });
    expect(rb.storage).toMatchObject({ known: 1, present: 1, declaredBytes: 700, foundBytes: 700, orphanFiles: 0 });
    expect(rb.counts.notifications).toBeUndefined();

    expect(lines.join("\n")).toContain(`pnpm db:delete-recordings --confirm=${r.target}`);
    expect(lines.join("\n")).toContain("This was a dry run: nothing was changed.");
    // Every file the database knows is here: nothing to say about another machine.
    expect(lines.join("\n")).not.toContain("not found here");
    expect(lines.join("\n")).not.toContain(adminUrl());
    expect(await snapshot()).toEqual(before);
  });

  it("refuses a wrong host, the host alone, another database on this host and a bare --confirm, and changes nothing", async () => {
    const before = await snapshot();
    // The host alone (the old form) does not say which database: several can share one host (fix review, 10 October 2026).
    for (const confirm of ["db.example.com", `db.example.com/${dbName()}`, host(), `${host()}/boardroom`, `${host()}/`, `${target()} `]) {
      lines = [];
      expect((await runDeleteRecordings({ adminUrl: adminUrl(), confirm, log })).status, confirm).toBe("refused");
      expect(lines.join("\n")).toContain(`That doesn't match the database this would delete from (${target()}). Nothing was changed.`);
    }
    lines = [];
    expect((await runDeleteRecordings({ adminUrl: adminUrl(), confirm: true, log })).status).toBe("refused");
    expect(lines.join("\n")).toContain(`  pnpm db:delete-recordings --confirm=${target()}`);
    expect(lines.join("\n")).not.toContain(adminUrl());
    expect(await snapshot()).toEqual(before);
  });
});

describe("db:delete-recordings --confirm=<host>/<database>", () => {
  it("--keep-audit deletes every recording row and file but keeps the audit trail", async () => {
    const ABOUT = `audit_events WHERE subject_type IN ('recording', 'recording_grant', 'privacy_incident', 'capture_exception')`;
    const auditBefore = await count(ABOUT);
    expect(auditBefore).toBe(6);
    lines = [];
    const r = await runDeleteRecordings({ adminUrl: adminUrl(), confirm: target(), keepAudit: true, log });
    expect(r.status).toBe("deleted");
    // Every table empty, the tombstone of another subject included (the dry run counted it).
    for (const t of RECORDING_TABLES) expect(await count(t), t).toBe(0);
    expect(lines).toContain("  deletion tombstones: 2");
    expect(await count(ABOUT)).toBe(auditBefore);
    const marker = await one<{ metadata: { keptAudit: boolean } }>(`SELECT metadata FROM audit_events WHERE action = 'recordings.purged' AND organisation_id IS NULL`);
    expect(marker.metadata.keptAudit).toBe(true);
  });

  it("deletes everything listed, keeps what is not recording data, and marks each organisation once", async () => {
    // A little more for A after the first run (as if the old app still ran), so the second deletion has work to do.
    const again = await seedRecordings(a, { chunks: [400], withExtras: false });
    await adminQuery(`DELETE FROM audit_events WHERE action = 'recordings.purged'`);
    lines = [];
    const r = await runDeleteRecordings({ adminUrl: adminUrl(), confirm: target(), log });
    expect(r.status).toBe("deleted");
    for (const t of RECORDING_TABLES) expect(await count(t), t).toBe(0);
    expect(await count(`work_sessions WHERE capture_exception_id IS NOT NULL`)).toBe(0);
    expect(await count(`jobs WHERE type LIKE 'recording.%'`)).toBe(0);
    expect(await count(`notifications WHERE type IN ('capture.exception', 'capture.exception.accepted', 'capture.exception.rejected', 'incident.opened', 'incident.resolved') OR title = 'Recording rules updated'`)).toBe(0);
    expect(await count(`session_events WHERE event_type IN ('capture_gap', 'capture_allowed')`)).toBe(0);
    expect(await count(`audit_events WHERE subject_type IN ('recording', 'recording_grant', 'privacy_incident', 'capture_exception')`)).toBe(0);
    // Untouched: a message notification, a task audit row, the sessions' own events, the sessions, the voice note.
    expect(await count(`notifications WHERE deduplication_key = 'keep:message'`)).toBe(1);
    expect(await count(`audit_events WHERE action = 'task.created' AND subject_id = $1`, [a.taskIds.homepage])).toBeGreaterThanOrEqual(1);
    expect(await count(`session_events WHERE event_type = 'started' AND session_id = $1`, [again.sessionId])).toBe(1);
    expect(await count(`work_sessions WHERE id = $1`, [again.sessionId])).toBe(1);
    expect(await storage().exists(voiceKey)).toBe(true);
    // One marker per organisation with something left (A's new rows, B's kept audit rows), one global; counts only.
    const markers = await adminQuery<{ organisation_id: string | null; subject_type: string; metadata: Record<string, unknown> }>(`SELECT organisation_id, subject_type, metadata FROM audit_events WHERE action = 'recordings.purged'`);
    expect(markers.map((m) => `${m.organisation_id}:${m.subject_type}`).sort()).toEqual([`${orgIdOf(a)}:organisation`, `${orgIdOf(b)}:organisation`, "null:system"].sort());
    expect(JSON.stringify(markers)).not.toContain(again.recId);
    // Files and folders: the recording files, the orphan and the empty folders are gone.
    expect(await storage().exists(`${again.prefix}/chunk-000000.part`)).toBe(false);
    expect(await storage().exists(orphanKey)).toBe(false);
    expect(existsSync(emptyDir)).toBe(false);
    expect(existsSync(join(ROOT, "org", orgIdOf(a).replace(/-/g, ""), "recordings"))).toBe(false);
    expect(existsSync(join(ROOT, "org", orgIdOf(b).replace(/-/g, ""), "recordings"))).toBe(false);
    expect(lines.join("\n")).toContain("The database part is done and committed.");
  });

  it("a second run finds nothing", async () => {
    lines = [];
    const r = await runDeleteRecordings({ adminUrl: adminUrl(), confirm: target(), log });
    expect(r.status).toBe("nothing");
    expect(lines.join("\n")).toContain("Nothing to delete");
  });
});

describe("migration 0055 and the code around it", () => {
  it("a workspace and a notice work before 0055 (the recording columns get 'disabled' and 7)", async () => {
    const before = await createVerifiedUser(`before-0055-${randomUUID().slice(0, 8)}@company-c.test`, "Cara Before");
    const made = await createOrganisation(before.profileId, { name: "Before 0055", slug: `before-${randomUUID().slice(0, 8)}`, timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    const p = await one<{ recording_mode: string; retention_days: number; notice_text: string }>(`SELECT p.recording_mode, p.retention_days, p.notice_text FROM policies p JOIN organisations o ON o.current_policy_id = p.id WHERE o.id = $1`, [made.orgId]);
    expect(p).toEqual({ recording_mode: "disabled", retention_days: 7, notice_text: DEFAULT_NOTICE });
    const ctx = await contextFor(before, made.slug);
    const v = await publishPolicy(ctx, { noticeText: "Boredroom records the tasks you plan and the timers you start.", reminderMinutesBeforeEnd: 15 });
    expect(v.version).toBe(2);
  });

  it("applies by hand once nothing is left, twice; then creating a workspace and publishing still work", async () => {
    await adminQuery(PENDING_0055);
    for (const t of RECORDING_TABLES) expect((await one<{ r: string | null }>(`SELECT to_regclass($1)::text AS r`, [`public.${t}`])).r, t).toBeNull();
    const fns = await adminQuery(`SELECT proname FROM pg_proc WHERE proname IN ('app_recording_in_org', 'app_can_review_recording', 'app_is_privacy_admin')`);
    expect(fns).toEqual([]);
    const cols = await adminQuery<{ c: string }>(`SELECT table_name || '.' || column_name AS c FROM information_schema.columns
      WHERE (table_name, column_name) IN (('work_sessions', 'capture_mode'), ('work_sessions', 'capture_exception_id'), ('tasks', 'capture_requirement'), ('policies', 'recording_mode'), ('policies', 'retention_days'), ('policies', 'capture_audio'))`);
    expect(cols).toEqual([]);
    await adminQuery(PENDING_0055); // idempotent

    // The cache still says the columns are there (as a running process would for up to 30 seconds): the first INSERT
    // fails with 42703 and is run again without them.
    noteSchema0055(false);
    const after = await createVerifiedUser(`after-0055-${randomUUID().slice(0, 8)}@company-c.test`, "Cara After");
    const made = await createOrganisation(after.profileId, { name: "After 0055", slug: `after-${randomUUID().slice(0, 8)}`, timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    const ctx = await contextFor(after, made.slug);
    noteSchema0055(false);
    expect((await publishPolicy(ctx, { noticeText: "Boredroom records the tasks you plan and the timers you start.", reminderMinutesBeforeEnd: 20 })).version).toBe(2);
    expect((await publishPolicy(ctx, { noticeText: DEFAULT_NOTICE, reminderMinutesBeforeEnd: 20 })).version).toBe(3);
    // The sessions and tasks work without their capture columns.
    const s = await startSession(a.employeeCtx, { taskId: a.taskIds.meeting });
    await stopSession(a.employeeCtx, s.id, { expectedVersion: s.version, note: "", outcome: "continue_later" });
    // And the dry run says the tables are gone.
    lines = [];
    expect((await runDeleteRecordings({ adminUrl: adminUrl(), log })).status).toBe("no_tables");
    expect(lines.join("\n")).toContain("Nothing to delete: the recording tables are gone (migration 0055 already ran).");
  });

  it("refuses on a fresh database with one recording left; a stale 'gone' cache still creates a workspace", async () => {
    await resetTestDatabase();
    // The process believes 0055 ran (it did, on the database before this reset): the INSERT without the recording
    // columns fails with 23502, the cache is forgotten and the second run supplies them.
    const user = await createVerifiedUser(`stale-${randomUUID().slice(0, 8)}@company-c.test`, "Cara Stale");
    const made = await createOrganisation(user.profileId, { name: "Stale cache", slug: `stale-${randomUUID().slice(0, 8)}`, timezone: "Africa/Lagos", employeeCode: "OWN-001" });
    expect((await one<{ recording_mode: string }>(`SELECT p.recording_mode FROM policies p JOIN organisations o ON o.current_policy_id = p.id WHERE o.id = $1`, [made.orgId])).recording_mode).toBe("disabled");
    a = await buildCompany("a");
    const last = await seedRecordings(a, { chunks: [10], withExtras: false });
    await expect(adminQuery(PENDING_0055)).rejects.toThrow(/RECORDINGS_REMAIN/);
    expect((await one<{ r: string | null }>(`SELECT to_regclass('public.recordings')::text AS r`)).r).toBe("recordings");
    // A file the database knows that is not on this machine (deleted already, or kept on another one): the dry run says
    // so, names where it looked and says where to run it.
    await storage().delete(`${last.prefix}/chunk-000000.part`);
    lines = [];
    const dry = await runDeleteRecordings({ adminUrl: adminUrl(), log });
    expect(dry.storage).toMatchObject({ known: 1, present: 0 });
    const said = lines.join("\n");
    expect(said).toContain(`1 of the 1 stored file the database knows was not found here (local, root ${ROOT}).`);
    expect(said).toContain("Run this\nscript on the machine that serves the web app's files, with its STORAGE_* settings.");
    // Tidy the rows and files this last seed wrote.
    await runDeleteRecordings({ adminUrl: adminUrl(), confirm: target(), log: silent });
  });
});
