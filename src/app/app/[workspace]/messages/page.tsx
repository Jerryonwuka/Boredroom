import Link from "next/link";
import { redirect } from "next/navigation";
import { Hash, Building2, ArrowLeft } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Avatar } from "@/components/ui/avatar";
import { PresenceLabel } from "@/components/ui/presence";
import { Composer, NewMessage, ScrollToLatest, WithdrawMessage } from "@/components/app/messages";
import { MessageBubble } from "@/components/ui/chat-messages";
import { VoiceNote } from "@/components/app/voice-note";
import { inbox, thread, openDirect, peopleToMessage, visibleTask, type ConversationSummary, type MessageRow } from "@/server/services/messaging";
import { navCounts } from "@/server/services/workspace";
import { formatDateTime, formatLongDate, relativeTime, cn } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Messages" };

function dayKey(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}
function timeOnly(iso: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

/**
 * Messages, full screen under the top bar: the people and channels down the left, the open thread on the right,
 * bubbles for the conversation and the composer pinned at the bottom. Direct threads with anyone in the
 * organisation, a channel per team, and Everyone.
 */
export default async function MessagesPage({ params, searchParams }: { params: Promise<{ workspace: string }>; searchParams: Promise<{ c?: string; to?: string; task?: string }> }) {
  const { workspace } = await params;
  const sp = await searchParams;
  const { ctx, counts: countsBefore, teams } = await workspacePage(workspace, `/app/${workspace}/messages`);
  const base = `/app/${ctx.org.slug}`;
  // "Message this person" links land here with ?to=; open the thread and continue with ?c=.
  if (sp.to) {
    const id = await openDirect(ctx, sp.to);
    redirect(`${base}/messages?c=${id}${sp.task ? `&task=${sp.task}` : ""}`);
  }
  const [box, people] = await Promise.all([inbox(ctx), peopleToMessage(ctx)]);
  const selected = sp.c ? await thread(ctx, sp.c) : null;
  const clear = (c: ConversationSummary) => (selected && c.id === selected.conversation.id ? { ...c, unread: 0 } : c);
  const channels = box.channels.map(clear);
  const direct = box.direct.map(clear);
  const counts = selected ? await navCounts(ctx) : countsBefore;
  const task = sp.task && selected ? await visibleTask(ctx, sp.task) : null;
  const title = selected ? selected.conversation.title : null;
  const other = selected?.conversation.kind === "direct" ? selected.conversation : null;

  const Item = ({ c }: { c: ConversationSummary }) => {
    const active = selected?.conversation.id === c.id;
    const Icon = c.kind === "organisation" ? Building2 : c.kind === "team" ? Hash : null;
    return (
      <li>
        <Link href={`${base}/messages?c=${c.id}`} aria-current={active ? "page" : undefined}
          className={cn("flex items-center gap-3 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-wash", active && "bg-wash-strong shadow-[inset_0_1px_0_var(--highlight)]")}>
          {Icon ? <span className={cn("grid size-9 shrink-0 place-items-center rounded-full border border-border bg-wash", active ? "text-accent" : "text-fg-subtle")}><Icon className="size-4" aria-hidden /></span>
            : <Avatar profileId={c.other_profile_id ?? c.id} name={c.title} avatarKey={c.other_avatar_key} presence={c.other_presence ?? "offline"} size={36} />}
          <span className="min-w-0 flex-1">
            <span className="flex items-baseline justify-between gap-2"><span className={cn("truncate text-sm", c.unread ? "font-semibold" : "font-medium")}>{c.title}</span>{c.last_message_at ? <span className="shrink-0 text-[11px] text-fg-subtle">{relativeTime(c.last_message_at)}</span> : null}</span>
            <span className={cn("block truncate text-xs", c.unread ? "text-fg-muted" : "text-fg-subtle")}>{c.last_body === null ? (c.subtitle ?? "") : c.last_body === "" ? "Message withdrawn" : `${c.last_sender_name === ctx.user.displayName ? "You" : (c.last_sender_name ?? "").split(" ")[0]}: ${c.last_body}`}</span>
          </span>
          {c.unread ? <span className="shrink-0 rounded-full bg-accent px-1.5 py-px text-[11px] font-bold tabular-nums text-accent-fg">{c.unread}</span> : null}
        </Link>
      </li>
    );
  };

  return (
    <AppShell ctx={ctx} counts={counts} teams={teams} bleed>
      <div className="flex min-h-0 flex-1 md:grid md:grid-cols-[20rem_1fr]">
        <aside aria-label="Conversations" className={cn("min-h-0 flex-col border-border-soft bg-sidebar md:flex md:border-r", selected ? "hidden" : "flex flex-1")}>
          <div className="flex items-center justify-between gap-3 border-b border-border-soft px-4 py-3">
            <div><p className="eyebrow">Messages</p><h1 className="font-display text-lg leading-tight">Conversations</h1></div>
            <NewMessage orgSlug={ctx.org.slug} people={people} />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            <p className="eyebrow px-2.5 pb-1 pt-2">Channels</p>
            <ul className="space-y-0.5">{channels.map((c) => <Item key={c.id} c={c} />)}</ul>
            <p className="eyebrow px-2.5 pb-1 pt-4">People</p>
            {direct.length === 0 ? <p className="px-2.5 py-2 text-xs text-fg-subtle">No direct threads yet. Use “New message” to start one.</p> : <ul className="space-y-0.5">{direct.map((c) => <Item key={c.id} c={c} />)}</ul>}
          </div>
        </aside>
        <section aria-label={title ? `Conversation with ${title}` : "Conversation"} className={cn("min-h-0 min-w-0 flex-col bg-bg md:flex", selected ? "flex flex-1" : "hidden")}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon3d="chat" className="border-0 bg-transparent shadow-none" title="Pick a conversation" description="Choose a channel or a person on the left, or start a new message." />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-border-soft px-4 py-3 md:px-6">
                <Link href={`${base}/messages`} className="rounded-full p-1 text-fg-muted hover:text-fg md:hidden" aria-label="All conversations"><ArrowLeft className="size-4" aria-hidden /></Link>
                {other ? <Avatar profileId={other.other_profile_id ?? other.id} name={other.title} avatarKey={other.other_avatar_key} presence={other.other_presence ?? "offline"} size={40} />
                  : <span className="grid size-10 place-items-center rounded-full border border-border bg-wash text-fg-subtle">{selected.conversation.kind === "team" ? <Hash className="size-4" aria-hidden /> : <Building2 className="size-4" aria-hidden />}</span>}
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-lg leading-tight">{selected.conversation.kind === "team" ? `# ${title}` : title}</h2>
                  {other ? <p className="flex items-center gap-2 truncate text-xs text-fg-subtle"><PresenceLabel presence={other.other_presence ?? "offline"} /><span aria-hidden>·</span><span className="truncate">{other.subtitle}</span></p>
                    : <p className="truncate text-xs text-fg-subtle">{selected.conversation.people.length} people, {selected.conversation.kind === "team" ? "team channel" : "everyone in the organisation"}</p>}
                </div>
                {selected.conversation.kind !== "direct" ? <div className="hidden items-center -space-x-2 md:flex">{selected.conversation.people.slice(0, 5).map((p) => <Avatar key={p.membership_id} profileId={p.profile_id} name={p.display_name} avatarKey={p.avatar_key} size={28} className="ring-2 ring-[var(--bg)]" />)}{selected.conversation.people.length > 5 ? <span className="ml-3 text-xs text-fg-subtle">+{selected.conversation.people.length - 5}</span> : null}</div> : null}
                {other && other.other_membership_id && ctx.membership.role !== "employee" ? <Link href={`${base}/workroom/${other.other_membership_id}`} className="text-sm text-fg-muted hover:text-fg">Their day</Link> : null}
              </header>
              <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 md:px-6">
                {selected.messages.length === 0 ? <p className="py-10 text-center text-sm text-fg-muted">No messages yet. Say hello, or ask how something is going.</p> : (
                  <ol>
                    {selected.messages.map((m, i) => {
                      const prev = selected.messages[i - 1];
                      const newDay = !prev || dayKey(prev.created_at, ctx.org.timezone) !== dayKey(m.created_at, ctx.org.timezone);
                      const grouped = !newDay && !!prev && prev.sender_membership_id === m.sender_membership_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
                      return (
                        <li key={m.id}>
                          {newDay ? <p className="eyebrow my-4 flex items-center gap-3 before:h-px before:flex-1 before:bg-border-soft after:h-px after:flex-1 after:bg-border-soft">{formatLongDate(dayKey(m.created_at, ctx.org.timezone))}</p> : null}
                          <Message m={m} grouped={grouped} orgSlug={ctx.org.slug} timeZone={ctx.org.timezone} />
                        </li>
                      );
                    })}
                  </ol>
                )}
                <ScrollToLatest count={selected.messages.length} conversationId={selected.conversation.id} />
              </div>
              <Composer key={selected.conversation.id} orgSlug={ctx.org.slug} conversationId={selected.conversation.id}
                task={task ? { id: task.id, title: task.title } : null}
                prefill={task ? `How far with “${task.title}”?` : undefined}
                placeholder={selected.conversation.kind === "direct" ? `Message ${title}` : `Message ${selected.conversation.kind === "team" ? `#${title}` : "everyone"}`} />
            </>
          )}
        </section>
      </div>
    </AppShell>
  );
}

