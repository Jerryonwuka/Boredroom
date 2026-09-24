/**
 * Workspace search for the top bar: tasks, people, projects and teams by name, a handful of each.
 * Row-level security decides what the searcher may see; this only asks.
 */
import { z } from "zod";
import type { OrgContext } from "@/server/lib/api";
import { withUser } from "@/server/db";

export const searchSchema = z.object({ q: z.string().trim().min(1).max(120) });

export type SearchHit = { kind: "task" | "person" | "project" | "team"; id: string; title: string; hint: string | null; href: string };
export type SearchResult = { hits: SearchHit[]; q: string };

export async function searchWorkspace(ctx: OrgContext, q: string): Promise<SearchResult> {
  const base = `/app/${ctx.org.slug}`;
  const supervisor = ctx.membership.role !== "employee";
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return withUser(ctx.user.profileId, async (db) => {
    // One client, so the statements run one after another (pg queues concurrent queries on a client and warns).
    const tasks = await db.query<{ id: string; title: string; status: string; assignee: string | null }>(
        `SELECT t.id, t.title, t.status, pr.display_name AS assignee
         FROM tasks t LEFT JOIN memberships m ON m.id = t.assignee_membership_id LEFT JOIN profiles pr ON pr.id = m.user_id
         WHERE t.organisation_id = $1 AND t.archived_at IS NULL AND t.title ILIKE $2 ESCAPE '\\'
         ORDER BY (t.status = 'completed'), t.updated_at DESC LIMIT 5`, [ctx.org.id, like]);
    const people = await db.query<{ id: string; display_name: string; role: string; teams: string[] }>(
        `SELECT m.id, pr.display_name, m.role,
                COALESCE((SELECT array_agg(t.name ORDER BY t.name) FROM team_members tm JOIN teams t ON t.id = tm.team_id WHERE tm.membership_id = m.id AND t.archived_at IS NULL), '{}') AS teams
         FROM memberships m JOIN profiles pr ON pr.id = m.user_id
         WHERE m.organisation_id = $1 AND m.status = 'active' AND pr.display_name ILIKE $2 ESCAPE '\\'
         ORDER BY pr.display_name LIMIT 5`, [ctx.org.id, like]);
    const projects = await db.query<{ id: string; name: string }>(`SELECT id, name FROM projects WHERE organisation_id = $1 AND status = 'active' AND name ILIKE $2 ESCAPE '\\' ORDER BY name LIMIT 4`, [ctx.org.id, like]);
    const teams = await db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL AND name ILIKE $2 ESCAPE '\\' ORDER BY name LIMIT 4`, [ctx.org.id, like]);
    const roleLabel: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };
    const hits: SearchHit[] = [
      ...tasks.map((t) => ({ kind: "task" as const, id: t.id, title: t.title, hint: [t.status.replace("_", " "), t.assignee].filter(Boolean).join(", "), href: `${base}/tasks/${t.id}` })),
      ...people.map((p) => ({ kind: "person" as const, id: p.id, title: p.display_name, hint: [roleLabel[p.role] ?? p.role, ...p.teams].join(", "), href: supervisor ? `${base}/workroom/${p.id}` : `${base}/messages` })),
      ...projects.map((p) => ({ kind: "project" as const, id: p.id, title: p.name, hint: "Project", href: `${base}/projects/${p.id}` })),
      ...teams.map((t) => ({ kind: "team" as const, id: t.id, title: t.name, hint: "Team", href: `${base}/teams/${t.id}` })),
    ];
    return { hits, q };
  });
}
