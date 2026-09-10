import { notFound, redirect } from "next/navigation";
import { orgContext, type OrgContext } from "@/server/lib/api";
import { AppError } from "@/server/lib/errors";
import { navCounts, policyAcknowledged } from "@/server/services/workspace";

/** Resolves the workspace for a server page. Unauthenticated → login; not a member → 404. */
export async function workspacePage(slug: string, currentPath: string): Promise<{ ctx: OrgContext; counts: Awaited<ReturnType<typeof navCounts>> }> {
  let ctx: OrgContext;
  try {
    ctx = await orgContext(slug);
  } catch (err) {
    if (err instanceof AppError && err.status === 401) redirect(`/login?next=${encodeURIComponent(currentPath)}`);
    if (err instanceof AppError && err.status === 404) notFound();
    throw err;
  }
  if (!ctx.user.emailVerified) redirect(`/verify/pending?next=${encodeURIComponent(currentPath)}`);
  const counts = await navCounts(ctx);
  if (!currentPath.endsWith("/policy") && !(await policyAcknowledged(ctx))) redirect(`/app/${slug}/policy?required=1&next=${encodeURIComponent(currentPath)}`);
  return { ctx, counts };
}
