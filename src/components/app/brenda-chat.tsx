"use client";

/**
 * A conversation with Brenda, shared by the drawer and Brenda Home (owner decision, 5 October 2026): the chat state
 * (`useBrendaChat`), the message list (`BrendaMessages`) and the box you type or talk into (`BrendaComposer`).
 *
 * Her own-work actions come back as done lines; anything that lands on someone else comes back as a prepared action
 * with Confirm and Not now, and only runs when the person presses Confirm (Y and N work too, when not typing). Her mood
 * follows the conversation: thinking while she works, cross on an error, alert while something waits for a yes,
 * pleased when her latest answer did something, listening while you dictate.
 *
 * Every conversation is kept (owner decision, 5 October 2026: past chats you can carry on or delete): it is saved after
 * its first exchange and again after each later one and each Confirm or Not now, privately to the person
 * (server/services/brenda-history.ts). A saved Confirm keeps what it said but not its token, so a conversation opened
 * again shows it as expired instead of offering it. Each save says which copy it was made from, so one conversation
 * carried on in two windows is not saved over: the second save is refused, and the chat takes the other window's copy
 * and puts its own new messages after it (`rebase`).
 *
 * Talking to her looks and feels like the notch's voice card (owner decision, 5 October 2026): the box shows the
 * shared voice card (components/app/voice-capture.tsx) while you dictate and while your words are written out.
 *
 * v4 look (6 October 2026, docs/design-system.md): your messages are fill-1 bubbles (r16); her replies are plain text
 * beside her face, with no bubble; what she did and what she prepared are outline rows (r12, a 10% hairline), and the
 * one white primary button is Confirm. The box is the home prompt pill.
 */
