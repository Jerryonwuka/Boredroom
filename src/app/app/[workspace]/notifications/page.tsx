import Link from "next/link";
import type { ComponentType } from "react";
import { AtSign, Bell, CalendarClock, CircleAlert, CircleCheck, ClipboardCheck, CreditCard, FileText, Handshake, Hourglass, MessageSquare, MessageSquareQuote, MessageSquareReply, Repeat, ShieldCheck, SquareCheckBig, Video } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { buttonVariants } from "@/components/ui/button";
import { label } from "@/components/ui/badge";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { AssistantScope } from "@/components/app/assistant-context";
import { PageNote, PageNotes } from "@/components/ui/page-notes";
import { notificationsView } from "@/server/services/views";
import { assistantProfiles } from "@/server/services/assistant-profile";
import { ROUTINE_WORDS } from "@/lib/routines";
import { LOOP_WORDS } from "@/lib/commitments";
import { formatDateTime, cn } from "@/lib/utils";
import { MarkRead, MarkAllRead } from "./mark-read";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

/**
 * The kind of notification in words; anything not named here reads from its type ("task.assigned" is "Task assigned").
 * Nudges, reminders and clock-ins come from the person's own assistant, the daily report from the workspace's (owner
 * decision, 7 October 2026: personal assistants), each by the name it was given. Follow-ups between assistants (owner
 * decision, 8 October 2026: personal assistants, phase 4) come from the person's own assistant too: the request to
 * reply about their own work (`brenda.followup_ask`, even when the workspace's assistant is collecting for the report:
 * their own assistant asks them), and the answers to what they asked (`brenda.followup_answer` for one person,
 * `brenda.followup_batch` for a group).
 *
 * @mentions in Messages (owner decision, 8 October 2026: personal assistants, phase 5): someone mentioning the person in
 * a conversation they read is a Mention (`message.mention`, in Messages, even when they muted it). When the person tags
 * their own assistant in a conversation, it tells them how that went, in its own name: it replied there for everyone
 * (`brenda.mention_reply`), it needs them to confirm something only they see (`brenda.mention_confirm`, "Waiting for
 * you"), or it answered only them or couldn't answer (`brenda.mention_private`). Opening the conversation marks them read.
 *
 * Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6): what other people's
 * assistants bring the person, each opening its card in "Between assistants": a "Passed-on message"
 * (`assistant.message`), a "Request to accept" (`assistant.request`), a "Reply" to their own message
 * (`assistant.reply`), a "Request update" on one they sent (`assistant.outcome`: accepted, declined, couldn't be done,
 * expired); and in Messages, "Your assistant in Messages" when someone tagged their assistant (`assistant.tagged`) and
 * "Reply in Messages" when someone's assistant answered their tag (`assistant.thread_reply`). They sit in the assistant
 * tab with the follow-ups and mentions.
 *
 * Routines (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"): what one of the person's
 * routines sent them ("Routine", `brenda.routine`, opening the run's page with what it found and its links), the
 * routines that ran during their quiet hours, delivered together when those ended ("Routines", `brenda.routine_bundle`,
 * opening /home/routines), and a routine that couldn't run or was paused ("Routine", `brenda.routine_failed`, opening
 * Settings → Your assistant → Routines). A repeat icon (a warning circle for the failed one). They sit in the assistant
 * tab, and quiet hours never keep them out of this list: only pop-ups and sounds wait.
 *
 * Loose ends and commitments (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed"): the person's
 * own assistant tells them of a commitment the workspace's assistant noted for them ("Commitment noted",
 * `brenda.commitment`), an ask nobody took up ("Asked of you", `brenda.open_ask`), what became of their asks ("Commitment
 * accepted", "Commitment declined"), one due today ("Due today") or overdue on an ask of theirs ("Commitment overdue"),
 * a colleague blocked on them ("Blocked on you", `brenda.blocked_on`) and what became of their own block ("Answer",
 * "Blocked on someone else"), and a re-plan to confirm for a lead ("Re-plan", `brenda.replan`). Words from lib/commitments
 * (`LOOP_WORDS.notifications.kinds`); a handshake for commitments, an hourglass for blocks, a calendar clock for the
 * re-plan; the assistant tab. Each opens its card (Between assistants), the Commitments page or the follow-up.
 */
function kindsFor(personal: string, workspace: string): Record<string, string> {
  return {
    "message.direct": "Direct message", "message.mention": "Mention", "brenda.nudge": `From ${personal}`, "brenda.reminder": `Reminder from ${personal}`, "brenda.clock_in": `From ${personal}`,
    "brenda.daily_report": `Daily report from ${workspace}`, "brenda.followup_ask": `Follow-up from ${personal}`, "brenda.followup_answer": "Follow-up answer",
    "brenda.followup_batch": "Follow-up answers", "brenda.mention_reply": `Reply from ${personal}`, "brenda.mention_confirm": "Waiting for you",
    "brenda.mention_private": `From ${personal}`, "capture.exception": "Recording problem", "adjustment.requested": "Time correction requested",
    "assistant.message": "Passed-on message", "assistant.request": "Request to accept", "assistant.reply": "Reply", "assistant.outcome": "Request update",
    "assistant.tagged": "Your assistant in Messages", "assistant.thread_reply": "Reply in Messages",
    ...ROUTINE_WORDS.notifications.kinds,
    ...LOOP_WORDS.notifications.kinds,
  };
}

