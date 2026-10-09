"use client";

/**
 * Brenda's page (owner decision, 5 October 2026): the first thing anyone sees in a workspace. Brenda, drawn and alive,
 * asks what you want to do today; you type or talk and she does it. Everything she does goes through the same chat,
 * permissions and confirmations as the drawer.
 *
 * Her home screen (owner decision, 7 October 2026: "I want the Brenda tab to look just like this, but instead of the
 * purple gradient let it be our orange. Our suggestive texts can still be there", after a reference AI chat home): one
 * large rounded panel filling the screen under the top bar, near-black at its edges warming to orange towards the upper
 * middle (white with a peach glow in light; the one owner-approved gradient, globals.css "Her home"). Inside it: a row of
 * small pills (her status and which engine answers on the left; Back to our conversation, Past chats and, for the
 * organisation, Brenda settings on the right); her live character floating in a glowing orange orb, the greeting and
 * the display headline "What do you want to do today?"; then, anchored to the bottom, her quick asks as chips, her hero
 * box (PromptInputBox variant="hero": her glyph, room for a few lines, "More asks" on the left of its bottom row, the
 * microphone and the orange Send on the right) and three action cards. Nothing sits under the panel any more: "Your
 * day" and "Team" moved to My Day, and for owners and HR to the Dashboard (owner request, 7 October 2026;
 * components/app/your-day). The chips, the cards and the "More asks" menu fill the box so the words can be edited;
 * they never send (owner decision, 5 October 2026).
 *
 * The chat (owner decisions, 5 October 2026): from your first message the page becomes a full conversation with her,
 * at once, with no animation between the two. Her own header takes the very top of the screen (the app's top bar
 * steps aside while the chat is open, CONTRACT A in globals.css), with Back to her home screen and New chat; past
 * chats sit in a column beside the conversation (a sheet on small screens), so moving between conversations is one
 * press. The box (the hero box in its small, solid size, so both screens feel the same) is docked at the bottom on a
 * solid canvas strip, so the conversation never shows through it.
 *
 * Past chats are private to the person (server/services/brenda-history.ts). The address follows what is on screen
 * (`?chat=` for a saved conversation, `?tab=history` for the chat opened on its past chats), so a reload or a link
 * comes back to the same place.
 *
 * Her icons are animated (owner request, 7 October 2026; components/ui/animated-icons): the quick asks, the action
 * cards, the top pills, "More asks" and its menu, the tool tiles and the chat header's buttons play their icon while
 * hovered or focused from the keyboard, never on a loop and not under reduced motion.
 *
 * Named after the person's own assistant (owner decision, 7 October 2026: personal assistants): the status pill, the box,
 * "More asks", the chat's header, its notes and its aria-labels use the name they chose (`useAssistant`), and her drawn
 * character and faces take their look from the same profile. The plan gate and the "Brenda settings" pill stay product
 * text.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): the chat reads replies aloud as the person chose, with Listen on
 * each reply (brenda-chat). Back to her home screen and New chat stop her; leaving the page does too (the chat goes
 * away). While she speaks her drawn character and every face of hers talk (brenda-character, brenda-face).
 *
 * Catching up (owner decision, 8 October 2026: personal assistants, phase 3): "What did I miss?" is the first quick ask
 * for everyone and "Catch me up on messages" is in "More asks"; like every ask they only fill the box. "What Max did"
 * (/home/activity: everything the person's assistant did or read for them) is a pill in the home screen's top row,
 * between Past chats and Brenda settings, and an icon link in the chat's header right after Past chats, at every width.
 *
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4): a "Follow-ups" pill in
 * the top row after "What Max did" (with an orange count of the asks waiting for the person, when any; it opens "Asked
 * about you" then, else "You asked"), the same icon link in the chat's header, and "Follow up with someone" in "More
 * asks". When someone's assistant is waiting for the person's reply, "Waiting for you" sits inside her panel above the
 * quick asks (two cards at most, then "See all"), never in the chat. All hidden until migration 0039 is applied.
 *
 * Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6): the pill becomes
 * "Between assistants" (the same icon), with an orange count of everything waiting for the person (follow-up asks,
 * requests to accept, messages and replies not yet seen), and opens the inbox (/home/assistants); the chat header's
 * icon link goes there too. "Waiting for you" in her panel shows asks first, then requests and messages as compact
 * rows that keep Accept/Decline or "Mark as seen"/"Reply" under the row (assistant-waiting), two at most, then "See
 * all {n}". "Pass a message on" joins "More asks". The items show once migration 0043 is applied; the asks as before.
 *
 * The morning opener (owner decision, 8 October 2026: phase 7a, "Brenda keeps the loops closed"): on the person's first
 * visit of the day the quick-ask chips give way to "Here's where things stand": the counts that matter this morning as a
 * list of compact links (requests waiting, overdue tasks, answers to their follow-ups, messages from other assistants,
 * reviews for leads; only those above 0, and "not available" in grey for one that could not be read, never 0), or one
 * calm line on a quiet day, then 3 to 6 one-press actions in the chips' own look, chosen for those counts (a link opens
 * its page; an ask fills the box and never sends, as every ask here). After it has been on screen for a second it counts
 * as seen (POST /brenda/opener/seen, and a key in this browser), so later visits that day show the usual chips. Before
 * migration 0046 the server cannot tell a first visit (`firstVisit: null`): this browser's key decides. No orange of its
 * own: the panel keeps its glow, and the box its Send.
 *
 * Loose ends and commitments (owner decision, 8 October 2026: phase 7b, "Brenda keeps the loops closed"): "Waiting for
 * you" also holds "blocked on you" questions, commitments the workspace's assistant noted for the person and open asks
 * (compact rows with their buttons under the row), counted in the "Between assistants" pill and the chat header's dot.
 * After it, a "Loose ends" block (loose-ends-list `LooseEndsPanel`): the person's three newest open loose ends, each a
 * row with the headline, where and when, the due date and a menu of its actions (a to-do always asks first, in a sheet),
 * then "See all {n}"; with none, one line and "Look for loose ends". Private to the person. Hidden before migration 0048.
 */
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import {
  AnimatedActivity, AnimatedAlarmClock, AnimatedArrowLeft, AnimatedCalendarCheck, AnimatedCircleAlert, AnimatedClipboardCheck, AnimatedClock, AnimatedFileText,
  AnimatedHistory, AnimatedInbox, AnimatedListOrdered, AnimatedListPlus, AnimatedMessageSquare, AnimatedMessageSquareReply, AnimatedMessagesSquare, AnimatedPlay, AnimatedPlus, AnimatedSend,
  AnimatedSettings, AnimatedTimer, AnimatedUserPlus, AnimatedUsers,
} from "@/components/ui/animated-icons";
import { buttonVariants } from "@/components/ui/button";
import { IconButton, ICON_BUTTON } from "@/components/ui/icon-button";
import { PromptTextAction } from "@/components/ui/ai-prompt-box";
import { Menu, MenuItem, MenuLabel } from "@/components/ui/menu";
import { ToolTile, ToolTileRow } from "@/components/ui/tool-tile";
import { CountPill } from "@/components/ui/badge";
import { StatusDot, type StatusTone } from "@/components/ui/status-dot";
import { BrendaCharacter, type BrendaCharacterHandle } from "@/components/app/brenda-character";
import { BrendaFace } from "@/components/app/brenda-face";
import { BrendaComposer, BrendaMessages, DictationNotes, useBrendaChat, type BrendaChat } from "@/components/app/brenda-chat";
import { BrendaHistory } from "@/components/app/brenda-history";
import { useAssistant } from "@/components/app/assistant-context";
import { ACT_WORDS } from "@/lib/act-mode";
import { AssistantWaiting } from "@/components/app/assistant-waiting";
import { api, isApiFailure } from "@/lib/api-client";
import type { FollowUpView } from "@/lib/follow-ups";
import { OPENER_WORDS, type Opener, type OpenerAction, type OpenerCount, type OpenerIcon } from "@/lib/opener";
import type { AssistantItemView } from "@/lib/assistant-items";
import type { LooseEndList, LoopInboxItem } from "@/lib/commitments";
import { LooseEndsPanel } from "@/components/app/loose-ends-list";
import type { Person } from "@/components/app/loose-end-actions";
import { cn } from "@/lib/utils";
import type { Conversation, ConversationSummary } from "@/server/services/brenda-history";

