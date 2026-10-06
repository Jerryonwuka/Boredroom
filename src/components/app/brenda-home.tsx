"use client";

/**
 * Brenda's page (owner decision, 5 October 2026): the first thing anyone sees in a workspace. Brenda, drawn and alive,
 * asks what you want to do today; you type or talk and she does it. Everything she does goes through the same chat,
 * permissions and confirmations as the drawer.
 *
 * v4 (owner decision, 6 October 2026): her home screen is laid out like the ElevenLabs Home. One centred column: her
 * character, small and monochrome; a greeting line (14/20, secondary); the display headline "What do you want to do
 * today?" (28/36); 20px under it the prompt pill (max 650px, r26) with its round "+" (more things to ask), the
 * microphone and the white Send; 40px under that her asks as tool tiles (a 40px r12 square with a 20px grey icon over
 * a 14/20 label). A quiet "Past chats" button opens them beside the chat (they are not a tab of their own). Then
 * underline tabs: "Your day" (stat cards and calm 64px list rows) and, for team leads and the organisation, "Team".
 * The asks and the "+" menu fill the box so the words can be edited; they never send (owner decision, 5 October 2026).
 *
 * The chat (owner decisions, 5 October 2026): from your first message the page becomes a full conversation with her,
 * at once, with no animation between the two. Her own header takes the very top of the screen (the app's top bar
 * steps aside while the chat is open, CONTRACT A in globals.css), with Back to her home screen and New chat; past
 * chats sit in a column beside the conversation (a sheet on small screens), so moving between conversations is one
 * press. The box is docked at the bottom on a solid canvas strip, so the conversation never shows through it.
 *
 * Past chats are private to the person (server/services/brenda-history.ts). The address follows what is on screen
 * (`?chat=` for a saved conversation, `?tab=history` for the chat opened on its past chats), so a reload or a link
 * comes back to the same place.
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AlarmClock, ArrowLeft, CalendarCheck, ChevronRight, CircleAlert, ClipboardCheck, Clock, FileText, History, ListOrdered, ListPlus,
  MessageSquareReply, MessagesSquare, Play, Plus, Send, Timer, UserPlus, Users,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PromptAction } from "@/components/ui/ai-prompt-box";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { ToolSquare, ToolTile, ToolTileRow } from "@/components/ui/tool-tile";
import { ListRow } from "@/components/ui/rows";
import { Tabs } from "@/components/ui/tabs";
import { StatCard } from "@/components/ui/stat-card";
import { Badge, CountPill } from "@/components/ui/badge";
import { Avatar } from "@/components/ui/avatar";
import { EmptyState } from "@/components/ui/states";
import { BrendaGlyph } from "@/components/app/brenda-glyph";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace } from "@/components/app/brenda-face";
import { BrendaComposer, BrendaMessages, DictationNotes, useBrendaChat, type BrendaChat } from "@/components/app/brenda-chat";
import { BrendaHistory } from "@/components/app/brenda-history";
import { isApiFailure } from "@/lib/api-client";
import { cn, formatDuration } from "@/lib/utils";
import type { briefing } from "@/server/services/brenda";
import type { Conversation, ConversationSummary } from "@/server/services/brenda-history";

type Brief = Awaited<ReturnType<typeof briefing>>;
export type HomeData = {
  orgSlug: string; firstName: string; role: "owner" | "hr" | "manager" | "employee";
  greeting: string; dateLabel: string; aiEnabled: boolean; brief: Brief;
  /** A request handed over by a link elsewhere (`?ask=`), placed in the box for the person to send. */
  ask?: string;
  working: { id: string; name: string; state: string | null; task: string | null; todaySeconds: number }[];
  attendance: { in: number; out: number; late: number; notIn: number } | null;
  /** The person's past chats, the most recently active first. */
  history: ConversationSummary[];
  /** The server's clock when the page rendered, to the minute (so "last active" reads the same on both sides). */
  now: number;
  /** `?tab=history`: open on the chat with its past chats showing. */
  pastChats: boolean;
  /** `?chat=`: a past chat to open straight into; null when it is not there (deleted, or someone else's). */
  chat: Conversation | null;
  /** `?chat=` named a conversation that is not there. */
  chatMissing: boolean;
};

type Ask = { icon: React.ComponentType<{ "aria-hidden"?: boolean }>; label: string; prompt: string };

