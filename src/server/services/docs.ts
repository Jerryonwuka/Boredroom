/**
 * Docs (owner decision, 5 October 2026): documents written in Boredroom, by people or by Brenda on their behalf.
 * Notes, SOPs, meeting notes, reports, policy drafts and the staff handbook live here as markdown, each with a title,
 * an optional folder and who can read it: only the writer (private), one team, or everyone in the organisation.
 *
 * Everything runs as the person under row-level security (db/migrations/0028_documents.sql): what they cannot read is
 * simply absent, and only the writer, the owner and HR may change or archive a document. Archiving hides a document
 * from everyone; nothing is deleted. Saves carry the updatedAt the editor loaded, so two people editing at once get a
 * conflict instead of silently overwriting each other.
 */
import { z } from "zod";
import { withUser, type Db } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { conflict, forbidden, invalid, notFound } from "@/server/lib/errors";
import { audit } from "@/server/services/common";

export const DOC_VISIBILITIES = ["private", "team", "organisation"] as const;
export type DocVisibility = (typeof DOC_VISIBILITIES)[number];

export type DocSummary = {
  id: string; title: string; folder: string | null; visibility: DocVisibility; teamId: string | null; teamName: string | null; pinned: boolean;
  createdBy: { membershipId: string; name: string };
  updatedAt: string; createdAt: string;
  /** The first ~160 characters of the text, markdown stripped. */
  excerpt: string;
  /** The writer, the owner and HR may change and archive a document; everyone else who can see it reads it. */
  canEdit: boolean;
};
export type Doc = DocSummary & { body: string };

export const DOC_TITLE_MAX = 200;
export const DOC_BODY_MAX = 200_000;
export const DOC_FOLDER_MAX = 80;

export const createDocSchema = z.object({
  title: z.string().trim().min(1).max(DOC_TITLE_MAX),
  body: z.string().max(DOC_BODY_MAX).optional(),
  folder: z.string().trim().max(DOC_FOLDER_MAX).nullable().optional(),
  visibility: z.enum(DOC_VISIBILITIES).optional(),
  teamId: z.string().uuid().nullable().optional(),
});

export const updateDocSchema = z.object({
  /** The updatedAt the editor loaded; a save against an older version is refused with 409. */
  expectedUpdatedAt: z.string().datetime({ offset: true }).optional(),
  title: z.string().trim().min(1).max(DOC_TITLE_MAX).optional(),
  /** Replaces the text. */
  body: z.string().max(DOC_BODY_MAX).optional(),
  /** Adds to the end of the text, after a blank line. */
  appendBody: z.string().min(1).max(DOC_BODY_MAX).optional(),
  /** null (or empty) takes the document out of its folder. */
  folder: z.string().trim().max(DOC_FOLDER_MAX).nullable().optional(),
  visibility: z.enum(DOC_VISIBILITIES).optional(),
  /** Naming a team without a visibility shares the document with that team. */
  teamId: z.string().uuid().nullable().optional(),
  pinned: z.boolean().optional(),
});

type DocRow = {
  id: string; title: string; folder: string | null; visibility: DocVisibility; team_id: string | null; team_name: string | null; pinned: boolean;
  created_by: string; created_by_name: string; updated_at: string; created_at: string; head: string; can_edit: boolean;
};

const isUuid = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
const isOrgAccount = (ctx: OrgContext) => ctx.membership.role === "owner" || ctx.membership.role === "hr";

/** Every read goes through this select, so the shape and the edit rule are the same everywhere. $1 org, $2 me, $3 org account. */
const DOC_SELECT = `
  SELECT d.id, d.title, d.folder, d.visibility, d.team_id, t.name AS team_name, d.pinned, d.created_by, pr.display_name AS created_by_name,
         d.updated_at, d.created_at, left(d.body, 600) AS head, (d.created_by = $2 OR $3::boolean) AS can_edit
  FROM documents d
  JOIN memberships m ON m.id = d.created_by JOIN profiles pr ON pr.id = m.user_id
  LEFT JOIN teams t ON t.id = d.team_id`;

