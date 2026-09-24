import { requireAdmin, can } from "@/server/admin/auth";
import { launchState } from "@/server/admin/launch";
import { landingSettings } from "@/server/admin/settings";
import { marketingMetrics, listContacts } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Pager, CsvLink, AdminAction } from "@/components/admin/actions";
import { LaunchControl, LandingSettingsForm } from "@/components/admin/platform-forms";
import { num, dateOnly } from "@/lib/format";

export const metadata = { title: "Waitlist and launch" };

export default async function LaunchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("launch.view");
  const sp = await searchParams;
  const tab = ["waitlist", "landing", "settings"].includes(sp.tab ?? "") ? sp.tab! : "waitlist";
  const [launch, m] = await Promise.all([launchState(), marketingMetrics()]);
  const tabs = [["waitlist", "Waitlist"], ["landing", "Landing page"], ["settings", "Launch settings"]].map(([v, l]) => ({ label: l, href: `/admin/launch${v === "waitlist" ? "" : `?tab=${v}`}`, value: v }));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
  return (
    <>
      <PageHeader icon="flag-alert" title="Waitlist and launch" description="Who is waiting, how they convert, and the switch between waitlist, live and maintenance." meta={<>Current mode {launch.mode.toUpperCase()} · waitlist {launch.mode === "waitlist" || launch.waitlist_open ? "accepting signups" : "closed"} · registration {launch.mode === "live" ? "open" : "closed"}</>} />
      <Tabs tabs={tabs} value={tab} className="mb-6" label="Launch sections" />
      {tab === "waitlist" ? await (async () => {
        const r = await listContacts({ waitlist: true, status: sp.status, q: sp.q, page: Number(sp.page ?? 1) });
        return (
          <>
            <Card className="mb-6"><Ledger items={[{ label: "On the waitlist", value: num(m.waitlist), tone: "accent" }, { label: "Today", value: num(m.today) }, { label: "This week", value: num(m.week) }, { label: "This month", value: num(m.month) }]} /><p className="eyebrow mt-3">Conversion: registered {num(m.registered)} ({pct(m.registered, m.waitlist)}) · activated {num(m.activated)} ({pct(m.activated, m.waitlist)}) · paid {num(m.paid)} ({pct(m.paid, m.waitlist)})</p></Card>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2"><div className="flex gap-1">{["", "waiting", "invited", "registered", "activated", "paid", "unsubscribed"].map((s) => <a key={s} href={`/admin/launch?status=${s}`} className={`chip chip-link whitespace-nowrap rounded-full px-3 py-1 text-sm ${(sp.status ?? "") === s ? "border-accent/60 text-fg" : "text-fg-muted"}`}>{s || "All"}</a>)}</div>{can(admin, "waitlist.export") ? <CsvLink href={`/api/admin/contacts/export?waitlist=1${sp.status ? `&status=${sp.status}` : ""}`}>Export waitlist</CsvLink> : null}</div>
            {r.rows.length === 0 ? <EmptyState icon3d="people" title="Nobody on the waitlist yet" description="Signups from the landing page land here the moment they arrive." /> : (
              <DataTable caption="Waitlist"><thead><tr><th>Person</th><th>Company</th><th>Role</th><th>Size</th><th>Source</th><th>Status</th><th>Joined</th>{can(admin, "waitlist.edit") ? <th></th> : null}</tr></thead>
                <tbody>{r.rows.map((c) => <tr key={c.id}><td><span className="block font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "—"}</span><span className="text-xs text-fg-subtle">{c.email}</span></td><td className="text-sm">{c.company ?? "—"}</td><td className="text-sm">{c.role_title ?? "—"}</td><td className="text-sm">{c.company_size ?? "—"}</td><td className="text-sm">{c.source}</td><td><Badge tone={c.status === "waiting" ? "warning" : c.status === "paid" ? "success" : c.status === "unsubscribed" ? "danger" : "info"}>{c.status}</Badge></td><td className="text-sm">{dateOnly(c.created_at)}</td>{can(admin, "waitlist.edit") ? <td className="text-right">{c.status === "waiting" ? <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "invited" }}>Mark invited</AdminAction> : null}</td> : null}</tr>)}</tbody>
              </DataTable>
            )}
            <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
          </>
        );
      })() : null}
      {tab === "landing" ? <Card><CardHeader title="Waitlist landing copy" description="Shown on the public site while the platform is in waitlist mode. Design-heavy changes stay in the code." />{can(admin, "launch.edit") ? <LandingSettingsForm value={await landingSettings()} /> : <p className="text-sm text-fg-subtle">Your role can view but not change this.</p>}</Card> : null}
      {tab === "settings" ? <Card><CardHeader title="Platform status" description="Changing the mode needs a reason and a confirmation, and is written to the audit log. The public site follows it at once." /><LaunchControl launch={launch} canEdit={can(admin, "launch.edit")} /></Card> : null}
    </>
  );
}
