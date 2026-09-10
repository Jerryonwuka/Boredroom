import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthShell } from "@/components/auth/auth-shell";
import { LoginForm } from "@/components/auth/forms";
import { Alert } from "@/components/ui/states";
import { getCurrentUser } from "@/server/auth";

export const metadata = { title: "Sign in" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (user) redirect(sp.next && sp.next.startsWith("/") ? sp.next : "/app");
  return (
    <AuthShell title="Welcome back" subtitle="Sign in to see what your team is working on." footer={<>New here? <Link className="text-fg underline" href={sp.next ? `/signup?next=${encodeURIComponent(sp.next)}` : "/signup"}>Create an account</Link></>}>
      {sp.reset ? <Alert tone="success" className="mb-4">Your password was changed. Sign in with the new one.</Alert> : null}
      <LoginForm next={sp.next} />
    </AuthShell>
  );
}
