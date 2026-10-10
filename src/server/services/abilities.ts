/**
 * Brenda's abilities (owner decisions, 8–9 October 2026: phase 7c, the abilities catalogue). Owners and HR choose which
 * abilities the workspace offers; each person switches the personal ones on or off for their own assistant. This file
 * reads the two lists (migration 0050: `brenda_settings.abilities_off`, `assistant_private.abilities_off`), refuses a
 * switched-off ability in the services (`requireAbility`: 403 ABILITY_OFF with one sentence and where it is switched
 * on), builds the Settings catalogue (`abilitiesView`) with the existing switches surfaced as they are (they stay the
 * source of truth: mention_replies, track_commitments, allow_auto_act, routines_chase_leads_only, act_mode, speak,
 * allow_thread_replies) and saves the two kinds of switch.
 *
 * Both lists start empty: every ability built so far stays ON until someone switches it off. Before migration 0050 the
 * reads say `ready: false` with everything on (lib/abilities `ALL_ON`), the saves answer 503 NOT_READY, and nothing is
 * ever refused. Workspace changes are audited (`brenda.ability_changed`, the key and the value only) and logged in
 * Brenda's log; personal changes are not (like the assistant's name and look).
 */
import { cache } from "react"; // a pass-through outside a render, so the worker can import this file
import { withUser, withWorker, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, forbidden } from "@/server/lib/errors";
import { forget0050, isMissingSchema, retryWithout0050, schema0050Ready } from "@/server/lib/schema-0050";
import { forget0054, schema0054Ready } from "@/server/lib/schema-0054";
import { audit } from "@/server/services/common";
import { logAction } from "@/server/services/brenda";
import { readAssistantProfiles, readPersonalAssistant } from "@/server/services/assistant-profile";
import { localDate } from "@/server/lib/time";
import { ROUTINE_TEMPLATES } from "@/lib/routines";
import {
  ABILITIES_NOT_READY_SHORT, ABILITY_CATALOGUE, ABILITY_WORDS as W, ALL_ON, TEMPLATE_ABILITY,
  abilityOff, abilityTitle, isAbilityKey, isPersonalSwitchKey, isWorkspaceSwitchKey, templateTitle,
  type Abilities, type AbilitiesView, type AbilityCard, type AbilityKey,
} from "@/lib/abilities";

const notReady = () => new AppError(503, "NOT_READY", ABILITIES_NOT_READY_SHORT);
const badKey = (message: string) => new AppError(400, "INVALID_ABILITY", message, { fieldErrors: { key: [message] } });
const isOrgAccount = (ctx: Pick<OrgContext, "membership">) => ctx.membership.role === "owner" || ctx.membership.role === "hr";
const keysOf = (v: unknown): AbilityKey[] => (Array.isArray(v) ? [...new Set(v.filter(isAbilityKey))] : []);

// ---- Reading ------------------------------------------------------------------------------------------------------------

/**
 * The two lists for one person, in a transaction the caller holds: as the person (their own row of assistant_private;
 * row-level security hides everyone else's) or as the worker. `membershipId` null reads the workspace's list only.
 * Before 0050: `{ ready: false, [], [] }` (everything on).
 */
export async function abilitiesIn(db: Db, orgId: string, membershipId: string | null): Promise<Abilities> {
  if (!(await schema0050Ready(db))) return { ...ALL_ON, workspaceOff: [], personalOff: [] };
  const r = await db.one<{ w: string[] | null; p: string[] | null }>(
    `SELECT (SELECT abilities_off FROM brenda_settings WHERE organisation_id = $1) AS w,
            (SELECT abilities_off FROM assistant_private WHERE membership_id = $2::uuid) AS p`, [orgId, membershipId]);
  return { ready: true, workspaceOff: keysOf(r.w).filter(isWorkspaceSwitchKey), personalOff: membershipId ? keysOf(r.p).filter(isPersonalSwitchKey) : [] };
}

/**
 * The person's abilities for this request (React's cache: the shell, the page and the chat share one read). Never
 * throws: a failed read (or before 0050) reads everything on, `ready: false`.
 */
export const abilitiesFor = cache(async (ctx: OrgContext): Promise<Abilities> => {
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, (db) => abilitiesIn(db, ctx.org.id, ctx.membership.id)));
  } catch (err) {
    if (isMissingSchema(err)) forget0050();
    else console.warn(`[abilities] reading the switches: ${(err as Error)?.message ?? String(err)}`);
    return { ...ALL_ON, workspaceOff: [], personalOff: [] };
  }
});

