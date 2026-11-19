import Link from "next/link";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { UnsubscribeButton } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";
import { unsubscribePreview } from "@/server/admin/marketing";

export const metadata = { title: "Unsubscribe", robots: { index: false } };

/**
 * The link in the footer of product news (owner decision, 11 November 2026: marketing email only for people who opt in,
 * with a way out in every one). Opening it changes nothing: mail scanners open links too, so the person presses once.
 * The address is shown masked, because the link may be forwarded.
 */
export default async function UnsubscribePage({ searchParams }: { searchParams: Promise<{ t?: string | string[] }> }) {
  const token = [(await searchParams).t].flat()[0] ?? "";
  const who = token ? await unsubscribePreview(token) : null;
  const footer = <Link className={AUTH_LINK} href="/privacy">How we use your details</Link>;
  if (!who) {
    return (
      <AuthShell title="This link doesn't work" subtitle="It may have been cut short. Use the Unsubscribe link in the latest email from us." footer={footer}>
        <Alert tone="warning">Nothing was changed.</Alert>
      </AuthShell>
    );
  }
  if (who.done) {
    return (
      <AuthShell title="You are unsubscribed" subtitle={`${who.email} does not get product news from Boredroom.`} footer={footer}>
        <Alert tone="success">Emails about your account, security and billing still arrive.</Alert>
      </AuthShell>
    );
  }
  return (
    <AuthShell title="Stop product news?" subtitle={`We'll stop sending product news to ${who.email}. Emails about your account, security and billing still arrive.`} footer={footer}>
      <UnsubscribeButton token={token} />
    </AuthShell>
  );
}