/** Her asks, as tool tiles: short labels (they sit under a 40px square, 81px wide); the words they put in the box. */
const ASKS: Record<"worker" | "lead", Ask[]> = {
  worker: [
    { icon: ListOrdered, label: "Plan my day", prompt: "Arrange my tasks for today in the order I should do them, and tell me why." },
    { icon: CalendarCheck, label: "Due today", prompt: "What's waiting for me today?" },
    { icon: MessageSquareReply, label: "Follow up", prompt: "Look at my overdue tasks and help me follow up on each one." },
    { icon: FileText, label: "Write a doc", prompt: "Help me write a document about " },
    { icon: AlarmClock, label: "Remind me", prompt: "Remind me in an hour to check my messages." },
  ],
  lead: [
    { icon: Users, label: "Who's working", prompt: "Who is working right now, and on what?" },
    { icon: ClipboardCheck, label: "Week summary", prompt: "Summarise what the team got done this week." },
    { icon: MessageSquareReply, label: "Chase work", prompt: "Which assignments has nobody picked up? Help me follow up." },
    { icon: FileText, label: "Write a doc", prompt: "Help me write a document about " },
    { icon: CircleAlert, label: "Who's late", prompt: "Who is late or hasn't clocked in today?" },
  ],
};

/** The pill's "+": more things to ask, each a sentence to finish in the box. Clocking and the timer only for people who clock in. */
function moreAsks(role: HomeData["role"]): Ask[] {
  const worker = role === "employee" || role === "manager";
  return [
    ...(role !== "employee" ? [{ icon: UserPlus, label: "Assign a task", prompt: "Assign a task to " }] : []),
    { icon: ListPlus, label: "Add to my to-dos", prompt: "Add to my to-dos: " },
    ...(worker ? [{ icon: Clock, label: "Clock me in", prompt: "Clock me in." }, { icon: Play, label: "Start my timer", prompt: "Start the timer on " }] : []),
    { icon: AlarmClock, label: "Set a reminder", prompt: "Remind me to " },
    { icon: Send, label: "Send a message", prompt: "Send a message to " },
    { icon: FileText, label: "Write a document", prompt: "Help me write a document about " },
  ];
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

// Under lg, past chats are a sheet over the chat rather than a column beside it. The server renders the column.
const SMALL = "(max-width: 1023.98px)";
const subscribeSmall = (cb: () => void) => { const m = window.matchMedia(SMALL); m.addEventListener("change", cb); return () => m.removeEventListener("change", cb); };
const smallNow = () => window.matchMedia(SMALL).matches;
const smallOnServer = () => false;

/** Puts the cursor in the box inside `el`, at the end of whatever is there. */
function focusBoxIn(el: HTMLElement | null) {
  const field = el?.querySelector("textarea");
  if (!field) return;
  field.focus();
  requestAnimationFrame(() => { const n = field.value.length; field.setSelectionRange(n, n); });
}

type HomeTab = "day" | "team";

export function BrendaHome({ data }: { data: HomeData }) {
  const { role } = data;
  const lead = role !== "employee";
  const [history, setHistory] = useState(data.history);
  // Each save moves the conversation to the top of Past chats (or adds it there).
  const chat = useBrendaChat({ orgSlug: data.orgSlug, initialText: data.ask, initial: data.chat, onSaved: (c) => setHistory((cur) => [c, ...cur.filter((x) => x.id !== c.id)]) });
  const character = useRef<BrendaCharacterHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  const openOnList = data.aiEnabled && (data.pastChats || data.chatMissing);
  const [view, setView] = useState<"start" | "chat">(data.aiEnabled && (data.chat || openOnList) ? "chat" : "start");
  // The chat may stay open with no conversation in it: opened on its past chats, after New chat, or after deleting the
  // open one. Otherwise an empty chat (a dictation still being written out before the first send) shows her home screen.
  const [blank, setBlank] = useState(openOnList);
  // Small screens: past chats as a sheet over the chat.
  const [sheet, setSheet] = useState(openOnList);
  const [opening, setOpening] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(data.chatMissing ? "That chat is no longer here. It may have been deleted." : null);
  const [tab, setTab] = useState<HomeTab>("day");
  const resumeButton = useRef<HTMLButtonElement>(null);
  const pastChatsButton = useRef<HTMLButtonElement>(null);
  const base = `/app/${data.orgSlug}`;
  const hasConversation = chat.messages.length > 0 || chat.pending || !!chat.error;
  const chatting = view === "chat" && (hasConversation || blank);

  // Every move between her home screen and the chat is instant (owner decision, 5 October 2026: no animation).
  const sendFromStart = (message: string) => { setView("chat"); setBlank(false); void chat.send(message, true); };
  // Back lands the focus on the way back in: "Back to our conversation", else (the chat was empty) the Past chats
  // button, else the box. Not on the page itself.
  const back = () => {
    setView("start"); setBlank(false); setSheet(false);
    requestAnimationFrame(() => { const to = resumeButton.current ?? pastChatsButton.current; if (to) to.focus(); else focusBoxIn(box.current); });
  };
  const showPastChats = () => { setView("chat"); setBlank(true); setSheet(true); };
  const newChat = () => { chat.reset(); setBlank(true); setSheet(false); requestAnimationFrame(() => focusBoxIn(box.current)); };
  /** An ask or a "+" item: its words go in the box, to edit and send; never sent from here. */
  const fill = (prompt: string, later = false) => {
    chat.setText(prompt);
    // From a menu, after the menu has handed the focus back to its button.
    if (later) requestAnimationFrame(() => focusBoxIn(box.current)); else focusBoxIn(box.current);
  };

  /** Carries a past chat on, in place; on small screens the sheet closes and the cursor goes to the box. */
  async function openChat(id: string) {
    setListError(null); setOpening(id);
    try {
      if (await chat.load(id)) {
        setView("chat"); setBlank(true);
        if (sheet) { setSheet(false); requestAnimationFrame(() => focusBoxIn(box.current)); }
      }
    } catch (err) {
      setListError((err as Error).message);
      if ((err as { gone?: boolean }).gone) setHistory((cur) => cur.filter((x) => x.id !== id));
    } finally { setOpening((o) => (o === id ? null : o)); }
  }

  /** Deletes a past chat: out of the list at once, back in it (with a word) if the delete does not go through. Deleting the open one starts a new chat. */
  function deleteChat(c: ConversationSummary) {
    setListError(null);
    setHistory((cur) => cur.filter((x) => x.id !== c.id));
    if (c.id === chat.conversationId) setBlank(true);
    chat.remove(c.id).catch((err) => {
      setHistory((cur) => (cur.some((x) => x.id === c.id) ? cur : [...cur, c].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))));
      setListError(`“${c.title}” was not deleted: ${isApiFailure(err) ? err.error.message.replace(/\.$/, "") : "Boredroom cannot reach the server"}. Try again.`);
    });
  }

  // The address follows the screen: ?chat= while a saved conversation is open, ?tab=history while the chat is open on
  // its past chats with nothing in it yet, neither on her home screen. `?ask=` has done its job once there is a saved
  // conversation. History is replaced, not added to.
  useEffect(() => {
    const url = new URL(window.location.href);
    const p = url.searchParams;
    const open = chatting ? chat.conversationId : null;
    const list = chatting && !open && !hasConversation ? "history" : null;
    if (p.get("chat") === open && p.get("tab") === list && !(open && p.has("ask"))) return;
    p.delete("chat"); p.delete("tab");
    if (open) { p.set("chat", open); p.delete("ask"); }
    if (list) p.set("tab", list);
    window.history.replaceState(null, "", url);
  }, [chatting, chat.conversationId, hasConversation]);

  // A wink hello, and a little celebration whenever she has just done something.
  useEffect(() => { const t = setTimeout(() => character.current?.emote("wink"), 900); return () => clearTimeout(t); }, []);
  const last = chat.messages[chat.messages.length - 1];
  const didSomething = last?.role === "assistant" && (last.actions?.length ?? 0) > 0;
  useEffect(() => { if (didSomething) character.current?.emote("celebrate"); }, [didSomething, chat.messages.length]);

  // Opening the chat keeps the cursor in the box, and it returns there once she has answered (the box is disabled
  // while she works), unless you have since moved to something else, or past chats cover it (small screens, where
  // a focused box would also bring up the keyboard).
  useEffect(() => {
    const idle = !document.activeElement || document.activeElement === document.body;
    const covered = sheet && smallNow();
    if (chatting && !chat.pending && idle && !covered) focusBoxIn(box.current);
  }, [chatting, chat.pending]); // eslint-disable-line react-hooks/exhaustive-deps -- closing the sheet is not a reason to move the focus

  const more = <MoreMenu role={role} onPick={(p) => fill(p, true)} />;

  if (chatting) {
    return (
      <ChatView data={data} chat={chat} box={box} onBack={back} onNewChat={newChat} sheet={sheet} onSheet={setSheet} more={more} onAsk={(p) => fill(p)}
        history={<BrendaHistory conversations={history} now={data.now} currentId={chat.conversationId} opening={opening} error={listError}
          onOpen={(id) => void openChat(id)} onDelete={deleteChat} onStart={newChat} onClose={() => setSheet(false)} />} />
    );
  }

  const asks = ASKS[lead ? "lead" : "worker"];
  const tabs = [
    { label: "Your day", value: "day" },
    ...(lead ? [{ label: "Team", value: "team" }] : []),
  ];
  const tabLabel = tabs.find((t) => t.value === tab)?.label ?? "Your day";
  // Her character is monochrome like the rest of v4; the accent shows only while she listens (a live microphone).
  const listening = chat.state === "listening";

  return (
    <div className="mx-auto w-full max-w-[1040px] pb-16">
      <section aria-labelledby="home-ask" className="flex flex-col items-center pt-4 text-center md:pt-12">
        <BrendaCharacter ref={character} state={chat.state} size={64} interactive label="Brenda" className={cn("-mb-1.5 -mt-2", !listening && "grayscale")} />
        <p className="text-sm font-medium text-secondary">{data.greeting}, {data.firstName}. It&apos;s {data.dateLabel}.</p>
        <h1 id="home-ask" className="type-headline mt-1">What do you want to do today?</h1>

        {data.aiEnabled ? (
          <>
            <div className="mt-5 w-full max-w-[650px] text-left">
              <div ref={box}>
                <BrendaComposer chat={chat} onSend={sendFromStart} leading={more}
                  placeholder={lead ? "Ask about the team…" : "Plan my day, start a timer…"} />
              </div>
              <DictationNotes chat={chat} className="mt-2" />
            </div>
            {/* Past chats live beside the chat, not in a tab of their own (owner decision, 5 October 2026): this opens them there. */}
            <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
              {hasConversation ? (
                <button ref={resumeButton} type="button" onClick={() => setView("chat")} className={buttonVariants({ variant: "secondary", size: "sm" })}>
                  <MessagesSquare aria-hidden />Back to our conversation<CountPill count={chat.messages.length} />
                </button>
              ) : null}
              <button ref={pastChatsButton} type="button" onClick={showPastChats} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                <History aria-hidden />Past chats{history.length ? <CountPill count={history.length} /> : null}
              </button>
            </div>
            <ToolTileRow label="Ask Brenda" className="mt-10">
              {asks.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} onClick={() => fill(a.prompt)} />)}
            </ToolTileRow>
          </>
        ) : (
          <div className="card-tint mt-5 w-full max-w-[650px] px-4 py-3 text-left">
            <p className="text-sm font-medium text-foreground">Brenda isn&apos;t part of this workspace&apos;s plan yet.</p>
            <p className="mt-0.5 text-meta font-normal text-secondary">
              {role === "owner" ? <>She does the work for your people: plans their day, follows up and writes documents. <Link className="font-medium text-accent-text hover:underline" href="/app/billing">Upgrade the plan</Link></> : "Ask your organisation owner to add her."}
            </p>
          </div>
        )}
      </section>

      <section className="mt-14" aria-labelledby={tabs.length > 1 ? undefined : "home-day"}>
        {/* One section (staff) is a plain title; tabs only when there is something to switch to. */}
        {tabs.length > 1 ? <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v as HomeTab)} label="Brenda's home" /> : <h2 id="home-day" className="type-section-title mb-3.5">Your day</h2>}
        <div role={tabs.length > 1 ? "tabpanel" : undefined} aria-label={tabs.length > 1 ? tabLabel : undefined} className={tabs.length > 1 ? "pt-6" : "pt-1"}>
          {tab === "team" ? <TeamTab data={data} base={base} /> : <DayTab data={data} base={base} />}
        </div>
      </section>
    </div>
  );
}

