import Link from "next/link";
import { redirect } from "next/navigation";
import { Hash, Building2, ArrowLeft } from "lucide-react";
import { workspacePage } from "@/server/lib/workspace-page";
import { AppShell } from "@/components/app/shell";
import { PageHeader } from "@/components/ui/card";
import { Badge, TASK_STATUS_TONE, label } from "@/components/ui/badge";
import { EmptyState } from "@/components/ui/states";
import { Composer, NewMessage, ScrollToLatest, WithdrawMessage } from "@/components/app/messages";
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

/** Messages: direct threads with anyone in the organisation, a channel per team, and Everyone. */
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
  // The list was read before the thread was opened; the open thread has no unread messages any more.
  const clear = (c: ConversationSummary) => (selected && c.id === selected.conversation.id ? { ...c, unread: 0 } : c);
  const channels = box.channels.map(clear);
  const direct = box.direct.map(clear);
  // Opening a thread marks it read; the sidebar badge must reflect that on this same render.
  const counts = selected ? await navCounts(ctx) : countsBefore;
  const task = sp.task && selected ? await visibleTask(ctx, sp.task) : null;
  const title = selected ? selected.conversation.title : null;

  const Item = ({ c }: { c: ConversationSummary }) => {
    const active = selected?.conversation.id === c.id;
    const Icon = c.kind === "organisation" ? Building2 : c.kind === "team" ? Hash : null;
    return (
      <li>
        <Link href={`${base}/messages?c=${c.id}`} aria-current={active ? "page" : undefined}
          className={cn("flex items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-2 transition-colors duration-[var(--duration-fast)] hover:bg-white/[0.05]", active && "bg-white/[0.08] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]")}>
          {Icon ? <Icon className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-subtle")} aria-hidden /> : <span aria-hidden className={cn("flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-bold", active ? "bg-accent text-accent-fg" : "bg-surface text-fg-muted")}>{initials(c.title)}</span>}
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
    <AppShell ctx={ctx} counts={counts} teams={teams}>
      <PageHeader icon="chat" title="Messages" description={`Message anyone at ${ctx.org.name}, in your team or not. Ask how far a task is, share a link, sort something out.`} actions={<NewMessage orgSlug={ctx.org.slug} people={people} />} />
      <div className="tile grid min-h-[60dvh] overflow-hidden p-0 md:h-[calc(100dvh-14rem)] md:grid-cols-[18rem_1fr]">
        <aside aria-label="Conversations" className={cn("flex-col overflow-y-auto border-border-soft p-2 md:flex md:border-r", selected ? "hidden" : "flex")}>
          <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-fg-subtle">Channels</p>
          <ul className="space-y-0.5">{channels.map((c) => <Item key={c.id} c={c} />)}</ul>
          <p className="px-2.5 pb-1 pt-4 text-xs font-medium text-fg-subtle">People</p>
          {direct.length === 0 ? <p className="px-2.5 py-2 text-xs text-fg-subtle">No direct threads yet. Use “New message” to start one.</p> : <ul className="space-y-0.5">{direct.map((c) => <Item key={c.id} c={c} />)}</ul>}
        </aside>
        <section aria-label={title ? `Conversation with ${title}` : "Conversation"} className={cn("min-w-0 flex-col md:flex", selected ? "flex" : "hidden")}>
          {!selected ? (
            <div className="flex flex-1 items-center justify-center p-6">
              <EmptyState icon3d="chat" className="border-0 bg-transparent shadow-none" title="Pick a conversation" description="Choose a channel or a person on the left, or use “New message” above to start one." />
            </div>
          ) : (
            <>
              <header className="flex items-center gap-3 border-b border-border-soft px-4 py-3">
                <Link href={`${base}/messages`} className="rounded-full p-1 text-fg-muted hover:text-fg md:hidden" aria-label="All conversations"><ArrowLeft className="size-4" aria-hidden /></Link>
                <div className="min-w-0 flex-1">
                  <h2 className="truncate font-display text-lg leading-tight">{selected.conversation.kind === "team" ? `# ${title}` : title}</h2>
                  <p className="truncate text-xs text-fg-subtle">{selected.conversation.kind === "direct" ? selected.conversation.subtitle : `${selected.conversation.people.length} people, ${selected.conversation.kind === "team" ? "team channel" : "everyone in the organisation"}`}</p>
                </div>
                {selected.conversation.kind === "direct" && selected.conversation.other_membership_id && ctx.membership.role !== "employee" ? <Link href={`${base}/workroom/${selected.conversation.other_membership_id}`} className="text-sm text-fg-muted hover:text-fg">Their day</Link> : null}
              </header>
              <div className="flex-1 overflow-y-auto px-4 py-3">
                {selected.messages.length === 0 ? <p className="py-10 text-center text-sm text-fg-muted">No messages yet. Say hello, or ask how something is going.</p> : (
                  <ol className="space-y-1">
                    {selected.messages.map((m, i) => {
                      const prev = selected.messages[i - 1];
                      const newDay = !prev || dayKey(prev.created_at, ctx.org.timezone) !== dayKey(m.created_at, ctx.org.timezone);
                      const grouped = !newDay && prev && prev.sender_membership_id === m.sender_membership_id && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60_000;
                      return (
                        <li key={m.id}>
                          {newDay ? <p className="my-3 flex items-center gap-3 text-xs text-fg-subtle before:h-px before:flex-1 before:bg-border-soft after:h-px after:flex-1 after:bg-border-soft">{formatLongDate(dayKey(m.created_at, ctx.org.timezone))}</p> : null}
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

function initials(name: string) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((s) => s[0]?.toUpperCase() ?? "").join("") || "?";
}

function Message({ m, grouped, orgSlug, timeZone }: { m: MessageRow; grouped: boolean; orgSlug: string; timeZone: string }) {
  return (
    <div className={cn("group -mx-2 rounded-[var(--radius-sm)] px-2 transition-colors duration-[var(--duration-fast)] hover:bg-surface", grouped ? "py-0.5" : "pt-3 pb-0.5")}>
      {!grouped ? <p className="flex items-baseline gap-2 text-sm"><span className={cn("font-semibold", m.mine && "text-accent")}>{m.mine ? "You" : m.sender_name}</span><time dateTime={m.created_at} title={formatDateTime(m.created_at, timeZone)} className="text-[11px] text-fg-subtle">{timeOnly(m.created_at, timeZone)}</time></p> : null}
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          {m.deleted_at ? <p className="text-sm italic text-fg-subtle">Message withdrawn</p> : <p className="whitespace-pre-wrap break-words text-[15px] leading-relaxed">{m.body}</p>}
          {m.task_id && !m.deleted_at ? (
            <Link href={`/app/${orgSlug}/tasks/${m.task_id}`} className="chip chip-link mt-1 inline-flex max-w-full items-center gap-2 px-2.5 py-1.5 text-sm">
              <span className="truncate font-medium">{m.task_title}</span>{m.task_status ? <Badge tone={TASK_STATUS_TONE[m.task_status] ?? "neutral"}>{m.task_status === "in_review" ? "Sent for check" : label(m.task_status)}</Badge> : null}
            </Link>
          ) : null}
        </div>
        {m.mine && !m.deleted_at ? <WithdrawMessage orgSlug={orgSlug} id={m.id} className="opacity-0 transition-opacity duration-[var(--duration-fast)] focus-visible:opacity-100 group-hover:opacity-100" /> : null}
      </div>
    </div>
  );
}