import { useEffect, useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlarmClock, ArrowUpRight, Check, Play, Plus, ShieldCheck } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Alert } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { BrendaFace, type BrendaMood, type BrendaTone } from "@/components/app/brenda-face";
import { playSound } from "@/lib/brenda-sound";
import { useDictation } from "@/hooks/use-dictation";
import { api, isApiFailure, type ApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import type { BrendaState } from "@/lib/brenda-character/engine";
import type { Action, ChatResult, Proposal } from "@/server/services/copilot";
import type { Conversation, ConversationSummary, StoredMessage } from "@/server/services/brenda-history";

export type BrendaMsg = { role: "user" | "assistant"; content: string; actions?: Action[]; proposals?: (Proposal & { done?: string })[]; engine?: ChatResult["engine"]; note?: string | null };

export const STARTERS: Record<"org" | "worker", string[]> = {
  org: ["What's waiting for me today?", "Who is working right now?", "Which assignments has nobody picked up?", "Summarise what the team got done this week"],
  worker: ["What's waiting for me today?", "Arrange my tasks for today", "Start the timer on my highest-priority task", "Remind me to call Josh at 7"],
};

// What the history keeps (CONVERSATION_LIMITS in server/services/brenda-history.ts): the newest 200 messages, each up
// to 8,000 characters, under a title of up to 200.
const KEEP = { messages: 200, content: 8000, title: 200 };
/** How long the chat waits after a change before saving, so a burst of changes is one save. */
const SAVE_DELAY = 600;
// Told to every chat on the page (Brenda's page and the drawer, which stays mounted under it) when a conversation is
// deleted, or saved by one of them.
const DELETED_EVENT = "boredroom:brenda-chat-deleted";
const SAVED_EVENT = "boredroom:brenda-chat-saved";

type Saved = { from: string; summary: ConversationSummary; messages: BrendaMsg[] };
/** A saved conversation as a saver starts from it: its messages, and the updatedAt of that copy. */
type Opened = { id: string; messages: BrendaMsg[]; updatedAt: string };
/**
 * A save refused because the conversation was saved from somewhere else since: `base` is the copy this chat had saved
 * or opened, `theirs` the copy there now, `latest` the newest state this chat had asked to save.
 */
type Conflict = { base: BrendaMsg[]; theirs: BrendaMsg[]; latest: BrendaMsg[]; summary: ConversationSummary };

/** Said quietly under the chat when another window's copy had to stand over a change made here. */
const CHANGED_ELSEWHERE = "This chat was also changed in another window, so it shows what was saved there.";

const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
const summaryOf = (c: Conversation): ConversationSummary => ({ id: c.id, title: c.title, preview: c.preview, messageCount: c.messageCount, createdAt: c.createdAt, updatedAt: c.updatedAt });

/** Two copies of one message: the same words from the same side. */
const sameWords = (a: BrendaMsg, b: BrendaMsg) => a.role === b.role && clip(a.content, KEEP.content) === clip(b.content, KEEP.content);
/** A message with what was made of it (Done, Not done, what a Confirm did), to tell whether a copy of it has moved on. */
const marks = (m: BrendaMsg) => JSON.stringify([m.role, clip(m.content, KEEP.content), m.proposals?.map((p) => p.done ?? "") ?? [], m.actions?.length ?? 0]);
/** Whether `theirs` is this save itself: it landed, and only the answer to it was lost on the way. */
const landed = (theirs: BrendaMsg[], mine: BrendaMsg[]) => {
  const kept = mine.slice(-KEEP.messages);
  return kept.length === theirs.length && kept.every((m, i) => marks(m) === marks(theirs[i]));
};

/**
 * Ours carried onto theirs, after a save was refused because the conversation was saved from somewhere else since
 * `base` (the copy this chat last saved or opened). What we added after base goes after theirs; a message we marked
 * since (Done, Not done, what a Confirm did) takes the place of its unmarked twin in theirs, and where theirs marked it
 * too, theirs stands (`lost`). Whole exchanges theirs already holds right after base are this chat's own earlier save,
 * which landed though its answer was lost on the way: they are not added twice. Null when ours cannot be put onto
 * theirs at all: ours no longer starts with base, or theirs no longer holds base's newest message.
 */
export function rebase(ours: BrendaMsg[], base: BrendaMsg[], theirs: BrendaMsg[]): { messages: BrendaMsg[]; lost: boolean } | null {
  if (ours.length < base.length || base.some((b, i) => !sameWords(b, ours[i]))) return null;
  // How many of base's oldest messages theirs no longer holds (only the newest 200 are kept).
  let skip = 0;
  while (skip < base.length && !base.slice(skip).every((b, i) => i < theirs.length && sameWords(b, theirs[i]))) skip++;
  if (base.length && skip === base.length) return null;
  const added = ours.slice(base.length);
  // Where theirs goes on after base, and how much of what we added it already holds there (whole exchanges only).
  const after = base.length - skip;
  let held = 0;
  for (let k = 0; k < added.length && after + k < theirs.length && sameWords(added[k], theirs[after + k]); k++) if (added[k].role === "assistant") held = k + 1;
  const marked = (m: BrendaMsg) => !!m.proposals?.some((p) => p.done);
  let lost = false, changed = false;
  const carried = theirs.map((t, i) => {
    const b = base[i + skip], o = ours[i + skip];
    if (b ? o === b || marks(o) === marks(b) : i >= after + held || marks(o) === marks(t) || !marked(o)) return t;
    if (b ? marks(t) !== marks(b) : marked(t)) { lost = true; return t; }
    changed = true; return o;
  });
  const rest = added.slice(held);
  return { messages: changed || rest.length ? [...carried, ...rest] : theirs, lost };
}

/** The first thing the person asked, on one line: the conversation's name in Past chats. */
function titleOf(messages: BrendaMsg[]) {
  const first = messages.find((m) => m.role === "user" && m.content.trim())?.content.replace(/\s+/g, " ").trim();
  return first ? clip(first, KEEP.title) : "Chat with Brenda";
}

/** The conversation as it is saved: the newest messages, each within the length kept, and no Confirm tokens. */
function forSaving(messages: BrendaMsg[]) {
  return messages.slice(-KEEP.messages).map((m) => ({
    ...m,
    content: clip(m.content, KEEP.content),
    proposals: m.proposals?.map((p) => (p.kind === "confirm" ? { kind: p.kind, summary: p.summary, tool: p.tool, done: p.done } : p)),
  }));
}

/** A saved message as the chat shows it. A saved Confirm has no token, which reads as expired. */
function restore(m: StoredMessage): BrendaMsg {
  return { ...m, engine: m.engine as BrendaMsg["engine"], proposals: m.proposals?.map((p) => (p.kind === "confirm" ? { ...p, token: "" } : p)) };
}

/**
 * Keeps one conversation saved. A change waits a moment and is then saved whole; one save runs at a time, and a change
 * made meanwhile is saved after it, so the newest state always lands last. The first save creates the conversation, the
 * later ones replace it. A failed save is let go without a word (the chat carries on, and the next change saves
 * everything again). A conversation deleted from another tab while open here is kept as a new one if the person
 * carries on talking; one deleted here stops saving.
 *
 * Each replacing save carries the updatedAt of the copy it was made from. When the conversation was saved from
 * somewhere else since (another tab, the notch), the save is refused (409) with the copy there now, which becomes the
 * one to build on: the chat on screen carries its own change onto it (`onConflict`), and a conversation no longer on
 * screen is carried over and saved here.
 */
class ConversationSaver {
  id: string | null;
  /** The messages as last saved or as opened: those need no save. */
  private saved: BrendaMsg[] | null;
  /** The updatedAt of that copy, sent with each save. */
  private version: string | null;
  private next: BrendaMsg[] | null = null;
  /** A state whose save failed: tried again only once something changes. */
  private failed: BrendaMsg[] | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  /** The state being saved right now, while a save runs. */
  private sending: BrendaMsg[] | null = null;
  private gone = false;

  constructor(private readonly orgSlug: string, private readonly onSaved: (saver: ConversationSaver, c: ConversationSummary, messages: BrendaMsg[]) => void,
    /** A save was refused (see Conflict); true when the chat on screen carries it over itself. */
    private readonly onConflict: (saver: ConversationSaver, change: Conflict) => boolean, opened?: Opened | null) {
    this.id = opened?.id ?? null;
    this.saved = opened?.messages ?? null;
    this.version = opened?.updatedAt ?? null;
  }

  /** After a change: saved shortly, once the conversation ends on her reply (an unanswered message waits for one). */
  queue(messages: BrendaMsg[]) {
    if (this.gone || messages === this.saved || messages === this.next || messages === this.sending || messages === this.failed || messages[messages.length - 1]?.role !== "assistant") return;
    this.next = messages;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => void this.flush(), SAVE_DELAY);
  }

  /** Saves what is waiting, now. */
  async flush(): Promise<void> {
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.sending || this.gone || !this.next) return;
    const messages = this.next;
    this.next = null;
    this.sending = messages;
    const base = `/api/orgs/${this.orgSlug}/brenda/conversations`;
    try {
      const body = { messages: forSaving(messages) };
      let saved: ConversationSummary | null = null;
      if (this.id) {
        try { saved = await api<ConversationSummary>(`${base}/${this.id}`, { method: "PUT", body: { ...body, expectedUpdatedAt: this.version ?? undefined } }); }
        catch (err) {
          if (isApiFailure(err) && err.error.code === "VERSION_CONFLICT") return await this.conflicted(messages, err);
          if (!isApiFailure(err) || err.error.status !== 404) throw err;
        }
      }
      if (this.gone) return;
      saved ??= await api<ConversationSummary>(base, { method: "POST", body: { title: titleOf(messages), ...body } });
      this.adopt(saved, messages);
    } catch { this.failed = messages; /* never interrupts the chat */ }
    finally {
      this.sending = null;
      if (this.next && !this.timer && !this.gone) void this.flush();
    }
  }

  private adopt(saved: ConversationSummary, messages: BrendaMsg[]) {
    this.id = saved.id;
    this.saved = messages;
    this.version = saved.updatedAt;
    if (!this.gone) this.onSaved(this, saved, messages);
  }

  /**
   * The save of `mine` was refused: the conversation was saved from somewhere else since this saver's copy. The copy
   * there now (sent with the refusal) becomes the one to build on, and whatever was waiting to be saved is carried onto
   * it: by the chat, when this is the conversation on screen (its state may have moved on since), else here.
   */
  private async conflicted(mine: BrendaMsg[], err: ApiFailure) {
    const c = (err.error.details?.conversation as Conversation | undefined) ?? await api<Conversation>(`/api/orgs/${this.orgSlug}/brenda/conversations/${this.id}`);
    if (this.gone) return;
    if (c.updatedAt === this.version) throw err; // the same copy again would only be refused again
    const theirs = c.messages.map(restore);
    if (landed(theirs, mine)) { this.adopt(summaryOf(c), mine); return; }
    const change: Conflict = { base: this.saved ?? [], theirs, latest: this.next ?? mine, summary: summaryOf(c) };
    this.saved = theirs;
    this.version = c.updatedAt;
    this.next = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
    if (this.onConflict(this, change)) return;
    const carried = rebase(change.latest, change.base, theirs);
    if (carried && carried.messages !== theirs) this.next = carried.messages;
  }

  /** Deleted: nothing waiting is saved, and nothing more will be. */
  drop() {
    this.gone = true;
    this.next = null;
    if (this.timer) { clearTimeout(this.timer); this.timer = null; }
  }
}

