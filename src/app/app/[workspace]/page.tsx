import { redirect } from "next/navigation";
import { workspacePage, homeFor } from "@/server/lib/workspace-page";

export default async function WorkspaceIndex({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, teams } = await workspacePage(workspace, `/app/${workspace}`);
  redirect(homeFor(ctx, teams));
}
