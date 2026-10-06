import { Filter } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { listSegments } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { MonoChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { AdminAction, EditSheet, SheetButton } from "@/components/admin/actions";
import { SegmentForm } from "@/components/admin/marketing-forms";
import { MARKETING_TABS } from "@/components/admin/fields";
import { num } from "@/lib/format";

export const metadata = { title: "Segments" };
const OP: Record<string, string> = { eq: "is", neq: "is not", gte: "at least", lte: "at most", contains: "contains" };

export default async function SegmentsPage() {
  const admin = await requireAdmin("marketing.view");
  const segments = await listSegments();
  const editable = can(admin, "marketing.create");
  return (
    <>
      <PageHeader title="Segments" description="Dynamic audiences: conditions on the contact, its account, plan and activity, evaluated at send time."
        actions={editable ? <SheetButton label="New segment" icon="plus" variant="accent" title="New segment" description="Every condition must hold for a contact to be in it."><SegmentForm /></SheetButton> : null}
        tabs={MARKETING_TABS} tabsLabel="Marketing sections" />
      {segments.length === 0 ? <EmptyState icon={Filter} title="No segments yet" description="The audiences built into campaigns (waitlist, free, paid, trial, expiring) need none." /> : (
        <div className="grid gap-3 md:grid-cols-2">
          {segments.map((s) => (
            <Card key={s.id}>
              <CardHeader title={s.name} description={s.description ?? undefined} action={<span className="text-meta font-normal text-secondary"><span className="tabular-nums text-foreground">{num(s.size)}</span> contacts</span>} />
              {s.rules.length === 0 ? <p className="text-meta font-normal text-secondary">No conditions: every subscribed contact.</p> : (
                <ul className="flex flex-wrap gap-1.5">{s.rules.map((r, i) => <li key={i}><MonoChip>{r.field} {OP[r.op] ?? r.op} {String(r.value)}</MonoChip></li>)}</ul>
              )}
              {editable ? (
                <div className="mt-4">
                  <EditSheet title={`Edit ${s.name}`}>
                    <SegmentForm segment={s} />
                    <div className="mt-6 border-t border-border pt-5">
                      <AdminAction path={`/api/admin/segments/${s.id}`} method="DELETE" danger confirm={{ title: `Delete the segment ${s.name}?`, label: "Delete" }}>Delete segment</AdminAction>
                    </div>
                  </EditSheet>
                </div>
              ) : null}
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
