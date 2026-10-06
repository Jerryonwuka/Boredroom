import Link from "next/link";
import { FolderKanban } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { ToolSquare } from "@/components/ui/tool-tile";
import { listProjects } from "@/server/services/views";
import { withUser } from "@/server/db";
import { NewProjectForm } from "@/components/app/project-forms";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Projects" };

/**
 * Projects, v4: a grid of cards (r12 p20), each with its name, a line of description and three figures (open, blocked,
 * members), under underline tabs for active and archived projects. A card opens the project's board.
 */
export default async function ProjectsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ status?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/projects`);
  const projects = await listProjects(ctx);
  const canCreate = ["owner", "hr", "manager"].includes(ctx.membership.role);
  const members = canCreate ? await withUser(ctx.user.profileId, (db) => db.query<{ id: string; display_name: string }>(`SELECT m.id, pr.display_name FROM memberships m JOIN profiles pr ON pr.id = m.user_id WHERE m.organisation_id = $1 AND m.status = 'active' ORDER BY pr.display_name`, [ctx.org.id])) : [];
  const base = `/app/${ctx.org.slug}`;
  const status = sp.status === "active" || sp.status === "archived" ? sp.status : "all";
  const active = projects.filter((p) => p.status === "active");
  const archived = projects.filter((p) => p.status !== "active");
  const shown = status === "active" ? active : status === "archived" ? archived : projects;
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Projects" description="Tasks live inside projects. Archive a project to stop new sessions without deleting history."
        actions={canCreate ? <NewProjectForm orgSlug={ctx.org.slug} members={members.filter((m) => m.id !== ctx.membership.id)} /> : null}
        tabs={projects.length ? [
          { value: "all", label: "All", count: projects.length, href: `${base}/projects` },
          { value: "active", label: "Active", count: active.length, href: `${base}/projects?status=active` },
          { value: "archived", label: "Archived", count: archived.length, href: `${base}/projects?status=archived` },
        ] : undefined} tabValue={status} tabParam="status" tabsLabel="Project status" />
      {projects.length === 0 ? <EmptyState icon={FolderKanban} title="No projects yet" description={canCreate ? "Press New project to create the first one, then add its tasks." : "When a team lead adds you to a project, it appears here."} />
        : shown.length === 0 ? <EmptyState icon={FolderKanban} title={status === "archived" ? "Nothing archived" : "No active projects"} description={status === "archived" ? "Archived projects appear here, with all their history." : "Every project is archived. Create a new one to start work again."} /> : (
        <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {shown.map((p) => (
            <li key={p.id} className="min-w-0">
              <Link href={`${base}/projects/${p.id}`} className={cn("card-stat flex h-full min-h-[184px] flex-col outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]", p.status !== "active" && "opacity-70")}>
                <span className="flex items-start justify-between gap-3">
                  <ToolSquare><FolderKanban /></ToolSquare>
                  {p.status === "active" ? <Badge tone="success" dot>Active</Badge> : <Badge tone="info">Archived</Badge>}
                </span>
                <span className="mt-4 block truncate text-sm font-semibold text-foreground">{p.name}</span>
                <span className="mt-0.5 line-clamp-2 text-meta font-normal text-secondary">{p.description || "No description"}</span>
                <dl className="mt-auto grid grid-cols-3 gap-3 pt-5">
                  <div><dt className="text-xs font-medium text-subtle">Open</dt><dd className="text-sm font-medium tabular-nums text-foreground">{p.open_tasks}</dd></div>
                  <div><dt className="text-xs font-medium text-subtle">Blocked</dt><dd className={cn("text-sm font-medium tabular-nums", p.blocked_tasks ? "text-danger" : "text-foreground")}>{p.blocked_tasks}</dd></div>
                  <div><dt className="text-xs font-medium text-subtle">Members</dt><dd className="text-sm font-medium tabular-nums text-foreground">{p.members}</dd></div>
                </dl>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
