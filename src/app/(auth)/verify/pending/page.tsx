import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { ResendVerification, SignOutButton } from "@/components/auth/forms";
import { VerifyWatch } from "@/components/auth/verify-watch";
import { safeNextPath } from "@/components/auth/next-path";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";
import { inDesktopApp, signInPath } from "@/server/lib/desktop-app";

export const metadata = { title: "Verify your email" };

/**
 * "Check your inbox". Since the first-run welcome (owner request, 11 October 2026) the link in the email opens on any
 * device and this page moves on by itself once the address is confirmed (VerifyWatch); Continue and the resend button
 * stay for keyboards and for browsers without script. The resent link leads to the same place (`next`).
 */
export default async function PendingPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; check?: string | string[] }> }) {
  const sp = await searchParams;
  const next = sp.next ? safeNextPath(sp.next) : null;
  const user = await getCurrentUser();
  // Signing in brings an unconfirmed person back here, still carrying where they were going.
  if (!user) redirect(next ? await signInPath(next) : (await inDesktopApp()) ? "/desktop/app?next=%2Fapp" : "/login");
  if (user.emailVerified) redirect(next ?? "/app");
  // Confirmed in another tab? This page moves on by itself once the address is confirmed, so "continue" is a reload.
  // The count changes the address each time, so a second press is a fresh look and not a navigation to the same place.
  const checks = Number([sp.check].flat()[0]) || 0;
  const again = `/verify/pending?${new URLSearchParams({ ...(next ? { next } : {}), check: String(checks + 1) })}`;
  const devHint = process.env.NODE_ENV !== "production" ? <p className="text-center text-meta font-normal text-subtle">Development: the message was written to the local mail sink. Open <a className={AUTH_LINK} href="/dev/mail">/dev/mail</a> to read it.</p> : null;
  return (
    <AuthShell title="Check your inbox" subtitle={<>We sent a link to <span className="font-medium text-foreground">{user.email}</span>. Open it on any device, and this page moves on by itself once you&apos;ve confirmed.</>} footer={<SignOutButton />}>
      <VerifyWatch next={next} />
      {checks > 0 ? <Alert tone="info">Not confirmed yet. Open the link in the email we sent to {user.email}, then press Continue again.</Alert> : null}
      <div className="flex flex-col gap-3">
        <Link href={again} className={cn(buttonVariants({ size: "lg" }), "w-full")}>Continue</Link>
        <ResendVerification next={next} />
      </div>
      {devHint}
    </AuthShell>
  );
}