export function useBrendaChat({ orgSlug, keysActive = true, onLeave, initialText = "", initial = null, onSaved }: {
  orgSlug: string; /** Y/N answer a Confirm while true. */ keysActive?: boolean; /** Called before Brenda opens a page. */ onLeave?: () => void;
  /** Words already in the box (a link's `?ask=`); never sent on its own. */ initialText?: string;
  /** A past chat to open with (Brenda's page, `?chat=`). */ initial?: Conversation | null;
  /** After each save, with the conversation as the list shows it. */ onSaved?: (c: ConversationSummary) => void;
}) {
  const [opened] = useState<Opened | null>(() => (initial ? { id: initial.id, messages: initial.messages.map(restore), updatedAt: initial.updatedAt } : null));
  const [messages, setMessages] = useState<BrendaMsg[]>(() => opened?.messages ?? []);
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said quietly when another window's copy of this conversation stood over a change made here (CHANGED_ELSEWHERE).
  const [notice, setNotice] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<string | null>(opened?.id ?? null);
  const dictation = useDictation(text, setText);
  const router = useRouter();
  // Set before the first await, so a double press cannot send twice while dictation is being written out.
  const sending = useRef(false);
  // Which conversation a reply belongs to: New chat moves this on, so a reply still on its way is dropped, not added.
  const epoch = useRef(0);
  // The latest past chat asked for: opening another (or New chat) meanwhile drops the earlier one when it arrives.
  const loading = useRef(0);
  // Conversations deleted here: a save still on its way for one of them does not bring it back to the list.
  const deleted = useRef(new Set<string>());
  const savedListener = useRef(onSaved);
  useEffect(() => { savedListener.current = onSaved; });
  const me = useId();
  function afterSave(from: ConversationSaver, c: ConversationSummary, saved: BrendaMsg[]) {
    if (deleted.current.has(c.id)) return;
    if (from === slot.current) setConversationId(c.id);
    savedListener.current?.(c);
    window.dispatchEvent(new CustomEvent<Saved>(SAVED_EVENT, { detail: { from: me, summary: c, messages: saved } }));
  }
  /**
   * A save was refused: the conversation was saved from another window meanwhile. On screen, the chat takes that copy
   * with its own change carried onto it (`rebase`, applied to the chat as it is by now) and saves the result. When
   * nothing of its own can be carried over, that copy stands, a reply still on its way is dropped, and the chat says so
   * quietly; it says so too when a mark made here gave way to one made there.
   */
  function afterConflict(from: ConversationSaver, { base, theirs, latest, summary }: Conflict) {
    if (deleted.current.has(summary.id)) return true;
    savedListener.current?.(summary);
    if (from !== slot.current) return false;
    const carried = rebase(latest, base, theirs);
    if (!carried) { epoch.current += 1; setPending(false); setMessages(theirs); }
    else setMessages((cur) => rebase(cur, base, theirs)?.messages ?? theirs);
    if (!carried || carried.lost) setNotice(CHANGED_ELSEWHERE);
    return true;
  }
  // The saves of the conversation on screen. Each new conversation gets its own, so a late save lands where it belongs.
  const slot = useRef<ConversationSaver | null>(null);
  /** The conversation on screen's saver; the first is made on first use, for the conversation the hook opened with. */
  const saver = () => (slot.current ??= new ConversationSaver(orgSlug, afterSave, afterConflict, opened));

  /** Sends a message. From the box while dictating, it waits for the dictation and sends what was said. */
  async function send(content = text, fromBox = false) {
    if (pending || sending.current) return;
    sending.current = true;
    try {
      let q = content.trim();
      if (dictation.listening || dictation.busy) {
        if (fromBox) {
          const said = await dictation.stop();
          if (said === null) return; // the dictation failed or was cancelled: keep the box and the message on screen
          q = said.trim();
        } else void dictation.stop(); // a starter: send it, and let the dictation finish into the box
      }
      if (!q) return;
      const next: BrendaMsg[] = [...messages, { role: "user", content: q }];
      const mine = epoch.current;
      setMessages(next); setText(""); setPending(true); setError(null); setNotice(null);
      playSound("send");
      try {
        const r = await api<ChatResult>(`/api/orgs/${orgSlug}/assistant/chat`, { method: "POST", body: { messages: next.slice(-20).map((m) => ({ role: m.role, content: m.content })) }, retries: 0 });
        if (epoch.current !== mine) { if (r.actions?.length) router.refresh(); return; }
        setMessages((cur) => [...cur, { role: "assistant", content: r.reply, actions: r.actions, proposals: r.proposals, engine: r.engine, note: r.note }]);
        playSound(r.proposals?.some((p) => p.kind === "confirm") ? "attention" : r.actions?.length ? "success" : "reply");
        if (r.actions?.length) router.refresh();
      } catch (err) {
        // The message stays on screen as it is (setting it again would undo what changed meanwhile, such as another
        // window's copy taken in).
        if (epoch.current !== mine) return;
        setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); playSound("error");
      }
      finally { if (epoch.current === mine) setPending(false); }
    } finally { sending.current = false; }
  }

  /** Marks a prepared action done, unless New chat replaced that conversation meanwhile. */
  const markIn = (mine: number) => (mi: number, pi: number, done: string) => { if (epoch.current === mine) setMessages((cur) => cur.map((m, i) => (i === mi && m.proposals ? { ...m, proposals: m.proposals.map((x, j) => (j === pi ? { ...x, done } : x)) } : m))); };
  const mark = (mi: number, pi: number, done: string) => markIn(epoch.current)(mi, pi, done);

  async function act(mi: number, pi: number, p: Proposal) {
    setError(null);
    const mine = epoch.current;
    const mark = markIn(mine);
    try {
      if (p.kind === "open") { onLeave?.(); router.push(p.href); return; }
      if (p.kind === "todo") { await api(`/api/orgs/${orgSlug}/todos`, { method: "POST", body: { title: p.title, description: p.description, dueAt: p.dueAt, assigneeMembershipId: p.assigneeMembershipId, estimateMinutes: p.estimateMinutes } }); mark(mi, pi, "Added"); }
      else if (p.kind === "clock_in") { await api(`/api/orgs/${orgSlug}/clock/in`, { method: "POST" }); mark(mi, pi, "Clocked in"); }
      else if (p.kind === "clock_out") { await api(`/api/orgs/${orgSlug}/clock/out`, { method: "POST" }); mark(mi, pi, "Clocked out"); }
      else if (p.kind === "start_timer") { await api(`/api/orgs/${orgSlug}/sessions/start`, { method: "POST", body: { taskId: p.taskId } }); mark(mi, pi, "Started"); }
      else if (p.kind === "confirm") {
        const r = await api<{ actions: Action[]; error: string | null }>(`/api/orgs/${orgSlug}/brenda/confirm`, { method: "POST", body: { token: p.token }, retries: 0 });
        if (epoch.current !== mine) { router.refresh(); return; }
        if (r.error) { setError(r.error); playSound("error"); return; }
        mark(mi, pi, "Done");
        playSound("success");
        if (r.actions.length) setMessages((cur) => cur.map((m, i) => (i === mi ? { ...m, actions: [...(m.actions ?? []), ...r.actions] } : m)));
      }
      router.refresh();
    } catch (err) {
      // A Confirm that already ran (pressed twice, or in another tab) is done, not an error.
      if (isApiFailure(err) && err.error.code === "ALREADY_CONFIRMED") { mark(mi, pi, "Done"); return; }
      if (epoch.current !== mine) return;
      setError(isApiFailure(err) ? err.error.message : "Cannot reach the server."); playSound("error");
    }
  }

  const decline = (mi: number, pi: number) => mark(mi, pi, "Not done");

  /**
   * Moves to another conversation: an empty one, or a past chat. The one being left saves its last change first.
   * Anything still on its way from it (a reply, a Confirm, a past chat being fetched) is dropped when it lands.
   */
  function switchTo(next: Opened | null) {
    void saver().flush();
    epoch.current += 1;
    loading.current += 1;
    slot.current = new ConversationSaver(orgSlug, afterSave, afterConflict, next);
    dictation.cancel();
    setMessages(next?.messages ?? []); setText(""); setError(null); setNotice(null); setPending(false);
    setConversationId(next?.id ?? null);
  }

  /** New chat: an empty conversation. */
  const reset = () => switchTo(null);

  /**
   * Opens a past chat to carry on. Resolves false when something else was opened meanwhile; throws, with words to show
   * (and `gone` when it was deleted), when it cannot be fetched. The conversation already on screen is left as it is,
   * so its Confirm buttons still work.
   */
  async function load(id: string): Promise<boolean> {
    if (id === saver().id) return true;
    const mine = ++loading.current;
    try {
      const c = await api<Conversation>(`/api/orgs/${orgSlug}/brenda/conversations/${id}`);
      if (loading.current !== mine) return false;
      switchTo({ id: c.id, messages: c.messages.map(restore), updatedAt: c.updatedAt });
      return true;
    } catch (err) {
      if (loading.current !== mine) return false;
      const gone = isApiFailure(err) && err.error.status === 404;
      throw Object.assign(new Error(gone ? "That chat is no longer here." : isApiFailure(err) ? err.error.message : "Cannot reach the server."), { gone });
    }
  }

  /** A past chat was deleted (here, or by the other chat on this page): if it is the one on screen, a fresh one replaces it. */
  function forget(id: string) {
    deleted.current.add(id);
    if (saver().id === id) { saver().drop(); switchTo(null); }
  }

  /**
   * Deletes a past chat for good; when it is the one on screen, a fresh one takes its place. The drawer, which lives on
   * every page, hears of it too, so a conversation deleted on Brenda's page does not come back from there.
   */
  async function remove(id: string) {
    forget(id);
    try { await api(`/api/orgs/${orgSlug}/brenda/conversations/${id}`, { method: "DELETE" }); }
    catch (err) {
      if (!isApiFailure(err) || err.error.status !== 404) { deleted.current.delete(id); throw err; } // a 404 is already gone
    }
    window.dispatchEvent(new CustomEvent<string>(DELETED_EVENT, { detail: id }));
  }

  /** Saves what is waiting now instead of shortly (before leaving for Past chats, so the list has it). */
  const saveNow = () => void saver().flush();

  // Each change is saved once it settles; leaving the page saves what is waiting rather than dropping it.
  useEffect(() => { if (!pending) saver().queue(messages); });
  useEffect(() => () => void slot.current?.flush(), []);
  useEffect(() => {
    const onDeleted = (e: Event) => forget((e as CustomEvent<string>).detail);
    // A save by the other chat: Past chats shows it, and when it is the conversation on screen here too (the drawer
    // held it while Brenda's page went on with it), this one follows, so its next save does not write over that.
    const onSaved = (e: Event) => {
      const { from, summary, messages: theirs } = (e as CustomEvent<Saved>).detail;
      if (from === me || deleted.current.has(summary.id)) return;
      savedListener.current?.(summary);
      if (summary.id !== saver().id) return;
      epoch.current += 1;
      slot.current = new ConversationSaver(orgSlug, afterSave, afterConflict, { id: summary.id, messages: theirs, updatedAt: summary.updatedAt });
      setMessages(theirs); setError(null); setNotice(null); setPending(false);
    };
    window.addEventListener(DELETED_EVENT, onDeleted);
    window.addEventListener(SAVED_EVENT, onSaved);
    return () => { window.removeEventListener(DELETED_EVENT, onDeleted); window.removeEventListener(SAVED_EVENT, onSaved); };
  });

  const lastIndex = messages.length - 1;
  const last = messages[lastIndex];
  // A Confirm from a past chat has no token: it is shown as expired and never waits for a yes.
  const waitingAt = last?.role === "assistant" ? (last.proposals ?? []).findIndex((p) => p.kind === "confirm" && !p.done && !!p.token) : -1;
  const look: { mood: BrendaMood; tone: BrendaTone } = pending ? { mood: "think", tone: "violet" }
    : error ? { mood: "sad", tone: "bad" }
    : waitingAt >= 0 ? { mood: "alert", tone: "warn" }
    : last?.role === "assistant" && last.actions?.length ? { mood: "happy", tone: "ok" }
    : dictation.busy ? { mood: "think", tone: "accent" }
    : dictation.listening ? { mood: "listen", tone: "accent" } : { mood: null, tone: null };
  /** The same mood for the drawn character. */
  const state: BrendaState = pending ? "thinking" : error ? "error" : waitingAt >= 0 ? "alert"
    : last?.role === "assistant" && last.actions?.length ? "happy" : dictation.busy ? "working" : dictation.listening ? "listening" : "idle";

  useEffect(() => {
    if (!keysActive || waitingAt < 0) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      const p = messages[lastIndex]?.proposals?.[waitingAt];
      if (!p) return;
      if (e.key === "y" || e.key === "Y") { e.preventDefault(); void act(lastIndex, waitingAt, p); }
      if (e.key === "n" || e.key === "N") { e.preventDefault(); decline(lastIndex, waitingAt); }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  });

  return { messages, text, setText, pending, error, notice, dictation, send, act, decline, reset, load, remove, saveNow, conversationId, look, state, lastIndex, waitingAt };
}

