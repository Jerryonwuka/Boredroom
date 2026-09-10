import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listMyWorkspaces } from "@/server/services/orgs";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/auth/forms";
import { EmptyState, Alert } from "@/components/ui/states";

export const metadata = { title: "Workspaces" };

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app");
  if (!user.emailVerified) redirect("/verify/pending");
  const workspaces = await listMyWorkspaces(user.profileId);
  if (workspaces.length === 1 && !sp.verified) redirect(`/app/${workspaces[0].slug}/my-day`);
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between"><Logo /><SignOutButton /></div>
      {sp.verified ? <Alert tone="success" className="mb-6">Your email is verified.</Alert> : null}
      <h1 className="text-3xl font-display">Your workspaces</h1>
      <p className="mt-1 text-fg-muted">Signed in as {user.email}</p>
      <div className="mt-6 grid gap-3">
        {workspaces.length === 0 ? (
          <EmptyState title="You are not in a workspace yet" description="Create one for your organisation, or accept an invitation link from your administrator." action={<Link href="/onboarding"><Button>Create a workspace</Button></Link>} />
        ) : workspaces.map((w) => (
          <Link key={w.id} href={`/app/${w.slug}/my-day`} className="tile flex items-center justify-between px-5 py-4 hover:border-border-strong">
            <div><p className="font-semibold">{w.name}</p><p className="text-sm text-fg-subtle">{w.timezone}</p></div>
            <Badge tone="accent">{w.role}</Badge>
          </Link>
        ))}
      </div>
      {workspaces.length > 0 ? <div className="mt-6"><Link href="/onboarding" className="text-sm text-fg-muted underline hover:text-fg">Create another workspace</Link></div> : null}
    </main>
  );
}
