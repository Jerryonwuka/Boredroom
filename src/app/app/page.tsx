import Link from "next/link";
import { redirect } from "next/navigation";
import { Building2, KeyRound, Plus } from "lucide-react";
import { getCurrentUser } from "@/server/auth";
import { registrationOpen } from "@/server/admin/settings";
import { listMyWorkspaces } from "@/server/services/orgs";
import { workspaceAllowance } from "@/server/services/workspace-limit";
import { AuthShell } from "@/components/auth/auth-shell";
import { EntryRow, OrgMark } from "@/components/auth/entry-row";
import { SignOutButton } from "@/components/auth/forms";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, Alert } from "@/components/ui/states";
import { QuickLink } from "@/components/ui/tool-tile";
import { cn } from "@/lib/utils";

export const metadata = { title: "Workspaces" };

const ROLE_LABEL: Record<string, string> = { owner: "Organisation owner", hr: "HR administrator", manager: "Team lead", employee: "Staff" };

/**
 * The workspace chooser (v4): the entry frame with a wider column. Each workspace is a 64px outline row (its mark, its
 * name, its time zone, the person's role as a badge, a chevron); below them, quick links to join another organisation
 * or create a workspace, and one line about the plan's allowance. Sign out sits in the top bar.
 */
export default async function WorkspacesPage({ searchParams }: { searchParams: Promise<{ verified?: string; switch?: string }> }) {
  const sp = await searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/app");
  if (!user.emailVerified) redirect("/verify/pending");
  const [workspaces, allowance, open] = await Promise.all([listMyWorkspaces(user.profileId), workspaceAllowance(user.profileId), registrationOpen()]);
  const full = allowance.limit !== null && allowance.used >= allowance.limit;
  // New workspaces are refused while Boredroom is on its waitlist, so the button is not offered then.
  const canCreate = open && !full;
  // Straight in when there is only one, except from the sidebar's "Switch workspace", which comes to add or join another.
  if (workspaces.length === 1 && !sp.verified && !sp.switch) redirect(`/app/${workspaces[0].slug}`);
  const s = (n: number | null) => (n === 1 ? "" : "s");
  return (
    <AuthShell width="wide" title={workspaces.length ? "Choose a workspace" : "Your workspaces"}
      subtitle={<>Signed in as <span className="font-medium text-foreground">{user.email}</span></>}
      actions={<SignOutButton size="sm" />}>
      {sp.verified ? <Alert tone="success">Your email is confirmed. Welcome to Boredroom.</Alert> : null}
      {workspaces.length === 0 ? (
        <EmptyState icon={Building2} className="py-4" title="You are not in a workspace yet"
          description={open ? "Join your organisation with the code or link it gave you, or create a workspace for your company." : "Join your organisation with the code or link it gave you."}
          action={<div className="flex flex-wrap justify-center gap-2"><Link href="/join" className={buttonVariants()}>Join with a code</Link>{canCreate ? <Link href="/onboarding" className={buttonVariants({ variant: "outline" })}>Create a workspace</Link> : null}</div>} />
      ) : (
        <>
          <ul aria-label="Your workspaces" className="flex flex-col gap-2">
            {workspaces.map((w) => (
              <li key={w.id}>
                {/* The role shows as a badge from 640px; below that it leads the line under the name. */}
                <EntryRow href={`/app/${w.slug}`} leading={<OrgMark name={w.name} />} title={w.name}
                  subtitle={<><span className="sm:hidden">{ROLE_LABEL[w.role]}, </span>{w.timezone.replace(/_/g, " ")}</>}
                  trailing={<Badge className="hidden sm:inline-flex">{ROLE_LABEL[w.role]}</Badge>} />
              </li>
            ))}
          </ul>
          <section aria-labelledby="another" className="mt-4">
            <h2 id="another" className="mb-2 text-sm font-medium text-secondary">Another organisation</h2>
            <div className={cn("grid gap-2", canCreate && "sm:grid-cols-2")}>
              <QuickLink href="/join" icon={<KeyRound aria-hidden />} label="Join with a code" />
              {canCreate ? <QuickLink href="/onboarding" icon={<Plus aria-hidden />} label="Create a workspace" /> : null}
            </div>
            <p className="mt-3 text-meta font-normal text-secondary">
              {allowance.limit === null
                ? <>{allowance.plan} lets you own as many workspaces as you like, and you own <span className="tabular-nums text-foreground">{allowance.used}</span>.</>
                : <>{allowance.plan} lets you own <span className="tabular-nums text-foreground">{allowance.limit}</span> workspace{s(allowance.limit)}, and you own <span className="tabular-nums text-foreground">{allowance.used}</span>.</>}
              {full && allowance.nextPlan ? ` Move a workspace to ${allowance.nextPlan} to own more.` : ""}
              {!open ? " New workspaces open when Boredroom leaves its waitlist." : ""}
              {" "}Joining someone else&apos;s is always free.
            </p>
          </section>
        </>
      )}
    </AuthShell>
  );
}
