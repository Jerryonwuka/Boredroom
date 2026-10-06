import { Inbox, Mail } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { emailLog, listTemplates } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { Filters, Pager } from "@/components/admin/actions";
import { F, filterCls, subCls, words } from "@/components/admin/fields";
import { ComposeForm } from "@/components/admin/marketing-forms";
import { formatDateTime, cn } from "@/lib/utils";

export const metadata = { title: "Communications" };

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("communications.view");
  const sp = await searchParams;
  const tab = ["sent", "compose", "inbox"].includes(sp.tab ?? "") ? sp.tab! : "sent";
  const tabs = [["sent", "Sent and log"], ["compose", "Compose"], ["inbox", "Inbox"]].map(([v, l]) => ({ label: l, href: `/admin/communications${v === "sent" ? "" : `?tab=${v}`}`, value: v }));
  return (
    <>
      <PageHeader title="Communications" description="Every email the platform sends, and a way to write one." tabs={tabs} tabValue={tab} tabsLabel="Communications sections" />
      {tab === "sent" ? await (async () => {
        const r = await emailLog({ q: sp.q, status: sp.status, category: sp.category, page: Number(sp.page ?? 1) });
        return (
          <>
            <Filters>
              <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Recipient or subject" className={cn(filterCls, "w-56")} /></F>
              <F label="Status"><select name="status" defaultValue={sp.status ?? ""} className={filterCls}><option value="">Any</option><option value="sent">Sent</option><option value="failed">Failed</option></select></F>
              <F label="Category"><select name="category" defaultValue={sp.category ?? ""} className={filterCls}><option value="">Any</option>{["transactional", "marketing", "lifecycle", "billing", "admin", "verify_email", "recover_password", "invitation"].map((c) => <option key={c} value={c}>{words(c)}</option>)}</select></F>
            </Filters>
            {r.rows.length === 0 ? <EmptyState icon={Mail} title="No emails match" description="Transactional mail (verification, resets, invitations) is logged here too once it goes through the platform log." /> : (
              <DataTable caption="Email log">
                <thead><tr><th>When</th><th>To</th><th>Subject</th><th>Category</th><th>Status</th><th>Via</th></tr></thead>
                <tbody>{r.rows.map((l) => (
                  <tr key={l.id}>
                    <td className="tabular-nums">{formatDateTime(l.created_at)}</td>
                    <td>{l.to_email}</td>
                    <td className="wrap max-w-[320px]">{l.subject}{l.campaign_name ? <span className={subCls}>Campaign: {l.campaign_name}</span> : null}</td>
                    <td><Badge>{words(l.category)}</Badge></td>
                    <td>{l.status === "sent" ? <Badge tone="success">Sent</Badge> : <Badge tone="danger">Failed</Badge>}{l.error ? <span className="block max-w-[240px] truncate text-meta text-danger" title={l.error}>{l.error}</span> : null}</td>
                    <td className="text-secondary">{l.provider}{l.sent_by_email ? <span className={subCls}>{l.sent_by_email}</span> : null}</td>
                  </tr>
                ))}</tbody>
              </DataTable>
            )}
            <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
          </>
        );
      })() : null}
      {tab === "compose" ? (can(admin, "communications.send")
        ? <Card className="max-w-3xl"><CardHeader title="Write an email" description="To one address, or to the owners of an organisation. Sent at once on the Boredroom design and logged." /><ComposeForm templates={await listTemplates()} /></Card>
        : <Alert tone="info">Your role can read the log but not send.</Alert>) : null}
      {tab === "inbox" ? <EmptyState icon={Inbox} tone="neutral" title="No inbox yet" description="Incoming mail needs a Brevo inbound route or a shared mailbox. Replies to platform emails go to the sender address in MAIL_FROM for now; this tab will list them once an inbound webhook is configured." /> : null}
    </>
  );
}
