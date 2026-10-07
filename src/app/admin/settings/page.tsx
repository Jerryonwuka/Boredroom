import { requireAdmin, can } from "@/server/admin/auth";
import { generalSettings, billingSettings, featureFlags, FEATURE_KEYS } from "@/server/admin/settings";
import { paystackStatus } from "@/server/admin/paystack-config";
import { brevoConfigured, brevoAccount } from "@/server/admin/marketing";
import { googleConfigured } from "@/server/auth/google";
import { PageHeader, Card, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Facts } from "@/components/admin/fields";
import { GeneralSettingsForm, BillingSettingsForm, FeatureFlagsForm, PaystackSettingsForm } from "@/components/admin/platform-forms";
import { PageNote, PageNotes } from "@/components/ui/page-notes";

export const metadata = { title: "Settings" };

const VIEW_ONLY = <p className="text-sm font-normal text-secondary">Your role can view these settings but not change them.</p>;

export default async function SettingsPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const admin = await requireAdmin("settings.view");
  const { tab: t } = await searchParams;
  const pay = await paystackStatus();
  const tab = ["general", "billing", "brevo", "paystack", "security", "flags"].includes(t ?? "") ? t! : "general";
  const tabs = [["general", "General"], ["billing", "Billing"], ["brevo", "Brevo"], ["paystack", "Paystack"], ["security", "Security"], ["flags", "Feature flags"]].map(([v, l]) => ({ label: l, href: `/admin/settings${v === "general" ? "" : `?tab=${v}`}`, value: v }));
  const edit = can(admin, "settings.edit");
  const brevo = brevoConfigured() ? await brevoAccount().then((a) => ({ ok: true as const, email: a.email, company: a.companyName })).catch((e: Error) => ({ ok: false as const, error: e.message })) : null;
  const google = googleConfigured();
  return (
    <>
      <div>
        <PageHeader title="Settings" description="Platform-wide configuration."
          tabs={tabs} tabValue={tab} tabsLabel="Settings sections" />
        {tab === "general" ? <Card><CardHeader title="General" />{edit ? <GeneralSettingsForm value={await generalSettings()} /> : VIEW_ONLY}</Card> : null}
        {tab === "billing" ? <Card><CardHeader title="Billing defaults" description="Trial length for new paid plans and the grace period before a lapsed subscription expires." />{edit ? <BillingSettingsForm value={await billingSettings()} /> : VIEW_ONLY}</Card> : null}
        {tab === "brevo" ? (
          <Card>
            <CardHeader title="Brevo" />
            <Facts items={[
              { label: "SMTP relay", hint: "MAIL_PROVIDER", value: <Badge tone={process.env.MAIL_PROVIDER === "smtp" ? "success" : "neutral"} dot={process.env.MAIL_PROVIDER === "smtp"}>{process.env.MAIL_PROVIDER ?? "sink"}</Badge> },
              { label: "Sender", hint: "MAIL_FROM", value: process.env.MAIL_FROM ?? "Default" },
              { label: "API key", hint: "BREVO_API_KEY", value: brevo ? brevo.ok ? <Badge tone="success" dot>Connected as {brevo.email}</Badge> : <Badge tone="danger" dot>{brevo.error}</Badge> : <Badge>Not set</Badge> },
              { label: "List id", hint: "BREVO_LIST_ID", value: process.env.BREVO_LIST_ID ?? "None; contacts are synced without a list" },
            ]} />
            <p className="mt-4 text-meta font-normal text-secondary">Contact attributes synced: FIRSTNAME, LASTNAME, ORGANIZATION, PLAN, SUBSCRIPTION_STATUS, SUBSCRIPTION_EXPIRY, SIGNUP_DATE, LAST_ACTIVITY, COUNTRY, STATUS, WAITLIST. Create them once in Brevo under Contacts, Settings, Contact attributes.</p>
          </Card>
        ) : null}
        {tab === "paystack" ? (
          <Card>
            <CardHeader title="Paystack" description="The keys checkout, verification and webhooks run on. Test first, then switch to live." action={<Badge tone={pay.configured ? (pay.mode === "live" ? "success" : "warning") : "neutral"} dot>{pay.configured ? (pay.mode === "live" ? "Live mode" : "Test mode") : "Not set up"}</Badge>} />
            {edit ? <PaystackSettingsForm status={pay} /> : <p className="text-sm font-normal text-secondary">View only. {pay.configured ? `Paystack is in ${pay.mode} mode.` : "Paystack is not set up."}</p>}
          </Card>
        ) : null}
        {tab === "security" ? (
          <Card>
            <CardHeader title="Security" />
            <Facts items={[
              { label: "Sign in with Google", value: <Badge tone={google ? "success" : "neutral"} dot={google}>{google ? "On" : "Off"}</Badge> },
              { label: "Admin sessions", value: "Same 30-day sessions as the app; revoke under Admins and permissions" },
              { label: "Impersonation sessions", value: "Two hours, recorded; administrators cannot be impersonated" },
              { label: "MFA for privileged roles", value: <Badge>Reserved (mfa_required flag)</Badge> },
              { label: "Rate limits", value: "Sign-in, sign-up, recovery and the waitlist form" },
            ]} />
          </Card>
        ) : null}
        {tab === "flags" ? <Card><CardHeader title="Global feature flags" description="Platform-wide defaults." />{can(admin, "flags.edit") ? <FeatureFlagsForm value={await featureFlags()} keys={FEATURE_KEYS} /> : VIEW_ONLY}</Card> : null}
      </div>
      <PageNotes>
        <PageNote>Secrets live in the server environment and are never shown here; this page says whether they are present and working.</PageNote>
        {tab === "brevo" ? <PageNote section="Brevo">Email delivery goes through Brevo&apos;s SMTP relay (SMTP_URL). The API key adds contact synchronisation, attributes and lists.</PageNote> : null}
        {tab === "paystack" && edit ? <PageNote section="Paystack">Events handled: charge.success, charge.failed, invoice.payment_failed, subscription.create, subscription.disable, subscription.not_renew, refund.processed. Every delivery is checked against the stored secrets and stored once.</PageNote> : null}
        {tab === "flags" ? <PageNote section="Global feature flags">A plan&apos;s entitlements and an organisation&apos;s overrides win over these. Features with no flag set are on.</PageNote> : null}
      </PageNotes>
    </>
  );
}