/** The refusal's words for this person (their own assistant's name), read in `db` when given. */
async function refusalOf(ctx: OrgContext, key: AbilityKey, off: "workspace" | "personal", db?: Db): Promise<string> {
  const name = off === "personal"
    ? (db ? await readPersonalAssistant(db, ctx.membership.id) : await withUser(ctx.user.profileId, (d) => readPersonalAssistant(d, ctx.membership.id)).catch(() => null))?.name ?? "your assistant"
    : "";
  return W.refusal(abilityTitle(key), off, name, isOrgAccount(ctx));
}

/** An ability's refusal as an error: 403 ABILITY_OFF with the words and who switched it off. */
export async function abilityError(ctx: OrgContext, key: AbilityKey, off: "workspace" | "personal", db?: Db): Promise<AppError> {
  return new AppError(403, "ABILITY_OFF", await refusalOf(ctx, key, off, db), { details: { ability: key, off } });
}

/**
 * Refuses (403 ABILITY_OFF, `ABILITY_WORDS.refusal` with the person's assistant's name) when `key` is switched off for
 * this person, by the workspace or by them. With `db`: read in that transaction (as the person or the worker); else
 * through `abilitiesFor`. Never refuses before 0050.
 */
export async function requireAbility(ctx: OrgContext, key: AbilityKey, db?: Db): Promise<void> {
  const a = db ? await abilitiesIn(db, ctx.org.id, ctx.membership.id) : await abilitiesFor(ctx);
  const off = abilityOff(a, key);
  if (off) throw await abilityError(ctx, key, off, db);
}

/** Whether `key` is off for this person and the refusal's words (null when on). Never throws. */
export async function abilityRefusal(ctx: OrgContext, key: AbilityKey, a?: Abilities): Promise<{ off: "workspace" | "personal"; message: string } | null> {
  const off = abilityOff(a ?? (await abilitiesFor(ctx)), key);
  if (!off) return null;
  return { off, message: await refusalOf(ctx, key, off).catch(() => W.refusal(abilityTitle(key), off, "your assistant", isOrgAccount(ctx))) };
}

// ---- The catalogue (contract C.1, C.2) ----------------------------------------------------------------------------------

type Switches = {
  mentionReplies: boolean; trackCommitments: boolean; allowAutoAct: boolean; chaseLeadsOnly: boolean;
  speak: string; allowThreadReplies: boolean;
};
const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);

/**
 * The existing switches as they are, read whole-row (to_jsonb) so a column a migration has not added yet reads as its
 * default instead of failing: the workspace's (mention replies on, commitments off, acting without asking allowed, leads
 * only for chases) and the person's (speak 'voice', tags allowed).
 */
async function existingSwitches(db: Db, ctx: OrgContext): Promise<Switches> {
  const r = await db.one<{ b: Record<string, unknown> | null; p: Record<string, unknown> | null }>(
    `SELECT (SELECT to_jsonb(b) FROM brenda_settings b WHERE b.organisation_id = $1) AS b,
            (SELECT to_jsonb(p) FROM assistant_profiles p WHERE p.membership_id = $2) AS p`, [ctx.org.id, ctx.membership.id]);
  const b = r.b ?? {};
  const p = r.p ?? {};
  return {
    mentionReplies: bool(b.mention_replies, true), trackCommitments: bool(b.track_commitments, false), allowAutoAct: bool(b.allow_auto_act, true),
    chaseLeadsOnly: bool(b.routines_chase_leads_only, true),
    speak: typeof p.speak === "string" ? p.speak : "voice", allowThreadReplies: bool(p.allow_thread_replies, true),
  };
}

/** How many of the workspace's teams run a standup now (every member may read the settings rows). 0 before 0050. */
async function teamsOnIn(db: Db, orgId: string, ready: boolean): Promise<number> {
  if (!ready) return 0;
  const r = await db.one<{ n: number }>(
    `SELECT count(*)::int AS n FROM team_standups s JOIN teams t ON t.id = s.team_id WHERE s.organisation_id = $1 AND s.enabled AND t.archived_at IS NULL`, [orgId]);
  return r.n;
}

/** `calls`: migration 0054 is applied (phase 8: the `call_notes` switch exists only then). */
type CardInput = { a: Abilities; s: Switches; name: string; ws: string; slug: string; actMode: "ask" | "auto"; actEffective: boolean; teamsOn: number; calls: boolean };

