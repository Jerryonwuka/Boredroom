import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { auditView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit" };

export default async function AuditPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ action?: string; from?: string; to?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/audit`);
  const rows = await auditView(ctx, { action: sp.action, from: sp.from ? new Date(sp.from).toISOString() : undefined, to: sp.to ? new Date(new Date(sp.to).getTime() + 86400000).toISOString() : undefined });
  const scope = { owner: "the whole organisation", hr: "operational events across the organisation", manager: "your own actions and your teams' review events", employee: "events about your own records" }[ctx.membership.role];
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline="History" title="Audit" description={`Who did what and when. You can see ${scope}. Entries cannot be edited or deleted from the application.`} />
      <form className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm"><span className="block text-xs text-fg-subtle">Action prefix</span><Input name="action" defaultValue={sp.action ?? ""} placeholder="e.g. session., review., invitation." className="w-56" /></label>
        <label className="text-sm"><span className="block text-xs text-fg-subtle">From</span><Input name="from" type="date" defaultValue={sp.from ?? ""} /></label>
        <label className="text-sm"><span className="block text-xs text-fg-subtle">To</span><Input name="to" type="date" defaultValue={sp.to ?? ""} /></label>
        <Button type="submit" variant="outline" size="sm">Filter</Button>
      </form>
      {rows.length === 0 ? <EmptyState title="No events match" /> : (
        <DataTable caption="Audit events">
          <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Subject</th><th>Details</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="whitespace-nowrap text-sm">{formatDateTime(r.occurred_at, ctx.org.timezone)}</td>
              <td><code className="text-xs">{r.action}</code></td>
              <td>{r.actor_name ?? <span className="text-fg-subtle">system</span>}</td>
              <td>{r.subject_name ?? r.subject_type}</td>
              <td className="max-w-md truncate text-xs text-fg-muted" title={JSON.stringify(r.metadata)}>{Object.entries(r.metadata).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => `${k}=${String(v)}`).join(" · ")}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
    </AppShell>
  );
}
