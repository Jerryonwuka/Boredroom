import { notFound, redirect } from "next/navigation";
import { orgContext, type OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { navCounts, workspaceShell } from "@/server/services/workspace";
import { myTeams } from "@/server/services/views";

/** Role-based landing page: organisation account → dashboard, team lead → first team board, staff → My Day. */
export function homeFor(ctx: OrgContext, teams: { id: string; is_manager: boolean }[]): string {
  const base = `/app/${ctx.org.slug}`;
  if (ctx.membership.role === "owner" || ctx.membership.role === "hr") return `${base}/dashboard`;
  const lead = teams.find((t) => t.is_manager);
  return lead ? `${base}/teams/${lead.id}` : `${base}/my-day`;
}

/** Resolves the workspace for a server page. Unauthenticated → login; not a member → 404. */
export async function workspacePage(slug: string, currentPath: string): Promise<{ ctx: OrgContext; counts: Awaited<ReturnType<typeof navCounts>>; teams: Awaited<ReturnType<typeof myTeams>> }> {
  let ctx: OrgContext;
  try {
    ctx = await orgContext(slug);
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  if (!ctx.user.emailVerified) redirect(`/verify/pending?next=${encodeURIComponent(currentPath)}`);
  // One statement for counts, teams and the policy check: on a distant database every round trip shows.
  const { counts, teams, acknowledged } = await workspaceShell(ctx, { checkPolicy: !currentPath.endsWith("/policy") });
  if (!acknowledged) redirect(`/app/${slug}/policy?required=1&next=${encodeURIComponent(currentPath)}`);
  return { ctx, counts, teams };
}
