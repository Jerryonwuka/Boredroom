/**
 * `pnpm db:restore`'s grants (fix review, 10 October 2026). pg_restore runs with --no-privileges, then the script grants
 * the app role everything and takes back what the migrations took back. Screen recording's two append-only tables leave
 * with migration 0055 (owner decisions, 8 October 2026: phase 8) and the calls tables arrive with 0054, so a restored dump
 * may have either: each of those REVOKEs runs only where its table exists, and both old and new dumps restore with the
 * privileges their migrations gave. Run on the throwaway test database, each case inside a transaction that is rolled
 * back, so no other test sees the changed privileges.
 */
import { Client } from "pg";
import { beforeAll, describe, expect, it } from "vitest";
import { adminUrl, resetTestDatabase } from "../helpers/db";
import { GRANTS } from "../../db/scripts/restore";

/** Runs `fn` as the database owner inside a transaction that is always rolled back. */
async function rolledBack(fn: (c: Client) => Promise<void>): Promise<void> {
  const c = new Client({ connectionString: adminUrl() });
  await c.connect();
  try {
    await c.query("BEGIN");
    // As pg_restore --no-privileges leaves a restored database: nothing granted to the app role.
    await c.query("REVOKE ALL ON ALL TABLES IN SCHEMA public FROM boardroom_app");
    await fn(c);
  } finally {
    await c.query("ROLLBACK").catch(() => undefined);
    await c.end();
  }
}
const can = async (c: Client, table: string, privilege: string) =>
  (await c.query<{ ok: boolean }>(`SELECT has_table_privilege('boardroom_app', $1, $2) AS ok`, [`public.${table}`, privilege])).rows[0].ok;

beforeAll(async () => { await resetTestDatabase(); });

describe("db:restore's grants", () => {
  it("a dump from before 0055: the recording tables are append-only again; the calls tables keep 0054's", async () => {
    await rolledBack(async (c) => {
      await c.query(GRANTS);
      expect(await can(c, "recording_access_log", "INSERT")).toBe(true);
      expect(await can(c, "recording_access_log", "DELETE")).toBe(false);
      expect(await can(c, "recording_access_log", "UPDATE")).toBe(false);
      expect(await can(c, "deletion_tombstones", "DELETE")).toBe(false);
      for (const t of ["calls", "call_participants", "call_note_consents", "call_recaps"]) {
        expect(await can(c, t, "DELETE"), t).toBe(false);
        expect(await can(c, t, "UPDATE"), t).toBe(true);
      }
      // The worker's 7-day purge deletes transcript lines (row-level security decides whose).
      expect(await can(c, "call_transcript_lines", "DELETE")).toBe(true);
      // The fixed list, as before.
      expect(await can(c, "audit_events", "DELETE")).toBe(false);
      expect(await can(c, "audit_events", "UPDATE")).toBe(false);
      expect(await can(c, "tasks", "DELETE")).toBe(true);
    });
  });

  it("a dump from after 0055 (no recording tables) and one from before 0054 (no calls tables) restore without an error", async () => {
    await rolledBack(async (c) => {
      // Gone as far as the grants can tell: to_regclass('public.<name>') is NULL for each.
      for (const t of ["recording_access_log", "deletion_tombstones", "calls", "call_participants", "call_note_consents", "call_recaps"]) {
        await c.query(`ALTER TABLE ${t} RENAME TO ${t}_elsewhere`);
      }
      await c.query(GRANTS);
      // The tables that were there got their grants; the renamed ones were skipped, not an error.
      expect(await can(c, "tasks", "DELETE")).toBe(true);
      expect(await can(c, "audit_events", "DELETE")).toBe(false);
      expect(await can(c, "calls_elsewhere", "DELETE")).toBe(true);
    });
  });
});