export type BrendaChat = ReturnType<typeof useBrendaChat>;

/** A key that answers a button (Y and N on a Confirm): a small chip in the button's own colour. Hidden from screen
 * readers, which hear it from the button's aria-keyshortcuts instead. */
function KeyHint({ children }: { children: string }) {
  return <kbd aria-hidden className="ml-0.5 inline-grid h-[18px] min-w-[18px] place-items-center rounded-md bg-[color-mix(in_srgb,currentColor_12%,transparent)] px-1 font-sans text-[11px] font-medium leading-none opacity-80">{children}</kbd>;
}

// Buttons inside the conversation are plain buttons with the variant classes as they are, so the small sizes keep
// both their 13px type and their colour.
const btn = (variant: "primary" | "secondary" | "ghost", size: "xs" | "sm") => buttonVariants({ variant, size });

/**
 * The conversation: your messages, her replies with what she did and what waits for a yes, and her working states.
 * `size="lg"` is the full chat on Brenda's page: 16/24 reading type (the drawer keeps the 14/20 of the interface), her
 * face a size up, more room around each message, and each new message rises in. What is already there when the chat
 * opens (or when a past chat is loaded) shows at once: nothing animates on the way into the chat (owner decision,
 * 5 October 2026).
 */
export function BrendaMessages({ chat, onLeave, size = "md" }: { chat: BrendaChat; onLeave?: () => void; size?: "md" | "lg" }) {
  const router = useRouter();
  const { messages, pending, error, act, decline, look, lastIndex, waitingAt } = chat;
  const lg = size === "lg";
  const type = lg ? "text-base" : "text-sm";
  // Rows under her reply line up with its text, past her face.
  const indent = lg ? "pl-[42px]" : "pl-[30px]";
  // The messages shown when the list appeared; another conversation (a different first message) starts it again.
  const [shown, setShown] = useState({ first: messages[0], count: messages.length });
  if (messages[0] !== shown.first) setShown({ first: messages[0], count: messages.length });
  return (
    <>
      {messages.map((m, mi) => (
        <div key={mi} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start", lg && mi >= shown.count && "rise-in")}>
          {m.role === "user" ? (
            <p className={cn("max-w-[85%] whitespace-pre-wrap break-words rounded-2xl bg-fill-1 font-normal text-foreground", lg ? "px-4 py-2.5" : "px-3.5 py-2", type)}>{m.content}</p>
          ) : (
            <div className={cn("min-w-0 flex-1 space-y-3", type)}>
              <div className={cn("flex items-start", lg ? "gap-3" : "gap-2.5")}>
                <BrendaFace size={lg ? "md" : "sm"} className={lg ? "mt-px" : "mt-0.5"} mood={mi === lastIndex ? look.mood : null} />
                <p className="min-w-0 whitespace-pre-wrap break-words font-normal text-foreground">{m.content}</p>
              </div>
              {m.actions?.length ? (
                <ul className={cn("space-y-2", indent)}>{m.actions.map((a, ai) => (
                  <li key={ai} className="flex min-h-11 items-center gap-2.5 rounded-xl border border-border py-1.5 pl-3 pr-1.5 text-sm">
                    <Check className="size-4 shrink-0 text-success" aria-hidden />
                    <span className="min-w-0 flex-1 truncate font-normal text-foreground">{a.summary}</span>
                    {a.href ? <button type="button" className={btn("ghost", "xs")} onClick={() => { onLeave?.(); router.push(a.href!); }}>Open<ArrowUpRight aria-hidden /></button> : null}
                  </li>
                ))}</ul>
              ) : null}
              {m.proposals?.length ? (
                <ul className={cn("space-y-2", indent)}>{m.proposals.map((p, pi) => {
                  const keys = mi === lastIndex && pi === waitingAt;
                  return p.kind === "confirm" ? (
                    <li key={pi} className="rounded-xl border border-border-input p-3 text-sm">
                      <p className="flex items-start gap-2.5 font-medium text-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span className="min-w-0">{p.summary}</span></p>
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        {p.done ? <span className="text-xs font-medium text-secondary">{p.done}</span> : !p.token ? <span className="text-xs font-normal text-subtle">Expired. Ask Brenda again.</span> : <>
                          <button type="button" className={btn("ghost", "sm")} aria-keyshortcuts={keys ? "N" : undefined} onClick={() => decline(mi, pi)}>Not now{keys ? <KeyHint>N</KeyHint> : null}</button>
                          <button type="button" className={btn("primary", "sm")} aria-keyshortcuts={keys ? "Y" : undefined} onClick={() => void act(mi, pi, p)}><Check aria-hidden />Confirm{keys ? <KeyHint>Y</KeyHint> : null}</button>
                        </>}
                      </div>
                    </li>
                  ) : (
                    <li key={pi} className="flex min-h-11 items-center gap-3 rounded-xl border border-border-input py-1.5 pl-3 pr-1.5 text-sm">
                      <span className="min-w-0 flex-1 truncate font-normal text-foreground">
                        {p.kind === "todo" ? <>{p.title}{p.assigneeName ? <span className="text-secondary"> for {p.assigneeName}</span> : null}</> : p.kind === "clock_in" ? "Clock in" : p.kind === "clock_out" ? "Clock out" : p.kind === "start_timer" ? <>Start <span className="text-secondary">{p.taskTitle}</span></> : p.label}
                      </span>
                      {p.done ? <span className="inline-flex shrink-0 items-center gap-1 pr-1.5 text-xs font-medium text-success"><Check className="size-3.5" aria-hidden />{p.done}</span> : (
                        <button type="button" className={btn(p.kind === "open" ? "ghost" : "secondary", "sm")} onClick={() => void act(mi, pi, p)}>
                          {p.kind === "todo" ? <><Plus aria-hidden />Add</> : p.kind === "start_timer" ? <><Play aria-hidden />Start</> : p.kind === "open" ? <>Open<ArrowUpRight aria-hidden /></> : <><AlarmClock aria-hidden />{p.kind === "clock_in" ? "Clock in" : "Clock out"}</>}
                        </button>
                      )}
                    </li>
                  );
                })}</ul>
              ) : null}
              {m.engine === "builtin" || m.note ? <p className={cn("text-xs font-normal text-subtle", indent)}>{m.note ?? "Brenda's built-in helper: the AI is not connected yet, so she suggests instead of acting."}</p> : null}
            </div>
          )}
        </div>
      ))}
      {pending ? (
        <div role="status" className={cn("flex items-center", lg ? "gap-3" : "gap-2.5", type)}>
          <BrendaFace size={lg ? "md" : "sm"} mood="think" /><span className="brenda-shimmer font-normal">Brenda is on it…</span>
        </div>
      ) : null}
      <Presence show={!!error}><Alert tone="danger">{error}</Alert></Presence>
      <DictationNotes chat={chat} />
    </>
  );
}

