import { requireAdmin, can } from "@/server/admin/auth";
import { listSegments } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { AdminAction, EditSheet } from "@/components/admin/actions";
import { SegmentForm } from "@/components/admin/marketing-forms";
import { num } from "@/lib/format";

export const metadata = { title: "Segments" };

export default async function SegmentsPage() {
  const admin = await requireAdmin("marketing.view");
  const segments = await listSegments();
  const editable = can(admin, "marketing.create");
  return (
    <>
      <PageHeader icon="focus-target" title="Segments" description="Dynamic audiences: conditions on the contact, its account, plan and activity, evaluated at send time." />
      <div className="grid gap-4 md:grid-cols-2">
        {segments.map((s) => (
          <Card key={s.id}><CardHeader title={s.name} description={s.description ?? undefined} action={<span className="text-sm text-fg-muted">{num(s.size)} contacts</span>} />
            <ul className="flex flex-wrap gap-1 text-xs">{s.rules.map((r, i) => <li key={i} className="chip px-2 py-1">{r.field} {r.op} {String(r.value)}</li>)}{s.rules.length === 0 ? <li className="text-fg-subtle">No conditions: every subscribed contact.</li> : null}</ul>
            {editable ? <div className="mt-3"><EditSheet title={`Edit ${s.name}`}><SegmentForm segment={s} /><div className="border-t border-border-soft pt-3"><AdminAction path={`/api/admin/segments/${s.id}`} method="DELETE" danger confirm={{ title: `Delete the segment ${s.name}?`, label: "Delete" }}>Delete segment</AdminAction></div></EditSheet></div> : null}
          </Card>
        ))}
        {segments.length === 0 ? <p className="text-sm text-fg-subtle">No segments yet. The audiences built into campaigns (waitlist, free, paid, trial, expiring) need none.</p> : null}
      </div>
      {editable ? <Card className="mt-6"><CardHeader title="New segment" /><SegmentForm /></Card> : null}
    </>
  );
}