/**
 * A card's badge in Settings → Brenda (fix review, 9 October 2026): the workspace's own state, never the viewer's
 * personal one ("Asks first" was the owner's own act mode next to "Allow acting without asking: On").
 */
function workspaceStateOf(c: AbilityCard, i: CardInput): string {
  if (c.workspace.kind === "existing") {
    if (c.key === "commitments") return c.workspace.on ? W.state.on : W.state.off;
    return c.workspace.on ? W.state.on : W.state.offWorkspace;
  }
  if (!i.a.ready) return W.state.notReady;
  // Phase 8 (owner decisions, 8 October 2026): notes on calls need migration 0054 (its CHECK allows the key).
  if (c.key === "call_notes" && !i.calls) return W.state.notReady;
  if (!c.workspace.offered) return W.state.offWorkspace;
  if (c.key === "standup") return i.teamsOn > 0 ? W.state.standupOn(i.teamsOn) : W.state.standupNone;
  return W.state.on;
}

function cardsOf(i: CardInput): AbilityCard[] {
  const brenda = (anchor: string) => `/app/${i.slug}/settings?section=brenda#${anchor}`;
  const mine = (anchor: string) => `/app/${i.slug}/settings?section=assistant#${anchor}`;
  const offered = (k: AbilityKey) => !i.a.workspaceOff.includes(k);
  const on = (k: AbilityKey) => !i.a.personalOff.includes(k);
  const E = W.existing;
  return ABILITY_CATALOGUE.map((e): AbilityCard => {
    const base = { key: e.key, title: e.title, what: e.what({ name: i.name, ws: i.ws }), whatWorkspace: e.whatAll({ name: i.name, ws: i.ws }), useWhen: e.useWhen, never: e.never, icon: e.icon };
    const card = (c: AbilityCard): AbilityCard => ({ ...c, workspaceState: workspaceStateOf(c, i) });
    const plain = (k: AbilityKey): Pick<AbilityCard, "workspace" | "personal" | "effective" | "state"> => {
      const effective = offered(k) && on(k);
      return {
        workspace: { kind: "switch", offered: offered(k) }, personal: { kind: "switch", on: on(k) }, effective,
        state: !offered(k) ? W.state.offWorkspace : !on(k) ? W.state.off : W.state.on,
      };
    };
    switch (e.key) {
      case "mentions": {
        const effective = i.s.mentionReplies && on("mentions");
        return card({
          ...base,
          workspace: { kind: "existing", on: i.s.mentionReplies, label: E.mentionReplies, href: brenda("mentions") },
          personal: { kind: "switch", on: on("mentions") },
          also: [{ scope: "personal", on: i.s.allowThreadReplies, label: E.letPeopleTag(i.name), href: mine("assistant-talk") }],
          effective, state: !i.s.mentionReplies ? W.state.offWorkspace : !on("mentions") ? W.state.off : W.state.on,
        });
      }
      case "routines": {
        const templates = ROUTINE_TEMPLATES.map((t) => {
          const needs = TEMPLATE_ABILITY[t];
          return { template: t, label: templateTitle(t), available: !needs || abilityOff(i.a, needs) === null, needs: needs ? abilityTitle(needs) : null };
        });
        return card({ ...base, ...plain("routines"), also: [{ scope: "workspace", on: i.s.chaseLeadsOnly, label: E.chaseLeadsOnly, href: brenda("routines") }], templates });
      }
      case "commitments":
        return card({
          ...base,
          workspace: { kind: "existing", on: i.s.trackCommitments, label: E.trackCommitments, href: brenda("commitments") },
          personal: { kind: "none", label: E.setByWorkspace },
          effective: i.s.trackCommitments, state: i.s.trackCommitments ? W.state.on : W.state.offUntilOwner,
        });
      case "standup": {
        const p = plain("standup");
        const state = !i.a.ready ? W.state.notReady : p.effective ? (i.teamsOn > 0 ? W.state.standupOn(i.teamsOn) : W.state.standupNone) : p.state;
        return card({ ...base, ...p, effective: i.a.ready && p.effective, state, teamsOn: i.teamsOn });
      }
      case "voice":
        return card({
          ...base,
          workspace: { kind: "switch", offered: offered("voice") },
          personal: { kind: "existing", on: i.s.speak !== "never", label: E.speak(i.name), href: mine("voice") },
          effective: offered("voice"), state: offered("voice") ? W.state.on : W.state.offWorkspace,
        });
      case "call_notes": {
        // Phase 8 (owner decisions, 8 October 2026): a workspace switch only; each call asks each person for themselves.
        const effective = i.a.ready && i.calls && offered("call_notes");
        return card({
          ...base,
          workspace: { kind: "switch", offered: offered("call_notes") },
          personal: { kind: "none", label: W.card.callNotesPersonal },
          effective, state: !i.a.ready || !i.calls ? W.state.notReady : offered("call_notes") ? W.state.on : W.state.offWorkspace,
        });
      }
      case "act":
        return card({
          ...base,
          workspace: { kind: "existing", on: i.s.allowAutoAct, label: E.allowAutoAct, href: brenda("act-mode") },
          personal: { kind: "existing", on: i.actMode === "auto", label: E.actMode(i.name), href: mine("permissions") },
          effective: i.actEffective, state: !i.s.allowAutoAct ? W.state.offWorkspace : i.actEffective ? W.state.on : W.state.asksFirst,
        });
      default:
        return card({ ...base, ...plain(e.key) });
    }
  });
}

