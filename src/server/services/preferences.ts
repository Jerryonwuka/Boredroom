/**
 * "How I like things done" (owner decisions, 8–9 October 2026: phase 7c). The person's own list of preferences about
 * how their assistant works for them, in their own words: at most 16, 150 characters each (lib/preferences). Only the
 * person reads and writes them (migration 0050's row-level security: owners, HR and leads read nothing); the worker
 * reads them for the person's own standup draft. Every change is the person's own: no audit row, no Brenda's-log line
 * others could read (like the assistant's look). While someone else is signed in as the person the list is hidden and
 * nothing changes. Before migration 0050 the list is empty with `ready: false`, every change answers 503 NOT_READY and
 * nothing reaches the model (server/lib/schema-0050).
 */
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, notFound } from "@/server/lib/errors";
import { forget0050, isMissingSchema, retryWithout0050, schema0050Ready } from "@/server/lib/schema-0050";
import { readPersonalAssistant } from "@/server/services/assistant-profile";
import {
  PREFERENCE_LIMITS, PREFERENCE_WORDS as W, PREFERENCES_NOT_READY_SHORT, cleanPreference, preferenceProblem,
  type Preference, type PreferenceList, type PreferenceSource,
} from "@/lib/preferences";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);
const notReady = () => new AppError(503, "NOT_READY", PREFERENCES_NOT_READY_SHORT);
const notHere = () => notFound(W.errors.notFound);
const code = (err: unknown) => (err as { code?: string } | null)?.code;
const msg = (err: unknown) => String((err as { message?: string } | null)?.message ?? "");

function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated);
}

type Row = { id: string; body: string; source: PreferenceSource; created_at: string; updated_at: string };
const COLS = "id, body, source, created_at, updated_at";
const toPreference = (r: Row): Preference => ({ id: r.id, body: r.body, source: r.source === "chat" ? "chat" : "settings", createdAt: r.created_at, updatedAt: r.updated_at });

/** As the person, 503 before 0050 (and once more on the fallback path after a restore). */
async function asPerson<T>(ctx: OrgContext, fn: (db: Db) => Promise<T>): Promise<T> {
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0050Ready(db))) throw notReady();
      return fn(db);
    }));
  } catch (err) {
    if (isMissingSchema(err)) { forget0050(); throw notReady(); }
    throw err;
  }
}

/** The checks every save makes (400 with the words), the body as it will be stored. */
async function checked(db: Db, ctx: OrgContext, raw: string): Promise<string> {
  const body = cleanPreference(raw);
  const name = (await readPersonalAssistant(db, ctx.membership.id)).name;
  const problem = preferenceProblem(body, name);
  if (problem) throw new AppError(400, "INVALID_PREFERENCE", problem, { fieldErrors: { body: [problem] } });
  return body;
}

/** The database's own answers as the routes' (the trigger's 16, the unique index's duplicate). */
function mapped(err: unknown): unknown {
  if (code(err) === "23514" && /PREFERENCES_FULL/.test(msg(err))) return conflict("PREFERENCES_FULL", W.errors.full);
  if (code(err) === "23505") return conflict("PREFERENCE_EXISTS", W.errors.exists);
  if (code(err) === "23514") return new AppError(400, "INVALID_PREFERENCE", W.errors.tooLong);
  return err;
}

// ---- Reading -------------------------------------------------------------------------------------------------------------

/** The person's list, oldest first. Hidden (empty) while someone else is signed in as them; `ready: false` before 0050. */
export async function listPreferences(ctx: OrgContext): Promise<PreferenceList> {
  const none = (ready: boolean, hidden: boolean): PreferenceList => ({ ready, hidden, items: [], max: PREFERENCE_LIMITS.max });
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, async (db): Promise<PreferenceList> => {
      if (!(await schema0050Ready(db))) return none(false, !!ctx.user.impersonation);
      if (ctx.user.impersonation) return none(true, true);
      const rows = await db.query<Row>(
        `SELECT ${COLS} FROM assistant_preferences WHERE organisation_id = $1 AND membership_id = $2 ORDER BY created_at, id`, [ctx.org.id, ctx.membership.id]);
      return { ready: true, hidden: false, items: rows.map(toPreference), max: PREFERENCE_LIMITS.max };
    }));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0050();
    return none(false, !!ctx.user.impersonation);
  }
}

/**
 * The preferences as the model reads them (the person's own uncached situation): id and words, oldest first, at most 16.
 * [] before 0050, while someone else is signed in as the person, or on any failure. Never throws.
 */
