import Link from "next/link";
import { requireAdmin, can } from "@/server/admin/auth";
import { listCampaigns, listTemplates, listSegments } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CampaignForm } from "@/components/admin/marketing-forms";
import { num, dateOnly } from "@/lib/format";

export const metadata = { title: "Campaigns" };
const TONE: Record<string, "success" | "warning" | "danger" | "neutral" | "info"> = { draft: "neutral", scheduled: "warning", sending: "info", sent: "success", failed: "danger", cancelled: "neutral" };

export default async function CampaignsPage() {
  const admin = await requireAdmin("marketing.view");
  const [campaigns, templates, segments] = await Promise.all([listCampaigns(), listTemplates(), listSegments()]);
  return (
    <>
      <PageHeader icon="chat" title="Campaigns" description="Create, pick the audience, preview, send a test, then schedule or send. Progress and outcomes stay on each campaign." />
      {campaigns.length === 0 ? <p className="mb-6 text-sm text-fg-subtle">No campaigns yet.</p> : (
        <DataTable caption="Campaigns" className="mb-6"><thead><tr><th>Campaign</th><th>Audience</th><th>Status</th><th>Recipients</th><th>Sent</th><th>Failed</th><th>When</th></tr></thead>
          <tbody>{campaigns.map((c) => <tr key={c.id}><td><Link href={`/admin/marketing/campaigns/${c.id}`} className="font-semibold hover:underline">{c.name}</Link><span className="block text-xs text-fg-subtle">{c.subject}</span></td><td className="text-sm">{c.audience.kind}</td><td><Badge tone={TONE[c.status] ?? "neutral"}>{c.status}</Badge></td><td className="tabular-nums">{num(c.recipients)}</td><td className="tabular-nums">{num(c.sent)}</td><td className="tabular-nums">{c.failed ? <span className="text-danger">{num(c.failed)}</span> : 0}</td><td className="text-sm text-fg-muted">{c.finished_at ? dateOnly(c.finished_at) : c.scheduled_at ? `scheduled ${dateOnly(c.scheduled_at)}` : dateOnly(c.created_at)}</td></tr>)}</tbody>
        </DataTable>
      )}
      {can(admin, "marketing.create") ? <Card><CardHeader title="New campaign" /><CampaignForm templates={templates} segments={segments} /></Card> : null}
    </>
  );
}