/**
 * The catalogue as the person reads it: every card with its switches (the workspace's for owners and HR to change; the
 * person's own), the existing switches surfaced with links to their cards, and each card's state for this person. Read
 * as the person; before 0050 the new switches read on and `ready: false` (Settings shows them disabled).
 */
export async function abilitiesView(ctx: OrgContext): Promise<AbilitiesView> {
  const read = async (db: Db) => {
    const a = await abilitiesIn(db, ctx.org.id, ctx.membership.id);
    const [s, profiles, teamsOn, calls] = [await existingSwitches(db, ctx), await readAssistantProfiles(db, ctx), await teamsOnIn(db, ctx.org.id, a.ready), await schema0054Ready(db)];
    const act = profiles.act;
    return {
      ready: a.ready,
      cards: cardsOf({ a, s, name: profiles.personal.name, ws: profiles.workspace.name, slug: ctx.org.slug, actMode: act?.mode ?? "ask", actEffective: act?.effective === "auto", teamsOn, calls }),
      canEditWorkspace: isOrgAccount(ctx), impersonated: !!ctx.user.impersonation,
    };
  };
  try {
    return await retryWithout0050(() => withUser(ctx.user.profileId, read));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    forget0050();
    return withUser(ctx.user.profileId, read);
  }
}

// ---- Saving -------------------------------------------------------------------------------------------------------------

/**
 * The person switches one of their own abilities on or off (`PERSONAL_SWITCH_KEYS`). 403 while someone else is signed in
 * as them, 400 for a key that is not switched here, 503 before 0050. Not audited (a personal preference, like the
 * assistant's look). A person with no row in assistant_private gets one.
 */
export async function savePersonalAbility(ctx: OrgContext, p: { key: AbilityKey; on: boolean }): Promise<AbilitiesView> {
  if (ctx.user.impersonation) throw forbidden(W.errors.impersonated);
  const key = p?.key;
  if (!isPersonalSwitchKey(key)) throw badKey(isAbilityKey(key) ? W.errors.notPersonalKey : W.errors.unknown);
  if (typeof p.on !== "boolean") throw new AppError(400, "INVALID_INPUT", W.errors.sayOn, { fieldErrors: { on: [W.errors.sayOn] } });
  await retryWithout0050(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0050Ready(db))) throw notReady();
    await db.query(
      `INSERT INTO assistant_private(membership_id, organisation_id, abilities_off, updated_at)
       VALUES ($1, $2, CASE WHEN $4::boolean THEN '{}'::text[] ELSE ARRAY[$3::text] END, now())
       ON CONFLICT (membership_id) DO UPDATE SET
         abilities_off = CASE WHEN $4::boolean THEN array_remove(assistant_private.abilities_off, $3::text)
                              WHEN $3::text = ANY(assistant_private.abilities_off) THEN assistant_private.abilities_off
                              ELSE array_append(assistant_private.abilities_off, $3::text) END,
         updated_at = now()`, [ctx.membership.id, ctx.org.id, key, p.on]);
  })).catch((err) => {
    if (isMissingSchema(err)) { forget0050(); throw notReady(); }
    throw err;
  });
  // Standup switched off for their own assistant: today's open drafts are called off at once (fix review, 9 October
  // 2026: a draft already opened was still drafted, announced and paid for). The claim and the sweep check it too.
  if (key === "standup" && !p.on) {
    await (await import("@/server/services/standup")).endOwnStandupToday(ctx.membership.id)
      .catch((err: unknown) => console.warn(`[abilities] ending today's standup: ${(err as Error)?.message ?? String(err)}`));
  }
  return abilitiesView(ctx);
}

