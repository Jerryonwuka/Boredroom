import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { ResendVerification, SignOutButton } from "@/components/auth/forms";
import { getCurrentUser } from "@/server/auth";

export const metadata = { title: "Verify your email" };

export default async function PendingPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (user.emailVerified) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/app");
  const devHint = process.env.NODE_ENV !== "production" ? <p className="mt-4 text-sm text-fg-subtle">Development: the message was written to the local mail sink. Open <a className="underline" href="/dev/mail">/dev/mail</a> to read it.</p> : null;
  return (
    <AuthShell title="Check your inbox" subtitle={`We sent a verification link to ${user.email}.`} footer={<SignOutButton />}>
      <p className="text-sm text-fg-muted">Open the link to confirm your address. Until then you can sign in, but you cannot create or join a workspace.</p>
      {devHint}
      <div className="mt-6"><ResendVerification /></div>
    </AuthShell>
  );
}
