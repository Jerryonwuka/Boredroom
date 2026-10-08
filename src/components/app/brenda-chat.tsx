"use client";

/**
 * A conversation with Brenda, shared by the drawer and Brenda Home (owner decision, 5 October 2026): the chat state
 * (`useBrendaChat`), the message list (`BrendaMessages`) and the box you type or talk into (`BrendaComposer`).
 *
 * Her own-work actions come back as done lines; anything that lands on someone else comes back as a prepared action
 * with Confirm and Not now, and only runs when the person presses Confirm (Y and N work too, when not typing). Her mood
 * follows the conversation: thinking while she works, cross on an error, alert while something waits for a yes,
 * pleased when her latest answer did something, listening while you dictate. Her reactions (owner request, 7 October
 * 2026): she reads along while you type in her box (`useReadAlong`, which tells every face of hers on the page where
 * the caret is), and a reply pleases her for a moment, something done is a celebration (`reaction`).
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
 * one white primary button is Confirm. The box is the home prompt pill; on Brenda's page, her hero box (7 October 2026).
 *
 * Her replies are easy to scan (owner request, 7 October 2026: "if you're listing things, it should not be in a
 * paragraph; list it"): she writes light Markdown (the answer first, lists with the key words in bold, bold labels over
 * grouped lists), drawn by the Docs renderer in its chat variant (components/app/docs-markdown.tsx: React elements,
 * never an HTML string), whose links to Boredroom pages open in the app. Your own messages stay plain text.
 *
 * She is the person's own assistant (owner decision, 7 October 2026: personal assistants): the box's words and name, the
 * working line, the built-in helper's note and the expired Confirm use the name they chose (`useAssistant`), and a
 * conversation with no question yet is saved as "New chat", which does not go stale when the assistant is renamed.
 *
 * Her voice (owner decision, 7 October 2026: phase 2): she reads a reply aloud with this device's own voices
 * (lib/assistant-speech) as the person chose (`useAssistant().speak`): "voice", the default, reads the reply to a
 * message they dictated; "always" every reply; "never" none. Every reply has a Listen button to hear it on demand,
 * whatever the choice (Stop while it plays). One utterance at a time on the page: she stops when you type in her box,
 * send, start a new chat or open another, when this chat goes away or is put away (`quiet`, the drawer closing), and,
 * through the controller, whenever a microphone opens. A reply that lands while the chat is not on screen is not read.
 *
 * Follow-ups between assistants (owner decision, 8 October 2026: personal assistants, phase 4): once the person
 * confirms a follow-up, its action carries the batch's id (`followUpBatchId`) and the done line becomes the live
 * status card (follow-up-status-card), which goes from asking to answered in place; the Open button stays. The id is
 * saved with the conversation, so a past chat shows the follow-up as it is now. Times on the card are in the
 * organisation's time zone when the chat knows it (`timeZone`, her page), else this browser's.
 *
 * Assistants talk to each other (owner decision, 8 October 2026: personal assistants, phase 6): once the person confirms
 * a message passed on, a request handed over or a note for the team report, its action carries the item's id
 * (`assistantItemId`) and the done line becomes the item's live status card (assistant-item-status-card: "Ben has seen
 * it, 14:02.", "Ada accepted: to-do added.", with "Cancel request" or "Withdraw note" while possible), after the Confirm
 * it came from, as a follow-up's; the Open button stays. Saved with the conversation, so a past chat shows it as it is now.
 *
 * Act without asking (owner decision, 8 October 2026: "you can toggle it on and off, just like the way it is on Claude
 * Code"). Her box starts with the person's mode (act-mode-pill: "Ask first" or "Acting without asking"; Shift+Tab in the
 * box switches it), and a message waits for a switch to be saved before it is sent. What she did at once (in either
 * mode) comes back with Undo for 10 minutes on its done line (or on its live card, beside Open): pressed, the row reads
 * "Undone" with the server's words under it, and a polite status says it; a refusal ("It has changed since…") shows in
 * the chat's error alert and the button goes, and Undo hides on its own when its time is up. A line done without asking
 * says so under it ("Done without asking. You can undo it until 14:32."). A Confirm that still asks in that mode says why
 * under its summary ("Still asking: Max read other people's words in this reply."). A reply that read other people's
 * words is marked (`tainted`) and sent back with the conversation, so the server keeps asking in that chat. Saved: the
 * marks, the undone words and the why; never an Undo token (a reopened chat offers no Undo).
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2, ShieldCheck, Square, Undo2, Volume2 } from "lucide-react";
// Her reply rows' buttons are plain buttons styled with buttonVariants, so they carry the animated twins themselves.
import { AnimatedAlarmClock, AnimatedArrowUpRight, AnimatedCheck, AnimatedPlay, AnimatedPlus } from "@/components/ui/animated-icons";
import { buttonVariants } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { Alert } from "@/components/ui/states";
import { Presence } from "@/components/ui/motion";
import { PromptInputBox } from "@/components/ui/ai-prompt-box";
import { BrendaFace, type BrendaMood, type BrendaTone } from "@/components/app/brenda-face";
import { Markdown } from "@/components/app/docs-markdown";
import { useAssistant } from "@/components/app/assistant-context";
import { FollowUpStatusCard } from "@/components/app/follow-up-status-card";
import { AssistantItemStatusCard } from "@/components/app/assistant-item-status-card";
import { ActModePill, useActMode } from "@/components/app/act-mode-pill";
import { ACT_WORDS, undoOpen, type ActState, type UndoOffer } from "@/lib/act-mode";
import { playSound } from "@/lib/brenda-sound";
import { useDictation } from "@/hooks/use-dictation";
import { useSpeech } from "@/hooks/use-assistant-speech";
import { speech } from "@/lib/assistant-speech/controller";
import { speakable } from "@/lib/assistant-speech/speakable";
import { api, isApiFailure, type ApiFailure } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { attention, READ_BLUR_HOLD_MS, type BrendaState, type ReadCue } from "@/lib/brenda-character/engine";
import type { Action, ChatResult, Proposal } from "@/server/services/copilot";
import type { Conversation, ConversationSummary, StoredMessage } from "@/server/services/brenda-history";

/**
 * What she did, as the chat keeps it: a confirmed follow-up carries its batch, and something sent to another person's
 * assistant its item (copilot's Action gains the same fields). Act without asking (8 October 2026): `auto`, it ran
 * without a Confirm press; `undo`, its Undo while the offer stands (never saved); `undone`, the server's words once it
 * was undone.
 */
