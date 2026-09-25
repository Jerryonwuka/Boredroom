import { requireAdmin, can } from "@/server/admin/auth";
import { listPlans } from "@/server/admin/billing";
import { FEATURE_KEYS } from "@/server/admin/settings";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PlanForm } from "@/components/admin/billing-forms";
import { EditSheet } from "@/components/admin/actions";
import { bytes, money, num } from "@/lib/format";

export const metadata = { title: "Plans" };

export default async function PlansPage() {
  const admin = await requireAdmin("plan.view");
  const plans = await listPlans();
  const editable = can(admin, "plan.edit");
  return (
    <>
      <PageHeader icon="card-check" title="Plans" description="What organisations can be on. Prices are in minor units in the database and shown here in the plan's currency. Changing or archiving a plan never touches an existing subscription." />
      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((p) => (
          <Card key={p.id} className={p.status === "archived" ? "opacity-60" : ""}>
            <CardHeader title={<span className="flex items-center gap-2">{p.name}<Badge tone={p.status === "active" ? "success" : p.status === "hidden" ? "warning" : "neutral"}>{p.status}</Badge></span>} description={p.description ?? undefined} />
            <p className="font-display text-3xl">{money(p.monthly_price, p.currency)}<span className="text-sm text-fg-subtle"> / month</span></p>
            <p className="eyebrow mt-1">{money(p.annual_price, p.currency)} a year · {p.max_users ? `${p.max_users} people` : "unlimited people"} · {p.max_storage_bytes ? bytes(p.max_storage_bytes) : "unlimited storage"} · {p.trial_days ? `${p.trial_days}-day trial` : "no trial"}</p>
            <p className="mt-2 text-xs text-fg-subtle">{num(p.subscribers)} organisation{p.subscribers === 1 ? "" : "s"} on it</p>
            <ul className="mt-3 flex flex-wrap gap-1">{Object.entries(p.features).filter(([, v]) => v).map(([k]) => <li key={k}><Badge tone="accent">{k.replace(/_/g, " ").toLowerCase()}</Badge></li>)}</ul>
            {editable ? <div className="mt-4"><EditSheet title={`Edit the ${p.name} plan`}><PlanForm plan={p} featureKeys={FEATURE_KEYS} /></EditSheet></div> : null}
          </Card>
        ))}
      </div>
      {can(admin, "plan.create") ? <Card className="mt-6"><CardHeader title="New plan" /><PlanForm featureKeys={FEATURE_KEYS} /></Card> : null}
    </>
  );
}
