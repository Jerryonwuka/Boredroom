import { getCurrentUser } from "@/server/auth";
import { listMyWorkspaces } from "@/server/services/orgs";
import { WorkspaceNotFoundView } from "@/components/app/workspace-not-found";

/** Says whether the workspace or only the page inside it was not found (see WorkspaceNotFoundView). */
export default async function WorkspaceNotFound() {
  const user = await getCurrentUser();
  const workspaces = user ? await listMyWorkspaces(user.profileId) : [];
  return <WorkspaceNotFoundView workspaces={workspaces.map((w) => ({ slug: w.slug, name: w.name }))} />;
}
