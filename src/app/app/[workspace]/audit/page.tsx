import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { UpgradeGate } from "@/components/app/upgrade-gate";
import { DataTable } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { MonoChip } from "@/components/ui/badge";
import { FilterBar, FilterControl } from "@/components/ui/filter-control";
import { Button, buttonVariants } from "@/components/ui/button";
import { auditView } from "@/server/services/views";
import { localMidnight, addDays, todayLocal } from "@/server/lib/time";
import { formatDateTime } from "@/lib/utils";
import { DatePicker } from "@/components/ui/date-picker";

export const dynamic = "force-dynamic";
export const metadata = { title: "Audit" };

const LIMIT = 200;
/** A real calendar day in yyyy-mm-dd; anything else is ignored rather than handed to Date (which throws on it). */
const isDay = (s: string | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`)) && new Date(`${s}T00:00:00Z`).toISOString().startsWith(s);

/**
 * The audit log, v4: the filter bar (Action starts with, From, To; the days apply at once, the action on Enter or
 * Search) and a calm table, newest first. Entries cannot be edited or deleted from the application.
 */
export default async function AuditPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ action?: string; from?: string; to?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/audit`);
  if (!ctx.plan.features.AUDIT_LOGS) return <AppShell ctx={ctx} counts={counts} teams={teams}><UpgradeGate feature="AUDIT_LOGS" orgSlug={ctx.org.slug} planName={ctx.plan.plan?.name ?? null} upgradeTo={ctx.plan.upgradeTo} isOwner={ctx.membership.role === "owner" || ctx.membership.role === "hr"} lapsed={ctx.plan.lapsed} /></AppShell>;
  const tz = ctx.org.timezone;
  const base = `/app/${ctx.org.slug}`;
  const action = sp.action?.trim().slice(0, 80) || "";
  let from = isDay(sp.from) ? sp.from : "";
  let to = isDay(sp.to) ? sp.to : "";
  if (from && to && from > to) [from, to] = [to, from];
  // Days are the organisation's days: from its local midnight to the local midnight after the last day.
  const rows = await auditView(ctx, { action: action || undefined, from: from ? localMidnight(from, tz).toISOString() : undefined, to: to ? localMidnight(addDays(to, 1), tz).toISOString() : undefined });
  const scope = { owner: "the whole organisation", hr: "operational events across the organisation", manager: "your own actions and your teams' review events", employee: "events about your own records" }[ctx.membership.role];
  const filtered = !!(action || from || to);
  const today = todayLocal(tz);
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Audit log" divider description={`Who did what, and when. You can see ${scope}. Entries cannot be edited or deleted from the application.`} />
      <form className="mb-6" action={`${base}/audit`}>
        <FilterBar>
          <FilterControl label="Action" htmlFor="au-action">
            <Input id="au-action" name="action" defaultValue={action} placeholder="Starts with, such as session." fieldSize="xs" className="w-44" maxLength={80} />
          </FilterControl>
          <FilterControl label="From" htmlFor="au-from"><DatePicker key={`from-${from}`} id="au-from" name="from" defaultValue={from} max={today} placeholder="Any day" size="xs" submitOnChange /></FilterControl>
          <FilterControl label="To" htmlFor="au-to"><DatePicker key={`to-${to}`} id="au-to" name="to" defaultValue={to} max={today} placeholder="Today" size="xs" submitOnChange /></FilterControl>
          <Button type="submit" variant="secondary" size="xs">Search</Button>
          {filtered ? <Link href={`${base}/audit`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Clear filters</Link> : null}
        </FilterBar>
      </form>
      {rows.length === 0 ? (
        <EmptyState icon3d="eye-checklist" title={filtered ? "No events match" : "Nothing recorded yet"} description={filtered ? "Widen the dates or change the action." : "Events appear here as people work: sessions, reviews, invitations and changes to settings."} action={filtered ? <Link href={`${base}/audit`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Clear filters</Link> : undefined} />
      ) : (
        <>
          <DataTable caption="Audit events">
            <thead><tr><th>When</th><th>Action</th><th>Actor</th><th>Subject</th><th>Details</th></tr></thead>
            <tbody>{rows.map((r) => {
              const details = Object.entries(r.metadata).filter(([, v]) => v != null && typeof v !== "object").map(([k, v]) => `${k}=${String(v)}`).join(", ");
              return (
                <tr key={r.id}>
                  <td className="nowrap tabular-nums text-secondary">{formatDateTime(r.occurred_at, tz)}</td>
                  <td className="nowrap"><MonoChip className="text-foreground">{r.action}</MonoChip></td>
                  <td>{r.actor_name ?? <span className="text-subtle">System</span>}</td>
                  <td>{r.subject_name ?? <span className="text-secondary">{r.subject_type.replace(/_/g, " ")}</span>}</td>
                  <td className="wrap max-w-md text-meta text-secondary">{details ? <span className="line-clamp-2" title={JSON.stringify(r.metadata)}>{details}</span> : <span className="text-subtle">None</span>}</td>
                </tr>
              );
            })}</tbody>
          </DataTable>
          {rows.length >= LIMIT ? <p className="mt-4 text-meta font-normal text-secondary">Showing the latest <span className="tabular-nums">{LIMIT}</span> events. Narrow the dates or the action to see older ones.</p> : null}
        </>
      )}
    </AppShell>
  );
}
