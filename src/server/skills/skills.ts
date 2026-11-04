/**
 * A workspace's skills (owner decisions, 4 November 2026: skills, phase 1). Owners and HR add a SKILL.md with up to 5
 * reference files, change, turn off and remove them, and turn Brenda's starter skills off and on. Everyone's Brenda
 * lists the skills turned on by name and "use when" and opens one with read_skill when a request matches it. Skills
 * come from the workspace's own admins, so they are the workspace's instructions, not outside words; they still never
 * change what waits for Confirm. Behind the CONNECTORS plan feature. Server-only.
 */
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { AppError, conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { requireFeature } from "@/server/lib/entitlements";
import { audit } from "@/server/services/common";
import { noteMissing0068, schema0068Missing } from "@/server/lib/schema-0068";
import { MCP_NOT_READY } from "@/lib/mcp/words";
import type { SkillFile, SkillView } from "@/lib/mcp/types";
import { BUILTIN_SKILLS, BUILTIN_SLUGS, builtinSkill } from "./builtin";
import { checkSkillFiles, parseSkillMd, type SkillProblem } from "./parse";

export const SKILLS_LISTED_MAX = 30;

type SkillRow = { id: string; slug: string; builtin: boolean; name: string | null; use_when: string | null; body: string | null; files: SkillFile[]; enabled: boolean };
const COLUMNS = "id, slug, builtin, name, use_when, body, files, enabled";

const notReady = () => new AppError(503, "NOT_READY", MCP_NOT_READY);

function requireAdmin(ctx: OrgContext): void {
  if (schema0068Missing()) throw notReady();
  requireFeature(ctx.plan, "CONNECTORS");
  if (ctx.membership.role !== "owner" && ctx.membership.role !== "hr") throw forbidden("Only the workspace's owner or HR can manage skills.");
  if (ctx.user.impersonation) throw forbidden("Skills can't be changed while signed in as someone else.");
}

async function skillsDb<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); }
  catch (err) { if (noteMissing0068(err)) throw notReady(); throw err; }
}

const problemsError = (problems: SkillProblem[]) =>
  invalid(problems[0].words, Object.fromEntries(problems.map((p) => [p.field, [p.words]])));

const fileSizes = (files: SkillFile[]) => files.map((f) => ({ name: f.name, size: Buffer.byteLength(f.text, "utf8") }));

function views(rows: SkillRow[]): SkillView[] {
  const off = new Set(rows.filter((r) => r.builtin).map((r) => r.slug));
  const builtins: SkillView[] = BUILTIN_SKILLS.map((b) => ({ id: null, slug: b.slug, name: b.name, useWhen: b.useWhen, builtin: true, enabled: !off.has(b.slug), body: null, files: [] }));
  const own: SkillView[] = rows.filter((r) => !r.builtin).map((r) => ({
    id: r.id, slug: r.slug, name: r.name ?? r.slug, useWhen: r.use_when ?? "", builtin: false, enabled: r.enabled, body: r.body, files: fileSizes(r.files ?? []),
  }));
  return [...own, ...builtins];
}

async function rowsOf(ctx: OrgContext): Promise<SkillRow[]> {
  return withUser(ctx.user.profileId, (db) => db.query<SkillRow>(`SELECT ${COLUMNS} FROM brenda_skills WHERE organisation_id = $1 ORDER BY lower(COALESCE(name, slug))`, [ctx.org.id]));
}

/** Every skill, the workspace's own first, then the starter skills (owners and HR). */
export async function listSkills(ctx: OrgContext): Promise<SkillView[]> {
  requireAdmin(ctx);
  return skillsDb(async () => views(await rowsOf(ctx)));
}

export type SkillInput = { skillMd: string; files?: { name: string; text: string }[] };

function readInput(input: SkillInput) {
  const parsed = parseSkillMd(input.skillMd ?? "");
  if ("problems" in parsed) throw problemsError(parsed.problems);
  const files = checkSkillFiles(input.files ?? []);
  if ("problems" in files) throw problemsError(files.problems);
  if (BUILTIN_SLUGS.has(parsed.skill.slug)) throw invalid("That name belongs to one of Brenda's starter skills. Give yours another name.", { name: ["Choose another name."] });
  return { ...parsed.skill, files: files.files };
}

/** Adds a skill from its SKILL.md and files; turned on at once. */
export async function addSkill(ctx: OrgContext, input: SkillInput): Promise<SkillView> {
  requireAdmin(ctx);
  const s = readInput(input);
  return skillsDb(() => withUser(ctx.user.profileId, async (db) => {
    if (await db.maybeOne(`SELECT 1 FROM brenda_skills WHERE organisation_id = $1 AND slug = $2`, [ctx.org.id, s.slug])) throw conflict("SKILL_NAME_TAKEN", "Another skill already has that name.");
    let row: SkillRow;
    try {
      row = await db.one<SkillRow>(`INSERT INTO brenda_skills(organisation_id, slug, name, use_when, body, files, added_by) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7) RETURNING ${COLUMNS}`,
        [ctx.org.id, s.slug, s.name, s.useWhen, s.body, JSON.stringify(s.files), ctx.membership.id]);
    } catch (err) {
      if ((err as { message?: string })?.message?.includes("SKILLS_FULL")) throw conflict("SKILLS_FULL", `A workspace can add up to ${SKILLS_LISTED_MAX} skills.`);
      throw err;
    }
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "skill.added", subjectType: "brenda_skill", subjectId: row.id, metadata: { slug: s.slug, files: s.files.length } });
    return views([row])[0];
  }));
}

