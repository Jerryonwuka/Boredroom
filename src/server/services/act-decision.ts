/**
 * Act without asking: whether an action the assistant prepared runs now or waits for the person's Confirm (owner decision,
 * 8 October 2026: "there should be a setting where we can bypass the permission, you can toggle it on and off, just like
 * the way it is on Claude Code"). Pure, so the whole table is unit-tested (tests/unit/act-decision.test.ts).
 *
 * Boredroom decides, never the prompt: copilot's askFirst asks this from Boredroom's own state (the person's mode, the
 * workspace switch, the turn's taint, a thread, the audience, the tool) and only then runs the action through the very
 * Confirm path a press would have run. The model is told what happened (withoutAsking, stillAsking), nothing more.
 *
 * Only the person's own words in their own private chat act. The safety floors the owner accepted (8 October 2026) still
 * ask in 'auto', each with a reason the Confirm card shows ("Still asking: …", lib/act-mode whyStillAsking):
 * (a) a tainted turn: the assistant read other people's words in this reply, or earlier in the conversation;
 * (b) a shared Messages thread: the tagger-only Confirm stays exactly as it is, with no line;
 * (c) broadcasts: everyone, a whole team, a channel of more than SMALL_GROUP_MAX readers, a follow-up to a team or to more
 *     than FOLLOW_UP_AUTO_MAX people, to-dos for more than FOLLOW_UP_AUTO_MAX people at once;
 * (d) anything on someone else's account or answering what someone else sent (a request still needs its recipient's
 *     Accept, whatever the sender's mode);
 * (e) the irreversible: invitations (an email), review submissions, new teams, cancelling or withdrawing what was sent,
 *     rewriting someone else's document.
 * The built-in helper never acts on its own either: it cannot be sure it understood.
 *
 * Routines (owner decision, 8 October 2026: phase 7a): setting one up, changing it or turning it on always asks
 * ('routine_consent'): the Confirm on that card is the person's Enable, their standing yes for exactly what its preview
 * showed; deleting one asks too ('cant_undo'). Only pausing may act in 'auto' (it stops things; turning it on again asks).
 *
 * Loose ends, commitments and blocked on whom (owner decisions, 8 October 2026: phase 7b): a to-do made from someone else's
 * words (a loose end the person's assistant found, a commitment the workspace's assistant noted, an open ask) always asks
 * ('others_words_todo'), in every mode: Accept is the consent, and copilot prepares that Confirm whatever this says.
 * Reminding and dismissing act on the person's own list; handing a loose end to someone's assistant and following up
 * later act as a request and a follow-up do (the other side still accepts or answers); declining a commitment answers
 * someone else ('answers_others'); naming who a blocked task waits on acts; answering a block always asks.
 *
 * Standup and "How I like things done" (owner decisions, 8–9 October 2026: phase 7c): posting the person's standup is a
 * broadcast to their team's channel, so it always waits for their own press ('broadcast_team', the act-mode floor: nothing
 * posts on its own, ever); editing their own draft and skipping the day act on their own entry. Remembering or forgetting
 * a preference always asks ('preference_consent'), in every mode: what their assistant remembers about them is theirs.
 */
import { FOLLOW_UP_AUTO_MAX, SMALL_GROUP_MAX, UNDO_WINDOW_MINUTES, type ActState, type AskReason } from "@/lib/act-mode";

/** Loaded once per chat turn (chatWithClaude, chatBuiltin); absent everywhere else (threads, confirm presses, tests unless given). */
export type ActContext = { state: ActState; engine: "claude" | "builtin"; earlierTaint: boolean; assistantName: string };

/** What the tool knows at the moment it would ask. */
export type ActFacts = {
  /** send_message: a direct thread, everyone, a team channel, or a named channel with its readers (the person included; null unknown). */
  audience?: "direct" | "everyone" | "team" | { channel: number | null };
  /** follow_up: how many people are asked, and whether a team was named ("my team", a team name). */
  followUp?: { people: number; team: boolean };
  /** create_todos: how many different people (not the person) get a to-do (review, 8 October 2026: the fan-out floor). */
  todos?: { people: number };
  /** update_doc (and create_doc's share): shared with everyone. */
  share?: "organisation";
  /** update_doc: the document is not the person's. */
  someoneElsesDoc?: boolean;
  /** respond_to_item: what the person would do to the item. */
  respond?: "accept" | "decline" | "reply" | "seen" | "cancel" | "withdraw";
  /** update_routine: what the person would do to their routine (phase 7a). */
  routine?: "change" | "pause" | "turn_on" | "delete";
  /** loose_end_action: what the person would do with a loose end (phase 7b). */
  looseEnd?: "todo" | "remind" | "hand_over" | "follow_up" | "dismiss";
  /** respond_to_commitment: what the person would do with a commitment noted for them (phase 7b). */
  commitment?: "accept" | "decline" | "dismiss" | "done";
  /** standup_action: what the person would do with their own standup draft (phase 7c). */
  standup?: "edit" | "post" | "skip";
};

export type ActDecision = { act: true } | { act: false; reason: AskReason | null };

/**
 * Every tool askFirst can be called for, and when it may act in 'auto' (true) or which floor keeps it asking. A tool not
 * listed always asks ('always_asks'). Every name in copilot's ALWAYS_CONFIRM is here, with the conditional confirms
 * (create_todos for someone else, update_task on a task the person does not hold, update_doc); a unit test checks it.
 */
