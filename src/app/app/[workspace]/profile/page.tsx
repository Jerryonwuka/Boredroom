import Link from "next/link";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell, ROLE_LABEL } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Avatar } from "@/components/ui/avatar";
import { ProfileForm } from "@/components/app/profile-form";
import { SettingsSection, SettingsGroup, SettingsRow } from "@/components/app/settings-forms";
import { myProfile } from "@/server/services/profile";
import { policyView } from "@/server/services/views";
import { cn, formatDateTime, formatLongDate } from "@/lib/utils";
import { brendaOverview } from "@/server/services/brenda";
import { BrendaMyPrefs } from "@/components/app/brenda";
import { BrendaFace } from "@/components/app/brenda-face";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { EYES, PALETTE, VISORS } from "@/lib/assistant-look";
import type { OrgContext } from "@/server/lib/api";
import { WorkStatus } from "./work-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile" };

/**
 * The person's own page, v4 (owner brief, 6 October 2026: a settings-style page). One column of sections, each a card
 * of form rows: Profile (picture, name, title, status), Work status, Brenda (what she may do for you), Account,
 * Your workspaces, and Privacy: the monitoring notice, readable at any time now that there is no Policy page, and what
 * calls and Brenda's notes on calls keep (owner decisions, 8 October 2026: phase 8, A.3.3).
 *
 * The Brenda section is the person's own assistant (owner decision, 7 October 2026: personal assistants): titled with the
 * name they chose, drawn in their look, with a row that opens Settings, "Your assistant", to change the name and look.
 */