/** Replaces a skill's SKILL.md and files (its name stays), or turns it on or off. */
export async function updateSkill(ctx: OrgContext, id: string, patch: { enabled?: boolean; skillMd?: string; files?: { name: string; text: string }[] }): Promise<SkillView> {
  requireAdmin(ctx);
  return skillsDb(() => withUser(ctx.user.profileId, async (db) => {
    const cur = await db.maybeOne<SkillRow>(`SELECT ${COLUMNS} FROM brenda_skills WHERE id = $1 AND organisation_id = $2 AND NOT builtin`, [id, ctx.org.id]);
    if (!cur) throw notFound();
    let next = { name: cur.name, useWhen: cur.use_when, body: cur.body, files: cur.files };
    if (patch.skillMd !== undefined) {
      const s = readInput({ skillMd: patch.skillMd, files: patch.files ?? cur.files });
      if (s.slug !== cur.slug) throw invalid("Keep the skill's name: to rename it, add it as a new skill and remove this one.", { name: [`Keep name: ${cur.slug}`] });
      next = { name: s.name, useWhen: s.useWhen, body: s.body, files: s.files };
    } else if (patch.files !== undefined) {
      const f = checkSkillFiles(patch.files);
      if ("problems" in f) throw problemsError(f.problems);
      next.files = f.files;
    }
    const row = await db.one<SkillRow>(`UPDATE brenda_skills SET name = $2, use_when = $3, body = $4, files = $5::jsonb, enabled = COALESCE($6, enabled) WHERE id = $1 RETURNING ${COLUMNS}`,
      [id, next.name, next.useWhen, next.body, JSON.stringify(next.files), typeof patch.enabled === "boolean" ? patch.enabled : null]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "skill.changed", subjectType: "brenda_skill", subjectId: id, metadata: { slug: cur.slug, ...(typeof patch.enabled === "boolean" ? { enabled: patch.enabled } : {}) } });
    return views([row])[0];
  }));
}

/** Turns one of Brenda's starter skills off (a row) or on again (no row). */
export async function setBuiltinSkill(ctx: OrgContext, slug: string, enabled: boolean): Promise<SkillView> {
  requireAdmin(ctx);
  const b = builtinSkill(slug);
  if (!b) throw notFound();
  return skillsDb(() => withUser(ctx.user.profileId, async (db) => {
    if (enabled) await db.query(`DELETE FROM brenda_skills WHERE organisation_id = $1 AND slug = $2 AND builtin`, [ctx.org.id, slug]);
    else await db.query(`INSERT INTO brenda_skills(organisation_id, slug, builtin, enabled, files, added_by) VALUES ($1, $2, true, false, '[]'::jsonb, $3) ON CONFLICT (organisation_id, slug) DO NOTHING`, [ctx.org.id, slug, ctx.membership.id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "skill.builtin", subjectType: "brenda_skill", subjectId: null, metadata: { slug, enabled } });
    return { id: null, slug, name: b.name, useWhen: b.useWhen, builtin: true, enabled, body: null, files: [] };
  }));
}

/** Removes one of the workspace's own skills. */
export async function removeSkill(ctx: OrgContext, id: string): Promise<{ removed: true }> {
  requireAdmin(ctx);
  return skillsDb(() => withUser(ctx.user.profileId, async (db) => {
    const cur = await db.maybeOne<{ slug: string }>(`DELETE FROM brenda_skills WHERE id = $1 AND organisation_id = $2 AND NOT builtin RETURNING slug`, [id, ctx.org.id]);
    if (!cur) throw notFound();
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, actorUserId: ctx.user.profileId, action: "skill.removed", subjectType: "brenda_skill", subjectId: id, metadata: { slug: cur.slug } });
    return { removed: true as const };
  }));
}

// ---- For Brenda ----------------------------------------------------------------------------------------------------------------

export type ActiveSkill = { slug: string; name: string; useWhen: string; body: string; files: SkillFile[]; builtin: boolean };

/**
 * The skills turned on for this workspace: its own first (up to 30), then the starter skills it didn't turn off. Any
 * member's Brenda reads them. Before 0068, or without the plan, the starter skills only.
 */
export async function activeSkills(ctx: OrgContext): Promise<ActiveSkill[]> {
  const builtins = (off: Set<string>) => BUILTIN_SKILLS.filter((b) => !off.has(b.slug)).map((b) => ({ ...b, files: [] as SkillFile[], builtin: true }));
  if (!ctx.plan.features.CONNECTORS) return [];
  if (schema0068Missing()) return builtins(new Set());
  let rows: SkillRow[];
  try { rows = await rowsOf(ctx); }
  catch (err) { if (noteMissing0068(err)) return builtins(new Set()); throw err; }
  const own = rows.filter((r) => !r.builtin && r.enabled && r.name && r.use_when && r.body).slice(0, SKILLS_LISTED_MAX)
    .map((r) => ({ slug: r.slug, name: r.name!, useWhen: r.use_when!, body: r.body!, files: r.files ?? [], builtin: false }));
  return [...own, ...builtins(new Set(rows.filter((r) => r.builtin).map((r) => r.slug)))];
}
