import { requireAdmin, can } from "@/server/admin/auth";
import { listAutomations, listTemplates } from "@/server/admin/marketing";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { DataTable } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { AutomationForm } from "@/components/admin/marketing-forms";
import { EditSheet } from "@/components/admin/actions";
import { num } from "@/lib/format";
import { relativeTime } from "@/lib/utils";

export const metadata = { title: "Automations" };
const LABEL: Record<string, string> = { user_created: "User created", account_age_days: "Account age", user_inactive_days: "Inactive", subscription_expiring_days: "Expiring in", subscription_expired: "Subscription expired", payment_failed: "Payment failed", payment_successful: "Payment successful", waitlist_joined: "Joined the waitlist" };

export default async function AutomationsPage() {
  const admin = await requireAdmin("marketing.view");
  const [autos, templates] = await Promise.all([listAutomations(), listTemplates()]);
  const editable = can(admin, "marketing.create");
  return (
    <>
      <PageHeader icon="calendar-clock" title="Automations" description="Lifecycle and billing emails that run from platform events (at once) or from the daily scheduler (account age, inactivity, expiry). Each runs once per person or subscription; lifecycle mail respects unsubscribes, billing mail does not." />
      <DataTable caption="Automations" className="mb-6"><thead><tr><th>Automation</th><th>Trigger</th><th>Template</th><th>State</th><th>Runs</th><th>Last run</th>{editable ? <th></th> : null}</tr></thead>
        <tbody>{autos.map((a) => <tr key={a.id}><td className="font-semibold">{a.name}</td><td className="text-sm">{LABEL[a.trigger] ?? a.trigger}{a.trigger_value != null ? ` ${a.trigger_value} day${a.trigger_value === 1 ? "" : "s"}` : ""}</td><td className="text-sm">{a.template_name}</td><td>{a.enabled ? <Badge tone="success">on</Badge> : <Badge tone="neutral">off</Badge>}</td><td className="tabular-nums">{num(a.runs)}</td><td className="text-sm text-fg-muted">{a.last_run ? relativeTime(a.last_run) : "never"}</td>{editable ? <td><EditSheet title="Edit automation"><AutomationForm automation={a} templates={templates} /></EditSheet></td> : null}</tr>)}</tbody>
      </DataTable>
      {editable ? <Card><CardHeader title="New automation" /><AutomationForm templates={templates} /></Card> : null}
    </>
  );
}
