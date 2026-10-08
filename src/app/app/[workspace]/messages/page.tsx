import Link from "next/link";
import { redirect } from "next/navigation";
import { Hash, Building2, ArrowLeft, BellOff, MessagesSquare, MessageSquare, SquareCheckBig } from "lucide-react";
import { AnimatedArchive } from "@/components/ui/animated-icons";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell, ROLE_LABEL } from "@/components/app/shell";
import { Badge, CountPill, TASK_STATUS_TONE, taskStatusLabel } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState, Alert } from "@/components/ui/states";
import { AppError } from "@/server/lib/errors";
import { Avatar } from "@/components/ui/avatar";
import { PresenceDot } from "@/components/ui/presence";
import { ICON_BUTTON } from "@/components/ui/icon-button";
import { PRESENCE } from "@/lib/presence";
import { Composer, NewConversation, ScrollToLatest, MessageMenu, ConversationMenu, ConversationRowMenu, ConversationDetails, ReplyProvider, RowPending } from "@/components/app/messages";
import { MessageBubble } from "@/components/ui/chat-messages";
import { VoiceNote } from "@/components/app/voice-note";
import { AssistantAvatar, AssistantChip } from "@/components/app/assistant-chip";
import { FullAnswerToggle, MentionRows, MentionText } from "@/components/app/mention-thread";
import { MENTION_WORDS, showsMentionRows } from "@/lib/mentions";
import { ConversationAssistantSwitch } from "@/components/app/conversation-assistant-switch";
import { DEFAULT_ASSISTANT_NAME, toProfile } from "@/lib/assistant-look";
import type { AssistantRepliesState, MentionRef, MentionView, TaggableAssistant } from "@/lib/mentions";
import { inbox, thread, openDirect, peopleToMessage, visibleTask, type AuthorKind, type ConversationSummary, type MessageRow, type Thread } from "@/server/services/messaging";
import { navCounts } from "@/server/services/workspace";
import { formatDateTime, formatLongDate, relativeTime, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function timeOnly(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/** What kind of room a conversation is, in words. */
function kindLabel(c: ConversationSummary) {
  return c.kind === "team" ? "Team channel" : c.kind === "channel" ? (c.archived_at ? "Archived channel" : "Channel") : c.kind === "organisation" ? "Everyone in the organisation" : "Direct message";
}

/** "Olu" from "Olu Adeyemi". Kept here: a function exported from a client module cannot be called on the server. */
const firstName = (name: string) => name.trim().split(/\s+/)[0] || name;

/** Who wrote a message; anything unknown (or a row read before migration 0037) is the person's own. */
const authorOf = (m: Pick<MessageRow, "author_kind">): AuthorKind => (m.author_kind === "via_assistant" || m.author_kind === "assistant" ? m.author_kind : "person");

/**
 * @mentions before migration 0041 (contract A.2), and while a page is drawn by code older than the thread's: no
 * mentions, no assistant replies, nothing to switch.
 */
const NO_ASSISTANT_REPLIES: AssistantRepliesState = { ready: false, workspaceOn: true, here: true, canChange: false };
const NO_MENTION_VIEWS: MentionView[] = [];
/** Someone else's assistant to tag: none before migration 0043 (phase 6, contract A.3), nor from an older thread(). */
const NO_TAGGABLE: TaggableAssistant[] = [];

/** Who asked an assistant's reply, when it is someone else's assistant answering them (phase 6); null otherwise. */
const askedByOf = (m: MessageRow) => {
  const a = m.author_kind === "assistant" ? m.mention_reply?.askedBy : null;
  return a && a.membershipId !== m.sender_membership_id ? a : null;
};

/**
 * Whose assistant each tag of someone else's assistant in a message is (phase 6): the owner's name by membership, for the
 * tag's title ("Ben's assistant"). Only those tags, so a message in Everyone does not carry the whole workspace.
 */
function ownersOf(senderId: string, refs: MentionRef[], names: Map<string, string>): Record<string, string> | undefined {
  let out: Record<string, string> | undefined;
  for (const r of refs) {
    const name = r.kind === "assistant" && r.membershipId !== senderId ? names.get(r.membershipId) : undefined;
    if (!name) continue;
    out ??= {};
    out[r.membershipId] = name;
  }
  return out;
}

/** The time and the unread count at a row's right edge step aside while the row's "…" menu shows over them. */
const UNDER_ROW_MENU = "transition-opacity duration-75 group-hover:opacity-0 group-has-[[aria-haspopup=menu]:focus]:opacity-0 group-has-[[aria-expanded=true]]:opacity-0";

/**
 * Messages, v4 (owner brief, 6 October 2026): a three-pane inbox under the top bar. On the left, the conversations as
 * sub-navigation rows (channels, then people, then the archived ones); in the middle, the open conversation with its
 * bubbles and the prompt-pill composer pinned at the bottom; on the right (from 1280px), the conversation's details:
 * who is in it, with their status. Narrower screens open the details in a side sheet; a phone shows the list or the
 * conversation, one at a time. Direct threads with anyone in the organisation, a channel per team, and Everyone.
 *
 * @mentions (owner decision, 8 October 2026: personal assistants, phase 5): a message's mentions are marked in its text
 * (yours in the orange tint); under a message that tagged its sender's own assistant, "Max is thinking…", "Waiting for
 * Olu to confirm" or, for Olu alone, her private answer with Post to channel and Dismiss (components/app/mention-thread);
 * an assistant's shortened reply offers its asker "Read the full answer", and the asker or whoever runs the conversation
 * "Withdraw reply" in its menu; the composer suggests "@" names; the details pane carries the "Assistants can reply
 * here" switch and its one-line disclosure.
 *
 * Phase 6 (owner decision, 8 October 2026: assistants talk to each other): "@Ben's Brenda, where is the deck?" makes
 * Ben's assistant answer Olu here. The composer offers the conversation's people's assistants after the people
 * (`Thread.taggable`); a tag of one is marked in the text ("Ben's assistant", orange for Ben); the thinking and waiting
 * rows show Ben's assistant with "Ben's assistant" and "asked by Olu"; its messages ("I've asked Ben. I'll reply
 * here.", then Ben's reply, or its answer from Ben's work) are Ben's assistant's own messages with its face and name,
 * the badge "Ben's assistant" and "asked by Olu" (`mention_reply.askedBy`); a run of them never hides who asked; Olu's
 * private card for it has no Post to channel; Ben may withdraw its reply too (the server says who may).
 */
export default async function MessagesPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ c?: string; to?: string; task?: string; archived?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts: countsBefore, teams } = await workspacePage(workspace, `/app/${workspace}/messages`);
  const base = `/app/${ctx.org.slug}`;
  // Ids arrive in the address bar; anything that is not an id is ignored rather than handed to the database.
  const idOrNull = (v?: string) => (v && UUID.test(v) ? v : null);
  const taskId = idOrNull(sp.task);
  // "Message this person" links land here with ?to=; open the thread and continue with ?c=. A link to someone who has
  // left, or to yourself, says so above the list instead of failing the page.
  const toId = sp.to ? idOrNull(sp.to) : null;
  const opened = sp.to
    ? toId ? await openDirect(ctx, toId).then((id) => ({ id, error: null }), (err: unknown) => ({ id: null, error: err instanceof AppError ? err.message : "That conversation could not be opened. Try again in a moment." }))
      : { id: null, error: "That link does not point to anyone in this workspace." }
    : null;
  if (opened?.id) redirect(`${base}/messages?c=${opened.id}${taskId ? `&task=${taskId}` : ""}`);
  const [box, people] = await Promise.all([inbox(ctx), peopleToMessage(ctx)]);
  const conversationId = idOrNull(sp.c);
  const selected = conversationId ? await thread(ctx, conversationId) : null;
  const clear = (c: ConversationSummary) => (selected && c.id === selected.conversation.id ? { ...c, unread: 0 } : c);
  const channels = box.channels.map(clear);
  const direct = box.direct.map(clear);
  const archived = box.archived.map(clear);
  const showArchived = sp.archived === "1" || (selected?.conversation.archived_at ? true : false);
  const counts = selected ? await navCounts(ctx) : countsBefore;
  const task = taskId && selected ? await visibleTask(ctx, taskId) : null;
  const title = selected ? selected.conversation.title : null;
  const other = selected?.conversation.kind === "direct" ? selected.conversation : null;
  // "Their day" opens the Workroom, which lists staff and team leads only; for an owner or HR it would be a dead end.
  const otherRole = other ? people.find((p) => p.membership_id === other.other_membership_id)?.role : undefined;
  const showTheirDay = !!other?.other_membership_id && ctx.membership.role !== "employee" && (otherRole === "employee" || otherRole === "manager");
  const isRoom = (k: string) => k === "team" || k === "channel";
  const shownTitle = (c: ConversationSummary) => (c.kind === "organisation" ? c.title : isRoom(c.kind) ? `# ${c.title}` : c.title);

  // The last line said, after who said it: "You: …", "Olu: …"; one her assistant sent for someone "You via Max: …" or
  // "Olu via Max: …"; an assistant's own "Max: …" (personal assistants, phase 3, owner decision, 8 October 2026).
  const preview = (c: ConversationSummary) => {
    if (c.last_body === null) return c.subtitle ?? "";
    if (c.last_body === "") return "Message withdrawn";
    const assistantName = c.last_assistant_name ?? DEFAULT_ASSISTANT_NAME;
    // Someone else's assistant is theirs: "Ben's Brenda: …" (review, 8 October 2026); yours is just "Max: …".
    if (c.last_author_kind === "assistant") return c.last_sender_name && c.last_sender_name !== ctx.user.displayName ? `${firstName(c.last_sender_name)}'s ${assistantName}: ${c.last_body}` : `${assistantName}: ${c.last_body}`;
    const who = c.last_sender_name === ctx.user.displayName ? "You" : firstName(c.last_sender_name ?? "");
    return c.last_author_kind === "via_assistant" ? `${who} via ${assistantName}: ${c.last_body}` : `${who}: ${c.last_body}`;
  };

  // A conversation in the list: a sub-navigation row (r8, fill-0 on hover, fill-1 and the orange marker when open; an
  // unread count is an orange pill, accent rules 6 October 2026). The leading 32px is the
  // person (with their status dot) or the room's sign; the name, then the last line said; the time and the unread
  // count on the right. The "…" for the row's actions sits over the right edge on hover and keyboard focus.
  const Item = ({ c }: { c: ConversationSummary }) => {
    const active = selected?.conversation.id === c.id;
    const Icon = c.kind === "organisation" ? Building2 : isRoom(c.kind) ? Hash : null;
    return (
      <li className="group relative">
        <Link href={`${base}/messages?c=${c.id}`} aria-current={active ? "page" : undefined}
          className={cn("relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors duration-75 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]", active ? "selected-marker bg-fill-1" : "hover:bg-fill-0", c.muted && "opacity-60")}>
          {Icon ? <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-fill-1 text-secondary"><Icon className="size-4" aria-hidden /></span>
            : <Avatar profileId={c.other_profile_id ?? c.id} name={c.title} avatarKey={c.other_avatar_key} presence={c.other_presence ?? "offline"} size={32} />}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2">
              <span className={cn("truncate text-sm", c.unread ? "font-semibold text-foreground" : active ? "font-medium text-foreground" : "font-medium text-secondary")}>{c.title}</span>
              <span className={cn("flex shrink-0 items-center gap-1 text-xs font-medium tabular-nums text-subtle", UNDER_ROW_MENU)}>{c.muted ? <><BellOff className="size-3" aria-hidden /><span className="sr-only">Muted,</span></> : null}{c.last_message_at ? relativeTime(c.last_message_at) : null}</span>
            </span>
            <span className="mt-px flex items-center gap-2">
              <span className={`min-w-0 flex-1 truncate text-meta font-normal ${c.unread ? "text-foreground" : "text-subtle"}`}>{preview(c)}</span>
              {c.unread ? (
                c.marked_unread && c.unread <= 1
                  ? <span className={cn("size-2 shrink-0 rounded-full bg-accent", UNDER_ROW_MENU)}><span className="sr-only">Marked unread</span></span>
                  : <span className={cn("inline-flex h-[18px] min-w-[18px] shrink-0 items-center justify-center rounded-full bg-accent-soft px-1 text-2xs font-semibold tabular-nums text-accent-text", UNDER_ROW_MENU)}>{c.unread > 99 ? "99+" : c.unread}<span className="sr-only"> unread</span></span>
              ) : null}
            </span>
          </span>
          <RowPending />
        </Link>
        <ConversationRowMenu orgSlug={ctx.org.slug} active={active} conversation={{ id: c.id, kind: c.kind, title: c.title, unread: c.unread, muted: c.muted, archived_at: c.archived_at, can_manage: c.can_manage }} />
      </li>
    );
  };

  const details = selected ? <Details t={selected} me={ctx.membership.id} base={base} orgSlug={ctx.org.slug} showTheirDay={showTheirDay} /> : null;
  // @mentions (phase 5): each tagging message's mention by message, and by id for the assistant's reply to it.
  const mentionViews = selected?.mentions ?? NO_MENTION_VIEWS;
  const mentionByMessage = new Map(mentionViews.map((v) => [v.messageId, v]));
  const mentionById = new Map(mentionViews.map((v) => [v.id, v]));
  const assistantReplies = selected?.assistantReplies ?? NO_ASSISTANT_REPLIES;
  // Only people still in the workspace: the server drops a mention of someone who left (review, 8 October 2026).
  const mentionPeople = !selected ? [] : selected.conversation.people.filter((p) => p.membership_id !== ctx.membership.id && p.active !== false)
    .map((p) => ({ membershipId: p.membership_id, name: p.display_name, profileId: p.profile_id, avatarKey: p.avatar_key, role: p.role }));
  // Phase 6: the people's assistants the composer offers, and whose assistant a tag in a message is (for its title).
  const taggable = selected?.taggable ?? NO_TAGGABLE;
  const namesById = new Map((selected?.conversation.people ?? []).map((p) => [p.membership_id, p.display_name]));
  const where = !selected ? "" : other ? `the chat with ${title}` : selected.conversation.kind === "organisation" ? "Everyone" : `#${title}`;

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams} bleed>
      <div className={cn("flex min-h-0 flex-1 md:grid md:grid-cols-[18rem_minmax(0,1fr)]", selected && "xl:grid-cols-[18rem_minmax(0,1fr)_18rem]")}>
        {/* The conversations. */}
        <aside aria-label="Conversations" className={cn("min-h-0 min-w-0 flex-col md:flex md:border-r md:border-border", selected ? "hidden" : "flex flex-1")}>
          <div className="flex shrink-0 items-center justify-between gap-3 px-4 pb-3 pt-5">
            <h1 className="type-page-title">Messages</h1>
            <NewConversation orgSlug={ctx.org.slug} people={people} />
          </div>
          <div className="prompt-scroll min-h-0 flex-1 overflow-y-auto px-2 pb-6">
            {opened?.error ? <Alert tone="warning" className="mx-1 mb-3">{opened.error}</Alert> : null}
            {conversationId && !selected ? <Alert tone="info" className="mx-1 mb-3">That conversation is not open to you any more. It may have been deleted, or you were taken out of it.</Alert> : null}
            <h2 className="px-2 pb-1 pt-2 text-sm font-medium text-secondary">Channels</h2>
            <ul className="space-y-0.5">{channels.map((c) => <Item key={c.id} c={c} />)}</ul>
            <h2 className="px-2 pb-1 pt-5 text-sm font-medium text-secondary">People</h2>
            {direct.length === 0 ? <p className="px-2 py-2 text-meta font-normal text-secondary">No direct threads yet. Press New, then Message someone.</p> : <ul className="space-y-0.5">{direct.map((c) => <Item key={c.id} c={c} />)}</ul>}
            {archived.length ? (
              <div className="mt-5">
                {/* Keeps the open thread open while the archived list is shown or hidden. */}
                <Link href={`${base}/messages?${selected ? `c=${selected.conversation.id}&` : ""}archived=${showArchived ? "0" : "1"}`} aria-expanded={showArchived} className={`${buttonVariants({ variant: "ghost", size: "xs" })} ml-1`}>
                  <AnimatedArchive aria-hidden />{showArchived ? "Hide archived" : <>Archived <CountPill count={archived.length} /></>}
                </Link>
                {showArchived ? <ul className="mt-1 space-y-0.5">{archived.map((c) => <Item key={c.id} c={c} />)}</ul> : null}
              </div>
            ) : null}
          </div>
        </aside>

        {/* The open conversation. */}
        <section aria-label={!selected ? "Conversation" : other ? `Conversation with ${title}` : selected.conversation.kind === "organisation" ? "Everyone" : `#${title}`} className={cn("min-h-0 min-w-0 flex-col md:flex", selected ? "flex flex-1" : "hidden")}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon={MessagesSquare} title="Pick a conversation" description="Choose a channel or a person on the left, or press New to start one." />
            </div>
          ) : (
            <ReplyProvider key={selected.conversation.id}>
              <header className="flex h-14 shrink-0 items-center gap-3 border-b border-border px-3 md:px-5">
                <Link href={`${base}/messages`} className={cn(ICON_BUTTON, "md:hidden")} aria-label="All conversations"><ArrowLeft aria-hidden /></Link>
                {other ? <Avatar profileId={other.other_profile_id ?? other.id} name={other.title} avatarKey={other.other_avatar_key} presence={other.other_presence ?? "offline"} size={32} />
                  : <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-fill-1 text-secondary">{selected.conversation.kind === "organisation" ? <Building2 className="size-4" aria-hidden /> : <Hash className="size-4" aria-hidden />}</span>}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-sm font-semibold text-foreground">{shownTitle(selected.conversation)}</h2>
                  {other ? <p className="truncate text-xs font-medium text-secondary">{PRESENCE[other.other_presence ?? "offline"].label}{other.subtitle ? `, ${other.subtitle}` : ""}</p>
                    : <p className="truncate text-xs font-medium text-secondary"><span className="tabular-nums">{selected.conversation.people.length}</span> people, {kindLabel(selected.conversation).toLowerCase()}</p>}
                </div>
                {selected.conversation.kind !== "direct" ? (
                  <div className="hidden items-center -space-x-1.5 lg:flex xl:hidden" aria-hidden>
                    {selected.conversation.people.slice(0, 4).map((p) => <Avatar key={p.membership_id} profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} size={24} className="ring-2 ring-background" />)}
                    {selected.conversation.people.length > 4 ? <span className="pl-2.5 text-xs font-medium tabular-nums text-secondary">+{selected.conversation.people.length - 4}</span> : null}
                  </div>
                ) : null}
                {showTheirDay && other?.other_membership_id ? <span className="hidden sm:inline-flex"><Link href={`${base}/workroom/${other.other_membership_id}`} className={buttonVariants({ variant: "secondary", size: "sm" })}>Their day</Link></span> : null}
                <ConversationDetails title={other ? (title ?? "Details") : shownTitle(selected.conversation)}>{details}</ConversationDetails>
                <ConversationMenu orgSlug={ctx.org.slug} conversation={{ id: selected.conversation.id, kind: selected.conversation.kind, title: title ?? "", archived_at: selected.conversation.archived_at, can_manage: selected.conversation.can_manage, other_membership_id: selected.conversation.other_membership_id }} people={people} memberIds={selected.conversation.people.map((p) => p.membership_id)} />
              </header>
              <div role="log" aria-label={`Messages in ${where}`} className="prompt-scroll min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 md:px-6">
                <div className="mx-auto w-full max-w-3xl">
                  {selected.messages.length === 0 ? <EmptyState compact icon={MessageSquare} className="py-16" title="No messages yet" description="Say hello, or ask how something is going." /> : (
                    <ol>
                      {selected.messages.map((m, i) => {
                        const prev = selected.messages[i - 1];
                        const newDay = !prev || dayKey(prev.created_at, ctx.org.timezone) !== dayKey(m.created_at, ctx.org.timezone);
                        // A run is one author: an assistant's own message never joins its person's run, and each message their
                        // assistant sent for them keeps its own name row, so its "via Max" chip always shows (review, 8 October 2026).
                        // A thinking row, a waiting row or a private card under the previous message ends the run (review, 8 October 2026).
                        const prevTagged = prev && !prev.deleted_at ? mentionByMessage.get(prev.id) : undefined;
                        // Phase 6: someone else's assistant answering two different people starts a new run, so "asked by"
                        // always shows (owner decision, 8 October 2026).
                        const grouped = !newDay && !!prev && !(prevTagged && showsMentionRows(prevTagged)) && prev.sender_membership_id === m.sender_membership_id && authorOf(prev) === authorOf(m) && authorOf(m) !== "via_assistant"
                          && askedByOf(prev)?.membershipId === askedByOf(m)?.membershipId
                          && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
                        // Phase 5: the mention this message started (its rows go under it, unless it was withdrawn), and
                        // for an assistant's reply the mention it answers (its full text, for the asker only).
                        const tagged = m.deleted_at ? undefined : mentionByMessage.get(m.id);
                        const answers = m.mention_reply ? mentionById.get(m.mention_reply.mentionId) : undefined;
                        return (
                          <li key={m.id} id={`m-${m.id}`} className="target-flash scroll-mt-4 rounded-xl">
                            {newDay ? <p className="mb-2 mt-6 flex items-center gap-3 text-xs font-medium text-subtle before:h-px before:flex-1 before:bg-border after:h-px after:flex-1 after:bg-border">{formatLongDate(dayKey(m.created_at, ctx.org.timezone))}</p> : null}
                            <Message m={m} me={ctx.membership.id} grouped={grouped} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} canReply={!selected.conversation.archived_at}
                              fullAnswer={answers?.private?.kind === "full_answer" && !m.mention_reply?.holding ? answers.private.text : null}
                              owners={ownersOf(m.sender_membership_id, m.mentions ?? [], namesById)} />
                            {tagged ? <MentionRows orgSlug={ctx.org.slug} mention={tagged} conversationKind={selected.conversation.kind} /> : null}
                          </li>
                        );
                      })}
                    </ol>
                  )}
                  <ScrollToLatest count={selected.messages.length} conversationId={selected.conversation.id} />
                </div>
              </div>
              {selected.conversation.archived_at ? <p className="shrink-0 border-t border-border px-6 py-4 text-center text-sm font-normal text-secondary">This channel is archived. {selected.conversation.can_manage ? "Restore it from the menu to write here again." : "The person who made it, the owner or HR can restore it."}</p> : <Composer key={selected.conversation.id} canVoice={ctx.plan.features.VOICE_NOTES} orgSlug={ctx.org.slug} conversationId={selected.conversation.id}
                people={mentionPeople} mentions={{ ready: assistantReplies.ready, assistantAllowed: assistantReplies.ready && assistantReplies.workspaceOn && assistantReplies.here }} taggable={taggable}
                task={task ? { id: task.id, title: task.title } : null}
                prefill={task ? `How far with “${task.title}”?` : undefined}
                placeholder={selected.conversation.kind === "direct" ? `Message ${title}` : `Message ${isRoom(selected.conversation.kind) ? `#${title}` : "everyone"}`} />}
            </ReplyProvider>
          )}
        </section>

        {/* The details pane (from 1280px; a side sheet below). */}
        {selected ? (
          <aside aria-label="Conversation details" className="prompt-scroll hidden min-h-0 overflow-y-auto border-l border-border p-5 xl:block">{details}</aside>
        ) : null}
      </div>
    </AppShell>
  );
}

