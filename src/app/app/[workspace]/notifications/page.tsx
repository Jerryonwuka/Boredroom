import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { notificationsView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { MarkRead } from "@/components/app/small-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function NotificationsPage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/notifications`);
  const items = await notificationsView(ctx);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader overline="Inbox" title="Notifications" description="Assignments, review requests, decisions, blockers and reminders. Email delivery is optional and off in the pilot." />
      {items.length === 0 ? <EmptyState title="Nothing here yet" /> : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.id} className={`tile flex items-start justify-between gap-3 px-4 py-3 ${n.read_at ? "opacity-70" : "tile-glow"}`}>
              <div className="min-w-0">
                {n.href ? <Link href={n.href} className="font-semibold hover:underline">{n.title}</Link> : <p className="font-semibold">{n.title}</p>}
                {n.body ? <p className="text-sm text-fg-muted">{n.body}</p> : null}
                <p className="text-xs text-fg-subtle">{formatDateTime(n.created_at, ctx.org.timezone)} · {n.type}</p>
              </div>
              {!n.read_at ? <MarkRead orgSlug={ctx.org.slug} id={n.id} /> : null}
            </li>
          ))}
        </ul>
      )}
    </AppShell>
  );
}