export type ChatAction = Omit<Action, "auto" | "undo"> & { followUpBatchId?: string; assistantItemId?: string; auto?: boolean; undo?: UndoOffer; undone?: string };
/** An action shown as a live card (a follow-up's or an item's) in place of its done line. */
const liveCard = (a: ChatAction) => !!a.followUpBatchId || !!a.assistantItemId;
/** A prepared action as the chat keeps it: marked once answered (`done`); a Confirm that still asks in auto mode says why. */
export type ChatProposal = Proposal & { done?: string; why?: string };
/** `tainted`: the reply read other people's words; sent back with the conversation so the server keeps asking. */
export type BrendaMsg = { role: "user" | "assistant"; content: string; actions?: ChatAction[]; proposals?: ChatProposal[]; engine?: ChatResult["engine"]; note?: string | null; tainted?: boolean };
/** Her reply as the chat route answers it, with what act without asking adds (copilot's ChatResult gains the same). */
type ChatReply = ChatResult & { tainted?: boolean; act?: ActState };
/** The answer to an Undo (POST /brenda/undo). */
type UndoResult = { undone: true; summary: string; spoken?: string };
/**
 * An Undo refused for good: not valid (400), someone else's (403), gone (404), or moved on (409: UNDO_EXPIRED,
 * UNDO_TOO_LATE, UNDO_CHANGED). Its button goes; after anything else (no answer, a fault) it stays, to try again.
 */
const UNDO_GONE = new Set([400, 403, 404, 409]);
/** An action without its Undo token. */
function withoutUndo(a: ChatAction): ChatAction {
  const copy = { ...a };
  delete copy.undo;
  return copy;
}

// The drawer's starters, listed one under another. Catching up on Messages is second for everyone (owner decision,
// 8 October 2026: personal assistants, phase 3).
export const STARTERS: Record<"org" | "worker", string[]> = {
  org: ["What's waiting for me today?", "What did I miss in Messages?", "Who is working right now?", "Which assignments has nobody picked up?", "Summarise what the team got done this week"],
  worker: ["What's waiting for me today?", "What did I miss in Messages?", "Arrange my tasks for today", "Start the timer on my highest-priority task", "Remind me to call Josh at 7"],
};

// What the history keeps (CONVERSATION_LIMITS in server/services/brenda-history.ts): the newest 200 messages, each up
// to 8,000 characters, under a title of up to 200.
const KEEP = { messages: 200, content: 8000, title: 200 };
/** How long the chat waits after a change before saving, so a burst of changes is one save. */
const SAVE_DELAY = 600;
/** How long her faces show a passing reaction (pleased by a reply). */
const REACTION_MS = 1800;
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
/**
 * A message with what was made of it (Done, Not done, what a Confirm did, what was undone), to tell whether a copy of it
 * has moved on.
 */
const marks = (m: BrendaMsg) => JSON.stringify([m.role, clip(m.content, KEEP.content), m.proposals?.map((p) => p.done ?? "") ?? [], m.actions?.length ?? 0, m.actions?.map((a) => (a.undone ? 1 : 0)) ?? []]);
/** Whether `theirs` is this save itself: it landed, and only the answer to it was lost on the way. */
const landed = (theirs: BrendaMsg[], mine: BrendaMsg[]) => {
  const kept = mine.slice(-KEEP.messages);
  return kept.length === theirs.length && kept.every((m, i) => marks(m) === marks(theirs[i]));
};

/**
 * Ours carried onto theirs, after a save was refused because the conversation was saved from somewhere else since
 * `base` (the copy this chat last saved or opened). What we added after base goes after theirs; a message we marked
 * since (Done, Not done, what a Confirm did, Undone) takes the place of its unmarked twin in theirs, and where theirs marked it
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
  const marked = (m: BrendaMsg) => !!m.proposals?.some((p) => p.done) || !!m.actions?.some((a) => a.undone);
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
  return first ? clip(first, KEEP.title) : "New chat";
}

/**
 * The conversation as it is saved: the newest messages, each within the length kept, no Confirm tokens and no Undo
 * tokens (an Undo belongs to the window it was offered in). What a reply read (`tainted`), what ran without asking
 * (`auto`), what was undone and why a Confirm still asked are kept.
 */
