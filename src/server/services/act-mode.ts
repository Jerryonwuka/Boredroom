/**
 * Act without asking (owner decision, 8 October 2026: "there should be a setting where we can bypass the permission, you
 * can toggle it on and off, just like the way it is on Claude Code"): the person's permission mode and the workspace's
 * switch, read and saved. What the mode DOES is decided elsewhere, by the server alone (services/act-decision and
 * copilot's askFirst); this file only says what was chosen and whether it is in force.
 *
 * - `assistant_profiles.act_mode` ('ask' by default, or 'auto'): the person's own, saved from Settings → Your assistant →
 *   Permissions and from the composer's pill. Never while someone else is signed in as them (support): the choice stays
 *   as they left it, and their assistant asks while they are impersonated.
 * - `brenda_settings.allow_auto_act` (on by default): owners and HR let people choose 'auto'. Off, everyone's assistant
 *   asks whatever they chose; their choice is kept, so it comes back when the workspace turns it on again.
 *
 * Before migration 0045 every read answers `ASK_STATE` and the saves answer 503 NOT_READY (server/lib/schema-0045).
 * Neither is plan-gated: a person may always choose to be asked. The person's mode is not logged (a personal preference,
 * as her voice); the workspace switch is, in Settings → Brenda's log.
 */
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden, invalid } from "@/server/lib/errors";
import { forget0045, isMissingSchema, retryWithout0045, schema0045Ready } from "@/server/lib/schema-0045";
import { logAction } from "@/server/services/brenda";
import { ACT_WORDS, ASK_STATE, actStateFrom, isActMode, type ActMode, type ActState } from "@/lib/act-mode";

const notReady = () => new AppError(503, "NOT_READY", ACT_WORDS.errors.notReady);
const canEditWorkspace = (ctx: Pick<OrgContext, "membership">) => ctx.membership.role === "owner" || ctx.membership.role === "hr";

/**
 * The person's state inside a transaction the caller holds (as the person: members read both rows). `ctx.user` may be
 * left out by callers that only have the organisation and the membership; the impersonation lock then does not apply.
 */
export async function readActState(db: Db, ctx: Pick<OrgContext, "org" | "membership"> & { user?: { impersonation?: unknown } }): Promise<ActState> {
  if (!(await schema0045Ready(db))) return { ...ASK_STATE };
  const r = await db.one<{ act_mode: string | null; allow_auto_act: boolean | null }>(
    `SELECT p.act_mode, b.allow_auto_act
     FROM (SELECT 1) one
     LEFT JOIN assistant_profiles p ON p.membership_id = $2
     LEFT JOIN brenda_settings b ON b.organisation_id = $1`, [ctx.org.id, ctx.membership.id]);
  return actStateFrom({ ready: true, mode: r.act_mode, allowed: r.allow_auto_act, impersonated: !!ctx.user?.impersonation });
}

/** The person's state in its own transaction. Never throws for a missing schema: before 0045 it is `ASK_STATE`. */
export async function actModeFor(ctx: OrgContext): Promise<ActState> {
  try {
    return await retryWithout0045(() => withUser(ctx.user.profileId, (db) => readActState(db, ctx)));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0045();
    return { ...ASK_STATE };
  }
}

/**
 * The person's own choice, saved at once (Settings and the pill). Refused (403) while someone else is signed in as them,
 * and for 'auto' while the workspace has it off ('ask' is always allowed); 503 before 0045. A person with no profile row
 * yet gets one with the look as it is and setup still not done, so "Meet your assistant" still shows when it should.
 */
export async function saveActMode(ctx: OrgContext, mode: ActMode): Promise<ActState> {
  if (ctx.user.impersonation) throw forbidden(ACT_WORDS.errors.impersonated);
  if (!isActMode(mode)) throw invalid(ACT_WORDS.errors.sayMode, { mode: [ACT_WORDS.errors.sayMode] });
  return retryWithout0045(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0045Ready(db))) throw notReady();
    if (mode === "auto" && !(await workspaceActSetting(db, ctx.org.id)).allowed) throw forbidden(ACT_WORDS.errors.workspaceOff);
    await db.query(
      `INSERT INTO assistant_profiles(membership_id, organisation_id, act_mode, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (membership_id) DO UPDATE SET act_mode = $3, updated_at = now()`,
      [ctx.membership.id, ctx.org.id, mode]);
    return readActState(db, ctx);
  }));
}

/** "Allow people to let their assistant act without asking" (members may read it): `{ ready: false, allowed: true }` before 0045. */
export async function workspaceActSetting(db: Db, orgId: string): Promise<{ ready: boolean; allowed: boolean }> {
  if (!(await schema0045Ready(db))) return { ready: false, allowed: true };
  const r = await db.maybeOne<{ allowed: boolean }>(`SELECT allow_auto_act AS allowed FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return { ready: true, allowed: r?.allowed ?? true };
}

/** As workspaceActSetting, in its own transaction, for pages and routes. Never throws for a missing schema. */
export async function workspaceActSettingFor(ctx: OrgContext): Promise<{ ready: boolean; allowed: boolean }> {
  try {
    return await retryWithout0045(() => withUser(ctx.user.profileId, (db) => workspaceActSetting(db, ctx.org.id)));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0045();
    return { ready: false, allowed: true };
  }
}

/**
 * Owners and HR, under the same lock as the organisation's other Brenda settings (`brenda_settings:{org}`); logged in
 * Settings → Brenda's log. 503 before 0045. People's own choices are left as they are: off, they simply are not in force.
 */
export async function saveWorkspaceActSetting(ctx: OrgContext, allowed: boolean): Promise<{ ready: true; allowed: boolean }> {
  if (!canEditWorkspace(ctx)) throw forbidden(ACT_WORDS.errors.settingsForbidden);
  if (typeof allowed !== "boolean") throw invalid(ACT_WORDS.errors.sayAllowed, { allowed: [ACT_WORDS.errors.sayAllowed] });
  return retryWithout0045(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0045Ready(db))) throw notReady();
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, allow_auto_act, updated_by, updated_at) VALUES ($1, $2, $3, now())
       ON CONFLICT (organisation_id) DO UPDATE SET allow_auto_act = $2, updated_by = $3, updated_at = now()`, [ctx.org.id, allowed, ctx.membership.id]);
    await logAction(db, ctx, {
      tool: "settings", outcome: "done", source: "confirm",
      summary: allowed ? "Acting without asking: people may choose it" : "Acting without asking: off for everyone",
    });
    return { ready: true as const, allowed };
  }));
}
