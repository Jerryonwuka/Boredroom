import { requireAdmin, can } from "@/server/admin/auth";
import { systemOverview } from "@/server/admin/ops";
import { PageHeader, Card, CardHeader, Ledger } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AdminAction } from "@/components/admin/actions";
import { num } from "@/lib/format";
import { formatDateTime, relativeTime } from "@/lib/utils";

export const metadata = { title: "System" };

export default async function SystemPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("system.view");
  const { tab: t } = await searchParams;
  const tab = ["health", "jobs", "errors", "api"].includes(t ?? "") ? t! : "health";
  const s = await systemOverview();
  const tabs = [["health", "Health"], ["jobs", "Jobs"], ["errors", "Errors"], ["api", "API"]].map(([v, l]) => ({ label: l, href: `/admin/system${v === "health" ? "" : `?tab=${v}`}`, value: v }));
  const checks = Object.entries(s.health.checks);
  return (
    <>
      <PageHeader icon="shield-check" title="System" description="Is Boredroom healthy: the database, mail, storage, the worker and its jobs, the integrations." meta={<>Environment {s.health.nodeEnv ?? "development"} · mail {s.health.mailProvider} · storage {s.health.storageProvider} · checked {formatDateTime(new Date())}</>} />
      <Tabs tabs={tabs} value={tab} className="mb-6" label="System sections" />
      {tab === "health" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title={s.health.ok ? "All checks pass" : "Something needs attention"} />
            <ul className="divide-y divide-border-soft text-sm">{checks.map(([k, c]) => <li key={k} className="flex items-start justify-between gap-3 py-2"><span><span className="font-medium">{k}</span>{c.detail ? <span className="block text-xs text-fg-subtle">{c.detail}</span> : null}{!c.ok && c.fix ? <span className="block text-xs text-warning">{c.fix}</span> : null}</span><Badge tone={c.ok ? "success" : "danger"} dot>{c.ok ? "ok" : "fail"}</Badge></li>)}</ul>
          </Card>
          <div className="space-y-4">
            <Card><CardHeader title="Integrations" /><ul className="divide-y divide-border-soft text-sm">
              <li className="flex items-center justify-between py-2"><span>Paystack<span className="block text-xs text-fg-subtle">{num(s.jobs.integrations.paystack_events_24h)} webhook events in 24 h</span></span><Badge tone={!s.paystack ? "neutral" : s.jobs.integrations.paystack_errors ? "danger" : "success"} dot>{!s.paystack ? "off" : s.jobs.integrations.paystack_errors ? `${s.jobs.integrations.paystack_errors} errors` : "ok"}</Badge></li>
              <li className="flex items-center justify-between py-2"><span>Brevo<span className="block text-xs text-fg-subtle">{num(s.jobs.integrations.brevo_synced_24h)} contacts synced in 24 h</span></span><Badge tone={!s.brevo ? "neutral" : s.jobs.integrations.brevo_errors ? "danger" : "success"} dot>{!s.brevo ? "off" : s.jobs.integrations.brevo_errors ? `${s.jobs.integrations.brevo_errors} errors` : "ok"}</Badge></li>
              <li className="flex items-center justify-between py-2"><span>Email<span className="block text-xs text-fg-subtle">{num(s.jobs.integrations.email_sent_24h)} sent in 24 h</span></span><Badge tone={s.jobs.integrations.email_failed_24h ? "danger" : "success"} dot>{s.jobs.integrations.email_failed_24h ? `${s.jobs.integrations.email_failed_24h} failed` : "ok"}</Badge></li>
              <li className="flex items-center justify-between py-2"><span>Background jobs<span className="block text-xs text-fg-subtle">{num(s.jobs.counts.succeeded_24h)} succeeded in 24 h</span></span><Badge tone={s.jobs.counts.failed ? "danger" : "success"} dot>{s.jobs.counts.failed ? `${s.jobs.counts.failed} failed` : "ok"}</Badge></li>
            </ul></Card>
            <Card><Ledger items={[{ label: "Queue", value: num(s.jobs.counts.pending), note: s.jobs.counts.oldest_pending ? `oldest ${relativeTime(s.jobs.counts.oldest_pending)}` : undefined }, { label: "Running", value: num(s.jobs.counts.running) }, { label: "Failed", value: num(s.jobs.counts.failed), tone: s.jobs.counts.failed ? "danger" : "default" }, { label: "Done, 24 h", value: num(s.jobs.counts.succeeded_24h) }]} /></Card>
          </div>
        </div>
      ) : null}
      {tab === "jobs" ? (
        <>
          <Card className="mb-6"><CardHeader title="By type, last 7 days" /><ul className="flex flex-wrap gap-2 text-xs">{s.jobs.byType.map((b) => <li key={b.type} className="chip px-2.5 py-1"><span className="font-mono">{b.type}</span> <span className="text-fg-subtle">{num(b.total)}{b.failed ? <span className="text-danger"> · {b.failed} failed</span> : null}</span></li>)}</ul></Card>
          <DataTable caption="Recent jobs"><thead><tr><th>Type</th><th>State</th><th>Attempts</th><th>Next run</th><th>Finished</th><th>Error</th>{can(admin, "system.configure") ? <th></th> : null}</tr></thead><tbody>{s.jobs.recent.map((j) => <tr key={j.id}><td className="font-mono text-xs">{j.type}</td><td><Badge tone={j.state === "succeeded" ? "success" : j.state === "failed" ? "danger" : j.state === "running" ? "info" : "neutral"}>{j.state}</Badge></td><td className="tabular-nums">{j.attempts}/{j.max_attempts}</td><td className="text-sm text-fg-muted">{relativeTime(j.next_run_at)}</td><td className="text-sm text-fg-muted">{j.finished_at ? relativeTime(j.finished_at) : "—"}</td><td className="max-w-[320px] truncate text-xs text-danger" title={j.last_error ?? ""}>{j.last_error ?? ""}</td>{can(admin, "system.configure") ? <td>{j.state === "failed" ? <AdminAction path={`/api/admin/jobs/${j.id}/retry`}>Retry</AdminAction> : null}</td> : null}</tr>)}</tbody></DataTable>
        </>
      ) : null}
      {tab === "errors" ? (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card><CardHeader title={`Failed jobs (${s.jobs.failed.length})`} />{s.jobs.failed.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <ul className="divide-y divide-border-soft text-sm">{s.jobs.failed.map((j) => <li key={j.id} className="py-2"><span className="font-mono text-xs">{j.type}</span> <span className="text-xs text-fg-subtle">{relativeTime(j.created_at)} · {j.attempts} attempts</span><p className="text-xs text-danger">{j.last_error}</p>{can(admin, "system.configure") ? <div className="mt-1"><AdminAction path={`/api/admin/jobs/${j.id}/retry`}>Retry</AdminAction></div> : null}</li>)}</ul>}</Card>
          <Card><CardHeader title="Recorded errors" description="Failures the platform audited." />{s.jobs.errors.length === 0 ? <p className="text-sm text-fg-subtle">None.</p> : <ul className="divide-y divide-border-soft text-sm">{s.jobs.errors.map((e, i) => <li key={i} className="py-2"><span className="font-mono text-xs">{e.action}</span> <span className="text-xs text-fg-subtle">{formatDateTime(e.occurred_at)}</span><p className="truncate text-xs text-fg-muted">{JSON.stringify(e.metadata)}</p></li>)}</ul>}</Card>
        </div>
      ) : null}
      {tab === "api" ? <Card><CardHeader title="API keys" description="Boredroom does not expose a public API yet. When it does, keys, permissions, usage and rate limits will be managed here." /><p className="text-sm text-fg-subtle">Phase 2.</p></Card> : null}
    </>
  );
}