function forSaving(messages: BrendaMsg[]) {
  return messages.slice(-KEEP.messages).map((m) => ({
    ...m,
    content: clip(m.content, KEEP.content),
    actions: m.actions?.map(withoutUndo),
    proposals: m.proposals?.map((p) => (p.kind === "confirm" ? { kind: p.kind, summary: p.summary, tool: p.tool, ...(p.detail ? { detail: p.detail } : {}), ...(p.why ? { why: p.why } : {}), done: p.done } : p)),
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

export function useBrendaChat({ orgSlug, keysActive = true, visible = true, onLeave, initialText = "", initial = null, onSaved, timeZone }: {
  orgSlug: string; /** Y/N answer a Confirm while true. */ keysActive?: boolean;
  /** The organisation's time zone, for the times on a follow-up's card; this browser's when not given. */ timeZone?: string;
  /** Whether the chat is on screen: a reply that lands while it is not (the drawer closed meanwhile) is not read aloud. */ visible?: boolean;
  /** Called before Brenda opens a page. */ onLeave?: () => void;
  /** Words already in the box (a link's `?ask=`); never sent on its own. */ initialText?: string;
  /** A past chat to open with (Brenda's page, `?chat=`). */ initial?: Conversation | null;
  /** After each save, with the conversation as the list shows it. */ onSaved?: (c: ConversationSummary) => void;
}) {
  const [opened] = useState<Opened | null>(() => (initial ? { id: initial.id, messages: initial.messages.map(restore), updatedAt: initial.updatedAt } : null));
  const [messages, setMessages] = useState<BrendaMsg[]>(() => opened?.messages ?? []);
  const [text, setText] = useState(initialText);
  // When she reads a reply aloud (owner decision, 7 October 2026: her voice): the person's choice, and whether the chat
  // is on screen and still here, kept for the reply that arrives after an await.
  const { speak: prefer } = useAssistant();
  const voice = useRef({ prefer, visible, alive: true });
  useEffect(() => { voice.current.prefer = prefer; voice.current.visible = visible; });
  // Whether the message in the box was spoken: dictation wrote into it. Typing does not clear it (a dictated message
  // tidied by hand is still one you talked); emptying the box, sending and moving to another chat do.
  const voiced = useRef(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Said quietly when another window's copy of this conversation stood over a change made here (CHANGED_ELSEWHERE).
  const [notice, setNotice] = useState<string | null>(null);
  // The person's mode (owner decision, 8 October 2026: act without asking), shared with every box and Settings on the page.
  const actMode = useActMode(orgSlug);
  // The Undo presses on their way ("message:action" indexes), and what the last one did, for the polite status.
  const [undoing, setUndoing] = useState<readonly string[]>([]);
  // The same, at once, so a double press sends one Undo.
  const undoingNow = useRef(new Set<string>());
  const [said, setSaid] = useState("");
  const [conversationId, setConversationId] = useState<string | null>(opened?.id ?? null);
  // Her passing reaction to what just arrived: a reply pleases her (her faces smile for a moment), something done is a
  // celebration. Each one is a new object, so her drawn character plays it once (brenda-home).
  const [reaction, setReaction] = useState<{ kind: "pleased" | "celebrate" } | null>(null);
  const reactionTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const react = (kind: "pleased" | "celebrate") => {
    setReaction({ kind });
    if (reactionTimer.current) clearTimeout(reactionTimer.current);
    reactionTimer.current = setTimeout(() => setReaction(null), REACTION_MS);
  };
  useEffect(() => () => { if (reactionTimer.current) clearTimeout(reactionTimer.current); }, []);
  const dictation = useDictation(text, (t) => { voiced.current = true; setText(t); });
  /** The box's words as typing and the starters set them: an emptied box is no longer a spoken message. */
  const setBox = (t: string) => { if (!t) voiced.current = false; setText(t); };
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
  // Each reply's name for the voice (`${me}:${n}`), so its Listen button knows when it is the one being read, and
  // putting this chat away stops only what it started (the gallery's or Settings' sample stays).
  const ids = useRef(new WeakMap<BrendaMsg, string>());
  const nextId = useRef(0);
  /** The id the voice reads `m` under (given on first use). */
  const speechId = (m: BrendaMsg) => {
    let id = ids.current.get(m);
    if (!id) { id = `${me}:${++nextId.current}`; ids.current.set(m, id); }
    return id;
  };
  /** A reply changed in place (marked Done, or what a Confirm did added) keeps its id, so a Stop on it stays a Stop. */
  const keepId = (from: BrendaMsg, to: BrendaMsg) => { const id = ids.current.get(from); if (id) ids.current.set(to, id); return to; };
  /** Listen or Stop on one reply (pressed: a user gesture, which unlocks speech on iOS Safari). */
  const listen = (m: BrendaMsg) => {
    const id = speechId(m);
    const now = speech.getSnapshot();
    if (now.speaking && now.id === id) { speech.stop(); return; }
    speech.prime();
    speech.speak(m.content, { id });
  };
  /** Stops what this chat is reading aloud, and only that (the drawer, as it closes). */
  const quiet = useCallback(() => speech.stop(`${me}:`), [me]);
  // Leaving the page (or the chat going away) stops what it was reading; a reply still on its way is not read.
  useEffect(() => {
    const v = voice.current;
    v.alive = true;
    return () => { v.alive = false; quiet(); };
  }, [quiet]);
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
    // A new message silences her at once; and while this press is still a user gesture, speech is unlocked (iOS
    // Safari) for the reply she may read aloud (owner decision, 7 October 2026: her voice).
    speech.stop();
    if (voice.current.prefer !== "never") speech.prime();
    // Spoken: the box's words came from dictation, or it is still listening and what it hears is what is sent. A
    // starter sent directly is not.
    const spoken = fromBox && (voiced.current || dictation.listening || dictation.busy);
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
      setMessages(next); setText(""); setPending(true); setError(null); setNotice(null); setSaid("");
      voiced.current = false;
      playSound("send");
      try {
        // A switch of mode just made (the pill, Shift+Tab) is saved first, so the message runs in the mode shown.
        await actMode.settled();
        const since = actMode.rev();
        // Each reply that read other people's words goes back marked, so the server keeps asking in this chat.
        // Every reply of hers says whether it read other people's words, false included: the server counts a reply with no
        // flag (an older tab, a chat saved before the flag) as having read them (review, 8 October 2026: fails closed).
        const body = { messages: next.slice(-20).map((m) => ({ role: m.role, content: m.content, ...(m.role === "assistant" ? { tainted: m.tainted !== false } : {}) })) };
        const r = await api<ChatReply>(`/api/orgs/${orgSlug}/assistant/chat`, { method: "POST", body, retries: 0 });
        // The mode the server used: the pill follows it, unless the person switched since the message left.
        if (r.act) actMode.seed(r.act, since);
        if (epoch.current !== mine) { if (r.actions?.length) router.refresh(); return; }
        const reply: BrendaMsg = { role: "assistant", content: r.reply, actions: r.actions, proposals: r.proposals, engine: r.engine, note: r.note, tainted: !!r.tainted };
        setMessages((cur) => [...cur, reply]);
        // Read aloud as the person chose: every reply, or the reply to what they said. Only her words: never a
        // Confirm's result, an error or the built-in helper's note.
        const { prefer: choice, visible: shown, alive } = voice.current;
        if (alive && shown && (choice === "always" || (choice === "voice" && spoken))) speech.speak(reply.content, { id: speechId(reply) });
        const asks = r.proposals?.some((p) => p.kind === "confirm");
        playSound(asks ? "attention" : r.actions?.length ? "success" : "reply");
        // Waiting for a yes is her alert look; otherwise a reply pleases her and something done is a celebration.
        if (!asks) react(r.actions?.length ? "celebrate" : "pleased");
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
  const markIn = (mine: number) => (mi: number, pi: number, done: string) => { if (epoch.current === mine) setMessages((cur) => cur.map((m, i) => (i === mi && m.proposals ? keepId(m, { ...m, proposals: m.proposals.map((x, j) => (j === pi ? { ...x, done } : x)) }) : m))); };
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
        if (r.error) {
          // What ran before the failure keeps its done line (review, 8 October 2026).
          if (r.actions.length) { mark(mi, pi, "Done"); setMessages((cur) => cur.map((m, i) => (i === mi ? keepId(m, { ...m, actions: [...(m.actions ?? []), ...r.actions] }) : m))); router.refresh(); }
          setError(r.error); playSound("error"); return;
        }
        mark(mi, pi, "Done");
        playSound("success");
        react(r.actions.length ? "celebrate" : "pleased");
        if (r.actions.length) setMessages((cur) => cur.map((m, i) => (i === mi ? keepId(m, { ...m, actions: [...(m.actions ?? []), ...r.actions] }) : m)));
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

  /** Changes one of her done lines in place (its Undo spent or refused), unless New chat replaced that conversation. */
  const changeAction = (mine: number, mi: number, ai: number, change: (a: ChatAction) => ChatAction) => {
    if (epoch.current === mine) setMessages((cur) => cur.map((m, i) => (i === mi && m.actions?.[ai] ? keepId(m, { ...m, actions: m.actions.map((x, j) => (j === ai ? change(x) : x)) }) : m)));
  };

  /**
   * Undo on a done line (owner decision, 8 October 2026: act without asking): the person acting again, once, through
   * POST /brenda/undo. Done, the line reads "Undone" with the server's words, and a polite status says them; already
   * undone (another tab), it reads "Undone" without a word. A refusal shows the server's words in the chat's alert and
   * the button goes; with no answer it stays, to try again.
   */
  async function undo(mi: number, ai: number, a: ChatAction) {
    const offer = a.undo;
    const key = `${mi}:${ai}`;
    if (!offer || a.undone || undoingNow.current.has(key)) return;
    const mine = epoch.current;
    undoingNow.current.add(key);
    setError(null); setSaid("");
    setUndoing((cur) => [...cur, key]);
    try {
      const r = await api<UndoResult>(`/api/orgs/${orgSlug}/brenda/undo`, { method: "POST", body: { token: offer.token }, retries: 0 });
      if (epoch.current !== mine) { router.refresh(); return; }
      changeAction(mine, mi, ai, (x) => ({ ...withoutUndo(x), undone: r.summary || ACT_WORDS.chat.undone }));
      setSaid(ACT_WORDS.chat.undoneStatus(r.summary));
      router.refresh();
    } catch (err) {
      if (epoch.current !== mine) return;
      if (isApiFailure(err) && err.error.code === "ALREADY_UNDONE") { changeAction(mine, mi, ai, (x) => ({ ...withoutUndo(x), undone: ACT_WORDS.chat.undone })); return; }
      if (isApiFailure(err) && UNDO_GONE.has(err.error.status)) changeAction(mine, mi, ai, withoutUndo);
      setError(isApiFailure(err) ? (err.error.status < 500 || err.error.code === "NOT_READY" ? err.error.message : "Something went wrong. Nothing was undone; try again.") : "Cannot reach the server.");
      playSound("error");
    } finally {
      undoingNow.current.delete(key);
      setUndoing((cur) => cur.filter((k) => k !== key));
    }
  }

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
    // She stops reading the conversation being left, and only that: on Brenda's page the hidden drawer chat also
    // switches (its conversation deleted from Past chats here) and must not cut off what this page is reading.
    quiet();
    voiced.current = false;
    setMessages(next?.messages ?? []); setText(""); setError(null); setNotice(null); setPending(false); setReaction(null); setUndoing([]); setSaid("");
    undoingNow.current = new Set();
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
    : dictation.listening ? { mood: "listen", tone: "accent" }
    : reaction?.kind === "pleased" ? { mood: "happy", tone: null } : { mood: null, tone: null };
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

  return { orgSlug, timeZone, messages, text, setText: setBox, pending, error, notice, dictation, send, act, decline, reset, load, remove, saveNow, conversationId, look, state, reaction, lastIndex, waitingAt, speechId, listen, quiet,
    actMode, undo, undoing, said };
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
 *
 * Each reply of hers has Listen at the end of its first row, when this device has a voice of its own (owner decision,
 * 7 October 2026: her voice): a toggle whose name stays "Listen to this reply" while aria-pressed carries whether it is
 * playing; the tooltip says what a press does, and while it plays its icon is the orange stop square (live and now, the
 * accent rules). Not on the working line, errors or notes. Nothing is announced: a screen reader already reads the text.
 */
export function BrendaMessages({ chat, onLeave, size = "md" }: { chat: BrendaChat; onLeave?: () => void; size?: "md" | "lg" }) {
  const router = useRouter();
  const { name } = useAssistant().personal;
  const { messages, pending, error, act, decline, look, lastIndex, waitingAt } = chat;
  const voice = useSpeech();
  const lg = size === "lg";
  const now = useUndoClock(messages);
  const until = useMemo(() => {
    const f = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", ...(chat.timeZone ? { timeZone: chat.timeZone } : {}) });
    return (iso: string) => { try { return f.format(new Date(iso)); } catch { return ""; } };
  }, [chat.timeZone]);
  /**
   * What a done line offers after its summary (owner decision, 8 October 2026: act without asking): Undo while its offer
   * stands, "Undone" once it was undone, else nothing.
   */
  const undoFor = (mi: number, ai: number, a: ChatAction) => {
    if (a.undone) return <span className="shrink-0 px-1.5 text-xs font-medium text-secondary">{ACT_WORDS.chat.undone}</span>;
    if (!undoOpen(a.undo, now)) return null;
    const busy = chat.undoing.includes(`${mi}:${ai}`);
    return (
      <button type="button" className={btn("ghost", "xs")} aria-label={ACT_WORDS.chat.undoLabel(a.summary)} disabled={busy} aria-busy={busy || undefined}
        onClick={(e) => {
          // The button goes once it has done its work: the focus stays on its line rather than falling to the page.
          const row = e.currentTarget.closest<HTMLElement>("[data-undo-row]");
          void chat.undo(mi, ai, a).then(() => { if (row?.isConnected && (!document.activeElement || document.activeElement === document.body)) row.focus(); });
        }}>
        {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Undo2 aria-hidden />}{ACT_WORDS.chat.undo}
      </button>
    );
  };
  /** The line under a done line's summary: the server's words once undone, else whether it was done without asking. */
  const undoNote = (a: ChatAction) => {
    if (a.undone) return a.undone !== ACT_WORDS.chat.undone ? a.undone : null;
    if (!a.auto) return null;
    return undoOpen(a.undo, now) && until(a.undo.until) ? ACT_WORDS.chat.doneUntil(until(a.undo.until)) : ACT_WORDS.chat.doneWithoutAsking;
  };
  // A link in her reply to a Boredroom page opens it here, as her Open buttons do.
  const open = (href: string) => { onLeave?.(); router.push(href); };
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
                <Markdown variant="chat" source={m.content} base={`/app/${chat.orgSlug}`} onNavigate={open} className="flex-1 font-normal text-foreground" />
                {voice.supported === true ? <ListenButton content={m.content} playing={voice.speaking && voice.id === chat.speechId(m)} small={!lg} onPress={() => chat.listen(m)} /> : null}
              </div>
              {voice.blocked !== null && voice.blocked === chat.speechId(m) ? (
                <p role="status" className={cn("text-xs font-normal text-subtle", indent)}>{name} couldn&apos;t speak in this browser.</p>
              ) : null}
              {/* Done lines first; a confirmed follow-up's live card goes after the Confirm it came from, below (visual
                  review, 8 October 2026: the result read before the question that produced it). */}
              {m.actions?.some((a) => !liveCard(a)) ? (
                <ul className={cn("space-y-2", indent)}>{m.actions.map((a, ai) => {
                  if (liveCard(a)) return null;
                  const openIt = a.href ? <button type="button" className={btn("ghost", "xs")} onClick={() => { onLeave?.(); router.push(a.href!); }}>Open<AnimatedArrowUpRight aria-hidden /></button> : null;
                  const note = undoNote(a);
                  // The check, the summary on one line and the buttons; under them, from the summary's edge to the row's,
                  // whether it was done without asking (or what undoing it did), wrapping on a phone.
                  return (
                    <li key={ai} data-undo-row tabIndex={-1} className="grid min-h-11 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-2.5 rounded-xl border border-border py-1.5 pl-3 pr-1.5 text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                      {a.undone ? <Undo2 className="size-4 shrink-0 text-secondary" aria-hidden /> : <Check className="size-4 shrink-0 text-success" aria-hidden />}
                      <span className={cn("min-w-0 truncate font-normal", a.undone ? "text-secondary" : "text-foreground")}>{a.summary}</span>
                      <span className="flex shrink-0 items-center gap-1">{undoFor(mi, ai, a)}{openIt}</span>
                      {note ? <span className="col-span-2 col-start-2 pb-1 pr-1.5 text-meta font-normal text-secondary">{note}</span> : null}
                    </li>
                  );
                })}</ul>
              ) : null}
              {m.proposals?.length ? (
                <ul className={cn("space-y-2", indent)}>{m.proposals.map((p, pi) => {
                  const keys = mi === lastIndex && pi === waitingAt;
                  return p.kind === "confirm" ? (
                    <li key={pi} className="rounded-xl border border-border-input p-3 text-sm">
                      <p className="flex items-start gap-2.5 font-medium text-foreground"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden /><span className="min-w-0">{p.summary}</span></p>
                      {/* Why it still asks though the person chose Act without asking (8 October 2026), as the server said it. */}
                      {p.why ? <p className="ml-[26px] mt-1 text-meta font-normal text-secondary">{p.why}</p> : null}
                      {/* The whole message it will send, every word (review, 8 October 2026); a long one scrolls. */}
                      {p.detail && !(p.done && m.actions?.some(liveCard)) ? <div role="region" tabIndex={0} aria-label="The full message" className="ml-[26px] mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap break-words rounded-lg bg-fill-0 px-3 py-2 font-normal text-foreground outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">{p.detail}</div> : null}
                      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
                        {p.done ? <span className="text-xs font-medium text-secondary">{p.done}</span> : !p.token ? <span className="text-xs font-normal text-subtle">Expired. Ask {name} again.</span> : <>
                          <button type="button" className={btn("ghost", "sm")} aria-keyshortcuts={keys ? "N" : undefined} onClick={() => decline(mi, pi)}>Not now{keys ? <KeyHint>N</KeyHint> : null}</button>
                          <button type="button" className={btn("primary", "sm")} aria-keyshortcuts={keys ? "Y" : undefined} onClick={() => void act(mi, pi, p)}><AnimatedCheck aria-hidden />Confirm{keys ? <KeyHint>Y</KeyHint> : null}</button>
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
                          {p.kind === "todo" ? <><AnimatedPlus aria-hidden />Add</> : p.kind === "start_timer" ? <><AnimatedPlay aria-hidden />Start</> : p.kind === "open" ? <>Open<AnimatedArrowUpRight aria-hidden /></> : <><AnimatedAlarmClock aria-hidden />{p.kind === "clock_in" ? "Clock in" : "Clock out"}</>}
                        </button>
                      )}
                    </li>
                  );
                })}</ul>
              ) : null}
              {m.actions?.some(liveCard) ? (
                <ul className={cn("space-y-2", indent)}>{m.actions.map((a, ai) => {
                  if (!liveCard(a)) return null;
                  const openIt = a.href ? <button type="button" className={btn("ghost", "xs")} onClick={() => { onLeave?.(); router.push(a.href!); }}>Open<AnimatedArrowUpRight aria-hidden /></button> : null;
                  // Undo (act without asking, 8 October 2026) goes in the card's action slot, before Open.
                  const actions = <>{undoFor(mi, ai, a)}{openIt}</>;
                  const note = undoNote(a);
                  // A confirmed follow-up (phase 4) or something sent to another person's assistant (phase 6): its live
                  // card in place of the done line; the Open button stays.
                  return (
                    <li key={ai} data-undo-row tabIndex={-1} className="rounded-xl text-sm outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]">
                      {a.followUpBatchId
                        ? <FollowUpStatusCard orgSlug={chat.orgSlug} batchId={a.followUpBatchId} onLeave={onLeave} timeZone={chat.timeZone} action={actions} />
                        : <AssistantItemStatusCard orgSlug={chat.orgSlug} itemId={a.assistantItemId!} onLeave={onLeave} timeZone={chat.timeZone} action={actions} />}
                      {note ? <p className="mt-1 px-3 text-meta font-normal text-secondary">{note}</p> : null}
                    </li>
                  );
                })}</ul>
              ) : null}
              {m.engine === "builtin" || m.note ? <p className={cn("text-xs font-normal text-subtle", indent)}>{m.note ?? `${name}'s built-in helper: the AI is not connected yet, so it suggests instead of acting.`}</p> : null}
            </div>
          )}
        </div>
      ))}
      {pending ? (
        <div role="status" className={cn("flex items-center", lg ? "gap-3" : "gap-2.5", type)}>
          <BrendaFace size={lg ? "md" : "sm"} mood="think" /><span className="brenda-shimmer font-normal">{name} is on it…</span>
        </div>
      ) : null}
      <Presence show={!!error}><Alert tone="danger">{error}</Alert></Presence>
      {/* What an Undo did ("Undone: Removed the to-do"); always mounted, so it is announced. */}
      <p role="status" aria-live="polite" className="sr-only">{chat.said}</p>
      <DictationNotes chat={chat} />
    </>
  );
}

