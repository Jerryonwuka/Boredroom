/**
 * @mentions in Messages (owner decision, 8 October 2026: personal assistants, phase 5). "@Max …" in a conversation makes
 * the person's OWN assistant reply in the thread; "@Ben" highlights Ben and notifies him.
 *
 * Phase 6 (owner decision, 8 October 2026: personal assistants, phase 6: "I want all the bots to be able to communicate
 * with each other"): "@Ben's Brenda, where is the deck?" tags SOMEONE ELSE's assistant. Ben's assistant answers in the
 * thread from Ben's work, under the follow-up rules, or asks Ben once and posts his reply; anything that would change
 * Ben's account becomes a request Ben accepts. The mention row names the assistant's owner; the statuses gain 'asked'
 * (the assistant asked its owner and said so in the thread); the notes gain the owner's reasons.
 *
 * This file is what the server, the composer, the thread and the notch share: the statuses of an assistant mention, the
 * limits, the tokens the composer sends beside the body, the pure text helpers (where a label stands in a body, the
 * body cut into pieces for drawing, the "@…" being typed at the caret), the views a thread reads, and the fixed words.
 * It imports nothing from the server, so client components can use it.
 *
 * Mentions are structural (review, 8 October 2026): the composer sends tokens, the server checks each against the body
 * and the conversation and stores the valid ones; nothing ever re-parses names later, and a typed "@Max" without a token
 * is plain text. Message text and answers are plain text everywhere: nothing here turns them into Markdown or links.
 */
import type { AssistantProfile } from "@/lib/assistant-look";
import type { FollowUpFacts } from "@/lib/follow-ups";
import type { Readback } from "@/lib/confirm-readback";

// ---- Statuses ----------------------------------------------------------------------------------------------------------

// 'asked' (phase 6): someone else's assistant asked its owner and posted "I've asked Ben. I'll reply here."; it moves to
// 'answered' when the reply (or the deadline) is posted.
export const MENTION_STATUSES = ["pending", "thinking", "answered", "private", "waiting_confirm", "refused", "failed", "withdrawn", "asked"] as const;
export type MentionStatus = (typeof MENTION_STATUSES)[number];
/** Still moving: queued, or the assistant is working on it. */
export const OPEN_MENTION_STATUSES: readonly MentionStatus[] = ["pending", "thinking"];
export const isMentionStatus = (v: unknown): v is MentionStatus => (MENTION_STATUSES as readonly unknown[]).includes(v);

// ---- Tokens --------------------------------------------------------------------------------------------------------------

/**
 * What the composer sends beside the body. `label` is the text as it stands in the body, "@" included. `others_assistant`
 * (phase 6): someone else's assistant, `membershipId` its owner's.
 */
export type MentionToken =
  | { kind: "assistant"; label: string }
  | { kind: "person"; membershipId: string; label: string }
  | { kind: "others_assistant"; membershipId: string; label: string };
/**
 * What a message carries back (message_mentions), for highlighting. An assistant's `membershipId` is its owner's: the
 * sender's for their own assistant, another reader's for theirs (phase 6).
 */
export type MentionRef = { kind: "person" | "assistant"; membershipId: string; label: string };

/** Someone else's assistant in this conversation, as the composer offers it (Thread.taggable; phase 6). */
export type TaggableAssistant = {
  /** The owner. */
  membershipId: string;
  personName: string; firstName: string;
  assistant: AssistantProfile;
  /** What autocomplete inserts: "@Ben's Brenda", or "@Ben Okafor's Brenda" when another reader shares the first name. */
  label: string;
  /** false: the owner switched "Let people tag my assistant in Messages" off (shown disabled). */
  allowed: boolean;
};

// ---- Limits (owner decision, 8 October 2026: constants in code, enforced by the server) ---------------------------------

