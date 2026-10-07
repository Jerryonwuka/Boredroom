import { UsersRound } from "lucide-react";
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
import { subCls, words } from "@/components/admin/fields";
import { num, dateOnly } from "@/lib/format";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Waitlist and launch" };

const CONTACT_TONE: Record<string, "success" | "warning" | "danger" | "info"> = { waiting: "warning", paid: "success", unsubscribed: "danger" };
const STATUSES = ["", "waiting", "invited", "registered", "activated", "paid", "unsubscribed"];
const MODE_LABEL = { waitlist: "Waitlist", live: "Live", maintenance: "Maintenance" } as const;

export default async function LaunchPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const admin = await requireAdmin("launch.view");
  const sp = await searchParams;
  const tab = ["waitlist", "landing", "settings"].includes(sp.tab ?? "") ? sp.tab! : "waitlist";
  const [launch, m] = await Promise.all([launchState(), marketingMetrics()]);
  const tabs = [["waitlist", "Waitlist"], ["landing", "Landing page"], ["settings", "Launch settings"]].map(([v, l]) => ({ label: l, href: `/admin/launch${v === "waitlist" ? "" : `?tab=${v}`}`, value: v }));
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "0%");
  const status = sp.status ?? "";
  return (
    <>
      <div>
        <PageHeader title="Waitlist and launch" description="Who is waiting, how they convert, and the switch between waitlist, live and maintenance."
          meta={<>Mode: {MODE_LABEL[launch.mode]}. Waitlist {launch.mode === "waitlist" || launch.waitlist_open ? "accepting signups" : "closed"}, registration {launch.mode === "live" ? "open" : "closed"}.</>}
          tabs={tabs} tabValue={tab} tabsLabel="Launch sections" />
        {tab === "waitlist" ? await (async () => {
          const r = await listContacts({ waitlist: true, status: sp.status, q: sp.q, page: Number(sp.page ?? 1) });
          const statusTabs = STATUSES.map((s) => ({ label: s ? words(s) : "All", href: `/admin/launch${s ? `?status=${s}` : ""}`, value: s || "all" }));
          return (
            <>
              <Ledger items={[{ label: "On the waitlist", value: num(m.waitlist) }, { label: "Today", value: num(m.today) }, { label: "This week", value: num(m.week) }, { label: "This month", value: num(m.month) }]} />
              <p className="mt-3 text-meta font-normal text-secondary">Conversion: registered <span className="tabular-nums">{num(m.registered)}</span> ({pct(m.registered, m.waitlist)}), activated <span className="tabular-nums">{num(m.activated)}</span> ({pct(m.activated, m.waitlist)}), paid <span className="tabular-nums">{num(m.paid)}</span> ({pct(m.paid, m.waitlist)}).</p>
              <div className="mb-4 mt-6 flex flex-wrap items-center justify-between gap-3">
                <Tabs variant="pills" tabs={statusTabs} value={status || "all"} param="status" label="Waitlist status" />
                {can(admin, "waitlist.export") ? <CsvLink href={`/api/admin/contacts/export?waitlist=1${sp.status ? `&status=${sp.status}` : ""}`}>Export waitlist</CsvLink> : null}
              </div>
              {r.rows.length === 0 ? <EmptyState icon={UsersRound} title={status ? `Nobody ${words(status).toLowerCase()} on the waitlist` : "Nobody on the waitlist yet"} description="Signups from the landing page land here the moment they arrive." /> : (
                <DataTable caption="Waitlist">
                  <thead><tr><th>Person</th><th>Company</th><th>Role</th><th>Size</th><th>Source</th><th>Status</th><th>Joined</th>{can(admin, "waitlist.edit") ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
                  <tbody>{r.rows.map((c) => (
                    <tr key={c.id}>
                      <td><span className="block font-medium">{[c.first_name, c.last_name].filter(Boolean).join(" ") || "No name"}</span><span className={subCls}>{c.email}</span></td>
                      <td>{c.company ?? <span className="text-secondary">None</span>}</td>
                      <td>{c.role_title ?? <span className="text-secondary">None</span>}</td>
                      <td>{c.company_size ?? <span className="text-secondary">None</span>}</td>
                      <td className="text-secondary">{c.source}</td>
                      <td><Badge tone={CONTACT_TONE[c.status] ?? "info"}>{words(c.status)}</Badge></td>
                      <td className="tabular-nums">{dateOnly(c.created_at)}</td>
                      {can(admin, "waitlist.edit") ? <td className="text-right">{c.status === "waiting" ? <AdminAction path={`/api/admin/contacts/${c.id}`} method="PATCH" body={{ status: "invited" }} size="xs">Mark invited</AdminAction> : null}</td> : null}
                    </tr>
                  ))}</tbody>
                </DataTable>
              )}
              <Pager page={r.page} pageSize={r.pageSize} total={r.total} />
            </>
          );
        })() : null}
        {tab === "landing" ? <Card><CardHeader title="Waitlist landing copy" description="Shown on the public site while the platform is in waitlist mode." />{can(admin, "launch.edit") ? <LandingSettingsForm value={await landingSettings()} /> : <p className="text-sm font-normal text-secondary">Your role can view but not change this.</p>}</Card> : null}
        {tab === "settings" ? <Card><CardHeader title="Platform status" description="Changing the mode needs a reason and a confirmation, and is written to the audit log. The public site follows it at once." /><LaunchControl launch={launch} canEdit={can(admin, "launch.edit")} /></Card> : null}
      </div>
      <PageNotes>
        {tab === "landing" ? <PageNote section="Waitlist landing copy">Design-heavy changes stay in the code.</PageNote> : null}
      </PageNotes>
    </>
  );
}
