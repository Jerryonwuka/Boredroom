import { Inbox, Mail } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { emailLog, listTemplates } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState, Alert } from "@/components/ui/states";
import { Filters, Pager, JsonForm } from "@/components/admin/actions";
import { F, filterCls, subCls, words } from "@/components/admin/fields";
import { ComposeForm } from "@/components/admin/marketing-forms";
import { listInbound, openInbound } from "@/server/admin/inbox";
import Link from "next/link";
import { formatDateTime, cn } from "@/lib/utils";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Communications" };
export const dynamic = "force-dynamic";

export default async function CommunicationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("communications.view");
  const sp = await searchParams;
  const tab = ["sent", "compose", "inbox"].includes(sp.tab ?? "") ? sp.tab! : "sent";
  const tabs = [["sent", "Sent and log"], ["compose", "Compose"], ["inbox", "Inbox"]].map(([v, l]) => ({ label: l, href: `/admin/communications${v === "sent" ? "" : `?tab=${v}`}`, value: v }));
  const composing = tab === "compose" && can(admin, "communications.send");
  const templates = composing ? await listTemplates() : [];
  return (
    <>
      <div>
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
        {tab === "compose" ? (composing
          ? <Card className="max-w-3xl"><CardHeader title="Write an email" description="To one address, or to the owners of an organisation. Sent at once on the Boredroom design and logged." /><ComposeForm /></Card>
          : <Alert tone="info">Your role can read the log but not send.</Alert>) : null}
        {tab === "inbox" ? await (async () => {
          const sel = sp.msg ? await openInbound(sp.msg).catch(() => null) : null;
          const r = await listInbound({ q: sp.q, page: Number(sp.page ?? 1) });
          return (
            <>
              <Filters>
                <F label="Search"><input name="q" defaultValue={sp.q ?? ""} placeholder="Sender, address or subject" className={cn(filterCls, "w-64")} /></F>
                <input type="hidden" name="tab" value="inbox" />
              </Filters>
              {sel ? (
                <Card className="mb-6">
                  <CardHeader title={sel.subject || "(no subject)"} description={`From ${sel.from_addr}  →  ${sel.to_addr}  ·  ${formatDateTime(sel.received_at)}`} />
                  <div className="whitespace-pre-wrap break-words text-sm text-secondary">{sel.body_text || (sel.body_html ? "(HTML-only message — open in your mail client)" : "(no body captured)")}</div>
                  {can(admin, "communications.send") ? (
                    <div className="mt-4 border-t border-border pt-4">
                      <p className="mb-2 text-meta text-secondary">Reply from <span className="font-medium text-foreground">{sel.to_addr}</span></p>
                      <JsonForm path={`/api/admin/inbox/${sel.id}/reply`} submitLabel="Send reply" successMessage="Reply sent.">
                        <textarea name="body" rows={6} required placeholder="Write your reply…" className={cn(filterCls, "w-full")} />
                      </JsonForm>
                    </div>
                  ) : null}
                  <div className="mt-3"><Link href="/admin/communications?tab=inbox" className="text-sm text-secondary underline">← Back to inbox</Link></div>
                </Card>
              ) : null}
              {r.rows.length === 0 ? <EmptyState icon={Inbox} title="No mail received yet" description="Mail sent to any @boredroom.cc address appears here once Resend inbound is pointed at /api/inbound/resend (MX on boredroom.cc → Resend; webhook → this URL; RESEND_INBOUND_SECRET + RESEND_API_KEY set)." /> : (
                <DataTable caption="Inbox">
                  <thead><tr><th>From</th><th>Received at</th><th>Subject</th><th>When</th></tr></thead>
                  <tbody>{r.rows.map((m) => (
                    <tr key={m.id} className={m.read_at ? "" : "font-semibold"}>
                      <td><Link href={`/admin/communications?tab=inbox&msg=${m.id}`} className="underline">{m.from_addr}</Link></td>
                      <td className="text-secondary">{m.to_addr}</td>
                      <td className="wrap max-w-[360px]">{m.subject || "(no subject)"}{m.snippet ? <span className={subCls}>{m.snippet}</span> : null}{m.replied_at ? <Badge tone="success" className="ml-1">Replied</Badge> : null}</td>
                      <td className="tabular-nums">{formatDateTime(m.received_at)}</td>
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
              <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
            </>
          );
        })() : null}
      </div>
      <PageNotes>
        {composing
          ? <PageNote section="Compose"><span className="tabular-nums">{templates.length}</span> templates exist for campaigns and automations; a composed email uses the design-system layout with what you write here.</PageNote>
          : null}
      </PageNotes>
    </>
  );
}