/**
 * Owners and HR choose whether the workspace offers one of the new abilities (`WORKSPACE_SWITCH_KEYS`; an existing
 * switch's key answers 400 "Change this one in its own card below."). 403 for anyone else and while someone else is
 * signed in as them, 503 before 0050. Under the organisation's Brenda settings lock; audited and logged. Switching
 * standup off cancels today's open standups at once (best-effort; the sweep does it too).
 */
export async function saveWorkspaceAbility(ctx: OrgContext, p: { key: AbilityKey; offered: boolean }): Promise<AbilitiesView> {
  if (!isOrgAccount(ctx)) throw forbidden(W.errors.forbidden);
  if (ctx.user.impersonation) throw forbidden(W.errors.forbidden);
  const key = p?.key;
  if (!isWorkspaceSwitchKey(key)) throw badKey(isAbilityKey(key) ? W.errors.notWorkspaceKey : W.errors.unknown);
  if (typeof p.offered !== "boolean") throw new AppError(400, "INVALID_INPUT", W.errors.sayOn, { fieldErrors: { offered: [W.errors.sayOn] } });
  const changed = await retryWithout0050(() => withUser(ctx.user.profileId, async (db) => {
    if (!(await schema0050Ready(db))) throw notReady();
    // Phase 8 (owner decisions, 8 October 2026): 0050's CHECK does not allow `call_notes`; 0054's does.
    if (key === "call_notes" && !(await schema0054Ready(db))) throw notReady();
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    const before = await db.maybeOne<{ off: string[] }>(`SELECT abilities_off AS off FROM brenda_settings WHERE organisation_id = $1`, [ctx.org.id]);
    const wasOffered = !(before?.off ?? []).includes(key);
    if (wasOffered === p.offered && before) return false;
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, abilities_off, updated_by, updated_at)
       VALUES ($1, CASE WHEN $3::boolean THEN '{}'::text[] ELSE ARRAY[$2::text] END, $4, now())
       ON CONFLICT (organisation_id) DO UPDATE SET
         abilities_off = CASE WHEN $3::boolean THEN array_remove(brenda_settings.abilities_off, $2::text)
                              WHEN $2::text = ANY(brenda_settings.abilities_off) THEN brenda_settings.abilities_off
                              ELSE array_append(brenda_settings.abilities_off, $2::text) END,
         updated_by = $4, updated_at = now()`, [ctx.org.id, key, p.offered, ctx.membership.id]);
    if (wasOffered === p.offered) return false;
    await audit(db, {
      organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "brenda.ability_changed", subjectType: "organisation", subjectId: ctx.org.id,
      metadata: { ability: key, offered: p.offered },
    });
    await logAction(db, ctx, {
      tool: "settings", outcome: "done", source: "confirm",
      summary: p.offered ? `Abilities: ${abilityTitle(key)} offered in this workspace` : `Abilities: ${abilityTitle(key)} switched off for this workspace`,
    });
    return true;
  })).catch((err) => {
    if (isMissingSchema(err)) { forget0050(); forget0054(); throw notReady(); }
    // A database restored to before 0054 while the cache said it was there: its CHECK refuses the key.
    if (key === "call_notes" && (err as { code?: string })?.code === "23514") { forget0054(); throw notReady(); }
    throw err;
  });
  if (changed && key === "call_notes" && !p.offered) {
    // Phase 8 (fix review, 10 October 2026): notes stop on every live call now, not only on the next one, and every
    // recap still waiting is skipped (lines are refused and no recap is written either: call-notes, call-recap).
    const { stopCallNotes } = await import("@/server/services/call-notes");
    await stopCallNotes(ctx.org.id);
  }
  if (changed && key === "standup" && !p.offered) {
    // Today's open standups end now (the sweep would do it within the hour): drafts cancelled, open rollups skipped.
    try {
      const { cancelStandupDay } = await import("@/server/services/standup");
      const days = await withWorker((db) => db.query<{ team_id: string; local_date: string }>(
        `SELECT DISTINCT r.team_id, r.local_date FROM standup_rollups r WHERE r.organisation_id = $1 AND (r.status = 'open' OR r.local_date = $2::date)`,
        [ctx.org.id, localDate(new Date(), ctx.org.timezone)]));
      for (const d of days) await cancelStandupDay(d.team_id, d.local_date);
    } catch (err) { console.warn(`[abilities] cancelling today's standups: ${(err as Error)?.message ?? String(err)}`); }
  }
  return abilitiesView(ctx);
}
