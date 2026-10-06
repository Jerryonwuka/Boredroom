import Link from "next/link";
import { Send } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { listCampaigns, listTemplates, listSegments } from "@/server/admin/marketing";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { CampaignForm } from "@/components/admin/marketing-forms";
import { SheetButton } from "@/components/admin/actions";
import { MARKETING_TABS, linkCls, subCls, words } from "@/components/admin/fields";
import { num, dateOnly } from "@/lib/format";

export const metadata = { title: "Campaigns" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral"> = { draft: "neutral", scheduled: "warning", sent: "success", failed: "danger", cancelled: "neutral" };

export default async function CampaignsPage() {
  const admin = await requireAdmin("marketing.view");
  const [campaigns, templates, segments] = await Promise.all([listCampaigns(), listTemplates(), listSegments()]);
  return (
    <>
      <PageHeader title="Campaigns" description="Create, pick the audience, preview, send a test, then schedule or send. Progress and outcomes stay on each campaign."
        actions={can(admin, "marketing.create") ? <SheetButton label="New campaign" icon="plus" variant="accent" sheetSize="lg" title="New campaign" description="Saved as a draft; preview, test and send it from its page."><CampaignForm templates={templates} segments={segments} /></SheetButton> : null}
        tabs={MARKETING_TABS} tabsLabel="Marketing sections" />
      {campaigns.length === 0 ? <EmptyState icon={Send} title="No campaigns yet" description="A campaign is a one-off email to an audience." /> : (
        <DataTable caption="Campaigns">
          <thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Recipients</th><th>Sent</th><th>Failed</th><th>When</th></tr></thead>
          <tbody>{campaigns.map((c) => (
            <tr key={c.id}>
              <td><Link href={`/admin/marketing/campaigns/${c.id}`} className={linkCls}>{c.name}</Link><span className={subCls}>{c.subject}</span></td>
              <td>{words(c.audience.kind)}</td>
              <td>{c.status === "sending" ? <Badge tone="accent" dot>Sending</Badge> : <Badge tone={TONE[c.status] ?? "neutral"}>{words(c.status)}</Badge>}</td>
              <td className="tabular-nums">{num(c.recipients)}</td>
              <td className="tabular-nums">{num(c.sent)}</td>
              <td className="tabular-nums">{c.failed ? <span className="text-danger">{num(c.failed)}</span> : 0}</td>
              <td className="text-secondary">{c.finished_at ? dateOnly(c.finished_at) : c.scheduled_at ? `Scheduled ${dateOnly(c.scheduled_at)}` : dateOnly(c.created_at)}</td>
            </tr>
          ))}</tbody>
        </DataTable>
      )}
    </>
  );
}