function Message({ m, grouped, orgSlug, timeZone }: { m: MessageRow; grouped: boolean; orgSlug: string; timeZone: string }) {
  const time = <time dateTime={m.created_at} title={formatDateTime(m.created_at, timeZone)}>{timeOnly(m.created_at, timeZone)}</time>;
  return (
    <MessageBubble mine={m.mine} grouped={grouped} withdrawn={!!m.deleted_at} name={m.sender_name} time={time}
      avatar={<Avatar profileId={m.sender_profile_id} name={m.sender_name} avatarKey={m.sender_avatar_key} size={32} />}
      footer={m.task_id && !m.deleted_at ? (
        <Link href={`/app/${orgSlug}/tasks/${m.task_id}`} className="chip chip-link inline-flex max-w-full items-center gap-2 px-2.5 py-1.5 text-sm">
          <span className="truncate font-medium">{m.task_title}</span>{m.task_status ? <Badge tone={TASK_STATUS_TONE[m.task_status] ?? "neutral"}>{m.task_status === "in_review" ? "Sent for check" : label(m.task_status)}</Badge> : null}
        </Link>
      ) : null}
      actions={m.mine && !m.deleted_at ? <WithdrawMessage orgSlug={orgSlug} id={m.id} /> : null}>
      {m.deleted_at ? "Message withdrawn" : m.voice_key && m.voice_seconds ? <VoiceNote src={`/api/orgs/${orgSlug}/messages/${m.id}/voice`} seconds={m.voice_seconds} mine={m.mine} /> : <span className="whitespace-pre-wrap break-words">{m.body}</span>}
    </MessageBubble>
  );
}
