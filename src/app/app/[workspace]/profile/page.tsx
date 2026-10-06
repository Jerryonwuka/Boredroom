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
import type { OrgContext } from "@/server/lib/api";
import { WorkStatus } from "./work-status";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your profile" };

/**
 * The person's own page, v4 (owner brief, 6 October 2026: a settings-style page). One column of sections, each a card
 * of form rows: Profile (picture, name, title, status), Work status, Brenda (what she may do for you), Account,
 * Your workspaces, and Recording and privacy: what the workspace records about them, so the monitoring notice can be
 * read at any time without starting a recording, now that there is no Policy page.
 */
export default async function ProfilePage({ params }: { params: Promise<{ workspace: string }> }) {
  const { workspace } = await params;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/profile`);
  const [me, brenda, privacy] = await Promise.all([myProfile(ctx.user), brendaOverview(ctx), policyView(ctx)]);
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
          <SettingsSection id="brenda" title={<span className="inline-flex items-center gap-2.5"><BrendaFace size="sm" />Brenda</span>} description="What Brenda may do for you, and what she did.">
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

        <RecordingAndPrivacy ctx={ctx} privacy={privacy} />
      </div>
    </AppShell>
  );
}

const MODE: Record<string, string> = {
  disabled: "Screen recording is off in this workspace: nothing of your screen is recorded.",
  optional: "Recording is your choice: it starts only when you choose a screen, and you can stop it at any time.",
  required_on_designated_tasks: "Some tasks need a recording while you work on them; on the rest, recording is your choice.",
};

/**
 * Recording and privacy (read only): the workspace's current monitoring notice, in full, with what it means in plain
 * words, and whether and when the person agreed to it. Agreeing happens in the prompt shown the first time a session
 * records their screen (components/app/capture.tsx); the organisation account, which sets the rules, does not record.
 */
function RecordingAndPrivacy({ ctx, privacy }: { ctx: OrgContext; privacy: Awaited<ReturnType<typeof policyView>> }) {
  const { policy, agreedAt } = privacy;
  const sets = ctx.membership.role === "owner" || ctx.membership.role === "hr";
  if (!policy) {
    return (
      <SettingsSection id="recording" title="Recording and privacy">
        <SettingsGroup><SettingsRow label="Recording" align="text"><span className="text-secondary">This workspace has no recording rules yet, so nothing of your screen is recorded.</span></SettingsRow></SettingsGroup>
      </SettingsSection>
    );
  }
  const recording = ctx.plan.features.VIDEO_RECORDING === true && policy.recording_mode !== "disabled";
  const days = `${policy.retention_days} day${policy.retention_days === 1 ? "" : "s"}`;
  const facts: [string, string][] = recording ? [
    ["Recorded", "The screen, window or tab you choose, as video only, while your timer runs and the orange recording sign shows."],
    ["Never recorded", "Sound, your keystrokes, screens you did not choose, or anything while no timer runs."],
    ["Kept", `For ${days}, then deleted automatically.`],
    ["Who can watch", "You, your team lead, your organisation's owner and HR, and anyone they give access to. Every viewing is logged, and you can flag a recording as sensitive to lock it."],
  ] : [];
  return (
    <SettingsSection id="recording" title="Recording and privacy"
      description={sets ? <>The notice everyone in the workspace reads before their screen is recorded. You can change the rules in <Link href={`/app/${ctx.org.slug}/settings?section=recording`} className="link-inline">Settings</Link>.</> : "What this workspace may record about you, and the notice you are asked to agree to before it does."}>
      <SettingsGroup>
        <SettingsRow label="Recording here" align="text">{recording ? MODE[policy.recording_mode] ?? MODE.optional : MODE.disabled}</SettingsRow>
        {facts.map(([k, v]) => <SettingsRow key={k} label={k} align="text"><span className="text-secondary">{v}</span></SettingsRow>)}
        {sets ? null : (
          <SettingsRow label="Your agreement" align="text">
            {agreedAt
              ? <span className="flex flex-wrap items-center gap-2"><Badge tone="success" dot>Agreed</Badge><span className="text-secondary">on <time dateTime={agreedAt}>{formatDateTime(agreedAt, ctx.org.timezone)}</time></span></span>
              : <span className="flex flex-wrap items-center gap-2"><Badge>Not agreed</Badge><span className="text-secondary">{recording ? "You will be asked the next time a session records your screen. Nothing is recorded until you agree." : "Nobody is asked while recording is off."}</span></span>}
          </SettingsRow>
        )}
        <SettingsRow stacked label="The full notice" hint={<>Version <span className="tabular-nums">{policy.version}</span>{policy.effective_at ? <>, in effect since <time dateTime={policy.effective_at}>{formatDateTime(policy.effective_at, ctx.org.timezone)}</time></> : null}</>} align="text">
          <div className="prompt-scroll max-h-96 overflow-y-auto whitespace-pre-wrap rounded-xl border border-border bg-fill-0 px-4 py-3 text-sm font-normal text-secondary">{policy.notice_text}</div>
        </SettingsRow>
      </SettingsGroup>
    </SettingsSection>
  );
}