/**
 * The time Undo offers are judged by: the moment the list first showed, moved on when the soonest open offer ends (so
 * its button goes and its line says only "Done without asking."). Never read from the clock during a render.
 */
function useUndoClock(messages: BrendaMsg[]): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = Date.now();
    let next = Infinity;
    let passed = false;
    for (const m of messages) for (const a of m.actions ?? []) {
      if (!a.undo || a.undone) continue;
      const end = Date.parse(a.undo.until);
      if (!Number.isFinite(end)) continue;
      if (end <= t) { if (end > now) passed = true; } else if (end < next) next = end;
    }
    if (!passed && next === Infinity) return;
    const timer = setTimeout(() => setNow(Date.now()), passed ? 0 : next - t + 50);
    return () => clearTimeout(timer);
  }, [messages, now]);
  return now;
}

/**
 * Listen, or Stop while this reply plays: one toggle with a constant name (BrendaMessages). Not offered on a reply with
 * nothing to say aloud (only a table, code or links), as the notch (review, 7 October 2026).
 */
function ListenButton({ content, playing, small, onPress }: { content: string; playing: boolean; small: boolean; onPress: () => void }) {
  const sayable = useMemo(() => speakable(content) !== "", [content]);
  if (!sayable) return null;
  return (
    <IconButton size={small ? "xs" : "sm"} aria-label="Listen to this reply" aria-pressed={playing} data-tip={playing ? "Stop" : "Listen"} onClick={onPress} className="-mr-1 -mt-0.5">
      {playing ? <Square className="fill-current text-accent" aria-hidden /> : <Volume2 aria-hidden />}
    </IconButton>
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

// ---- Reading along ------------------------------------------------------------------------------------------------

const MIRRORED = ["boxSizing", "width", "paddingTop", "paddingRight", "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
  "fontFamily", "fontSize", "fontStyle", "fontWeight", "fontVariant", "fontStretch", "lineHeight", "letterSpacing", "wordSpacing", "textTransform", "textIndent", "tabSize"] as const;
let mirror: HTMLDivElement | null = null;

/**
 * Where the caret is in a textarea, in viewport coordinates: a hidden copy of the field, laid out the same, measured up
 * to the caret (so wrapped lines and new lines count), less the field's own scroll; kept inside the field.
 */
export function caretPoint(field: HTMLTextAreaElement): { x: number; y: number } {
  const r = field.getBoundingClientRect();
  const cs = getComputedStyle(field);
  const m = (mirror ??= document.createElement("div"));
  for (const p of MIRRORED) m.style[p] = cs[p];
  Object.assign(m.style, { position: "fixed", top: "0", left: "-10000px", height: "auto", overflow: "hidden", visibility: "hidden", pointerEvents: "none", whiteSpace: "pre-wrap", overflowWrap: "break-word" });
  m.textContent = field.value.slice(0, field.selectionEnd ?? field.value.length);
  const mark = m.appendChild(document.createElement("span"));
  mark.textContent = "\u200b"; // the caret: a zero-width space has a line's height and no width
  document.body.appendChild(m);
  const x = r.left + (parseFloat(cs.borderLeftWidth) || 0) + mark.offsetLeft - field.scrollLeft;
  const y = r.top + (parseFloat(cs.borderTopWidth) || 0) + mark.offsetTop + mark.offsetHeight / 2 - field.scrollTop;
  m.remove();
  return { x: Math.min(Math.max(x, r.left), r.right), y: Math.min(Math.max(y, r.top), r.bottom) };
}

/** At least this many characters arriving at once (a paste, a drop) make her blink in surprise. */
const PASTE_CHARS = 40;
const CUE_RANK: Record<ReadCue, number> = { key: 1, beat: 2, paste: 3 };

/**
 * Lets her read along while someone types in a box inside the element these handlers go on (owner request, 7 October
 * 2026: "when typing, she'll look like she's looking at what you're typing"). Each change tells the page-wide
 * `attention` (lib/brenda-character/engine) where the caret is, once a frame at most, with a cue: a character (`key`),
 * every three to five words a `beat` (a nod or a blink), a paste or drop of 40 characters or more (`paste`, a surprised
 * blink). Moving the caret with the keys while she reads moves her eyes too. She keeps looking a moment after the last
 * key and after the box loses the focus; a message sent (BrendaComposer) or the box going away ends it at once. Words
 * that arrive by dictation or a chip are not typing: she does not read those along. Typing also interrupts her if she
 * is reading a reply aloud (owner decision, 7 October 2026: her voice).
 */
export function useReadAlong() {
  const words = useRef({ count: 0, next: 3 });
  const lengths = useRef(new WeakMap<HTMLTextAreaElement, number>());
  const queued = useRef<{ field: HTMLTextAreaElement; cue: ReadCue | null } | null>(null);
  useEffect(() => () => attention.release(), []);

  const publish = (field: HTMLTextAreaElement, cue: ReadCue | null) => {
    const q = queued.current;
    if (q) { q.field = field; if (cue && (!q.cue || CUE_RANK[cue] > CUE_RANK[q.cue])) q.cue = cue; return; }
    queued.current = { field, cue };
    requestAnimationFrame(() => {
      const next = queued.current; queued.current = null;
      // Not once the box has gone, or while it waits for her reply (disabled).
      if (next && next.field.isConnected && !next.field.disabled) attention.read(caretPoint(next.field), next.cue);
    });
  };

  return {
    onFocus: (e: React.FocusEvent<HTMLElement>) => { if (e.target instanceof HTMLTextAreaElement) lengths.current.set(e.target, e.target.value.length); },
    onInput: (e: React.FormEvent<HTMLElement>) => {
      const field = e.target;
      if (!(field instanceof HTMLTextAreaElement)) return;
      speech.stop(); // also reaches audio that outlived its utterance (a no-op while she is silent)
      const ev = e.nativeEvent as InputEvent;
      const type = ev.inputType ?? "";
      const added = field.value.length - (lengths.current.get(field) ?? field.value.length);
      lengths.current.set(field, field.value.length);
      let cue: ReadCue = "key";
      if (/^insertFrom(Paste|Drop)/.test(type) && added >= PASTE_CHARS) cue = "paste";
      else if ((type === "insertText" && !!ev.data && /\s$/.test(ev.data)) || type === "insertLineBreak") {
        // A word just ended (a space or a new line after one): every few words, a beat.
        const before = field.value[(field.selectionEnd ?? field.value.length) - 2];
        if (before && !/\s/.test(before) && ++words.current.count >= words.current.next) {
          words.current = { count: 0, next: 3 + Math.floor(Math.random() * 3) };
          cue = "beat";
        }
      }
      publish(field, cue);
    },
    onKeyUp: (e: React.KeyboardEvent<HTMLElement>) => {
      if (attention.gaze && e.target instanceof HTMLTextAreaElement && /^(Arrow|Home$|End$|Page)/.test(e.key)) publish(e.target, null);
    },
    onBlur: (e: React.FocusEvent<HTMLElement>) => { if (e.target instanceof HTMLTextAreaElement) attention.release(READ_BLUR_HOLD_MS); },
  };
}

/**
 * The box: the home prompt pill (the drawer), or on Brenda's page her hero box (`variant="hero"`: `size="md"` on her
 * home screen, `"sm"` docked under her chat; owner decision, 7 October 2026). Type (she reads along: `useReadAlong`), or
 * press the microphone and talk (she listens: `chat.state` and `chat.look`).
 * While you talk, and while your words are written out, the box shows the notch's voice card (CONTRACT B:
 * PromptInputBox draws it from `recordingHint` and `transcribing`). `onSend` replaces plain sending (Brenda's page opens
 * the full chat first). `leading` takes the pill's round "+" on the left (the hero box's "More asks" on its bottom
 * row); `trailing` small things before the microphone.
 *
 * The person's mode comes first in `trailing` on every box of hers (owner decision, 8 October 2026: act without asking):
 * the act-mode pill. Shift+Tab while typing here switches it, like Claude Code; only while the box has text (review, 8
 * October 2026: a keyboard or screen-reader user passing back through an empty box must not change a permission, so
 * there Shift+Tab moves the focus back as usual), never while dictating or while it cannot be switched, and Tab still
 * leaves the box forwards. The text may narrow to make room, so the pill never pushes the microphone or Send off the
 * row; in the drawer (`variant` pill) the pill is its icon alone in a narrow box, so the placeholder keeps one line.
 */
export function BrendaComposer({ chat, placeholder, className, onSend, label, leading, trailing, variant, size }: {
  chat: BrendaChat; placeholder?: string; className?: string; onSend?: (message: string) => void; /** The box's accessible name. */ label?: string;
  leading?: React.ReactNode; trailing?: React.ReactNode; variant?: "pill" | "hero"; size?: "md" | "sm";
}) {
  const { text, setText, send, pending, dictation, actMode } = chat;
  const { personal: { name }, ai } = useAssistant();
  // She reads along as you type here; once it is sent she stops reading and gets to work.
  const readAlong = useReadAlong();
  const onKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Tab" || !e.shiftKey || e.altKey || e.ctrlKey || e.metaKey || e.nativeEvent.isComposing) return;
    if (!(e.target instanceof HTMLTextAreaElement) || !e.target.value.trim() || dictation.listening || dictation.busy || !actMode.canToggle) return;
    e.preventDefault();
    actMode.toggle();
  };
  const submit = (m: string) => { attention.release(); if (onSend) onSend(m); else void send(m, true); };
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
    // No box of its own (`contents`): it only hears the typing in the box.
    <div className="contents" {...readAlong} onKeyDown={onKeyDown}>
      <PromptInputBox value={text} onValueChange={setText} onSend={submit} isLoading={pending} placeholder={placeholder ?? `Tell ${name} what you need…`} className={cn("[&_textarea]:min-w-0", className)} label={label ?? `Message ${name}`}
        recording={dictation.listening} transcribing={dictation.busy} onToggleRecording={() => void dictation.toggle()} recordingSupported={dictation.supported !== false}
        recordingPlaceholder={dictation.engine === "whisper" ? "Listening… your words appear when you stop" : undefined}
        recordingHint={hint} recordingHeard={dictation.heard || null} onCancelRecording={() => dictation.cancel()} leading={leading}
        trailing={actMode.state.ready || trailing ? <><ActModePill control={actMode} compact={variant !== "hero"} ai={ai} />{trailing}</> : undefined} variant={variant} size={size} />
    </div>
  );
}
