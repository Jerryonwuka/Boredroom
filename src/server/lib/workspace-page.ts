import { notFound, redirect } from "next/navigation";
import { orgContext, type OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { navCounts, workspaceShell } from "@/server/services/workspace";
import { myTeams } from "@/server/services/views";

/** Where a workspace opens: Brenda Home, for everyone (owner decision, 5 October 2026). */
export function homeFor(ctx: OrgContext): string {
  return `/app/${ctx.org.slug}/home`;
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
  // One statement for counts and teams: on a distant database every round trip shows. No policy gate: the general
  // sign-off is gone (owner decision, 5 October 2026); consent to screen recording is asked when a recorded session starts.
  const { counts, teams } = await workspaceShell(ctx);
  return { ctx, counts, teams };
}