export type HomeData = {
  orgSlug: string; firstName: string; role: "owner" | "hr" | "manager" | "employee";
  /** The person's membership here: this browser's opener mark is theirs, not the next person's to sign in on it. */
  memberId: string;
  greeting: string; dateLabel: string; aiEnabled: boolean;
  /** Her engine: Claude when the organisation's assistant is connected (its own key or the server's), else the built-in helper. */
  assistantConfigured: boolean;
  /** A request handed over by a link elsewhere (`?ask=`), placed in the box for the person to send. */
  ask?: string;
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
  /** The organisation's time zone (the times on follow-ups). */
  timeZone: string;
  /** Follow-ups between assistants (phase 4): migration 0039 is applied. */
  followUpsReady: boolean;
  /** Other people's assistants waiting for this person's reply, the nearest deadline first (none before 0039). */
  waiting: FollowUpView[];
  /** Assistants talk to each other (phase 6): migration 0043 is applied. */
  itemsReady: boolean;
  /** Requests, unseen messages and replies other people's assistants brought this person (none before 0043). */
  items: AssistantItemView[];
  /**
   * The morning opener (phase 7a): on the first visit of the day, in place of the quick asks; null on later visits (or
   * when it could not be read). `firstVisit: null`: the server could not tell (before 0046), this browser decides.
   */
  opener?: Opener | null;
  /** Phase 7b: the person's open loose ends (three at most, with the open count); null before 0048 or when unread. */
  looseEnds?: LooseEndList | null;
  /** Phase 7b: blocks on the person, commitments noted for them and open asks ([] before 0048). */
  loops?: LoopInboxItem[];
  /** Phase 7b: who a loose end can be handed to (only read when one on screen offers it). */
  handOverPeople?: Person[];
};

type Ask = { icon: React.ComponentType<{ "aria-hidden"?: boolean }>; label: string; prompt: string };

/** Her asks in a new chat, as tool tiles: short labels (they sit under a 40px square, 81px wide); the words they put in the box. */
const ASKS: Record<"worker" | "lead", Ask[]> = {
  worker: [
    { icon: AnimatedListOrdered, label: "Plan my day", prompt: "Arrange my tasks for today in the order I should do them, and tell me why." },
    { icon: AnimatedCalendarCheck, label: "Due today", prompt: "What's waiting for me today?" },
    { icon: AnimatedMessageSquareReply, label: "Follow up", prompt: "Look at my overdue tasks and help me follow up on each one." },
    { icon: AnimatedFileText, label: "Write a doc", prompt: "Help me write a document about " },
    { icon: AnimatedAlarmClock, label: "Remind me", prompt: "Remind me in an hour to check my messages." },
  ],
  lead: [
    { icon: AnimatedUsers, label: "Who's working", prompt: "Who is working right now, and on what?" },
    { icon: AnimatedClipboardCheck, label: "Week summary", prompt: "Summarise what the team got done this week." },
    { icon: AnimatedMessageSquareReply, label: "Chase work", prompt: "Which assignments has nobody picked up? Help me follow up." },
    { icon: AnimatedFileText, label: "Write a doc", prompt: "Help me write a document about " },
    { icon: AnimatedCircleAlert, label: "Who's late", prompt: "Who is late or hasn't clocked in today?" },
  ],
};

