/**
 * Personal assistants (owner decision, 7 October 2026: phase 1). Every person has their own assistant in each workspace
 * (a name, a sphere colour, a visor and eyes; Brenda unless they choose otherwise), and the workspace has one of its own,
 * edited by owners and HR, that signs what the workspace sends on its own (the end-of-day team report). Migration 0035
 * holds them: `assistant_profiles` (one row per membership; everyone in the workspace reads them, the person writes their
 * own) and the `assistant_*` columns of `brenda_settings`. The palette, the presets and the name rule live in
 * lib/assistant-look, shared with the client.
 *
 * The workspace pages read both through `assistantProfiles(ctx)`, once per request (the shell and the page share it).
 * Services that already hold a transaction (the clock-in notice, the reports, the desktop state) use the `read…`
 * functions with their own `db`.
 */
import { cache } from "react"; // React 19 exports cache in Node too (a pass-through outside a render), so the worker can import this file
import { z } from "zod";
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { forbidden } from "@/server/lib/errors";
import { logAction } from "@/server/services/brenda";
import {
  ASSISTANT_COLOURS, ASSISTANT_EYES, ASSISTANT_VISORS, DEFAULT_ASSISTANT, DEFAULT_PROFILES, EYES, PALETTE, VISORS,
  assistantNameProblem, normaliseAssistantName, toProfile,
  type AssistantProfile, type AssistantProfiles,
} from "@/lib/assistant-look";

/** What Settings and "Meet your assistant" send. The name is normalised first, then checked by the shared rule. */
export const assistantProfileSchema = z.object({
  name: z.string({ error: "Give your assistant a name." }).max(200).transform(normaliseAssistantName).superRefine((v, c) => {
    const p = assistantNameProblem(v);
    if (p) c.addIssue({ code: "custom", message: p });
  }),
  colour: z.enum(ASSISTANT_COLOURS, { error: "Pick one of the colours shown." }),
  visor: z.enum(ASSISTANT_VISORS, { error: "Pick one of the visors shown." }),
  eyes: z.enum(ASSISTANT_EYES, { error: "Pick one of the eyes shown." }),
});
export type AssistantProfileInput = z.infer<typeof assistantProfileSchema>;
/** The most a save's body may hold: four short fields need well under 1 KB, so anything larger is refused unread (413). */
export const ASSISTANT_BODY_MAX = 4096;

const canEdit = (ctx: Pick<OrgContext, "membership">) => ctx.membership.role === "owner" || ctx.membership.role === "hr";

// ---- Before migration 0035 -------------------------------------------------------------------------------------------
// The code may run before the migration is applied (a deploy, the running dev server). A missing table inside someone
// else's transaction (the clock-in notice, the report, the desktop state) would abort all of it, so the reads ask the
// catalogue first and fall back to Brenda. Once the schema is there the answer is kept for the life of the process, so
// it costs one round trip per process.

let schemaReady = false;
let warned = false;

/** True once migration 0035 is applied (assistant_profiles and brenda_settings.assistant_* exist). */
export async function assistantSchemaReady(db: Db): Promise<boolean> {
  if (schemaReady) return true;
  const r = await db.one<{ ok: boolean }>(
    `SELECT to_regclass('public.assistant_profiles') IS NOT NULL
        AND EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = to_regclass('public.brenda_settings') AND attname = 'assistant_eyes' AND NOT attisdropped) AS ok`);
  schemaReady = r.ok;
  if (!schemaReady) warnOnce();
  return schemaReady;
}

function warnOnce() {
  if (warned) return;
  warned = true;
  console.warn("[assistant] migration 0035 (personal assistants) is not applied yet: everyone sees Brenda until pnpm db:migrate runs.");
}

const isMissingSchema = (err: unknown) => {
  const code = (err as { code?: string } | null)?.code;
  return code === "42P01" || code === "42703";
};

// ---- Reading -----------------------------------------------------------------------------------------------------------

/** The person's own assistant in this workspace; Brenda (setup not done) when they have no row yet. */
export async function readPersonalAssistant(db: Db, membershipId: string): Promise<AssistantProfile & { setupDone: boolean }> {
  if (!(await assistantSchemaReady(db))) return { ...DEFAULT_ASSISTANT, setupDone: true };
  const row = await db.maybeOne<{ name: string; colour: string; visor: string; eyes: string; setup_done_at: string | null }>(
    `SELECT name, colour, visor, eyes, setup_done_at FROM assistant_profiles WHERE membership_id = $1`, [membershipId]);
  return { ...toProfile(row), setupDone: !!row?.setup_done_at };
}

/** The workspace's own assistant; Brenda when the organisation has no settings row yet. */
export async function readWorkspaceAssistant(db: Db, orgId: string): Promise<AssistantProfile> {
  if (!(await assistantSchemaReady(db))) return DEFAULT_ASSISTANT;
  const row = await db.maybeOne<{ name: string; colour: string; visor: string; eyes: string }>(
    `SELECT assistant_name AS name, assistant_colour AS colour, assistant_visor AS visor, assistant_eyes AS eyes FROM brenda_settings WHERE organisation_id = $1`, [orgId]);
  return toProfile(row);
}

type ProfilesRow = {
  name: string | null; colour: string | null; visor: string | null; eyes: string | null; setup_done_at: string | null;
  assistant_name: string | null; assistant_colour: string | null; assistant_visor: string | null; assistant_eyes: string | null;
};

