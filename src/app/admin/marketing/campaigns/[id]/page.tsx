import { notFound } from "next/navigation";
import { requireAdmin, can } from "@/server/admin/auth";
import { campaignDetail, listTemplates, listSegments } from "@/server/admin/marketing";
import { AppError } from "@/server/lib/errors";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-arc";
import { CampaignForm, CampaignControls } from "@/components/admin/marketing-forms";
import { EditSheet } from "@/components/admin/actions";
import { words } from "@/components/admin/fields";
import { num } from "@/lib/format";
import { formatDateTime } from "@/lib/utils";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Campaign" };
const RECIPIENT_TONE: Record<string, "success" | "danger" | "warning" | "neutral"> = { sent: "success", failed: "danger", skipped: "warning" };

export default async function CampaignPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin("marketing.view");
  const { id } = await params;
  let d: Awaited<ReturnType<typeof campaignDetail>>;
  try { d = await campaignDetail(id); } catch (err) { if (err instanceof AppError && err.status === 404) notFound(); throw err; }
  const c = d.campaign;
  const [templates, segments] = await Promise.all([listTemplates(), listSegments()]);
  const editable = can(admin, "marketing.create") && (c.status === "draft" || c.status === "scheduled");
  const done = Number(c.sent) + Number(c.failed) + Number(c.skipped ?? 0);
  const canSend = can(admin, "marketing.send");
  return (
    <>
      <div>
        <PageHeader back={{ href: "/admin/marketing/campaigns", label: "Campaigns" }} title={c.name}
          description={<>Subject: {c.subject}. Audience: {words(c.audience.kind).toLowerCase()}{c.template_name ? `, on the ${c.template_name} template` : ""}.</>}
          meta={<>{words(c.status)}{c.scheduled_at ? `, scheduled ${formatDateTime(c.scheduled_at)}` : ""}{c.started_at ? `, started ${formatDateTime(c.started_at)}` : ""}{c.finished_at ? `, finished ${formatDateTime(c.finished_at)}` : ""}</>}
          actions={editable ? <EditSheet title={`Edit ${c.name}`} size="lg"><CampaignForm campaign={c} templates={templates} segments={segments} /></EditSheet> : null} divider />
        <Ledger items={[{ label: "Audience now", value: num(d.audienceSize) }, { label: "Recipients", value: num(c.recipients) }, { label: "Sent", value: num(c.sent) }, { label: "Failed", value: num(c.failed), tone: c.failed ? "danger" : "default", note: c.skipped ? `${num(c.skipped)} skipped` : undefined }]} />
        {c.status === "sending" && Number(c.recipients) > 0 ? (
          <div className="mt-4 grid gap-1.5">
            <p className="flex items-center justify-between text-meta font-normal text-secondary"><span>Sending in batches</span><span className="tabular-nums">{num(done)} of {num(c.recipients)}</span></p>
            <ProgressBar value={done} max={Number(c.recipients)} label="Campaign send progress" valueText={`${num(done)} of ${num(c.recipients)} processed`} />
          </div>
        ) : null}
        <Card className="my-6">
          <CardHeader title="Send" />
          <CampaignControls campaign={c} audienceSize={d.audienceSize} canSend={canSend} />
        </Card>
        {d.recipients.length ? (
          <Card>
            <CardHeader title={`Recipients (${d.recipients.length})`} />
            <DataTable caption="Recipients">
              <thead><tr><th>Email</th><th>Status</th><th>Sent</th><th>Error</th></tr></thead>
              <tbody>{d.recipients.map((r) => <tr key={r.email}><td>{r.email}</td><td><Badge tone={RECIPIENT_TONE[r.status] ?? "neutral"}>{words(r.status)}</Badge></td><td className="tabular-nums text-secondary">{r.sent_at ? formatDateTime(r.sent_at) : "Not yet"}</td><td className="wrap max-w-[320px] text-meta text-secondary">{r.error ?? ""}</td></tr>)}</tbody>
            </DataTable>
          </Card>
        ) : null}
      </div>
      <PageNotes>
        {(c.status === "draft" || c.status === "scheduled") && canSend
          ? <PageNote section="Send"><span className="tabular-nums">{num(d.unsubscribed)}</span> unsubscribed contacts are left out automatically; invalid addresses are skipped at send time.</PageNote>
          : null}
      </PageNotes>
    </>
  );
}