export const MENTION_LIMITS = {
  tokensPerMessage: 20,
  perTaggerPerMinute: 5, perTaggerPerDay: 60,          // mentions handled; the model also counts against AI_DAILY_REQUEST_LIMIT (150)
  perConversationPerHour: 30, perOrganisationPerDay: 1000,
  threadMessages: 40, threadChars: 8000,               // what the assistant reads, newest kept
  publicChars: 600, publicLines: 6,                    // a public reply
  privateChars: 4000,                                  // a private answer (= a message's maximum, so Post to channel always fits)
  leaseSeconds: 180, maxAttempts: 3, staleSeconds: 30, // claim lease (renewed each model step); retries; when a pending row counts as stuck
  thinkingShowsMinutes: 10,                            // "Max is thinking…" stops showing after this, whatever the row says
  confirmMinutes: 60,                                  // a mention's Confirm tokens (and "Waiting for Olu to confirm") last this long
  maxSteps: 6, workerMaxSteps: 4, modelTimeoutMs: 60_000, maxTokens: 2000,
  kickPerPage: 3,                                      // stuck rows a page load may restart
  // Notifications for people mentions (security review, 8 October 2026): one sender notifies one person at most this
  // often per conversation, and at most this many people an hour in all; past that the mention is still marked in the
  // text, without a notification.
  notifyPerPersonPerHour: 3, notifyPerSenderPerHour: 60,
  // Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6): tags of one person's
  // assistant by anyone in an hour, and by one tagger in the organisation's day; past them the tag is refused privately.
  perOwnerPerHour: 20, perTaggerOwnerPerDay: 10,
  /** The longest label: "@" + a 120-character name + "'s " + a 24-character assistant name (message_mentions allows 160). */
  labelMax: 160,
} as const;

// ---- Text helpers ----------------------------------------------------------------------------------------------------------

const lower = (s: string) => s.toLocaleLowerCase("en-GB");

/** Compiled matchers by label: a label is looked for in many bodies (every message in a thread draws its mentions). */
const MATCHERS = new Map<string, RegExp>();
const MATCHERS_MAX = 500;

function matcherFor(label: string): RegExp {
  let re = MATCHERS.get(label);
  if (!re) {
    // Case-insensitive (Unicode simple case folding), whole mention only: see findLabel.
    re = new RegExp(`(?<![\\p{L}\\p{N}_@])${label.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")}(?![\\p{L}\\p{N}])`, "giu");
    if (MATCHERS.size >= MATCHERS_MAX) MATCHERS.clear();
    MATCHERS.set(label, re);
  }
  return re;
}

/**
 * Every place `label` stands in `body` as a whole mention (see findLabel), in order. One linear regular-expression scan
 * per label (security review, 8 October 2026: lowercasing a slice at every "@" let one @-padded message with 20
 * mentions cost about 100 ms to draw, on the server and in every browser).
 */
export function findLabelAll(body: string, label: string): number[] {
  const out: number[] = [];
  if (!label || label.length > body.length) return out;
  const re = matcherFor(label);
  re.lastIndex = 0;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    out.push(m.index);
    // Overlapping places count too ("@a @a" twice in "@a @a @a"): go on from the next character, not the match's end.
    re.lastIndex = m.index + 1;
  }
  return out;
}

/** "@Max" and "@assistant" (one label per variant, the first is the one autocomplete inserts). */
export function assistantLabels(assistantName: string): string[] {
  const name = assistantName.trim().replace(/\s+/g, " ");
  const labels = name ? [`@${name}`, "@assistant"] : ["@assistant"];
  return labels.filter((l, i) => labels.findIndex((x) => lower(x) === lower(l)) === i);
}

/**
 * Every label the server accepts for someone else's assistant (phase 6), case-insensitively, with "'" or "’": the
 * first-name form ("@Ben's Brenda") only when the first name is unique among the readers other than the sender, and
 * always the full-name form ("@Ben Okafor's Brenda"). The first is what autocomplete inserts. Labels longer than 160
 * characters are left out (message_mentions' check).
 */
