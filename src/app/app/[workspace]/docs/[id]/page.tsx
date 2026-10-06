import { cache } from "react";
import Link from "next/link";
import type { Metadata } from "next";
import { workspacePage } from "@/server/lib/workspace-page";
import { orgContext } from "@/server/lib/api";
import { withUser } from "@/server/db";
import { AppShell } from "@/components/app/shell";
import { EmptyState } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { DocsEditor } from "@/components/app/docs-editor";
import { getDoc, listDocs } from "@/server/services/docs";

export const dynamic = "force-dynamic";

/** One read per request for the title and the page (React's cache; orgContext is cached the same way). */
const loadDoc = cache(async (slug: string, id: string) => getDoc(await orgContext(slug), id));
const serverNow = () => Date.now();

export async function generateMetadata({ params }: { params: Promise<{ workspace: string; id: string }> }): Promise<Metadata> {
  const { workspace, id } = await params;
  try {
    return { title: (await loadDoc(workspace, id))?.title ?? "Docs" };
  } catch {
    return { title: "Docs" }; // signed out or not a member: the page itself redirects or shows the workspace's not-found
  }
}

/**
 * A document: the editor for its writer, the owner and HR, the reading view for everyone else it is shared with
 * (owner decision, 5 October 2026). Brenda links here as /app/<slug>/docs/<id>. ?new=1 (set by New document) opens it
 * with the title selected.
 */
export default async function DocPage({ params, searchParams }: { params: Promise<{ workspace: string; id: string }>; searchParams: Promise<{ new?: string }> }) {
  const { workspace, id } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/docs/${id}`);
  const doc = await loadDoc(workspace, id);
  const base = `/app/${ctx.org.slug}`;
  if (!doc) {
    return (
      <AppShell ctx={ctx} counts={counts} teams={teams}>
        <EmptyState icon3d="box-doc-check" title="This document isn't available"
          description="It may have been archived, or it isn't shared with you. Ask the person who wrote it to share it with your team or with everyone."
          action={<Link href={`${base}/docs`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Back to Docs</Link>} />
      </AppShell>
    );
  }
  const isOrg = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  // Sharing choices: the organisation owner and HR can share with any team; everyone else with the teams they are on.
  const [folders, shareTeams]: [string[], { id: string; name: string }[]] = doc.canEdit
    ? await Promise.all([
        listDocs(ctx, { limit: 1 }).then((r) => r.folders.map((f) => f.name)),
        isOrg
          ? withUser(ctx.user.profileId, (db) => db.query<{ id: string; name: string }>(`SELECT id, name FROM teams WHERE organisation_id = $1 AND archived_at IS NULL ORDER BY name`, [ctx.org.id]))
          : Promise.resolve(teams.map((t) => ({ id: t.id, name: t.name }))),
      ])
    : [[], []];
  // A document already shared with a team the person is not on keeps that team on offer.
  if (doc.teamId && !shareTeams.some((t) => t.id === doc.teamId)) shareTeams.push({ id: doc.teamId, name: doc.teamName ?? "Team" });
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <DocsEditor key={doc.id} orgSlug={ctx.org.slug} orgName={ctx.org.name} doc={doc} folders={folders} teams={shareTeams}
        viewerMembershipId={ctx.membership.id} isNew={sp.new === "1"} now={serverNow()} />
    </AppShell>
  );
}
