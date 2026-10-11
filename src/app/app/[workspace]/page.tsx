import { redirect } from "next/navigation";
import { workspacePage, homeFor } from "@/server/lib/workspace-page";
import { welcomeGatePath } from "@/server/services/welcome";

/**
 * A bare workspace address opens the assistant's page, or the first-run welcome while it is unfinished (owner request,
 * 11 October 2026: at most twice, never while impersonated, never before migration 0056; services/welcome).
 */
export default async function WorkspaceIndex({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx } = await workspacePage(workspace, `/app/${workspace}`);
  redirect((await welcomeGatePath(ctx)) ?? homeFor(ctx));
}