/** The catch-up ask, first among the quick asks for everyone (owner decision, 8 October 2026: personal assistants, phase 3). */
const CATCH_UP: Ask = { icon: AnimatedInbox, label: "What did I miss?", prompt: "What did I miss in Messages? Catch me up." };

/** Her quick asks on her home screen: chips above the box (the label, then a small icon). Each fills the box, never sends. Four wrap at 400px. */
const QUICK: Record<"worker" | "lead", Ask[]> = {
  worker: [
    CATCH_UP,
    { icon: AnimatedCalendarCheck, label: "What's due today?", prompt: "What's waiting for me today?" },
    { icon: AnimatedAlarmClock, label: "Set a reminder", prompt: "Remind me to " },
    { icon: AnimatedTimer, label: "Start a timer", prompt: "Start the timer on " },
  ],
  lead: [
    CATCH_UP,
    { icon: AnimatedUsers, label: "Who's working?", prompt: "Who is working right now, and on what?" },
    { icon: AnimatedCircleAlert, label: "Who's late?", prompt: "Who is late or hasn't clocked in today?" },
    { icon: AnimatedUserPlus, label: "Assign a task", prompt: "Assign a task to " },
  ],
};

type Card = Ask & { description: string; action: string };

/** The three action cards under her box: a title, one line on what she does, and the small pill's word. They fill the box too. */
const CARDS: Record<"worker" | "lead", Card[]> = {
  worker: [
    { icon: AnimatedListOrdered, label: "Plan my day", description: "Today's tasks in the order to do them.", action: "Plan it", prompt: "Arrange my tasks for today in the order I should do them, and tell me why." },
    { icon: AnimatedFileText, label: "Write a doc", description: "A brief, notes or a how-to, drafted with you.", action: "Draft it", prompt: "Help me write a document about " },
    { icon: AnimatedMessageSquareReply, label: "Follow up on overdue work", description: "Chase what's late, one task at a time.", action: "Follow up", prompt: "Look at my overdue tasks and help me follow up on each one." },
  ],
  lead: [
    { icon: AnimatedClipboardCheck, label: "Week summary", description: "What the team got done this week.", action: "Summarise", prompt: "Summarise what the team got done this week." },
    { icon: AnimatedMessageSquareReply, label: "Chase work", description: "Assignments nobody has picked up yet.", action: "Chase it", prompt: "Which assignments has nobody picked up? Help me follow up." },
    { icon: AnimatedFileText, label: "Write a doc", description: "A brief, a policy or notes, drafted with you.", action: "Draft it", prompt: "Help me write a document about " },
  ],
};

/** "More asks" in her box: more things to ask, each a sentence to finish in the box. Clocking and the timer only for people who clock in. */
function moreAsks(role: HomeData["role"], followUps: boolean, talk: boolean): Ask[] {
  const worker = role === "employee" || role === "manager";
  return [
    ...(role !== "employee" ? [{ icon: AnimatedUserPlus, label: "Assign a task", prompt: "Assign a task to " }] : []),
    { icon: AnimatedListPlus, label: "Add to my to-dos", prompt: "Add to my to-dos: " },
    ...(worker ? [{ icon: AnimatedClock, label: "Clock me in", prompt: "Clock me in." }, { icon: AnimatedPlay, label: "Start my timer", prompt: "Start the timer on " }] : []),
    { icon: AnimatedAlarmClock, label: "Set a reminder", prompt: "Remind me to " },
    // Phase 7a (owner decision, 8 October 2026): a routine of her own, set up from chat behind one Confirm.
    { icon: AnimatedCalendarCheck, label: "Set up a routine", prompt: "Every Friday at 4pm, send me what's still owed" },
    { icon: AnimatedSend, label: "Send a message", prompt: "Send a message to " },
    // Phase 4: ask someone's assistant how their work is going, instead of asking them.
    ...(followUps ? [{ icon: AnimatedMessageSquareReply, label: "Follow up with someone", prompt: "Follow up with " }] : []),
    // Phase 6: pass something on to someone's assistant, which delivers it as the person's own words.
    ...(talk ? [{ icon: AnimatedMessageSquare, label: "Pass a message on", prompt: "Tell " }] : []),
    { icon: AnimatedInbox, label: "Catch me up on messages", prompt: "Catch me up on my messages." },
    { icon: AnimatedFileText, label: "Write a document", prompt: "Help me write a document about " },
  ];
}

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

// ---- The morning opener (phase 7a) -----------------------------------------------------------------------------------

/** The opener's icons, as their animated twins (they play while their chip is hovered or focused). */
const OPENER_ICONS: Record<OpenerIcon, Ask["icon"]> = {
  inbox: AnimatedInbox, alert: AnimatedCircleAlert, reply: AnimatedMessageSquareReply, message: AnimatedMessageSquare,
  clipboard: AnimatedClipboardCheck, list: AnimatedListOrdered, users: AnimatedUsers, calendar: AnimatedCalendarCheck,
};

/**
 * This browser's mark that the opener was shown on a day (the fallback before 0046, and set alongside the server's).
 * Per person: two people signing in on one browser the same day each get their own (review, 8 October 2026).
 */
