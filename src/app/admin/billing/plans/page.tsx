import { Tags } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { listPlans } from "@/server/admin/billing";
import { FEATURE_KEYS } from "@/server/admin/settings";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge, MonoChip } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { PlanForm } from "@/components/admin/billing-forms";
import { EditSheet, SheetButton } from "@/components/admin/actions";
import { words } from "@/components/admin/fields";
import { FEATURE_LABELS } from "@/lib/plans";
import { bytes, money, num } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Plans" };
const PLAN_TONE: Record<string, "success" | "warning" | "neutral"> = { active: "success", hidden: "warning" };

export default async function PlansPage() {
  const admin = await requireAdmin("plan.view");
  const plans = await listPlans();
  const editable = can(admin, "plan.edit");
  return (
    <>
      <div>
        <PageHeader title="Plans" description="What organisations can be on."
          actions={can(admin, "plan.create") ? <SheetButton label="New plan" icon="plus" variant="accent" sheetSize="lg" title="New plan"><PlanForm featureKeys={FEATURE_KEYS} /></SheetButton> : null} divider />
        {plans.length === 0 ? <EmptyState icon={Tags} title="No plans yet" description="Organisations choose from these on the pricing page." /> : (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {plans.map((p) => {
              const features = Object.entries(p.features).filter(([, v]) => v).map(([k]) => k);
              return (
                <Card key={p.id} className={cn("flex min-w-0 flex-col", p.status === "archived" && "opacity-60")}>
                  <CardHeader title={<span className="flex flex-wrap items-center gap-2">{p.name}<Badge tone={PLAN_TONE[p.status] ?? "neutral"}>{words(p.status)}</Badge></span>} description={p.description ?? undefined} size="sm" className="mb-3"
                    action={editable ? <EditSheet title={`Edit the ${p.name} plan`} size="lg"><PlanForm plan={p} featureKeys={FEATURE_KEYS} /></EditSheet> : undefined} />
                  <p className="flex items-baseline gap-1"><span className="type-stat">{money(p.monthly_price, p.currency)}</span><span className="text-meta font-normal text-secondary">a month</span></p>
                  <p className="mt-1 text-meta font-normal text-secondary">{money(p.annual_price, p.currency)} a year</p>
                  <ul className="mt-4 grid gap-1 text-meta font-normal text-secondary">
                    <li>{p.max_workspaces ? `${p.max_workspaces} workspace${p.max_workspaces === 1 ? "" : "s"}` : "Unlimited workspaces"}</li>
                    <li>{p.max_users ? `${p.max_users} people` : "Unlimited people"}</li>
                    <li>{p.max_storage_bytes ? `${bytes(p.max_storage_bytes)} of storage` : "Unlimited storage"}</li>
                    <li>{p.trial_days ? `${p.trial_days}-day trial` : "No trial"}</li>
                  </ul>
                  {features.length ? <ul className="mt-4 flex flex-wrap gap-1.5">{features.map((k) => <li key={k}><Badge>{FEATURE_LABELS[k] ?? k.replace(/_/g, " ").toLowerCase()}</Badge></li>)}</ul> : null}
                  <p className="mt-auto flex items-center justify-between gap-2 pt-4 text-meta font-normal text-secondary"><span><span className="tabular-nums text-foreground">{num(p.subscribers)}</span> organisation{p.subscribers === 1 ? "" : "s"} on it</span><MonoChip>{p.code}</MonoChip></p>
                </Card>
              );
            })}
          </div>
        )}
      </div>
      <PageNotes>
        <PageNote>Prices are in minor units in the database and shown here in the plan&apos;s currency.</PageNote>
        <PageNote>Changing or archiving a plan never touches an existing subscription.</PageNote>
      </PageNotes>
    </>
  );
}