/**
 * What dictation has to say outside the voice card: a passing notice (it moved to on-device dictation) and an error
 * (the microphone is blocked). The card itself, in the box, shows listening and writing out. The chat's own quiet word
 * (it now shows another window's copy) shares the same live region.
 */
export function DictationNotes({ chat, className }: { chat: BrendaChat; className?: string }) {
  const { dictation, notice } = chat;
  return (
    <div className={className}>
      {/* Always mounted, so screen readers announce changes to it. */}
      <div role="status" aria-live="polite">
        {notice ? <p className="mt-1 text-xs font-normal text-subtle">{notice}</p> : null}
        {dictation.notice ? <p className="mt-1 text-xs font-normal text-secondary">{dictation.notice}</p> : null}
      </div>
      <Presence show={!!dictation.error}><Alert tone="warning">{dictation.error}</Alert></Presence>
    </div>
  );
}

/**
 * The box: the home prompt pill. Type, or press the microphone and talk. While you talk, and while your words are
 * written out, the pill shows the notch's voice card (CONTRACT B: PromptInputBox draws it from `recordingHint` and
 * `transcribing`). `onSend` replaces plain sending (Brenda's page opens the full chat first). `leading` takes the
 * pill's round "+" on the left; `trailing` small things before the microphone.
 */