export function otherAssistantLabels(personName: string, assistantName: string, firstNameUnique: boolean): string[] {
  const full = personName.trim().replace(/\s+/g, " ");
  const name = assistantName.trim().replace(/\s+/g, " ");
  if (!full || !name) return [];
  const first = full.split(" ")[0];
  const forms = [...(firstNameUnique && first !== full ? [first] : []), full];
  const out: string[] = [];
  for (const who of forms) {
    for (const apostrophe of ["'", "’"]) {
      const label = `@${who}${apostrophe}s ${name}`;
      if (label.length <= MENTION_LIMITS.labelMax && !out.some((x) => lower(x) === lower(label))) out.push(label);
    }
  }
  return out;
}

/**
 * Where `label` stands in `body` as a whole mention, case-insensitively (Unicode case folding): preceded by
 * the start or a character that is not a letter, digit, "_" or "@" (\p{L}\p{N}); followed by the end or a character
 * that is not a letter or digit. -1 when it does not. "@Ben Okafor" is found in "thanks @ben okafor!", not in
 * "mail@Ben Okafor" or "@Ben Okafors".
 */
export function findLabel(body: string, label: string): number {
  return findLabelAll(body, label)[0] ?? -1;
}

/** The body cut into text and mention pieces for drawing; the longest label wins where two overlap. */
export function splitMentions(body: string, refs: MentionRef[]): ({ text: string } | { text: string; ref: MentionRef })[] {
  const hits: { start: number; end: number; ref: MentionRef }[] = [];
  for (const ref of refs) {
    if (!ref?.label) continue;
    for (const start of findLabelAll(body, ref.label)) hits.push({ start, end: start + ref.label.length, ref });
  }
  // Longest first, then earliest: a piece is kept unless it overlaps one already kept.
  hits.sort((a, b) => (b.end - b.start) - (a.end - a.start) || a.start - b.start);
  const kept: typeof hits = [];
  for (const h of hits) if (!kept.some((k) => h.start < k.end && k.start < h.end)) kept.push(h);
  kept.sort((a, b) => a.start - b.start);
  const out: ({ text: string } | { text: string; ref: MentionRef })[] = [];
  let at = 0;
  for (const k of kept) {
    if (k.start > at) out.push({ text: body.slice(at, k.start) });
    out.push({ text: body.slice(k.start, k.end), ref: k.ref });
    at = k.end;
  }
  if (at < body.length || out.length === 0) out.push({ text: body.slice(at) });
  return out;
}

const OPENERS = new Set(["(", "[", "{", "\"", "'", "“", "‘"]);
const QUERY_MAX = 40;

/**
 * The "@…" being typed at the caret, for the autocomplete: an "@" at the start or after whitespace or one of ( [ { " '
 * “ ‘, then at most 40 characters with at most one space and no line break, ending at the caret. null otherwise. A query
 * that starts with a space ("meet @ 5") is not a mention (review, 8 October 2026: the list would open on every "@ ").
 */
export function mentionQueryAt(text: string, caret: number): { start: number; query: string } | null {
  if (!Number.isInteger(caret) || caret < 1 || caret > text.length) return null;
  const before = text.slice(0, caret);
  const start = before.lastIndexOf("@");
  if (start < 0) return null;
  const query = before.slice(start + 1);
  if (query.length > QUERY_MAX || /[\r\n\p{Zl}\p{Zp}]/u.test(query) || /^\s/.test(query)) return null;
  if ((query.match(/\s/g) ?? []).length > 1) return null;
  const prev = start > 0 ? text[start - 1] : "";
  if (prev && !/\s/.test(prev) && !OPENERS.has(prev)) return null;
  return { start, query };
}

// ---- Notes: why the assistant did not answer publicly -----------------------------------------------------------------

