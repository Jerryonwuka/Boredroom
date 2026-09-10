import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { SignupForm } from "@/components/auth/forms";
import { getCurrentUser } from "@/server/auth";

export const metadata = { title: "Create account" };

export default async function SignupPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/app");
  return (
    <AuthShell title="Create your account" subtitle="One account can belong to several workspaces." footer={<>Already have an account? <Link className="text-fg underline" href={sp.next ? `/login?next=${encodeURIComponent(sp.next)}` : "/login"}>Sign in</Link></>}>
      <SignupForm next={sp.next} />
    </AuthShell>
  );
}
