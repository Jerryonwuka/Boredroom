import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader, Card } from "@/components/ui/card";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { policyView } from "@/server/services/views";
import { formatDateTime } from "@/lib/utils";
import { AcknowledgePolicy } from "@/components/app/small-actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Monitoring policy" };

export default async function PolicyPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ required?: string; welcome?: string; next?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts } = await workspacePage(workspace, `/app/${workspace}/policy`);
  const { policy, acknowledgedAt, history } = await policyView(ctx);
  return (
    <AppShell ctx={ctx} counts={counts}>
      <PageHeader overline="Transparency" title="What Boredroom records about you" description="Read the current notice. Material changes create a new version that must be acknowledged before recorded work starts." />
      {sp.welcome ? <Alert tone="success" className="mb-4" title={`Welcome to ${ctx.org.name}`}>Your employee ID is {ctx.membership.employee_code}. Review the notice below to continue.</Alert> : null}
      {sp.required ? <Alert tone="warning" className="mb-4">Acknowledge the current policy version to continue.</Alert> : null}
      {!policy ? <Alert tone="info">No policy is configured yet.</Alert> : (
        <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
          <Card>
            <div className="mb-3 flex flex-wrap items-center gap-2"><Badge tone="accent">Version {policy.version}</Badge><Badge>{policy.recording_mode.replace(/_/g, " ")}</Badge><Badge>retention {policy.retention_days} days</Badge>{policy.effective_at ? <span className="text-xs text-fg-subtle">effective {formatDateTime(policy.effective_at, ctx.org.timezone)}</span> : null}</div>
            <div className="prose-sm whitespace-pre-wrap text-fg-muted">{policy.notice_text}</div>
            <div className="mt-6">
              {acknowledgedAt ? <Alert tone="success">You acknowledged version {policy.version} on {formatDateTime(acknowledgedAt, ctx.org.timezone)}.</Alert> : <AcknowledgePolicy orgSlug={ctx.org.slug} next={sp.next} />}
            </div>
          </Card>
          <Card>
            <h2 className="font-display text-lg">Your acknowledgements</h2>
            <ul className="mt-2 space-y-1 text-sm text-fg-muted">{history.length === 0 ? <li>None yet.</li> : history.map((h) => <li key={h.policy_id}>Version {h.version} · {formatDateTime(h.acknowledged_at, ctx.org.timezone)}</li>)}</ul>
            <h2 className="mt-6 font-display text-lg">What is never recorded</h2>
            <ul className="mt-2 list-disc space-y-1 pl-4 text-sm text-fg-muted"><li>Audio or microphone</li><li>Keystrokes or mouse movement</li><li>Screens you did not choose to share</li><li>Anything while no session is running</li></ul>
          </Card>
        </div>
      )}
    </AppShell>
  );
}
