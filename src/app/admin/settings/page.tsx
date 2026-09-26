import { requireAdmin, can } from "@/server/admin/auth";
import { generalSettings, billingSettings, featureFlags, FEATURE_KEYS } from "@/server/admin/settings";
import { paystackStatus } from "@/server/admin/paystack-config";
import { brevoConfigured, brevoAccount } from "@/server/admin/marketing";
import { googleConfigured } from "@/server/auth/google";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Tabs } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { GeneralSettingsForm, BillingSettingsForm, FeatureFlagsForm, PaystackSettingsForm } from "@/components/admin/platform-forms";

export const metadata = { title: "Settings" };

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("settings.view");
  const { tab: t } = await searchParams;
  const pay = await paystackStatus();
  const tab = ["general", "billing", "brevo", "paystack", "security", "flags"].includes(t ?? "") ? t! : "general";
  const tabs = [["general", "General"], ["billing", "Billing"], ["brevo", "Brevo"], ["paystack", "Paystack"], ["security", "Security"], ["flags", "Feature flags"]].map(([v, l]) => ({ label: l, href: `/admin/settings${v === "general" ? "" : `?tab=${v}`}`, value: v }));
  const edit = can(admin, "settings.edit");
  const origin = process.env.APP_ORIGIN ?? "http://localhost:3000";
  const brevo = brevoConfigured() ? await brevoAccount().then((a) => ({ ok: true as const, email: a.email, company: a.companyName })).catch((e: Error) => ({ ok: false as const, error: e.message })) : null;
  return (
    <>
      <PageHeader icon="desk" title="Settings" description="Platform-wide configuration. Secrets live in the server environment and are never shown here; this page says whether they are present and working." />
      <Tabs tabs={tabs} value={tab} className="mb-6" label="Settings sections" />
      {tab === "general" ? <Card><CardHeader title="General" />{edit ? <GeneralSettingsForm value={await generalSettings()} /> : <p className="text-sm text-fg-subtle">View only.</p>}</Card> : null}
      {tab === "billing" ? <Card><CardHeader title="Billing defaults" description="Trial length for new paid plans and the grace period before a lapsed subscription expires." />{edit ? <BillingSettingsForm value={await billingSettings()} /> : <p className="text-sm text-fg-subtle">View only.</p>}</Card> : null}
      {tab === "brevo" ? (
        <Card><CardHeader title="Brevo" description="Email delivery goes through Brevo's SMTP relay (SMTP_URL). The API key adds contact synchronisation, attributes and lists." />
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3"><span>SMTP relay (MAIL_PROVIDER)</span><Badge tone={process.env.MAIL_PROVIDER === "smtp" ? "success" : "neutral"}>{process.env.MAIL_PROVIDER ?? "sink"}</Badge></li>
            <li className="flex items-center justify-between gap-3"><span>Sender (MAIL_FROM)</span><span className="text-fg-muted">{process.env.MAIL_FROM ?? "default"}</span></li>
            <li className="flex items-center justify-between gap-3"><span>API key (BREVO_API_KEY)</span>{brevo ? brevo.ok ? <Badge tone="success">connected as {brevo.email}</Badge> : <Badge tone="danger">{brevo.error}</Badge> : <Badge tone="neutral">not set</Badge>}</li>
            <li className="flex items-center justify-between gap-3"><span>List id (BREVO_LIST_ID)</span><span className="text-fg-muted">{process.env.BREVO_LIST_ID ?? "none; contacts are synced without a list"}</span></li>
          </ul>
          <p className="mt-4 text-xs text-fg-subtle">Contact attributes synced: FIRSTNAME, LASTNAME, ORGANIZATION, PLAN, SUBSCRIPTION_STATUS, SUBSCRIPTION_EXPIRY, SIGNUP_DATE, LAST_ACTIVITY, COUNTRY, STATUS, WAITLIST. Create them once in Brevo under Contacts, Settings, Contact attributes.</p>
        </Card>
      ) : null}
      {tab === "paystack" ? (
        <Card><CardHeader title="Paystack" description="The keys checkout, verification and webhooks run on. Test first, then switch to live." action={<Badge tone={pay.configured ? (pay.mode === "live" ? "success" : "warning") : "neutral"} dot>{pay.configured ? `${pay.mode} mode` : "not set up"}</Badge>} />
          {edit ? <PaystackSettingsForm status={pay} /> : <p className="text-sm text-fg-subtle">View only. {pay.configured ? `Paystack is in ${pay.mode} mode.` : "Paystack is not set up."}</p>}
        </Card>
      ) : null}
      {tab === "security" ? (
        <Card><CardHeader title="Security" />
          <ul className="space-y-2 text-sm">
            <li className="flex items-center justify-between gap-3"><span>Sign in with Google</span><Badge tone={googleConfigured() ? "success" : "neutral"}>{googleConfigured() ? "on" : "off"}</Badge></li>
            <li className="flex items-center justify-between gap-3"><span>Admin sessions</span><span className="text-fg-muted">Same 30-day sessions as the app; revoke under Admins and permissions</span></li>
            <li className="flex items-center justify-between gap-3"><span>Impersonation sessions</span><span className="text-fg-muted">Two hours, recorded, admins cannot be impersonated</span></li>
            <li className="flex items-center justify-between gap-3"><span>MFA for privileged roles</span><Badge tone="neutral">reserved (mfa_required flag)</Badge></li>
            <li className="flex items-center justify-between gap-3"><span>Rate limits</span><span className="text-fg-muted">Sign-in, sign-up, recovery and the waitlist form</span></li>
          </ul>
        </Card>
      ) : null}
      {tab === "flags" ? <Card><CardHeader title="Global feature flags" description="Platform-wide defaults. A plan's entitlements and an organisation's overrides win over these. Features with no flag set are on." />{can(admin, "flags.edit") ? <FeatureFlagsForm value={await featureFlags()} keys={FEATURE_KEYS} /> : <p className="text-sm text-fg-subtle">View only.</p>}</Card> : null}
    </>
  );
}
