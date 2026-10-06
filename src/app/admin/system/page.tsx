import { CircleCheck, KeyRound } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { systemOverview } from "@/server/admin/ops";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge, MonoChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { StatusDot } from "@/components/ui/status-dot";
import { AdminAction } from "@/components/admin/actions";
import { Facts, subCls, words } from "@/components/admin/fields";
import { num } from "@/lib/format";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "System" };

const JOB_TONE: Record<string, "success" | "danger" | "neutral"> = { succeeded: "success", failed: "danger" };

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("system.view");
  const { tab: t } = await searchParams;
  const tab = ["health", "jobs", "errors", "api"].includes(t ?? "") ? t! : "health";
  const s = await systemOverview();
  const tabs = [["health", "Health"], ["jobs", "Jobs"], ["errors", "Errors"], ["api", "API"]].map(([v, l]) => ({ label: l, href: `/admin/system${v === "health" ? "" : `?tab=${v}`}`, value: v }));
  const checks = Object.entries(s.health.checks);
  const configure = can(admin, "system.configure");
  const i = s.jobs.integrations;
  const ok = (good: boolean, label = "OK") => <Badge tone={good ? "success" : "danger"} dot>{label}</Badge>;
  return (
    <>
      <PageHeader title="System" description="Is Boredroom healthy: the database, mail, storage, the worker and its jobs, the integrations."
        meta={<>Environment {s.health.nodeEnv ?? "development"}, mail {s.health.mailProvider}, storage {s.health.storageProvider}. Checked {formatDateTime(new Date())}.</>}
        tabs={tabs} tabValue={tab} tabsLabel="System sections" />
      {tab === "health" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="self-start">
            <CardHeader title={<span className="flex items-center gap-2"><StatusDot tone={s.health.ok ? "success" : "danger"} />{s.health.ok ? "All checks pass" : "Something needs attention"}</span>} />
            <Facts items={checks.map(([k, c]) => ({
              label: words(k),
              hint: c.detail || (!c.ok && c.fix) ? <>{c.detail ?? null}{!c.ok && c.fix ? <span className="block text-warning">{c.fix}</span> : null}</> : undefined,
              value: ok(c.ok, c.ok ? "OK" : "Failing"),
            }))} />
          </Card>
          <div className="grid content-start gap-6">
            <Card>
              <CardHeader title="Integrations" />
              <Facts items={[
                { label: "Paystack", hint: `${num(i.paystack_events_24h)} webhook events in 24 h`, value: !s.paystack ? <Badge>Off</Badge> : ok(!i.paystack_errors, i.paystack_errors ? `${i.paystack_errors} errors` : "OK") },
                { label: "Brevo", hint: `${num(i.brevo_synced_24h)} contacts synced in 24 h`, value: !s.brevo ? <Badge>Off</Badge> : ok(!i.brevo_errors, i.brevo_errors ? `${i.brevo_errors} errors` : "OK") },
                { label: "Email", hint: `${num(i.email_sent_24h)} sent in 24 h`, value: ok(!i.email_failed_24h, i.email_failed_24h ? `${i.email_failed_24h} failed` : "OK") },
                { label: "Background jobs", hint: `${num(s.jobs.counts.succeeded_24h)} succeeded in 24 h`, value: ok(!s.jobs.counts.failed, s.jobs.counts.failed ? `${s.jobs.counts.failed} failed` : "OK") },
              ]} />
            </Card>
            <Ledger className="md:grid-cols-2 xl:grid-cols-4" items={[{ label: "Queue", value: num(s.jobs.counts.pending), note: s.jobs.counts.oldest_pending ? `Oldest ${relativeTime(s.jobs.counts.oldest_pending)}` : "Empty" }, { label: "Running", value: num(s.jobs.counts.running) }, { label: "Failed", value: num(s.jobs.counts.failed), tone: s.jobs.counts.failed ? "danger" : "default" }, { label: "Done, 24 h", value: num(s.jobs.counts.succeeded_24h) }]} />
          </div>
        </div>
      ) : null}
      {tab === "jobs" ? (
        <>
          <Card className="mb-6">
            <CardHeader title="By type, last 7 days" size="sm" className="mb-3" />
            {s.jobs.byType.length === 0 ? <p className="text-sm font-normal text-secondary">No jobs in the last 7 days.</p> : (
              <ul className="flex flex-wrap gap-2">{s.jobs.byType.map((b) => (
                <li key={b.type} className="inline-flex items-center gap-2 rounded-[10px] bg-fill-0 py-1 pl-2.5 pr-1.5 text-meta">
                  <span className="font-mono text-xs text-foreground">{b.type}</span>
                  <MonoChip>{num(b.total)}</MonoChip>
                  {b.failed ? <Badge tone="danger">{b.failed} failed</Badge> : null}
                </li>
              ))}</ul>
            )}
          </Card>
          {s.jobs.recent.length === 0 ? <EmptyState icon={CircleCheck} title="No jobs yet" /> : (
            <DataTable caption="Recent jobs">
              <thead><tr><th>Type</th><th>State</th><th>Attempts</th><th>Next run</th><th>Finished</th><th>Error</th>{configure ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
              <tbody>{s.jobs.recent.map((j) => (
                <tr key={j.id}>
                  <td className="font-mono text-xs">{j.type}</td>
                  <td>{j.state === "running" ? <Badge><StatusDot tone="live" pulse={false} size={6} />Running</Badge> : <Badge tone={JOB_TONE[j.state] ?? "neutral"}>{words(j.state)}</Badge>}</td>
                  <td className="tabular-nums">{j.attempts}/{j.max_attempts}</td>
                  <td className="text-secondary">{relativeTime(j.next_run_at)}</td>
                  <td className="text-secondary">{j.finished_at ? relativeTime(j.finished_at) : "Not yet"}</td>
                  <td className="max-w-[320px] truncate text-meta text-danger" title={j.last_error ?? ""}>{j.last_error ?? ""}</td>
                  {configure ? <td className="text-right">{j.state === "failed" ? <AdminAction path={`/api/admin/jobs/${j.id}/retry`} size="xs">Retry</AdminAction> : null}</td> : null}
                </tr>
              ))}</tbody>
            </DataTable>
          )}
        </>
      ) : null}
      {tab === "errors" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card className="self-start">
            <CardHeader title={<span className="flex items-center gap-2">Failed jobs<MonoChip>{s.jobs.failed.length}</MonoChip></span>} />
            {s.jobs.failed.length === 0 ? <EmptyState compact icon={CircleCheck} title="No failed jobs" /> : (
              <ul className="grid gap-3">{s.jobs.failed.map((j) => (
                <li key={j.id} className="min-w-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0"><span className="block truncate font-mono text-xs text-foreground">{j.type}</span><span className={subCls}>{relativeTime(j.created_at)}, {j.attempts} attempts</span></span>
                    {configure ? <AdminAction path={`/api/admin/jobs/${j.id}/retry`} size="xs">Retry</AdminAction> : null}
                  </div>
                  <p className="mt-1 break-words text-meta font-normal text-danger">{j.last_error}</p>
                </li>
              ))}</ul>
            )}
          </Card>
          <Card className="self-start">
            <CardHeader title="Recorded errors" description="Failures the platform audited." />
            {s.jobs.errors.length === 0 ? <EmptyState compact icon={CircleCheck} title="No recorded errors" /> : (
              <ul className="grid gap-3">{s.jobs.errors.map((e, n) => (
                <li key={n} className="min-w-0">
                  <span className="block truncate font-mono text-xs text-foreground">{e.action}</span>
                  <span className={subCls}>{formatDateTime(e.occurred_at)}</span>
                  <p className="truncate font-mono text-xs text-secondary">{JSON.stringify(e.metadata)}</p>
                </li>
              ))}</ul>
            )}
          </Card>
        </div>
      ) : null}
      {tab === "api" ? <EmptyState icon={KeyRound} tone="neutral" title="No public API yet" description="Boredroom does not expose a public API yet. When it does, keys, permissions, usage and rate limits will be managed here." /> : null}
    </>
  );
}