export function BrendaComposer({ chat, placeholder = "Tell Brenda what you need…", className, onSend, label, leading, trailing }: {
  chat: BrendaChat; placeholder?: string; className?: string; onSend?: (message: string) => void; /** The box's accessible name. */ label?: string;
  leading?: React.ReactNode; trailing?: React.ReactNode;
}) {
  const { text, setText, send, pending, dictation } = chat;
  // How far the on-device model has come while it downloads, announced in quarter steps only (the card is a live region).
  const pct = dictation.progress !== null ? Math.round(dictation.progress * 100) : null;
  const ready = pct !== null ? <><span className="tabular-nums" aria-hidden>{pct}%</span><span className="sr-only">{Math.floor(pct / 25) * 25}%</span></> : null;
  // Under the card's title ("Listening…" or "Getting your words…"): what to do next.
  const hint = dictation.busy
    ? ready ? <>Getting dictation ready… {ready}</> : "Writing out what you said, on this computer."
    : dictation.engine === "whisper"
      ? <>{ready ? <>Getting dictation ready in the background ({ready}). </> : null}Press stop or send when you&apos;re done and I&apos;ll write it out, on this computer.{dictation.englishOnly ? " On-device dictation understands English only." : null}</>
      : "Speak naturally. Press stop or send when you're done.";
  return (
    <PromptInputBox value={text} onValueChange={setText} onSend={(m) => (onSend ? onSend(m) : void send(m, true))} isLoading={pending} placeholder={placeholder} className={className} label={label}
      recording={dictation.listening} transcribing={dictation.busy} onToggleRecording={() => void dictation.toggle()} recordingSupported={dictation.supported !== false}
      recordingPlaceholder={dictation.engine === "whisper" ? "Listening… your words appear when you stop" : undefined}
      recordingHint={hint} recordingHeard={dictation.heard || null} onCancelRecording={() => dictation.cancel()} leading={leading} trailing={trailing} />
  );
}
