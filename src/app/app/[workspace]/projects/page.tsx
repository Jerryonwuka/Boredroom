import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { DataTable } from "@/components/ui/table";
import { listProjects } from "@/server/services/views";
import { withUser } from "@/server/db";
import { NewProjectForm } from "@/components/app/project-forms";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

export default async function ProjectsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts } = await workspacePage(workspace, `/app/${workspace}/projects`);
  const projects = await listProjects(ctx);
  const canCreate = ["owner", "hr", "manager"].includes(ctx.membership.role);
  const members = canCreate ? await withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY pr.display_name`, [ctx.org.id])) : [];
  return (
    <AppShell ctx={ctx} counts={counts}>
      <PageHeader overline="Projects" title="Projects" description="Tasks live inside projects. Archive a project to stop new sessions without deleting history." actions={canCreate ? <NewProjectForm orgSlug={ctx.org.slug} members={members.filter((m) => m.id !== ctx.membership.id)} /> : null} />
      {projects.length === 0 ? <EmptyState title="No projects yet" description={canCreate ? "Create the first project to start assigning tasks." : "A manager needs to create a project and add you to it."} /> : (
        <DataTable caption="Projects">
          <thead><tr><th>Project</th><th>Status</th><th>Open tasks</th><th>Blocked</th><th>Members</th></tr></thead>
          <tbody>
            {projects.map((p) => (
              <tr key={p.id}>
                <td><Link href={`/app/${ctx.org.slug}/projects/${p.id}`} className="font-semibold hover:underline">{p.name}</Link>{p.description ? <p className="text-sm text-fg-muted">{p.description}</p> : null}</td>
                <td><Badge tone={p.status === "active" ? "success" : "neutral"}>{p.status}</Badge></td>
                <td>{p.open_tasks}</td>
                <td>{p.blocked_tasks ? <span className="text-danger">{p.blocked_tasks}</span> : 0}</td>
                <td>{p.members}</td>
              </tr>
            ))}
          </tbody>
        </DataTable>
      )}
    </AppShell>
  );
}
