import { Workflow } from "lucide-react";
import { requireAdmin, can } from "@/server/admin/auth";
import { listAutomations, listTemplates } from "@/server/admin/marketing";
import { PageHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { AutomationForm } from "@/components/admin/marketing-forms";
import { EditSheet, SheetButton } from "@/components/admin/actions";
import { MARKETING_TABS } from "@/components/admin/fields";
import { num } from "@/lib/format";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Automations" };
const LABEL: Record<string, string> = { user_created: "User created", account_age_days: "Account age", user_inactive_days: "Inactive", subscription_expiring_days: "Expiring in", subscription_expired: "Subscription expired", payment_failed: "Payment failed", payment_successful: "Payment successful", waitlist_joined: "Joined the waitlist", waitlist_invited: "Invited from waitlist" };

export default async function AutomationsPage() {
  const admin = await requireAdmin("marketing.view");
  const [autos, templates] = await Promise.all([listAutomations(), listTemplates()]);
  const editable = can(admin, "marketing.create");
  return (
    <>
      <PageHeader title="Automations" description="Lifecycle and billing emails that run from platform events (at once) or from the daily scheduler (account age, inactivity, expiry). Each runs once per person or subscription; lifecycle mail respects unsubscribes, billing mail does not."
        actions={editable ? <SheetButton label="New automation" icon="plus" variant="accent" title="New automation"><AutomationForm templates={templates} /></SheetButton> : null}
        tabs={MARKETING_TABS} tabsLabel="Marketing sections" />
      {autos.length === 0 ? <EmptyState icon={Workflow} title="No automations yet" description="Lifecycle and billing emails appear here once they exist." /> : (
        <DataTable caption="Automations">
          <thead><tr><th>Automation</th><th>Trigger</th><th>Template</th><th>State</th><th>Runs</th><th>Last run</th>{editable ? <th><span className="sr-only">Actions</span></th> : null}</tr></thead>
          <tbody>{autos.map((a) => (
            <tr key={a.id}>
              <td className="font-medium">{a.name}</td>
              <td>{LABEL[a.trigger] ?? a.trigger}{a.trigger_value != null ? ` ${a.trigger_value} day${a.trigger_value === 1 ? "" : "s"}` : ""}</td>
              <td>{a.template_name}</td>
              <td>{a.enabled ? <Badge tone="success" dot>On</Badge> : <Badge>Off</Badge>}</td>
              <td className="tabular-nums">{num(a.runs)}</td>
              <td className="text-secondary">{a.last_run ? relativeTime(a.last_run) : "Never"}</td>
              {editable ? <td className="text-right"><EditSheet title="Edit automation"><AutomationForm automation={a} templates={templates} /></EditSheet></td> : null}
            </tr>
          ))}</tbody>
        </DataTable>
      )}
    </>
  );
}