export async function preferencesForModel(ctx: OrgContext): Promise<{ id: string; body: string }[]> {
  if (ctx.user.impersonation) return [];
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, async (db) => {
      if (!(await schema0050Ready(db))) return [];
      return db.query<{ id: string; body: string }>(
        `SELECT id, body FROM assistant_preferences WHERE organisation_id = $1 AND membership_id = $2 ORDER BY created_at, id LIMIT $3`,
        [ctx.org.id, ctx.membership.id, PREFERENCE_LIMITS.max]);
    }));
  } catch (err) {
    if (isMissingSchema(err)) forget0050();
    else console.warn(`[preferences] reading for the model: ${msg(err)}`);
    return [];
  }
}

/** The person's preferences for their own standup draft, read by the worker in its transaction. [] before 0050. */
export async function preferencesForWorker(db: Db, membershipId: string): Promise<string[]> {
  if (!isUuid(membershipId) || !(await schema0050Ready(db))) return [];
  const rows = await db.query<{ body: string }>(
    `SELECT body FROM assistant_preferences WHERE membership_id = $1 ORDER BY created_at, id LIMIT $2`, [membershipId, PREFERENCE_LIMITS.max]);
  return rows.map((r) => r.body);
}

// ---- Changing ------------------------------------------------------------------------------------------------------------

/**
 * Adds one, from Settings or from a confirmed chat card ("chat"). 400 with the problem's words; 409 PREFERENCES_FULL at
 * 16; 409 PREFERENCE_EXISTS for the same words (any case); 403 while someone else is signed in as the person; 503 before
 * 0050. Two saves at once take turns on the person's lock (the trigger keeps the 16 for every writer too).
 */
export async function addPreference(ctx: OrgContext, body: string, source: PreferenceSource = "settings"): Promise<Preference> {
  notWhileImpersonated(ctx);
  return asPerson(ctx, async (db) => {
    const clean = await checked(db, ctx, body);
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`assistant_preferences:${ctx.membership.id}`]);
    const have = await db.one<{ n: number; same: boolean }>(
      `SELECT count(*)::int AS n, bool_or(lower(body) = lower($2)) AS same FROM assistant_preferences WHERE membership_id = $1`, [ctx.membership.id, clean]);
    if (have.same) throw conflict("PREFERENCE_EXISTS", W.errors.exists);
    if (have.n >= PREFERENCE_LIMITS.max) throw conflict("PREFERENCES_FULL", W.errors.full);
    try {
      const r = await db.one<Row>(
        `INSERT INTO assistant_preferences(organisation_id, membership_id, body, source) VALUES ($1, $2, $3, $4) RETURNING ${COLS}`,
        [ctx.org.id, ctx.membership.id, clean, source === "chat" ? "chat" : "settings"]);
      return toPreference(r);
    } catch (err) { throw mapped(err); }
  });
}

/** Changes one of the person's own (the same checks as adding); 404 when it is not theirs. */
export async function updatePreference(ctx: OrgContext, id: string, body: string): Promise<Preference> {
  notWhileImpersonated(ctx);
  if (!isUuid(id)) throw notHere();
  return asPerson(ctx, async (db) => {
    const clean = await checked(db, ctx, body);
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`assistant_preferences:${ctx.membership.id}`]);
    const own = await db.maybeOne<Row>(`SELECT ${COLS} FROM assistant_preferences WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 FOR UPDATE`,
      [id, ctx.membership.id, ctx.org.id]);
    if (!own) throw notHere();
    if (own.body === clean) return toPreference(own);
    const same = await db.maybeOne(`SELECT 1 FROM assistant_preferences WHERE membership_id = $1 AND id <> $2 AND lower(body) = lower($3)`, [ctx.membership.id, id, clean]);
    if (same) throw conflict("PREFERENCE_EXISTS", W.errors.exists);
    try {
      const r = await db.one<Row>(`UPDATE assistant_preferences SET body = $2 WHERE id = $1 RETURNING ${COLS}`, [id, clean]);
      return toPreference(r);
    } catch (err) { throw mapped(err); }
  });
}

/** Deletes one of the person's own; 404 when it is not theirs, 403 while someone else is signed in as them. */
export async function deletePreference(ctx: OrgContext, id: string): Promise<{ deleted: true }> {
  notWhileImpersonated(ctx);
  if (!isUuid(id)) throw notHere();
  return asPerson(ctx, async (db) => {
    const gone = await db.maybeOne(`DELETE FROM assistant_preferences WHERE id = $1 AND membership_id = $2 AND organisation_id = $3 RETURNING id`, [id, ctx.membership.id, ctx.org.id]);
    if (!gone) throw notHere();
    return { deleted: true as const };
  });
}
