import { notFound } from "next/navigation";
import { requireAdmin, can } from "@/server/admin/auth";
import { campaignDetail, listTemplates, listSegments } from "@/server/admin/marketing";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { CampaignForm, CampaignControls } from "@/components/admin/marketing-forms";
import { num } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";

export const metadata = { title: "Campaign" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("marketing.view");
  const { id } = await params;
  let d: Awaited<ReturnType<typeof campaignDetail>>;
  try { d = await campaignDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const c = d.campaign;
  const [templates, segments] = await Promise.all([listTemplates(), listSegments()]);
  const editable = can(admin, "marketing.create") && (c.status === "draft" || c.status === "scheduled");
  return (
    <>
      <PageHeader back={{ href: "/admin/marketing/campaigns", label: "Campaigns" }} title={c.name} description={<>Subject: {c.subject}. Audience: {c.audience.kind}{c.template_name ? `, on the ${c.template_name} template` : ""}.</>} meta={<>{c.status.toUpperCase()}{c.scheduled_at ? ` · scheduled ${formatDateTime(c.scheduled_at)}` : ""}{c.started_at ? ` · started ${formatDateTime(c.started_at)}` : ""}{c.finished_at ? ` · finished ${formatDateTime(c.finished_at)}` : ""}</>} />
      <Card className="mb-6"><Ledger items={[{ label: "Audience now", value: num(d.audienceSize) }, { label: "Recipients", value: num(c.recipients) }, { label: "Sent", value: num(c.sent), tone: "accent" }, { label: "Failed", value: num(c.failed), tone: c.failed ? "danger" : "default", note: c.skipped ? `${num(c.skipped)} skipped` : undefined }]} /></Card>
      <Card className="mb-6"><CardHeader title="Send" /><CampaignControls campaign={c} audienceSize={d.audienceSize} unsubscribed={d.unsubscribed} canSend={can(admin, "marketing.send")} /></Card>
      {editable ? <Card className="mb-6"><CardHeader title="Edit" /><CampaignForm campaign={c} templates={templates} segments={segments} /></Card> : null}
      {d.recipients.length ? <Card><CardHeader title={`Recipients (${d.recipients.length})`} /><DataTable caption="Recipients"><thead><tr><th>Email</th><th>Status</th><th>Sent</th><th>Error</th></tr></thead><tbody>{d.recipients.map((r) => <tr key={r.email}><td className="text-sm">{r.email}</td><td><Badge tone={r.status === "sent" ? "success" : r.status === "failed" ? "danger" : r.status === "skipped" ? "warning" : "neutral"}>{r.status}</Badge></td><td className="text-sm text-fg-muted">{r.sent_at ? formatDateTime(r.sent_at) : "—"}</td><td className="text-xs text-fg-subtle">{r.error ?? ""}</td></tr>)}</tbody></DataTable></Card> : null}
    </>
  );
}