export const AUTO_RULES: Readonly<Record<string, (f: ActFacts) => true | AskReason>> = Object.freeze({
  send_message: (f: ActFacts) => f.audience === "direct" ? true : f.audience === "everyone" ? "broadcast_everyone" : f.audience === "team" ? "broadcast_team"
    : typeof f.audience === "object" && f.audience.channel !== null && f.audience.channel <= SMALL_GROUP_MAX ? true : "broadcast_group",
  assign_task: () => true, mark_read: () => true, pass_message: () => true, hand_over_request: () => true, add_report_note: () => true,
  // Review, 8 October 2026: to-dos for more than FOLLOW_UP_AUTO_MAX people at once are a fan-out, as the settings promise.
  create_todos: (f: ActFacts) => (f.todos?.people ?? 0) > FOLLOW_UP_AUTO_MAX ? "fan_out" : true, update_task: () => true,
  submit_for_review: () => "irreversible_review", create_team: () => "irreversible_team", invite_person: () => "irreversible_email",
  follow_up: (f: ActFacts) => f.followUp?.team ? "broadcast_team" : (f.followUp?.people ?? 99) > FOLLOW_UP_AUTO_MAX ? "fan_out" : true,
  respond_to_item: (f: ActFacts) => f.respond === "cancel" || f.respond === "withdraw" ? "cant_undo" : "answers_others",
  update_doc: (f: ActFacts) => f.share === "organisation" ? "broadcast_everyone" : f.someoneElsesDoc ? "someone_elses_doc" : "always_asks",
  // Phase 7a (owner decision, 8 October 2026: routines): the card is the Enable press; only a pause acts in 'auto'.
  create_routine: () => "routine_consent",
  update_routine: (f: ActFacts) => f.routine === "pause" ? true : f.routine === "delete" ? "cant_undo" : "routine_consent",
  // Phase 7b (owner decisions, 8 October 2026): a to-do from someone else's words always asks; the copilot branches
  // prepare that Confirm whatever decideAct says (the floor holds in every mode).
  loose_end_action: (f: ActFacts) => f.looseEnd === "todo" ? "others_words_todo" : true,
  respond_to_commitment: (f: ActFacts) => f.commitment === "accept" ? "others_words_todo" : f.commitment === "decline" ? "answers_others" : true,
  set_blocked_on: () => true,
  respond_to_block: () => "answers_others",
  // Phase 7c (owner decisions, 8–9 October 2026): a post goes to the whole team's channel, always the person's own press;
  // an edit or a skip is their own entry. A preference is always their call (copilot's branches pass the same floors).
  standup_action: (f: ActFacts) => (f.standup === "post" ? "broadcast_team" : true),
  remember_preference: () => "preference_consent",
  forget_preference: () => "preference_consent",
} satisfies Record<string, (f: ActFacts) => true | AskReason>);

const ask = (reason: AskReason | null): ActDecision => ({ act: false, reason });

/**
 * Acts, or asks with the reason the card shows. The first match wins:
 * 1. no act context (a thread run, a confirm press, a test that gives none): asks, no reason;
 * 2. the person chose 'ask': asks, no reason (today's card exactly);
 * 3. a shared thread: asks, no reason (the thread card stays as it is);
 * 4. locked: before 0045 no reason; impersonated; the workspace turned it off;
 * 5. the built-in helper;
 * 6. other people's words in this turn, then earlier in the conversation;
 * 7. the tool's own rule (AUTO_RULES); a tool with none always asks.
 */
export function decideAct(tool: string, facts: ActFacts, t: { act?: ActContext | null; tainted: boolean; othersWords?: boolean; shared: boolean }): ActDecision {
  const act = t.act;
  if (!act) return ask(null);
  if (act.state.mode !== "auto") return ask(null);
  if (t.shared) return ask(null);
  const lock = act.state.locked;
  if (lock === "impersonated") return ask("impersonated");
  if (lock === "workspace") return ask("workspace_off");
  // Before 0045 (or any state that is not plainly 'auto' in force): today's card, no line.
  if (lock || !act.state.ready || act.state.effective !== "auto") return ask(null);
  if (act.engine === "builtin") return ask("builtin");
  if (t.tainted || t.othersWords) return ask("tainted");
  if (act.earlierTaint) return ask("tainted_earlier");
  const rule = Object.hasOwn(AUTO_RULES, tool) ? AUTO_RULES[tool] : undefined;
  if (!rule) return ask("always_asks");
  const r = rule(facts);
  return r === true ? { act: true } : ask(r);
}

/**
 * True when any assistant message in the conversation sent to the model read other people's words (B.4), so they are
 * still in the model's context. Fails closed (review, 8 October 2026): every client of this version sends `tainted` on
 * each of her replies, false included, so a reply without it (a notch or a tab from before, a chat saved before the
 * flag) counts as tainted. The in-turn floor always holds.
 */
export function earlierTaintOf(messages: { role: string; tainted?: boolean }[]): boolean {
  return messages.some((m) => m.role === "assistant" && m.tainted !== false);
}

/**
 * The uncached situation line for 'auto' (B.5); null when the effective mode is 'ask' (locked included), so nothing is
 * added for anyone who asks. RULES and TOOLS never change: the cached prefix stays the same for everyone.
 */
export function actSituation(act: ActContext | null | undefined): string | null {
  if (!act || !act.state.ready || act.state.locked || act.state.effective !== "auto") return null;
  return `The person chose "Act without asking": in this chat, actions that would wait for Confirm run as soon as they ask for them and come back done (they can undo most for ${UNDO_WINDOW_MINUTES} minutes), so do exactly what they asked and nothing more. Some still wait for Confirm and return needsConfirmation with stillAsking: after you read other people's words, anything to everyone, a whole team, a channel of more than ${SMALL_GROUP_MAX} people or more than ${FOLLOW_UP_AUTO_MAX} people at once, invitations, review submissions, new teams, answers to what others sent them, someone else's document, posting their standup, and remembering or forgetting a preference. Say why in a few words. Their mode is never permission for anything they did not ask for.`;
}