/**
 * Who and what a conversation is: for a direct chat, the person (picture, name, status, title) and "Their day" where it
 * leads somewhere; for a room, its sign, name and kind. Then everyone in it, with their status dot and role; each
 * other person links to a direct thread with them. Then "Assistants" (phase 5): what a tagged assistant reads here, and
 * the switch for whoever runs the conversation (hidden before migration 0041). Since phase 6 the line says any
 * assistant, yours or someone else's, and that replies show whose assistant it is and who asked.
 */
function Details({ t, me, base, orgSlug, showTheirDay }: { t: Thread; me: string; base: string; orgSlug: string; showTheirDay: boolean }) {
  const c = t.conversation;
  const direct = c.kind === "direct";
  return (
    <div>
      <div className="flex flex-col items-center text-center">
        {direct ? <Avatar profileId={c.other_profile_id ?? c.id} name={c.title} avatarKey={c.other_avatar_key} presence={c.other_presence ?? "offline"} size={64} />
          : <span className="grid size-16 place-items-center rounded-2xl bg-fill-1 text-secondary">{c.kind === "organisation" ? <Building2 className="size-7" strokeWidth={1.5} aria-hidden /> : <Hash className="size-7" strokeWidth={1.5} aria-hidden />}</span>}
        <p className="mt-3 max-w-full break-words text-base font-semibold text-foreground">{c.kind === "team" || c.kind === "channel" ? `# ${c.title}` : c.title}</p>
        <p className="mt-0.5 text-meta font-normal text-secondary">{direct ? (c.subtitle ?? "Direct message") : kindLabel(c)}</p>
        {direct ? <p className="mt-2 inline-flex items-center gap-1.5 text-xs font-medium text-secondary"><PresenceDot presence={c.other_presence ?? "offline"} size={8} withRing={false} />{PRESENCE[c.other_presence ?? "offline"].label}</p> : null}
        {direct && showTheirDay && c.other_membership_id ? <Link href={`${base}/workroom/${c.other_membership_id}`} className={`${buttonVariants({ variant: "secondary", size: "sm" })} mt-4`}>Their day</Link> : null}
      </div>
      <h3 className="mb-1 mt-7 flex items-center gap-2 px-2 text-sm font-medium text-secondary">People <CountPill count={c.people.length} /></h3>
      <ul className="-mx-2 space-y-0.5">
        {c.people.map((p) => {
          const body = (
            <>
              <Avatar profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} presence={p.presence} size={28} />
              <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium text-foreground">{p.display_name}{p.membership_id === me ? <span className="font-normal text-secondary"> (you)</span> : null}</span><span className="block truncate text-xs font-medium text-subtle">{ROLE_LABEL[p.role] ?? p.role}</span></span>
            </>
          );
          return (
            <li key={p.membership_id}>
              {p.membership_id === me || (direct && p.membership_id === c.other_membership_id)
                ? <div className="flex min-h-11 items-center gap-2.5 px-2 py-1.5">{body}</div>
                : <Link href={`${base}/messages?to=${p.membership_id}`} title={`Message ${p.display_name}`} className="flex min-h-11 items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors duration-75 hover:bg-fill-1 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-[var(--ring)]">{body}<span className="sr-only">, message them</span></Link>}
            </li>
          );
        })}
      </ul>
      <ConversationAssistantSwitch orgSlug={orgSlug} conversationId={c.id} state={t.assistantReplies ?? NO_ASSISTANT_REPLIES} />
    </div>
  );
}