/** Why the assistant did not answer publicly, as a code (assistant_mention_private.note_code). */
// Phase 6 (someone else's assistant): the owner switched tags off ('off_owner'), no longer reads the conversation
// ('owner_left'), muted the tagger's assistant ('owner_muted'), may not be followed up by the tagger ('not_followable'),
// or their assistant was tagged a lot ('limit_owner').
// Phase 7c (owner decisions, 8–9 October 2026: the abilities catalogue): the tagger switched "@mentions in Messages" off
// for their own assistant ('off_ability'; migration 0050 widens the note's CHECK).
export const MENTION_NOTE_CODES = ["off_workspace", "off_conversation", "archived", "limit_minute", "limit_day", "limit_conversation", "limit_workspace", "allowance", "no_ai", "not_allowed", "failed",
  "off_owner", "owner_left", "owner_muted", "not_followable", "limit_owner", "off_ability"] as const;
export type MentionNoteCode = (typeof MENTION_NOTE_CODES)[number];
export const isMentionNoteCode = (v: unknown): v is MentionNoteCode => (MENTION_NOTE_CODES as readonly unknown[]).includes(v);

/**
 * The note's words, with the person's own assistant's name. `owner` (phase 6): the tagged assistant's owner, for the
 * owner's reasons ("Ben has switched off tags for their assistant").
 */
export function mentionNote(code: MentionNoteCode, assistantName: string, owner?: { firstName: string; assistantName: string } | null): string {
  const name = assistantName || "Brenda";
  const first = owner?.firstName || "They";
  const theirs = owner ? `${first}'s ${owner.assistantName || "Brenda"}` : "Their assistant";
  switch (code) {
    case "off_workspace": return `Assistant replies in Messages are off in this workspace. Ask ${name} in your own chat instead.`;
    case "off_conversation": return `Assistants can't reply in this conversation. Ask ${name} in your own chat instead.`;
    case "archived": return `This conversation is archived, so ${name} kept the answer for you.`;
    case "limit_minute": return "That's a lot of questions in one minute. Wait a moment, then ask again.";
    case "limit_day": return `You've asked ${name} in Messages a lot today. Ask again tomorrow, or in your own chat.`;
    case "limit_conversation": return `${name} has answered a lot here in the last hour. Ask again later, or in your own chat.`;
    case "limit_workspace": return "Assistants have answered a lot in Messages today. Ask again tomorrow, or in your own chat.";
    // The same words as the chat's limit note (copilot's limitNote), with the same daily allowance.
    case "allowance": return `You've used today's 150 requests to ${name}, so the built-in helper answered. ${name} can act for you again tomorrow.`;
    case "no_ai": return `${name} can't answer that here without the AI connected.`;
    case "not_allowed": return `${name} couldn't answer: you can't read this conversation any more.`;
    case "failed": return `${name} couldn't answer this time. Ask again, or ask in your own chat.`;
    case "off_owner": return `${first} has switched off tags for their assistant. Ask ${first} here.`;
    case "owner_left": return `${first} isn't in this conversation any more, so ${theirs} can't answer here. Ask ${first} directly.`;
    // The sender is told, in these words (owner decision as briefed, 8 October 2026: personal assistants, phase 6).
    case "owner_muted": return `${first} isn't taking messages from your assistant right now.`;
    case "not_followable": return `You can ask ${theirs} about ${first}'s work only when you work with ${first}. Ask ${first} here instead.`;
    case "limit_owner": return `${theirs} has been asked a lot today. Ask ${first} here instead, or try again later.`;
    case "off_ability": return `You switched off @${name} in Messages. Switch it on in Settings → Your assistant → Abilities.`;
  }
}

// ---- Views -------------------------------------------------------------------------------------------------------------------

