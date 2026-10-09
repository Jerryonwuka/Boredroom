import Link from "next/link";
import type { ReactNode } from "react";
import { Check, Clock, CreditCard, Laptop, ScreenShare, SlidersHorizontal } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Badge } from "@/components/ui/badge";
import { ProgressBar } from "@/components/ui/progress-arc";
import { settingsView } from "@/server/services/views";
import { OrgSettingsForm, ScheduleForm, PolicyForm, GrantsPanel, AssistantConnectionForm, RecordingSwitch, SettingsSection, SettingsGroup, SettingsRow, SettingsFooter } from "@/components/app/settings-forms";
import { assistantStatus } from "@/server/services/orgs";
import { brendaOverview } from "@/server/services/brenda";
import { listDevices } from "@/server/services/desktop";
import { BrendaOrgSettings } from "@/components/app/brenda";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { BrendaReportSettings } from "@/components/app/brenda-report-settings";
import { LinkedComputers } from "@/components/app/desktop-link";
import { orgBilling } from "@/server/admin/billing";
import { BillingCard } from "@/components/app/billing-card";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { AssistantScope } from "@/components/app/assistant-context";
import { MyActModeSettings, MyAssistantSettings, WorkspaceAssistantSettings } from "@/components/app/assistant-settings";
import { ActModeWorkspaceSettings } from "@/components/app/act-mode-settings";
import { workspaceActSetting } from "@/server/services/act-mode";
import { MyVoiceSettings } from "@/components/app/assistant-voice-settings";
import { aiConnected, assistantProfiles } from "@/server/services/assistant-profile";
import { AssistantActivityCard } from "@/components/app/assistant-activity";
import { listActivity } from "@/server/services/assistant-activity";
import { BrendaUsageCard } from "@/components/app/brenda-usage";
import { usageSummary } from "@/server/services/ai-usage";
import { FollowUpPreferenceSettings } from "@/components/app/follow-up-settings";
import { FollowUpCollectionSettings } from "@/components/app/follow-up-collection-settings";
import { followUpPreference, followUpSettings } from "@/server/services/follow-ups";
import { MentionSettings } from "@/components/app/mention-settings";
import { mentionSettings } from "@/server/services/mentions";
import { AssistantTalkSettings } from "@/components/app/assistant-talk-settings";
import { ReportNotesSettings } from "@/components/app/report-notes-settings";
import { assistantTalkPreferences, listMutes, reportNoteSettings } from "@/server/services/assistant-items";
import { RoutinesSettings } from "@/components/app/routines-settings";
import { QuietHoursSettings } from "@/components/app/quiet-hours-settings";
import { RoutinesWorkspaceSettings } from "@/components/app/routines-workspace-settings";
import { listRoutines, quietHoursFor, routineSettingsFor } from "@/server/services/routines";
import { ROUTINE_WORDS } from "@/lib/routines";
import { CommitmentsSettings } from "@/components/app/commitments-settings";
import { commitmentSettings } from "@/server/services/commitments";
import { LOOP_WORDS, type CommitmentSettings } from "@/lib/commitments";
import { withUser } from "@/server/db";
import type { AssistantProfiles } from "@/lib/assistant-look";
import { ASSISTANT_ITEM_WORDS } from "@/lib/assistant-items";
import { ACT_WORDS, actStateOf } from "@/lib/act-mode";
import { AbilitiesSettings } from "@/components/app/abilities-settings";
import { PreferencesSettings } from "@/components/app/preferences-settings";
import { abilitiesView } from "@/server/services/abilities";
import { listPreferences } from "@/server/services/preferences";
import { ABILITY_WORDS, type AbilitiesView } from "@/lib/abilities";
import { PREFERENCE_WORDS, type PreferenceList } from "@/lib/preferences";
import { cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Settings" };

type SectionKey = "general" | "hours" | "recording" | "brenda" | "assistant" | "billing" | "desktop";
const SECTIONS: { key: SectionKey; label: string; icon: ReactNode }[] = [
  { key: "general", label: "General", icon: <SlidersHorizontal aria-hidden /> },
  { key: "hours", label: "Working hours", icon: <Clock aria-hidden /> },
  { key: "recording", label: "Recording", icon: <ScreenShare aria-hidden /> },
  { key: "brenda", label: "Brenda", icon: <BrendaGlyph aria-hidden /> },
  { key: "assistant", label: "Your assistant", icon: <BrendaGlyph aria-hidden /> },
  { key: "billing", label: "Billing", icon: <CreditCard aria-hidden /> },
  { key: "desktop", label: "Desktop", icon: <Laptop aria-hidden /> },
];
const MODE_LABEL: Record<string, string> = { disabled: "Off", optional: "On, each person's choice", required_on_designated_tasks: "On, required on marked tasks" };

/**
 * Settings, v4 (owner brief, 6 October 2026): the page header, then a left sub-navigation of sections (General,
 * Working hours, Recording, Brenda, Your assistant, Billing, Desktop; a scrolling row of the same items on a phone)
 * beside the chosen section. Each section is a set of cards of form rows: the label and a hint on the left, the control
 * on the right. The section is in the address (?section=), so links land on it: the billing banner, the Paystack
 * callback and the pricing page (?billing= or ?plan=) open Billing. Only owners change recording rules, grants and the
 * AI key. Every change is audited. That, and each section's explanations (time zone, consent, what is logged, what is
 * sent to Anthropic), are page notes at the bottom (owner request, 7 October 2026).
 *
 * Settings opens for everyone (owner decision, 7 October 2026: everyone customises their assistant in Settings). Staff
 * and team leads see one section, "Your assistant", which is where any other ?section= lands them; owners and HR see
 * every section, theirs included. The Brenda section starts with the workspace's own assistant, and its sub-nav icon is
 * drawn as that assistant (the person's own draws "Your assistant").
 *
 * Her voice (owner decision, 7 October 2026: phase 2): "Your assistant" also holds Voice (when the assistant reads
 * replies aloud, saved to the account; which voice and how fast, kept in this browser).
 *
 * Personal assistants, phase 3 (owner decision, 8 October 2026): "Your assistant" ends with "What Max did", the latest
 * five things the person's assistant did or read for them and a link to the whole list (/home/activity). The Brenda
 * section gains "Usage this month" for owners and HR (requests and tokens by purpose and the people with the most
 * requests; no prices), after the daily report and before the AI connection.
 *
 * Personal assistants, phase 4 (owner decision, 8 October 2026: assistant-to-assistant follow-ups): "Your assistant"
 * gains "Follow-ups" after Voice, the person's choice of how their assistant answers another person's assistant about
 * their work ("Answer from my work, ask me only if it can't", or "Always ask me first"). The Brenda section gains
 * "Updates before the report" after the daily report, for owners and HR: the workspace's own assistant collects an
 * update from everyone's assistant for the end-of-day report. Both read their own columns with a readiness check
 * (migration 0039) and show disabled under an info alert until it is applied.
 *
 * Personal assistants, phase 5 (owner decision, 8 October 2026: @mentions in Messages): the Brenda section gains
 * "Messages" after "Updates before the report", for owners and HR: "Let people ask their assistant in Messages" (on by
 * default), whether "@Max …" in a conversation makes the person's own assistant reply there. It reads its own column with
 * a readiness check (migration 0041) and shows disabled under an info alert until it is applied. The notes say that
 * replies show who asked and, for owners under AI connection, that the conversation's recent messages go to Anthropic.
 *
 * Personal assistants, phase 6 (owner decision, 8 October 2026: assistants talk to each other): "Your assistant" gains
 * "Other people's assistants" after Follow-ups: "Let people tag {name} in Messages" (on by default) and the colleagues
 * whose assistants the person muted, each with Unmute. The Brenda section gains "Notes from the team" after Messages,
 * for owners and HR: "Let people add notes to the team report" (on by default; needs the daily report). Both read their
 * own columns with a readiness check (migration 0043) and show disabled under an info alert until it is applied.
 *
 * Act without asking (owner decision, 8 October 2026: "there should be a setting where we can bypass the permission, you
 * can toggle it on and off, just like the way it is on Claude Code"): "Your assistant" gains "Permissions" after Voice
 * ("Ask me before acting", the default, or "Act without asking"; the pill in her box shows and switches the same). The
 * Brenda section gains "Acting without asking" after the Brenda card, for owners and HR: "Allow people to let their assistant
 * act without asking", since review on 8 October 2026 "Allow people to let their assistant act without asking" (on by default; off, everyone's assistant asks). Both read their columns with a readiness check
 * (migration 0045) and show disabled under an info alert until it is applied. The notes say that what is done without
 * asking is logged, marked, and most of it can be undone for 10 minutes.
 *
 * Brenda keeps the loops closed (owner decision, 8 October 2026: phase 7a): "Your assistant" gains "Routines" after
 * Permissions (the person's own scheduled routines: a list with add, edit, preview and Enable, pause, history and delete;
 * routines-settings) and "Quiet hours" after it (their quiet hours and their own time zone; quiet-hours-settings). The
 * Brenda section gains "Routines" after "Acting without asking", for owners and HR: "Only leads can schedule routines that
 * chase other people" (on by default). All three are read here, with the page, and show disabled under an info alert until
 * migration 0046 is applied; a read that fails leaves the card to read it itself.
 *
 * Loose ends and commitments (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed"): the Brenda
 * section gains "Commitments in group chats" after Routines, for owners and HR (others read it): "Track commitments in
 * group chats" (OFF until turned on) and "Post gentle follow-ups in the thread" (OFF; needs tracking). Read here with the
 * page (commitments-settings); disabled under an info alert until migration 0048 is applied, and while unreadable.
 *
 * Abilities and "How I like things done" (owner decisions, 8–9 October 2026: phase 7c; contract C, D.5 and G.3): the
 * Brenda section gains "Abilities" right after the Brenda card, for owners and HR: the catalogue of what everyone's
 * assistant can do, each card with what it does, when to use it and what it never does, and "Offer {ability} in this
 * workspace" for those that had no switch (the ones that had one link to their own card here, which stays the source of
 * truth). "Your assistant" gains "Abilities" after Permissions (the same cards, "Use {ability}" for the person's own
 * assistant) and "How I like things done" after it: the person's own list of how they like things done, in their words,
 * which only they ever see. Both read with the page (`abilitiesView`, `listPreferences`; a failed read: the card reads
 * it itself) and show disabled under an info alert until migration 0050 is applied.
 */
export default async function SettingsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ section?: string; setup?: string; billing?: string; plan?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams: navTeams } = await workspacePage(workspace, `/app/${workspace}/settings`);
  const isOwner = ctx.membership.role === "owner";
  const admin = isOwner || ctx.membership.role === "hr";
  const sections = admin ? SECTIONS : SECTIONS.filter((s) => s.key === "assistant");
  const home: SectionKey = admin ? "general" : "assistant";
  const base = `/app/${ctx.org.slug}`;
  const section: SectionKey = sections.some((s) => s.key === sp.section) ? (sp.section as SectionKey) : admin && (sp.billing || sp.plan) ? "billing" : home;
  const href = (k: SectionKey) => (k === home ? `${base}/settings` : `${base}/settings?section=${k}`);
  // The assistants are read with each section's own data, in parallel; the shell's read is the same cached one.
  let assistants: AssistantProfiles;

  let body: ReactNode = null;
  // The open section's explanatory notes, shown at the bottom of the page after "Every change is audited."
  let notes: ReactNode = null;
  if (section === "assistant") {
    const [a, activity, followUps, talk, mutes, ai, routines, quiet, abilities, preferences] = await Promise.all([assistantProfiles(ctx), listActivity(ctx, { limit: 5 }), followUpPreference(ctx), assistantTalkPreferences(ctx), listMutes(ctx), aiConnected(ctx.org.id),
      // Phase 7a: the person's routines and quiet hours (ready: false before 0046). A failed read: the card reads it itself.
      listRoutines(ctx).catch(() => null), quietHoursFor(ctx).catch(() => null),
      // Phase 7c: the abilities and the person's preferences (ready: false before 0050). A failed read: the card reads it itself.
      abilitiesView(ctx).catch((): AbilitiesView | null => null), listPreferences(ctx).catch((): PreferenceList | null => null)]);
    assistants = a;
    const { name } = a.personal;
    const now = new Date(); // the server's clock, so "Today" in the activity rows reads the same on both sides
    // Her voice (owner decision, 7 October 2026: phase 2): a second card under the name and look, saved as it changes.
    // Then how it answers other people's assistants about the person's work (phase 4), and what the assistant did or
    // read for the person (phase 3), always their own whatever the role.
    body = (
      <>
        <MyAssistantSettings orgSlug={ctx.org.slug} initial={a.personal} impersonated={!!ctx.user.impersonation} />
        <MyVoiceSettings orgSlug={ctx.org.slug} name={name} speak={a.speak} impersonated={!!ctx.user.impersonation} />
        {/* Whether the assistant asks before acting (owner decision, 8 October 2026: act without asking). */}
        {/* Review, 8 October 2026: says when acting without asking waits for the AI, and links owners and HR to the switch. */}
        <MyActModeSettings orgSlug={ctx.org.slug} name={name} initial={actStateOf(a)} ai={ai} workspaceHref={admin ? `${base}/settings?section=brenda#act-mode` : undefined} />
        {/* What the assistant may do for the person, then how they like it done (owner decisions, 8–9 October 2026: phase 7c). */}
        <AbilitiesSettings orgSlug={ctx.org.slug} scope="personal" name={name} initial={abilities} />
        <PreferencesSettings orgSlug={ctx.org.slug} name={name} initial={preferences} />
        {/* What the assistant does on a schedule, then when it keeps quiet (owner decision, 8 October 2026: phase 7a). */}
        <RoutinesSettings orgSlug={ctx.org.slug} name={name} impersonated={!!ctx.user.impersonation} timeZone={quiet?.timezone ?? ctx.org.timezone} initial={routines} />
        <QuietHoursSettings orgSlug={ctx.org.slug} name={name} impersonated={!!ctx.user.impersonation} orgTimeZone={ctx.org.timezone} initial={quiet} />
        <FollowUpPreferenceSettings orgSlug={ctx.org.slug} initial={followUps} name={name} impersonated={!!ctx.user.impersonation} />
        {/* Other people's assistants (phase 6): tagging the person's assistant in Messages, and whose assistants are muted. */}
        <AssistantTalkSettings orgSlug={ctx.org.slug} name={name} preferences={talk} mutes={mutes} impersonated={!!ctx.user.impersonation} />
        <AssistantActivityCard orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} name={name} items={activity.items} now={now.getTime()} />
      </>
    );
    notes = (
      <>
        <PageNote section="Your assistant">The name and look change how your assistant appears to you and in the desktop app. What it can do for you stays the same. Voices come from this computer; your choice of voice and speed is kept in this browser.</PageNote>
        <PageNote section="Permissions">{ACT_WORDS.settings.pageNote(name)}</PageNote>
        <PageNote section="Abilities">{ABILITY_WORDS.notes.personalPage(name)}</PageNote>
        <PageNote section={PREFERENCE_WORDS.section}>{PREFERENCE_WORDS.pageNote(name)}</PageNote>
        <PageNote section="Routines">A routine runs as you, with your permissions and limits, and does only what its preview showed when you enabled it. Follow-ups it asks are answered by each person&apos;s own assistant, under their own rules.</PageNote>
        <PageNote section="Quiet hours">During quiet hours nothing pops up or plays a sound on its own. Emails, such as the end-of-day report, are not held.</PageNote>
        <PageNote section="Follow-ups">Follow-ups between assistants never change anyone&apos;s task. Owners and HR see in Audit that a follow-up happened, not what was said.</PageNote>
        <PageNote section="Other people's assistants">Nothing another person&apos;s assistant asks for changes your account until you accept it. Owners and HR see that something passed between assistants, not what was said.</PageNote>
        <PageNote section={`What ${name} did`}>{name} reads your conversations only when you ask it to catch you up, and only conversations you are in. Reading never marks them as read.</PageNote>
        {activity.readsHidden ? <PageNote section={`What ${name} did`}>What {name} read is hidden while someone else is signed in as this person.</PageNote> : null}
      </>
    );
  } else if (section === "general" || section === "hours" || section === "recording") {
    const [view, a] = await Promise.all([settingsView(ctx), assistantProfiles(ctx)]);
    const { policy, schedule, grants, members, teams, counts: c } = view;
    assistants = a;
    if (section === "general") {
      const checklist = [
        { label: "Workspace created", done: true },
        { label: "Time zone and schedule set", done: !!schedule, href: href("hours"), go: "Working hours" },
        { label: "Teams defined and managers assigned", done: c.teams > 0, href: `${base}/people`, go: "People and teams" },
        { label: "Recording rules reviewed", done: !!policy && policy.version >= 1, href: href("recording"), go: "Recording" },
        { label: "At least one project", done: c.projects > 0, href: `${base}/projects`, go: "Projects" },
        { label: "Employees invited", done: c.members > 1, href: `${base}/people`, go: "People and teams" },
      ];
      const done = checklist.filter((i) => i.done).length;
      // Brenda can make teams and send invitations, so the two slowest setup steps are the one place here to hand her work.
      // The button names the person's own assistant (owner decision, 7 October 2026: personal assistants).
      const brendaCanHelp = ctx.plan.features.AI_ASSISTANT && (c.teams === 0 || c.members <= 1);
      const types = (policy?.attachment_mime_types ?? []).map((m) => m.split("/")[1]).join(", ");
      body = (
        <>
          <SettingsSection id="organisation" title="Organisation" description="The organisation's name, and the time zone every day is counted in.">
            <OrgSettingsForm orgSlug={ctx.org.slug} name={ctx.org.name} timezone={ctx.org.timezone} />
          </SettingsSection>
          <SettingsSection id="setup" title="Setup" description="What a new workspace needs before people start." action={<span className="text-sm font-medium tabular-nums text-secondary">{done} of {checklist.length} done</span>}>
            <SettingsGroup>
              <div className="px-5 py-4">
                {/* Accent rules (6 October 2026): progress fills in orange (green once everything is done). A done step is a
                    quiet filled circle with a tick: six orange discs in a column broke the orange budget, and the bar
                    already carries the progress. */}
                <ProgressBar value={done} max={checklist.length} label="Setup progress" valueText={`${done} of ${checklist.length} steps done`} />
              </div>
              <ul className="divide-y divide-border">
                {checklist.map((i) => (
                  <li key={i.label} className="flex min-h-12 items-center gap-3 px-5 py-2.5">
                    <span aria-hidden className={cn("grid size-5 shrink-0 place-items-center rounded-full", i.done ? "bg-fill-150 text-foreground" : "border border-border-input-hover")}>{i.done ? <Check className="size-3" strokeWidth={3} /> : null}</span>
                    <span className={cn("min-w-0 flex-1 text-sm", i.done ? "font-medium text-foreground" : "font-normal text-secondary")}>{i.label}<span className="sr-only">{i.done ? ", done" : ", to do"}</span></span>
                    {!i.done && i.href ? <Link href={i.href} className={buttonVariants({ variant: "ghost", size: "xs" })}>{i.go}</Link> : null}
                  </li>
                ))}
              </ul>
              {brendaCanHelp ? (
                <SettingsFooter>
                  <Link href={`${base}/home?ask=${encodeURIComponent("Help me finish setting up this workspace: create our teams with their team leads, and invite the people who work here.")}`} className={buttonVariants({ variant: "secondary", size: "sm" })}><BrendaGlyph aria-hidden />Ask {assistants.personal.name} to set up teams and invitations</Link>
                </SettingsFooter>
              ) : null}
            </SettingsGroup>
          </SettingsSection>
          <SettingsSection id="attachments" title="Attachments" description="Files people attach to tasks and messages.">
            <SettingsGroup>
              <SettingsRow label="Allowed files" align="text">{types || "None"}</SettingsRow>
              <SettingsRow label="Size limit" align="text"><span className="tabular-nums">{Math.round((policy?.attachment_max_bytes ?? 0) / 1048576)} MB</span> each</SettingsRow>
            </SettingsGroup>
          </SettingsSection>
        </>
      );
      notes = <PageNote section="Attachments">Files are kept in private storage. Downloads use links that last 60 seconds.</PageNote>;
    } else if (section === "hours") {
      body = (
        <SettingsSection id="hours" title="Working hours and clocking" description="Everyone clocks in and out against these times.">
          <ScheduleForm orgSlug={ctx.org.slug} schedule={schedule} />
        </SettingsSection>
      );
      notes = <PageNote section="Working hours and clocking">Times are in the organisation&apos;s time zone ({ctx.org.timezone}).</PageNote>;
    } else {
      const recording = policy?.recording_mode ?? "disabled";
      body = (
        <>
          <SettingsSection id="recording" title="Screen recording" description="When on, staff and team leads see Record screen in their timer."
            action={<Badge tone={recording === "disabled" ? "neutral" : "success"} dot>{MODE_LABEL[recording] ?? "On"}</Badge>}>
            <SettingsGroup>
              <SettingsRow label="Recording" hint="Switching publishes a new notice version, which each person agrees to once, the next time they record.">
                {isOwner ? <RecordingSwitch orgSlug={ctx.org.slug} mode={recording} /> : <p className="text-sm font-normal text-secondary md:pt-2">Only owners can change this.</p>}
              </SettingsRow>
            </SettingsGroup>
          </SettingsSection>
          <SettingsSection id="notice" title="Recording rules and notice" description="Publishing creates a new version."
            action={policy ? <Badge>Version <span className="tabular-nums">{policy.version}</span></Badge> : null}>
            <div className="grid gap-3">
              {isOwner ? <PolicyForm orgSlug={ctx.org.slug} policy={policy} /> : <Alert tone="info">Only owners can publish policy versions.</Alert>}
              <SettingsGroup>
                <SettingsRow label="Agreed so far" hint="People who have agreed to the current version." align="text"><span className="tabular-nums">{c.acknowledged}</span> of <span className="tabular-nums">{c.members}</span></SettingsRow>
                <SettingsRow label="Heartbeat" hint="How often a running session checks in." align="text">Every <span className="tabular-nums">{policy?.heartbeat_seconds ?? 30}</span> seconds; stale after <span className="tabular-nums">{policy?.stale_after_seconds ?? 90}</span></SettingsRow>
              </SettingsGroup>
            </div>
          </SettingsSection>
          <SettingsSection id="grants" title="Recording access" description="Supervisors (the owner, HR and a person's team lead) can watch their people's recordings. Grants extend playback to anyone else.">
            <GrantsPanel orgSlug={ctx.org.slug} grants={grants} members={members} teams={teams} isOwner={isOwner} />
          </SettingsSection>
        </>
      );
      notes = (
        <>
          <PageNote section="Screen recording">Nothing records until a person presses Record screen, and the first time they do, they read the notice and agree to it before anything is captured.</PageNote>
          <PageNote section="Recording rules and notice">Nobody signs the notice in advance; each person agrees to it once, at the moment they start a recorded session.</PageNote>
          <PageNote section="Recording access">Every grant and every play is logged.</PageNote>
        </>
      );
    }
  } else if (section === "brenda") {
    const [ai, brenda, a, usage, collection, mentions, notesSetting, actSetting, routinesSetting, commitmentsSetting, abilities] = await Promise.all([assistantStatus(ctx), brendaOverview(ctx), assistantProfiles(ctx), usageSummary(ctx),
      withUser(ctx.user.profileId, (db) => followUpSettings(db, ctx.org.id)), withUser(ctx.user.profileId, (db) => mentionSettings(db, ctx.org.id)),
      withUser(ctx.user.profileId, (db) => reportNoteSettings(db, ctx.org.id)), withUser(ctx.user.profileId, (db) => workspaceActSetting(db, ctx.org.id)),
      routineSettingsFor(ctx),
      // Phase 7b: the commitments switches (ready: false before 0048). A failed read shows the card disabled.
      withUser(ctx.user.profileId, (db) => commitmentSettings(db, ctx.org.id)).catch((): CommitmentSettings => ({ ready: false, track: false, threadFollowUps: false, since: null })),
      // Phase 7c: the abilities catalogue (ready: false before 0050). A failed read: the card reads it itself.
      abilitiesView(ctx).catch((): AbilitiesView | null => null)]);
    assistants = a;
    body = (
      <>
        {/* The workspace's own assistant comes first: it signs the daily report set further down. */}
        <WorkspaceAssistantSettings orgSlug={ctx.org.slug} initial={a.workspace} canEdit={a.canEditWorkspace} />
        <SettingsSection id="brenda" title="Brenda" description="Brenda is the AI teammate in every workspace page. Every action is logged below."
          action={<Badge tone={ai.source === "none" ? "warning" : "success"} dot>{ai.source === "none" ? "AI not connected" : "On Claude"}</Badge>}>
          <div className="card-panel"><BrendaOrgSettings orgSlug={ctx.org.slug} initial={brenda} canEdit /></div>
        </SettingsSection>
        {/* What everyone's assistant can do in this workspace (owner decisions, 8–9 October 2026: phase 7c). */}
        <AbilitiesSettings orgSlug={ctx.org.slug} scope="workspace" name={a.personal.name} initial={abilities} />
        {/* Whether people may let their assistant act without asking (owner decision, 8 October 2026). */}
        <ActModeWorkspaceSettings orgSlug={ctx.org.slug} initial={actSetting} canEdit={admin} />
        {/* Who may schedule routines that chase other people (owner decision, 8 October 2026: phase 7a). */}
        <RoutinesWorkspaceSettings orgSlug={ctx.org.slug} initial={routinesSetting} canEdit={admin} />
        {/* Commitments in group chats (owner decision, 8 October 2026: phase 7b). */}
        <CommitmentsSettings orgSlug={ctx.org.slug} initial={commitmentsSetting} canEdit={admin} workspaceName={a.workspace.name} />
        {/* The Reports page is gone; Brenda sends supervisors the day's team report instead (owner decision, 5 October 2026). */}
        <BrendaReportSettings orgSlug={ctx.org.slug} initial={brenda.settings} timezone={ctx.org.timezone} inPlan={ctx.plan.features.AI_ASSISTANT === true} />
        {/* Updates for that report from everyone's assistant (owner decision, 8 October 2026: personal assistants, phase 4). */}
        <FollowUpCollectionSettings orgSlug={ctx.org.slug} initial={collection} reportEnabled={brenda.settings.dailyReportEnabled} reportTime={brenda.settings.dailyReportTime}
          inPlan={ctx.plan.features.AI_ASSISTANT === true} canEdit={admin} />
        {/* Asking your own assistant in a conversation (owner decision, 8 October 2026: personal assistants, phase 5). */}
        <MentionSettings orgSlug={ctx.org.slug} initial={mentions} canEdit={admin} />
        {/* Notes from the team in the end-of-day report (owner decision, 8 October 2026: personal assistants, phase 6). */}
        <ReportNotesSettings orgSlug={ctx.org.slug} initial={notesSetting} reportEnabled={brenda.settings.dailyReportEnabled} canEdit={admin} />
        {/* This month's requests and tokens (owner decision, 8 October 2026: personal assistants, phase 3). */}
        <BrendaUsageCard usage={usage} />
        <SettingsSection id="ai" title="AI connection" description="Brenda runs on Claude. Connect an Anthropic API key so she can act; without one a simple built-in helper answers and only suggests, and says so.">
          {isOwner ? <AssistantConnectionForm orgSlug={ctx.org.slug} status={ai} /> : <Alert tone="info">Only owners can connect Brenda to Claude.</Alert>}
        </SettingsSection>
      </>
    );
    notes = (
      <>
        <PageNote section="Workspace assistant">Each person still has their own assistant; this one only signs what the workspace sends by itself.</PageNote>
        <PageNote section="Brenda">She reads what each person is allowed to see, does their own work for them, and asks before anything that lands on someone else, unless the person chose to let their assistant act without asking.</PageNote>
        <PageNote section="Abilities">{ABILITY_WORDS.notes.workspacePage}</PageNote>
        <PageNote section="Acting without asking">{ACT_WORDS.workspace.pageNote}</PageNote>
        <PageNote section="Routines">{ROUTINE_WORDS.workspace.pageNote}</PageNote>
        <PageNote section={LOOP_WORDS.settings.card}>{LOOP_WORDS.settings.pageNote}</PageNote>
        <PageNote section="Updates before the report">Updates are collected on working days, from what each person&apos;s work already shows. People who chose &ldquo;Always ask me first&rdquo; for their own assistant are asked once, even when asking is off here.</PageNote>
        <PageNote section="Updates before the report">Owners and HR see in Audit that updates were collected. A person sees under Asked about you exactly what their assistant shared.</PageNote>
        <PageNote section="Messages">Replies show who asked. Anything only the person asking can see stays private to them.</PageNote>
        <PageNote section="Notes from the team">{ASSISTANT_ITEM_WORDS.settings.notesPageNote}</PageNote>
        <PageNote section="Usage this month">Usage counts requests from this month only and resets on the 1st.</PageNote>
        {isOwner ? (
          <>
            <PageNote section="AI connection">The key is tested with one request, then stored encrypted and never shown again.</PageNote>
            <PageNote section="AI connection">Each request Brenda makes to Anthropic is billed to the key. What is sent: the request and what she needed to read for it, and only what the person asking is allowed to see.</PageNote>
            <PageNote section="AI connection">When someone asks to catch up on messages, the messages read for them are sent to Anthropic too, only from conversations they are in.</PageNote>
            <PageNote section="AI connection">When someone tags their assistant in Messages, the conversation&apos;s recent messages are sent to Anthropic too.</PageNote>
          </>
        ) : null}
      </>
    );
  } else if (section === "billing") {
    const [billing, a] = await Promise.all([orgBilling(ctx), assistantProfiles(ctx)]);
    assistants = a;
    body = (
      <SettingsSection id="billing" title="Plan and billing" description="What the organisation is on, and the other plans.">
        <BillingCard preselect={sp.plan} orgSlug={ctx.org.slug} data={billing} notice={sp.billing} />
      </SettingsSection>
    );
    notes = <PageNote section="Plans">Paid plans are billed through Paystack.</PageNote>;
  } else {
    const [devices, a] = await Promise.all([listDevices(ctx.user), assistantProfiles(ctx)]);
    assistants = a;
    body = (
      <SettingsSection id="desktop" title="Brenda desktop" description="Brenda on your computer acts as you, with your permissions, in the workspace you approve it for.">
        <SettingsGroup>
          <SettingsRow label="Link a computer" hint="Open Brenda desktop and press Sign in. It shows a code and opens a page in your browser to approve it." align="text">
            <Link href="/desktop/link" className={buttonVariants({ variant: "secondary", size: "sm" })}>Enter a code</Link>
          </SettingsRow>
          <div className="px-5 pb-2 pt-4">
            <p className="text-sm font-medium text-foreground">Linked computers</p>
            <LinkedComputers devices={devices} empty />
          </div>
        </SettingsGroup>
      </SettingsSection>
    );
    notes = <PageNote section="Brenda desktop">Each person links their own computers; the ones listed here are yours.</PageNote>;
  }

  return (
    <AppShell ctx={ctx} counts={counts} teams={navTeams}>
      <PageHeader title="Settings" description={admin ? "How the workspace runs: working hours, screen recording, Brenda, the plan, your assistant and your linked computers." : "Your assistant's name, look and voice in this workspace, whether it asks before acting, what it does for you and how you like it done, what it does on a schedule, when it keeps quiet, how it answers follow-ups about your work, and what other people's assistants may do."} divider />
      {sp.setup && admin ? <Alert tone="success" className="mb-6" title="Workspace ready">Work through the setup list to finish.</Alert> : null}
      <div className="grid gap-6 md:grid-cols-[12.5rem_minmax(0,1fr)] md:gap-10">
        {/* Sub-navigation (spec §6): 32px items, r8, fill-1 and the orange marker for the open one, fill-0 on hover; a scrolling row on a phone. */}
        <nav aria-label="Settings sections" className="-mx-1 min-w-0 md:sticky md:top-[calc(var(--header-height)+1.5rem)] md:mx-0 md:self-start">
          <ul className="flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] md:flex-col md:overflow-visible md:px-0 md:pb-0 [&::-webkit-scrollbar]:hidden">
            {sections.map((s) => {
              const active = s.key === section;
              return (
                <li key={s.key} className="shrink-0">
                  <Link href={href(s.key)} aria-current={active ? "page" : undefined}
                    className={cn("flex h-8 items-center gap-2 whitespace-nowrap rounded-lg px-2 text-sm font-medium transition-colors duration-75 pointer-coarse:h-10 [&_svg]:size-4 [&_svg]:shrink-0", active ? "selected-marker bg-fill-1 text-foreground [&_svg]:text-foreground" : "text-secondary hover:bg-fill-0 hover:text-foreground [&_svg]:text-secondary")}>
                    {s.key === "brenda" ? <AssistantScope profile={assistants.workspace}>{s.icon}</AssistantScope> : s.icon}{s.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="min-w-0 max-w-[56rem] space-y-10">{body}</div>
      </div>
      <PageNotes>
        {/* A person's own assistant is theirs and not logged (a name and a look); everything else here is. */}
        {section === "assistant" ? null : <PageNote>Every change is audited.</PageNote>}
        {notes}
      </PageNotes>
    </AppShell>
  );
}