export default async function ProfilePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/profile`);
  const [me, brenda, privacy, { personal }] = await Promise.all([myProfile(ctx.user), brendaOverview(ctx), policyView(ctx), assistantProfiles(ctx)]);
  const lookWords = [PALETTE[personal.colour].label, VISORS[personal.visor].label, EYES[personal.eyes].label].map((w) => w.toLowerCase()).join(", ");
  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Your profile" description="How you appear to the people you work with. Your picture, name and status show beside your name across the workspace." divider />
      <div className="max-w-[56rem] space-y-10">
        <SettingsSection id="profile" title="Profile">
          <ProfileForm profileId={me.id} displayName={me.displayName} title={me.title} statusText={me.statusText} avatarKey={me.avatarKey} />
        </SettingsSection>

        <SettingsSection id="status" title="Work status">
          <SettingsGroup>
            <SettingsRow label="Status" hint="Shown as the dot on your picture wherever your name appears.">
              <WorkStatus value={me.presence} />
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>

        {ctx.plan.features.AI_ASSISTANT ? (
          <SettingsSection id="brenda" title={<span className="inline-flex min-w-0 items-center gap-2.5"><BrendaFace size="sm" /><span className="min-w-0 truncate">{personal.name}</span></span>}
            description={`What ${personal.name} may do for you, and what ${personal.name} did.`}>
            <SettingsGroup className="mb-4">
              <SettingsRow label="Name and look" hint={`${personal.name}: ${lookWords}.`} align="text">
                <Link href={`/app/${ctx.org.slug}/settings?section=assistant`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Change<span className="sr-only"> your assistant&apos;s name and look</span></Link>
              </SettingsRow>
            </SettingsGroup>
            <div className="card-panel">
              <BrendaMyPrefs orgSlug={ctx.org.slug} initial={{ ...brenda, actions: brenda.actions.filter((a) => a.display_name === ctx.user.displayName) }} worker={ctx.membership.role === "employee" || ctx.membership.role === "manager"} />
            </div>
          </SettingsSection>
        ) : null}

        <SettingsSection id="account" title="Account">
          <SettingsGroup>
            <SettingsRow label="Email" hint="Where sign-in links and password resets go." align="text">
              <span className="flex flex-wrap items-center gap-2"><span className="min-w-0 break-all">{me.email}</span>{ctx.user.emailVerified ? <Badge tone="success" dot>Verified</Badge> : <Badge tone="warning" dot>Not verified</Badge>}</span>
            </SettingsRow>
            <SettingsRow label="Member since" align="text">{formatLongDate(me.createdAt.slice(0, 10))}</SettingsRow>
            <SettingsRow label="Password" hint="To change it, we email you a link." align="text">
              <Link href="/recover" className={buttonVariants({ variant: "secondary", size: "sm" })}>Reset your password</Link>
            </SettingsRow>
          </SettingsGroup>
        </SettingsSection>

        <SettingsSection id="workspaces" title="Your workspaces" description="Every organisation you belong to. Open one to switch to it.">
          <SettingsGroup className="overflow-hidden">
            <ul className="divide-y divide-border">
              {me.workspaces.map((w) => {
                const here = w.slug === ctx.org.slug;
                return (
                  <li key={w.id}>
                    {/* The whole row is the link, so the press target matches what lights up on hover. */}
                    <Link href={`/app/${w.slug}`} aria-current={here ? "page" : undefined} className={cn("flex min-h-16 items-center gap-3 px-5 py-3 transition-colors duration-75 hover:bg-fill-0 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]", here && "selected-marker")}>
                      <Avatar profileId={w.id} name={w.name} size={32} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-foreground">{w.name}</span>
                        <span className="block truncate text-meta font-normal text-secondary">ID <span className="font-mono tabular-nums">{w.employeeCode}</span>{w.teams.length ? `, ${w.teams.join(", ")}` : ""}</span>
                      </span>
                      <span className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">{here ? <Badge>Open now</Badge> : null}<Badge>{ROLE_LABEL[w.role] ?? w.role}</Badge></span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </SettingsGroup>
        </SettingsSection>

        <Privacy ctx={ctx} privacy={privacy} />
      </div>
    </AppShell>
  );
}

/**
 * Privacy (read only; owner decisions, 8 October 2026: phase 8, A.3.3): the workspace's current monitoring notice in
 * full, what Boredroom never does, what calls keep, and how Brenda's notes on a call work. Nobody is asked to agree to
 * anything, so there is no agreement row. Owners and HR get a link to publish a new version in Settings.
 */
function Privacy({ ctx, privacy }: { ctx: OrgContext; privacy: Awaited<ReturnType<typeof policyView>> }) {
  const { policy } = privacy;
  const sets = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  return (
    <SettingsSection id="privacy" title="Privacy"
      description={sets ? <>What Boredroom tracks, and what it never does. You can publish a new version of the notice in <Link href={`/app/${ctx.org.slug}/settings?section=notice`} className="link-inline">Settings</Link>.</> : "What Boredroom tracks, and what it never does."}>
      <SettingsGroup>
        {policy ? (
          <SettingsRow stacked label="The monitoring notice" hint={<>Version <span className="tabular-nums">{policy.version}</span>{policy.effective_at ? <>, in effect since <time dateTime={policy.effective_at}>{formatDateTime(policy.effective_at, ctx.org.timezone)}</time></> : null}</>} align="text">
            <div className="prompt-scroll max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-fill-0 px-4 py-3 text-sm font-normal text-secondary">{policy.notice_text}</div>
          </SettingsRow>
        ) : (
          <SettingsRow label="The monitoring notice" align="text"><span className="text-secondary">This workspace has not published a monitoring notice yet.</span></SettingsRow>
        )}
        <SettingsRow label="What Boredroom never does" align="text">
          <ul className="space-y-1 text-secondary">
            <li>It never records your screen.</li>
            <li>It never records calls.</li>
          </ul>
        </SettingsRow>
        <SettingsRow label="Calls" align="text"><span className="text-secondary">Calls are on your Calls page: who called, when and for how long. Their sound and video are never kept.</span></SettingsRow>
        <SettingsRow label="Notes on calls" align="text"><span className="text-secondary">Only when someone on the call turns them on, and only for the people who agree. Your own device writes your words down; no audio leaves it. Only the people on the call can read the transcript, and it is deleted 7 days after the recap. The recap stays.</span></SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