const openerKey = (slug: string, who: string, localDate: string) => `brenda-opener:${slug}:${who}:${localDate}`;
/**
 * Whether this browser had shown the day's opener before this visit, read once per visit (so the mark this visit sets
 * does not take the opener away while it is on screen); forgotten when her home goes, so the next visit reads it again.
 */
const shownBefore = new Map<string, boolean>();
function openerShownBefore(key: string): boolean {
  if (!shownBefore.has(key)) {
    let v = false;
    try { v = localStorage.getItem(key) !== null; } catch { /* blocked storage: shown */ }
    shownBefore.set(key, v);
  }
  return shownBefore.get(key) ?? false;
}
const noSubscribe = () => () => {};
/** The opener marks already sent from this page (one per day, whatever remounts). */
const markedOpeners = new Set<string>();

/** Marks the day's opener seen: in this browser, and on the server (which refuses it while someone is signed in as the person, 403, and before 0046, 503). */
function markOpenerSeen(slug: string, who: string, localDate: string) {
  const key = openerKey(slug, who, localDate);
  if (markedOpeners.has(key)) return;
  markedOpeners.add(key);
  shownBefore.set(key, false); // it stays on screen for the rest of this visit
  try { localStorage.setItem(key, "1"); } catch { /* private mode: the server's mark still counts */ }
  // Not a thing to retry loudly: at worst the opener shows once more on the next visit.
  api(`/api/orgs/${slug}/brenda/opener/seen`, { method: "POST", retries: 1 }).catch(() => {});
}

/** A path inside the workspace: the opener's links are `/app/{slug}/…`, or relative to the workspace (`/home/assistants`). */
const inWorkspace = (slug: string, href: string) => (href.startsWith("/app/") ? href : `/app/${slug}${href.startsWith("/") ? href : `/${href}`}`);