export type MentionProposalView = {
  index: number; tool: string; summary: string; detail: string | null;
  state: "open" | "done" | "declined" | "expired" | "failed";
  /** done: what ran ("Added to-do: Call Ben"); failed: why. */
  result: string | null;
  /**
   * Who receives what (owner decision, 8 October 2026: phase 7a, Confirm readback): the card's "Goes to" list and "What
   * they get" line; null for a proposal stored before it.
   */
  readback: Readback | null;
};
export type MentionPrivateView = {
  kind: "answer" | "full_answer" | "note";
  text: string | null;
  note: { code: MentionNoteCode; words: string } | null;
  proposals: MentionProposalView[];
  postedMessageId: string | null; postedAt: string | null; dismissedAt: string | null;
  /**
   * kind answer with text, not posted, not dismissed, and the conversation not archived. Never for someone else's
   * assistant (phase 6): its private answer holds what not everyone here may see, and it is not the tagger's to post.
   */
  canPost: boolean;
};
export type MentionView = {
  id: string; messageId: string; status: MentionStatus; createdAt: string; updatedAt: string;
  tagger: { membershipId: string; name: string; firstName: string; isYou: boolean };
  /**
   * The answering assistant (its name and look; Brenda's defaults when they never chose): the tagger's own, or for a
   * tag of someone else's assistant (phase 6) the owner's.
   */
  assistant: AssistantProfile;
  /** Phase 6: the tagged assistant's owner when it is someone else's; null for the tagger's own assistant. */
  owner: { membershipId: string; name: string; firstName: string; isYou: boolean } | null;
  replyMessageId: string | null;
  /** pending or thinking, and created less than thinkingShowsMinutes ago: draw "Max is thinking…". */
  thinking: boolean;
  /** waiting_confirm and confirm_until still ahead: draw "Waiting for Olu to confirm" (the tagger sees the card instead). */
  waiting: boolean;
  /** The tagger only (null for everyone else, by row-level security and again by the service). */
  private: MentionPrivateView | null;
};
/** The switches as a thread needs them. */
export type AssistantRepliesState = { ready: boolean; workspaceOn: boolean; here: boolean; canChange: boolean };

// ---- Fixed words -------------------------------------------------------------------------------------------------------------

/** Every `/mentions/*` route and the conversation switch answer 503 with this before migration 0041. */
export const MENTIONS_NOT_READY_SHORT = "Mentions need a database update first. Try again later.";

/**
 * The words the thread, the composer, the switches and Settings use (owner decision, 8 October 2026: personal
 * assistants, phase 5). `name` is the tagger's own assistant's name; `first` the tagger's first name.
 */
