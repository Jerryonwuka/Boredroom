import type { Metadata } from "next";
import { Unlink } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Alert, EmptyState } from "@/components/ui/states";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { LookForLooseEnds, LooseEndsList } from "@/components/app/loose-ends-list";
import type { Person } from "@/components/app/loose-end-actions";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { listLooseEnds } from "@/server/services/loose-ends";
import { withUser } from "@/server/db";
import type { OrgContext } from "@/server/lib/api";
import { LOOP_LIMITS, LOOP_WORDS, type LooseEndList } from "@/lib/commitments";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Loose ends" };

const L = LOOP_WORDS.looseEnds;
/** A malformed id in the address marks nothing. */
const isId = (v: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

/**
 * Loose ends (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed", the personal loop closer;
 * contract D and H.1): what the person's own assistant found in the conversations they read (direct messages and
 * channels, and in channels only what involves them) that never became a to-do, reminder, follow-up or commitment:
 * promises they made ("I'll send the deck Thursday"), things asked of them ("Olu, can you review X by Friday?") and
 * things they asked of others ("Ben, can you fix the login bug?"). Grouped by kind, each with the message quoted as
 * typed, who, when, any date mentioned and its actions: Make it a to-do (always asks first), Remind me, Hand it to
 * someone's assistant (a request they accept), Follow up later, Not a commitment (remembered for good). What was acted on
 * sits under "Done", collapsed. `?l=` marks one and scrolls to it (the routine's output and her chat link here).
 *
 * "Look for loose ends" looks again now (once every two minutes; it uses one of the person's daily requests when the AI
 * is on, and finds only the clearest ones without it). Always the person's own: nobody else, the owner and HR included,
 * ever sees them. Not gated by the plan: the built-in look runs on every plan. Before migration 0048 the page shows its
 * header and an info alert, and the button is not offered.
 */
export default async function LooseEndsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ l?: string | string[] }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const l = [sp.l].flat()[0]?.trim();
  const highlight = l && isId(l) ? l : null;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/home/loose-ends`);
  const base = `/app/${ctx.org.slug}`;
  const [list, assistants] = await Promise.all([readLooseEnds(ctx), assistantProfiles(ctx)]);
  const { name } = assistants.personal;
  const people = list?.ready && list.items.some((v) => v.actions.includes("hand_over")) ? await handOverPeople(ctx) : [];
  const now = new Date();
  now.setSeconds(0, 0);
  const ready = list?.ready === true;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader back={{ href: `${base}/home`, label: `Back to ${name}` }} title={L.title} description={L.description(name)}
        actions={ready ? <LookForLooseEnds orgSlug={ctx.org.slug} /> : undefined} />
      <div className="w-full min-w-0 max-w-3xl">
        {!list ? (
          <Alert tone="danger">Your loose ends couldn&apos;t be read just now. Reload the page to try again.</Alert>
        ) : !list.ready ? (
          <Alert tone="info">{L.notReady}</Alert>
        ) : list.items.length ? (
          <LooseEndsList orgSlug={ctx.org.slug} items={list.items} people={people} timeZone={ctx.org.timezone} now={now.getTime()} highlight={highlight}
            noneOpen={<EmptyState compact icon={Unlink} title={L.noneOpen.title} description={L.noneOpen.body(name)} />} />
        ) : (
          <EmptyState icon={Unlink} title={L.empty.title} description={L.empty.body(name)} action={<LookForLooseEnds orgSlug={ctx.org.slug} />} />
        )}
      </div>
      <PageNotes>
        <PageNote>{L.privacy}</PageNote>
        {ready && list?.lastScanAt ? <PageNote>Last looked {new Intl.DateTimeFormat("en-GB", { timeZone: ctx.org.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(list.lastScanAt))}, in the organisation&apos;s time zone ({ctx.org.timezone}).</PageNote> : null}
      </PageNotes>
    </AppShell>
  );
}

/** Open first, then what was acted on; null when the read failed (`ready: false` before migration 0048). */
async function readLooseEnds(ctx: OrgContext): Promise<LooseEndList | null> {
  try {
    return await listLooseEnds(ctx, { status: "all", limit: LOOP_LIMITS.listMax });
  } catch (err) {
    console.warn(`[loose-ends] the list could not be read: ${(err as Error)?.message ?? String(err)}`);
    return null;
  }
}

/**
 * Who a loose end can be handed to: the workspace's active members but the person, by name. The request itself is
 * checked by the server (planRequest: mutes, limits, who may ask whom), whose words show in the sheet when it refuses.
 */
async function handOverPeople(ctx: OrgContext): Promise<Person[]> {
  try {
    const rows = await withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(
      `SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id
        WHERE m.organisation_id = $1 AND m.status = 'active' AND m.id <> $2 ORDER BY pr.display_name`, [ctx.org.id, ctx.membership.id]));
    return rows.map((r) => ({ membershipId: r.id, name: r.display_name }));
  } catch {
    return []; // the sheet then has nobody to pick; the other actions still work
  }
}