/** Both assistants in one statement (a distant database: every round trip shows). */
export async function readAssistantProfiles(db: Db, ctx: Pick<OrgContext, "org" | "membership">): Promise<AssistantProfiles> {
  if (!(await assistantSchemaReady(db))) return { ...DEFAULT_PROFILES, setupDone: true, canEditWorkspace: canEdit(ctx) };
  const r = await db.one<ProfilesRow>(
    `SELECT p.name, p.colour, p.visor, p.eyes, p.setup_done_at,
            b.assistant_name, b.assistant_colour, b.assistant_visor, b.assistant_eyes
     FROM (SELECT 1) one
     LEFT JOIN assistant_profiles p ON p.membership_id = $2
     LEFT JOIN brenda_settings b ON b.organisation_id = $1`, [ctx.org.id, ctx.membership.id]);
  return {
    personal: toProfile(r),
    workspace: toProfile({ name: r.assistant_name, colour: r.assistant_colour, visor: r.assistant_visor, eyes: r.assistant_eyes }),
    setupDone: !!r.setup_done_at,
    canEditWorkspace: canEdit(ctx),
  };
}

/**
 * The person's own assistant and the workspace's, for the workspace pages. React's cache dedupes it per request: the
 * shell and the page call it with the same `ctx` object (from the cached `orgContext`). Before migration 0035 everyone
 * sees Brenda, and "Meet your assistant" never shows (there is no table to save to).
 */
export const assistantProfiles = cache(async (ctx: OrgContext): Promise<AssistantProfiles> => {
  try {
    return await withUser(ctx.user.profileId, (db) => readAssistantProfiles(db, ctx));
  } catch (err) {
    if (!isMissingSchema(err)) throw err;
    schemaReady = false;
    warnOnce();
    return { ...DEFAULT_PROFILES, setupDone: true, canEditWorkspace: canEdit(ctx) };
  }
});

// ---- Saving --------------------------------------------------------------------------------------------------------------

/**
 * The person's own assistant is theirs to choose: while a Boredroom administrator is signed in as them (support), it
 * stays as it is and setup stays not done, so they still meet it themselves (review, 7 October 2026; the shell already
 * hides "Meet your assistant" then, and brenda-history closes past chats the same way).
 */
const IMPERSONATED = "Only the person can change their assistant. It stays as it is while someone else is signed in as them.";
function notWhileImpersonated(ctx: OrgContext) {
  if (ctx.user.impersonation) throw forbidden(IMPERSONATED);
}

/** The person's own assistant. Saving from "Meet your assistant" or from Settings both count as setup done. Not logged: it is cosmetic. */
export async function saveMyAssistant(ctx: OrgContext, input: AssistantProfileInput): Promise<{ personal: AssistantProfile; setupDone: true }> {
  notWhileImpersonated(ctx);
  const row = await withUser(ctx.user.profileId, (db) => db.one<{ name: string; colour: string; visor: string; eyes: string }>(
    `INSERT INTO assistant_profiles(membership_id, organisation_id, name, colour, visor, eyes, setup_done_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, now(), now())
     ON CONFLICT (membership_id) DO UPDATE SET name = $3, colour = $4, visor = $5, eyes = $6,
       setup_done_at = COALESCE(assistant_profiles.setup_done_at, now()), updated_at = now()
     RETURNING name, colour, visor, eyes`,
    [ctx.membership.id, ctx.org.id, input.name, input.colour, input.visor, input.eyes]));
  return { personal: toProfile(row), setupDone: true };
}

/**
 * "Keep Brenda" (or closing "Meet your assistant"): setup is done, the look stays as it is. Someone who already chose a
 * look and somehow sees the dialog again keeps their look.
 */
export async function keepBrenda(ctx: OrgContext): Promise<{ personal: AssistantProfile; setupDone: true }> {
  notWhileImpersonated(ctx);
  const row = await withUser(ctx.user.profileId, (db) => db.one<{ name: string; colour: string; visor: string; eyes: string }>(
    `INSERT INTO assistant_profiles(membership_id, organisation_id, setup_done_at) VALUES ($1, $2, now())
     ON CONFLICT (membership_id) DO UPDATE SET setup_done_at = COALESCE(assistant_profiles.setup_done_at, now())
     RETURNING name, colour, visor, eyes`,
    [ctx.membership.id, ctx.org.id]));
  return { personal: toProfile(row), setupDone: true };
}

/** The workspace's own assistant (owners and HR). Only its columns change; the organisation's Brenda switches keep their values. */
export async function saveWorkspaceAssistant(ctx: OrgContext, input: AssistantProfileInput): Promise<{ workspace: AssistantProfile }> {
  if (!canEdit(ctx)) throw forbidden("Only the organisation owner or HR can change the workspace assistant.");
  return withUser(ctx.user.profileId, async (db) => {
    // The same lock as setBrendaSettings (brenda.ts): both write the organisation's one brenda_settings row.
    await db.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`brenda_settings:${ctx.org.id}`]);
    await db.query(
      `INSERT INTO brenda_settings(organisation_id, assistant_name, assistant_colour, assistant_visor, assistant_eyes, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, now())
       ON CONFLICT (organisation_id) DO UPDATE SET assistant_name = $2, assistant_colour = $3, assistant_visor = $4, assistant_eyes = $5, updated_by = $6, updated_at = now()`,
      [ctx.org.id, input.name, input.colour, input.visor, input.eyes, ctx.membership.id]);
    await logAction(db, ctx, {
      tool: "settings",
      summary: `Workspace assistant: ${input.name}, ${PALETTE[input.colour].label.toLowerCase()}, ${VISORS[input.visor].label.toLowerCase()}, ${EYES[input.eyes].label.toLowerCase()}`,
      outcome: "done", source: "confirm",
    });
    return { workspace: toProfile(input) };
  });
}
