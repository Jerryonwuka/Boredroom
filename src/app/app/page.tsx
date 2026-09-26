import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/server/auth";
import { listMyWorkspaces } from "@/server/services/orgs";
import { workspaceAllowance } from "@/server/services/workspace-limit";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SignOutButton } from "@/components/auth/forms";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { EmptyState, Alert } from "@/components/ui/states";

export const metadata = { title: "Workspaces" };

export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ verified?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app");
  if (!user.emailVerified) redirect("/verify/pending");
  const [workspaces, allowance] = await Promise.all([listMyWorkspaces(user.profileId), workspaceAllowance(user.profileId)]);
  const full = allowance.limit !== null && allowance.used >= allowance.limit;
  if (workspaces.length === 1 && !sp.verified) redirect(`/app/${workspaces[0].slug}`);
  return (
    <main id="main" className="mx-auto w-full max-w-2xl px-4 py-12">
      <div className="mb-8 flex items-center justify-between"><Logo /><div className="flex items-center gap-2"><ThemeToggle /><SignOutButton /></div></div>
      {sp.verified ? <Alert tone="success" className="mb-6">Your email is verified.</Alert> : null}
      <h1 className="font-display text-[30px] leading-[1.1] tracking-[-0.02em] md:text-[38px]">Your workspaces</h1>
      <p className="mt-1 text-fg-muted">Signed in as {user.email}</p>
      <div className="mt-6 grid gap-3">
        {workspaces.length === 0 ? (
          <EmptyState title="You are not in a workspace yet" description="Create an organisation account for your company, or join your organisation with the code or link it gave you." action={<div className="flex gap-2"><Link href="/onboarding"><Button>Create an organisation</Button></Link><Link href="/join"><Button variant="outline">Join with a code</Button></Link></div>} />
        ) : workspaces.map((w) => (
          <Link key={w.id} href={`/app/${w.slug}`} className="tile tile-link flex items-center justify-between px-5 py-4">
            <div><p className="font-semibold">{w.name}</p><p className="text-sm text-fg-subtle">{w.timezone}</p></div>
            <Badge tone="accent">{{ owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" }[w.role]}</Badge>
          </Link>
        ))}
      </div>
      {workspaces.length > 0 ? (
        <div className="mt-8 tile p-5">
          <p className="eyebrow">Another organisation</p>
          <p className="mt-1 text-sm text-fg-muted">{allowance.used} of {allowance.limit ?? "unlimited"} workspace{allowance.limit === 1 ? "" : "s"} owned on {allowance.plan}.{full ? ` ${allowance.nextPlan ? `Move a workspace to ${allowance.nextPlan} to own more.` : "You own as many as your plan allows."}` : ""} Joining someone else&apos;s is always free.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link href="/join"><Button variant="outline">Join with a code</Button></Link>
            {full ? null : <Link href="/onboarding"><Button>Create a workspace</Button></Link>}
          </div>
        </div>
      ) : null}
    </main>
  );
}