export const MENTION_WORDS = {
  thinking: (name: string) => `${name} is thinking…`,
  waiting: (first: string) => `Waiting for ${first} to confirm`,
  onlyYou: "Only visible to you",
  /** "Post to channel", or "Post to chat" in a direct thread. */
  post: (direct: boolean) => (direct ? "Post to chat" : "Post to channel"),
  postChannel: "Post to channel",
  postChat: "Post to chat",
  posted: "Posted to the conversation.",
  dismiss: "Dismiss",
  readFull: "Read the full answer",
  hideFull: "Hide the full answer",
  continueWith: (name: string) => `Continue with ${name}`,
  withdraw: "Withdraw reply",
  withdrawTitle: (name: string) => `Withdraw ${name}'s reply?`,
  withdrawDescription: "It is removed for everyone in the conversation. The line stays so the thread keeps its shape.",
  /** The badge beside an assistant's row: "Olu's assistant", or "Your assistant" for the tagger. */
  badge: (first: string, isYou: boolean) => (isYou ? "Your assistant" : `${first}'s assistant`),
  composerHint: (name: string) => `${name} replies here for everyone to see. Anything only you can see stays private to you.`,
  listboxLabel: "Mention someone",
  assistantOption: "Your assistant",
  assistantOff: "Assistants can't reply in this conversation",
  suggestions: (n: number) => `${n} ${n === 1 ? "suggestion" : "suggestions"}. Up and down to choose, Enter to insert.`,
  noMatch: "No one here by that name",
  switchLabel: "Assistants can reply here",
  switchState: (on: boolean) => `Assistants can reply here: ${on ? "on" : "off"}`,
  // Phase 6: any assistant may be tagged here, the tagger's own or someone else's.
  disclosure: "When someone tags an assistant here, it reads this conversation to answer. Replies show whose assistant it is and who asked.",
  workspaceOff: "Assistant replies are off for the whole workspace in Settings.",
  settingsTitle: "Messages",
  settingsSwitch: "Let people ask their assistant in Messages",
  settingsHint: "Someone types @ and their assistant's name in a conversation; it reads the conversation and replies there, under its own name and who asked. Anything only they can see stays private to them.",
  notReady: "Mentions need a database update first.",
  // ---- Someone else's assistant (owner decision, 8 October 2026: personal assistants, phase 6) ----
  /** The badge beside the answering assistant: "Ben's assistant", or "Your assistant" for its owner. */
  badgeFor: (m: Pick<MentionView, "tagger" | "owner">) => (m.owner ? (m.owner.isYou ? "Your assistant" : `${m.owner.firstName}'s assistant`) : m.tagger.isYou ? "Your assistant" : `${m.tagger.firstName}'s assistant`),
  /** Under someone else's assistant's reply: "asked by Olu", or "asked by you" for the tagger. */
  askedBy: (first: string, isYou: boolean) => (isYou ? "asked by you" : `asked by ${first}`),
  /** The autocomplete row: "Ben's Brenda". */
  otherAssistantOption: (first: string, name: string) => `${first}'s ${name}`,
  /** Its secondary line: "Ben's assistant". */
  otherAssistantSecondary: (first: string) => `${first}'s assistant`,
  /** The disabled row when the owner switched tags off. */
  otherOff: (first: string) => `${first} isn't taking tags`,
  /** The composer's hint while someone else's assistant is tagged. */
  otherHint: (first: string, name: string) => `${first}'s ${name} answers here from ${first}'s work, or asks ${first}. Anything not everyone here can see goes only to you.`,
} as const;

/**
 * Whether anything is drawn under a tagging message for this viewer (MentionRows' rule): the thinking row, the tagger's
 * private card, or "Waiting for Olu to confirm" for everyone else. The thread ends a run of bubbles there.
 */
export function showsMentionRows(v: MentionView): boolean {
  // 'asked' (phase 6): the holding message already says it, and the private card was never written.
  if (v.thinking) return true;
  if (v.tagger.isYou) return !!v.private && v.private.kind !== "full_answer" && !v.private.dismissedAt;
  return v.waiting;
}

// ---- What someone else's assistant may say in a thread (owner decision, 8 October 2026: personal assistants, phase 6) ----

/**
 * The part of a follow-up's facts that every current reader of the conversation may see, for a public answer by someone
 * else's assistant (the audience rule; `visible`: the task ids every reader can see, from app_visible_to_readers as the
 * tagger; a person's own to-do never counts). Time, the timer and the latest update are never public (timeVisible
 * false). A task fact is public only when its task is in `visible`; its comments, history and submission belong to that
 * task and stay. A person fact keeps only the open and finished tasks in `visible`, without counting the rest. Null when
 * nothing is left: then the answer goes to the tagger privately.
 */
export function publicFacts(facts: FollowUpFacts, visible: Set<string>): FollowUpFacts | null {
  const ok = new Set([...visible].map((x) => x.toLowerCase()));
  const seen = (id: string | null | undefined) => !!id && ok.has(id.toLowerCase());
  const base: FollowUpFacts = { ...facts, timeVisible: false, time: null, timer: null, lastUpdate: null };
  if (facts.kind === "task") return facts.task && seen(facts.task.id) ? base : null;
  const openTasks = (facts.openTasks ?? []).filter((t) => seen(t.id));
  const completedToday = (facts.completedToday ?? []).filter((t) => seen(t.id));
  if (!openTasks.length && !completedToday.length) return null;
  const out: FollowUpFacts = { ...base, openTasks, completedToday };
  delete out.openMore;
  delete out.task;
  delete out.comments;
  delete out.history;
  delete out.submission;
  return out;
}