/**
 * One message. Personal assistants, phase 3 (owner decision, 8 October 2026): one the person's own assistant sent for
 * them after they confirmed it keeps the person as its author, with the "via Max" chip beside their name (beside the
 * time under your own); an assistant's own message has the assistant's face and name and an "Olu's assistant" tag, sits
 * on the left even when it is your assistant's, and its menu offers Reply and Copy (and Report, for someone else's).
 * Phase 5: a text message's stored mentions are marked in it; an assistant's reply to a mention offers the person who
 * asked "Read the full answer" when it was shortened (`fullAnswer`), and "Withdraw reply" in its menu to them and to
 * whoever runs the conversation.
 * Phase 6: someone else's assistant answering a tag ("I've asked Ben. I'll reply here.", Ben's reply, or an answer from
 * Ben's work) is drawn as any assistant's own message, Ben's assistant's face and name with "Ben's assistant" ("Your
 * assistant" for Ben), then "asked by Olu" ("asked by you" for Olu); its owner may withdraw it as well (`canWithdraw`).
 * A tag of someone else's assistant in a person's message is titled with whose it is (`owners`).
 */
function Message({ m, me, grouped, orgSlug, timeZone, canReply, fullAnswer = null, owners }: { m: MessageRow; me: string; grouped: boolean; orgSlug: string; timeZone: string; canReply: boolean; fullAnswer?: string | null; owners?: Record<string, string> }) {
  const author = authorOf(m);
  const assistant = author === "person" ? null : toProfile(m.assistant);
  const byAssistant = author === "assistant" && assistant ? assistant : null;
  const isOwnAssistant = !!byAssistant && m.sender_membership_id === me;
  const name = byAssistant ? byAssistant.name : m.sender_name;
  // The chip stays when the person edits or withdraws the message: who sent it does not change (contract B.1).
  const via = author === "via_assistant" && assistant ? <AssistantChip assistant={assistant} personName={m.sender_name} isYou={m.mine} /> : null;
  const time = <><time dateTime={m.created_at} title={formatDateTime(m.created_at, timeZone)}>{timeOnly(m.created_at, timeZone)}</time>{m.edited_at && !m.deleted_at ? <span className="ml-1 text-faint" title={`Edited ${formatDateTime(m.edited_at, timeZone)}`}>edited</span> : null}</>;
  // The quoted message a reply points at: the sender's name (an assistant's own message: the assistant's) and a line of
  // it, jumping to the original on click.
  const quoted = m.reply_author_kind === "assistant" ? (m.reply_assistant_name ?? DEFAULT_ASSISTANT_NAME) : m.reply_mine ? "You" : m.reply_sender_name;
  const quote = m.reply_to_id && !m.deleted_at ? (
    <a href={`#m-${m.reply_to_id}`} className="mb-2 flex max-w-full items-stretch gap-2 rounded-lg border border-border bg-fill-1 px-2.5 py-1.5 no-underline transition-colors duration-75 hover:bg-fill-150">
      <span className="w-0.5 shrink-0 self-stretch rounded-full bg-secondary" aria-hidden />
      <span className="min-w-0 text-meta"><span className="block truncate font-semibold text-foreground">{quoted}</span><span className={cn("block truncate font-normal text-secondary", m.reply_body === "" && "italic")}>{m.reply_body === "" ? "Message withdrawn" : m.reply_body}</span></span>
    </a>
  ) : null;
  const taskLink = m.task_id && !m.deleted_at ? (
    <Link href={`/app/${orgSlug}/tasks/${m.task_id}`} className="inline-flex h-8 max-w-full items-center gap-2 rounded-lg border border-border-input bg-background px-2.5 text-meta font-medium text-foreground transition-colors duration-75 hover:border-border-input-hover hover:bg-fill-0">
      <SquareCheckBig className="size-3.5 shrink-0 text-secondary" aria-hidden /><span className="truncate">{m.task_title}</span>{m.task_status ? <Badge tone={TASK_STATUS_TONE[m.task_status] ?? "neutral"}>{taskStatusLabel(m.task_status)}</Badge> : null}
    </Link>
  ) : null;
  const full = fullAnswer && byAssistant && !m.deleted_at ? <FullAnswerToggle text={fullAnswer} /> : null;
  const withdrawReply = byAssistant && m.mention_reply?.canWithdraw ? { mentionId: m.mention_reply.mentionId, assistantName: byAssistant.name } : null;
  const mentions = m.mentions ?? [];
  // Phase 6: whose assistant it is, then who asked it, when it answered someone other than its owner.
  const askedBy = byAssistant ? askedByOf(m) : null;
  const whose = byAssistant ? <Badge size="sm">{isOwnAssistant ? "Your assistant" : `${firstName(m.sender_name)}'s assistant`}</Badge> : null;
  return (
    <MessageBubble mine={m.mine} grouped={grouped} withdrawn={!!m.deleted_at} name={name} time={time} quote={quote}
      nameAdornment={whose ? (askedBy ? <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">{whose}<span className="text-meta font-normal text-secondary">{MENTION_WORDS.askedBy(askedBy.firstName, askedBy.isYou)}</span></span> : whose) : m.mine ? null : via}
      timeAdornment={m.mine ? via : null}
      avatar={byAssistant ? <AssistantAvatar assistant={byAssistant} /> : <Avatar profileId={m.sender_profile_id} name={m.sender_name} avatarKey={m.sender_avatar_key} size={32} />}
      footer={taskLink && full ? <div className="grid justify-items-start gap-1.5">{taskLink}{full}</div> : taskLink ?? full}
      actions={!m.deleted_at ? <MessageMenu orgSlug={orgSlug} id={m.id} mine={m.mine} body={m.body} isVoice={!!m.voice_key} senderName={name} canReply={canReply} canReport={!m.mine && !isOwnAssistant} withdrawReply={withdrawReply} /> : null}>
      {m.deleted_at ? "Message withdrawn" : m.voice_key && m.voice_seconds ? <VoiceNote src={`/api/orgs/${orgSlug}/messages/${m.id}/voice`} seconds={m.voice_seconds} mine={m.mine} />
        : mentions.length ? <MentionText body={m.body} refs={mentions} me={me} senderName={m.sender_name} senderId={m.sender_membership_id} owners={owners} /> : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
    </MessageBubble>
  );
}