function toSummary(r: DocRow): DocSummary {
  return {
    id: r.id, title: r.title, folder: r.folder, visibility: r.visibility, teamId: r.team_id, teamName: r.team_name, pinned: r.pinned,
    createdBy: { membershipId: r.created_by, name: r.created_by_name },
    updatedAt: r.updated_at, createdAt: r.created_at, excerpt: excerptOf(r.head), canEdit: r.can_edit,
  };
}

/** Plain text from the start of a markdown body, cut on a word at about 160 characters. */
export function excerptOf(markdown: string, max = 160): string {
  const text = markdown
    .replace(/```[\s\S]*?(```|$)/g, " ")          // code blocks
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")      // images: keep the alt text
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")       // links: keep the text
    .replace(/<[^>]+>/g, " ")                       // html tags
    .replace(/^\s{0,3}(#{1,6}\s+|>\s?|[-*+]\s+(\[[ xX]\]\s+)?|\d+[.)]\s+)/gm, "") // headings, quotes, list markers
    .replace(/^\s*([-*_]\s*){3,}$/gm, " ")         // horizontal rules
    .replace(/\|/g, " ")                            // table pipes
    .replace(/(\*\*|__|~~|`|\*)/g, "")              // emphasis and inline code
    .replace(/\s+/g, " ")
    .trim();
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

function normaliseFolder(v: string | null | undefined): string | null | undefined {
  if (v === undefined) return undefined;
  const f = (v ?? "").replace(/\s+/g, " ").trim();
  return f ? f.slice(0, DOC_FOLDER_MAX) : null;
}

/** Brenda calls these services directly, so input is checked here as well as in the routes. Titles are one line. */
function parse<T extends { title?: string }>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (r.success) return r.data.title === undefined ? r.data : { ...r.data, title: r.data.title.replace(/\s+/g, " ") };
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of r.error.issues) (fieldErrors[issue.path.join(".") || "_"] ??= []).push(issue.message);
  throw invalid("Check the highlighted fields.", fieldErrors);
}

async function liveTeam(db: Db, orgId: string, teamId: string): Promise<{ id: string; name: string }> {
  const t = await db.maybeOne<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE id = $1 AND organisation_id = $2 AND archived_at IS NULL`, [teamId, orgId]);
  if (!t) throw invalid("That team does not exist here.", { teamId: ["Pick one of the organisation's teams."] });
  return t;
}

async function readDoc(db: Db, ctx: OrgContext, id: string): Promise<Doc | null> {
  const r = await db.maybeOne<DocRow & { body: string }>(`${DOC_SELECT.replace("SELECT d.id,", "SELECT d.body, d.id,")} WHERE d.id = $4 AND d.organisation_id = $1`, [ctx.org.id, ctx.membership.id, isOrgAccount(ctx), id]);
  return r ? { ...toSummary(r), body: r.body } : null;
}

/**
 * The library: the documents the person can read, newest first with pinned ones on top, or ranked by relevance when
 * searching (full text over title and body, and the title by substring so a half-typed word still finds it).
 * `folder` undefined lists every folder; a name lists that folder; null lists only documents in no folder.
 * The folder list (with counts) always covers everything the person can read.
 */
export async function listDocs(ctx: OrgContext, opts: { q?: string; folder?: string | null; limit?: number } = {}): Promise<{ docs: DocSummary[]; folders: { name: string; count: number }[] }> {
  const q = (opts.q ?? "").trim().slice(0, 200);
  const folder = opts.folder === undefined ? undefined : normaliseFolder(opts.folder);
  const limit = Math.max(1, Math.min(200, Math.round(opts.limit ?? 100)));
  return withUser(ctx.user.profileId, async (db) => {
    const params: unknown[] = [ctx.org.id, ctx.membership.id, isOrgAccount(ctx)];
    const where = [`d.organisation_id = $1`];
    if (folder === null) where.push(`d.folder IS NULL`);
    else if (folder !== undefined) { params.push(folder); where.push(`d.folder = $${params.length}`); }
    let order = `d.pinned DESC, d.updated_at DESC`;
    if (q) {
      params.push(q); const tsq = `websearch_to_tsquery('english', $${params.length})`;
      params.push(`%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`); const like = `$${params.length}`;
      where.push(`(d.search @@ ${tsq} OR d.title ILIKE ${like} ESCAPE '\\')`);
      order = `ts_rank(d.search, ${tsq}) DESC, (d.title ILIKE ${like} ESCAPE '\\') DESC, d.updated_at DESC`;
    }
    params.push(limit);
    const rows = await db.query<DocRow>(`${DOC_SELECT} WHERE ${where.join(" AND ")} ORDER BY ${order} LIMIT $${params.length}`, params);
    const folders = await db.query<{ name: string; count: number }>(
      `SELECT folder AS name, count(*)::int AS count FROM documents WHERE organisation_id = $1 AND folder IS NOT NULL GROUP BY folder ORDER BY lower(folder)`, [ctx.org.id]);
    return { docs: rows.map(toSummary), folders };
  });
}

/** One document in full, or null when it does not exist, is archived or is not shared with the person. */
export async function getDoc(ctx: OrgContext, id: string): Promise<Doc | null> {
  if (!isUuid(id)) return null;
  return withUser(ctx.user.profileId, (db) => readDoc(db, ctx, id));
}

/** A new document, private unless shared with a team or everyone. Any member may write one. */
export async function createDoc(ctx: OrgContext, raw: z.input<typeof createDocSchema>, requestId?: string): Promise<Doc> {
  const input = parse(createDocSchema, raw);
  const visibility = input.visibility ?? (input.teamId ? "team" : "private");
  if (visibility === "team" && !input.teamId) throw invalid("Pick the team that should see it.", { teamId: ["Required when the document is shared with a team."] });
  return withUser(ctx.user.profileId, async (db) => {
    const team = visibility === "team" ? await liveTeam(db, ctx.org.id, input.teamId!) : null;
    const d = await db.one<{ id: string }>(
      `INSERT INTO documents(organisation_id, created_by, title, body, folder, visibility, team_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [ctx.org.id, ctx.membership.id, input.title, input.body ?? "", normaliseFolder(input.folder) ?? null, visibility, team?.id ?? null]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "document.created", subjectType: "document", subjectId: d.id, subjectMembershipId: ctx.membership.id, requestId, metadata: { title: input.title, visibility, teamId: team?.id ?? null } });
    return (await readDoc(db, ctx, d.id))!;
  });
}

/**
 * Changes a document: title, text (replaced, or added to the end), folder, who can read it, pinned. Only the writer,
 * the owner and HR may; a reader who may not gets 403, someone who cannot see it 404. With expectedUpdatedAt, a save
 * against a version someone else has since changed is refused with 409 and the current updatedAt.
 */
export async function updateDoc(ctx: OrgContext, id: string, raw: z.input<typeof updateDocSchema>, requestId?: string): Promise<Doc> {
  const input = parse(updateDocSchema, raw);
  if (input.body !== undefined && input.appendBody !== undefined) throw invalid("Replace the text or add to it, not both.", { appendBody: ["Leave out when replacing the text."] });
  if (!isUuid(id)) throw notFound("Document not found.");
  return withUser(ctx.user.profileId, async (db) => {
    const seen = await readDoc(db, ctx, id);
    if (!seen) throw notFound("Document not found.");
    if (!seen.canEdit) throw forbidden(`Only ${seen.createdBy.name}, who wrote it, or the organisation owner or HR can change this document.`);
    // The row as it is now, locked until this save commits (the read above only established who may change it). It is
    // gone if someone archived it in between.
    const cur = await db.maybeOne<{ title: string; body: string; folder: string | null; pinned: boolean; updated_at: string; visibility: DocVisibility; team_id: string | null; created_by: string }>(
      `SELECT title, body, folder, pinned, updated_at, visibility, team_id, created_by FROM documents WHERE id = $1 AND organisation_id = $2 FOR UPDATE`, [id, ctx.org.id]);
    if (!cur) throw notFound("Document not found.");
    // Both sides go through the same timestamp parser (millisecond ISO strings), so compare instants, not text.
    if (input.expectedUpdatedAt && Date.parse(input.expectedUpdatedAt) !== Date.parse(cur.updated_at)) {
      throw conflict("VERSION_CONFLICT", "Someone changed this document since you opened it. Reload to see their version, then make your change again.", { currentUpdatedAt: cur.updated_at });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    const push = (col: string, val: unknown) => { params.push(val); sets.push(`${col} = $${params.length}`); };
    const changed: string[] = [];
    if (input.title !== undefined && input.title !== cur.title) { push("title", input.title); changed.push("title"); }
    if (input.body !== undefined && input.body !== cur.body) { push("body", input.body); changed.push("body"); }
    if (input.appendBody !== undefined) {
      const head = cur.body.replace(/\s+$/, "");
      const next = head ? `${head}\n\n${input.appendBody}` : input.appendBody;
      if (next.length > DOC_BODY_MAX) throw invalid("The document would be too long. Start a new one for the rest.", { appendBody: ["Too long."] });
      push("body", next); changed.push("body");
    }
    if (input.folder !== undefined) { const f = normaliseFolder(input.folder) ?? null; if (f !== cur.folder) { push("folder", f); changed.push("folder"); } }
    const visibility: DocVisibility = input.visibility ?? (input.teamId ? "team" : cur.visibility);
    const teamId = visibility === "team" ? (input.teamId ?? cur.team_id) : null;
    if (visibility === "team" && !teamId) throw invalid("Pick the team that should see it.", { teamId: ["Required when the document is shared with a team."] });
    if (visibility !== cur.visibility || teamId !== cur.team_id) {
      if (teamId) await liveTeam(db, ctx.org.id, teamId);
      push("visibility", visibility); push("team_id", teamId); changed.push("visibility");
    }
    if (input.pinned !== undefined && input.pinned !== cur.pinned) { push("pinned", input.pinned); changed.push("pinned"); }
    if (!changed.length) return seen;
    // Pinning is a library preference, not an edit: it does not move the document up the list or trip other editors.
    if (changed.some((c) => c !== "pinned")) sets.push("updated_at = clock_timestamp()");
    params.push(id, ctx.org.id);
    await db.query(`UPDATE documents SET ${sets.join(", ")} WHERE id = $${params.length - 1} AND organisation_id = $${params.length}`, params);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "document.updated", subjectType: "document", subjectId: id, subjectMembershipId: cur.created_by, requestId, metadata: { title: input.title ?? cur.title, changed, visibility, teamId } });
    return (await readDoc(db, ctx, id))!;
  });
}

/** Hides a document from everyone (the writer, the owner and HR may). Nothing is deleted. */
export async function archiveDoc(ctx: OrgContext, id: string, requestId?: string): Promise<{ archived: true }> {
  if (!isUuid(id)) throw notFound("Document not found.");
  return withUser(ctx.user.profileId, async (db) => {
    const seen = await readDoc(db, ctx, id);
    if (!seen) throw notFound("Document not found.");
    if (!seen.canEdit) throw forbidden(`Only ${seen.createdBy.name}, who wrote it, or the organisation owner or HR can archive this document.`);
    await db.query(`SELECT app_archive_document($1)`, [id]);
    await audit(db, { organisationId: ctx.org.id, actorMembershipId: ctx.membership.id, action: "document.archived", subjectType: "document", subjectId: id, subjectMembershipId: seen.createdBy.membershipId, requestId, metadata: { title: seen.title } });
    return { archived: true as const };
  });
}