export function BrendaHome({ data }: { data: HomeData }) {
  const { role } = data;
  const { name } = useAssistant().personal;
  const lead = role !== "employee";
  const [history, setHistory] = useState(data.history);
  const openOnList = data.aiEnabled && (data.pastChats || data.chatMissing);
  const [view, setView] = useState<"start" | "chat">(data.aiEnabled && (data.chat || openOnList) ? "chat" : "start");
  // Each save moves the conversation to the top of Past chats (or adds it there). A reply that lands while her home
  // screen is up (Back pressed while it was on its way) is not read aloud, as in the closed drawer (review, 7 October 2026).
  const chat = useBrendaChat({ orgSlug: data.orgSlug, initialText: data.ask, initial: data.chat, visible: view === "chat", timeZone: data.timeZone, onSaved: (c) => setHistory((cur) => [c, ...cur.filter((x) => x.id !== c.id)]) });
  const character = useRef<BrendaCharacterHandle>(null);
  const box = useRef<HTMLDivElement>(null);
  // The chat may stay open with no conversation in it: opened on its past chats, after New chat, or after deleting the
  // open one. Otherwise an empty chat (a dictation still being written out before the first send) shows her home screen.
  const [blank, setBlank] = useState(openOnList);
  // Small screens: past chats as a sheet over the chat.
  const [sheet, setSheet] = useState(openOnList);
  const [opening, setOpening] = useState<string | null>(null);
  const [listError, setListError] = useState<string | null>(data.chatMissing ? "That chat is no longer here. It may have been deleted." : null);
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
    chat.quiet();
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

  // A wink hello; then her reactions (owner request, 7 October 2026): pleased by each reply she gives, a little
  // celebration whenever she has just done something. Reading along as you type and listening while you dictate come
  // with her box and her state (brenda-chat, brenda-character).
  useEffect(() => { const t = setTimeout(() => character.current?.emote("wink"), 900); return () => clearTimeout(t); }, []);
  useEffect(() => { if (chat.reaction) character.current?.emote(chat.reaction.kind); }, [chat.reaction]);

  // Opening the chat keeps the cursor in the box, and it returns there once she has answered (the box is disabled
  // while she works), unless you have since moved to something else, or past chats cover it (small screens, where
  // a focused box would also bring up the keyboard).
  useEffect(() => {
    const idle = !document.activeElement || document.activeElement === document.body;
    const covered = sheet && smallNow();
    if (chatting && !chat.pending && idle && !covered) focusBoxIn(box.current);
  }, [chatting, chat.pending]); // eslint-disable-line react-hooks/exhaustive-deps -- closing the sheet is not a reason to move the focus

  const more = <MoreMenu role={role} followUps={data.followUpsReady} talk={data.itemsReady} onPick={(p) => fill(p, true)} />;

  // The morning opener (phase 7a): the server's word on the first visit, or (before 0046) this browser's own key. The
  // server's render cannot read that key: it draws the chips, as most visits of a day are later ones, and the browser
  // brings the opener in on the first.
  const opener = data.aiEnabled ? data.opener ?? null : null;
  const openerMark = opener ? openerKey(data.orgSlug, data.memberId, opener.localDate) : "";
  const shownHere = useSyncExternalStore(noSubscribe, () => (opener?.firstVisit === null ? openerShownBefore(openerMark) : false), () => opener?.firstVisit === null);
  useEffect(() => () => { shownBefore.delete(openerMark); }, [openerMark]);
  const showOpener = !!opener && opener.firstVisit !== false && !shownHere;

  if (chatting) {
    return (
      <ChatView data={data} chat={chat} box={box} onBack={back} onNewChat={newChat} sheet={sheet} onSheet={setSheet} more={more} onAsk={(p) => fill(p)}
        history={<BrendaHistory conversations={history} now={data.now} currentId={chat.conversationId} opening={opening} error={listError}
          onOpen={(id) => void openChat(id)} onDelete={deleteChat} onStart={newChat} onClose={() => setSheet(false)} />} />
    );
  }

  const kind = lead ? "lead" : "worker";
  const isOrg = role === "owner" || role === "hr";
  // Everything waiting for the person between assistants: follow-up asks (phase 4) and items (phase 6).
  const loops = data.loops ?? [];
  const waiting = (data.followUpsReady ? data.waiting.length : 0) + (data.itemsReady ? data.items.length : 0) + loops.length;
  const inbox = data.followUpsReady || data.itemsReady;
  // Her character is monochrome like the rest of v4 (her light takes the orb's orange); the orb brightens while she
  // listens (a live microphone).
  const listening = chat.state === "listening";
  // Which engine answers her, beside her name: a short word on phones.
  const engine = !data.aiEnabled ? { full: "Not in your plan" } : data.assistantConfigured ? { full: "Connected to Claude", short: "Claude" } : { full: "Built-in helper" };
  const dot: StatusTone = !data.aiEnabled ? "neutral" : listening ? "live" : data.assistantConfigured ? "success" : "neutral";
  // The small pills in the panel's top row: 32px, round, hairline, the label then its icon; icon only on phones.
  // Frosted glass over her panel's glow (owner request, 7 October 2026), not the solid outline button.
  const pill = "brenda-glass-pill inline-flex h-8 items-center justify-center gap-1.5 whitespace-nowrap rounded-full px-3 text-meta font-medium text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)] [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:text-secondary hover:[&_svg]:text-foreground";
  const iconOnPhones = "max-sm:w-8 max-sm:px-0 max-sm:pointer-coarse:w-10";

  return (
    // Only her panel (owner request, 7 October 2026: "Your day" moved to My Day). #main keeps 64px under every page;
    // the negative margin takes 44px of it back, so the panel ends 20px from the bottom of the screen, as at its sides.
    <div className="-mb-11 w-full">
      {/* Her panel fills the screen under the top bar (20px from it and from the bottom, as from the sides). */}
      <section aria-labelledby="home-ask" className="brenda-panel -mt-1 flex min-h-[calc(100dvh-var(--header-height)-var(--shell-banners,0px)-40px)] flex-col p-3 sm:p-4 lg:p-5">
        <div className="flex flex-wrap items-center gap-2">
          <p className="brenda-glass-pill inline-flex h-8 min-w-0 max-w-full items-center gap-2 rounded-full px-3 text-meta font-medium text-foreground">
            <StatusDot tone={dot} size={6} />
            <span className="min-w-0 truncate">{name}</span>
            <span aria-hidden className="h-3.5 w-px shrink-0 bg-border-input" />
            <span className="min-w-0 truncate font-normal text-secondary">
              {engine.short ? <><span className="sm:hidden">{engine.short}</span><span className="max-sm:hidden">{engine.full}</span></> : engine.full}
            </span>
          </p>
          <div className="ml-auto flex items-center gap-1.5">
            {data.aiEnabled && hasConversation ? (
              <button ref={resumeButton} type="button" onClick={() => setView("chat")} className={cn(pill, "max-sm:px-2.5")}>
                <span className="max-sm:sr-only">Back to our conversation</span><CountPill count={chat.messages.length} /><AnimatedMessagesSquare aria-hidden />
              </button>
            ) : null}
            {/* Past chats live beside the chat, not in a tab of their own (owner decision, 5 October 2026): this opens them there. */}
            {data.aiEnabled ? (
              <button ref={pastChatsButton} type="button" onClick={showPastChats} className={cn(pill, iconOnPhones)}>
                <span className="max-sm:sr-only">Past chats</span>{history.length ? <CountPill count={history.length} className="max-sm:hidden" /> : null}<AnimatedHistory aria-hidden />
              </button>
            ) : null}
            {/* What the person's own assistant did or read for them (phase 3). Not gated by the plan: a record of what
                happened stays readable, as past chats' are. */}
            <Link href={`${base}/home/activity`} className={cn(pill, iconOnPhones)}>
              <span className="max-sm:sr-only">What {name} did</span><AnimatedActivity aria-hidden />
            </Link>
            {/* Between assistants (phases 4 and 6): the inbox opens on "Waiting for you"; the orange count asks the person
                to act. Not plan-gated: answering never needs the AI, and a record stays readable. */}
            {inbox ? (
              <Link href={`${base}/home/assistants`} className={cn(pill, waiting ? "max-sm:px-2.5" : iconOnPhones)}>
                <span className="max-sm:sr-only">Between assistants</span>
                {waiting ? <><CountPill count={waiting} tone="attention" /><span className="sr-only">waiting for you</span></> : null}<AnimatedMessageSquareReply aria-hidden />
              </Link>
            ) : null}
            {isOrg ? (
              <Link href={`${base}/settings?section=brenda`} className={cn(pill, iconOnPhones)}>
                <span className="max-sm:sr-only">Brenda settings</span><AnimatedSettings aria-hidden />
              </Link>
            ) : null}
          </div>
        </div>

        <div className="flex flex-1 flex-col items-center justify-center px-1 pb-8 pt-10 text-center">
          <div className="brenda-orb" data-live={listening || undefined}>
            {/* While you dictate she listens to the dictation's own microphone (its level widens her eyes and lifts her light). */}
            <BrendaCharacter ref={character} state={chat.state} size={72} interactive stream={chat.dictation.stream} className={cn(!listening && "grayscale")} />
          </div>
          <p className="mt-6 text-sm font-medium text-secondary">{data.greeting}, {data.firstName}. It&apos;s {data.dateLabel}.</p>
          <h1 id="home-ask" className="type-headline mt-1 sm:text-[32px] sm:leading-10">What do you want to do today?</h1>
        </div>

        <div className="@container mx-auto w-full max-w-[720px] text-left">
          {/* Someone's assistant is waiting for the person (phases 4 and 6): above the quick asks, two at most, asks first.
              Answering does not need the plan's assistant, so it shows on every plan. Kept mounted, so a card just
              answered stays (as "Sent.", or what it became) after the refresh drops it; with nothing to show it renders
              nothing. */}
          {inbox ? (
            <AssistantWaiting orgSlug={data.orgSlug} asks={data.followUpsReady ? data.waiting : []} items={data.itemsReady ? data.items : []} loops={loops} timeZone={data.timeZone} now={data.now}
              max={2} seeAllHref={`${base}/home/assistants`} compact cardClassName="bg-[color:var(--brenda-fill)] shadow-none" className="mb-5" />
          ) : null}
          {/* Phase 7b: the person's loose ends, after what is waiting for them; private to them, on every plan. */}
          {data.looseEnds?.ready ? (
            <LooseEndsPanel orgSlug={data.orgSlug} list={data.looseEnds} people={data.handOverPeople ?? []} timeZone={data.timeZone} now={data.now}
              rowClassName="bg-[color:var(--brenda-fill)] shadow-none" className="mb-5" />
          ) : null}
          {data.aiEnabled ? (
            <>
              {/* The first visit of the day: what stands and what to do about it (phase 7a); otherwise her quick asks. */}
              {showOpener && opener ? (
                <MorningOpener opener={opener} orgSlug={data.orgSlug} who={data.memberId} chip={cn(pill, "bg-[color:var(--brenda-fill)] [&_svg]:size-3.5")} onAsk={(p) => fill(p)} />
              ) : (
                <div role="group" aria-label="Quick asks" className="mb-3 flex flex-wrap gap-2">
                  {QUICK[kind].map((a) => (
                    <button key={a.label} type="button" onClick={() => fill(a.prompt)}
                      className={cn(pill, "bg-[color:var(--brenda-fill)] [&_svg]:size-3.5")}>
                      {a.label}<a.icon aria-hidden />
                    </button>
                  ))}
                </div>
              )}
              <div ref={box}>
                <BrendaComposer chat={chat} onSend={sendFromStart} leading={more} variant="hero" placeholder={`Ask ${name} anything…`} />
              </div>
              <DictationNotes chat={chat} className="[&>*:not(:empty)]:mt-2" />
              <ul aria-label="Start with" className="mt-3 grid gap-3 @xl:grid-cols-3">
                {CARDS[kind].map((c) => <ActionCard key={c.label} card={c} onPick={() => fill(c.prompt)} />)}
              </ul>
            </>
          ) : (
            <div className="card-tint px-4 py-3">
              <p className="text-sm font-medium text-foreground">Brenda isn&apos;t part of this workspace&apos;s plan yet.</p>
              <p className="mt-0.5 text-meta font-normal text-secondary">
                {role === "owner" ? "She does the work for your people: plans their day, follows up and writes documents." : "Ask your organisation owner to add her."}
              </p>
              {/* The one standout on this screen (accent rules): there is no Send to press without her. */}
              {role === "owner" ? <Link className={`${buttonVariants({ variant: "accent", size: "sm" })} mt-3`} href="/app/billing">Upgrade the plan</Link> : null}
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

/**
 * The morning opener (owner decision, 8 October 2026: phase 7a): "Here's where things stand", the day's counts as a list
 * of compact links (the number large and tabular, then its words; only counts above 0, and "not available" rows in
 * grey), or the calm line when nothing is waiting; then the actions as chips in the quick asks' own look (`chip`): a
 * link opens its page, an ask fills the box (never sends). Wraps at 400px. Seen once it has been on screen for a second.
 */
function MorningOpener({ opener, orgSlug, who, chip, onAsk }: { opener: Opener; orgSlug: string; who: string; chip: string; onAsk: (prompt: string) => void }) {
  const id = useId();
  const block = useRef<HTMLElement>(null);
  const { localDate } = opener;
  useEffect(() => {
    const el = block.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    // Seen after a full second in view and not covered (review, 8 October 2026): a modal over the page ("Meet your
    // assistant" on someone's first day), an inert or hidden page, or a hidden tab holds the count, which starts again
    // once the opener can really be seen.
    let onScreen = false;
    let since = 0;
    const io = new IntersectionObserver((entries) => { onScreen = entries.some((e) => e.isIntersecting); }, { threshold: 0.5 });
    io.observe(el);
    const tick = setInterval(() => {
      if (!onScreen || !openerUncovered(el)) { since = 0; return; }
      if (!since) { since = Date.now(); return; }
      if (Date.now() - since < 1000) return;
      clearInterval(tick);
      io.disconnect();
      markOpenerSeen(orgSlug, who, localDate);
    }, 250);
    return () => { io.disconnect(); clearInterval(tick); };
  }, [orgSlug, who, localDate]);
  const shown = opener.counts.filter((c) => c.value === null || c.value > 0);
  return (
    <section ref={block} aria-labelledby={`${id}-title`} className="mb-3">
      <h2 id={`${id}-title`} className="mb-2 text-meta font-medium text-secondary">{OPENER_WORDS.heading}</h2>
      {shown.length ? (
        <ul className="mb-3 flex flex-wrap gap-2">
          {shown.map((c) => <OpenerCountRow key={c.key} count={c} href={inWorkspace(orgSlug, c.href)} />)}
        </ul>
      ) : null}
      {opener.calm ? <p className="mb-3 text-sm font-normal text-secondary">{opener.calm}</p> : null}
      {opener.actions.length ? (
        <div role="group" aria-label="Next steps" className="flex flex-wrap gap-2">
          {opener.actions.map((a) => <OpenerChip key={a.id} action={a} orgSlug={orgSlug} chip={chip} onAsk={onAsk} />)}
        </div>
      ) : null}
    </section>
  );
}

/** Whether the opener can be seen: the tab is showing, nothing modal covers it and its part of the page is not inert. */
function openerUncovered(el: HTMLElement): boolean {
  if (document.visibilityState !== "visible") return false;
  if (el.closest("[inert], [aria-hidden='true']")) return false;
  for (const d of Array.from(document.querySelectorAll<HTMLElement>("dialog[open], [aria-modal='true']"))) {
    if (d.contains(el)) continue;
    let modal = d.getAttribute("aria-modal") === "true";
    if (!modal) { try { modal = d.matches(":modal"); } catch { modal = true; /* an older browser: any open dialog counts */ } }
    if (modal) return false;
  }
  return true;
}

/** One count: "2 requests waiting" as a compact link row, the number large. One that could not be read says so, in grey. */
function OpenerCountRow({ count, href }: { count: OpenerCount; href: string }) {
  const n = count.value;
  // The label carries the number ("2 requests waiting"); the row shows it large, then the words.
  const words = n !== null && count.label.startsWith(`${n} `) ? count.label.slice(String(n).length + 1) : null;
  return (
    <li className="flex min-w-0 max-w-full">
      <Link href={href} className="flex min-h-10 min-w-0 max-w-full items-center gap-2 rounded-xl border border-border bg-[color:var(--brenda-fill)] py-1.5 pl-3 pr-3.5 text-sm transition-colors duration-75 hover:border-border-input-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
        {n === null ? <span className="min-w-0 font-normal text-secondary">{count.label}</span>
          : words !== null ? <>
            <span aria-hidden className="text-lg font-semibold leading-6 tabular-nums text-foreground">{n}</span>
            <span aria-hidden className="min-w-0 font-medium text-foreground">{words}</span>
            <span className="sr-only">{count.label}</span>
          </>
            : <span className="min-w-0 font-medium text-foreground">{count.label}</span>}
      </Link>
    </li>
  );
}

/** One of the opener's actions, in the quick asks' chip: a link opens its page; an ask fills the box, never sends. */
function OpenerChip({ action, orgSlug, chip, onAsk }: { action: OpenerAction; orgSlug: string; chip: string; onAsk: (prompt: string) => void }) {
  const Icon = OPENER_ICONS[action.icon] ?? AnimatedInbox;
  if (action.kind === "link" && action.href) return <Link href={inWorkspace(orgSlug, action.href)} className={chip}>{action.label}<Icon aria-hidden /></Link>;
  return <button type="button" onClick={() => onAsk(action.prompt ?? action.label)} className={chip}>{action.label}<Icon aria-hidden /></button>;
}

/**
 * One of the three action cards under her box (after the reference's tool cards): r16, a hairline, the translucent fill
 * over her panel's glow, p16; a 32px icon square (r8, hairline) at the top left whose icon turns orange on hover and
 * focus (as her tool tiles did), the small pill's word at the top right, the title (14/20 600) and one line on what she
 * does (13px secondary). The whole card is one button: it (or its pill) fills the box with the request, never sends.
 */
function ActionCard({ card, onPick }: { card: Card; onPick: () => void }) {
  const id = useId();
  return (
    <li className="flex min-w-0">
      {/* Named by its title and its pill's word (what you see on it, so "Plan it" works by voice too); the line is its description. */}
      <button type="button" onClick={onPick} aria-labelledby={`${id}-title ${id}-action`} aria-describedby={`${id}-desc`}
        className="group flex w-full min-w-0 flex-col rounded-2xl border border-border bg-[color:var(--brenda-fill)] p-4 text-left transition-colors duration-75 hover:border-border-input-hover">
        <span className="flex w-full items-start justify-between gap-3">
          <span aria-hidden className="grid size-8 shrink-0 place-items-center rounded-lg border border-border bg-background text-secondary transition-colors duration-75 group-hover:text-accent group-focus-visible:text-accent [&_svg]:size-4">
            <card.icon aria-hidden />
          </span>
          <span id={`${id}-action`} className="inline-flex h-6 shrink-0 items-center rounded-full bg-fill-1 px-2.5 text-xs font-medium text-foreground transition-colors duration-75 group-hover:bg-fill-150">{card.action}</span>
        </span>
        <span id={`${id}-title`} className="mt-3 text-sm font-semibold text-foreground">{card.label}</span>
        <span id={`${id}-desc`} className="mt-0.5 text-meta font-normal text-secondary">{card.description}</span>
      </button>
    </li>
  );
}

/** "More asks" on the left of her box's bottom row: a menu of more things to ask. Choosing one puts its sentence in the box. */
function MoreMenu({ role, followUps, talk, onPick }: { role: HomeData["role"]; followUps: boolean; talk: boolean; onPick: (prompt: string) => void }) {
  const { name } = useAssistant().personal;
  return (
    <Menu label={`Ask ${name} to`} trigger={<PromptTextAction><AnimatedPlus aria-hidden />More asks</PromptTextAction>}>
      <MenuLabel>Ask {name} to…</MenuLabel>
      {moreAsks(role, followUps, talk).map((a) => <MenuItem key={a.label} icon={<a.icon aria-hidden />} onSelect={() => onPick(a.prompt)}>{a.label}</MenuItem>)}
    </Menu>
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
  const { personal: { name }, ai: assistantAi } = useAssistant();
  const scroller = useRef<HTMLDivElement>(null);
  const sheetButton = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLElement>(null);
  const backdrop = useRef<HTMLButtonElement>(null);
  const status = chat.pending ? "Working on it…" : chat.waitingAt >= 0 ? "Waiting for your answer" : chat.error ? "Something went wrong" : chat.dictation.listening ? "Listening" : "Here for you";
  // Listening or working is live (orange, breathing); an error, a question waiting and idle keep their status colours.
  const dot = chat.pending || chat.dictation.listening ? "live" : chat.error ? "danger" : chat.waitingAt >= 0 ? "warning" : "success";
  const empty = chat.messages.length === 0 && !chat.pending && !chat.error;
  const waitingCount = (data.followUpsReady ? data.waiting.length : 0) + (data.itemsReady ? data.items.length : 0) + (data.loops?.length ?? 0);
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
        <IconButton aria-label={`Back to ${name}'s home`} data-tip="Back" onClick={onBack}><AnimatedArrowLeft aria-hidden /></IconButton>
        <BrendaFace size="md" mood={chat.look.mood} interactive className="ml-1" />
        <div className="ml-1 min-w-0 flex-1">
          <h1 className="truncate font-sans text-sm font-semibold tracking-normal text-foreground">{name}</h1>
          <p role="status" className="flex items-center gap-1.5 truncate text-xs font-normal text-secondary">
            <StatusDot tone={dot} size={6} /><span className="min-w-0 truncate">{status}</span>
          </p>
        </div>
        <IconButton ref={sheetButton} className="lg:hidden" aria-label="Past chats" aria-expanded={sheet} aria-controls="brenda-past-chats" onClick={() => (sheet ? onSheet(false) : openSheet())}>
          <AnimatedHistory aria-hidden />
        </IconButton>
        {/* Everything the person's assistant did or read for them (phase 3), at every width; the tooltip reads its name. */}
        <Link href={`/app/${data.orgSlug}/home/activity`} className={ICON_BUTTON} aria-label={`What ${name} did`}><AnimatedActivity aria-hidden /></Link>
        {/* Between assistants (phases 4 and 6), right after "What Max did": an orange dot while anything waits for the
            person, with the count in its name (a word beside the colour). */}
        {data.followUpsReady || data.itemsReady ? (
          <Link href={`/app/${data.orgSlug}/home/assistants`} className={ICON_BUTTON}
            aria-label={waitingCount ? `Between assistants, ${waitingCount} waiting for you` : "Between assistants"}>
            <AnimatedMessageSquareReply aria-hidden />
            {waitingCount ? <span aria-hidden className="absolute right-1.5 top-1.5 size-1.5 rounded-full bg-accent" /> : null}
          </Link>
        ) : null}
        {/* Icon only on phones, as the home pills are, so her name and status keep their room at ~400px. */}
        <button type="button" onClick={onNewChat} className={cn(buttonVariants({ variant: "secondary", size: "sm" }), "max-sm:w-8 max-sm:px-0 max-sm:pointer-coarse:w-10")}><AnimatedPlus aria-hidden /><span className="max-sm:sr-only">New chat</span></button>
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

        <section aria-label={`Conversation with ${name}`} className="flex min-w-0 flex-1 flex-col">
          <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <div className={cn("mx-auto flex min-h-full w-full max-w-3xl flex-col px-5 py-8", !empty && "space-y-6")} aria-live="polite">
              {empty ? <EmptyChat chat={chat} firstName={data.firstName} asks={ASKS[data.role === "employee" ? "worker" : "lead"]} onAsk={onAsk} /> : <BrendaMessages chat={chat} size="lg" />}
            </div>
          </div>
          {/* Docked on a solid strip of the canvas with a hairline above: the conversation scrolls above it and never shows through. */}
          <div className="shrink-0 border-t border-border bg-background px-5 pb-4 pt-3 md:pb-5">
            <div ref={box} className="mx-auto max-w-3xl">
              <BrendaComposer chat={chat} leading={more} variant="hero" size="sm" placeholder={empty ? `What do you need, ${data.firstName}?` : `Reply to ${name}, ${data.firstName}…`} />
              {/* By the mode in force (review, 8 October 2026: it said "asks before" under the "Acting without asking" pill). */}
              <p className="mt-2 text-center text-xs font-normal text-subtle">{ACT_WORDS.chat.footer(name, chat.actMode.state.effective === "auto", assistantAi)}</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

/** A new chat, before the first message: her face, the question, and her asks as tool tiles, which fill the box. */
function EmptyChat({ chat, firstName, asks, onAsk }: { chat: BrendaChat; firstName: string; asks: Ask[]; onAsk: (prompt: string) => void }) {
  const { name } = useAssistant().personal;
  return (
    <div className="my-auto flex flex-col items-center py-10 text-center">
      <BrendaFace size="lg" mood={chat.look.mood} />
      <h2 className="type-headline mt-5">What do you need, {firstName}?</h2>
      <p className="mt-1 max-w-md text-sm font-normal text-secondary">Ask me something new, or carry on with one of your past chats.</p>
      <ToolTileRow label={`Ask ${name}`} className="mt-10">
        {asks.map((a) => <ToolTile key={a.label} icon={<a.icon aria-hidden />} label={a.label} onClick={() => onAsk(a.prompt)} />)}
      </ToolTileRow>
      {/* Before the first message there is no thread to carry dictation's notice or error (a blocked microphone). */}
      <DictationNotes chat={chat} className="mt-6 w-full max-w-md text-left" />
    </div>
  );
}