/** The pill's round "+": a menu of more things to ask. Choosing one puts its sentence in the box. */
function MoreMenu({ role, onPick }: { role: HomeData["role"]; onPick: (prompt: string) => void }) {
  return (
    <Menu label="Ask Brenda to" trigger={<PromptAction aria-label="More things to ask Brenda"><Plus aria-hidden /></PromptAction>}>
      <MenuLabel>Ask Brenda to…</MenuLabel>
      {moreAsks(role).map((a) => <MenuItem key={a.label} icon={<a.icon aria-hidden />} onSelect={() => onPick(a.prompt)}>{a.label}</MenuItem>)}
    </Menu>
  );
}

// ---- The tabs under her box -----------------------------------------------------------------------------------------

const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" }).format(new Date(iso));

/** Stat cards in a row: two across on a phone, all of them from lg. */
function StatRow({ stats }: { stats: { label: string; value: React.ReactNode; hint?: React.ReactNode }[] }) {
  return (
    <div className={cn("grid grid-cols-2 gap-3", stats.length >= 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
      {stats.map((s) => <StatCard key={s.label} label={s.label} value={s.value} hint={s.hint} />)}
    </div>
  );
}

/** A list under a quiet label (14/20 medium, secondary) with its count; a link to the rest when there are more. */
function DayList({ title, count, children, more }: { title: string; count?: number; children: React.ReactNode; more?: { href: string; count: number } }) {
  return (
    <section aria-label={title} className="min-w-0">
      <h2 className="mb-1 flex items-center gap-2 px-2 text-sm font-medium tracking-normal text-secondary">{title}{count ? <CountPill count={count} /> : null}</h2>
      <ul>{children}</ul>
      {more && more.count > 0 ? <Link href={more.href} className={`${buttonVariants({ variant: "ghost", size: "xs" })} ml-1 mt-1`}>{plural(more.count, "more task")}<ChevronRight aria-hidden /></Link> : null}
    </section>
  );
}

const SHOW = 4;

/** Your day: the figures, then where you are now (your clock and timer) and what is waiting on you. */
function DayTab({ data, base }: { data: HomeData; base: string }) {
  const { brief, role } = data;
  const worker = role === "employee" || role === "manager";
  const c = brief.clock, t = brief.timer;
  const stats = worker
    ? [
      { label: "Open tasks", value: brief.openTasks },
      { label: "Due today", value: brief.dueToday.length },
      { label: "Overdue", value: brief.overdue.length },
      role === "manager" ? { label: "To check", value: brief.waitingForYourReview.length } : { label: "Reminders", value: brief.remindersToday.length },
    ]
    : [
      { label: "Due today", value: brief.dueToday.length },
      { label: "Overdue", value: brief.overdue.length },
      { label: "To check", value: brief.waitingForYourReview.length },
      { label: "Not picked up", value: brief.assignmentsNotPickedUp.length },
    ];
  const clockTitle = !c ? "Your clock" : !c.workingDay ? "Not a working day" : c.status === "in" ? "Clocked in" : c.status === "out" ? "Clocked out for today" : "Not clocked in yet";
  const lists = [
    brief.dueToday.length ? (
      <DayList key="due" title="Due today" count={brief.dueToday.length} more={{ href: `${base}/tasks`, count: brief.dueToday.length - SHOW }}>
        {brief.dueToday.slice(0, SHOW).map((x) => (
          <ListRow key={x.id} href={`${base}/tasks/${x.id}`} leading={<ToolSquare><CalendarCheck aria-hidden /></ToolSquare>} title={x.title}
            subtitle={<>{x.due ? <>Due at <time suppressHydrationWarning dateTime={x.due}>{timeOf(x.due)}</time></> : "Due today"}{x.progress ? `, ${x.progress}% done` : ""}</>} />
        ))}
      </DayList>
    ) : null,
    brief.overdue.length ? (
      <DayList key="overdue" title="Overdue" count={brief.overdue.length} more={{ href: `${base}/tasks`, count: brief.overdue.length - SHOW }}>
        {brief.overdue.slice(0, SHOW).map((x) => (
          <ListRow key={x.id} href={`${base}/tasks/${x.id}`} leading={<ToolSquare><CircleAlert aria-hidden /></ToolSquare>} title={x.title}
            subtitle={x.due ? <>Was due <time suppressHydrationWarning dateTime={x.due}>{dayOf(x.due)}</time></> : "Overdue"} trailing={<Badge tone="danger" dot>Overdue</Badge>} />
        ))}
      </DayList>
    ) : null,
    brief.waitingForYourReview.length ? (
      <DayList key="review" title="Waiting for your check" count={brief.waitingForYourReview.length} more={{ href: `${base}/tasks`, count: brief.waitingForYourReview.length - SHOW }}>
        {brief.waitingForYourReview.slice(0, SHOW).map((x) => (
          <ListRow key={x.taskId} href={`${base}/tasks/${x.taskId}`} leading={<ToolSquare><ClipboardCheck aria-hidden /></ToolSquare>} title={x.title} subtitle={`From ${x.from}`} trailing={<ChevronRight className="size-4" aria-hidden />} />
        ))}
      </DayList>
    ) : null,
    brief.assignmentsNotPickedUp.length ? (
      <DayList key="unpicked" title="Nobody has picked up" count={brief.assignmentsNotPickedUp.length} more={{ href: `${base}/tasks`, count: brief.assignmentsNotPickedUp.length - SHOW }}>
        {brief.assignmentsNotPickedUp.slice(0, SHOW).map((x) => (
          <ListRow key={x.id} href={`${base}/tasks/${x.id}`} leading={<ToolSquare><Users aria-hidden /></ToolSquare>} title={x.title} subtitle={`Assigned to ${x.assignee}`} trailing={<ChevronRight className="size-4" aria-hidden />} />
        ))}
      </DayList>
    ) : null,
    brief.remindersToday.length ? (
      <DayList key="reminders" title="Reminders" count={brief.remindersToday.length}>
        {brief.remindersToday.slice(0, SHOW).map((r) => (
          <ListRow key={r.id} leading={<ToolSquare><AlarmClock aria-hidden /></ToolSquare>} title={r.body} subtitle={<>At <time suppressHydrationWarning dateTime={r.at}>{timeOf(r.at)}</time></>} />
        ))}
      </DayList>
    ) : null,
  ].filter(Boolean);

  return (
    <div className="space-y-8">
      <StatRow stats={stats} />
      <div className="grid gap-x-8 gap-y-8 lg:grid-cols-2">
        {/* Everyone who clocks in sees their clock and timer here (My Day no longer shows the clock); clocking itself
            happens on the Clock in page, or by asking her. The organisation account does not clock in. */}
        {worker ? (
          <DayList title="Now">
            <ListRow href={`${base}/clock`} leading={<ToolSquare><Clock aria-hidden /></ToolSquare>} title={clockTitle}
              subtitle={c?.workingDay ? <>Working hours <span className="tabular-nums">{c.workStarts.slice(0, 5)}–{c.workEnds.slice(0, 5)}</span></> : "Open the Clock in page"}
              trailing={c?.status === "in" ? <Badge tone="success" dot>In</Badge> : c?.workingDay && c.status === "not_in" ? <Badge tone="warning" dot>Not in</Badge> : <ChevronRight className="size-4" aria-hidden />} />
            {t ? (
              <ListRow href={`${base}/tasks/${t.taskId}`} leading={<ToolSquare><Timer aria-hidden /></ToolSquare>} title={t.task}
                subtitle={t.state === "running" ? "Your timer is running" : "Your timer is paused"} trailing={<Badge tone={t.state === "running" ? "success" : "warning"} dot>{t.state === "running" ? "Running" : "Paused"}</Badge>} />
            ) : (
              <ListRow leading={<ToolSquare><Timer aria-hidden /></ToolSquare>} title="No timer running"
                subtitle={brief.openTasks ? `${plural(brief.openTasks, "open task")}. Ask me which to start.` : "No open tasks. Tell me what you're working on."} />
            )}
          </DayList>
        ) : null}
        {lists}
      </div>
      {!lists.length ? <EmptyState compact icon={BrendaGlyph} title="All clear" description="Nothing is waiting on you right now. Ask me for anything you need." /> : null}
    </div>
  );
}

/** Team, for team leads and the organisation: who is working now, and (for the organisation) today's attendance. */
function TeamTab({ data, base }: { data: HomeData; base: string }) {
  const running = data.working.filter((w) => w.state === "running");
  const paused = data.working.filter((w) => w.state === "paused");
  const a = data.attendance;
  const stats = a
    ? [
      { label: "Working now", value: running.length, hint: paused.length ? `${paused.length} paused` : undefined },
      { label: "Clocked in", value: a.in + a.out },
      { label: "Late", value: a.late },
      { label: "Not in yet", value: a.notIn },
    ]
    : [
      { label: "Working now", value: running.length },
      { label: "Paused", value: paused.length },
      { label: "In your team", value: data.working.length },
    ];
  const people = [...running, ...paused];
  return (
    <div className="space-y-8">
      <StatRow stats={stats} />
      <section aria-label="Working now" className="min-w-0">
        <div className="mb-1 flex items-center justify-between gap-3 px-2">
          <h2 className="flex items-center gap-2 text-sm font-medium tracking-normal text-secondary">Working now<CountPill count={people.length} /></h2>
          <Link href={`${base}/workroom`} className={buttonVariants({ variant: "ghost", size: "xs" })}>Open the workroom<ChevronRight aria-hidden /></Link>
        </div>
        {people.length ? (
          <ul className="grid gap-x-8 lg:grid-cols-2">
            {people.slice(0, 8).map((w) => (
              <ListRow key={w.id} leading={<Avatar profileId={w.id} name={w.name} size={40} />} title={w.name}
                subtitle={`${w.state === "running" ? "Working on" : "Paused on"} ${w.task ?? "a task"}`}
                trailing={<><span className="hidden tabular-nums sm:inline">{formatDuration(w.todaySeconds)}</span><Badge tone={w.state === "running" ? "success" : "warning"} dot>{w.state === "running" ? "Working" : "Paused"}</Badge></>} />
            ))}
          </ul>
        ) : <EmptyState compact icon={Users} title="Nobody has a timer running" description="When someone starts work on a task, they show up here." />}
      </section>
    </div>
  );
}

// ---- The chat -----------------------------------------------------------------------------------------------------

/**
 * The full chat, the whole height of the screen beside the app's sidebar (CONTRACT A: while it is open,
 * `<html data-brenda-chat>` hides the app's top bar and lets the page's main column reach every edge), less any banner
 * above the shell (billing, impersonation, maintenance), whose height the shell keeps in `--shell-banners`, so the
 * docked box stays on screen. At the top, Brenda's own 50px header; below it, past chats on the left (a sheet under lg,
 * where the app's sidebar leaves too little room for both) and the conversation in a readable centred column, which
 * scrolls inside itself above the docked box.
 */
function ChatView({ data, chat, box, onBack, onNewChat, history, sheet, onSheet, more, onAsk }: {
  data: HomeData; chat: BrendaChat; box: React.RefObject<HTMLDivElement | null>;
  onBack: () => void; onNewChat: () => void; history: React.ReactNode; sheet: boolean; onSheet: (open: boolean) => void;
  more: React.ReactNode; onAsk: (prompt: string) => void;
}) {
  const scroller = useRef<HTMLDivElement>(null);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
  const status = chat.pending ? "Working on it…" : chat.waitingAt >= 0 ? "Waiting for your answer" : chat.error ? "Something went wrong" : chat.dictation.listening ? "Listening" : "Here for you";
  const dot = chat.pending || chat.dictation.listening ? "bg-accent" : chat.error ? "bg-danger" : chat.waitingAt >= 0 ? "bg-warning" : "bg-success";
  const empty = chat.messages.length === 0 && !chat.pending && !chat.error;
  // Past chats open as a sheet over the chat (small screens): a modal one.
  const small = useSyncExternalStore(subscribeSmall, smallNow, smallOnServer);
  const modal = sheet && small;

  // CONTRACT A: the app's top bar steps aside while the chat is open, and comes back with her home screen.
  useEffect(() => {
    const root = document.documentElement;
    root.dataset.brendaChat = "";
    return () => { delete root.dataset.brendaChat; };
  }, []);

  // The newest message stays in view. Opening the chat, or another conversation, lands on its end at once; a message
  // arriving while you read scrolls to it smoothly (at once too with reduced motion).
  const shownFirst = useRef<unknown>(undefined);
  useEffect(() => {
    const el = scroller.current; if (!el) return;
    const same = shownFirst.current === chat.messages[0];
    shownFirst.current = chat.messages[0];
    const still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ top: el.scrollHeight, behavior: same && !still ? "smooth" : "instant" });
  }, [chat.messages, chat.pending]);

  // Opened on past chats from her home screen on a small screen, where they cover the chat: the focus starts in the
  // sheet (on its first chat, not the search, so a phone's keyboard stays down) instead of being left on the page.
  useEffect(() => {
    if (!sheet || !smallNow()) return;
    const p = panel.current;
    (p?.querySelector<HTMLElement>("[data-chat-row]") ?? p?.querySelector<HTMLElement>("button"))?.focus();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- only how the chat opened; the sheet button moves the focus after that

  // The sheet is modal: while it is open, everything else on the page is inert (the conversation and the header behind
  // it, the app around them; the dimmed backdrop, which closes it, aside), so the focus and a screen reader stay in it.
  // However it closes (Escape, its close button, the backdrop), the focus goes back to the button that opens it, unless
  // closing it moved the focus on (opening a chat puts it in the box, New chat too).
  useEffect(() => {
    if (!modal) return;
    const sheetEl = panel.current, opener = sheetButton.current;
    const made: Element[] = [];
    for (let el: Element | null = sheetEl; el && el !== document.body; el = el.parentElement) {
      for (const other of el.parentElement?.children ?? []) {
        if (other === el || other === backdrop.current || other.hasAttribute("inert")) continue;
        other.setAttribute("inert", "");
        made.push(other);
      }
    }
    return () => {
      for (const m of made) m.removeAttribute("inert");
      requestAnimationFrame(() => {
        const at = document.activeElement;
        if (!at || at === document.body || sheetEl?.contains(at)) opener?.focus();
      });
    };
  }, [modal]);

  // Escape closes the sheet. A dialog open over it (Delete this chat?) and the search field (which clears first) take
  // Escape for themselves.
  useEffect(() => {
    if (!sheet) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape" || e.defaultPrevented || document.querySelector("dialog[open]")) return;
      onSheet(false);
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [sheet, onSheet]);
  const openSheet = () => { onSheet(true); requestAnimationFrame(() => panel.current?.querySelector<HTMLElement>("input, [data-chat-row], button")?.focus()); };

  return (
    <div data-brenda-chat-view className="flex h-[calc(100dvh-var(--shell-banners,0px))] min-h-0 flex-col bg-background">
      <header className="flex h-[50px] shrink-0 items-center gap-2 border-b border-border px-3">
        <IconButton aria-label="Back to Brenda's home" data-tip="Back" onClick={onBack}><ArrowLeft aria-hidden /></IconButton>
        <BrendaFace size="md" mood={chat.look.mood} interactive className="ml-1" />
        <div className="ml-1 min-w-0 flex-1">
          <h1 className="font-sans text-sm font-semibold tracking-normal text-foreground">Brenda</h1>
          <p role="status" className="flex items-center gap-1.5 truncate text-xs font-normal text-secondary">
            <span className={cn("size-1.5 shrink-0 rounded-full", dot)} aria-hidden />{status}
          </p>
        </div>
        <IconButton ref={sheetButton} className="lg:hidden" aria-label="Past chats" aria-expanded={sheet} aria-controls="brenda-past-chats" onClick={() => (sheet ? onSheet(false) : openSheet())}>
          <History aria-hidden />
        </IconButton>
        <button type="button" onClick={onNewChat} className={buttonVariants({ variant: "secondary", size: "sm" })}><Plus aria-hidden />New chat</button>
      </header>

      <div className="relative flex min-h-0 flex-1">
        {sheet ? <button ref={backdrop} type="button" aria-label="Close past chats" tabIndex={-1} className="fixed inset-0 z-[var(--z-overlay)] bg-overlay lg:hidden" onClick={() => onSheet(false)} /> : null}
        {/* Under lg a sheet that slides in from the left, modal while open; from lg a quiet 256px column in the page. */}
        <aside ref={panel} id="brenda-past-chats" aria-label="Past chats" role={modal ? "dialog" : undefined} aria-modal={modal || undefined} data-refresh-safe
          className={cn("fixed inset-y-0 left-0 z-[var(--z-dialog)] w-[min(20rem,88vw)] border-r border-border bg-background shadow-sheet transition-[translate,visibility] duration-[var(--duration-sheet)] ease-[var(--ease-out)]",
            sheet ? "visible translate-x-0" : "invisible -translate-x-full",
            "lg:visible lg:static lg:z-auto lg:w-64 lg:shrink-0 lg:translate-x-0 lg:shadow-none lg:transition-none")}>
          {history}
        </aside>

        <section aria-label="Conversation with Brenda" className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className={cn("mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-8", !empty && "space-y-6")} aria-live="polite">
              {empty ? <EmptyChat chat={chat} firstName={data.firstName} asks={ASKS[data.role === "employee" ? "worker" : "lead"]} onAsk={onAsk} /> : <BrendaMessages chat={chat} size="lg" />}
            </div>
          </div>
          {/* Docked on a solid strip of the canvas with a hairline above: the conversation scrolls above it and never shows through. */}
          <div className="shrink-0 border-t border-border bg-background px-5 pb-4 pt-3 md:pb-5">
            <div ref={box} className="mx-auto max-w-3xl">
              <BrendaComposer chat={chat} leading={more} placeholder={empty ? `What do you need, ${data.firstName}?` : `Reply to Brenda, ${data.firstName}…`} />
              <p className="mt-2 text-center text-xs font-normal text-subtle">Brenda asks before anything that lands on someone else.</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** A new chat, before the first message: her face, the question, and her asks as tool tiles, which fill the box. */
function EmptyChat({ chat, firstName, asks, onAsk }: { chat: BrendaChat; firstName: string; asks: Ask[]; onAsk: (prompt: string) => void }) {
  return (
    <div className="my-auto flex flex-col items-center py-10 text-center">
      <BrendaFace size="lg" mood={chat.look.mood} />
      <h2 className="type-headline mt-5">What do you need, {firstName}?</h2>
      <p className="mt-1 max-w-md text-sm font-normal text-secondary">Ask me something new, or carry on with one of your past chats.</p>
      <ToolTileRow label="Ask Brenda" className="mt-10">
        {asks.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} onClick={() => onAsk(a.prompt)} />)}
      </ToolTileRow>
      {/* Before the first message there is no thread to carry dictation's notice or error (a blocked microphone). */}
      <DictationNotes chat={chat} className="mt-6 w-full max-w-md text-left" />
    </div>
  );
}
