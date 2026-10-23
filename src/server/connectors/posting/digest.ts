/**
 * Connected apps: what Boredroom posts in a workspace's chosen channel (owner decisions, 22 October 2026: connectors;
 * spec §10.2, open question 1's default). Per team: what was finished today (up to 15 titles, with first names), how many
 * are in review, in progress and blocked, the blocked titles with first names, and a link to Boredroom. Never hours, clock
 * times, lateness, attendance, idle, assistants' updates, notes from the team, decisions, commitments, rankings, or
 * anything from a connected app: this file reads tasks and teams only, never a connector_* table (a boundary test checks).
 * Worker context. Pure builders are exported for tests.
 */
import type { Db } from "@/server/db";
import { addDays, localMidnight } from "@/server/lib/time";
import { firstName } from "@/lib/follow-ups";

/** The neutral post every chat app renders (posting/post.ts). */
export type NeutralPost = { heading: string; lines: string[]; link?: { label: string; href: string } };

export const DIGEST_TITLES_MAX = 15;

export type TeamDay = {
  team: string;
  finished: { title: string; who: string }[];
  inReview: number;
  inProgress: number;
  blocked: { title: string; who: string }[];
};

const dateLabel = (date: string) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { timeZone: "UTC", weekday: "long", day: "numeric", month: "long" });
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** The digest's words from the facts (pure). */
export function digestPost(days: TeamDay[], o: { date: string; workspace: string; href: string; teamName?: string | null }): NeutralPost {
  const lines: string[] = [];
  for (const d of days) {
    if (days.length > 1 || !o.teamName) lines.push(`${d.team}`);
    if (d.finished.length) {
      lines.push(`Finished today: ${d.finished.length}`);
      for (const f of d.finished.slice(0, DIGEST_TITLES_MAX)) lines.push(`- ${f.title} (${f.who})`);
      if (d.finished.length > DIGEST_TITLES_MAX) lines.push(`- and ${d.finished.length - DIGEST_TITLES_MAX} more`);
    } else lines.push("Finished today: none yet");
    lines.push(`In review: ${d.inReview}. In progress: ${d.inProgress}. Blocked: ${d.blocked.length}.`);
    for (const b of d.blocked.slice(0, DIGEST_TITLES_MAX)) lines.push(`- Blocked: ${b.title} (${b.who})`);
    if (d.blocked.length > DIGEST_TITLES_MAX) lines.push(`- and ${d.blocked.length - DIGEST_TITLES_MAX} more blocked`);
  }
  if (!days.length) lines.push("No team work to report today.");
  return { heading: `${o.teamName ? `${o.teamName}'s` : `${o.workspace}'s`} day, ${dateLabel(o.date)}`, lines, link: { label: "Open Boredroom", href: o.href } };
}

/**
 * The standup rollup's words (pure): counts only (security fix, 22 October 2026). How many shared and how many said they
 * are blocked; never anyone's words or name (a person's own words leave Boredroom only by their own press), and never
 * who didn't share. The blockers themselves stay in Boredroom, behind the link.
 */
export function standupRollupPost(c: { team: string; dateLabel: string; members: number; posted: number; blockers: { name: string; text: string }[] }, href: string): NeutralPost {
  const blocked = new Set(c.blockers.map((b) => b.name)).size;
  const lines = blocked ? [`${plural(blocked, "person", "people")} blocked: the details are in Boredroom.`] : [];
  return { heading: `${c.team} standup, ${c.dateLabel}: ${c.posted} of ${c.members} shared.`, lines, link: { label: "Open the standup in Boredroom", href } };
}

/** A person's own standup, exactly as they shared it. */
export function personStandupPost(c: { name: string; sections: { label: string; text: string | null }[] }, href: string): NeutralPost {
  const lines: string[] = [];
  for (const s of c.sections) {
    if (!s.text?.trim()) continue;
    lines.push(`${s.label}:`);
    for (const l of s.text.split("\n").map((x) => x.trim()).filter(Boolean)) lines.push(l.startsWith("- ") ? l : `- ${l}`);
  }
  return { heading: `${firstName(c.name)}'s standup`, lines, link: { label: "Open Boredroom", href } };
}

/** The standup reminder (no names). */
export function standupReminderPost(team: string, href: string): NeutralPost {
  return { heading: `Today's standup for ${team} is open.`, lines: [], link: { label: "Share yours in Boredroom", href } };
}

/**
 * Today's facts for the digest, as the worker, scoped to the team's members' tasks (the report's own scoping, without its
 * person-level sections). `teamId` null: every team of the workspace, one section each.
 */
export async function teamDays(db: Db, orgId: string, teamId: string | null, date: string, timeZone: string): Promise<TeamDay[]> {
  const from = localMidnight(date, timeZone);
  const to = localMidnight(addDays(date, 1), timeZone);
  const teams = await db.query<{ id: string; name: string }>(
    `SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL AND ($2::uuid IS NULL OR id = $2) ORDER BY name LIMIT 30`, [orgId, teamId]);
  const out: TeamDay[] = [];
  for (const t of teams) {
    const rows = await db.query<{ title: string; status: string; name: string; finished: boolean }>(
      `SELECT k.title, k.status, p.display_name AS name, (k.status = 'completed' AND k.completed_at >= $3 AND k.completed_at < $4) AS finished
         FROM tasks k JOIN memberships m ON m.id = k.assignee_membership_id AND m.status = 'active' JOIN profiles p ON p.id = m.user_id
        WHERE k.organisation_id = $1 AND k.archived_at IS NULL
          AND k.assignee_membership_id IN (SELECT tm.membership_id FROM team_members tm WHERE tm.team_id = $2)
          AND (k.status IN ('in_progress', 'blocked', 'in_review') OR (k.status = 'completed' AND k.completed_at >= $3 AND k.completed_at < $4))
        ORDER BY k.completed_at DESC NULLS LAST, k.updated_at DESC LIMIT 400`, [orgId, t.id, from, to]);
    out.push({
      team: t.name,
      finished: rows.filter((r) => r.finished).map((r) => ({ title: r.title.replace(/\s+/g, " ").slice(0, 120), who: firstName(r.name) })),
      inReview: rows.filter((r) => r.status === "in_review").length,
      inProgress: rows.filter((r) => r.status === "in_progress").length,
      blocked: rows.filter((r) => r.status === "blocked").map((r) => ({ title: r.title.replace(/\s+/g, " ").slice(0, 120), who: firstName(r.name) })),
    });
  }
  return out;
}

export { plural };
