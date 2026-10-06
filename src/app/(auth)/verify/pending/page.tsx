import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell, AUTH_LINK } from "@/components/auth/auth-shell";
import { ResendVerification, SignOutButton } from "@/components/auth/forms";
import { safeNextPath } from "@/components/auth/next-path";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { cn } from "@/lib/utils";
import { getCurrentUser } from "@/server/auth";

export const metadata = { title: "Verify your email" };

export default async function PendingPage({ searchParams }: { searchParams: Promise<{ next?: string | string[]; check?: string | string[] }> }) {
  const sp = await searchParams;
  const next = sp.next ? safeNextPath(sp.next) : null;
  const user = await getCurrentUser();
  // Signing in brings an unconfirmed person back here, still carrying where they were going.
  if (!user) redirect(next ? `/login?next=${encodeURIComponent(next)}` : "/login");
  if (user.emailVerified) redirect(next ?? "/app");
  // Confirmed in another tab? This page moves on by itself once the address is confirmed, so "continue" is a reload.
  // The count changes the address each time, so a second press is a fresh look and not a navigation to the same place.
  const checks = Number([sp.check].flat()[0]) || 0;
  const again = `/verify/pending?${new URLSearchParams({ ...(next ? { next } : {}), check: String(checks + 1) })}`;
  const devHint = process.env.NODE_ENV !== "production" ? <p className="text-center text-meta font-normal text-subtle">Development: the message was written to the local mail sink. Open <a className={AUTH_LINK} href="/dev/mail">/dev/mail</a> to read it.</p> : null;
  return (
    <AuthShell title="Check your inbox" subtitle={<>We sent a verification link to <span className="font-medium text-foreground">{user.email}</span>. Until you open it you can sign in, but you cannot create or join a workspace.</>} footer={<SignOutButton />}>
      {checks > 0 ? <Alert tone="info">Not confirmed yet. Open the link in the email we sent to {user.email}, then press Continue again.</Alert> : null}
      <div className="flex flex-col gap-3">
        <Link href={again} className={cn(buttonVariants({ size: "lg" }), "w-full")}>Continue</Link>
        <ResendVerification />
      </div>
      {devHint}
    </AuthShell>
  );
}