/** The filters, as underline tabs (owner brief, 6 October 2026). Each type belongs to at most one group besides All. The
 * "brenda" tab is labelled with the person's own assistant's name on the page. */
const FILTERS = [
  { value: "all", label: "All" },
  { value: "unread", label: "Unread" },
  { value: "tasks", label: "Tasks" },
  { value: "messages", label: "Messages" },
  { value: "brenda", label: "Brenda" },
] as const;
type Filter = (typeof FILTERS)[number]["value"];
const group = (type: string): Filter | null => (/^(task|review|adjustment)\./.test(type) ? "tasks" : type.startsWith("message.") ? "messages" : type.startsWith("brenda.") || type.startsWith("assistant.") ? "brenda" : null);

type Icon = ComponentType<{ className?: string; "aria-hidden"?: boolean }>;
/** A line icon per kind, in the 32px square at the head of each row. A `brenda.*` glyph draws the person's own assistant,
 * except the daily report's, which the page scopes to the workspace's (so the assistant's news about a mention it handled
 * carries its face). Someone mentioning the person (`message.mention`) draws an "@" instead of the message bubble. */
function iconOf(type: string): Icon {
  // Between assistants (phase 6): what another person's assistant brought, and what became of a request.
  if (type === "assistant.message") return MessageSquareQuote;
  if (type === "assistant.request") return ClipboardCheck;
  if (type === "assistant.reply") return MessageSquareReply;
  if (type === "assistant.outcome") return CircleCheck;
  if (type === "assistant.tagged" || type === "assistant.thread_reply") return AtSign;
  // Loose ends and commitments (phase 7b): commitments and asks, blocks, a re-plan to confirm.
  if (type.startsWith("brenda.commitment") || type === "brenda.open_ask") return Handshake;
  if (type === "brenda.blocked_on" || type.startsWith("brenda.block_")) return Hourglass;
  if (type === "brenda.replan") return CalendarClock;
  // Routines (phase 7a): what ran on a schedule; one that couldn't run is a warning.
  if (type === "brenda.routine_failed") return CircleAlert;
  if (type === "brenda.routine" || type === "brenda.routine_bundle") return Repeat;
  if (type.startsWith("brenda.")) return BrendaGlyph as Icon;
  if (type === "message.reported") return CircleAlert;
  if (type.includes("mention")) return AtSign;
  if (type.startsWith("message.")) return MessageSquare;
  if (type.startsWith("task.") || type.startsWith("review.")) return SquareCheckBig;
  if (type.startsWith("adjustment.")) return CalendarClock;
  if (type.startsWith("billing.")) return CreditCard;
  if (type.startsWith("capture.")) return Video;
  if (type.startsWith("policy.")) return ShieldCheck;
  if (type.startsWith("incident.")) return CircleAlert;
  if (type.includes("doc")) return FileText;
  return Bell;
}

function emptyFor(personal: string): Record<Filter, { title: string; description: string }> {
  return {
    all: { title: "No notifications yet", description: "Assignments, review requests and decisions land here as they happen." },
    unread: { title: "You are all caught up", description: "Nothing unread. New notifications show here first." },
    tasks: { title: "No task notifications", description: "Assignments, comments, blockers and review requests on your tasks show here." },
    messages: { title: "No message notifications", description: "Direct messages and mentions show here." },
    brenda: { title: `Nothing from ${personal} yet`, description: "Reminders, nudges, follow-ups, daily reports, your routines, commitments and what other people's assistants bring you show here." },
  };
}

/**
 * Notifications, v4: a page header with the filters as underline tabs (All, Unread, Tasks, Messages, Brenda) and one
 * action, "Mark all as read"; then a calm list grouped by day (Today, Yesterday, Earlier), rows separated by spacing,
 * not lines. Each row: an orange unread dot, a 32px line-icon square, the title (foreground while unread, secondary
 * once read), the body, the kind, and the time on the right with "Mark read". The whole row opens its link.
 * Calm by design (accent rules, 6 October 2026): orange is only the small dot on an unread row and the Unread count;
 * read rows carry none, and no text is ever orange. Email delivery and the 100-item limit are page notes at the bottom
 * (owner request, 7 October 2026).
 */
export default async function NotificationsPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ show?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts, teams } = await workspacePage(workspace, `/app/${workspace}/notifications`);
  const [items, assistants] = await Promise.all([notificationsView(ctx), assistantProfiles(ctx)]);
  const { personal, workspace: wsAssistant } = assistants;
  const kinds = kindsFor(personal.name, wsAssistant.name);
  const kindOf = (type: string) => kinds[type] ?? label(type.replace(/[._]/g, " "));
  const base = `/app/${ctx.org.slug}`;
  const show: Filter = FILTERS.some((f) => f.value === sp.show) ? (sp.show as Filter) : "all";
  const empty = emptyFor(personal.name)[show];
  const unreadItems = items.filter((n) => !n.read_at);
  const shown = items.filter((n) => show === "all" || (show === "unread" ? !n.read_at : group(n.type) === show));
  const tz = ctx.org.timezone;
  const day = (iso: string | Date) => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
  const today = day(new Date());
  const [ty, tm, td] = today.split("-").map(Number);
  const yesterday = new Date(Date.UTC(ty, tm - 1, td - 1)).toISOString().slice(0, 10);
  const bucket = (iso: string) => (day(iso) === today ? "Today" : day(iso) === yesterday ? "Yesterday" : "Earlier");
  const groups = ["Today", "Yesterday", "Earlier"].map((g) => ({ g, rows: shown.filter((n) => bucket(n.created_at) === g) })).filter((x) => x.rows.length);
  const when = (iso: string) => (day(iso) === today || day(iso) === yesterday
    ? new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit" }).format(new Date(iso))
    : new Intl.DateTimeFormat("en-GB", { timeZone: tz, day: "numeric", month: "short" }).format(new Date(iso)));

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader title="Notifications" description="Assignments, review requests, decisions, blockers, reminders and follow-ups."
        actions={unreadItems.length ? <MarkAllRead orgSlug={ctx.org.slug} ids={unreadItems.map((n) => n.id)} /> : undefined}
        tabsLabel="Show" tabValue={show} tabParam="show"
        tabs={FILTERS.map((f) => ({ label: f.value === "brenda" ? personal.name : f.label, value: f.value, href: f.value === "all" ? `${base}/notifications` : `${base}/notifications?show=${f.value}`, count: f.value === "unread" ? unreadItems.length : undefined, attention: f.value === "unread" }))} />
      {shown.length === 0 ? (
        <EmptyState icon={Bell} title={empty.title} description={empty.description}
          action={show === "all" ? <Link href={`${base}/home`} className={buttonVariants({ size: "sm", variant: "secondary" })}>Back to {personal.name}</Link> : <Link href={`${base}/notifications`} className={buttonVariants({ size: "sm", variant: "secondary" })}>Show all</Link>} />
      ) : (
        <div className="max-w-4xl space-y-6">
          {groups.map(({ g, rows }) => (
            <section key={g} aria-labelledby={`n-${g}`}>
              <h2 id={`n-${g}`} className="mb-1 px-2 text-sm font-medium text-secondary">{g}</h2>
              <ul className="space-y-0.5">
                {rows.map((n) => {
                  const Icon = iconOf(n.type);
                  const unread = !n.read_at;
                  return (
                    <li key={n.id} className="group relative flex items-start gap-3 rounded-xl px-2 py-3 transition-colors duration-75 hover:bg-fill-0">
                      <span aria-hidden className="mt-3 flex w-2 shrink-0 justify-center">{unread ? <span className="size-2 rounded-full bg-accent" /> : null}</span>
                      <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg bg-fill-1 text-secondary">
                        {n.type === "brenda.daily_report" ? <AssistantScope profile={wsAssistant}><Icon className="size-4" aria-hidden /></AssistantScope> : <Icon className="size-4" aria-hidden />}
                      </span>
                      <div className="min-w-0 flex-1">
                        {unread ? <span className="sr-only">Unread: </span> : null}
                        {n.href
                          ? <Link href={n.href} className={cn("break-words text-sm outline-none after:absolute after:inset-0 after:rounded-xl focus-visible:after:outline-2 focus-visible:after:-outline-offset-2 focus-visible:after:outline-[var(--ring)]", unread ? "font-semibold text-foreground" : "font-medium text-secondary")}>{n.title}</Link>
                          : <p className={cn("break-words text-sm", unread ? "font-semibold text-foreground" : "font-medium text-secondary")}>{n.title}</p>}
                        {n.body ? <p className="mt-0.5 line-clamp-3 break-words text-meta font-normal text-secondary">{n.body}</p> : null}
                        <p className="mt-1 text-xs font-medium text-subtle">{kindOf(n.type)}</p>
                      </div>
                      <div className="relative z-[1] flex shrink-0 flex-col items-end gap-1">
                        <time dateTime={n.created_at} title={formatDateTime(n.created_at, tz)} className="pt-0.5 text-xs font-medium tabular-nums text-subtle">{when(n.created_at)}</time>
                        {unread ? <MarkRead orgSlug={ctx.org.slug} id={n.id} title={n.title} /> : null}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      )}
      <PageNotes>
        {items.length >= 100 ? <PageNote>Showing the latest 100.</PageNote> : null}
        <PageNote>Email delivery is optional and off in the pilot.</PageNote>
      </PageNotes>
    </AppShell>
  );
}
